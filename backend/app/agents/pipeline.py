from __future__ import annotations

import json
import re
import uuid
from typing import Any, Optional

from sqlmodel import Session, select

from ..config import MEDIA_DIR
from ..models import (
    Account,
    Campaign,
    CampaignStatus,
    MediaAsset,
    MediaKind,
    Platform,
    Post,
    PostStatus,
    ProviderKind,
    utcnow,
)
from ..providers import registry
from ..providers.base import ProviderError
from ..publishing import events
from . import specs

SYSTEM = (
    "You are the editorial engine of a social publishing studio. You write copy that a "
    "real brand would publish: concrete, specific, no hype, no filler adjectives, no "
    "emoji unless the account's profile asks for them. Answer with JSON only."
)


class GateError(RuntimeError):
    """An approval gate was not satisfied."""


# --------------------------------------------------------------------------
# agent 1: the writer plans the campaign
# --------------------------------------------------------------------------


def plan_campaign(session: Session, campaign: Campaign, item_count: int = 3) -> dict[str, Any]:
    """Produces the plan a human then approves at gate 6A."""
    text, cfg = registry.get_text(session)
    accounts = _accounts(session, campaign)
    voices = "; ".join(
        f"@{a.handle} ({a.platform.value}): {a.editorial_profile.get('tone', 'no tone set')}"
        for a in accounts
    ) or "no accounts attached yet"

    prompt = f"""<<task:plan>>
Plan a short social campaign. Return JSON only.

Goal: {campaign.goal}
Audience: {campaign.audience}
Message: {campaign.message}
Key facts: {campaign.key_facts}
Accounts: {voices}
Count: {item_count}

Return this exact shape:
{{
  "summary": "one sentence on the approach",
  "tone": "how this should sound",
  "items": [
    {{
      "title": "short internal name",
      "angle": "what this piece does",
      "caption_brief": "what the caption should say",
      "visual_brief": "what the image or video should show",
      "media_kind": "image" or "video",
      "placement": "feed" or "reel" or "story"
    }}
  ]
}}"""

    raw = text.complete(prompt, system=SYSTEM, json_object=True, max_tokens=2000)
    plan = _json(raw.text)
    plan.setdefault("items", [])
    plan["generated_by"] = registry.describe(cfg, ProviderKind.text)
    plan["generated_at"] = utcnow().isoformat()

    campaign.plan = plan
    campaign.status = CampaignStatus.plan_review
    campaign.plan_approved_at = None
    session.add(campaign)
    session.commit()
    events.emit("campaign.planned", campaign_id=campaign.id, items=len(plan["items"]))
    return plan


# --------------------------------------------------------------------------
# agents 2-5: visual director, media team, adapter, QA
# --------------------------------------------------------------------------


def produce(session: Session, campaign: Campaign) -> list[Post]:
    """Turns the approved plan into real posts with real media.

    Refuses to start until gate 6A has been passed, because production is the
    expensive step and a human said the plan was right.
    """
    if campaign.plan_approved_at is None:
        raise GateError("the plan has not been approved (gate 6A)")

    accounts = _accounts(session, campaign)
    if not accounts:
        raise GateError("the campaign has no accounts attached")

    items = campaign.plan.get("items") or []
    if not items:
        raise GateError("the approved plan has no items")

    campaign.status = CampaignStatus.producing
    session.add(campaign)
    session.commit()
    events.emit("campaign.producing", campaign_id=campaign.id, items=len(items))

    created: list[Post] = []
    for index, item in enumerate(items):
        try:
            created.extend(_produce_item(session, campaign, item, accounts, index))
        except Exception as exc:  # noqa: BLE001 - one bad item must not sink the batch
            events.emit(
                "campaign.item_failed",
                campaign_id=campaign.id,
                item=item.get("title", f"#{index + 1}"),
                error=f"{type(exc).__name__}: {exc}",
            )

    campaign.status = CampaignStatus.content_review
    campaign.content_approved_at = None
    session.add(campaign)
    session.commit()
    events.emit("campaign.produced", campaign_id=campaign.id, posts=len(created))
    return created


def _produce_item(
    session: Session,
    campaign: Campaign,
    item: dict[str, Any],
    accounts: list[Account],
    index: int,
) -> list[Post]:
    placement = item.get("placement") or "feed"
    media_kind = MediaKind.video if item.get("media_kind") == "video" else MediaKind.image

    # The master asset is generated once and then adapted per account, rather
    # than paying for one generation per account.
    master_account = accounts[0]
    aspect = specs.default_aspect(master_account.platform, placement)
    asset = _generate_media(session, campaign, item, media_kind, aspect)

    posts: list[Post] = []
    for account in accounts:
        spec = specs.spec_for(account.platform, placement)
        use_placement = placement if (account.platform, placement) in specs.SPECS else "feed"
        caption, hashtags = _write_caption(session, campaign, item, account, use_placement)

        report = specs.check(
            account.platform,
            use_placement,
            caption=caption,
            hashtags=hashtags,
            media_kind=media_kind,
            width=asset.width if asset else None,
            height=asset.height if asset else None,
            duration_s=asset.duration_s if asset else None,
        )

        post = Post(
            campaign_id=campaign.id,
            account_id=account.id,
            platform=account.platform,
            title=item.get("title") or f"Item {index + 1}",
            caption=caption,
            hashtags=hashtags,
            media_id=asset.id if asset else None,
            placement=use_placement,
            status=PostStatus.draft,
            spec_check=report.to_dict(),
        )
        session.add(post)
        posts.append(post)
        events.emit(
            "campaign.post_drafted",
            campaign_id=campaign.id,
            account=account.handle,
            title=post.title,
            spec_ok=report.ok,
            spec=spec.name,
        )

    session.commit()
    for p in posts:
        session.refresh(p)
    return posts


def _generate_media(
    session: Session,
    campaign: Campaign,
    item: dict[str, Any],
    kind: MediaKind,
    aspect: str,
) -> Optional[MediaAsset]:
    text, _ = registry.get_text(session)

    # Visual director: a brief becomes a prompt a generator can actually use.
    try:
        vis = _json(
            text.complete(
                f"""<<task:visual>>
Turn this into one image-generation prompt. Return JSON only.

Brief: {item.get('visual_brief') or item.get('angle') or campaign.message}
Message: {campaign.message}
Audience: {campaign.audience}

Return: {{"prompt": "...", "negative": "..."}}""",
                system=SYSTEM,
                json_object=True,
                max_tokens=500,
            ).text
        )
        visual_prompt = vis.get("prompt") or item.get("visual_brief") or campaign.message
    except (ProviderError, ValueError):
        visual_prompt = item.get("visual_brief") or campaign.message

    try:
        asset = _render_media(session, visual_prompt, kind, aspect)
    except ProviderError as exc:
        events.emit("campaign.media_failed", campaign_id=campaign.id, error=str(exc))
        return None

    events.emit(
        "campaign.media_ready",
        campaign_id=campaign.id,
        media_id=asset.id,
        media_kind=kind.value,
        model=asset.model,
    )
    return asset


def _render_media(
    session: Session, prompt: str, kind: MediaKind, aspect: str
) -> MediaAsset:
    """Generate, write to disk and record one asset. Raises ProviderError."""
    if kind == MediaKind.video:
        video, _ = registry.get_video(session)
        result = video.generate(prompt, aspect=aspect, duration_s=6)
    else:
        image, _ = registry.get_image(session)
        result = image.generate(prompt, aspect=aspect)

    filename = f"{uuid.uuid4().hex[:12]}{result.ext}"
    (MEDIA_DIR / filename).write_bytes(result.data)

    asset = MediaAsset(
        kind=kind,
        filename=filename,
        prompt=prompt,
        provider=result.model.split("/")[0] if result.model else "simulated",
        model=result.model,
        width=result.width,
        height=result.height,
        duration_s=result.duration_s,
        cost=result.cost,
        meta=result.meta,
    )
    session.add(asset)
    session.commit()
    session.refresh(asset)
    return asset


def regenerate_media(
    session: Session,
    post: Post,
    *,
    prompt: Optional[str] = None,
    kind: MediaKind = MediaKind.image,
    aspect: Optional[str] = None,
) -> MediaAsset:
    """Replace one post's visual, keeping the rest of the post intact."""
    if prompt is None and post.media_id:
        existing = session.get(MediaAsset, post.media_id)
        prompt = existing.prompt if existing else None
    if not prompt:
        prompt = post.title or post.caption[:200]

    asset = _render_media(
        session, prompt, kind, aspect or specs.default_aspect(post.platform, post.placement)
    )
    post.media_id = asset.id
    session.add(post)
    session.commit()
    events.emit(
        "post.media_regenerated", post_id=post.id, media_id=asset.id, media_kind=kind.value
    )
    return asset


def _write_caption(
    session: Session,
    campaign: Campaign,
    item: dict[str, Any],
    account: Account,
    placement: str,
) -> tuple[str, list[str]]:
    """Writer plus adapter: the account's own voice, inside the platform's limits."""
    text, _ = registry.get_text(session)
    spec = specs.spec_for(account.platform, placement)
    profile = account.editorial_profile or {}
    examples = "\n".join(f"- {e}" for e in (account.liked_examples or [])[:3])

    prompt = f"""<<task:caption>>
Write the caption for one post. Return JSON only.

Platform: {account.platform.value}
Placement: {placement}
Account: @{account.handle}
Tone: {profile.get('tone', 'direct and concrete')}
Topics: {profile.get('topics', campaign.message)}
Style: {profile.get('style', 'short sentences, no hype')}
Brief: {item.get('caption_brief') or item.get('angle')}
Message: {campaign.message}
Key facts: {campaign.key_facts}
Hard limit: {spec.caption_max} characters including hashtags
Hashtags: at most {spec.hashtag_max}
{f'Liked examples:{chr(10)}{examples}' if examples else ''}

Return: {{"caption": "...", "hashtags": ["#one", "#two"]}}"""

    try:
        out = _json(text.complete(prompt, system=SYSTEM, json_object=True, max_tokens=900).text)
        caption = str(out.get("caption") or "").strip()
        hashtags = [str(h) for h in (out.get("hashtags") or [])][: spec.hashtag_max]
    except (ProviderError, ValueError):
        caption = item.get("caption_brief") or campaign.message
        hashtags = []

    if not caption:
        caption = item.get("caption_brief") or campaign.message

    # QA: the limit is enforced here, not hoped for.
    budget = spec.caption_max - sum(len(h) + 1 for h in hashtags)
    if spec.caption_max and len(caption) > budget:
        caption = caption[: max(0, budget - 1)].rstrip() + "…"
    return caption, hashtags


# --------------------------------------------------------------------------
# gates
# --------------------------------------------------------------------------


def recheck(session: Session, post: Post) -> dict[str, Any]:
    """Re-run the platform spec check after a human edits a post."""
    asset = session.get(MediaAsset, post.media_id) if post.media_id else None
    report = specs.check(
        post.platform,
        post.placement,
        caption=post.caption,
        hashtags=post.hashtags or [],
        media_kind=asset.kind if asset else None,
        width=asset.width if asset else None,
        height=asset.height if asset else None,
        duration_s=asset.duration_s if asset else None,
    )
    post.spec_check = report.to_dict()
    session.add(post)
    return post.spec_check


def approve_plan(session: Session, campaign: Campaign) -> Campaign:
    """Gate 6A."""
    if not (campaign.plan or {}).get("items"):
        raise GateError("there is no plan to approve")
    campaign.plan_approved_at = utcnow()
    campaign.status = CampaignStatus.producing
    session.add(campaign)
    session.commit()
    session.refresh(campaign)
    events.emit("campaign.plan_approved", campaign_id=campaign.id)
    return campaign


def approve_content(session: Session, campaign: Campaign) -> list[Post]:
    """Gate 6B. Only posts that pass this may ever publish automatically."""
    posts = session.exec(select(Post).where(Post.campaign_id == campaign.id)).all()
    if not posts:
        raise GateError("there is no content to approve")

    blocked = [p for p in posts if not (p.spec_check or {}).get("ok", True)]
    if blocked:
        names = ", ".join(f"{p.title} (@{_handle(session, p)})" for p in blocked[:4])
        raise GateError(
            f"{len(blocked)} post(s) fail their platform spec and cannot be approved: {names}"
        )

    now = utcnow()
    for post in posts:
        if post.status == PostStatus.draft:
            post.status = PostStatus.approved
            post.approved_at = now
            session.add(post)

    campaign.content_approved_at = now
    campaign.status = CampaignStatus.scheduled
    session.add(campaign)
    session.commit()
    events.emit("campaign.content_approved", campaign_id=campaign.id, posts=len(posts))
    return posts


def _handle(session: Session, post: Post) -> str:
    account = session.get(Account, post.account_id)
    return account.handle if account else "?"


def _accounts(session: Session, campaign: Campaign) -> list[Account]:
    if not campaign.account_ids:
        return []
    rows = session.exec(select(Account).where(Account.id.in_(campaign.account_ids))).all()
    order = {aid: i for i, aid in enumerate(campaign.account_ids)}
    return sorted(rows, key=lambda a: order.get(a.id, 999))


def _json(raw: str) -> dict[str, Any]:
    """Models wrap JSON in prose or fences more often than they should."""
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(raw[start : end + 1])
        except json.JSONDecodeError as exc:
            raise ValueError(f"model did not return usable JSON: {raw[:200]}") from exc
    raise ValueError(f"model did not return JSON: {raw[:200]}")
