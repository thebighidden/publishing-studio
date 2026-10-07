from __future__ import annotations

import io
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..agents import specs
from ..config import MEDIA_DIR
from ..db import get_session
from ..models import Account, MediaAsset, MediaKind, Phone, Platform, Post, PostStatus, ProviderKind, utcnow
from ..providers import registry
from ..providers.base import ProviderError
from ..publishing import events, runner
from ..publishing.scheduler import scheduler
from .runs import publish_now

router = APIRouter(prefix="/api/creative", tags=["creative"])

MAX_REFERENCE_BYTES = 20 * 1024 * 1024
ALUNA_IDENTITY_DIRECTION = """
Use the uploaded image as the exact identity reference. Change the world around the subject,
not the subject itself. Preserve exact shape, proportions, material, colors, packaging, logos,
labels, and all visible text. Create a photorealistic art-directed scene with deliberate lighting,
camera language, and natural detail. Do not redesign, duplicate, crop away, or obscure the subject.
""".strip()


def _asset_out(asset: MediaAsset) -> dict[str, Any]:
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
        "meta": asset.meta or {},
        "created_at": asset.created_at,
    }


def _save(session: Session, kind: MediaKind, prompt: str, result, provider: str) -> MediaAsset:
    filename = f"{uuid.uuid4().hex[:12]}{result.ext}"
    (MEDIA_DIR / filename).write_bytes(result.data)
    asset = MediaAsset(
        kind=kind,
        filename=filename,
        prompt=prompt,
        provider=provider,
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


def _as_png(data: bytes) -> bytes:
    try:
        source = Image.open(io.BytesIO(data)).convert("RGB")
        output = io.BytesIO()
        source.save(output, format="PNG")
        return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(400, "the reference image could not be decoded") from exc


@router.get("/status")
def creative_status(session: Session = Depends(get_session)) -> dict[str, Any]:
    image, image_cfg = registry.get_image(session)
    video, video_cfg = registry.get_video(session)
    return {
        "image": {
            "provider": registry.describe(image_cfg, ProviderKind.image),
            "simulated": image_cfg is None or image_cfg.adapter.value == "simulated",
            "reference_input": image.__class__.__name__ == "GoogleGenAIImage",
        },
        "video": {
            "provider": registry.describe(video_cfg, ProviderKind.video),
            "simulated": video_cfg is None or video_cfg.adapter.value == "simulated",
            "image_to_video": True,
        },
    }


@router.get("/assets")
def recent_assets(session: Session = Depends(get_session)) -> list[dict[str, Any]]:
    rows = session.exec(select(MediaAsset).order_by(MediaAsset.created_at.desc()).limit(24)).all()
    return [_asset_out(row) for row in rows]


@router.post("/generate")
def generate(
    prompt: str = Form(..., min_length=3, max_length=4000),
    kind: MediaKind = Form(MediaKind.image),
    aspect: str = Form("1:1"),
    duration_s: float = Form(6, ge=4, le=8),
    preserve_subject: bool = Form(True),
    prepare_opening_frame: bool = Form(True),
    reference: UploadFile | None = File(None),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    reference_bytes: bytes | None = None
    reference_mime = "image/png"
    if reference is not None:
        reference_mime = reference.content_type or "image/png"
        if not reference_mime.startswith("image/"):
            raise HTTPException(400, "the reference must be an image")
        reference_bytes = reference.file.read(MAX_REFERENCE_BYTES + 1)
        if not reference_bytes:
            raise HTTPException(400, "the reference image is empty")
        if len(reference_bytes) > MAX_REFERENCE_BYTES:
            raise HTTPException(413, "reference image is larger than 20 MB")

    directed_prompt = prompt.strip()
    if reference_bytes and preserve_subject:
        directed_prompt = f"{ALUNA_IDENTITY_DIRECTION}\n\nCREATIVE DIRECTION:\n{directed_prompt}"

    try:
        if kind == MediaKind.image:
            provider, cfg = registry.get_image(session)
            result = provider.generate(
                directed_prompt,
                aspect=aspect,
                image=reference_bytes,
                image_mime=reference_mime,
            )
            provider_name = registry.describe(cfg, ProviderKind.image)
        else:
            opening_frame = reference_bytes
            prepared = False
            if reference_bytes and prepare_opening_frame:
                image_provider, image_cfg = registry.get_image(session)
                # Aluna first art-directs a clean opening frame before animating it.
                # Only do that with a real image model; the simulator should preserve
                # the uploaded source rather than replacing it with a placeholder.
                if image_cfg is not None and image_cfg.adapter.value != "simulated":
                    opening = image_provider.generate(
                        directed_prompt,
                        aspect=aspect,
                        image=reference_bytes,
                        image_mime=reference_mime,
                    )
                    opening_frame = opening.data
                    prepared = True
            if opening_frame and not prepared:
                # VideoProvider carries bytes rather than a MIME field. Normalize
                # raw JPEG/WebP references so Veo and Higgsfield receive truthful PNG data.
                opening_frame = _as_png(opening_frame)

            provider, cfg = registry.get_video(session)
            result = provider.generate(
                directed_prompt,
                aspect=aspect,
                duration_s=duration_s,
                image=opening_frame,
            )
            result.meta = {**(result.meta or {}), "opening_frame_prepared": prepared}
            provider_name = registry.describe(cfg, ProviderKind.video)
    except ProviderError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ProviderError(f"creative generation failed: {type(exc).__name__}: {exc}") from exc

    asset = _save(session, kind, directed_prompt, result, provider_name)
    events.emit(
        "creative.asset_ready",
        media_id=asset.id,
        media_kind=kind.value,
        provider=provider_name,
        model=asset.model,
    )
    return _asset_out(asset)


class QuickPostIn(BaseModel):
    # Either an existing account, or a phone plus the Instagram handle signed in on it.
    account_id: Optional[str] = None
    phone_id: Optional[str] = None
    handle: Optional[str] = Field(default=None, max_length=30)
    caption: str = Field(default="", max_length=2200)
    hashtags: list[str] = Field(default_factory=list)


def _account_for(session: Session, body: QuickPostIn) -> Account:
    if body.account_id:
        account = session.get(Account, body.account_id)
        if account is None:
            raise HTTPException(404, "account not found")
        return account

    if not body.phone_id or not (body.handle or "").strip().lstrip("@"):
        raise HTTPException(422, "choose a phone and enter the Instagram handle signed in on it")
    phone = session.get(Phone, body.phone_id)
    if phone is None:
        raise HTTPException(404, "phone not found")
    handle = body.handle.strip().lstrip("@")
    on_phone = session.exec(
        select(Account).where(Account.platform == Platform.instagram, Account.phone_id == phone.id)
    ).first()
    if on_phone is not None and on_phone.handle != handle:
        # One Instagram account per phone: the app posts as whoever is signed in there.
        raise HTTPException(409, f"{phone.name} is already linked to @{on_phone.handle}; change that in Settings → Accounts")
    account = session.exec(
        select(Account).where(Account.platform == Platform.instagram, Account.handle == handle)
    ).first()
    if account is None:
        # Not marked logged in: that flag is only ever set by reading the phone's screen.
        account = Account(platform=Platform.instagram, handle=handle, phone_id=phone.id, logged_in=False,
                          notes="added from Creative lab")
    elif account.phone_id != phone.id:
        account.phone_id = phone.id
    session.add(account)
    session.flush()
    return account


@router.post("/assets/{asset_id}/publish", status_code=202)
def publish_asset(asset_id: str, body: QuickPostIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    """Post one lab asset to an account's feed through its phone, right after generating it.

    The operator pressing Post with the image and caption in front of them is the human
    approval (gate 6B) for this single post, so it is recorded as approved now. Everything
    after that is the normal path: spec check, the runner's preflight guards (linked phone,
    phone booking, account cooldown), then a phone run whose outcome needs evidence.
    """
    if scheduler.is_paused():
        raise HTTPException(409, "publishing is paused; resume it first")
    asset = session.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(404, "asset not found")
    if (asset.meta or {}).get("simulated"):
        raise HTTPException(409, "this is an offline placeholder, not real content; generate it with a real provider first")
    account = _account_for(session, body)

    hashtags = [tag.strip().lstrip("#") for tag in body.hashtags if tag.strip().lstrip("#")]
    report = specs.check(
        account.platform,
        "feed",
        caption=body.caption.strip(),
        hashtags=hashtags,
        media_kind=asset.kind,
        width=asset.width,
        height=asset.height,
        duration_s=asset.duration_s,
    )
    if not report.ok:
        session.rollback()
        raise HTTPException(422, "; ".join(report.issues))

    now = utcnow()
    post = Post(
        account_id=account.id,
        platform=account.platform,
        title=f"Creative lab: {(asset.prompt or '').strip()[:60]}",
        caption=body.caption.strip(),
        hashtags=hashtags,
        media_id=asset.id,
        placement="feed",
        status=PostStatus.approved,
        approved_at=now,
        spec_check=report.to_dict(),
    )
    # Check the guards before saving, so a refusal (no phone, phone busy, cooldown) leaves nothing behind.
    try:
        runner.preflight(session, post)
    except runner.NotPublishable as exc:
        session.rollback()
        raise HTTPException(409, str(exc)) from exc
    session.add(post)
    session.commit()
    session.refresh(post)

    publish_now(post_id=post.id, session=session)
    return {"post_id": post.id, "account": account.handle}
