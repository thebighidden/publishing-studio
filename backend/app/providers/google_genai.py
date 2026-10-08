from __future__ import annotations

import base64
import json
import os
import random
import time
from typing import Any, Optional

from .base import ImageProvider, MediaResult, NotConfigured, ProviderError, VideoProvider, aspect_size


DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image"
DEFAULT_VIDEO_MODEL = "veo-3.1-fast-generate-001"
PRODUCT_NEGATIVE = (
    "distorted product, changed packaging, altered logo, misspelled text, warped label, "
    "duplicate product, unsafe movement, abrupt camera motion, flicker"
)


def _sdk():
    try:
        from google import genai
        from google.genai import types
    except ImportError as exc:  # pragma: no cover - depends on optional runtime install
        raise NotConfigured(
            "Google Gen AI support is not installed. Run pip install -r backend/requirements.txt."
        ) from exc
    return genai, types


class _GoogleClient:
    """Google Gen AI client shared by Gemini image and Veo video adapters.

    An API key is enough for Gemini image generation. Veo mirrors Aluna's
    production path and uses Vertex AI: set a project and authenticate through
    Application Default Credentials, or paste a service-account JSON document
    into the encrypted credential field.
    """

    def __init__(self, credential: str, options: Optional[dict[str, Any]] = None, *, video: bool = False):
        self.credential = (credential or "").strip()
        self.options = options or {}
        self.video = video
        self.project = str(self.options.get("project") or os.environ.get("GOOGLE_CLOUD_PROJECT") or "").strip()
        self.location = str(
            self.options.get("video_location" if video else "location")
            or ("us-central1" if video else "global")
        ).strip()
        self.credentials = None

        if self.credential.startswith("{"):
            try:
                from google.oauth2 import service_account

                info = json.loads(self.credential)
                self.credentials = service_account.Credentials.from_service_account_info(
                    info,
                    scopes=["https://www.googleapis.com/auth/cloud-platform"],
                )
                self.project = self.project or str(info.get("project_id") or "")
            except (ValueError, KeyError, json.JSONDecodeError) as exc:
                raise NotConfigured(f"invalid Google service-account JSON: {exc}") from exc

    @property
    def vertex(self) -> bool:
        return bool(self.project)

    def build(self):
        genai, types = _sdk()
        if self.vertex:
            kwargs: dict[str, Any] = {
                "vertexai": True,
                "project": self.project,
                "location": self.location,
                "http_options": types.HttpOptions(api_version="v1"),
            }
            if self.credentials is not None:
                kwargs["credentials"] = self.credentials
            return genai.Client(**kwargs)
        if self.video:
            raise NotConfigured(
                "Veo needs a Google Cloud project. Add Project ID and Vertex location in provider settings."
            )
        if not self.credential:
            raise NotConfigured(
                "Gemini needs an API key, or a Google Cloud project with Application Default Credentials."
            )
        return genai.Client(api_key=self.credential)

    def check(self, model: str) -> str:
        client = self.build()
        try:
            client.models.get(model=model)
        except Exception as exc:  # noqa: BLE001 - normalize third-party errors
            raise _provider_error(exc, "Google model check") from exc
        mode = f"Vertex {self.project}/{self.location}" if self.vertex else "Gemini API key"
        return f"{mode} accepted; {model} is reachable"


def _provider_error(exc: Exception, action: str) -> ProviderError:
    message = str(exc)
    lowered = message.lower()
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    retryable = bool(
        status in {408, 409, 425, 429, 500, 502, 503, 504}
        or "resource exhausted" in lowered
        or "rate limit" in lowered
        or "temporarily unavailable" in lowered
    )
    return ProviderError(f"{action} failed: {message[:500]}", retryable=retryable, status=status)


def _bytes(value: Any) -> bytes:
    if isinstance(value, bytes):
        return value
    if isinstance(value, bytearray):
        return bytes(value)
    if isinstance(value, str):
        return base64.b64decode(value)
    raise ProviderError("Google returned image data in an unsupported format")


class GoogleGenAIImage(ImageProvider):
    name = "google_genai/image"

    def __init__(
        self,
        credential: str,
        base_url: str = "",
        model: str = DEFAULT_IMAGE_MODEL,
        options: Optional[dict[str, Any]] = None,
    ):
        self.google = _GoogleClient(credential, options)
        self.model = model or DEFAULT_IMAGE_MODEL
        self.options = options or {}

    def generate(
        self,
        prompt: str,
        *,
        aspect: str = "1:1",
        seed: int | None = None,
        image: bytes | None = None,
        image_mime: str = "image/png",
        params: dict | None = None,
    ) -> MediaResult:
        client = self.google.build()
        _, types = _sdk()
        parts = [types.Part.from_text(text=prompt)]
        if image:
            parts.append(types.Part.from_bytes(data=image, mime_type=image_mime or "image/png"))
        contents = [types.Content(role="user", parts=parts)]
        image_size = str(self.options.get("image_size") or "1K")
        try:
            response = client.models.generate_content(
                model=self.model,
                contents=contents,
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE"],
                    seed=seed,
                    image_config=types.ImageConfig(
                        aspect_ratio=aspect,
                        image_size=image_size,
                        person_generation="ALLOW_ADULT",
                        output_mime_type="image/png",
                    ),
                ),
            )
        except Exception as exc:  # noqa: BLE001
            raise _provider_error(exc, "Gemini image generation") from exc

        for part in getattr(response, "parts", None) or []:
            inline = getattr(part, "inline_data", None)
            data = getattr(inline, "data", None) if inline else None
            if data:
                raw = _bytes(data)
                w, h = aspect_size(aspect)
                usage = getattr(response, "usage_metadata", None)
                return MediaResult(
                    data=raw,
                    ext=".png",
                    mime=getattr(inline, "mime_type", None) or "image/png",
                    model=getattr(response, "model_version", None) or self.model,
                    width=w,
                    height=h,
                    meta={
                        "aspect": aspect,
                        "reference_used": bool(image),
                        "image_size": image_size,
                        "input_tokens": getattr(usage, "prompt_token_count", 0) or 0,
                        "output_tokens": getattr(usage, "candidates_token_count", 0) or 0,
                    },
                )
        feedback = getattr(getattr(response, "prompt_feedback", None), "block_reason", None)
        detail = f" (blocked: {feedback})" if feedback else ""
        raise ProviderError(f"Gemini returned no image{detail}")

    def check(self) -> str:
        return self.google.check(self.model)


class GoogleVeoVideo(VideoProvider):
    name = "google_genai/video"

    def __init__(
        self,
        credential: str,
        base_url: str = "",
        model: str = DEFAULT_VIDEO_MODEL,
        options: Optional[dict[str, Any]] = None,
    ):
        self.google = _GoogleClient(credential, options, video=True)
        self.model = model or DEFAULT_VIDEO_MODEL
        self.options = options or {}

    def generate(
        self,
        prompt: str,
        *,
        aspect: str = "9:16",
        duration_s: float = 5.0,
        image: bytes | None = None,
        params: dict | None = None,
    ) -> MediaResult:
        params = params or {}
        client = self.google.build()
        _, types = _sdk()
        duration = min((4, 6, 8), key=lambda value: abs(value - float(duration_s)))
        config: dict[str, Any] = {
            "number_of_videos": 1,
            "fps": 24,
            "duration_seconds": duration,
            "aspect_ratio": aspect if aspect in {"9:16", "16:9"} else "9:16",
            "resolution": str(self.options.get("resolution") or "720p"),
            "person_generation": "allow_adult",
            "generate_audio": bool(params.get("audio", self.options.get("generate_audio", True))),
            "enhance_prompt": True,
            "seed": int(self.options.get("seed") or random.randint(1, 2_147_483_646)),
            "negative_prompt": str(self.options.get("negative_prompt") or PRODUCT_NEGATIVE),
        }
        output_gcs_uri = str(self.options.get("output_gcs_uri") or "").strip()
        if not output_gcs_uri:
            raise NotConfigured(
                "Veo needs an output GCS path such as gs://your-bucket/aluna-renders. "
                "Add it in the provider configuration."
            )
        config["output_gcs_uri"] = output_gcs_uri.rstrip("/") + "/"

        source_image = types.Image(image_bytes=image, mime_type="image/png") if image else None
        try:
            operation = client.models.generate_videos(
                model=self.model,
                prompt=prompt,
                image=source_image,
                config=types.GenerateVideosConfig(**config),
            )
            timeout = float(self.options.get("timeout_s") or 1800)
            deadline = time.monotonic() + timeout
            while not operation.done and time.monotonic() < deadline:
                time.sleep(float(self.options.get("poll_seconds") or 15))
                operation = client.operations.get(operation)
            if not operation.done:
                raise ProviderError(f"Veo generation is still running after {timeout:.0f}s", retryable=True)
            if getattr(operation, "error", None):
                raise ProviderError(f"Veo operation failed: {operation.error}")
        except ProviderError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise _provider_error(exc, "Veo video generation") from exc

        response = getattr(operation, "response", None) or getattr(operation, "result", None)
        generated = (getattr(response, "generated_videos", None) or [None])[0]
        video = getattr(generated, "video", None) if generated else None
        if video is None:
            reasons = getattr(response, "rai_media_filtered_reasons", None)
            raise ProviderError(f"Veo returned no video{f': {reasons}' if reasons else ''}")

        data = getattr(video, "video_bytes", None)
        uri = getattr(video, "uri", None)
        if not data and uri:
            data = self._download_gcs(uri)
        if not data:
            try:
                data = client.files.download(file=video)
            except Exception as exc:  # noqa: BLE001
                raise _provider_error(exc, "Veo result download") from exc

        w, h = aspect_size(config["aspect_ratio"])
        return MediaResult(
            data=_bytes(data),
            ext=".mp4",
            mime="video/mp4",
            model=self.model,
            width=w,
            height=h,
            duration_s=float(duration),
            meta={
                "operation_name": getattr(operation, "name", None),
                "source_uri": uri,
                "reference_used": bool(image),
                "resolution": config["resolution"],
                "audio": config["generate_audio"],
            },
        )

    def _download_gcs(self, uri: str) -> bytes:
        if not uri.startswith("gs://"):
            raise ProviderError(f"Veo returned an unsupported result URI: {uri[:120]}")
        try:
            from google.cloud import storage

            bucket_name, _, blob_name = uri[5:].partition("/")
            client = storage.Client(project=self.google.project, credentials=self.google.credentials)
            return client.bucket(bucket_name).blob(blob_name).download_as_bytes()
        except Exception as exc:  # noqa: BLE001
            raise _provider_error(exc, "Google Cloud Storage download") from exc

    def check(self) -> str:
        if not str(self.options.get("output_gcs_uri") or "").startswith("gs://"):
            raise NotConfigured("Veo needs a valid gs:// output path in provider settings")
        return self.google.check(self.model)
