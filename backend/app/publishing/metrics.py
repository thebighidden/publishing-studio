"""Reading how a published post is actually doing, by looking at the phone.

This is the other half of the studio's promise. Publishing claims a post went
out and proves it with evidence; this module makes the same demand of
performance numbers. There is no platform API here — likes and comments are
read off the screen of the phone that published the post, through the same
named-target device layer, under the same budget and the same phone booking.

The honesty rules that apply to outcomes apply to numbers too:

  * a counter the screen did not show is `None`, never 0;
  * a post we could not find on the grid produces no row at all, so a missing
    reading can never be mistaken for a dead post;
  * "1.2K" is stored as 1200 and flagged approximate, because it is the right
    order of magnitude but cannot prove a delta of one.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from sqlmodel import Session, select

from ..config import METRICS_STEP_BUDGET, METRICS_TIMEOUT_SECONDS, METRICS_WINDOW_DAYS
from ..devices.registry import driver_for
from ..models import (
    Account,
    MetricPrecision,
    MetricSource,
    Phone,
    Post,
    PostMetric,
    PostStatus,
    utcnow,
)
from . import events
from .bookings import BOOKING_PREFIX, describe_booking  # noqa: F401 - re-exported
from .context import BudgetExceeded, RunContext, StepRecord
from .recipes.base import MetricReading, PostPayload
from .runner import recipe_for

# How often a post is worth looking at, by how old it is. Engagement moves fast
# in the first couple of hours and barely at all by the second day, so polling
# at a flat interval would either miss the interesting part or waste the phone.
CADENCE: list[tuple[timedelta, timedelta]] = [
    (timedelta(hours=2), timedelta(minutes=20)),
    (timedelta(hours=24), timedelta(hours=2)),
    (timedelta(days=METRICS_WINDOW_DAYS), timedelta(hours=12)),
]


class CollectionRefused(RuntimeError):
    """A guard said no before any phone was touched."""


@dataclass
class CollectionResult:
    post_id: str
    collected: bool
    note: str
    metric_id: Optional[int] = None


@dataclass
class Attempt:
    """The last time we went and looked, whether or not we found anything."""

    at: datetime
    note: str
    found: bool


# A miss writes no PostMetric row on purpose — a post we could not find is not
# a post with zero likes. The cost of that honesty is that the database cannot
# tell us we already tried, so without this log every tick would re-walk the
# same unfindable post forever and the phone would never be free. Observed in
# the wild: one post re-read every 10 seconds, indefinitely.
#
# Kept in memory rather than in a table because it is a scheduling hint, not
# evidence, and a restart is allowed to go and look once more.
_attempts: dict[str, Attempt] = {}


def last_attempt(post_id: str) -> Optional[Attempt]:
    return _attempts.get(post_id)


def _note_attempt(post_id: str, note: str, found: bool) -> None:
    _attempts[post_id] = Attempt(at=utcnow(), note=note, found=found)
    if len(_attempts) > 500:
        stale = utcnow() - timedelta(days=METRICS_WINDOW_DAYS)
        for key in [k for k, v in _attempts.items() if v.at < stale]:
            del _attempts[key]


# --------------------------------------------------------------------------
# guards and cadence
# --------------------------------------------------------------------------


def preflight(session: Session, post: Post) -> tuple[Account, Phone]:
    if post.status != PostStatus.published:
        raise CollectionRefused(
            f"post is {post.status.value}; only a published post has performance to read"
        )
    account = session.get(Account, post.account_id)
    if account is None:
        raise CollectionRefused("account no longer exists")
    if not account.phone_id:
        raise CollectionRefused(f"account @{account.handle} is not linked to a phone")
    phone = session.get(Phone, account.phone_id)
    if phone is None:
        raise CollectionRefused("linked phone no longer exists")
    if phone.busy_run_id:
        # Publishing always wins. A post going out matters more than a number.
        raise CollectionRefused(
            f"phone {phone.name} is busy: {describe_booking(phone.busy_run_id)}"
        )
    return account, phone


def latest_metric(session: Session, post_id: str) -> Optional[PostMetric]:
    return session.exec(
        select(PostMetric)
        .where(PostMetric.post_id == post_id)
        .order_by(PostMetric.collected_at.desc())
        .limit(1)
    ).first()


def _interval_for(age: timedelta) -> Optional[timedelta]:
    for max_age, interval in CADENCE:
        if age <= max_age:
            return interval
    return None  # past the window; stop polling


def is_due(post: Post, last: Optional[PostMetric], *, now: Optional[datetime] = None) -> bool:
    """Should this post be looked at right now?"""
    now = now or utcnow()
    if post.status != PostStatus.published or post.published_at is None:
        return False
    interval = _interval_for(now - post.published_at)
    if interval is None:
        return False
    # A look that found nothing still counts as a look. If this post is worth
    # checking every twenty minutes, a failed check is worth repeating in
    # twenty minutes — not on the next ten-second tick.
    tried = _attempts.get(post.id)
    if tried is not None and (now - tried.at) < interval:
        return False
    if last is None:
        return True
    return (now - last.collected_at) >= interval


def due_posts(session: Session, limit: int = 20) -> list[Post]:
    """Published posts inside the window whose next reading is owed."""
    cutoff = utcnow() - timedelta(days=METRICS_WINDOW_DAYS)
    rows = session.exec(
        select(Post)
        .where(
            Post.status == PostStatus.published,
            Post.published_at != None,  # noqa: E711
            Post.published_at >= cutoff,
        )
        .order_by(Post.published_at.desc())
    ).all()
    due = [p for p in rows if is_due(p, latest_metric(session, p.id))]
    return due[:limit]


# --------------------------------------------------------------------------
# the collection
# --------------------------------------------------------------------------


def collect(session: Session, post: Post, *, manual: bool = False) -> CollectionResult:
    """Open the post on its phone, read its counters, store what was seen."""
    account, phone = preflight(session, post)
    booking = f"{BOOKING_PREFIX}{post.id}"

    phone.busy_run_id = booking
    session.add(phone)
    session.commit()

    events.emit(
        "metrics.started",
        post_id=post.id,
        phone=phone.name,
        account=account.handle,
        platform=post.platform.value,
        manual=manual,
    )

    def sink(rec: StepRecord) -> None:
        # Deliberately not written to run_step: a collection is not a publishing
        # run and must not appear in the run history or the hand-in artefacts.
        # It is still streamed, so the operator can watch the phone work.
        events.emit(
            "metrics.step",
            post_id=post.id,
            n=rec.n,
            action=rec.action,
            ok=rec.ok,
            ms=rec.ms,
            detail=rec.detail,
        )

    driver = None
    ctx: Optional[RunContext] = None
    reading = MetricReading(found=False, note="collection did not run")
    recipe = recipe_for(post.platform)
    error: Optional[str] = None

    try:
        driver = driver_for(phone)
        ctx = RunContext(
            run_id=booking,
            driver=driver,
            sink=sink,
            step_budget=METRICS_STEP_BUDGET,
            timeout_s=METRICS_TIMEOUT_SECONDS,
        )
        payload = PostPayload(
            caption=post.caption,
            hashtags=post.hashtags or [],
            placement=post.placement,
            handle=account.handle,
        )
        reading = recipe.collect(ctx, payload)
    except BudgetExceeded as exc:
        error = f"collection stopped by its own budget: {exc}"
    except Exception as exc:  # noqa: BLE001 - a reading must never take the server down
        error = f"{type(exc).__name__}: {exc}"
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
        phone.busy_run_id = None
        session.add(phone)
        session.commit()

    if error or not reading.found:
        note = error or reading.note
        _note_attempt(post.id, note, found=False)
        events.emit("metrics.missed", post_id=post.id, note=note)
        return CollectionResult(post_id=post.id, collected=False, note=note)

    metric = PostMetric(
        post_id=post.id,
        account_id=account.id,
        platform=post.platform,
        likes=reading.likes,
        comments=reading.comments,
        views=reading.views,
        shares=reading.shares,
        saves=reading.saves,
        precision=(
            MetricPrecision.approximate if reading.approximate else MetricPrecision.exact
        ),
        source=MetricSource.device,
        matched_by=reading.matched_by,
        raw=reading.raw,
        screenshot=reading.screenshot,
        note=reading.note,
    )
    session.add(metric)
    session.commit()
    session.refresh(metric)
    _note_attempt(post.id, metric.note or "read off the phone", found=True)

    events.emit(
        "metrics.collected",
        post_id=post.id,
        likes=metric.likes,
        comments=metric.comments,
        views=metric.views,
        shares=metric.shares,
        approximate=reading.approximate,
        note=metric.note,
    )
    return CollectionResult(
        post_id=post.id, collected=True, note=metric.note or "", metric_id=metric.id
    )


def record_manual(
    session: Session,
    post: Post,
    *,
    likes: Optional[int] = None,
    comments: Optional[int] = None,
    views: Optional[int] = None,
    shares: Optional[int] = None,
    saves: Optional[int] = None,
    note: str = "",
) -> PostMetric:
    """A human typing in what they saw. Kept apart from device readings by
    `source`, so a chart can always say which numbers the studio observed
    itself."""
    metric = PostMetric(
        post_id=post.id,
        account_id=post.account_id,
        platform=post.platform,
        likes=likes,
        comments=comments,
        views=views,
        shares=shares,
        saves=saves,
        source=MetricSource.manual,
        note=note or "entered by the operator",
    )
    session.add(metric)
    session.commit()
    session.refresh(metric)
    events.emit("metrics.collected", post_id=post.id, likes=likes, comments=comments, manual=True)
    return metric
