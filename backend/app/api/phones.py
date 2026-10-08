from __future__ import annotations

import asyncio
import io
import logging
import threading
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from PIL import Image
from sqlmodel import Session, select

from ..devices import registry as devices
from ..devices import remote, scrcpy
from ..devices.adb import AdbDriver
from ..devices.base import DeviceDriver, DeviceError, UiNode
from ..devices.targets import known_targets
from ..db import get_session, session_scope
from ..models import Account, Phone, utcnow
from ..publishing.metrics import describe_booking
from .schemas import (
    AppIn,
    DragIn,
    KeyIn,
    PhoneIn,
    PhoneUpdate,
    SwipeIn,
    TapIn,
    TouchIn,
    TypeIn,
    WirelessConnect,
    WirelessPair,
)

router = APIRouter(prefix="/api/phones", tags=["phones"])

_STREAM_MAX_FAILURES = 5
log = logging.getLogger(__name__)


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
    """Manual probes must not fight a job already on the same screen (R8)."""
    if phone.busy_run_id:
        raise HTTPException(409, f"{phone.name} is busy: {describe_booking(phone.busy_run_id)}")
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
    found["scrcpy_available"] = scrcpy.available()
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


@router.post("/pair")
def pair(body: WirelessPair) -> dict:
    try:
        detail = devices.pair_wireless(body.host_port, body.code)
    except DeviceError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"detail": detail}


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


def _jpeg_frame(driver: DeviceDriver, max_h: int) -> bytes:
    img = driver.live_frame()
    if img.height > max_h:
        img = img.resize((round(img.width * max_h / img.height), max_h), Image.BILINEAR)
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=70)
    return buf.getvalue()


@router.get("/{phone_id}/stream")
async def stream(
    phone_id: str,
    request: Request,
    fps: float = Query(5.0, gt=0, le=15),
    max_h: int = Query(960, ge=240, le=2400),
) -> StreamingResponse:
    """Live screen as MJPEG, which an <img> plays natively.

    Watching is read-only, so unlike the controls it stays available while a
    run holds the phone — that is exactly when it is most worth seeing. The
    DB session is closed before streaming so a long-lived viewer holds nothing.
    """
    with session_scope() as session:
        driver = devices.driver_for(_get(session, phone_id))
    interval = 1.0 / fps

    # Real phones get scrcpy's hardware H.264 stream when it is installed —
    # ~30 fps instead of ~1 over Wi-Fi. Anything wrong with it falls back.
    video = None
    if isinstance(driver, AdbDriver) and scrcpy.available():
        try:
            video = await asyncio.to_thread(scrcpy.ScrcpySession.open, driver.serial, max_h)
        except DeviceError as exc:
            log.warning("scrcpy unavailable for %s, using screencap: %s", driver.serial, exc)

    async def scrcpy_frames():
        seq = 0
        try:
            while not await request.is_disconnected():
                try:
                    new_seq, jpg = await asyncio.to_thread(video.next_frame, seq, 1.0)
                except DeviceError:
                    return
                if new_seq != seq:
                    seq = new_seq
                    yield _mjpeg_part(jpg)
        finally:
            # close() shells out to adb; keep it off the event loop.
            threading.Thread(target=video.close, daemon=True).start()

    async def screencap_frames():
        failures = 0
        while not await request.is_disconnected():
            started = time.monotonic()
            try:
                jpg = await asyncio.to_thread(_jpeg_frame, driver, max_h)
            except (DeviceError, OSError):
                failures += 1
                if failures >= _STREAM_MAX_FAILURES:
                    return  # the browser fires onerror and the UI offers a retry
                await asyncio.sleep(1.0)
                continue
            failures = 0
            yield _mjpeg_part(jpg)
            await asyncio.sleep(max(0.0, interval - (time.monotonic() - started)))

    return StreamingResponse(
        scrcpy_frames() if video else screencap_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
            "X-Stream-Source": "scrcpy" if video else "screencap",
        },
        # Also covers a viewer that leaves before the first frame, when the
        # generator above never starts and so never reaches its finally.
        background=BackgroundTask(video.close) if video else None,
    )


def _mjpeg_part(jpg: bytes) -> bytes:
    return (
        b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
        + str(len(jpg)).encode()
        + b"\r\n\r\n"
        + jpg
        + b"\r\n"
    )


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


@router.post("/{phone_id}/touch")
def touch(phone_id: str, body: TouchIn, session: Session = Depends(get_session)) -> dict:
    """Operator taps on the live view. Recipes never come through here (R6)."""
    phone = _free(_get(session, phone_id))
    try:
        x, y = remote.touch(devices.driver_for(phone), body.x, body.y, body.landscape, body.hold_ms)
    except DeviceError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"x": x, "y": y, "hold_ms": body.hold_ms}


@router.post("/{phone_id}/drag")
def drag(phone_id: str, body: DragIn, session: Session = Depends(get_session)) -> dict:
    phone = _free(_get(session, phone_id))
    try:
        remote.drag(
            devices.driver_for(phone),
            (body.x1, body.y1),
            (body.x2, body.y2),
            body.duration_ms,
            body.landscape,
        )
    except DeviceError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"duration_ms": body.duration_ms}


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


# ---------------- publishing readiness ----------------


def _readiness_report(phone: Phone, state: dict) -> dict:
    animations_off = all(v in ("0", "0.0") for v in state["animations"].values())
    on_gboard = state["keyboard"] == AdbDriver.GBOARD
    has_gboard = AdbDriver.GBOARD in state["keyboards"]
    services = state["accessibility_services"]
    checks = [
        {
            "id": "animations",
            "label": "Animations off",
            "ok": animations_off,
            "detail": "Instagram's screen is read reliably only when it is still."
            if animations_off else "Animations are on: screen reads can time out mid-post.",
        },
        {
            "id": "keyboard",
            "label": "Gboard is the keyboard",
            "ok": on_gboard,
            "detail": "Typed captions reach the app."
            if on_gboard else (f"Current keyboard is {state['keyboard'].split('/')[0]}; captions may not arrive."
                               if has_gboard else "Gboard is not installed; install it from the Play Store."),
        },
        {
            "id": "accessibility",
            "label": "An accessibility service is running",
            "ok": bool(services),
            "detail": f"{len(services)} running. Instagram only exposes its screen while one is."
            if services else "None running: Instagram may hide its buttons from the studio. Enable one in Android Settings → Accessibility.",
        },
        {
            "id": "instagram",
            "label": "Instagram installed",
            "ok": bool(state["instagram_version"]),
            "detail": f"Version {state['instagram_version']}" if state["instagram_version"] else "Install Instagram and sign in by hand.",
        },
    ]
    return {
        "phone_id": phone.id,
        "checks": checks,
        "ready": all(c["ok"] for c in checks),
        "can_restore": bool((phone.options or {}).get("before_prepare")),
        "raw": state,
    }


def _adb_driver(phone: Phone) -> AdbDriver:
    driver = devices.driver_for(phone)
    if not isinstance(driver, AdbDriver):
        raise HTTPException(400, "this is a simulator; it needs no preparing")
    return driver


@router.get("/{phone_id}/readiness")
def readiness(phone_id: str, session: Session = Depends(get_session)) -> dict:
    phone = _get(session, phone_id)
    driver = _adb_driver(phone)
    try:
        return _readiness_report(phone, driver.publishing_readiness())
    except DeviceError as exc:
        raise HTTPException(502, str(exc)) from exc


@router.post("/{phone_id}/prepare")
def prepare(phone_id: str, session: Session = Depends(get_session)) -> dict:
    """Animations off and Gboard on. The phone's previous values are kept so this can be undone."""
    phone = _free(_get(session, phone_id))
    driver = _adb_driver(phone)
    try:
        before = driver.publishing_readiness()
        driver.prepare_for_publishing()
        after = driver.publishing_readiness()
    except DeviceError as exc:
        raise HTTPException(502, str(exc)) from exc
    options = dict(phone.options or {})
    # Keep the first "before": preparing twice must not overwrite the original values.
    options.setdefault("before_prepare", {"animations": before["animations"], "keyboard": before["keyboard"]})
    phone.options = options
    session.add(phone)
    session.commit()
    return _readiness_report(phone, after)


@router.post("/{phone_id}/restore")
def restore(phone_id: str, session: Session = Depends(get_session)) -> dict:
    phone = _free(_get(session, phone_id))
    before = (phone.options or {}).get("before_prepare")
    if not before:
        raise HTTPException(409, "nothing to restore: this phone was not prepared by the studio")
    driver = _adb_driver(phone)
    try:
        driver.restore_settings(before)
        after = driver.publishing_readiness()
    except DeviceError as exc:
        raise HTTPException(502, str(exc)) from exc
    options = dict(phone.options or {})
    options.pop("before_prepare", None)
    phone.options = options
    session.add(phone)
    session.commit()
    return _readiness_report(phone, after)


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
