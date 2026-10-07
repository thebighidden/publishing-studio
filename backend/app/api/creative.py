from __future__ import annotations

import io
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
from sqlmodel import Session, select

from ..config import MEDIA_DIR
from ..db import get_session
from ..models import MediaAsset, MediaKind, ProviderKind
from ..providers import registry
from ..providers.base import ProviderError
from ..publishing import events

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
