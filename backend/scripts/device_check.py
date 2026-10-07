"""Exercise every DeviceDriver capability against a real device.

Run this after attaching a phone or emulator to prove the device layer works
there before trusting it with a publishing run:

    python -m scripts.device_check emulator-5554

It uses the studio's own AdbDriver rather than raw adb, so a pass means the
code the publisher depends on works on this device.
"""

from __future__ import annotations

import io
import sys
import tempfile
import time
from pathlib import Path

from PIL import Image

from app.devices.adb import AdbDriver
from app.devices.base import DeviceError

SETTINGS = "com.android.settings"


def check(name: str, fn):
    t0 = time.monotonic()
    try:
        detail = fn()
        ms = int((time.monotonic() - t0) * 1000)
        print(f"  PASS  {name:<22} {ms:>5}ms  {detail}")
        return True
    except Exception as exc:  # noqa: BLE001 - this is a diagnostic
        ms = int((time.monotonic() - t0) * 1000)
        print(f"  FAIL  {name:<22} {ms:>5}ms  {type(exc).__name__}: {exc}")
        return False


def main(serial: str) -> int:
    d = AdbDriver(serial)
    results: list[bool] = []
    print(f"\ndevice check against {serial}\n")

    def _info():
        i = d.info()
        if not i.online:
            raise DeviceError("device reports offline")
        return f"{i.model} android {i.android} {i.width}x{i.height}"

    results.append(check("info", _info))

    def _screenshot():
        png = d.screenshot()
        img = Image.open(io.BytesIO(png))
        return f"{img.size[0]}x{img.size[1]} {len(png) // 1024}KB"

    results.append(check("screenshot", _screenshot))

    def _state():
        st = d.screen_state()
        if not st.nodes:
            raise DeviceError("hierarchy came back empty")
        return f"{len(st.nodes)} nodes in {st.package}"

    results.append(check("screen_state", _state))

    def _start():
        d.app_start(SETTINGS)
        time.sleep(3)
        pkg = d.current_package()
        if SETTINGS not in pkg:
            raise DeviceError(f"expected {SETTINGS}, foreground is {pkg!r}")
        return pkg

    results.append(check("app_start", _start))

    def _swipe():
        d.swipe("up", 0.4)
        time.sleep(1)
        return "scrolled up"

    results.append(check("swipe", _swipe))

    # Type into Settings search, then read it back off the screen. This is the
    # round trip that matters: a caption is worthless if it does not land.
    typed = "publishing studio"

    def _focused_field():
        for n in d.screen_state().nodes:
            if n.focused and "edittext" in (n.cls or "").lower():
                return n
        return None

    def _type():
        st = d.screen_state()
        field = next(
            (n for n in st.nodes if "EditText" in (n.cls or "")),
            None,
        ) or next(
            (n for n in st.nodes if "search" in (n.haystack() or "")),
            None,
        )
        if field is None or not field.bounds:
            raise DeviceError("no search field found on the Settings screen")
        x, y = field.bounds.random_point()
        d._shell("input", "tap", str(x), str(y))

        # Wait for focus rather than sleeping a fixed amount. Settings' search
        # box lives in a separate activity that cold-starts slowly, and typing
        # before it has focus throws the keystrokes away with no error at all.
        deadline = time.monotonic() + 10
        target = _focused_field()
        while target is None and time.monotonic() < deadline:
            time.sleep(0.4)
            target = _focused_field()
        if target is None:
            raise DeviceError("tapped the search bar but no field took focus within 10s")

        delivered = d.type_text(typed)
        landed = _focused_field()
        got = (landed.text or "") if landed else ""
        if typed.lower() not in got.lower():
            raise DeviceError(f"typed {delivered!r} but the field shows {got!r}")
        return f"typed and read back {delivered!r}"

    results.append(check("type_text + readback", _type))

    def _key():
        d.key("KEYCODE_BACK")
        time.sleep(1)
        return "sent KEYCODE_BACK"

    results.append(check("key", _key))

    # push_media is the one that silently breaks publishing: the file lands but
    # the gallery never indexes it, so the picker shows nothing.
    def _push():
        img = Image.new("RGB", (1080, 1080), (33, 120, 180))
        local = str(Path(tempfile.gettempdir()) / "device_check_asset.jpg")
        img.save(local, quality=90)
        remote = d.push_media(local)
        listing = d._shell("ls", "-l", remote)
        if "No such file" in listing:
            raise DeviceError(f"{remote} is not on the device")
        found = d._shell(
            "content",
            "query",
            "--uri",
            "content://media/external/images/media",
            "--projection",
            "_data",
        )
        # MediaStore reports the real path; /sdcard is only a symlink to it, so
        # compare on the basename or this silently reads as "not indexed".
        indexed = remote.rsplit("/", 1)[-1] in found
        if not indexed:
            raise DeviceError(
                f"{remote} is on disk but MediaStore has not indexed it — "
                "the gallery picker will not show it"
            )
        return f"pushed to {remote}, indexed in MediaStore"

    results.append(check("push_media", _push))

    def _stop():
        d.app_stop(SETTINGS)
        time.sleep(2)
        return "force-stopped settings"

    results.append(check("app_stop", _stop))

    passed, total = sum(results), len(results)
    print(f"\n{passed}/{total} checks passed\n")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "emulator-5554"))
