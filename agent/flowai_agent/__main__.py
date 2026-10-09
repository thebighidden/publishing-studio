"""FlowAI phone agent.

    python -m flowai_agent                 run: register phones, serve the live view, publish jobs
    python -m flowai_agent phones          list the phones adb sees, and whether they're ready
    python -m flowai_agent scan            every device: USB, Wi-Fi, nearby, emulators, and what each needs
    python -m flowai_agent prepare SERIAL  animations off and Gboard on, so automation works
    python -m flowai_agent connect HOST:PORT [CODE] [PAIR_PORT]   wireless debugging
    python -m flowai_agent screenshot SERIAL [FILE]
"""

from __future__ import annotations

import logging
import platform
import socket
import sys
import threading
import time
from typing import Any

from . import config
from . import scan as scanner
from .api import ApiError, FlowAI
from .devices import adb, hack
from .devices.base import DeviceError
from .mirror import Mirror
from .worker import PhoneWorker, driver_for

log = logging.getLogger("flowai.agent")
AGENT_VERSION = "1.1"

_details: dict[str, Any] = {}


def discover() -> list[dict[str, Any]]:
    """Every phone this computer can drive: adb devices that are online, plus simulated ones."""
    phones: list[dict[str, Any]] = []
    if adb.adb_available():
        for listed in adb.list_devices():
            if not listed.online:
                continue
            info = _details.get(listed.serial)
            if info is None:  # asked once per phone: model, Android version, screen size
                try:
                    info = _details[listed.serial] = adb.AdbDriver(listed.serial).info()
                except DeviceError:
                    info = listed
            is_emulator = scanner.connection_of(listed.serial) == "emulator"
            phones.append({"ref": listed.serial, "name": (f"Emulator {listed.serial[9:]}" if is_emulator else None) or info.model or listed.model or listed.serial,
                           "model": info.model or listed.model, "android": info.android, "width": info.width, "height": info.height,
                           "kind": "emulator" if is_emulator else "adb"})
    else:
        log.warning("adb not found (%s). Install Android platform-tools or set FLOWAI_ADB.", config.ADB_PATH)
    for ref in config.SIMULATED_PHONES:
        ref = ref if ref.startswith("sim-") else f"sim-{ref}"
        info = driver_for(ref).info()
        phones.append({"ref": ref, "name": f"Simulator {ref[4:]}", "model": info.model, "android": info.android,
                       "width": info.width, "height": info.height, "kind": "simulator"})
    # The hackathon's remote phone, when agent/.env has its API base and team key.
    remote = hack.discover()
    if remote:
        phones.append(remote)
    return phones


def agent_info() -> dict[str, Any]:
    """What the dashboard shows about this agent, and how it knows where to scan."""
    from .devices import scrcpy

    return {"host": socket.gethostname(), "os": platform.system(), "version": AGENT_VERSION,
            "adb": adb.adb_available(), "scrcpy": scrcpy.available()}


def run() -> int:
    api = FlowAI()
    workers: dict[str, PhoneWorker] = {}
    locks: dict[str, threading.Lock] = {}
    wake = threading.Event()
    mirror = Mirror(phones=lambda: list(workers), locks=locks, driver_for=driver_for, details=_details, on_change=wake.set)
    mirror.start()
    log.info("FlowAI at %s. Waiting for phones…", config.FLOWAI_URL)

    while True:
        try:
            phones = discover()
            registered = api.hello(phones, config.MIRROR_PUBLIC_URL, agent_info())
            # Only the phones FlowAI took: one deleted on the Phones page is left alone, not polled.
            refs = {p["ref"] for p in registered}
            for p in registered:
                if p.get("paused"):
                    log.debug("%s is paused in FlowAI", p["ref"])
            for ref in refs - set(workers):
                lock = locks.setdefault(ref, threading.Lock())
                workers[ref] = PhoneWorker(api, ref, lock)
                workers[ref].start()
                log.info("phone %s connected", ref)
            for ref in set(workers) - refs:
                workers.pop(ref).stop.set()
                log.info("phone %s disconnected", ref)
            if not refs:
                if phones:
                    log.info("FlowAI has hidden every phone here (deleted on its Phones page); bring one back there")
                else:
                    log.info("no phones yet: plug one in with USB debugging on, or set FLOWAI_SIMULATED_PHONES=sim-1")
        except ApiError as exc:
            log.error("%s", exc)
            if exc.status == 401:
                log.error("The agent token was refused. Copy the current one from FlowAI → Phones → Automation service.")
        except DeviceError as exc:
            log.error("adb: %s", exc)
        # A scan action (connect, pair, emulator) wakes this early, so the phone shows up in seconds.
        wake.wait(config.HELLO_SECONDS)
        if wake.is_set():
            wake.clear()
            time.sleep(2)  # adb needs a moment to list a device it has just connected


def phones() -> int:
    found = discover()
    if not found:
        print("No phones. Enable Developer options → USB debugging, plug the phone in, and accept the prompt on it.")
        return 1
    for p in found:
        print(f"{p['ref']:<24} {p['name']:<28} Android {p['android'] or '?':<5} {p['width']}x{p['height']}  ({p['kind']})")
        if p["kind"] == "adb":
            try:
                problems = readiness_problems(adb.AdbDriver(p["ref"]).publishing_readiness())
                if problems:
                    print(f"    not ready: {'; '.join(problems)}")
                    print(f"    fix the settings with: python -m flowai_agent prepare {p['ref']}")
                else:
                    print("    ready to publish")
            except DeviceError as exc:
                print(f"    could not check: {exc}")
    return 0


def readiness_problems(ready: dict[str, Any]) -> list[str]:
    problems = []
    if any(v not in ("0", "0.0") for v in (ready.get("animations") or {}).values()):
        problems.append("animations are on (the screen can't be read while it moves)")
    if ready.get("keyboard") != adb.AdbDriver.GBOARD:
        problems.append("Gboard isn't the keyboard (other keyboards can drop typed captions)")
    if not ready.get("instagram_version"):
        problems.append("Instagram isn't installed")
    return problems


def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s", datefmt="%H:%M:%S")
    cmd = argv[0] if argv else "run"
    if cmd == "run":
        return run()
    if cmd == "phones":
        return phones()
    if cmd == "scan":
        found = scanner.scan(set(), {})
        if not found["adb"]:
            print(found["hint"])
        for d in found["connected"]:
            print(f"{d['serial']:<26} {d['connection']:<9} {d['status']:<12} {d['name']}")
            if d["status"] != "ready":
                print(f"    {d['hint']}")
        for n in found["nearby"]:
            print(f"{n['address']:<26} wifi      {n['action']:<12} {n['name']}  ({n['hint']})")
        emu = found["emulators"]
        for a in emu["avds"]:
            print(f"{a['name']:<26} emulator  {'running' if a['running'] else 'not started'}")
        if not emu["available"]:
            print(emu["hint"])
        if not (found["connected"] or found["nearby"] or emu["avds"]):
            print("Nothing found. Plug a phone in with USB debugging on, or turn on Wireless debugging.")
        return 0
    if cmd == "prepare" and len(argv) == 2:
        adb.AdbDriver(argv[1]).prepare_for_publishing()
        print(f"{argv[1]}: animations off, Gboard selected.")
        return 0
    if cmd == "connect" and len(argv) >= 2:
        if len(argv) >= 3:
            pair_at = f"{argv[1].rsplit(':', 1)[0]}:{argv[3]}" if len(argv) >= 4 else argv[1]
            print(adb.pair_wireless(pair_at, argv[2]))
        print(adb.connect_wireless(argv[1]))
        return 0
    if cmd == "screenshot" and len(argv) >= 2:
        out = argv[2] if len(argv) >= 3 else f"{argv[1].replace(':', '_')}.png"
        with open(out, "wb") as fh:
            fh.write(driver_for(argv[1]).screenshot())
        print(out)
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        sys.exit(0)
