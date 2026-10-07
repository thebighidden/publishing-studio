from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..agents import pipeline, specs
from ..db import get_session
from ..models import (
    Account,
    Campaign,
    CampaignStatus,
    MediaAsset,
    Post,
    PostStatus,
    utcnow,
)
from ..providers.base import ProviderError
from .schemas import (
    AutoScheduleIn,
    CampaignIn,
    CampaignUpdate,
    PlanIn,
    PostUpdate,
    RegenerateIn,
    ScheduleIn,
)

router = APIRouter(prefix="/api", tags=["campaigns"])

# Statuses a human may still edit. Once a post is in flight or out the door,
# editing it would describe something other than what was published.
EDITABLE = {PostStatus.draft, PostStatus.approved, PostStatus.scheduled, PostStatus.failed}


def _naive_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Clients send ISO strings with or without an offset; storage is UTC naive."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _campaign(session: Session, campaign_id: str) -> Campaign:
    row = session.get(Campaign, campaign_id)
    if row is None:
        raise HTTPException(404, "campaign not found")
    return row


def _post(session: Session, post_id: str) -> Post:
    row = session.get(Post, post_id)
    if row is None:
        raise HTTPException(404, "post not found")
    return row


def _media_out(asset: Optional[MediaAsset]) -> Optional[dict[str, Any]]:
    if asset is None:
        return None
    return {
        "id": asset.id,
        "kind": asset.kind.value,
        "url": f"/media/{asset.filename}",
        "prompt": asset.prompt,
        "provider": asset.provider,
        "model": asset.model,
        "width": asset.width,
        "height": asset.height,
        "duration_s": asset.duration_s,
        "cost": asset.cost,
    }


def _post_out(session: Session, post: Post) -> dict[str, Any]:
    account = session.get(Account, post.account_id)
    asset = session.get(MediaAsset, post.media_id) if post.media_id else None
    spec = specs.spec_for(post.platform, post.placement)
    return {
        **post.model_dump(),
        "handle": account.handle if account else "",
        "media": _media_out(asset),
        "spec": {
            "name": spec.name,
            "caption_max": spec.caption_max,
            "hashtag_max": spec.hashtag_max,
            "aspects": spec.aspects,
            "note": spec.note,
        },
        "editable": post.status in EDITABLE,
    }


def _campaign_out(session: Session, campaign: Campaign, *, with_posts: bool = False) -> dict:
    posts = session.exec(
        select(Post).where(Post.campaign_id == campaign.id).order_by(Post.created_at)
    ).all()
    counts: dict[str, int] = {}
    for p in posts:
        counts[p.status.value] = counts.get(p.status.value, 0) + 1
    out: dict[str, Any] = {
        **campaign.model_dump(),
        "post_count": len(posts),
        "post_counts": counts,
        "blocking_specs": sum(1 for p in posts if not (p.spec_check or {}).get("ok", True)),
        "gates": {
            "plan_approved": campaign.plan_approved_at is not None,
            "content_approved": campaign.content_approved_at is not None,
        },
    }
    if with_posts:
        out["posts"] = [_post_out(session, p) for p in posts]
    return out


# ---------------- campaigns ----------------


@router.get("/campaigns")
def list_campaigns(session: Session = Depends(get_session)) -> list[dict]:
    rows = session.exec(select(Campaign).order_by(Campaign.created_at.desc())).all()
    return [_campaign_out(session, c) for c in rows]


@router.post("/campaigns", status_code=201)
def create_campaign(body: CampaignIn, session: Session = Depends(get_session)) -> dict:
    campaign = Campaign(**{**body.model_dump(), "deadline": _naive_utc(body.deadline)})
    session.add(campaign)
    session.commit()
    session.refresh(campaign)
    return _campaign_out(session, campaign, with_posts=True)


@router.get("/campaigns/{campaign_id}")
def get_campaign(campaign_id: str, session: Session = Depends(get_session)) -> dict:
    return _campaign_out(session, _campaign(session, campaign_id), with_posts=True)


@router.patch("/campaigns/{campaign_id}")
def update_campaign(
    campaign_id: str, body: CampaignUpdate, session: Session = Depends(get_session)
) -> dict:
    campaign = _campaign(session, campaign_id)
    data = body.model_dump(exclude_unset=True)
    if "deadline" in data:
        data["deadline"] = _naive_utc(data["deadline"])
    for field, value in data.items():
        setattr(campaign, field, value)
    # Editing the brief or the plan invalidates the approval that was given for
    # the old version (gate 6A).
    if {"goal", "audience", "message", "key_facts", "plan", "account_ids"} & set(data):
        campaign.plan_approved_at = None
    session.add(campaign)
    session.commit()
    session.refresh(campaign)
    return _campaign_out(session, campaign, with_posts=True)


@router.delete("/campaigns/{campaign_id}", status_code=204, response_model=None)
def delete_campaign(campaign_id: str, session: Session = Depends(get_session)) -> None:
    campaign = _campaign(session, campaign_id)
    posts = session.exec(select(Post).where(Post.campaign_id == campaign.id)).all()
    live = [p for p in posts if p.status == PostStatus.publishing]
    if live:
        raise HTTPException(409, "a post from this campaign is publishing right now")
    for post in posts:
        session.delete(post)
    session.delete(campaign)
    session.commit()


# ---------------- the pipeline and its two gates ----------------


@router.post("/campaigns/{campaign_id}/plan")
def plan(campaign_id: str, body: PlanIn, session: Session = Depends(get_session)) -> dict:
    campaign = _campaign(session, campaign_id)
    try:
        pipeline.plan_campaign(session, campaign, item_count=body.item_count)
    except (ProviderError, ValueError) as exc:
        raise HTTPException(502, f"the writer could not produce a plan: {exc}") from exc
    session.refresh(campaign)
    return _campaign_out(session, campaign, with_posts=True)


@router.post("/campaigns/{campaign_id}/approve-plan")
def approve_plan(campaign_id: str, session: Session = Depends(get_session)) -> dict:
    """Gate 6A."""
    campaign = _campaign(session, campaign_id)
    try:
        pipeline.approve_plan(session, campaign)
    except pipeline.GateError as exc:
        raise HTTPException(409, str(exc)) from exc
    return _campaign_out(session, campaign, with_posts=True)


@router.post("/campaigns/{campaign_id}/produce")
def produce(campaign_id: str, session: Session = Depends(get_session)) -> dict:
    campaign = _campaign(session, campaign_id)
    try:
        pipeline.produce(session, campaign)
    except pipeline.GateError as exc:
        raise HTTPException(409, str(exc)) from exc
    session.refresh(campaign)
    return _campaign_out(session, campaign, with_posts=True)


@router.post("/campaigns/{campaign_id}/approve-content")
def approve_content(campaign_id: str, session: Session = Depends(get_session)) -> dict:
    """Gate 6B. Nothing publishes automatically without passing this."""
    campaign = _campaign(session, campaign_id)
    try:
        pipeline.approve_content(session, campaign)
    except pipeline.GateError as exc:
        raise HTTPException(409, str(exc)) from exc
    session.refresh(campaign)
    return _campaign_out(session, campaign, with_posts=True)


# ---------------- scheduling ----------------


@router.post("/campaigns/{campaign_id}/schedule")
def schedule(campaign_id: str, body: ScheduleIn, session: Session = Depends(get_session)) -> dict:
    campaign = _campaign(session, campaign_id)
    for item in body.items:
        post = _post(session, item.post_id)
        if post.campaign_id != campaign.id:
            raise HTTPException(400, f"post {post.id} is not part of this campaign")
        if post.approved_at is None:
            raise HTTPException(409, f"{post.title!r} has not passed gate 6B")
        post.scheduled_at = _naive_utc(item.scheduled_at)
        post.tz = item.tz
        post.status = PostStatus.scheduled
        session.add(post)
    campaign.status = CampaignStatus.scheduled
    session.add(campaign)
    session.commit()
    return _campaign_out(session, campaign, with_posts=True)


@router.post("/campaigns/{campaign_id}/auto-schedule")
def auto_schedule(
    campaign_id: str, body: AutoScheduleIn, session: Session = Depends(get_session)
) -> dict:
    """Spread approved posts out from a start time.

    Posts on the same account are spaced by at least the account cooldown, which
    is how rule R3 stays true even when a human asks for everything at once.
    """
    campaign = _campaign(session, campaign_id)
    posts = session.exec(
        select(Post)
        .where(Post.campaign_id == campaign.id, Post.approved_at != None)  # noqa: E711
        .order_by(Post.created_at)
    ).all()
    if not posts:
        raise HTTPException(409, "no approved posts to schedule; pass gate 6B first")

    start = _naive_utc(body.start_at) or (utcnow() + timedelta(minutes=2))
    spacing = timedelta(minutes=body.spacing_minutes)
    per_account: dict[str, datetime] = {}

    for index, post in enumerate(posts):
        when = start + spacing * index
        earliest = per_account.get(post.account_id)
        if earliest and when < earliest:
            when = earliest
        per_account[post.account_id] = when + spacing
        post.scheduled_at = when
        post.tz = body.tz
        post.status = PostStatus.scheduled
        session.add(post)

    campaign.status = CampaignStatus.scheduled
    session.add(campaign)
    session.commit()
    return _campaign_out(session, campaign, with_posts=True)


# ---------------- posts ----------------


@router.get("/posts")
def list_posts(
    session: Session = Depends(get_session),
    campaign_id: Optional[str] = Query(default=None),
    status: Optional[PostStatus] = Query(default=None),
) -> list[dict]:
    """Feeds the calendar."""
    stmt = select(Post)
    if campaign_id:
        stmt = stmt.where(Post.campaign_id == campaign_id)
    if status:
        stmt = stmt.where(Post.status == status)
    rows = session.exec(stmt.order_by(Post.scheduled_at, Post.created_at)).all()
    return [_post_out(session, p) for p in rows]


@router.get("/posts/{post_id}")
def get_post(post_id: str, session: Session = Depends(get_session)) -> dict:
    return _post_out(session, _post(session, post_id))


@router.patch("/posts/{post_id}")
def update_post(
    post_id: str, body: PostUpdate, session: Session = Depends(get_session)
) -> dict:
    post = _post(session, post_id)
    if post.status not in EDITABLE:
        raise HTTPException(409, f"a {post.status.value} post cannot be edited")

    data = body.model_dump(exclude_unset=True)
    if "scheduled_at" in data:
        data["scheduled_at"] = _naive_utc(data["scheduled_at"])
    if data.get("media_id") and session.get(MediaAsset, data["media_id"]) is None:
        raise HTTPException(400, "media asset not found")
    for field, value in data.items():
        setattr(post, field, value)

    # Changing what gets published revokes the approval that was given for the
    # previous wording (gate 6B).
    if {"caption", "hashtags", "media_id", "placement"} & set(data):
        post.approved_at = None
        if post.status in (PostStatus.approved, PostStatus.scheduled):
            post.status = PostStatus.draft
        campaign = session.get(Campaign, post.campaign_id) if post.campaign_id else None
        if campaign and campaign.content_approved_at:
            campaign.content_approved_at = None
            campaign.status = CampaignStatus.content_review
            session.add(campaign)

    pipeline.recheck(session, post)
    session.commit()
    session.refresh(post)
    return _post_out(session, post)


@router.post("/posts/{post_id}/regenerate")
def regenerate(
    post_id: str, body: RegenerateIn, session: Session = Depends(get_session)
) -> dict:
    post = _post(session, post_id)
    if post.status not in EDITABLE:
        raise HTTPException(409, f"a {post.status.value} post cannot be edited")
    try:
        pipeline.regenerate_media(
            session, post, prompt=body.prompt, kind=body.kind, aspect=body.aspect
        )
    except ProviderError as exc:
        raise HTTPException(502, str(exc)) from exc

    post.approved_at = None
    if post.status in (PostStatus.approved, PostStatus.scheduled):
        post.status = PostStatus.draft
    pipeline.recheck(session, post)
    session.commit()
    session.refresh(post)
    return _post_out(session, post)


@router.delete("/posts/{post_id}", status_code=204, response_model=None)
def delete_post(post_id: str, session: Session = Depends(get_session)) -> None:
    post = _post(session, post_id)
    if post.status == PostStatus.publishing:
        raise HTTPException(409, "this post is publishing right now")
    session.delete(post)
    session.commit()
