from __future__ import annotations

import threading
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlmodel import Session, select

from ..db import get_session, session_scope
from ..models import Account, Phone, Post, Run, RunStep
from ..publishing import events, runner
from ..publishing.scheduler import scheduler

router = APIRouter(prefix="/api/runs", tags=["runs"])


def _get(session: Session, run_id: str) -> Run:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(404, "run not found")
    return run


def _step_out(step: RunStep) -> dict[str, Any]:
    return {
        "n": step.n,
        "action": step.action,
        "ok": step.ok,
        "ms": step.ms,
        "detail": step.detail,
        "screenshot": f"/evidence/{step.screenshot}" if step.screenshot else None,
        "at": step.at,
    }


def _run_out(session: Session, run: Run, *, with_steps: bool = False) -> dict[str, Any]:
    post = session.get(Post, run.post_id)
    account = session.get(Account, run.account_id) if run.account_id else None
    phone = session.get(Phone, run.phone_id) if run.phone_id else None

    evidence = dict(run.evidence or {})
    evidence["screenshot_urls"] = [
        f"/evidence/{name}" for name in (evidence.get("screenshots") or [])
    ]

    out: dict[str, Any] = {
        **run.model_dump(),
        "evidence": evidence,
        "handle": account.handle if account else "",
        "platform": post.platform.value if post else "",
        "phone_name": phone.name if phone else "",
        "post_title": post.title if post else "",
        "post_status": post.status.value if post else "",
    }
    if with_steps:
        steps = session.exec(
            select(RunStep).where(RunStep.run_id == run.id).order_by(RunStep.n)
        ).all()
        out["steps"] = [_step_out(s) for s in steps]
    return out


@router.get("")
def list_runs(
    session: Session = Depends(get_session),
    post_id: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
) -> list[dict]:
    stmt = select(Run)
    if post_id:
        stmt = stmt.where(Run.post_id == post_id)
    rows = session.exec(stmt.order_by(Run.created_at.desc()).limit(limit)).all()
    return [_run_out(session, r) for r in rows]


@router.get("/{run_id}")
def get_run(run_id: str, session: Session = Depends(get_session)) -> dict:
    return _run_out(session, _get(session, run_id), with_steps=True)


@router.get("/{run_id}/record")
def run_record(run_id: str, session: Session = Depends(get_session)) -> JSONResponse:
    """The hand-in artefact: one JSON object per publishing run."""
    run = _get(session, run_id)
    return JSONResponse(
        content=runner.run_record(session, run),
        headers={"Content-Disposition": f'attachment; filename="run-{run.id}.json"'},
    )


@router.post("/publish-now", status_code=202)
def publish_now(
    post_id: str = Query(...), session: Session = Depends(get_session)
) -> dict:
    """Operator-triggered publish.

    The guards run here so a refusal is immediate and explained, then the run
    itself moves to a worker thread — a publish takes minutes, and the step feed
    is what the operator watches.
    """
    if scheduler.is_paused():
        raise HTTPException(409, "publishing is paused; resume it first")

    post = session.get(Post, post_id)
    if post is None:
        raise HTTPException(404, "post not found")
    try:
        runner.preflight(session, post)
    except runner.NotPublishable as exc:
        raise HTTPException(409, str(exc)) from exc

    def work() -> None:
        with session_scope() as s:
            fresh = s.get(Post, post_id)
            if fresh is None:
                return
            try:
                runner.execute(s, fresh, manual=True)
            except runner.NotPublishable as exc:
                events.emit("run.blocked", post_id=post_id, reason=str(exc))

    threading.Thread(target=work, name=f"publish-now-{post_id}", daemon=True).start()
    return {"started": True, "post_id": post_id}
