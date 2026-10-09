"""The live view the FlowAI dashboard opens on a phone: its screen as MJPEG, and touch, swipe,
keys and typing sent back. Served by the agent on this computer, because the phone is here.

Every request carries the agent token (?token= or X-Agent-Token), the same one FlowAI shows on
its Phones page. Control is refused while a publishing run is driving the phone: a person and
a recipe tapping at once would make the run's record meaningless.
"""

from __future__ import annotations

import io
import json
import logging
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Optional
from urllib.parse import parse_qs, urlparse

from PIL import Image

from . import config
from . import scan as scanner
from .devices import remote
from .devices.base import DeviceError

log = logging.getLogger("flowai.mirror")

KEYS = {
    "back": "KEYCODE_BACK", "home": "KEYCODE_HOME", "recents": "KEYCODE_APP_SWITCH", "power": "KEYCODE_POWER",
    "volume_up": "KEYCODE_VOLUME_UP", "volume_down": "KEYCODE_VOLUME_DOWN", "enter": "KEYCODE_ENTER", "delete": "KEYCODE_DEL",
}


class Mirror:
    def __init__(
        self,
        phones: Callable[[], list[str]],
        locks: dict[str, threading.Lock],
        driver_for: Callable,
        details: Optional[dict] = None,
        on_change: Callable[[], None] = lambda: None,
    ):
        self.phones = phones
        self.locks = locks
        self.driver_for = driver_for
        self.details = details if details is not None else {}
        # Called after a scan action (connect, pair, start an emulator…) so the agent
        # re-registers its phones with FlowAI right away instead of at the next check-in.
        self.on_change = on_change
        self.server: Optional[ThreadingHTTPServer] = None

    def start(self) -> None:
        mirror = self

        class Handler(_Handler):
            ctx = mirror

        self.server = ThreadingHTTPServer((config.MIRROR_HOST, config.MIRROR_PORT), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, name="mirror", daemon=True).start()
        log.info("live view on http://%s:%s (dashboard uses %s)", config.MIRROR_HOST, config.MIRROR_PORT, config.MIRROR_PUBLIC_URL)

    def jpeg(self, ref: str, max_side: int = 900) -> bytes:
        img: Image.Image = self.driver_for(ref).live_frame().convert("RGB")
        img.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=72)
        return buf.getvalue()


class _Handler(BaseHTTPRequestHandler):
    ctx: Mirror
    server_version = "FlowAIAgent/1"

    def log_message(self, fmt, *args):  # quiet: a stream is many requests
        log.debug(fmt, *args)

    # ---------------- plumbing ----------------

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Agent-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorized(self) -> bool:
        query = parse_qs(urlparse(self.path).query)
        token = self.headers.get("X-Agent-Token") or (query.get("token") or [""])[0]
        if config.AGENT_TOKEN and token == config.AGENT_TOKEN:
            return True
        self._json(401, {"message": "The live view needs the agent token."})
        return False

    def _route(self) -> tuple[str, str]:
        parts = [p for p in urlparse(self.path).path.split("/") if p]
        # /phones/{ref}/{action}
        if len(parts) == 3 and parts[0] == "phones":
            return parts[1], parts[2]
        return "", "/".join(parts)

    def _known(self, ref: str) -> bool:
        if ref in self.ctx.phones():
            return True
        self._json(404, {"message": f"No phone {ref} on this computer."})
        return False

    def do_OPTIONS(self) -> None:  # CORS preflight from the dashboard
        self.send_response(204)
        self._cors()
        self.end_headers()

    # ---------------- view ----------------

    def do_GET(self) -> None:
        ref, action = self._route()
        if action == "health":
            self._json(200, {"ok": True, "phones": self.ctx.phones()})
            return
        if action == "scan":
            if self._authorized():
                self._json(200, scanner.scan(set(self.ctx.phones()), self.ctx.details))
                self.ctx.on_change()  # register anything new with FlowAI now, not at the next check-in
            return
        if not self._authorized() or not self._known(ref):
            return
        try:
            if action == "frame.jpg":
                data = self.ctx.jpeg(ref)
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            elif action == "stream.mjpeg":
                self._stream(ref)
            else:
                self._json(404, {"message": "unknown view"})
        except DeviceError as exc:
            self._json(502, {"message": str(exc)})
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _stream(self, ref: str) -> None:
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        frames = _frames(self.ctx, ref)
        try:
            for jpeg in frames:
                self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n")
        finally:
            frames.close()

    # ---------------- control ----------------

    def _scan_action(self, action: str, body: dict) -> None:
        """Connect, pair, start an emulator, restart adb, or switch the agent's simulator."""
        try:
            if action == "scan/connect":
                message = scanner.connect(str(body["address"]))
            elif action == "scan/pair":
                message = scanner.pair(str(body["address"]), str(body["code"]), body.get("connect_address"))
            elif action == "scan/emulator":
                message = scanner.start_emulator(str(body["name"]))
            elif action == "scan/restart-adb":
                message = scanner.restart_adb()
            elif action == "scan/simulator":
                message = config.set_simulated(bool(body.get("enabled")))
            else:
                self._json(404, {"message": "unknown scan action"})
                return
        except KeyError as exc:
            self._json(422, {"message": f"missing {exc.args[0]}"})
            return
        except DeviceError as exc:
            self._json(422, {"message": str(exc)})
            return
        self.ctx.on_change()
        self._json(200, {"ok": True, "message": message})

    def do_POST(self) -> None:
        ref, action = self._route()
        if not self._authorized():
            return
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            self._json(422, {"message": "body must be JSON"})
            return
        if action.startswith("scan/"):
            self._scan_action(action, body)
            return
        if not self._known(ref):
            return
        lock = self.ctx.locks.setdefault(ref, threading.Lock())
        if not lock.acquire(blocking=False):
            self._json(409, {"message": "A publishing run is driving this phone. Watch, but don't touch, until it ends."})
            return
        try:
            driver = self.ctx.driver_for(ref)
            landscape = bool(body.get("landscape"))
            if action == "touch":
                x, y = remote.touch(driver, float(body["x"]), float(body["y"]), landscape, int(body.get("hold_ms") or 0))
                self._json(200, {"ok": True, "x": x, "y": y})
            elif action == "swipe":
                remote.drag(driver, (float(body["x1"]), float(body["y1"])), (float(body["x2"]), float(body["y2"])), int(body.get("ms") or 300), landscape)
                self._json(200, {"ok": True})
            elif action == "key":
                key = KEYS.get(str(body.get("key", "")).lower())
                if not key:
                    self._json(422, {"message": f"unknown key; use one of {', '.join(KEYS)}"})
                    return
                driver.key(key)
                self._json(200, {"ok": True})
            elif action == "text":
                delivered = driver.type_text(str(body.get("text", ""))[:500])
                self._json(200, {"ok": True, "typed": len(delivered)})
            else:
                self._json(404, {"message": "unknown control"})
        except (KeyError, TypeError, ValueError):
            self._json(422, {"message": "missing or bad coordinates"})
        except DeviceError as exc:
            self._json(502, {"message": str(exc)})
        finally:
            lock.release()


def _frames(mirror: Mirror, ref: str):
    """JPEG frames: scrcpy's hardware-encoded stream when scrcpy is installed (up to 30 fps),
    otherwise screenshots (about 1-2 fps over USB). Stops when the viewer leaves."""
    if ref.startswith("hack-"):
        # The hackathon phone has its own shared live feed; screenshots are rationed to one a second.
        from .devices import hack

        yield from hack.relay.frames()
        return
    if not ref.startswith("sim-"):
        from .devices import scrcpy

        if scrcpy.available():
            session = None
            try:
                session = scrcpy.ScrcpySession.open(ref, max_size=900, max_fps=24)
                seq = -1
                while True:
                    seq, jpeg = session.next_frame(seq, timeout=5.0)
                    if jpeg:  # nothing yet right after connecting
                        yield jpeg
            except DeviceError as exc:
                log.info("scrcpy stream for %s ended (%s); falling back to screenshots", ref, exc)
            finally:
                if session is not None:
                    session.close()
    while True:
        started = time.monotonic()
        yield mirror.jpeg(ref)
        time.sleep(max(0.0, 0.4 - (time.monotonic() - started)))
