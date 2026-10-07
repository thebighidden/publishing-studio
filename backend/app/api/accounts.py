from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..config import ACCOUNT_COOLDOWN_SECONDS
from ..db import get_session
from ..devices import registry as devices
from ..devices.base import DeviceError
from ..devices.targets import resolve
from ..models import Account, Phone, Platform, Post, PostStatus, utcnow
from ..publishing.recipes.instagram import InstagramRecipe
from ..publishing.recipes.x import XRecipe
from .schemas import AccountIn, AccountUpdate

router = APIRouter(prefix="/api/accounts", tags=["accounts"])

_RECIPES = {Platform.instagram: InstagramRecipe, Platform.x: XRecipe}


def _get(session: Session, account_id: str) -> Account:
    account = session.get(Account, account_id)
    if account is None:
        raise HTTPException(404, "account not found")
    return account


def _out(session: Session, account: Account) -> dict:
    phone = session.get(Phone, account.phone_id) if account.phone_id else None
    cooldown = 0
    if account.last_published_at:
        gap = (utcnow() - account.last_published_at).total_seconds()
        cooldown = max(0, int(ACCOUNT_COOLDOWN_SECONDS - gap))
    return {
        **account.model_dump(),
        "phone_name": phone.name if phone else None,
        "phone_online": phone.online if phone else None,
        "cooldown_seconds": cooldown,
        "ready": bool(phone and account.logged_in),
    }


@router.get("")
def list_accounts(session: Session = Depends(get_session)) -> list[dict]:
    rows = session.exec(select(Account).order_by(Account.created_at)).all()
    return [_out(session, a) for a in rows]


@router.post("", status_code=201)
def create_account(body: AccountIn, session: Session = Depends(get_session)) -> dict:
    if body.phone_id and session.get(Phone, body.phone_id) is None:
        raise HTTPException(400, "phone not found")
    account = Account(**body.model_dump())
    session.add(account)
    session.commit()
    session.refresh(account)
    return _out(session, account)


@router.patch("/{account_id}")
def update_account(
    account_id: str, body: AccountUpdate, session: Session = Depends(get_session)
) -> dict:
    account = _get(session, account_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("phone_id") and session.get(Phone, data["phone_id"]) is None:
        raise HTTPException(400, "phone not found")
    for field, value in data.items():
        setattr(account, field, value)
    session.add(account)
    session.commit()
    session.refresh(account)
    return _out(session, account)


@router.delete("/{account_id}", status_code=204, response_model=None)
def delete_account(account_id: str, session: Session = Depends(get_session)) -> None:
    account = _get(session, account_id)
    pending = session.exec(
        select(Post).where(
            Post.account_id == account.id,
            Post.status.in_([PostStatus.scheduled, PostStatus.publishing]),
        )
    ).all()
    if pending:
        raise HTTPException(409, f"{len(pending)} post(s) are still scheduled for this account")
    session.delete(account)
    session.commit()


@router.post("/{account_id}/check-login")
def check_login(account_id: str, session: Session = Depends(get_session)) -> dict:
    """Opens the app on the linked phone and looks for a signed-in surface.

    This is an observation, not an assumption: the stored `logged_in` flag is
    updated from what is actually on screen.
    """
    account = _get(session, account_id)
    if not account.phone_id:
        raise HTTPException(400, "account is not linked to a phone")
    phone = session.get(Phone, account.phone_id)
    if phone is None:
        raise HTTPException(400, "linked phone no longer exists")
    if phone.busy_run_id:
        raise HTTPException(409, f"{phone.name} is busy with run {phone.busy_run_id}")

    recipe = _RECIPES[account.platform]()
    driver = devices.driver_for(phone)
    try:
        driver.app_start(recipe.package)
        node = driver.wait_for(recipe.home_target, timeout=12)
        if node is None:
            state = driver.screen_state()
            logged_in = resolve(recipe.home_target, state.nodes) is not None
        else:
            logged_in = True
        detail = (
            f"{recipe.package} is showing its signed-in home"
            if logged_in
            else f"{recipe.package} opened but no signed-in surface was found; "
            "sign in by hand on the phone"
        )
    except DeviceError as exc:
        raise HTTPException(502, str(exc)) from exc
    finally:
        driver.close()

    account.logged_in = logged_in
    session.add(account)
    session.commit()
    return {"logged_in": logged_in, "detail": detail}
