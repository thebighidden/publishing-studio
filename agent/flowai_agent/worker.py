"""Runs FlowAI's publishing jobs on this computer's phones.

One thread per phone: ask FlowAI for the job booked on it, drive the platform's app through
named targets only (R6), report every step as it happens (each report is also the run's
heartbeat), upload the screenshots that prove what happened, and finish the run honestly:
confirmed with proof, failed, or uncertain when the post may have gone out but nothing shows it.
"""

from __future__ import annotations

import logging
import threading
import time
import traceback
import uuid
from typing import Any, Optional

from . import config
from .api import ApiError, FlowAI
from .devices.base import DeviceDriver, DeviceError
from .publishing.context import BudgetExceeded, RunContext, StepRecord
from .publishing.recipes.base import Evidence, PostPayload, PublishFailed, Recipe
from .publishing.recipes.instagram import InstagramRecipe
from .publishing.recipes.x import XRecipe

log = logging.getLogger("flowai.agent")

RECIPES: dict[str, type[Recipe]] = {"instagram": InstagramRecipe, "x": XRecipe}
# Taps that submit the post. Once one succeeded, a run that breaks afterwards can't know
# whether the post went out, so it ends uncertain rather than failed (and isn't re-posted blind).
SUBMIT_TARGETS = ("instagram.share", "x.post_button", "x.post")
# What FlowAI accepts per step (AgentController::steps).
ACTION_MAX, NOTE_MAX = 60, 200


def driver_for(ref: str, options: Optional[dict[str, Any]] = None) -> DeviceDriver:
    if ref.startswith("sim-"):
        from .devices.simulator import SimulatorDriver

        return SimulatorDriver(ref, options)
    from .devices.adb import AdbDriver

    return AdbDriver(ref)


class StepReporter:
    """Collects the run's steps and sends them to FlowAI in small batches."""

    def __init__(self, api: FlowAI, run_id: str):
        self.api, self.run_id = api, run_id
        self.pending: list[dict[str, Any]] = []
        self.last_flush = time.monotonic()
        self.lock = threading.Lock()

    def add(self, rec: StepRecord) -> None:
        with self.lock:
            self.pending.append({
                "action": rec.action[:ACTION_MAX],
                "ok": rec.ok,
                "ms": max(0, min(int(rec.ms), 600_000)),
                "note": (rec.detail or None) and rec.detail[:NOTE_MAX],
            })
            if len(self.pending) >= 4 or time.monotonic() - self.last_flush > 3:
                self._flush()

    def flush(self) -> None:
        with self.lock:
            self._flush()

    def _flush(self) -> None:
        if not self.pending:
            return
        batch, self.pending = self.pending, []
        self.last_flush = time.monotonic()
        try:
            self.api.steps(self.run_id, batch)
        except ApiError as exc:
            log.warning("could not report steps for run %s: %s", self.run_id, exc)


def decide(evidence: Optional[Evidence], error: Optional[str], ctx: Optional[RunContext]) -> tuple[str, str]:
    """Sending a command is not publishing a post. `confirmed` needs something observed after
    the fact; anything ambiguous is `uncertain`, never a guess in either direction."""
    if evidence is not None:
        if evidence.confirmed:
            return "confirmed", evidence.note
        return ("uncertain" if evidence.kind == "none" else "failed"), evidence.note
    submitted = ctx is not None and any(
        s.ok and s.action.startswith("tap:") and s.action[4:] in SUBMIT_TARGETS for s in ctx.steps
    )
    if submitted:
        return "uncertain", f"stopped after tapping publish ({error}); could not check the account"
    return "failed", error or "the run failed before publishing"


def run_job(api: FlowAI, ref: str, job: dict[str, Any], phone_lock: threading.Lock) -> str:
    run_id = job["run_id"]
    account = job.get("account") or {}
    post = job.get("post") or {}
    limits = job.get("limits") or {}
    platform = account.get("platform", "")
    log.info("run %s on %s: %s (%s)", run_id, ref, job.get("goal"), platform)

    reporter = StepReporter(api, run_id)
    recipe_cls = RECIPES.get(platform)
    if recipe_cls is None:
        api.finish(run_id, "failed", f"The phone agent has no recipe for {platform} yet (it posts to Instagram and X).")
        return "failed"

    media = job.get("media") or []
    if len(media) > 1:
        api.finish(run_id, "failed", f"This post has {len(media)} media items; the phone recipe posts one image or video at a time.")
        return "failed"

    ctx: Optional[RunContext] = None
    driver: Optional[DeviceDriver] = None
    evidence: Optional[Evidence] = None
    error: Optional[str] = None
    recipe = recipe_cls()
    with phone_lock:  # the live view's remote control waits while a run drives the phone
        try:
            driver = driver_for(ref, {"handle": account.get("handle", "")})
            ctx = RunContext(
                run_id=run_id,
                driver=driver,
                sink=reporter.add,
                step_budget=int(limits.get("step_budget") or config.RUN_STEP_BUDGET),
                timeout_s=int(limits.get("hard_timeout_seconds") or config.RUN_TIMEOUT_SECONDS),
            )
            payload = PostPayload(
                caption=post.get("caption") or "",
                placement=post.get("placement") or ("reel" if post.get("format") == "video" else "feed"),
                handle=account.get("handle", ""),
            )
            if media:
                item = media[0]
                suffix = ".mp4" if item.get("kind") == "video" else (".jpg" if "jpeg" in (item.get("mime") or "") else ".png")
                local = api.download(item["url"], config.MEDIA_DIR / f"{run_id}{suffix}")
                # Transfer before the app opens, so the picker shows it first.
                payload.media_path = ctx.push_media(str(local))

            baseline = recipe.baseline(ctx)
            recipe.publish(ctx, payload)
            evidence = recipe.verify(ctx, payload, baseline)
        except BudgetExceeded as exc:
            error = f"run stopped by its own budget: {exc}"
        except PublishFailed as exc:
            error = str(exc)
        except DeviceError as exc:
            error = f"device error: {exc}"
        except Exception as exc:  # noqa: BLE001 - one bad run must not stop the agent
            error = f"{type(exc).__name__}: {exc}"
            log.error("run %s crashed:\n%s", run_id, traceback.format_exc())
        finally:
            if ctx is not None:
                try:
                    recipe.cleanup(ctx)
                except Exception:  # noqa: BLE001
                    pass
            reporter.flush()

        outcome, note = decide(evidence, error, ctx)
        shots = [config.EVIDENCE_DIR / s for s in (evidence.screenshots if evidence else []) if s]
        if not shots and driver is not None:
            # A failed run still shows what the phone ended on.
            try:
                path = config.EVIDENCE_DIR / f"{run_id}_final_{uuid.uuid4().hex[:6]}.png"
                path.write_bytes(driver.screenshot())
                shots = [path]
            except Exception:  # noqa: BLE001
                pass
        for path in shots:
            if path.is_file():
                try:
                    api.screenshot(run_id, path)
                except ApiError as exc:
                    log.warning("screenshot upload failed: %s", exc)

        post_url = (evidence.checks.get("post_url") if evidence else None) or None
        if outcome == "confirmed" and not shots and not post_url:
            outcome, note = "uncertain", f"{note}; but no screenshot could be uploaded as proof"
        api.finish(run_id, outcome, note or "", post_url)
        log.info("run %s finished: %s — %s", run_id, outcome, note)
        if driver is not None:
            try:
                driver.close()
            except Exception:  # noqa: BLE001
                pass
        return outcome


class PhoneWorker(threading.Thread):
    """Polls FlowAI for one phone's jobs until stopped."""

    def __init__(self, api: FlowAI, ref: str, lock: threading.Lock):
        super().__init__(name=f"phone-{ref}", daemon=True)
        self.api, self.ref, self.lock = api, ref, lock
        self.stop = threading.Event()
        self.busy = False
        self._last_screen = 0.0

    def run(self) -> None:
        while not self.stop.is_set():
            try:
                job = self.api.next_job(self.ref)
                if job:
                    self.busy = True
                    try:
                        run_job(self.api, self.ref, job, self.lock)
                    finally:
                        self.busy = False
                    continue
                self._idle_screen()
            except ApiError as exc:
                log.warning("%s: %s", self.ref, exc)
            except Exception:  # noqa: BLE001
                log.error("%s: worker error\n%s", self.ref, traceback.format_exc())
            self.stop.wait(config.POLL_SECONDS)

    def _idle_screen(self) -> None:
        """Keep the Phones page thumbnail fresh while nothing is running."""
        every = float(config.IDLE_SCREEN_SECONDS)
        if every <= 0 or time.monotonic() - self._last_screen < every:
            return
        self._last_screen = time.monotonic()
        try:
            self.api.screen(self.ref, driver_for(self.ref).screenshot())
        except (ApiError, DeviceError) as exc:
            log.debug("%s: idle screen skipped: %s", self.ref, exc)
