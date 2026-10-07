from __future__ import annotations

import os
import posixpath
import re
import shutil
import subprocess
import time
import unicodedata
import uuid
from typing import Optional
from xml.etree import ElementTree

from ..config import ADB_PATH
from .base import (
    Bounds,
    DeviceDriver,
    DeviceError,
    DeviceInfo,
    ScreenState,
    TapResult,
    UiNode,
)
from .targets import resolve_or_raise

DEVICE_MEDIA_DIR = "/sdcard/DCIM/Camera"
_CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0


def adb_available() -> bool:
    return shutil.which(ADB_PATH) is not None or os.path.isfile(ADB_PATH)


def _run(args: list[str], timeout: int = 30, binary: bool = False):
    try:
        proc = subprocess.run(
            [ADB_PATH, *args],
            capture_output=True,
            timeout=timeout,
            creationflags=_CREATE_NO_WINDOW,
        )
    except FileNotFoundError as exc:
        raise DeviceError(
            f"adb not found at {ADB_PATH!r}. Install Android platform-tools, or set STUDIO_ADB."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise DeviceError(f"adb {' '.join(args[:3])} timed out after {timeout}s") from exc
    if proc.returncode != 0:
        err = proc.stderr.decode(errors="replace").strip() or proc.stdout.decode(errors="replace")
        raise DeviceError(f"adb {' '.join(args[:3])} failed: {err[:400]}")
    return proc.stdout if binary else proc.stdout.decode(errors="replace")


def list_devices() -> list[DeviceInfo]:
    if not adb_available():
        return []
    try:
        out = _run(["devices", "-l"], timeout=15)
    except DeviceError:
        return []
    devices: list[DeviceInfo] = []
    for line in out.splitlines()[1:]:
        line = line.strip()
        if not line or "\t" not in line and " " not in line:
            continue
        parts = line.split()
        serial, state = parts[0], parts[1]
        model = ""
        for p in parts[2:]:
            if p.startswith("model:"):
                model = p.split(":", 1)[1]
        devices.append(
            DeviceInfo(serial=serial, model=model, online=(state == "device"), driver="adb")
        )
    return devices


def connect_wireless(host_port: str) -> str:
    """adb connect 192.168.1.42:5555 — for a phone on the same Wi-Fi."""
    return _run(["connect", host_port], timeout=20).strip()


class AdbDriver(DeviceDriver):
    kind = "adb"

    def __init__(self, serial: str):
        if not serial:
            raise DeviceError("adb driver needs a device serial")
        self.serial = serial
        self._size: Optional[tuple[int, int]] = None

    # ---------------- plumbing ----------------

    def _adb(self, *args: str, timeout: int = 30, binary: bool = False):
        return _run(["-s", self.serial, *args], timeout=timeout, binary=binary)

    def _shell(self, *args: str, timeout: int = 30) -> str:
        return self._adb("shell", *args, timeout=timeout)

    # ---------------- introspection ----------------

    def info(self) -> DeviceInfo:
        online = any(d.serial == self.serial and d.online for d in list_devices())
        model = android = ""
        w = h = 0
        if online:
            model = self._shell("getprop", "ro.product.model").strip()
            android = self._shell("getprop", "ro.build.version.release").strip()
            w, h = self.screen_size()
        return DeviceInfo(
            serial=self.serial,
            model=model,
            android=android,
            width=w,
            height=h,
            online=online,
            driver="adb",
        )

    def screen_size(self) -> tuple[int, int]:
        if self._size:
            return self._size
        out = self._shell("wm", "size")
        m = re.search(r"Override size:\s*(\d+)x(\d+)", out) or re.search(
            r"Physical size:\s*(\d+)x(\d+)", out
        )
        self._size = (int(m.group(1)), int(m.group(2))) if m else (0, 0)
        return self._size

    def screenshot(self) -> bytes:
        png = self._adb("exec-out", "screencap", "-p", timeout=40, binary=True)
        if not png.startswith(b"\x89PNG"):
            # Some shells on Windows mangle CRLF in the binary stream.
            png = png.replace(b"\r\n", b"\n")
        if not png.startswith(b"\x89PNG"):
            raise DeviceError("screencap did not return a PNG")
        return png

    def screen_state(self) -> ScreenState:
        xml = self._dump_window_xml()
        nodes = _parse_hierarchy(xml)
        pkg, act = self._current_activity()
        return ScreenState(package=pkg, activity=act, nodes=nodes)

    def _dump_window_xml(self) -> str:
        remote = "/sdcard/window_dump.xml"
        last_err = None
        for _ in range(3):
            try:
                self._shell("uiautomator", "dump", remote, timeout=45)
                xml = self._adb("exec-out", "cat", remote, timeout=30)
                if "<hierarchy" in xml:
                    return xml
                last_err = "dump produced no hierarchy"
            except DeviceError as exc:
                last_err = str(exc)
            time.sleep(1.0)
        raise DeviceError(f"could not dump UI hierarchy: {last_err}")

    def _current_activity(self) -> tuple[str, str]:
        try:
            out = self._shell("dumpsys", "window", "displays", timeout=20)
            m = re.search(r"mCurrentFocus=.*?\{[^}]*?\s([\w.]+)/([\w.$]+)\}", out)
            if m:
                return m.group(1), m.group(2)
            out = self._shell("dumpsys", "activity", "activities", timeout=25)
            m = re.search(r"mResumedActivity.*?\s([\w.]+)/([\w.$]+)", out)
            if m:
                return m.group(1), m.group(2)
        except DeviceError:
            pass
        return "", ""

    # ---------------- actions ----------------

    def tap(self, target: str) -> TapResult:
        state = self.screen_state()
        node = resolve_or_raise(target, state.nodes)
        x, y = node.bounds.random_point()
        self._shell("input", "tap", str(x), str(y))
        return TapResult(
            target=target,
            x=x,
            y=y,
            matched=node.resource_id or node.text or node.content_desc or node.cls,
            bounds=node.bounds,
        )

    def type_text(self, text: str) -> str:
        """adb input only carries ASCII. Emoji and accents are dropped rather
        than silently mangled, and the caller logs what actually landed."""
        safe = _ascii_safe(text)
        for chunk in _chunks(safe, 180):
            self._shell("input", "text", _escape_for_input(chunk), timeout=45)
            time.sleep(0.15)
        return safe

    def key(self, keycode: str) -> None:
        self._shell("input", "keyevent", keycode)

    def swipe(self, direction: str, distance: float = 0.6) -> None:
        w, h = self.screen_size()
        if not w or not h:
            raise DeviceError("unknown screen size, cannot swipe")
        cx, cy = w // 2, h // 2
        span = int(h * distance / 2)
        hspan = int(w * distance / 2)
        vectors = {
            "up": (cx, cy + span, cx, cy - span),
            "down": (cx, cy - span, cx, cy + span),
            "left": (cx + hspan, cy, cx - hspan, cy),
            "right": (cx - hspan, cy, cx + hspan, cy),
        }
        if direction not in vectors:
            raise DeviceError(f"unknown swipe direction {direction!r}")
        x1, y1, x2, y2 = vectors[direction]
        self._shell("input", "swipe", str(x1), str(y1), str(x2), str(y2), "320")

    def push_media(self, local_path: str) -> str:
        ext = os.path.splitext(local_path)[1] or ".jpg"
        remote = posixpath.join(DEVICE_MEDIA_DIR, f"studio_{uuid.uuid4().hex[:8]}{ext}")
        self._shell("mkdir", "-p", DEVICE_MEDIA_DIR)
        self._adb("push", local_path, remote, timeout=180)
        self._index_media(remote)
        return remote

    def _index_media(self, remote: str) -> None:
        """Make the file visible to the gallery picker. MediaStore scan first
        (Android 10+), legacy broadcast second."""
        try:
            self._shell(
                "content",
                "call",
                "--uri",
                "content://media/external/file",
                "--method",
                "scan_file",
                "--arg",
                remote,
                timeout=30,
            )
            return
        except DeviceError:
            pass
        try:
            self._shell(
                "am",
                "broadcast",
                "-a",
                "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
                "-d",
                f"file://{remote}",
                timeout=30,
            )
        except DeviceError:
            pass

    def app_start(self, package: str) -> None:
        self._shell("monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1", timeout=40)

    def app_stop(self, package: str) -> None:
        self._shell("am", "force-stop", package)

    def current_package(self) -> str:
        return self._current_activity()[0]


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _parse_hierarchy(xml: str) -> list[UiNode]:
    start = xml.find("<hierarchy")
    if start == -1:
        return []
    end = xml.rfind("</hierarchy>")
    xml = xml[start : end + len("</hierarchy>")] if end != -1 else xml[start:]
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError:
        return []

    nodes: list[UiNode] = []
    for el in root.iter("node"):
        a = el.attrib
        try:
            bounds = Bounds.parse(a.get("bounds", ""))
        except ValueError:
            continue
        nodes.append(
            UiNode(
                resource_id=a.get("resource-id", ""),
                text=a.get("text", ""),
                content_desc=a.get("content-desc", ""),
                cls=a.get("class", ""),
                package=a.get("package", ""),
                clickable=a.get("clickable") == "true",
                enabled=a.get("enabled") != "false",
                focused=a.get("focused") == "true",
                bounds=bounds,
            )
        )
    return nodes


def _ascii_safe(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text)
    out = folded.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[ \t]+", " ", out).strip()


def _escape_for_input(text: str) -> str:
    out = text.replace("%", "%%").replace(" ", "%s")
    for ch in "()<>|;&*\\~\"'`$":
        out = out.replace(ch, "\\" + ch)
    return out


def _chunks(text: str, size: int):
    for i in range(0, len(text), size):
        yield text[i : i + size]
