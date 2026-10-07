from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session, select

from ..devices import registry as devices
from ..devices.base import DeviceError, UiNode
from ..devices.targets import known_targets
from ..db import get_session
from ..models import Account, Phone, utcnow
from .schemas import AppIn, KeyIn, PhoneIn, PhoneUpdate, SwipeIn, TapIn, TypeIn, WirelessConnect

router = APIRouter(prefix="/api/phones", tags=["phones"])


def _node(n: UiNode) -> dict[str, Any]:
    return {
        "resource_id": n.resource_id,
        "text": n.text,
        "content_desc": n.content_desc,
        "cls": n.cls,
        "clickable": n.clickable,
        "bounds": (
            [n.bounds.left, n.bounds.top, n.bounds.right, n.bounds.bottom] if n.bounds else None
        ),
    }


def _get(session: Session, phone_id: str) -> Phone:
    phone = session.get(Phone, phone_id)
    if phone is None:
        raise HTTPException(404, "phone not found")
    return phone


def _free(phone: Phone) -> Phone:
    """Manual probes must not fight a publishing run for the same screen (R8)."""
    if phone.busy_run_id:
        raise HTTPException(409, f"{phone.name} is busy with run {phone.busy_run_id}")
    return phone


def _refresh(session: Session, phone: Phone) -> Phone:
    try:
        info = devices.driver_for(phone).info()
        phone.model_name = info.model or phone.model_name
        phone.android_version = info.android or phone.android_version
        phone.screen_w = info.width or phone.screen_w
        phone.screen_h = info.height or phone.screen_h
        phone.online = info.online
        phone.last_error = None
    except DeviceError as exc:
        phone.online = False
        phone.last_error = str(exc)
    phone.last_seen = utcnow()
    session.add(phone)
    session.commit()
    session.refresh(phone)
    return phone


@router.get("/discover")
def discover() -> dict:
    """Everything that could be attached right now, plus the simulator option."""
    found = devices.discover()
    found["simulator_available"] = True
    return found


@router.get("/targets")
def targets() -> dict:
    """The named targets a recipe may tap. Coordinates never leave this layer (R6)."""
    return {"targets": known_targets()}


@router.post("/connect")
def connect(body: WirelessConnect) -> dict:
    try:
        detail = devices.connect_wireless(body.host_port)
    except DeviceError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"detail": detail, "devices": devices.discover()}


@router.get("")
def list_phones(session: Session = Depends(get_session)) -> list[dict]:
    rows = session.exec(select(Phone).order_by(Phone.created_at)).all()
    accounts = session.exec(select(Account)).all()
    by_phone: dict[str, list[str]] = {}
    for a in accounts:
        if a.phone_id:
            by_phone.setdefault(a.phone_id, []).append(f"{a.platform.value}:@{a.handle}")
    return [{**p.model_dump(), "accounts": by_phone.get(p.id, [])} for p in rows]


@router.post("", status_code=201)
def create_phone(body: PhoneIn, session: Session = Depends(get_session)) -> dict:
    phone = Phone(
        name=body.name, driver=body.driver, serial=body.serial or None, options=body.options
    )
    session.add(phone)
    session.commit()
    session.refresh(phone)
    return _refresh(session, phone).model_dump()


@router.patch("/{phone_id}")
def update_phone(
    phone_id: str, body: PhoneUpdate, session: Session = Depends(get_session)
) -> dict:
    phone = _get(session, phone_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(phone, field, value)
    session.add(phone)
    session.commit()
    session.refresh(phone)
    return phone.model_dump()


@router.delete("/{phone_id}", status_code=204, response_model=None)
def delete_phone(phone_id: str, session: Session = Depends(get_session)) -> None:
    phone = _free(_get(session, phone_id))
    for account in session.exec(select(Account).where(Account.phone_id == phone.id)).all():
        account.phone_id = None
        session.add(account)
    session.delete(phone)
    session.commit()


@router.post("/{phone_id}/refresh")
def refresh_phone(phone_id: str, session: Session = Depends(get_session)) -> dict:
    return _refresh(session, _get(session, phone_id)).model_dump()


@router.get("/{phone_id}/screenshot")
def screenshot(phone_id: str, session: Session = Depends(get_session)) -> Response:
    phone = _get(session, phone_id)
    try:
        png = devices.driver_for(phone).screenshot()
    except DeviceError as exc:
        raise HTTPException(502, str(exc)) from exc
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.get("/{phone_id}/state")
def state(phone_id: str, session: Session = Depends(get_session)) -> dict:
    """The live UI hierarchy. This is what target calibration is read from."""
    phone = _get(session, phone_id)
    try:
        st = devices.driver_for(phone).screen_state()
    except DeviceError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {
        "package": st.package,
        "activity": st.activity,
        "nodes": [_node(n) for n in st.nodes],
    }


@router.post("/{phone_id}/tap")
def tap(phone_id: str, body: TapIn, session: Session = Depends(get_session)) -> dict:
    phone = _free(_get(session, phone_id))
    try:
        result = devices.driver_for(phone).tap(body.target)
    except DeviceError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"target": result.target, "x": result.x, "y": result.y, "matched": result.matched}


@router.post("/{phone_id}/type")
def type_text(phone_id: str, body: TypeIn, session: Session = Depends(get_session)) -> dict:
    phone = _free(_get(session, phone_id))
    try:
        delivered = devices.driver_for(phone).type_text(body.text)
    except DeviceError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"delivered": delivered, "lossless": delivered == body.text}


@router.post("/{phone_id}/app-start")
def app_start(phone_id: str, body: AppIn, session: Session = Depends(get_session)) -> dict:
    phone = _free(_get(session, phone_id))
    try:
        devices.driver_for(phone).app_start(body.package)
    except DeviceError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"started": body.package}


@router.post("/{phone_id}/app-stop")
def app_stop(phone_id: str, body: AppIn, session: Session = Depends(get_session)) -> dict:
    phone = _free(_get(session, phone_id))
    try:
        devices.driver_for(phone).app_stop(body.package)
    except DeviceError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"stopped": body.package}


@router.post("/{phone_id}/key")
def key(phone_id: str, body: KeyIn, session: Session = Depends(get_session)) -> dict:
    phone = _free(_get(session, phone_id))
    aliases = {
        "BACK": "KEYCODE_BACK",
        "HOME": "KEYCODE_HOME",
        "RECENTS": "KEYCODE_APP_SWITCH",
        "ENTER": "KEYCODE_ENTER",
        "DELETE": "KEYCODE_DEL",
        "TAB": "KEYCODE_TAB",
    }
    keycode = aliases.get(body.keycode.upper(), body.keycode.upper())
    if keycode not in set(aliases.values()):
        raise HTTPException(422, "unsupported key")
    try:
        devices.driver_for(phone).key(keycode)
    except DeviceError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"keycode": keycode}


@router.post("/{phone_id}/swipe")
def swipe(phone_id: str, body: SwipeIn, session: Session = Depends(get_session)) -> dict:
    phone = _free(_get(session, phone_id))
    direction = body.direction.lower()
    if direction not in {"up", "down", "left", "right"}:
        raise HTTPException(422, "direction must be up, down, left or right")
    try:
        devices.driver_for(phone).swipe(direction, body.distance)
    except DeviceError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"direction": direction, "distance": body.distance}
