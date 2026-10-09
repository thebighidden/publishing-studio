"""Operator remote control: touch and drag by screen position.

Deliberately not part of DeviceDriver. Recipes only ever see the driver, and
rule R6 says they tap named targets, never coordinates. A person clicking on
the live view is a different case — they are looking at the screen and aiming
themselves — so it lives here, reachable only from the phone console API.

Positions arrive as fractions of the frame (0..1) so the browser never needs
the device resolution, and the downscaled live stream maps back exactly.
"""

from __future__ import annotations

import time

from .adb import AdbDriver
from .base import DeviceDriver, DeviceError
from .hack import HackDriver
from .simulator import H as SIM_H
from .simulator import W as SIM_W
from .simulator import SimulatorDriver


def _size(driver: DeviceDriver, landscape: bool) -> tuple[int, int]:
    if isinstance(driver, (AdbDriver, HackDriver)):
        w, h = driver.screen_size()
    else:
        w, h = SIM_W, SIM_H
    if not w or not h:
        raise DeviceError("unknown screen size, cannot place a touch")
    # `wm size` reports the natural (portrait) size; input coordinates follow
    # the current rotation, which the frame's own shape tells us.
    if (w > h) != landscape:
        w, h = h, w
    return w, h


def _point(driver: DeviceDriver, fx: float, fy: float, landscape: bool) -> tuple[int, int]:
    w, h = _size(driver, landscape)
    return min(w - 1, max(0, round(fx * w))), min(h - 1, max(0, round(fy * h)))


def touch(driver: DeviceDriver, fx: float, fy: float, landscape: bool = False, hold_ms: int = 0) -> tuple[int, int]:
    """A tap, or a long press when hold_ms is set."""
    x, y = _point(driver, fx, fy, landscape)
    if isinstance(driver, AdbDriver):
        if hold_ms:
            driver._shell("input", "swipe", str(x), str(y), str(x), str(y), str(hold_ms))
        else:
            driver._shell("input", "tap", str(x), str(y))
    elif isinstance(driver, SimulatorDriver):
        _simulator_touch(driver, x, y)
    elif isinstance(driver, HackDriver):
        driver.tap_at(x, y, hold_ms)
    else:
        raise DeviceError(f"{driver.kind} does not support remote touch")
    return x, y


def drag(
    driver: DeviceDriver,
    start: tuple[float, float],
    end: tuple[float, float],
    duration_ms: int,
    landscape: bool = False,
) -> None:
    x1, y1 = _point(driver, *start, landscape)
    x2, y2 = _point(driver, *end, landscape)
    if isinstance(driver, AdbDriver):
        driver._shell("input", "swipe", str(x1), str(y1), str(x2), str(y2), str(duration_ms))
    elif isinstance(driver, SimulatorDriver):
        time.sleep(0.08)  # the simulator's screens do not scroll
    elif isinstance(driver, HackDriver):
        # Its API swipes by direction only: the drag's main direction, and how far it went.
        dx, dy = end[0] - start[0], end[1] - start[1]
        if abs(dx) < 0.02 and abs(dy) < 0.02:
            driver.tap_at(x1, y1)
            return
        # A finger dragged upwards scrolls the content up: that's an "up" swipe.
        direction = ("left" if dx < 0 else "right") if abs(dx) > abs(dy) else ("up" if dy < 0 else "down")
        driver.swipe(direction, max(abs(dx), abs(dy)))
    else:
        raise DeviceError(f"{driver.kind} does not support remote drag")


def _simulator_touch(driver: SimulatorDriver, x: int, y: int) -> None:
    """Hit-test like Android does: the smallest clickable box under the finger."""
    hits = [
        n
        for n in driver.phone.nodes()
        if n.clickable and n.box[0] <= x < n.box[2] and n.box[1] <= y < n.box[3]
    ]
    time.sleep(0.12)
    if hits:
        driver.phone.tap_node(min(hits, key=lambda n: (n.box[2] - n.box[0]) * (n.box[3] - n.box[1])))
