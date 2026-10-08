"""The studio's generation queue, run on the server.

A browser tab only submits jobs and watches them; the work happens here, so a
two-minute video keeps rendering after the tab is closed. Jobs are grouped
into lanes (one per provider): a cloud model runs several jobs at once, a
local GPU or the simulator one at a time.

Honesty rules, same spirit as publishing:
- A job interrupted by a restart is marked failed, never silently re-run: the
  model may already have been charged for it.
- Only errors the provider marks retryable (busy, rate limited, 5xx) are
  retried, a few times with back-off.
"""

from __future__ import annotations

import logging
import threading
from datetime import timedelta
from typing import Any, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from .config import DATA_DIR
from .db import session_scope
from .models import GenerationJob, utcnow
from .providers import control
from .providers.base import ProviderError
from .publishing import events

log = logging.getLogger(__name__)

REFS_DIR = DATA_DIR / "job_refs"
REFS_DIR.mkdir(parents=True, exist_ok=True)
MAX_RUNNING = 4
MAX_ATTEMPTS = 3
FINISHED = ("done", "failed", "canceled")
_EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}


def _lane_limit(lane: str) -> int:
    try:
        return max(1, int(lane.rsplit(":", 1)[1]))
    except (IndexError, ValueError):
        return 1


def _drop_reference(job: GenerationJob) -> None:
    if job.reference_file:
        (REFS_DIR / job.reference_file).unlink(missing_ok=True)
        job.reference_file = None


def _emit(job: GenerationJob) -> None:
    events.emit("creative.job", job_id=job.id, status=job.status, batch=job.batch, asset_id=job.asset_id)


# ---------------- operations the API calls ----------------


def submit(
    session: Session,
    request: dict[str, Any],
    *,
    reference_bytes: Optional[bytes],
    reference_mime: str,
    batch: str,
    model_label: str,
    lane: str,
) -> GenerationJob:
    job = GenerationJob(
        kind=request["kind"],
        batch=batch,
        label=request["prompt"][:120],
        model_label=model_label,
        lane=lane,
        request=request,
    )
    if reference_bytes:
        job.reference_file = f"{job.id}{_EXT.get(reference_mime, '.png')}"
        job.reference_mime = reference_mime
        (REFS_DIR / job.reference_file).write_bytes(reference_bytes)
    session.add(job)
    session.commit()
    session.refresh(job)
    _emit(job)
    worker.wake()
    return job


def cancel(session: Session, job: GenerationJob) -> None:
    if job.status == "queued":
        job.status = "canceled"
        job.error = "Removed from the queue."
        job.finished_at = utcnow()
    elif job.status == "running":
        # The worker asks the provider to stop; Higgsfield can while the request
        # is still queued on its side. Once generating, it finishes regardless.
        job.cancel_requested = True
    session.add(job)
    session.commit()
    session.refresh(job)
    _emit(job)


def retry(session: Session, job: GenerationJob) -> None:
    job.status = "queued"
    job.error = None
    job.attempts = 0
    job.not_before = None
    job.cancel_requested = False
    job.remote_id = None
    job.started_at = job.finished_at = None
    session.add(job)
    session.commit()
    session.refresh(job)
    _emit(job)
    worker.wake()


def dismiss(session: Session, *, ids: list[str], finished: bool) -> int:
    stmt = select(GenerationJob).where(GenerationJob.dismissed == False, GenerationJob.status.in_(FINISHED))  # noqa: E712
    if ids:
        stmt = stmt.where(GenerationJob.id.in_(ids))
    elif not finished:
        return 0
    rows = session.exec(stmt).all()
    for job in rows:
        job.dismissed = True
        _drop_reference(job)
        session.add(job)
    session.commit()
    return len(rows)


# ---------------- the worker ----------------


class JobWorker:
    def __init__(self) -> None:
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._running: dict[str, str] = {}  # job id -> lane
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self._recover()
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="studio-jobs", daemon=True)
        self._thread.start()

    def shutdown(self) -> None:
        self._stop.set()
        self._wake.set()

    def wake(self) -> None:
        self._wake.set()

    def _recover(self) -> None:
        with session_scope() as session:
            for job in session.exec(select(GenerationJob).where(GenerationJob.status == "running")).all():
                job.status = "failed"
                job.finished_at = utcnow()
                job.error = (
                    "The studio restarted while this was generating. Retry it; "
                    "if the model had already started, that attempt may have been charged."
                )
                session.add(job)

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._dispatch()
            except Exception:  # noqa: BLE001
                log.exception("studio job dispatch failed")
            self._wake.wait(1.0)
            self._wake.clear()

    def _dispatch(self) -> None:
        now = utcnow()
        with session_scope() as session:
            queued = session.exec(
                select(GenerationJob).where(GenerationJob.status == "queued").order_by(GenerationJob.created_at).limit(100)
            ).all()
            for job in queued:
                with self._lock:
                    if len(self._running) >= MAX_RUNNING:
                        return
                    in_lane = sum(1 for lane in self._running.values() if lane == job.lane)
                    if in_lane >= _lane_limit(job.lane) or (job.not_before and job.not_before > now):
                        continue
                    self._running[job.id] = job.lane
                job.status = "running"
                job.started_at = utcnow()
                job.attempts += 1
                session.add(job)
                session.commit()
                _emit(job)
                threading.Thread(target=self._run, args=(job.id,), name=f"studio-job-{job.id}", daemon=True).start()

    def _run(self, job_id: str) -> None:
        from .api import creative as creative_api  # the API module owns generation; imported late to avoid a cycle

        outcome: dict[str, Any] = {}
        try:
            with session_scope() as session:
                job = session.get(GenerationJob, job_id)
                reference = None
                if job.reference_file and (REFS_DIR / job.reference_file).exists():
                    reference = (REFS_DIR / job.reference_file).read_bytes()
                if job.request.get("reference_uploaded") and reference is None:
                    raise HTTPException(410, "The uploaded reference image is no longer kept. Upload it again and generate.")
                ctl = control.JobControl(cancelled=lambda: _cancel_requested(job_id), on_remote_id=lambda rid: _set_remote(job_id, rid))
                token = control.current.set(ctl)
                try:
                    prep = creative_api._prepare(session, job.request, reference, job.reference_mime or "image/png")
                    asset = creative_api._execute(session, job.request, prep)
                    outcome = {"status": "done", "asset_id": asset.id}
                finally:
                    control.current.reset(token)
        except control.Cancelled:
            outcome = {"status": "canceled", "error": "Stopped before the model started. Nothing was charged."}
        except HTTPException as exc:
            outcome = {"status": "failed", "error": str(exc.detail)}
        except ProviderError as exc:
            outcome = {"status": "failed", "error": str(exc), "retryable": exc.retryable}
        except Exception as exc:  # noqa: BLE001
            log.exception("studio job %s crashed", job_id)
            outcome = {"status": "failed", "error": f"{type(exc).__name__}: {exc}"}
        finally:
            with self._lock:
                self._running.pop(job_id, None)
            self._finish(job_id, outcome)
            self.wake()

    def _finish(self, job_id: str, outcome: dict[str, Any]) -> None:
        with session_scope() as session:
            job = session.get(GenerationJob, job_id)
            if job is None:
                return
            if outcome.get("retryable") and job.attempts < MAX_ATTEMPTS and not job.cancel_requested:
                job.status = "queued"
                job.not_before = utcnow() + timedelta(seconds=15 * job.attempts)
                job.error = f"Retrying: {outcome['error']}"
            else:
                job.status = outcome.get("status", "failed")
                job.error = outcome.get("error")
                job.asset_id = outcome.get("asset_id")
                job.finished_at = utcnow()
                if job.status in ("done", "canceled"):
                    _drop_reference(job)
            session.add(job)
            session.commit()
            session.refresh(job)
            _emit(job)


def _cancel_requested(job_id: str) -> bool:
    with session_scope() as session:
        job = session.get(GenerationJob, job_id)
        return bool(job and job.cancel_requested)


def _set_remote(job_id: str, remote_id: str) -> None:
    with session_scope() as session:
        job = session.get(GenerationJob, job_id)
        if job is not None:
            job.remote_id = remote_id
            session.add(job)


worker = JobWorker()
