from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlmodel import Session, select

from ..config import (
    ACCOUNT_COOLDOWN_SECONDS,
    RUN_STEP_BUDGET,
    RUN_TIMEOUT_SECONDS,
    SCHEDULER_TICK_SECONDS,
)
from ..db import get_session
from ..devices import registry as devices
from ..devices.targets import catalog, known_targets, save_overrides
from ..models import (
    Account,
    Campaign,
    Outcome,
    Phone,
    Post,
    PostStatus,
    ProviderConfig,
    Run,
)
from ..publishing import events
from ..publishing.scheduler import scheduler
from .schemas import PauseIn, TargetsIn

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
def health(session: Session = Depends(get_session)) -> dict:
    providers = session.exec(select(ProviderConfig).where(ProviderConfig.enabled)).all()
    real = [p for p in providers if p.adapter.value != "simulated"]
    return {
        "ok": True,
        "scheduler": scheduler.status(),
        "adb_available": devices.adb_available(),
        "providers_configured": len(real),
        "providers_total": len(providers),
        "limits": {
            "run_timeout_seconds": RUN_TIMEOUT_SECONDS,
            "run_step_budget": RUN_STEP_BUDGET,
            "account_cooldown_seconds": ACCOUNT_COOLDOWN_SECONDS,
            "scheduler_tick_seconds": SCHEDULER_TICK_SECONDS,
        },
    }


@router.get("/overview")
def overview(session: Session = Depends(get_session)) -> dict:
    """What the dashboard needs in one call."""
    posts = session.exec(select(Post)).all()
    runs = session.exec(select(Run)).all()
    phones = session.exec(select(Phone)).all()

    by_status: dict[str, int] = {}
    for p in posts:
        by_status[p.status.value] = by_status.get(p.status.value, 0) + 1

    by_outcome: dict[str, int] = {}
    for r in runs:
        if r.outcome:
            by_outcome[r.outcome.value] = by_outcome.get(r.outcome.value, 0) + 1

    return {
        "campaigns": len(session.exec(select(Campaign)).all()),
        "accounts": len(session.exec(select(Account)).all()),
        "phones": {
            "total": len(phones),
            "online": sum(1 for p in phones if p.online),
            "busy": sum(1 for p in phones if p.busy_run_id),
        },
        "posts": by_status,
        "awaiting_approval": by_status.get(PostStatus.draft.value, 0),
        "runs": {
            "total": len(runs),
            "by_outcome": by_outcome,
            "confirmed": by_outcome.get(Outcome.confirmed.value, 0),
            "uncertain": by_outcome.get(Outcome.uncertain.value, 0),
            "failed": by_outcome.get(Outcome.failed.value, 0),
        },
        "paused": scheduler.is_paused(),
    }


# ---------------- the global stop button (feature fa09) ----------------


@router.get("/scheduler")
def scheduler_status() -> dict:
    return scheduler.status()


@router.post("/scheduler/pause")
def set_paused(body: PauseIn) -> dict:
    """Stops all automated publishing at once. In-flight runs finish; nothing new
    is dispatched."""
    scheduler.set_paused(body.paused, body.reason)
    return scheduler.status()


# ---------------- named targets (rule R6) ----------------


@router.get("/targets")
def get_targets() -> dict:
    return {"names": known_targets(), "catalog": catalog()}


@router.put("/targets")
def put_targets(body: TargetsIn) -> dict:
    """Operator overrides for selector drift, saved next to the database.

    When an app update moves a button, this is the fix — no code change, and
    still never a raw coordinate.
    """
    save_overrides(body.targets)
    return {"names": known_targets(), "catalog": catalog()}


# ---------------- live feed ----------------


@router.get("/events/recent")
def recent_events() -> list[dict]:
    return events.recent()


@router.websocket("/events")
async def event_stream(ws: WebSocket) -> None:
    await ws.accept()
    queue = events.subscribe()
    try:
        for event in events.recent()[-50:]:
            await ws.send_json(event)
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=25)
            except asyncio.TimeoutError:
                await ws.send_json({"kind": "ping"})
                continue
            await ws.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        events.unsubscribe(queue)
