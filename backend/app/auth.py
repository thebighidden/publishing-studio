from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import time
from typing import Any, Optional

from sqlmodel import Session

from .crypto import open_json, seal_json
from .db import engine
from .models import Setting

AUTH_KEY = "auth_admin"
COOKIE_NAME = "studio_session"
SESSION_SECONDS = 7 * 24 * 60 * 60
PBKDF2_ITERATIONS = 310_000


class AuthError(RuntimeError):
    pass


def config(session: Session) -> Optional[dict[str, Any]]:
    row = session.get(Setting, AUTH_KEY)
    return dict(row.value) if row and row.value else None


def configured(session: Session) -> bool:
    cfg = config(session)
    return bool(cfg and cfg.get("username") and cfg.get("password_hash"))


def setup(session: Session, username: str, password: str) -> dict[str, Any]:
    if configured(session):
        raise AuthError("the administrator account has already been configured")
    username = _validate_username(username)
    _validate_password(password)
    salt = os.urandom(18)
    row = Setting(
        key=AUTH_KEY,
        value={
            "username": username,
            "salt": base64.b64encode(salt).decode(),
            "password_hash": _derive(password, salt),
            "iterations": PBKDF2_ITERATIONS,
            "session_version": 1,
            "created_at": int(time.time()),
        },
    )
    session.add(row)
    session.commit()
    return dict(row.value)


def verify(session: Session, username: str, password: str) -> Optional[dict[str, Any]]:
    cfg = config(session)
    if not cfg or not hmac.compare_digest(str(cfg.get("username", "")), username.strip()):
        _dummy_hash(password)
        return None
    try:
        salt = base64.b64decode(cfg["salt"])
        expected = str(cfg["password_hash"])
    except (KeyError, ValueError, TypeError):
        return None
    actual = _derive(password, salt, int(cfg.get("iterations", PBKDF2_ITERATIONS)))
    return cfg if hmac.compare_digest(actual, expected) else None


def change_password(
    session: Session, username: str, current_password: str, new_password: str
) -> dict[str, Any]:
    cfg = verify(session, username, current_password)
    if cfg is None:
        raise AuthError("the current password is incorrect")
    _validate_password(new_password)
    salt = os.urandom(18)
    cfg.update(
        salt=base64.b64encode(salt).decode(),
        password_hash=_derive(new_password, salt),
        iterations=PBKDF2_ITERATIONS,
        session_version=int(cfg.get("session_version", 1)) + 1,
        password_changed_at=int(time.time()),
    )
    row = session.get(Setting, AUTH_KEY)
    row.value = cfg
    session.add(row)
    session.commit()
    return cfg


def make_session(cfg: dict[str, Any]) -> str:
    now = int(time.time())
    return seal_json(
        {
            "sub": cfg["username"],
            "iat": now,
            "exp": now + SESSION_SECONDS,
            "v": int(cfg.get("session_version", 1)),
            "nonce": base64.urlsafe_b64encode(os.urandom(12)).decode(),
        }
    )


def read_session(session: Session, token: Optional[str]) -> Optional[dict[str, Any]]:
    if not token:
        return None
    payload = open_json(token)
    cfg = config(session)
    if not payload or not cfg:
        return None
    try:
        valid = (
            int(payload.get("exp", 0)) > int(time.time())
            and hmac.compare_digest(str(payload.get("sub", "")), str(cfg["username"]))
            and int(payload.get("v", 0)) == int(cfg.get("session_version", 1))
        )
    except (KeyError, ValueError, TypeError):
        return None
    return {"username": cfg["username"], "expires_at": payload["exp"]} if valid else None


def validate_token(token: Optional[str]) -> Optional[dict[str, Any]]:
    with Session(engine) as session:
        return read_session(session, token)


def _derive(password: str, salt: bytes, iterations: int = PBKDF2_ITERATIONS) -> str:
    raw = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return base64.b64encode(raw).decode()


def _dummy_hash(password: str) -> None:
    hashlib.pbkdf2_hmac("sha256", password.encode(), b"publishing-studio", 25_000)


def _validate_username(username: str) -> str:
    username = username.strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{3,40}", username):
        raise AuthError("username must be 3–40 characters using letters, numbers, dot, dash or underscore")
    return username


def _validate_password(password: str) -> None:
    if len(password) < 10:
        raise AuthError("password must be at least 10 characters")
    if len(password) > 256:
        raise AuthError("password is too long")
