"""Install an app from the Play Store by driving the store UI over ADB.

Used to get Instagram and X onto a device without sideloading an APK, so the
build under test is the real one the publisher will drive:

    python -m scripts.store_install emulator-5554 com.instagram.android

Assumes a Google account is already signed in on the device.
"""

from __future__ import annotations

import sys
import time

from app.devices.adb import AdbDriver

STORE = "com.android.vending"


def _labelled(driver: AdbDriver, words: set[str]):
    """Find a clickable node whose text or description is one of `words`."""
    for n in driver.screen_state().nodes:
        label = (n.text or n.content_desc or "").strip().lower()
        if label in words and n.bounds:
            return n, label
    return None, ""


def installed(driver: AdbDriver, pkg: str) -> bool:
    out = driver._shell("pm", "list", "packages", pkg)
    return f"package:{pkg}" in out


def install(serial: str, pkg: str, timeout: float = 600.0) -> int:
    d = AdbDriver(serial)

    if installed(d, pkg):
        print(f"{pkg} is already installed")
        return 0

    d._shell("am", "start", "-a", "android.intent.action.VIEW", "-d", f"market://details?id={pkg}")
    time.sleep(6)

    # Find and press Install. The button is sometimes a plain TextView with the
    # click handled by a parent, so fall back to tapping the label's centre.
    node, label = _labelled(d, {"install", "update"})
    if node is None:
        raise SystemExit(f"no Install button on the store page for {pkg}")
    x, y = node.bounds.random_point()
    d._shell("input", "tap", str(x), str(y))
    print(f"pressed {label!r} for {pkg}")

    # Wait on the package list, not on the progress bar: the UI shows "Open"
    # before the install is fully registered with the package manager.
    deadline = time.monotonic() + timeout
    last = ""
    while time.monotonic() < deadline:
        if installed(d, pkg):
            print(f"{pkg} installed")
            return 0
        time.sleep(5)
        _, state = _labelled(d, {"install", "cancel", "open", "play"})
        if state and state != last:
            print(f"  ... store shows {state!r}")
            last = state
    raise SystemExit(f"{pkg} did not finish installing within {timeout:.0f}s")


if __name__ == "__main__":
    serial = sys.argv[1] if len(sys.argv) > 1 else "emulator-5554"
    packages = sys.argv[2:] or ["com.instagram.android", "com.twitter.android"]
    for p in packages:
        install(serial, p)
