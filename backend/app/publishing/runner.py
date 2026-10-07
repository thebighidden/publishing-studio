from __future__ import annotations

import traceback
from datetime import datetime, timedelta
from typing import Optional

from sqlmodel import Session, select

from ..config import ACCOUNT_COOLDOWN_SECONDS, MEDIA_DIR, RUN_STEP_BUDGET, RUN_TIMEOUT_SECONDS
from ..devices.base import DeviceError
from ..devices.registry import driver_for
from ..models import (
    Account,
    MediaAsset,
    Outcome,
    Phone,
    Platform,
    Post,
    PostStatus,
    Run,
    RunStatus,
    RunStep,
    utcnow,
)
from . import events
from .context import BudgetExceeded, RunContext, StepRecord
from .recipes.base import Evidence, PostPayload, PublishFailed, Recipe
from .recipes.instagram import InstagramRecipe
from .recipes.x import XRecipe

MAX_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = [60, 180]


class NotPublishable(RuntimeError):
    """A guard refused the run. Never retried automatically."""


def recipe_for(platform: Platform) -> Recipe:
    return {Platform.instagram: InstagramRecipe, Platform.x: XRecipe}[platform]()


# --------------------------------------------------------------------------
# guards
# --------------------------------------------------------------------------


def preflight(session: Session, post: Post) -> tuple[Account, Phone]:
    """Everything that must be true before a phone is touched."""
    if post.status not in (PostStatus.scheduled, PostStatus.approved):
        raise NotPublishable(f"post is {post.status.value}, not scheduled")

    # Gate 6B. Automated publishing is only ever allowed for approved content.
    if post.approved_at is None:
        raise NotPublishable("content has not passed approval gate 6B")

    account = session.get(Account, post.account_id)
    if account is None:
        raise NotPublishable("account no longer exists")
    if not account.phone_id:
        raise NotPublishable(f"account @{account.handle} is not linked to a phone")

    phone = session.get(Phone, account.phone_id)
    if phone is None:
        raise NotPublishable("linked phone no longer exists")
    if phone.busy_run_id:
        raise NotPublishable(f"phone {phone.name} is busy with run {phone.busy_run_id}")

    # R3: no tight posting loops on one account.
    if account.last_published_at:
        gap = (utcnow() - account.last_published_at).total_seconds()
        if gap < ACCOUNT_COOLDOWN_SECONDS:
            raise NotPublishable(
                f"@{account.handle} published {int(gap)}s ago; "
                f"cooling down for {ACCOUNT_COOLDOWN_SECONDS}s"
            )
    return account, phone


# --------------------------------------------------------------------------
# the run
# --------------------------------------------------------------------------


def execute(session: Session, post: Post, *, manual: bool = False) -> Run:
    account, phone = preflight(session, post)

    run = Run(
        post_id=post.id,
        phone_id=phone.id,
        account_id=account.id,
        goal=post.title or (post.caption[:80] if post.caption else "publish"),
        status=RunStatus.running,
        started_at=utcnow(),
    )
    session.add(run)

    # Book the phone before anything else: one job at a time (R8).
    phone.busy_run_id = run.id
    post.status = PostStatus.publishing
    post.attempts += 1
    session.add(phone)
    session.add(post)
    session.commit()
    session.refresh(run)

    events.emit("run.started", run_id=run.id, post_id=post.id, phone=phone.name,
                account=account.handle, platform=post.platform.value, manual=manual)

    def sink(rec: StepRecord) -> None:
        session.add(
            RunStep(
                run_id=run.id,
                n=rec.n,
                action=rec.action,
                ok=rec.ok,
                ms=rec.ms,
                detail=rec.detail,
                screenshot=rec.screenshot,
            )
        )
        session.commit()
        events.emit(
            "run.step",
            run_id=run.id,
            n=rec.n,
            action=rec.action,
            ok=rec.ok,
            ms=rec.ms,
            detail=rec.detail,
            screenshot=rec.screenshot,
        )

    driver = None
    ctx: Optional[RunContext] = None
    recipe = recipe_for(post.platform)
    evidence: Optional[Evidence] = None
    error: Optional[str] = None
    retryable = True

    try:
        driver = driver_for(phone)
        ctx = RunContext(
            run_id=run.id,
            driver=driver,
            sink=sink,
            step_budget=RUN_STEP_BUDGET,
            timeout_s=RUN_TIMEOUT_SECONDS,
        )

        payload = PostPayload(
            caption=post.caption,
            hashtags=post.hashtags or [],
            placement=post.placement,
            handle=account.handle,
        )

        if post.media_id:
            asset = session.get(MediaAsset, post.media_id)
            if asset is None:
                raise PublishFailed("the attached media is missing", retryable=False)
            local = MEDIA_DIR / asset.filename
            if not local.exists():
                raise PublishFailed(f"media file not on disk: {asset.filename}", retryable=False)
            # Transfer before the app opens, so the picker sees it (feature fa03).
            payload.media_path = ctx.push_media(str(local))

        baseline = recipe.baseline(ctx)
        recipe.publish(ctx, payload)
        evidence = recipe.verify(ctx, payload, baseline)

    except BudgetExceeded as exc:
        error = f"run stopped by its own budget: {exc}"
        retryable = True
    except PublishFailed as exc:
        error = str(exc)
        retryable = exc.retryable
    except DeviceError as exc:
        error = f"device error: {exc}"
        retryable = True
    except NotPublishable as exc:
        error = str(exc)
        retryable = False
    except Exception as exc:  # noqa: BLE001 - a run must never take the server down
        error = f"{type(exc).__name__}: {exc}"
        retryable = True
        events.emit("run.trace", run_id=run.id, trace=traceback.format_exc()[-1500:])
    finally:
        if ctx is not None:
            try:
                recipe.cleanup(ctx)
            except Exception:
                pass
        if driver is not None:
            try:
                driver.close()
            except Exception:
                pass

    outcome, note = _decide(evidence, error)

    run.status = RunStatus.finished
    run.outcome = outcome
    run.ended_at = utcnow()
    run.error = error
    run.totals = ctx.totals() if ctx else {"steps": 0, "wall_clock_ms": 0}
    run.evidence = _evidence_payload(evidence, note)

    post.last_error = error
    if outcome == Outcome.confirmed:
        post.status = PostStatus.published
        post.published_at = utcnow()
        post.post_url = (evidence.checks.get("post_url") if evidence else None) or post.post_url
        account.last_published_at = utcnow()
        session.add(account)
    elif outcome == Outcome.uncertain:
        # Deliberately not retried. Re-running a post that may already be live
        # is how an account ends up double-posting.
        post.status = PostStatus.uncertain
    else:
        post.status = _failed_status(post, retryable)

    phone.busy_run_id = None
    session.add_all([run, post, phone])
    session.commit()
    session.refresh(run)

    events.emit(
        "run.finished",
        run_id=run.id,
        post_id=post.id,
        outcome=outcome.value,
        note=note,
        error=error,
        totals=run.totals,
        post_status=post.status.value,
    )
    return run


def _decide(evidence: Optional[Evidence], error: Optional[str]) -> tuple[Outcome, str]:
    """The single most important judgement in the system.

    Sending a command is not publishing a post. `confirmed` requires something
    observed after the fact; anything ambiguous is `uncertain`, never a guess
    in either direction.
    """
    if evidence is not None and evidence.confirmed:
        return Outcome.confirmed, evidence.note

    if evidence is not None and not evidence.confirmed:
        if evidence.kind == "none":
            return Outcome.uncertain, evidence.note
        return Outcome.failed, evidence.note

    # The run broke before it could look. Whether the post went out depends on
    # how far it got: once Share was tapped, we genuinely do not know.
    if error and _reached_submit(error):
        return Outcome.uncertain, "failed after submitting; could not check the account"
    return Outcome.failed, error or "run failed before submitting"


def _reached_submit(error: str) -> bool:
    return "budget" in error.lower() or "timeout" in error.lower() or "timed out" in error.lower()


def _failed_status(post: Post, retryable: bool) -> PostStatus:
    if retryable and post.attempts < MAX_ATTEMPTS:
        # Back to the queue with a delay (feature fa08).
        idx = min(post.attempts - 1, len(RETRY_BACKOFF_SECONDS) - 1)
        post.scheduled_at = utcnow() + timedelta(seconds=RETRY_BACKOFF_SECONDS[idx])
        return PostStatus.scheduled
    return PostStatus.failed


def _evidence_payload(evidence: Optional[Evidence], note: str) -> dict:
    if evidence is None:
        return {"kind": "none", "ref": "", "note": note}
    return {
        "kind": evidence.kind,
        "ref": evidence.ref,
        "note": evidence.note,
        "screenshots": evidence.screenshots,
        "checks": evidence.checks,
    }


def run_record(session: Session, run: Run) -> dict:
    """The hand-in artefact: one JSON object per publishing run."""
    steps = session.exec(
        select(RunStep).where(RunStep.run_id == run.id).order_by(RunStep.n)
    ).all()
    post = session.get(Post, run.post_id)
    account = session.get(Account, run.account_id) if run.account_id else None
    return {
        "run_id": run.id,
        "goal": run.goal,
        "account": account.handle if account else "",
        "platform": post.platform.value if post else "",
        "started_at": _iso(run.started_at),
        "ended_at": _iso(run.ended_at),
        "outcome": run.outcome.value if run.outcome else "uncertain",
        "evidence": run.evidence,
        "steps": [
            {"n": s.n, "action": s.action, "ok": bool(s.ok), "ms": s.ms, "detail": s.detail}
            for s in steps
        ],
        "totals": run.totals,
        "error": run.error,
    }


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None
