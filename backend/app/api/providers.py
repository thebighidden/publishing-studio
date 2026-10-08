from __future__ import annotations

import copy

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..crypto import encrypt, mask
from ..db import get_session
from ..models import ProviderConfig, ProviderKind, utcnow
from ..providers import comfyui, registry
from ..providers.base import ProviderError
from .schemas import ProviderIn, ProviderOut, ProviderUpdate

router = APIRouter(prefix="/api/providers", tags=["providers"])


def _out(cfg: ProviderConfig) -> ProviderOut:
    return ProviderOut(
        id=cfg.id,
        name=cfg.name,
        kind=cfg.kind,
        adapter=cfg.adapter,
        base_url=cfg.base_url,
        model=cfg.model,
        options=cfg.options or {},
        enabled=cfg.enabled,
        is_default=cfg.is_default,
        has_key=bool(cfg.api_key),
        key_masked=mask(cfg.api_key),
        last_check_ok=cfg.last_check_ok,
        last_check_at=cfg.last_check_at,
        last_check_detail=cfg.last_check_detail,
    )


def _clear_other_defaults(session: Session, cfg: ProviderConfig) -> None:
    rows = session.exec(
        select(ProviderConfig).where(
            ProviderConfig.kind == cfg.kind, ProviderConfig.id != cfg.id
        )
    ).all()
    for row in rows:
        if row.is_default:
            row.is_default = False
            session.add(row)


@router.get("/catalog")
def catalog() -> dict:
    """What the Settings screen offers, so the UI never hardcodes model names."""
    adapters = copy.deepcopy(registry.CATALOG)
    for entry in adapters:
        if entry["adapter"] == "comfyui":
            entry["models"]["image"] = comfyui.workflow_names()  # built-in plus saved workflows
    return {"adapters": adapters, "kinds": [k.value for k in ProviderKind]}


@router.get("", response_model=list[ProviderOut])
def list_providers(session: Session = Depends(get_session)) -> list[ProviderOut]:
    rows = session.exec(select(ProviderConfig).order_by(ProviderConfig.created_at)).all()
    return [_out(r) for r in rows]


@router.post("", response_model=ProviderOut, status_code=201)
def create_provider(body: ProviderIn, session: Session = Depends(get_session)) -> ProviderOut:
    cfg = ProviderConfig(
        name=body.name,
        kind=body.kind,
        adapter=body.adapter,
        base_url=body.base_url or None,
        api_key=encrypt(body.api_key) if body.api_key else None,
        model=body.model or None,
        options=body.options,
        enabled=body.enabled,
        is_default=body.is_default,
    )
    session.add(cfg)
    session.flush()
    if cfg.is_default:
        _clear_other_defaults(session, cfg)
    session.commit()
    session.refresh(cfg)
    return _out(cfg)


@router.patch("/{provider_id}", response_model=ProviderOut)
def update_provider(
    provider_id: str, body: ProviderUpdate, session: Session = Depends(get_session)
) -> ProviderOut:
    cfg = session.get(ProviderConfig, provider_id)
    if cfg is None:
        raise HTTPException(404, "provider not found")

    data = body.model_dump(exclude_unset=True)
    if "api_key" in data:
        # Omitted entirely keeps the stored key; "" clears it.
        raw = data.pop("api_key")
        cfg.api_key = encrypt(raw) if raw else None
        cfg.last_check_ok = None
        cfg.last_check_detail = None
    for field, value in data.items():
        setattr(cfg, field, value)

    session.add(cfg)
    if cfg.is_default:
        _clear_other_defaults(session, cfg)
    session.commit()
    session.refresh(cfg)
    return _out(cfg)


@router.delete("/{provider_id}", status_code=204, response_model=None)
def delete_provider(provider_id: str, session: Session = Depends(get_session)) -> None:
    cfg = session.get(ProviderConfig, provider_id)
    if cfg is None:
        raise HTTPException(404, "provider not found")
    session.delete(cfg)
    session.commit()


@router.post("/{provider_id}/check", response_model=ProviderOut)
def check_provider(provider_id: str, session: Session = Depends(get_session)) -> ProviderOut:
    """Round-trips the real endpoint so a key is proven before a campaign needs it."""
    cfg = session.get(ProviderConfig, provider_id)
    if cfg is None:
        raise HTTPException(404, "provider not found")

    try:
        client = registry.build(cfg)
        detail = client.check()
        ok = True
    except ProviderError as exc:
        detail, ok = str(exc), False
    except Exception as exc:  # noqa: BLE001 - a bad config must not 500 the settings page
        detail, ok = f"{type(exc).__name__}: {exc}", False

    cfg.last_check_ok = ok
    cfg.last_check_at = utcnow()
    cfg.last_check_detail = detail[:500]
    session.add(cfg)
    session.commit()
    session.refresh(cfg)
    return _out(cfg)
