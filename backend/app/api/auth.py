from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlmodel import Session

from .. import auth
from ..db import get_session
from ..publishing import events

router = APIRouter(prefix="/api/auth", tags=["authentication"])
_attempts: dict[str, deque[float]] = defaultdict(deque)


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=40)
    password: str = Field(min_length=10, max_length=256)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=10, max_length=256)


def _set_cookie(response: Response, cfg: dict, request: Request) -> None:
    response.set_cookie(
        auth.COOKIE_NAME,
        auth.make_session(cfg),
        max_age=auth.SESSION_SECONDS,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="strict",
        path="/",
    )


@router.get("/status")
def status(request: Request, session: Session = Depends(get_session)) -> dict:
    is_configured = auth.configured(session)
    user = auth.read_session(session, request.cookies.get(auth.COOKIE_NAME))
    return {"configured": is_configured, "authenticated": user is not None, "user": user}


@router.post("/setup", status_code=201)
def setup(
    body: Credentials, request: Request, response: Response, session: Session = Depends(get_session)
) -> dict:
    try:
        cfg = auth.setup(session, body.username, body.password)
    except auth.AuthError as exc:
        raise HTTPException(409 if auth.configured(session) else 422, str(exc)) from exc
    _set_cookie(response, cfg, request)
    events.emit("auth.configured", username=cfg["username"])
    return {"authenticated": True, "user": {"username": cfg["username"]}}


@router.post("/login")
def login(
    body: Credentials, request: Request, response: Response, session: Session = Depends(get_session)
) -> dict:
    key = request.client.host if request.client else "local"
    now = time.monotonic()
    bucket = _attempts[key]
    while bucket and now - bucket[0] > 60:
        bucket.popleft()
    if len(bucket) >= 5:
        raise HTTPException(429, "too many login attempts; wait one minute")
    cfg = auth.verify(session, body.username, body.password)
    if cfg is None:
        bucket.append(now)
        raise HTTPException(401, "invalid username or password")
    bucket.clear()
    _set_cookie(response, cfg, request)
    events.emit("auth.login", username=cfg["username"])
    return {"authenticated": True, "user": {"username": cfg["username"]}}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(auth.COOKIE_NAME, path="/", samesite="strict")
    return {"authenticated": False}


@router.post("/change-password")
def change_password(
    body: PasswordChange,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> dict:
    user = auth.read_session(session, request.cookies.get(auth.COOKIE_NAME))
    if user is None:
        raise HTTPException(401, "authentication required")
    try:
        cfg = auth.change_password(
            session, user["username"], body.current_password, body.new_password
        )
    except auth.AuthError as exc:
        raise HTTPException(400, str(exc)) from exc
    _set_cookie(response, cfg, request)
    events.emit("auth.password_changed", username=cfg["username"])
    return {"authenticated": True, "user": {"username": cfg["username"]}}
