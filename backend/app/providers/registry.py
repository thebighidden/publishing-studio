from __future__ import annotations

from typing import Optional

from sqlmodel import Session, select

from ..crypto import decrypt
from ..models import ProviderAdapter, ProviderConfig, ProviderKind
from .anthropic import AnthropicText
from .comfyui import WORKFLOWS as COMFYUI_WORKFLOWS
from .comfyui import ComfyUIImage
from .base import (
    ImageProvider,
    MediaResult,
    NotConfigured,
    ProviderError,
    TextProvider,
    TextResult,
    VideoProvider,
)
from . import higgsfield_catalog
from .higgsfield import HiggsfieldImage, HiggsfieldVideo
from .google_genai import GoogleGenAIImage, GoogleVeoVideo
from .openai_compat import OpenAICompatImage, OpenAICompatText
from .simulated import SimulatedImage, SimulatedText, SimulatedVideo

__all__ = [
    "ImageProvider",
    "MediaResult",
    "NotConfigured",
    "ProviderError",
    "TextProvider",
    "TextResult",
    "VideoProvider",
    "build",
    "describe",
    "get_image",
    "get_text",
    "get_video",
]


# A studio model id is a provider row id, or "<row id>~<catalog key>" for one of
# the models a single Higgsfield key unlocks.
MODEL_SEP = "~"


def build(cfg: ProviderConfig, model_key: Optional[str] = None):
    """Turn a stored row into a live client. Raises if it cannot be built."""
    key = decrypt(cfg.api_key) or ""
    opts = cfg.options or {}

    if model_key:
        spec = higgsfield_catalog.find(model_key)
        if cfg.adapter != ProviderAdapter.higgsfield or spec is None:
            raise NotConfigured(f"unknown model {model_key!r}")
        if spec.kind == "image":
            return HiggsfieldImage(key, cfg.base_url or "", spec.path, opts, spec)
        return HiggsfieldVideo(key, cfg.base_url or "", spec.path or spec.i2v_path, opts, spec)

    if cfg.adapter == ProviderAdapter.simulated:
        return {
            ProviderKind.text: SimulatedText,
            ProviderKind.image: SimulatedImage,
            ProviderKind.video: SimulatedVideo,
        }[cfg.kind](opts)

    if cfg.adapter == ProviderAdapter.google_genai:
        if cfg.kind == ProviderKind.image:
            return GoogleGenAIImage(key, cfg.base_url or "", cfg.model or "", opts)
        if cfg.kind == ProviderKind.video:
            return GoogleVeoVideo(key, cfg.base_url or "", cfg.model or "", opts)
        raise NotConfigured("Google Gen AI is configured here for image and video generation")

    if cfg.adapter == ProviderAdapter.higgsfield:
        if cfg.kind == ProviderKind.image:
            return HiggsfieldImage(key, cfg.base_url or "", cfg.model or "", opts)
        if cfg.kind == ProviderKind.video:
            return HiggsfieldVideo(key, cfg.base_url or "", cfg.model or "", opts)
        raise NotConfigured("Higgsfield does not provide text generation")

    if cfg.adapter == ProviderAdapter.anthropic:
        if cfg.kind != ProviderKind.text:
            raise NotConfigured("the Anthropic adapter is text only")
        return AnthropicText(key, cfg.base_url or "", cfg.model or "", opts)

    if cfg.adapter == ProviderAdapter.comfyui:
        if cfg.kind != ProviderKind.image:
            raise NotConfigured("the ComfyUI adapter generates images only")
        return ComfyUIImage(cfg.base_url or "", cfg.model or "", opts)

    if cfg.adapter == ProviderAdapter.openai_compat:
        if cfg.kind == ProviderKind.text:
            return OpenAICompatText(cfg.base_url or "", key, cfg.model or "", opts)
        if cfg.kind == ProviderKind.image:
            return OpenAICompatImage(cfg.base_url or "", key, cfg.model or "", opts)
        raise NotConfigured(
            "no OpenAI-compatible video route; use Higgsfield for video"
        )

    raise NotConfigured(f"unknown adapter {cfg.adapter}")


def _pick(session: Session, kind: ProviderKind) -> Optional[ProviderConfig]:
    rows = session.exec(
        select(ProviderConfig).where(
            ProviderConfig.kind == kind, ProviderConfig.enabled == True  # noqa: E712
        )
    ).all()
    if not rows:
        return None
    rows.sort(key=lambda r: (not r.is_default, r.created_at))
    return rows[0]


def _resolve(session: Session, kind: ProviderKind, fallback):
    """Configured provider if there is one, otherwise the offline stand-in.

    Falling back rather than failing is deliberate: a team with no keys yet can
    still drive the entire studio, and every asset it produces is labelled
    simulated so nobody ships it by accident.
    """
    cfg = _pick(session, kind)
    if cfg is None:
        return fallback(), None
    try:
        return build(cfg), cfg
    except (NotConfigured, ProviderError):
        return fallback(), None


def get_text(session: Session) -> tuple[TextProvider, Optional[ProviderConfig]]:
    return _resolve(session, ProviderKind.text, SimulatedText)


def get_image(session: Session) -> tuple[ImageProvider, Optional[ProviderConfig]]:
    return _resolve(session, ProviderKind.image, SimulatedImage)


def get_video(session: Session) -> tuple[VideoProvider, Optional[ProviderConfig]]:
    return _resolve(session, ProviderKind.video, SimulatedVideo)


def get_chosen(session: Session, kind: ProviderKind, provider_id: Optional[str]):
    """The provider the operator picked in the studio, or the default when none was.

    Unlike the default path this never falls back silently: a model that was
    chosen by name and cannot be built is an error the operator should see."""
    if not provider_id:
        return get_image(session) if kind == ProviderKind.image else get_video(session)
    cfg_id, _, model_key = provider_id.partition(MODEL_SEP)
    cfg = session.get(ProviderConfig, cfg_id)
    gone = NotConfigured(f"that {kind.value} model is not available any more; pick another")
    if cfg is None or not cfg.enabled:
        raise gone
    if model_key:
        spec = higgsfield_catalog.find(model_key)
        if cfg.adapter != ProviderAdapter.higgsfield or spec is None or spec.kind != kind.value:
            raise gone
        return build(cfg, model_key), cfg
    if cfg.kind != kind:
        raise gone
    return build(cfg), cfg


def model_name(provider_id: str, cfg: Optional[ProviderConfig], kind: ProviderKind) -> str:
    """The label an asset records for the model that made it."""
    _, _, model_key = (provider_id or "").partition(MODEL_SEP)
    spec = higgsfield_catalog.find(model_key) if model_key else None
    if spec is not None:
        return f"higgsfield/{spec.name}"
    return describe(cfg, kind)


_PRIVATE_HOSTS = ("localhost", "127.", "10.", "192.168.", "172.16.", "172.17.", "172.18.", "172.19.",
                  "172.2", "172.30.", "172.31.", "host.docker.internal")


def reach(cfg: Optional[ProviderConfig]) -> str:
    """How a model is reached, for the studio's model picker (feature f105)."""
    if cfg is None or cfg.adapter == ProviderAdapter.simulated:
        return "offline"
    host = (cfg.base_url or "").split("://")[-1]
    if cfg.adapter == ProviderAdapter.comfyui or (host and host.startswith(_PRIVATE_HOSTS)):
        return "local"
    return "cloud"


def describe(cfg: Optional[ProviderConfig], kind: ProviderKind) -> str:
    if cfg is None:
        return f"simulated/{kind.value}"
    return f"{cfg.adapter.value}/{cfg.model or kind.value}"


# What the Settings screen offers when adding a provider. Kept here so the UI
# never has to hardcode model names.
CATALOG = [
    {
        "adapter": "google_genai",
        "label": "Google Gemini + Veo (Aluna workflow)",
        "kinds": ["image", "video"],
        "key_hint": (
            "Gemini API key for images, or service-account JSON for Vertex. "
            "Leave blank to use Application Default Credentials."
        ),
        "base_url": "",
        "models": {
            "image": [
                "gemini-3.1-flash-image",
                "gemini-3.1-flash-lite-image",
                "gemini-2.5-flash-image",
            ],
            "video": [
                "veo-3.1-fast-generate-001",
                "veo-3.1-generate-001",
            ],
        },
        "option_fields": [
            {"id": "project", "label": "Google Cloud project", "placeholder": "my-project-id"},
            {"id": "location", "label": "Image location", "placeholder": "global"},
            {"id": "video_location", "label": "Veo location", "placeholder": "us-central1"},
            {"id": "output_gcs_uri", "label": "Veo output GCS path", "placeholder": "gs://bucket/aluna-renders"},
        ],
        "note": (
            "The Aluna path: reference-aware Gemini image generation plus Veo image-to-video. "
            "Veo requires a Google Cloud project, Vertex access, and normally a GCS output path."
        ),
    },
    {
        "adapter": "higgsfield",
        "label": "Higgsfield",
        "kinds": ["image", "video"],
        "key_hint": "KEY_ID:KEY_SECRET (both halves, colon separated)",
        "base_url": "https://api.higgsfield.ai",
        "models": {
            "image": [s.path for s in higgsfield_catalog.CATALOG if s.kind == "image"],
            "video": [s.path for s in higgsfield_catalog.CATALOG if s.kind == "video"],
        },
        "note": (
            "One key unlocks every model in the studio's Higgsfield catalog (Soul, Grok Image, "
            "Kling, Seedance, Hailuo); the model chosen here is just the default. To use a model "
            "the catalog does not list, enter its endpoint path. The concurrency limit returns "
            "HTTP 400, not 429."
        ),
    },
    {
        "adapter": "openai_compat",
        "label": "OpenAI-compatible endpoint",
        "kinds": ["text", "image"],
        "key_hint": "API key, or blank for an unauthenticated local server",
        "base_url": "https://api.openai.com/v1",
        "models": {
            "text": ["gpt-4o-mini", "gpt-4o", "qwen2.5:14b", "llama3.1:8b"],
            "image": ["gpt-image-1", "dall-e-3"],
        },
        "note": (
            "Point this at your own DGX. A vLLM, TGI or Ollama server exposing "
            "/v1/chat/completions or /v1/images/generations works unchanged — set the "
            "base URL to the host and leave the key blank if it is open."
        ),
    },
    {
        "adapter": "comfyui",
        "label": "ComfyUI server (local models)",
        "kinds": ["image"],
        "key_hint": "no key needed",
        "base_url": "http://172.17.215.206:8188",
        "models": {"image": list(COMFYUI_WORKFLOWS)},
        "note": (
            "Runs an exported ComfyUI workflow on your own GPU server. The model field names "
            "the workflow. z_image_turbo is text-to-image only: generate without a reference "
            "image. Start ComfyUI with --listen so the studio can reach it."
        ),
    },
    {
        "adapter": "anthropic",
        "label": "Anthropic (Claude)",
        "kinds": ["text"],
        "key_hint": "sk-ant-...",
        "base_url": "https://api.anthropic.com/v1",
        "models": {"text": ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5-20251001"]},
        "note": "Used for the writer and adapter agents.",
    },
    {
        "adapter": "simulated",
        "label": "Simulated (offline)",
        "kinds": ["text", "image", "video"],
        "key_hint": "no key needed",
        "base_url": "",
        "models": {"text": [], "image": [], "video": []},
        "note": (
            "No network, no credits. Text is templated, images are rendered locally "
            "and video is a real MP4 encoded with the bundled ffmpeg. This is what "
            "runs when nothing else is configured."
        ),
    },
]
