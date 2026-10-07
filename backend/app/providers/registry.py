from __future__ import annotations

from typing import Optional

from sqlmodel import Session, select

from ..crypto import decrypt
from ..models import ProviderAdapter, ProviderConfig, ProviderKind
from .anthropic import AnthropicText
from .base import (
    ImageProvider,
    MediaResult,
    NotConfigured,
    ProviderError,
    TextProvider,
    TextResult,
    VideoProvider,
)
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


def build(cfg: ProviderConfig):
    """Turn a stored row into a live client. Raises if it cannot be built."""
    key = decrypt(cfg.api_key) or ""
    opts = cfg.options or {}

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
            "image": [
                "/higgsfield-ai/soul/standard",
                "/higgsfield-ai/soul/v2/standard",
            ],
            "video": [
                "/minimax/hailuo-2.3/standard/text-to-video",
                "/minimax/hailuo-2.3/standard/image-to-video",
                "/kling-video/v2.5-turbo/pro/image-to-video",
                "/wan/v2.7/image-to-video",
            ],
        },
        "note": (
            "The model field is the endpoint path, so a new Higgsfield model is a "
            "new path and needs no code change. Generation is asynchronous and the "
            "concurrency limit returns HTTP 400, not 429."
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
