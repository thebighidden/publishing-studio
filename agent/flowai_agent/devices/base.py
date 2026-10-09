from __future__ import annotations

import io
import random
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional

from PIL import Image


class DeviceError(RuntimeError):
    pass


class TargetNotFound(DeviceError):
    def __init__(self, target: str, tried: int = 0):
        super().__init__(f"named target {target!r} not found on screen ({tried} selectors tried)")
        self.target = target


@dataclass
class Bounds:
    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        return self.right - self.left

    @property
    def height(self) -> int:
        return self.bottom - self.top

    @property
    def area(self) -> int:
        return max(0, self.width) * max(0, self.height)

    def random_point(self, inset: float = 0.25) -> tuple[int, int]:
        """A random point inside the box, not the centre.

        Tapping the identical pixel every run is a detectable signature, so the
        box is shrunk towards the middle and a point is drawn from what is left.
        """
        dx = int(self.width * inset / 2)
        dy = int(self.height * inset / 2)
        lo_x, hi_x = self.left + dx, self.right - dx
        lo_y, hi_y = self.top + dy, self.bottom - dy
        if lo_x >= hi_x:
            lo_x = hi_x = (self.left + self.right) // 2
        if lo_y >= hi_y:
            lo_y = hi_y = (self.top + self.bottom) // 2
        return random.randint(lo_x, hi_x), random.randint(lo_y, hi_y)

    @classmethod
    def parse(cls, raw: str) -> "Bounds":
        m = re.findall(r"-?\d+", raw or "")
        if len(m) != 4:
            raise ValueError(f"bad bounds {raw!r}")
        return cls(*(int(v) for v in m))


@dataclass
class UiNode:
    resource_id: str = ""
    text: str = ""
    content_desc: str = ""
    cls: str = ""
    package: str = ""
    clickable: bool = False
    enabled: bool = True
    focused: bool = False
    bounds: Optional[Bounds] = None

    def haystack(self) -> str:
        return " ".join((self.resource_id, self.text, self.content_desc, self.cls)).lower()


@dataclass
class DeviceInfo:
    serial: str
    model: str = ""
    android: str = ""
    width: int = 0
    height: int = 0
    online: bool = False
    driver: str = "adb"


@dataclass
class TapResult:
    target: str
    x: int
    y: int
    matched: str = ""
    bounds: Optional[Bounds] = None


@dataclass
class ScreenState:
    package: str = ""
    activity: str = ""
    nodes: list[UiNode] = field(default_factory=list)

    def find_text(self, needle: str) -> Optional[UiNode]:
        n = needle.lower()
        for node in self.nodes:
            if n in (node.text or "").lower() or n in (node.content_desc or "").lower():
                return node
        return None

    def has_text(self, needle: str) -> bool:
        return self.find_text(needle) is not None


class DeviceDriver(ABC):
    """Everything the publishing engine is allowed to do to a phone.

    Taps are by *name*, never by coordinate (rule R6). The driver resolves a
    name to a box on the live screen and then picks a point inside it.
    """

    kind: str = "base"

    @abstractmethod
    def info(self) -> DeviceInfo: ...

    @abstractmethod
    def screenshot(self) -> bytes: ...

    @abstractmethod
    def screen_state(self) -> ScreenState: ...

    def live_frame(self) -> "Image.Image":
        """One frame for the live screen view. Read-only, so it is safe to call
        while a run is driving the phone. Drivers may override with something
        faster than a full PNG round trip."""
        return Image.open(io.BytesIO(self.screenshot()))

    @abstractmethod
    def tap(self, target: str) -> TapResult: ...

    @abstractmethod
    def type_text(self, text: str) -> str:
        """Returns the text actually delivered to the device."""

    @abstractmethod
    def key(self, keycode: str) -> None: ...

    @abstractmethod
    def swipe(self, direction: str, distance: float = 0.6) -> None: ...

    @abstractmethod
    def push_media(self, local_path: str) -> str: ...

    @abstractmethod
    def app_start(self, package: str) -> None: ...

    @abstractmethod
    def app_stop(self, package: str) -> None: ...

    def wait_for(self, target: str, timeout: float = 12.0, interval: float = 0.8):
        """Poll until a named target resolves. Returns the node, or None."""
        import time

        from .targets import resolve

        deadline = time.monotonic() + timeout
        last = None
        while time.monotonic() < deadline:
            try:
                state = self.screen_state()
            except DeviceError:
                # The screen could not be read this time (a busy screen can
                # defeat uiautomator); that is "not seen yet", not an answer.
                time.sleep(interval)
                continue
            node = resolve(target, state.nodes)
            if node is not None:
                return node
            last = state
            time.sleep(interval)
        return None

    def focused_input(self) -> Optional[dict]:
        """Focus as the keyboard sees it: {"package", "hint"} of the field it is
        serving in the app in front, or None. For apps that leave their text
        fields out of the UI dump. Drivers without such a source return None."""
        return None

    def close(self) -> None:  # pragma: no cover - most drivers are stateless
        pass
