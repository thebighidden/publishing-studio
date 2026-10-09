"""Find every Android device this computer could drive, and what each one needs.

    connected   adb sees it: a USB phone, a phone on Wi-Fi, or a running emulator, with its state
                (ready, waiting for "Allow USB debugging", offline) and whether it's already working
    nearby      phones on this network with Wireless debugging on (mDNS), not connected yet:
                one tap connects a paired phone; a new one needs the pairing code shown on it
    emulators   Android Studio emulators installed here but not running, which can be started

Everything here is local to the agent's computer; the dashboard asks through the live-view server.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

from . import config
from .devices import adb
from .devices.base import DeviceError

_EMULATOR_SERIAL = re.compile(r"^emulator-\d+$")
_WIFI_SERIAL = re.compile(r"^(\d{1,3}\.){3}\d{1,3}:\d+$|\._adb-tls-connect\._tcp")
_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

STATES = {
    "device": ("ready", "Connected and ready."),
    "unauthorized": ("needs-allow", "Unlock the phone and tap Allow on the “Allow USB debugging?” prompt."),
    "offline": ("offline", "adb sees it but can’t talk to it. Unplug and plug it back in, or restart adb."),
    "authorizing": ("needs-allow", "Waiting for you to allow USB debugging on the phone."),
    "no permissions": ("offline", "This computer has no permission to use the device (USB driver or udev rules)."),
    "recovery": ("offline", "The phone is in recovery mode."),
    "sideload": ("offline", "The phone is in sideload mode."),
    "bootloader": ("offline", "The phone is in bootloader mode."),
}


def connection_of(serial: str) -> str:
    if _EMULATOR_SERIAL.match(serial):
        return "emulator"
    if _WIFI_SERIAL.search(serial):
        return "wifi"
    return "usb"


def _adb_lines(args: list[str], timeout: int = 15) -> list[str]:
    try:
        return adb._run(args, timeout=timeout).splitlines()
    except DeviceError:
        return []


def connected(working: set[str], details: dict[str, Any]) -> list[dict[str, Any]]:
    """Every device in `adb devices -l`, whatever its state."""
    found = []
    for line in _adb_lines(["devices", "-l"])[1:]:
        parts = line.split()
        if len(parts) < 2:
            continue
        serial = parts[0]
        # "no permissions" is two words; the rest of the line is key:value pairs.
        rest = line[len(serial):].strip()
        state = next((s for s in STATES if rest.startswith(s)), parts[1])
        props = dict(p.split(":", 1) for p in parts[2:] if ":" in p)
        status, hint = STATES.get(state, ("offline", f"adb reports it as “{state}”."))
        info = details.get(serial)
        if status == "ready" and info is None:
            try:
                info = details[serial] = adb.AdbDriver(serial).info()
            except DeviceError:
                info = None
        name = (info.model if info and info.model else props.get("model", "").replace("_", " ")) or serial
        if connection_of(serial) == "emulator":
            avd = _emulator_avd(serial)
            name = f"Emulator · {avd}" if avd else "Android emulator"
        found.append({
            "serial": serial,
            "name": name,
            "connection": connection_of(serial),
            "status": status,
            "hint": hint,
            "android": info.android if info else None,
            "screen": [info.width, info.height] if info and info.width else None,
            "working": serial in working,
        })
    return found


def _emulator_avd(serial: str) -> str:
    lines = [line.strip() for line in _adb_lines(["-s", serial, "emu", "avd", "name"], timeout=5)]
    return next((line for line in lines if line and line != "OK"), "")


def nearby(connected_serials: set[str]) -> list[dict[str, Any]]:
    """Phones advertising Wireless debugging on this network (adb's mDNS discovery)."""
    services = []
    for line in _adb_lines(["mdns", "services"], timeout=10)[1:]:
        parts = line.split()
        if len(parts) < 3:
            continue
        instance, kind, address = parts[0], parts[1], parts[-1]
        if "_adb-tls-connect" in kind:
            if instance in connected_serials or address in connected_serials or any(instance in s for s in connected_serials):
                continue
            services.append({"name": instance, "address": address, "action": "connect",
                             "hint": "Paired before: connect it in one tap."})
        elif "_adb-tls-pairing" in kind:
            services.append({"name": instance, "address": address, "action": "pair",
                             "hint": "On the phone: Wireless debugging → Pair device with pairing code, then enter the 6-digit code."})
    return services


def _emulator_binary() -> Optional[str]:
    candidates = [
        os.environ.get("FLOWAI_EMULATOR", ""),
        shutil.which("emulator") or "",
        str(Path(os.environ.get("ANDROID_HOME", "")) / "emulator" / "emulator.exe"),
        str(Path(os.environ.get("ANDROID_SDK_ROOT", "")) / "emulator" / "emulator.exe"),
        str(Path(os.environ.get("LOCALAPPDATA", "")) / "Android" / "Sdk" / "emulator" / "emulator.exe"),
        str(Path.home() / "Android" / "Sdk" / "emulator" / "emulator"),
        str(Path.home() / "Library" / "Android" / "sdk" / "emulator" / "emulator"),
    ]
    return next((c for c in candidates if c and os.path.isfile(c)), None)


def emulators(running_names: set[str]) -> dict[str, Any]:
    """Installed Android Studio emulators that aren't running."""
    binary = _emulator_binary()
    if not binary:
        return {"available": False, "avds": [],
                "hint": "No Android emulator on this computer. Install Android Studio and create a device with a Play Store image (Instagram needs Google Play)."}
    try:
        out = subprocess.run([binary, "-list-avds"], capture_output=True, timeout=20, creationflags=_NO_WINDOW).stdout.decode(errors="replace")
    except (OSError, subprocess.TimeoutExpired):
        out = ""
    avds = [line.strip() for line in out.splitlines() if line.strip() and not line.startswith(("INFO", "WARNING"))]
    return {"available": True, "avds": [{"name": a, "running": a in running_names} for a in avds],
            "hint": "Use a system image with Google Play, so Instagram and X can be installed."}


def scan(working: set[str], details: dict[str, Any]) -> dict[str, Any]:
    if not adb.adb_available():
        return {"adb": False, "adb_path": config.ADB_PATH, "connected": [], "nearby": [],
                "emulators": emulators(set()), "simulated": config.SIMULATED_PHONES,
                "hint": "adb isn’t installed. Get Android platform-tools from developer.android.com/tools/releases/platform-tools, or set FLOWAI_ADB."}
    devices = connected(working, details)
    serials = {d["serial"] for d in devices}
    running_avds = {d["name"].removeprefix("Emulator · ") for d in devices if d["connection"] == "emulator"}
    return {"adb": True, "adb_path": config.ADB_PATH, "connected": devices, "nearby": nearby(serials),
            "emulators": emulators(running_avds), "simulated": config.SIMULATED_PHONES, "hint": None}


def connect(address: str) -> str:
    return adb.connect_wireless(address)


def pair(address: str, code: str, connect_address: Optional[str] = None) -> str:
    out = adb.pair_wireless(address, code)
    if connect_address:
        out += "\n" + adb.connect_wireless(connect_address)
    return out


def start_emulator(name: str) -> str:
    binary = _emulator_binary()
    if not binary:
        raise DeviceError("No Android emulator on this computer.")
    if name not in [a["name"] for a in emulators(set())["avds"]]:
        raise DeviceError(f"No emulator named {name!r}.")
    subprocess.Popen([binary, "-avd", name, "-no-snapshot-save"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     creationflags=_NO_WINDOW)
    return f"Starting {name}. It appears once Android has booted (about a minute)."


def restart_adb() -> str:
    _adb_lines(["kill-server"], timeout=10)
    _adb_lines(["start-server"], timeout=20)
    return "adb restarted."
