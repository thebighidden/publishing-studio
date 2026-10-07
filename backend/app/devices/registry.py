from __future__ import annotations

from ..models import DriverKind, Phone
from .adb import AdbDriver, adb_available, connect_wireless, list_devices
from .base import DeviceDriver, DeviceError, DeviceInfo
from .simulator import SimulatorDriver

__all__ = [
    "DeviceDriver",
    "DeviceError",
    "DeviceInfo",
    "adb_available",
    "connect_wireless",
    "discover",
    "driver_for",
    "list_devices",
]


def driver_for(phone: Phone) -> DeviceDriver:
    if phone.driver == DriverKind.adb:
        return AdbDriver(phone.serial or "")
    return SimulatorDriver(phone.serial or phone.id, phone.options or {})


def discover() -> dict[str, list[dict]]:
    """Everything the user could attach right now."""
    adb_devices = [
        {
            "serial": d.serial,
            "model": d.model,
            "online": d.online,
            "driver": "adb",
        }
        for d in list_devices()
    ]
    return {
        "adb_available": adb_available(),
        "adb": adb_devices,
    }
