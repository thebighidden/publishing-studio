"""Low-latency live view through scrcpy's server, decoded to JPEG frames.

`screencap` costs a full-resolution PNG per frame — about one frame a second
over Wi-Fi. scrcpy's server runs on the phone, encodes the display as H.264
in hardware and streams it; the bundled ffmpeg decodes that to JPEGs so the
existing MJPEG <img> view works unchanged, at up to 30 fps.

Viewing only (control=false). It touches nothing a recipe depends on, and if
scrcpy is missing or fails the stream endpoint falls back to screencap.

Needs scrcpy installed on this computer (`winget install Genymobile.scrcpy`),
or STUDIO_SCRCPY pointing at the folder holding scrcpy.exe and scrcpy-server.
The version passed to the server must match the server file exactly.
"""

from __future__ import annotations

import os
import re
import secrets
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Optional

from ..config import ADB_PATH
from .adb import _CREATE_NO_WINDOW, _run
from .base import DeviceError

REMOTE_JAR = "/data/local/tmp/scrcpy-server.jar"
CONNECT_TIMEOUT = 6.0


_found: Optional[tuple[str, str]] = None


def _locate() -> Optional[tuple[str, str]]:
    """(path to scrcpy-server, its version), or None when scrcpy is absent.
    Only a hit is cached, so installing scrcpy needs no backend restart."""
    global _found
    if _found is None:
        _found = _search()
    return _found


def _search() -> Optional[tuple[str, str]]:
    dirs: list[Path] = []
    explicit = os.environ.get("FLOWAI_SCRCPY") or os.environ.get("STUDIO_SCRCPY")
    if explicit:
        p = Path(explicit)
        dirs.append(p if p.is_dir() else p.parent)
    found = shutil.which("scrcpy")
    if found:
        dirs.append(Path(found).resolve().parent)  # winget's Links entry is a symlink
    packages = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/WinGet/Packages"
    if packages.is_dir():
        dirs.extend(p.parent for p in packages.glob("Genymobile.scrcpy_*/*/scrcpy-server"))

    for d in dirs:
        server = d / "scrcpy-server"
        if not server.is_file():
            continue
        version = _version(d)
        if version:
            return str(server), version
    return None


def _version(folder: Path) -> Optional[str]:
    m = re.search(r"scrcpy-win\d+-v([\w.\-]+)$", folder.name)
    if m:
        return m.group(1)
    exe = folder / ("scrcpy.exe" if os.name == "nt" else "scrcpy")
    if not exe.is_file():
        return None
    try:
        out = subprocess.run(
            [str(exe), "--version"], capture_output=True, timeout=10, creationflags=_CREATE_NO_WINDOW
        ).stdout.decode(errors="replace")
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(r"scrcpy\s+v?([\w.\-]+)", out)
    return m.group(1) if m else None


def available() -> bool:
    return _locate() is not None


def _major(version: str) -> int:
    m = re.match(r"(\d+)", version or "")
    return int(m.group(1)) if m else 0


def _ffmpeg() -> str:
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ScrcpySession:
    """One viewer's stream. Keeps only the newest frame, so a slow browser or
    network drops frames instead of building up lag."""

    def __init__(self, serial: str, max_size: int, max_fps: int = 30):
        located = _locate()
        if located is None:
            raise DeviceError("scrcpy is not installed")
        self.server_path, self.version = located
        self.serial = serial
        self.max_size = max_size
        self.max_fps = max_fps
        self.port = 0
        self._server: Optional[subprocess.Popen] = None
        self._ffmpeg: Optional[subprocess.Popen] = None
        self._sock: Optional[socket.socket] = None
        self._cond = threading.Condition()
        self._frame = b""
        self._seq = 0
        self._closed = False
        self._error = ""
        self._server_log = ""

    # ---------------- lifecycle ----------------

    @classmethod
    def open(cls, serial: str, max_size: int, max_fps: int = 30) -> "ScrcpySession":
        session = cls(serial, max_size, max_fps)
        try:
            session._start()
        except Exception:
            session.close()
            raise
        return session

    def _start(self) -> None:
        scid = f"{secrets.randbits(31):08x}"
        _run(["-s", self.serial, "push", self.server_path, REMOTE_JAR], timeout=60)
        self.port = _free_port()
        _run(["-s", self.serial, "forward", f"tcp:{self.port}", f"localabstract:scrcpy_{scid}"], timeout=15)
        self._server = subprocess.Popen(
            [
                ADB_PATH, "-s", self.serial, "shell",
                f"CLASSPATH={REMOTE_JAR}", "app_process", "/", "com.genymobile.scrcpy.Server",
                self.version,
                f"scid={scid}",
                "log_level=warn",
                "tunnel_forward=true",
                "audio=false",
                "control=false",
                "video_codec=h264",
                f"max_size={self.max_size}",
                f"max_fps={self.max_fps}",
                "video_bit_rate=4000000",
                # Bare H.264 Annex B, but keep the dummy byte: adb forward
                # accepts a TCP connection before the server is listening, and
                # that byte is the only proof the far end is really there.
                "send_device_meta=false",
                "send_frame_meta=false",
                # scrcpy 4 renamed the codec/size header option; an unknown one is ignored,
                # the header is sent anyway, and ffmpeg never decodes a frame.
                f"{'send_stream_meta' if _major(self.version) >= 4 else 'send_codec_meta'}=false",
                "send_dummy_byte=true",
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            creationflags=_CREATE_NO_WINDOW,
        )
        threading.Thread(target=self._drain_server_log, daemon=True).start()
        self._sock = self._connect()
        self._ffmpeg = subprocess.Popen(
            [
                _ffmpeg(), "-hide_banner", "-loglevel", "error",
                # No -fflags nobuffer / -flags low_delay: with ffmpeg 7 they drop every frame
                # of a phone's stream (checked on a Pixel 7a, Android 16).
                "-probesize", "32", "-analyzeduration", "0",
                "-threads", "1",  # frame threading adds frames of delay
                "-f", "h264", "-i", "pipe:0",
                "-fps_mode", "passthrough",
                # Phones send limited-range YUV, which ffmpeg 7's MJPEG encoder refuses by default.
                "-strict", "-1",
                "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "5", "pipe:1",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            creationflags=_CREATE_NO_WINDOW,
        )
        threading.Thread(target=self._pump_video, daemon=True).start()
        threading.Thread(target=self._read_frames, daemon=True).start()

    def _drain_server_log(self) -> None:
        """An unread stderr pipe fills and stalls the server; keep the tail
        so a failed start can say why."""
        try:
            for line in self._server.stderr:
                self._server_log = (self._server_log + line.decode(errors="replace"))[-600:]
        except (OSError, ValueError, AttributeError):
            pass

    def _connect(self) -> socket.socket:
        deadline = time.monotonic() + CONNECT_TIMEOUT
        while time.monotonic() < deadline:
            if self._server and self._server.poll() is not None:
                time.sleep(0.2)  # let the drain thread catch the last lines
                raise DeviceError(f"scrcpy server exited: {self._server_log.strip() or 'no output'}")
            try:
                sock = socket.create_connection(("127.0.0.1", self.port), timeout=2.0)
            except OSError:
                time.sleep(0.15)
                continue
            try:
                if sock.recv(1):
                    sock.settimeout(None)
                    return sock
            except OSError:
                pass
            sock.close()
            time.sleep(0.15)
        raise DeviceError(f"scrcpy server did not answer. {self._server_log.strip()}".strip())

    def close(self) -> None:
        with self._cond:
            if self._closed and self._sock is None and self._ffmpeg is None:
                return
            self._closed = True
            self._cond.notify_all()
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None
        for proc in (self._ffmpeg, self._server):
            if proc is not None and proc.poll() is None:
                proc.kill()
        self._ffmpeg = None
        self._server = None
        if self.port:
            try:
                _run(["-s", self.serial, "forward", "--remove", f"tcp:{self.port}"], timeout=10)
            except DeviceError:
                pass
            self.port = 0

    def _fail(self, why: str) -> None:
        with self._cond:
            if not self._closed:
                self._error = why
            self._closed = True
            self._cond.notify_all()

    # ---------------- threads ----------------

    def _pump_video(self) -> None:
        sock, ff = self._sock, self._ffmpeg
        try:
            while True:
                chunk = sock.recv(65536)
                if not chunk:
                    break
                ff.stdin.write(chunk)
                ff.stdin.flush()
        except (OSError, ValueError, AttributeError):
            pass
        self._fail("phone stopped sending video")

    def _read_frames(self) -> None:
        out = self._ffmpeg.stdout
        buf = b""
        try:
            while True:
                chunk = out.read1(262144)
                if not chunk:
                    break
                buf += chunk
                # ffmpeg's MJPEG frames are SOI…EOI; inside the entropy-coded
                # data 0xFF is always stuffed, so FFD9 only ever marks the end.
                while True:
                    start = buf.find(b"\xff\xd8")
                    end = buf.find(b"\xff\xd9", start + 2) if start != -1 else -1
                    if end == -1:
                        if start > 0:
                            buf = buf[start:]
                        break
                    frame, buf = buf[start : end + 2], buf[end + 2 :]
                    with self._cond:
                        self._frame = frame
                        self._seq += 1
                        self._cond.notify_all()
        except (OSError, ValueError, AttributeError):
            pass
        self._fail("video decoder stopped")

    # ---------------- consumer ----------------

    def next_frame(self, after_seq: int, timeout: float = 1.0) -> tuple[int, bytes]:
        """The newest frame after `after_seq`. Returns the same seq on timeout
        (a still screen sends nothing), raises once the stream has ended."""
        with self._cond:
            self._cond.wait_for(lambda: self._seq != after_seq or self._closed, timeout)
            if self._closed and self._seq == after_seq:
                raise DeviceError(self._error or "stream closed")
            return self._seq, self._frame
