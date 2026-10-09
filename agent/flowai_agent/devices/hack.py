"""The hackathon's remote phone, driven over its HTTP API (hackapi.py) instead of adb.

It shows up on FlowAI's Phones page like a USB phone: registered by the agent, with a live
screen and remote control in the dashboard. What the API offers is narrower than adb, so this
driver says plainly what it can't do rather than pretending:

- no element-by-element screen reading, so the publishing recipes (which find buttons by name
  in the UI tree) can't run here; taps by position or by the team's own named targets work;
- swipes by direction only (short, medium or long), keys from a fixed list, typing in ASCII;
- one screenshot a second for the team, so the live view relays the API's shared live feed
  (/phone/live, a frame every second or two) instead of taking screenshots of its own.

The phone's ref in FlowAI is "hack-<device_id>", e.g. hack-heracles-phone.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import threading
import time
from pathlib import Path
from typing import Iterator, Optional

import httpx
from PIL import Image

from .. import config
from ..hackapi import HackApiError, HackPhone
from .base import DeviceDriver, DeviceError, DeviceInfo, ScreenState, TapResult

log = logging.getLogger("flowai.hack")

PREFIX = "hack-"
# FlowAI's key names (adb keycodes) -> the API's.
KEYS = {
    "KEYCODE_BACK": "back", "KEYCODE_HOME": "home", "KEYCODE_ENTER": "enter", "KEYCODE_TAB": "tab",
    "KEYCODE_ESCAPE": "esc", "KEYCODE_SEARCH": "search", "KEYCODE_VOLUME_UP": "volume_up", "KEYCODE_VOLUME_DOWN": "volume_down",
}
API_KEYS = set(KEYS.values())


def configured() -> bool:
    return bool(config.HACK_API_BASE and config.HACK_TEAM_KEY)


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except HackApiError as exc:
        raise DeviceError(str(exc)) from exc
    except httpx.HTTPError as exc:
        raise DeviceError(f"can't reach the hackathon phone API: {exc}") from exc


def discover() -> Optional[dict]:
    """The team's phone, as the agent registers it with FlowAI, or None when it's offline."""
    if not configured():
        return None
    try:
        with HackPhone() as phone:
            status = _call(phone.status)
    except DeviceError as exc:
        log.warning("hackathon phone: %s", exc)
        return None
    if not status.get("online"):
        return None
    screen = status.get("screen") or {}
    device_id = status.get("device_id") or "phone"
    return {"ref": f"{PREFIX}{device_id}", "name": device_id, "model": "Hackathon phone", "android": None,
            "width": screen.get("w"), "height": screen.get("h"), "kind": "remote"}


class HackDriver(DeviceDriver):
    kind = "hack"

    def __init__(self, ref: str):
        self.ref = ref
        self.phone = _call(HackPhone)
        self._size: Optional[tuple[int, int]] = None

    def info(self) -> DeviceInfo:
        status = _call(self.phone.status)
        screen = status.get("screen") or {}
        return DeviceInfo(serial=self.ref, model="Hackathon phone", width=screen.get("w", 0), height=screen.get("h", 0),
                          online=bool(status.get("online")), driver="hack")

    def screen_size(self) -> tuple[int, int]:
        if self._size is None:
            geometry = _call(self.phone.geometry)
            self._size = (int(geometry.get("w") or 0), int(geometry.get("h") or 0))
        return self._size

    def screenshot(self) -> bytes:
        return _call(self.phone.screenshot, "png")

    def live_frame(self) -> Image.Image:
        return Image.open(io.BytesIO(_call(self.phone.screenshot, "jpeg", 900)))

    def screen_state(self) -> ScreenState:
        raise DeviceError("the hackathon phone can't be read element by element (no UI tree in its API), "
                          "so publishing recipes can't run on it")

    def tap(self, target: str) -> TapResult:
        result = _call(self.phone.tap, target=target) or {}
        return TapResult(target=target, x=int(result.get("x") or 0), y=int(result.get("y") or 0), matched=target)

    def tap_at(self, x: int, y: int, hold_ms: int = 0) -> None:
        if hold_ms:
            _call(self.phone.long_press, x=x, y=y, ms=max(500, min(5000, hold_ms)))
        else:
            _call(self.phone.tap, x=x, y=y)

    def type_text(self, text: str) -> str:
        # The API takes printable ASCII on one line; anything else would be refused whole.
        clean = "".join(c for c in text if 32 <= ord(c) < 127)
        if clean:
            _call(self.phone.type_text, clean)
        return clean

    def key(self, keycode: str) -> None:
        name = KEYS.get(keycode, keycode.lower())
        if name not in API_KEYS:
            raise DeviceError(f"the hackathon phone has no {keycode.removeprefix('KEYCODE_').lower()} key; it has {', '.join(sorted(API_KEYS))}")
        _call(self.phone.key, name)

    def swipe(self, direction: str, distance: float = 0.6) -> None:
        _call(self.phone.swipe, direction, "short" if distance < 0.35 else "medium" if distance < 0.65 else "long")

    def push_media(self, local_path: str) -> str:
        result = _call(self.phone.upload_media, Path(local_path)) or {}
        return str(result.get("path") or result.get("name") or local_path)

    def app_start(self, package: str) -> None:
        _call(self.phone.app_start, package)

    def app_stop(self, package: str) -> None:
        _call(self.phone.app_stop, package)

    def close(self) -> None:
        self.phone.close()


class LiveRelay:
    """One connection to the API's live feed, shared by every viewer in the dashboard.

    The team may only have a few live streams open, so viewers don't each open their own: the
    relay connects when the first viewer arrives, hands each new frame to all of them, and
    disconnects shortly after the last one leaves.
    """

    # The feed only sends a frame when the screen changes, so a quiet phone sends nothing. Then
    # the relay takes a screenshot itself, at most this often (the team gets one a second).
    QUIET_SECONDS = 6.0

    def __init__(self) -> None:
        self.cond = threading.Condition()
        self.frame: Optional[bytes] = None
        self.at = 0.0
        self.seq = 0
        self.viewers = 0
        self.thread: Optional[threading.Thread] = None
        self.snap_lock = threading.Lock()

    def frames(self) -> Iterator[bytes]:
        with self.cond:
            self.viewers += 1
            if self.thread is None or not self.thread.is_alive():
                self.thread = threading.Thread(target=self._pump, name="hack-live", daemon=True)
                self.thread.start()
        try:
            seen = -1
            while True:
                with self.cond:
                    self.cond.wait_for(lambda: self.seq != seen, timeout=self.QUIET_SECONDS)
                    frame, seen = self.frame, self.seq
                if frame is None or time.monotonic() - self.at > self.QUIET_SECONDS:
                    frame = self._snapshot() or frame
                if frame:
                    yield frame  # repeated when nothing changed, which keeps the browser's stream alive
        finally:
            with self.cond:
                self.viewers -= 1

    def _snapshot(self) -> Optional[bytes]:
        """A screenshot when the feed is quiet; shared, so several viewers still cost one."""
        with self.snap_lock:
            if self.frame is not None and time.monotonic() - self.at <= self.QUIET_SECONDS:
                return self.frame  # another viewer just took one
            try:
                with HackPhone() as phone:
                    jpeg = _call(phone.screenshot, "jpeg", 900)
            except DeviceError as exc:
                log.info("hackathon screenshot skipped: %s", exc)
                return None
            with self.cond:
                self.frame, self.at = jpeg, time.monotonic()
            return jpeg

    def _pump(self) -> None:
        headers = {"Authorization": f"Bearer {config.HACK_TEAM_KEY}", "Accept": "text/event-stream"}
        while True:
            with self.cond:
                if self.viewers <= 0:
                    return
            try:
                with httpx.stream("GET", config.HACK_API_BASE + "/phone/live", headers=headers, verify=False,
                                  timeout=httpx.Timeout(30.0, read=60.0)) as r:
                    if r.status_code >= 400:
                        raise DeviceError(f"live feed answered {r.status_code}")
                    event = ""
                    for line in r.iter_lines():
                        if line.startswith("event:"):
                            event = line[6:].strip()
                        elif line.startswith("data:") and event == "frame":
                            jpeg = base64.b64decode(json.loads(line[5:])["jpeg_b64"])
                            with self.cond:
                                self.frame, self.at, self.seq = jpeg, time.monotonic(), self.seq + 1
                                self.cond.notify_all()
                                if self.viewers <= 0:
                                    return
            except (httpx.HTTPError, DeviceError, ValueError, KeyError) as exc:
                log.info("hackathon live feed dropped (%s); reconnecting", exc)
            time.sleep(2)


relay = LiveRelay()
