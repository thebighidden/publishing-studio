from __future__ import annotations

import threading
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..db import get_session, session_scope
from ..models import (
    Account,
    Campaign,
    MediaAsset,
    Phone,
    Post,
    PostMetric,
    PostStatus,
    utcnow,
)
from ..publishing import metrics as collector
from ..publishing.scheduler import scheduler

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


class ManualMetricIn(BaseModel):
    """Numbers a human read on the phone themselves. Stored apart from device
    readings so a chart can always say where a figure came from."""

    likes: Optional[int] = Field(default=None, ge=0)
    comments: Optional[int] = Field(default=None, ge=0)
    views: Optional[int] = Field(default=None, ge=0)
    shares: Optional[int] = Field(default=None, ge=0)
    saves: Optional[int] = Field(default=None, ge=0)
    note: str = ""


def _metric_out(metric: PostMetric) -> dict[str, Any]:
    return {
        "id": metric.id,
        "post_id": metric.post_id,
        "likes": metric.likes,
        "comments": metric.comments,
        "views": metric.views,
        "shares": metric.shares,
        "saves": metric.saves,
        "engagement": metric.engagement(),
        "precision": metric.precision.value,
        "source": metric.source.value,
        "approximate": metric.precision.value == "approximate",
        "matched_by": metric.matched_by,
        "raw": metric.raw,
        "screenshot": f"/evidence/{metric.screenshot}" if metric.screenshot else None,
        "note": metric.note,
        "collected_at": metric.collected_at,
    }


def _attempt_out(post_id: str) -> Optional[dict[str, Any]]:
    attempt = collector.last_attempt(post_id)
    if attempt is None:
        return None
    return {"at": attempt.at, "note": attempt.note, "found": attempt.found}


def _history(session: Session, post_id: str) -> list[PostMetric]:
    return list(
        session.exec(
            select(PostMetric)
            .where(PostMetric.post_id == post_id)
            .order_by(PostMetric.collected_at)
        ).all()
    )


def _performance_row(session: Session, post: Post) -> dict[str, Any]:
    """One published post with its latest reading and how it got there.

    `latest` is None when nothing has been read yet, and the UI must show that
    as "not measured" rather than as zeros — the difference between a post
    nobody liked and a post nobody looked at is the whole point.
    """
    account = session.get(Account, post.account_id)
    asset = session.get(MediaAsset, post.media_id) if post.media_id else None
    campaign = session.get(Campaign, post.campaign_id) if post.campaign_id else None
    series = _history(session, post.id)
    latest = series[-1] if series else None
    first = series[0] if series else None

    delta: dict[str, Any] = {}
    if latest and first and latest.id != first.id:
        for field in ("likes", "comments", "views", "shares"):
            a, b = getattr(first, field), getattr(latest, field)
            if a is not None and b is not None:
                delta[field] = b - a

    return {
        "post_id": post.id,
        "title": post.title,
        "caption": post.caption,
        "platform": post.platform.value,
        "placement": post.placement,
        "handle": account.handle if account else "",
        "campaign_id": post.campaign_id,
        "campaign_name": campaign.name if campaign else "",
        "published_at": post.published_at,
        "post_url": post.post_url,
        "media_url": f"/media/{asset.filename}" if asset else None,
        "media_kind": asset.kind.value if asset else None,
        "latest": _metric_out(latest) if latest else None,
        "readings": len(series),
        "since_first_reading": delta,
        "measurable": bool(account and account.phone_id),
        # When a post has never produced a reading, the only honest thing to
        # show is whether anyone has been to look, and what they saw. Without
        # this the UI can only say "not measured" and leave the operator
        # wondering whether the collector is even running.
        "last_attempt": _attempt_out(post.id),
    }


@router.get("/posts")
def post_performance(
    session: Session = Depends(get_session),
    campaign_id: Optional[str] = Query(default=None),
    platform: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict]:
    """Every published post with the last numbers read off the phone."""
    stmt = select(Post).where(Post.status == PostStatus.published)
    if campaign_id:
        stmt = stmt.where(Post.campaign_id == campaign_id)
    if platform:
        stmt = stmt.where(Post.platform == platform)
    posts = session.exec(stmt.order_by(Post.published_at.desc()).limit(limit)).all()
    return [_performance_row(session, p) for p in posts]


@router.get("/summary")
def summary(session: Session = Depends(get_session)) -> dict[str, Any]:
    """Headline numbers for the Dashboard.

    Totals only count posts that have actually been measured, and the response
    says how many that is, so the figure can be shown with its own denominator
    instead of pretending to cover everything.
    """
    posts = session.exec(select(Post).where(Post.status == PostStatus.published)).all()
    rows = [_performance_row(session, p) for p in posts]
    measured = [r for r in rows if r["latest"]]

    def total(field: str) -> int:
        return sum(r["latest"][field] or 0 for r in measured)

    likes, comments, views = total("likes"), total("comments"), total("views")
    shares = total("shares")
    interactions = likes + comments + shares

    # Engagement rate is computed over one consistent set of posts: those whose
    # screen actually showed a view counter. Dividing every interaction we have
    # by only the views we have mixes two different populations and inflates the
    # figure -- recording one Instagram photo (212 likes, no view counter, as
    # Instagram does not show one on a photo) moved the headline rate from 14.8%
    # to 16.9% without a single new view being observed. The denominator count
    # travels with the rate so the UI can say what it is drawn from.
    with_views = [r for r in measured if r["latest"]["views"] is not None]
    rate_views = sum(r["latest"]["views"] for r in with_views)
    rate_interactions = sum(
        (r["latest"]["likes"] or 0) + (r["latest"]["comments"] or 0) + (r["latest"]["shares"] or 0)
        for r in with_views
    )
    best = max(
        measured,
        key=lambda r: r["latest"]["engagement"],
        default=None,
    )
    approx = any(r["latest"]["approximate"] for r in measured)

    return {
        "published_posts": len(rows),
        "measured_posts": len(measured),
        "unmeasured_posts": len(rows) - len(measured),
        "likes": likes,
        "comments": comments,
        "views": views,
        "shares": shares,
        "interactions": interactions,
        # Only meaningful where views were observed; without a denominator it is
        # not reported rather than guessed.
        "engagement_rate": round(rate_interactions / rate_views, 4) if rate_views else None,
        "engagement_basis_posts": len(with_views),
        "contains_approximate": approx,
        "best_post": best,
        "pending_collection": len(collector.due_posts(session, limit=50)),
        "auto_collect": not scheduler.is_paused(),
    }


@router.get("/posts/{post_id}")
def post_history(post_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    post = session.get(Post, post_id)
    if post is None:
        raise HTTPException(404, "post not found")
    series = _history(session, post_id)
    return {
        **_performance_row(session, post),
        "series": [_metric_out(m) for m in series],
        "due": collector.is_due(post, series[-1] if series else None),
    }


@router.post("/posts/{post_id}/collect", status_code=202)
def collect_now(post_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    """Operator-triggered reading.

    The guards run here so a refusal is immediate and explained; the walk across
    the phone then moves to a worker thread, because it takes the better part of
    a minute and the operator watches the step feed.
    """
    post = session.get(Post, post_id)
    if post is None:
        raise HTTPException(404, "post not found")
    try:
        collector.preflight(session, post)
    except collector.CollectionRefused as exc:
        raise HTTPException(409, str(exc)) from exc

    def work() -> None:
        with session_scope() as s:
            fresh = s.get(Post, post_id)
            if fresh is not None:
                try:
                    collector.collect(s, fresh, manual=True)
                except collector.CollectionRefused:
                    pass

    threading.Thread(target=work, name=f"metrics-{post_id}", daemon=True).start()
    return {"started": True, "post_id": post_id}


@router.post("/posts/{post_id}/manual")
def manual_reading(
    post_id: str, body: ManualMetricIn, session: Session = Depends(get_session)
) -> dict[str, Any]:
    post = session.get(Post, post_id)
    if post is None:
        raise HTTPException(404, "post not found")
    if post.status != PostStatus.published:
        raise HTTPException(409, "only a published post has performance to record")
    metric = collector.record_manual(
        session,
        post,
        likes=body.likes,
        comments=body.comments,
        views=body.views,
        shares=body.shares,
        saves=body.saves,
        note=body.note,
    )
    return _metric_out(metric)


@router.get("/due")
def due(session: Session = Depends(get_session)) -> list[dict]:
    """What the collector would pick up on its next pass, and on which phone."""
    out = []
    for post in collector.due_posts(session, limit=50):
        account = session.get(Account, post.account_id)
        phone = session.get(Phone, account.phone_id) if account and account.phone_id else None
        last = collector.latest_metric(session, post.id)
        out.append(
            {
                "post_id": post.id,
                "handle": account.handle if account else "",
                "platform": post.platform.value,
                "phone": phone.name if phone else None,
                "phone_busy": bool(phone and phone.busy_run_id),
                "published_at": post.published_at,
                "last_collected_at": last.collected_at if last else None,
                "age_hours": round((utcnow() - post.published_at).total_seconds() / 3600, 1)
                if post.published_at
                else None,
            }
        )
    return out
