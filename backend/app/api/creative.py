from __future__ import annotations

import io
import json
import mimetypes
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlmodel import Session, select

from .. import creative_jobs, settings_store
from ..agents import assist, specs
from ..config import MEDIA_DIR
from ..db import get_session
from ..models import (
    Account,
    GenerationJob,
    MediaAsset,
    MediaKind,
    Phone,
    Platform,
    Post,
    PostStatus,
    Project,
    ProviderAdapter,
    ProviderConfig,
    ProviderKind,
    Setting,
    utcnow,
)
from ..providers import comfyui, higgsfield_catalog, registry
from ..providers import control
from ..providers.base import NotConfigured, ProviderError
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

# Style presets add a direction to the operator's prompt. Settings can replace
# this list (Setting "studio_presets"); these are the defaults.
DEFAULT_PRESETS: list[dict[str, str]] = [
    {"id": "none", "name": "No style", "suffix": ""},
    {"id": "editorial", "name": "Editorial photo", "suffix": "editorial photography, natural light, 50mm lens, shallow depth of field, true-to-life colour"},
    {"id": "cinematic", "name": "Cinematic", "suffix": "cinematic still, dramatic lighting, anamorphic lens, film grain, rich contrast"},
    {"id": "product", "name": "Studio product", "suffix": "studio product shot, seamless backdrop, softbox lighting, crisp detail, commercial photography"},
    {"id": "lifestyle", "name": "Lifestyle", "suffix": "candid lifestyle photography, warm tones, authentic moment, soft daylight"},
    {"id": "illustration", "name": "Flat illustration", "suffix": "flat vector illustration, clean shapes, limited palette, modern graphic design"},
    {"id": "3d", "name": "3D render", "suffix": "3D render, soft global illumination, clay materials, octane style"},
    {"id": "anime", "name": "Anime", "suffix": "anime illustration, cel shading, vibrant colours, detailed background"},
    {"id": "minimal", "name": "Minimal", "suffix": "minimalist composition, generous negative space, muted palette"},
]

# Bounds for the advanced controls; anything outside is refused, not clamped.
_ADVANCED_LIMITS: dict[str, tuple[float, float]] = {
    "steps": (1, 80),
    "guidance": (0.0, 30.0),
    "shift": (0.0, 20.0),
    "width": (256, 2048),
    "height": (256, 2048),
}


def _asset_out(asset: MediaAsset, *, used_in: int = 0) -> dict[str, Any]:
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
        "project_id": asset.project_id,
        "favorite": bool(asset.favorite),
        "seed": asset.seed,
        "params": asset.params or {},
        "parent_id": asset.parent_id,
        "tags": asset.tags or [],
        "caption_draft": asset.caption_draft or "",
        "hashtags_draft": asset.hashtags_draft or [],
        "used_in_posts": used_in,
    }


def _save(
    session: Session,
    kind: MediaKind,
    prompt: str,
    result,
    provider: str,
    *,
    project_id: Optional[str] = None,
    seed: Optional[int] = None,
    params: Optional[dict[str, Any]] = None,
    parent_id: Optional[str] = None,
) -> MediaAsset:
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
        project_id=project_id,
        seed=(result.meta or {}).get("seed", seed),
        params=params or {},
        parent_id=parent_id,
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


def _video_size(data: bytes) -> tuple[Optional[int], Optional[int]]:
    """Width and height of a downloaded video, read by the bundled ffmpeg. Cloud
    models report neither, and the post spec check needs them."""
    import tempfile

    import imageio_ffmpeg

    path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp.write(data)
            path = tmp.name
        frames = imageio_ffmpeg.read_frames(path)
        meta = next(frames)
        frames.close()
        width, height = meta.get("size") or (None, None)
        return width, height
    except Exception:  # noqa: BLE001  (unknown size is allowed; the asset is still kept)
        return None, None
    finally:
        if path:
            Path(path).unlink(missing_ok=True)


def _setting(session: Session, key: str, default: Any) -> Any:
    row = session.get(Setting, key)
    return row.value.get("value", default) if row and isinstance(row.value, dict) else default


def presets(session: Session) -> list[dict[str, str]]:
    return _setting(session, "studio_presets", DEFAULT_PRESETS)


# ---------------- status, models, presets ----------------


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


@router.get("/models")
def models(session: Session = Depends(get_session)) -> dict[str, list[dict[str, Any]]]:
    """Every enabled image and video model, labelled with how it is reached (f105)."""
    rows = session.exec(
        select(ProviderConfig).where(
            ProviderConfig.enabled == True,  # noqa: E712
            ProviderConfig.kind.in_([ProviderKind.image, ProviderKind.video]),
        )
    ).all()
    rows.sort(key=lambda r: (not r.is_default, r.created_at))
    out: dict[str, list[dict[str, Any]]] = {"image": [], "video": []}
    seen_catalog: set[str] = set()
    for cfg in rows:
        if cfg.adapter == ProviderAdapter.higgsfield:
            # One Higgsfield key unlocks the whole catalog, images and video alike.
            default_spec = higgsfield_catalog.find(cfg.model or "")
            for spec in higgsfield_catalog.CATALOG:
                if spec.key in seen_catalog:
                    continue
                seen_catalog.add(spec.key)
                out[spec.kind].append({
                    **_model_base(cfg),
                    **spec.public(),
                    "id": f"{cfg.id}{registry.MODEL_SEP}{spec.key}",
                    "label": f"higgsfield/{spec.name}",
                    "group": cfg.name,
                    "is_default": cfg.is_default and default_spec is not None and default_spec.key == spec.key,
                })
            if default_spec is not None or not cfg.model:
                continue
            spec = higgsfield_catalog.generic(cfg.kind.value, cfg.model)
            out[cfg.kind.value].append({**_model_base(cfg), **spec.public(), "id": cfg.id, "group": cfg.name})
            continue
        out[cfg.kind.value].append({**_model_base(cfg), **_capabilities(cfg.adapter.value, cfg.kind.value, cfg)})
    for kind in ("image", "video"):
        if not out[kind]:
            out[kind].append({
                "id": "", "name": "Offline test generator", "adapter": "simulated", "model": "",
                "label": f"simulated/{kind}", "reach": "offline", "is_default": True, "simulated": True,
                "healthy": True, "advanced": {}, "custom_size": False, "group": "Offline",
                **_capabilities("simulated", kind, None),
            })
    return out


_STUDIO_ASPECTS = ["1:1", "4:5", "9:16", "16:9"]


def _model_base(cfg: ProviderConfig) -> dict[str, Any]:
    return {
        "id": cfg.id,
        "name": cfg.name,
        "adapter": cfg.adapter.value,
        "model": cfg.model or "",
        "label": registry.describe(cfg, cfg.kind),
        "group": cfg.name,
        "reach": registry.reach(cfg),
        "is_default": cfg.is_default,
        "simulated": cfg.adapter == ProviderAdapter.simulated,
        "healthy": cfg.last_check_ok,
        "advanced": comfyui.advanced_controls(cfg.model or "") if cfg.adapter == ProviderAdapter.comfyui else {},
        "custom_size": cfg.adapter == ProviderAdapter.comfyui and comfyui.controls_size(cfg.model or ""),
    }


def _capabilities(adapter: str, kind: str, cfg: Optional[ProviderConfig]) -> dict[str, Any]:
    """What the studio's controls should offer for a model outside the Higgsfield catalog."""
    caps: dict[str, Any] = {
        "family": "", "blurb": "", "aspects": _STUDIO_ASPECTS, "resolutions": [], "default_resolution": "",
        "durations": [], "seed": kind == "image", "reference_input": False, "end_frame": False,
        "audio": False, "text_to_video": kind == "video",
    }
    if kind == "image":
        caps["reference_input"] = adapter == "google_genai"
        caps["blurb"] = {
            "google_genai": "Gemini image generation. Keeps a reference product identical in a new scene.",
            "comfyui": "Your own workflow on your own GPU.",
            "openai_compat": "An OpenAI-compatible image endpoint.",
            "simulated": "Offline placeholders for trying the studio. They can't be posted.",
        }.get(adapter, "")
    else:
        caps["reference_input"] = True
        caps["durations"] = [4, 6, 8]
        caps["aspects"] = ["9:16", "16:9"] if adapter == "google_genai" else ["9:16", "16:9", "1:1"]
        caps["audio"] = adapter == "google_genai"
        caps["blurb"] = {
            "google_genai": "Veo video with sound, from text or from a start frame.",
            "simulated": "An offline slow-pan MP4 for trying the studio.",
        }.get(adapter, "")
    return caps


@router.get("/presets")
def list_presets(session: Session = Depends(get_session)) -> dict[str, Any]:
    return {
        "presets": presets(session),
        "samplers": comfyui.SAMPLERS,
        "schedulers": comfyui.SCHEDULERS,
        "defaults": _setting(session, "studio_defaults", {}),
    }


class StudioSettingsIn(BaseModel):
    defaults: Optional[dict[str, Any]] = None
    presets: Optional[list[dict[str, Any]]] = None


def _slug(name: str) -> str:
    slug = "".join(ch if ch.isalnum() else "-" for ch in name.lower()).strip("-")
    return "-".join(part for part in slug.split("-") if part)[:40] or "style"


def _clean_presets(raw: list[dict[str, Any]]) -> list[dict[str, str]]:
    if not 1 <= len(raw) <= 30:
        raise HTTPException(422, "keep between 1 and 30 style presets")
    out: list[dict[str, str]] = [{"id": "none", "name": "No style", "suffix": ""}]
    seen = {"none"}
    for item in raw:
        name = str(item.get("name") or "").strip()
        suffix = str(item.get("suffix") or "").strip()
        if str(item.get("id")) == "none":
            continue
        if not 1 <= len(name) <= 40:
            raise HTTPException(422, "each style needs a name of 1 to 40 characters")
        if len(suffix) > 400:
            raise HTTPException(422, f"the direction for {name!r} is longer than 400 characters")
        if not suffix:
            raise HTTPException(422, f"{name!r} needs a direction to add to the prompt")
        pid = _slug(str(item.get("id") or name))
        while pid in seen:
            pid = f"{pid}-2"
        seen.add(pid)
        out.append({"id": pid, "name": name, "suffix": suffix})
    return out


def _clean_defaults(session: Session, raw: dict[str, Any], preset_ids: set[str]) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    if raw.get("kind") in ("image", "video"):
        clean["kind"] = raw["kind"]
    if "style" in raw:
        if raw["style"] not in preset_ids:
            raise HTTPException(422, "the default style is not one of the presets")
        clean["style"] = raw["style"]
    if "aspect" in raw:
        if raw["aspect"] not in ("1:1", "4:5", "9:16", "16:9"):
            raise HTTPException(422, "the default format must be 1:1, 4:5, 9:16 or 16:9")
        clean["aspect"] = raw["aspect"]
    if "count" in raw:
        if int(raw["count"]) not in (1, 2, 3, 4):
            raise HTTPException(422, "default variations must be 1 to 4")
        clean["count"] = int(raw["count"])
    if "model_id" in raw:
        model_id = raw["model_id"] or ""
        cfg = session.get(ProviderConfig, model_id) if model_id else None
        if model_id and (cfg is None or cfg.kind != ProviderKind.image):
            raise HTTPException(422, "the default model is not an image model")
        clean["model_id"] = model_id
    return clean


@router.get("/settings")
def get_studio_settings(session: Session = Depends(get_session)) -> dict[str, Any]:
    return {
        "defaults": settings_store.get(session, "studio_defaults", {}),
        "presets": presets(session),
        "builtin_presets": DEFAULT_PRESETS,
    }


@router.put("/settings")
def put_studio_settings(body: StudioSettingsIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    current = presets(session)
    if body.presets is not None:
        current = _clean_presets(body.presets)
        settings_store.put(session, "studio_presets", current)
    if body.defaults is not None:
        ids = {p["id"] for p in current}
        settings_store.put(session, "studio_defaults", _clean_defaults(session, body.defaults, ids))
    else:
        # A deleted preset must not linger as the default style.
        defaults = settings_store.get(session, "studio_defaults", {}) or {}
        if defaults.get("style") and defaults["style"] not in {p["id"] for p in current}:
            settings_store.put(session, "studio_defaults", {**defaults, "style": "none"})
    return get_studio_settings(session)


# ---------------- projects ----------------


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=2000)
    color: str = Field(default="#6e47ff", pattern=r"^#[0-9a-fA-F]{6}$")


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=2000)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    archived: Optional[bool] = None


def _project_out(session: Session, project: Project) -> dict[str, Any]:
    count = session.exec(select(func.count()).select_from(MediaAsset).where(MediaAsset.project_id == project.id)).one()
    cover = session.exec(
        select(MediaAsset)
        .where(MediaAsset.project_id == project.id, MediaAsset.kind == MediaKind.image)
        .order_by(MediaAsset.favorite.desc(), MediaAsset.created_at.desc())
    ).first()
    return {
        **project.model_dump(),
        "asset_count": count,
        "cover_url": f"/media/{cover.filename}" if cover else None,
    }


@router.get("/projects")
def list_projects(
    include_archived: bool = Query(default=False), session: Session = Depends(get_session)
) -> list[dict[str, Any]]:
    stmt = select(Project)
    if not include_archived:
        stmt = stmt.where(Project.archived == False)  # noqa: E712
    rows = session.exec(stmt.order_by(Project.created_at.desc())).all()
    return [_project_out(session, p) for p in rows]


@router.post("/projects", status_code=201)
def create_project(body: ProjectIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    project = Project(**body.model_dump())
    session.add(project)
    session.commit()
    session.refresh(project)
    return _project_out(session, project)


@router.patch("/projects/{project_id}")
def update_project(project_id: str, body: ProjectUpdate, session: Session = Depends(get_session)) -> dict[str, Any]:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(project, key, value)
    session.add(project)
    session.commit()
    session.refresh(project)
    return _project_out(session, project)


@router.delete("/projects/{project_id}", status_code=204, response_model=None)
def delete_project(project_id: str, session: Session = Depends(get_session)) -> None:
    """Deleting a project keeps its work: the assets move back to the unfiled library."""
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    for asset in session.exec(select(MediaAsset).where(MediaAsset.project_id == project_id)).all():
        asset.project_id = None
        session.add(asset)
    session.delete(project)
    session.commit()


# ---------------- the library ----------------


def _usage(session: Session, asset_ids: list[str]) -> dict[str, int]:
    if not asset_ids:
        return {}
    rows = session.exec(
        select(Post.media_id, func.count()).where(Post.media_id.in_(asset_ids)).group_by(Post.media_id)
    ).all()
    return {media_id: count for media_id, count in rows}


@router.get("/assets")
def list_assets(
    q: str = Query(default="", max_length=200),
    kind: Optional[MediaKind] = Query(default=None),
    project_id: Optional[str] = Query(default=None, description="a project id, or 'none' for unfiled"),
    favorite: bool = Query(default=False),
    include_simulated: bool = Query(default=True),
    limit: int = Query(default=48, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    stmt = select(MediaAsset)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(MediaAsset.prompt.like(like), MediaAsset.model.like(like), MediaAsset.caption_draft.like(like)))
    if kind is not None:
        stmt = stmt.where(MediaAsset.kind == kind)
    if project_id == "none":
        stmt = stmt.where(MediaAsset.project_id == None)  # noqa: E711
    elif project_id:
        stmt = stmt.where(MediaAsset.project_id == project_id)
    if favorite:
        stmt = stmt.where(MediaAsset.favorite == True)  # noqa: E712
    if not include_simulated:
        stmt = stmt.where(~MediaAsset.provider.like("simulated/%"))

    total = session.exec(select(func.count()).select_from(stmt.subquery())).one()
    rows = session.exec(stmt.order_by(MediaAsset.created_at.desc()).offset(offset).limit(limit)).all()
    usage = _usage(session, [r.id for r in rows])
    return {"total": total, "items": [_asset_out(r, used_in=usage.get(r.id, 0)) for r in rows]}


@router.get("/assets/{asset_id}")
def get_asset(asset_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    asset = session.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(404, "asset not found")
    return _asset_out(asset, used_in=_usage(session, [asset.id]).get(asset.id, 0))


@router.get("/assets/{asset_id}/lineage")
def asset_lineage(asset_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    """Where an asset came from (oldest first) and what was made from it."""
    asset = session.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(404, "asset not found")
    ancestors: list[MediaAsset] = []
    seen = {asset.id}
    parent_id = asset.parent_id
    while parent_id and parent_id not in seen and len(ancestors) < 20:
        parent = session.get(MediaAsset, parent_id)
        if parent is None:
            break  # deleted along the way; the chain stops there
        ancestors.append(parent)
        seen.add(parent.id)
        parent_id = parent.parent_id
    ancestors.reverse()
    children = session.exec(
        select(MediaAsset).where(MediaAsset.parent_id == asset.id).order_by(MediaAsset.created_at).limit(40)
    ).all()
    return {
        "ancestors": [_asset_out(a) for a in ancestors],
        "children": [_asset_out(c) for c in children],
    }


class AssetUpdate(BaseModel):
    favorite: Optional[bool] = None
    project_id: Optional[str] = None
    tags: Optional[list[str]] = None
    caption_draft: Optional[str] = Field(default=None, max_length=2200)
    hashtags_draft: Optional[list[str]] = None


@router.patch("/assets/{asset_id}")
def update_asset(asset_id: str, body: AssetUpdate, session: Session = Depends(get_session)) -> dict[str, Any]:
    asset = session.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(404, "asset not found")
    data = body.model_dump(exclude_unset=True)
    if data.get("project_id") and session.get(Project, data["project_id"]) is None:
        raise HTTPException(400, "project not found")
    if "tags" in data:
        data["tags"] = sorted({t.strip().lower() for t in data["tags"] or [] if t.strip()})[:20]
    if "hashtags_draft" in data:
        data["hashtags_draft"] = [h.strip().lstrip("#") for h in data["hashtags_draft"] or [] if h.strip().lstrip("#")][:30]
    for key, value in data.items():
        # An empty project id means unfiled.
        setattr(asset, key, (value or None) if key == "project_id" else value)
    session.add(asset)
    session.commit()
    session.refresh(asset)
    return _asset_out(asset, used_in=_usage(session, [asset.id]).get(asset.id, 0))


@router.delete("/assets/{asset_id}", status_code=204, response_model=None)
def delete_asset(asset_id: str, session: Session = Depends(get_session)) -> None:
    """Refused while a post uses the file: its run record must keep pointing at real media."""
    asset = session.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(404, "asset not found")
    used = _usage(session, [asset.id]).get(asset.id, 0)
    if used:
        raise HTTPException(409, f"this is used by {used} post(s); it stays so their records stay complete")
    path = MEDIA_DIR / asset.filename
    session.delete(asset)
    session.commit()
    path.unlink(missing_ok=True)


# ---------------- generation ----------------


def _advanced(raw: str) -> dict[str, Any]:
    try:
        params = json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(422, "advanced settings are not valid JSON") from exc
    if not isinstance(params, dict):
        raise HTTPException(422, "advanced settings must be an object")
    clean: dict[str, Any] = {}
    for key, value in params.items():
        if value in (None, ""):
            continue
        if key in _ADVANCED_LIMITS:
            lo, hi = _ADVANCED_LIMITS[key]
            try:
                number = float(value)
            except (TypeError, ValueError) as exc:
                raise HTTPException(422, f"{key} must be a number") from exc
            if not lo <= number <= hi:
                raise HTTPException(422, f"{key} must be between {lo:g} and {hi:g}")
            clean[key] = int(number) if key in ("steps", "width", "height") else number
        elif key == "sampler" and value in comfyui.SAMPLERS:
            clean[key] = value
        elif key == "scheduler" and value in comfyui.SCHEDULERS:
            clean[key] = value
        else:
            raise HTTPException(422, f"unknown advanced setting {key!r}")
    if ("width" in clean) != ("height" in clean):
        raise HTTPException(422, "set both width and height for a custom size")
    return clean


def _read_reference(reference: UploadFile | None) -> tuple[bytes | None, str]:
    if reference is None:
        return None, "image/png"
    mime = reference.content_type or "image/png"
    if not mime.startswith("image/"):
        raise HTTPException(400, "the reference must be an image")
    data = reference.file.read(MAX_REFERENCE_BYTES + 1)
    if not data:
        raise HTTPException(400, "the reference image is empty")
    if len(data) > MAX_REFERENCE_BYTES:
        raise HTTPException(413, "reference image is larger than 20 MB")
    return data, mime


def _library_image(session: Session, asset_id: str, what: str) -> MediaAsset:
    asset = session.get(MediaAsset, asset_id)
    if asset is None or asset.kind != MediaKind.image:
        raise HTTPException(400, f"the {what} was not found in the library")
    return asset


def _studio_request(
    *, prompt: str, kind: MediaKind, aspect: str, duration_s: float, provider_id: str, project_id: str,
    style: str, seed: Optional[int], advanced: str, parent_id: str, source_asset_id: str,
    reference_asset_id: str, end_asset_id: str, preserve_subject: bool, prepare_opening_frame: bool,
    resolution: str, audio: bool, uploaded: bool,
) -> dict[str, Any]:
    """The studio form as one plain dict: what a job stores and a retry replays."""
    if kind == MediaKind.image and seed is None:
        # Chosen now, so a retried job makes the same image it was asked for.
        seed = random.randint(0, 2**32 - 1)
    return {
        "prompt": prompt.strip(), "kind": kind.value, "aspect": aspect, "duration_s": duration_s,
        "provider_id": provider_id, "project_id": project_id, "style": style or "none", "seed": seed,
        "advanced": _advanced(advanced), "parent_id": parent_id, "source_asset_id": source_asset_id,
        "reference_asset_id": reference_asset_id, "end_asset_id": end_asset_id,
        "preserve_subject": preserve_subject, "prepare_opening_frame": prepare_opening_frame,
        "resolution": resolution.strip()[:12], "audio": audio, "reference_uploaded": uploaded,
    }


def _prepare(session: Session, req: dict[str, Any], reference_bytes: bytes | None, reference_mime: str) -> dict[str, Any]:
    """Check a studio request and gather everything generation needs. Raises
    HTTPException for anything the operator has to fix, before credits are spent."""
    kind = MediaKind(req["kind"])
    if req.get("project_id") and session.get(Project, req["project_id"]) is None:
        raise HTTPException(400, "project not found")
    style = req.get("style") or "none"
    preset = next((p for p in presets(session) if p.get("id") == style), None)
    if style not in ("", "none") and preset is None:
        raise HTTPException(422, f"unknown style preset {style!r}")

    source_asset_id = req.get("source_asset_id") or ""
    reference_asset_id = req.get("reference_asset_id") or ""
    prepare_opening_frame = bool(req.get("prepare_opening_frame", True))
    if reference_asset_id and reference_bytes is None:
        ref = _library_image(session, reference_asset_id, "reference image")
        reference_bytes = (MEDIA_DIR / ref.filename).read_bytes()
        reference_mime = mimetypes.guess_type(ref.filename)[0] or "image/png"
    if source_asset_id:
        source = _library_image(session, source_asset_id, "image to animate")
        reference_bytes = (MEDIA_DIR / source.filename).read_bytes()
        prepare_opening_frame = False  # animate exactly this frame
    end_bytes = None
    if req.get("end_asset_id") and kind == MediaKind.video:
        end = _library_image(session, req["end_asset_id"], "end frame")
        end_bytes = _as_png((MEDIA_DIR / end.filename).read_bytes())

    user_prompt = req["prompt"]
    directed_prompt = user_prompt
    if preset and preset.get("suffix"):
        directed_prompt = f"{directed_prompt}, {preset['suffix']}"
    if reference_bytes and req.get("preserve_subject", True) and not source_asset_id:
        directed_prompt = f"{ALUNA_IDENTITY_DIRECTION}\n\nCREATIVE DIRECTION:\n{directed_prompt}"

    provider_kind = ProviderKind.image if kind == MediaKind.image else ProviderKind.video
    try:
        provider, cfg = registry.get_chosen(session, provider_kind, req.get("provider_id") or None)
    except NotConfigured as exc:
        raise HTTPException(422, str(exc)) from exc
    return {
        "kind": kind, "user_prompt": user_prompt, "directed_prompt": directed_prompt,
        "reference_bytes": reference_bytes, "reference_mime": reference_mime, "end_bytes": end_bytes,
        "prepare_opening_frame": prepare_opening_frame, "provider": provider, "cfg": cfg,
        "provider_name": registry.model_name(req.get("provider_id") or "", cfg, provider_kind),
    }


def _execute(session: Session, req: dict[str, Any], prep: dict[str, Any]) -> MediaAsset:
    """Call the model and keep the result in the library."""
    kind, provider, cfg = prep["kind"], prep["provider"], prep["cfg"]
    directed_prompt, reference_bytes = prep["directed_prompt"], prep["reference_bytes"]
    resolution = req.get("resolution") or ""
    try:
        if kind == MediaKind.image:
            params = dict(req.get("advanced") or {})
            if resolution:
                params["resolution"] = resolution
            result = provider.generate(
                directed_prompt,
                aspect=req["aspect"],
                seed=req.get("seed"),
                image=reference_bytes,
                image_mime=prep["reference_mime"],
                params=params,
            )
        else:
            opening_frame = reference_bytes
            prepared = False
            if reference_bytes and prep["prepare_opening_frame"]:
                image_provider, image_cfg = registry.get_image(session)
                # Aluna first art-directs a clean opening frame before animating it.
                # Only do that with a real image model; the simulator should preserve
                # the uploaded source rather than replacing it with a placeholder.
                if image_cfg is not None and image_cfg.adapter.value != "simulated":
                    opening = image_provider.generate(
                        directed_prompt,
                        aspect=req["aspect"],
                        image=reference_bytes,
                        image_mime=prep["reference_mime"],
                    )
                    opening_frame = opening.data
                    prepared = True
            if opening_frame and not prepared:
                # VideoProvider carries bytes rather than a MIME field. Normalize
                # raw JPEG/WebP references so Veo and Higgsfield receive truthful PNG data.
                opening_frame = _as_png(opening_frame)
            result = provider.generate(
                directed_prompt,
                aspect=req["aspect"],
                duration_s=req["duration_s"],
                image=opening_frame,
                params={"resolution": resolution, "audio": bool(req.get("audio", True)), "end_image": prep["end_bytes"]},
            )
            result.meta = {**(result.meta or {}), "opening_frame_prepared": prepared}
            if result.width is None or result.height is None:
                result.width, result.height = _video_size(result.data)
    except (ProviderError, control.Cancelled):
        raise
    except Exception as exc:  # noqa: BLE001
        raise ProviderError(f"creative generation failed: {type(exc).__name__}: {exc}") from exc

    source_asset_id = req.get("source_asset_id") or ""
    reference_asset_id = req.get("reference_asset_id") or ""
    asset = _save(
        session,
        kind,
        directed_prompt,
        result,
        prep["provider_name"],
        project_id=req.get("project_id") or None,
        seed=req.get("seed"),
        params={
            "prompt": prep["user_prompt"],
            "style": req.get("style") or "none",
            "aspect": req["aspect"],
            "duration_s": req["duration_s"] if kind == MediaKind.video else None,
            "provider_id": req.get("provider_id") or (cfg.id if cfg else ""),
            "advanced": req.get("advanced") or {},
            "resolution": resolution or None,
            "audio": bool(req.get("audio", True)) if kind == MediaKind.video else None,
            "source_asset_id": source_asset_id or None,
            "reference_asset_id": reference_asset_id or None,
            "end_asset_id": req.get("end_asset_id") or None,
            "reference_uploaded": bool(req.get("reference_uploaded")),
            "preserve_subject": bool(reference_bytes) and bool(req.get("preserve_subject", True)) and not source_asset_id,
        },
        parent_id=req.get("parent_id") or source_asset_id or reference_asset_id or None,
    )
    events.emit(
        "creative.asset_ready",
        media_id=asset.id,
        media_kind=kind.value,
        provider=prep["provider_name"],
        model=asset.model,
    )
    return asset


@router.post("/generate")
def generate(
    prompt: str = Form(..., min_length=3, max_length=4000),
    kind: MediaKind = Form(MediaKind.image),
    aspect: str = Form("1:1"),
    duration_s: float = Form(6, ge=2, le=20),
    provider_id: str = Form(""),
    project_id: str = Form(""),
    style: str = Form("none"),
    seed: Optional[int] = Form(None, ge=0, le=2**32 - 1),
    advanced: str = Form("{}"),
    parent_id: str = Form(""),
    source_asset_id: str = Form("", description="video: animate this image from the library"),
    reference_asset_id: str = Form("", description="image: use this library image as the reference"),
    end_asset_id: str = Form("", description="video: end on this library image, where the model supports it"),
    preserve_subject: bool = Form(True),
    prepare_opening_frame: bool = Form(True),
    resolution: str = Form(""),
    audio: bool = Form(True),
    reference: UploadFile | None = File(None),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Generate and wait for the result. The studio uses /jobs instead, which survives a closed tab."""
    reference_bytes, reference_mime = _read_reference(reference)
    req = _studio_request(
        prompt=prompt, kind=kind, aspect=aspect, duration_s=duration_s, provider_id=provider_id,
        project_id=project_id, style=style, seed=seed, advanced=advanced, parent_id=parent_id,
        source_asset_id=source_asset_id, reference_asset_id=reference_asset_id, end_asset_id=end_asset_id,
        preserve_subject=preserve_subject, prepare_opening_frame=prepare_opening_frame,
        resolution=resolution, audio=audio, uploaded=reference_bytes is not None,
    )
    prep = _prepare(session, req, reference_bytes, reference_mime)
    return _asset_out(_execute(session, req, prep))


# ---------------- generation jobs ----------------


def _job_out(session: Session, job: GenerationJob) -> dict[str, Any]:
    asset = session.get(MediaAsset, job.asset_id) if job.asset_id else None
    return {
        "id": job.id,
        "status": job.status,
        "kind": job.kind,
        "batch": job.batch,
        "label": job.label,
        "model_label": job.model_label,
        "provider_id": (job.request or {}).get("provider_id") or "",
        "error": job.error,
        "attempts": job.attempts,
        "cancel_requested": job.cancel_requested,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
        "asset": _asset_out(asset) if asset else None,
    }


@router.post("/jobs", status_code=202)
def submit_job(
    prompt: str = Form(..., min_length=3, max_length=4000),
    kind: MediaKind = Form(MediaKind.image),
    aspect: str = Form("1:1"),
    duration_s: float = Form(6, ge=2, le=20),
    provider_id: str = Form(""),
    project_id: str = Form(""),
    style: str = Form("none"),
    seed: Optional[int] = Form(None, ge=0, le=2**32 - 1),
    advanced: str = Form("{}"),
    parent_id: str = Form(""),
    source_asset_id: str = Form(""),
    reference_asset_id: str = Form(""),
    end_asset_id: str = Form(""),
    preserve_subject: bool = Form(True),
    prepare_opening_frame: bool = Form(True),
    resolution: str = Form(""),
    audio: bool = Form(True),
    batch: str = Form("", max_length=40),
    reference: UploadFile | None = File(None),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Queue a generation. It is checked now, so a mistake shows at once, and runs in the background."""
    reference_bytes, reference_mime = _read_reference(reference)
    req = _studio_request(
        prompt=prompt, kind=kind, aspect=aspect, duration_s=duration_s, provider_id=provider_id,
        project_id=project_id, style=style, seed=seed, advanced=advanced, parent_id=parent_id,
        source_asset_id=source_asset_id, reference_asset_id=reference_asset_id, end_asset_id=end_asset_id,
        preserve_subject=preserve_subject, prepare_opening_frame=prepare_opening_frame,
        resolution=resolution, audio=audio, uploaded=reference_bytes is not None,
    )
    prep = _prepare(session, req, reference_bytes, reference_mime)
    cfg = prep["cfg"]
    reach = registry.reach(cfg)
    job = creative_jobs.submit(
        session,
        req,
        reference_bytes=reference_bytes,
        reference_mime=reference_mime,
        batch=batch,
        model_label=prep["provider_name"],
        # Cloud models run several at once; a local GPU or the simulator one at a time.
        lane=f"{cfg.id if cfg else 'offline-' + kind.value}:{3 if reach == 'cloud' else 1}",
    )
    return _job_out(session, job)


@router.get("/jobs")
def list_jobs(limit: int = Query(default=80, ge=1, le=200), session: Session = Depends(get_session)) -> list[dict[str, Any]]:
    """The studio's strip: recent jobs not yet cleared, oldest first."""
    rows = session.exec(
        select(GenerationJob)
        .where(GenerationJob.dismissed == False)  # noqa: E712
        .order_by(GenerationJob.created_at.desc())
        .limit(limit)
    ).all()
    return [_job_out(session, job) for job in reversed(rows)]


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    job = session.get(GenerationJob, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    creative_jobs.cancel(session, job)
    return _job_out(session, job)


@router.post("/jobs/{job_id}/retry")
def retry_job(job_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    job = session.get(GenerationJob, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    if job.status not in ("failed", "canceled"):
        raise HTTPException(409, "only a failed or stopped job can be retried")
    creative_jobs.retry(session, job)
    return _job_out(session, job)


class DismissIn(BaseModel):
    ids: list[str] = Field(default_factory=list)
    finished: bool = False


@router.post("/jobs/dismiss")
def dismiss_jobs(body: DismissIn, session: Session = Depends(get_session)) -> dict[str, int]:
    """Clear jobs from the strip. Their images and videos stay in the library."""
    return {"dismissed": creative_jobs.dismiss(session, ids=body.ids, finished=body.finished)}


# ---------------- AI assist ----------------


class PromptAssistIn(BaseModel):
    idea: str = Field(min_length=2, max_length=2000)
    style: str = "none"
    kind: MediaKind = MediaKind.image


@router.post("/assist/prompt")
def assist_prompt(body: PromptAssistIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    """Turn a short idea into a detailed prompt. The style preset is added at generation, so it is only named here."""
    preset = next((p for p in presets(session) if p.get("id") == body.style), None)
    return assist.improve_prompt(session, body.idea.strip(), style=(preset or {}).get("name", ""), kind=body.kind.value)


class CaptionAssistIn(BaseModel):
    account_id: Optional[str] = None
    brief: str = Field(default="", max_length=1000)


@router.post("/assets/{asset_id}/caption")
def assist_caption(asset_id: str, body: CaptionAssistIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    """Draft a caption and hashtags for an asset and keep them on it as its draft."""
    asset = session.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(404, "asset not found")
    account = session.get(Account, body.account_id) if body.account_id else None
    if body.account_id and account is None:
        raise HTTPException(404, "account not found")
    draft = assist.write_caption(session, asset, account, brief=body.brief.strip())
    asset.caption_draft = draft["caption"]
    asset.hashtags_draft = draft["hashtags"]
    session.add(asset)
    session.commit()
    session.refresh(asset)
    return {**draft, "asset": _asset_out(asset, used_in=_usage(session, [asset.id]).get(asset.id, 0))}


class QuickPostIn(BaseModel):
    # Either an existing account, or a phone plus the Instagram handle signed in on it.
    account_id: Optional[str] = None
    phone_id: Optional[str] = None
    handle: Optional[str] = Field(default=None, max_length=30)
    caption: str = Field(default="", max_length=2200)
    hashtags: list[str] = Field(default_factory=list)
    # Empty posts now; a time schedules it for the calendar.
    scheduled_at: Optional[datetime] = None
    tz: str = Field(default="UTC", max_length=64)


def _naive_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Clients send ISO strings with or without an offset; storage is UTC naive."""
    if dt is None or dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


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
    when = _naive_utc(body.scheduled_at)
    if when is not None and when < utcnow() + timedelta(seconds=60):
        raise HTTPException(422, "pick a time at least a minute from now, or post now")
    if when is None and scheduler.is_paused():
        raise HTTPException(409, "publishing is paused; resume it first, or schedule the post for later")
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
        title=f"Studio: {((asset.params or {}).get('prompt') or asset.prompt or '').strip()[:60]}",
        caption=body.caption.strip(),
        hashtags=hashtags,
        media_id=asset.id,
        placement="feed",
        status=PostStatus.scheduled if when else PostStatus.approved,
        scheduled_at=when,
        tz=body.tz or "UTC",
        approved_at=now,
        spec_check=report.to_dict(),
    )
    if when is not None:
        # The phone booking and cooldown are judged by the scheduler when the time comes;
        # what must already be true is that someone can post it.
        if not account.phone_id:
            session.rollback()
            raise HTTPException(409, f"@{account.handle} is not linked to a phone")
        # Two posts inside one cooldown would leave the second one handed back at
        # dispatch time; say so now, while the time can still be changed.
        others = session.exec(
            select(Post).where(Post.account_id == account.id, Post.status == PostStatus.scheduled, Post.scheduled_at != None)  # noqa: E711
        ).all()
        cooldown = settings_store.publishing(session)["cooldown_seconds"]
        for other in others:
            if abs((other.scheduled_at - when).total_seconds()) < cooldown:
                session.rollback()
                raise HTTPException(
                    409,
                    f"@{account.handle} already has a post at {other.scheduled_at:%Y-%m-%d %H:%M} UTC; "
                    f"posts on one account need {cooldown}s between them",
                )
    else:
        # Check the guards before saving, so a refusal (no phone, phone busy, cooldown) leaves nothing behind.
        try:
            runner.preflight(session, post)
        except runner.NotPublishable as exc:
            session.rollback()
            raise HTTPException(409, str(exc)) from exc
    session.add(post)
    session.commit()
    session.refresh(post)
    asset.caption_draft, asset.hashtags_draft = post.caption, hashtags
    session.add(asset)
    session.commit()

    if when is None:
        publish_now(post_id=post.id, session=session)
    events.emit("post.scheduled" if when else "post.publish_requested", post_id=post.id, account=account.handle)
    return {"post_id": post.id, "account": account.handle, "scheduled_at": post.scheduled_at}
