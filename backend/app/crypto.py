from __future__ import annotations

import base64
import json
import os
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from .config import KEY_PATH

_PREFIX = "enc::"


def _fernet() -> Fernet:
    if not KEY_PATH.exists():
        KEY_PATH.write_bytes(Fernet.generate_key())
        try:
            os.chmod(KEY_PATH, 0o600)
        except OSError:
            pass
    return Fernet(KEY_PATH.read_bytes())


def encrypt(value: str | None) -> str | None:
    if not value:
        return value
    return _PREFIX + _fernet().encrypt(value.encode()).decode()


def decrypt(value: str | None) -> str | None:
    if not value:
        return value
    if not value.startswith(_PREFIX):
        return value
    try:
        return _fernet().decrypt(value[len(_PREFIX) :].encode()).decode()
    except InvalidToken:
        return None


def mask(value: str | None) -> str | None:
    """What the UI is allowed to see. Never return a usable key to the client."""
    plain = decrypt(value)
    if not plain:
        return None
    if len(plain) <= 8:
        return "•" * len(plain)
    return f"{plain[:4]}{'•' * 8}{plain[-4:]}"


def fingerprint(value: str | None) -> str | None:
    plain = decrypt(value)
    if not plain:
        return None
    import hashlib

    return base64.b16encode(hashlib.sha256(plain.encode()).digest()[:4]).decode().lower()


def seal_json(value: dict[str, Any]) -> str:
    """Authenticate and encrypt a small application-owned payload."""
    raw = json.dumps(value, separators=(",", ":"), sort_keys=True).encode()
    return _fernet().encrypt(raw).decode()


def open_json(token: str) -> dict[str, Any] | None:
    try:
        raw = _fernet().decrypt(token.encode())
        value = json.loads(raw)
        return value if isinstance(value, dict) else None
    except (InvalidToken, ValueError, TypeError, json.JSONDecodeError):
        return None
