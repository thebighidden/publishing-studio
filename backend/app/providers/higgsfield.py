from __future__ import annotations

import io
import time
from dataclasses import replace
from typing import Any, Optional

import httpx
from PIL import Image, UnidentifiedImageError

from . import control
from . import higgsfield_catalog as catalog
from .base import ImageProvider, MediaResult, NotConfigured, ProviderError, VideoProvider
from .higgsfield_catalog import ModelSpec

BASE_URL = "https://api.higgsfield.ai"

# Terminal states. `nsfw` and `canceled` end the job without a result.
TERMINAL_OK = {"completed"}
TERMINAL_BAD = {"failed", "nsfw", "canceled"}

DEFAULT_IMAGE_PATH = "/higgsfield-ai/soul/v2/standard"
DEFAULT_T2V_PATH = "/minimax/hailuo-2.3/standard/text-to-video"
DEFAULT_I2V_PATH = "/minimax/hailuo-2.3/standard/image-to-video"

UPLOAD_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
_EXT_FOR_MIME = {"image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
_PIL_FORMATS = {"PNG": (".png", "image/png"), "JPEG": (".jpg", "image/jpeg"), "WEBP": (".webp", "image/webp")}


def _is_concurrency_error(detail: str) -> bool:
    # Over-limit comes back as HTTP 400, not 429, and there is no Retry-After
    # header, so the message is the only signal.
    d = detail.lower()
    return "concurrent request" in d or "rate limit" in d


class _HiggsfieldClient:
    def __init__(self, api_key: str, base_url: str = BASE_URL, timeout: float = 120.0):
        if not api_key:
            raise NotConfigured(
                "Higgsfield needs a key in the form KEY_ID:KEY_SECRET (both halves, "
                "separated by a colon)."
            )
        if ":" not in api_key:
            raise NotConfigured(
                "Higgsfield key looks wrong. It must be KEY_ID:KEY_SECRET, not a single token."
            )
        self.api_key = api_key.strip()
        self.base_url = (base_url or BASE_URL).rstrip("/")
        self.timeout = timeout

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self.base_url,
            headers={
                "Authorization": f"Key {self.api_key}",
                "Content-Type": "application/json",
            },
            timeout=self.timeout,
            follow_redirects=True,
        )

    @staticmethod
    def _detail(resp: httpx.Response) -> str:
        try:
            return str(resp.json().get("detail") or resp.text)[:400]
        except (ValueError, AttributeError):
            return resp.text[:400]

    def submit(self, path: str, body: dict[str, Any]) -> str:
        with self._client() as c:
            resp = c.post(path, json=body)
        if resp.status_code >= 400:
            detail = self._detail(resp)
            raise ProviderError(
                f"Higgsfield {path} rejected the request ({resp.status_code}): {detail}",
                retryable=_is_concurrency_error(detail) or resp.status_code >= 500,
                status=resp.status_code,
            )
        data = resp.json()
        request_id = data.get("request_id")
        if not request_id:
            raise ProviderError(f"no request_id in submission response: {str(data)[:300]}")
        job = control.current.get()
        if job is not None:
            job.on_remote_id(request_id)
        return request_id

    def cancel(self, request_id: str) -> bool:
        """Only works while Higgsfield still has the request queued."""
        with self._client() as c:
            resp = c.post(f"/requests/{request_id}/cancel")
        return resp.status_code < 400

    def poll(self, request_id: str, timeout_s: float, interval: float = 5.0) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_s
        last_status = "unknown"
        job = control.current.get()
        with self._client() as c:
            while time.monotonic() < deadline:
                resp = c.get(f"/requests/{request_id}/status")
                if resp.status_code >= 400:
                    raise ProviderError(
                        f"status check failed ({resp.status_code}): {self._detail(resp)}",
                        retryable=resp.status_code >= 500,
                        status=resp.status_code,
                    )
                data = resp.json()
                last_status = data.get("status", "unknown")
                if last_status in TERMINAL_OK:
                    return data
                if last_status == "canceled" and job is not None and job.cancelled():
                    raise control.Cancelled()
                if last_status in TERMINAL_BAD:
                    reason = data.get("error") or last_status
                    if last_status == "nsfw":
                        reason = "the prompt or the result was blocked by the model's content filter"
                    raise ProviderError(
                        f"Higgsfield job ended as {last_status}: {reason}",
                        retryable=False,
                    )
                if job is not None and job.cancelled():
                    if last_status == "queued" and self.cancel(request_id):
                        raise control.Cancelled()
                    # Already generating: Higgsfield cannot stop it, so let it finish.
                time.sleep(interval)
        raise ProviderError(
            f"Higgsfield job {request_id} still {last_status} after {timeout_s:.0f}s",
            retryable=False,  # it may still finish and be billed; do not submit a second one
        )

    def upload(self, data: bytes, ext: str) -> str:
        """Local bytes to a public URL the generation endpoints can read.

        Presigned PUT: the storage URL must never see Higgsfield credentials.
        """
        content_type = UPLOAD_TYPES.get(ext.lower(), "image/png")
        with self._client() as c:
            resp = c.post("/files/generate-upload-url", json={"content_type": content_type})
        if resp.status_code >= 400:
            raise ProviderError(f"could not get an upload URL: {self._detail(resp)}")
        info = resp.json()
        upload_url, public_url = info.get("upload_url"), info.get("public_url")
        if not upload_url or not public_url:
            raise ProviderError(f"malformed upload-url response: {str(info)[:300]}")

        headers = dict(info.get("upload_headers") or {})
        headers.setdefault("Content-Type", content_type)
        put = httpx.put(upload_url, content=data, headers=headers, timeout=300.0)
        if put.status_code >= 400:
            raise ProviderError(f"upload to storage failed ({put.status_code}): {put.text[:200]}")
        return public_url

    def download(self, url: str) -> bytes:
        resp = httpx.get(url, timeout=600.0, follow_redirects=True)
        if resp.status_code >= 400:
            raise ProviderError(f"could not download result ({resp.status_code})", retryable=True)
        return resp.content

    def check(self) -> str:
        """Hit an authenticated route without spending credits. A made-up
        request id proves the credentials parse: 404 means authenticated,
        401 means not."""
        with self._client() as c:
            resp = c.get("/requests/00000000-0000-0000-0000-000000000000/status")
        if resp.status_code == 401:
            raise ProviderError("Higgsfield rejected the credentials (401)", status=401)
        if resp.status_code in (200, 404):
            return "credentials accepted"
        raise ProviderError(
            f"unexpected response from Higgsfield ({resp.status_code}): {self._detail(resp)}",
            status=resp.status_code,
        )


def _spec_for(kind: str, model: str, spec: Optional[ModelSpec]) -> ModelSpec:
    if spec is not None:
        return spec
    return catalog.find(model) or catalog.generic(kind, model)


def _describe_image(data: bytes) -> tuple[str, str, Optional[int], Optional[int]]:
    """The real format and size of a downloaded image (results may be JPEG or WebP)."""
    try:
        with Image.open(io.BytesIO(data)) as img:
            ext, mime = _PIL_FORMATS.get(img.format or "", (".png", "image/png"))
            return ext, mime, img.width, img.height
    except (UnidentifiedImageError, OSError):
        return ".png", "image/png", None, None


class HiggsfieldImage(ImageProvider):
    def __init__(
        self,
        api_key: str,
        base_url: str = BASE_URL,
        model: str = DEFAULT_IMAGE_PATH,
        options: Optional[dict[str, Any]] = None,
        spec: Optional[ModelSpec] = None,
    ):
        self.client = _HiggsfieldClient(api_key, base_url)
        # `model` is the endpoint path. New models are new paths, so a team can
        # point at one without a code change.
        self.model = model or DEFAULT_IMAGE_PATH
        self.spec = _spec_for("image", self.model, spec)
        self.options = options or {}

    def build_body(self, prompt: str, aspect: str, seed: Optional[int], reference_urls: list[str], params: dict) -> tuple[dict[str, Any], dict[str, Any]]:
        spec = self.spec
        body: dict[str, Any] = {"prompt": prompt}
        meta: dict[str, Any] = {}
        if spec.aspects:
            sent = catalog.nearest_aspect(aspect, spec.aspects)
            body["aspect_ratio"] = sent
            if sent != aspect:
                meta["aspect_adjusted"] = {"asked": aspect, "sent": sent}
        resolution = params.get("resolution") or self.options.get("resolution") or spec.default_resolution
        if spec.resolutions and resolution in spec.resolutions:
            body["resolution"] = resolution
        fitted = catalog.fit_seed(seed, spec.seed_range)
        if fitted is not None:
            body["seed"] = fitted
            meta["seed"] = fitted
        if spec.batch_field:
            body[spec.batch_field] = 1
        if reference_urls and spec.reference:
            refs = reference_urls[: spec.max_references or 1]
            body[spec.reference] = refs if spec.reference.endswith("s") else refs[0]
        body.update(spec.extra)
        body.update(self.options.get("extra_body") or {})
        return body, meta

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
        params = params or {}
        refs: list[str] = []
        if image and self.spec.reference:
            refs.append(self.client.upload(image, _EXT_FOR_MIME.get(image_mime, ".png")))
        body, meta = self.build_body(prompt, aspect, seed, refs, params)
        path = self.spec.path

        request_id = self.client.submit(path, body)
        result = self.client.poll(request_id, timeout_s=float(self.options.get("timeout_s", 600)))
        images = result.get("images") or []
        if not images or not images[0].get("url"):
            raise ProviderError(f"job completed with no image: {str(result)[:300]}")
        url = images[0]["url"]
        data = self.client.download(url)
        ext, mime, width, height = _describe_image(data)
        return MediaResult(
            data=data,
            ext=ext,
            mime=mime,
            model=path,
            width=width,
            height=height,
            meta={**meta, "request_id": request_id, "source_url": url, "aspect": body.get("aspect_ratio", aspect),
                  "reference_used": bool(refs)},
        )

    def check(self) -> str:
        return self.client.check()


class HiggsfieldVideo(VideoProvider):
    def __init__(
        self,
        api_key: str,
        base_url: str = BASE_URL,
        model: str = DEFAULT_T2V_PATH,
        options: Optional[dict[str, Any]] = None,
        spec: Optional[ModelSpec] = None,
    ):
        self.client = _HiggsfieldClient(api_key, base_url)
        self.model = model or DEFAULT_T2V_PATH
        self.options = options or {}
        self.spec = _spec_for("video", self.model, spec)
        if not self.spec.i2v_path and self.options.get("image_to_video_path"):
            self.spec = replace(self.spec, i2v_path=self.options["image_to_video_path"])

    def build_body(self, prompt: str, aspect: str, duration_s: float, image_url: str, end_url: str, params: dict) -> tuple[str, dict[str, Any]]:
        spec = self.spec
        if image_url:
            if not spec.i2v_path:
                raise ProviderError(f"{spec.name} cannot start from an image; remove the start frame or pick another model")
            path = spec.i2v_path
        else:
            if not spec.path:
                raise ProviderError(f"{spec.name} needs a start frame; add one, or pick a text-to-video model")
            path = spec.path
        body: dict[str, Any] = {"prompt": prompt}
        if image_url:
            body["image_url"] = image_url
            # Orientation follows the image; image-to-video endpoints take no aspect_ratio.
        elif spec.aspects:
            body["aspect_ratio"] = catalog.nearest_aspect(aspect, spec.aspects)
        if end_url and spec.end_frame and image_url:
            body[spec.end_frame] = end_url
        durations = spec.durations or tuple(self.options.get("durations") or (6, 10))
        body["duration"] = catalog.nearest_duration(float(duration_s), tuple(durations))
        resolution = params.get("resolution") or spec.default_resolution
        if spec.resolutions and resolution in spec.resolutions:
            body["resolution"] = resolution
        audio = params.get("audio", True)
        if spec.audio == "sound":
            body["sound"] = "on" if audio else "off"
        elif spec.audio == "generate_audio":
            body["generate_audio"] = bool(audio)
        body.update(spec.extra)
        body.update(self.options.get("extra_body") or {})
        return path, body

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
        image_url = self.client.upload(image, ".png") if image else ""
        end_image = params.get("end_image")
        end_url = self.client.upload(end_image, ".png") if end_image and image and self.spec.end_frame else ""
        path, body = self.build_body(prompt, aspect, duration_s, image_url, end_url, params)

        request_id = self.client.submit(path, body)
        result = self.client.poll(
            request_id, timeout_s=float(self.options.get("timeout_s", 1500)), interval=8.0
        )
        video = result.get("video") or {}
        if not video.get("url"):
            raise ProviderError(f"job completed with no video: {str(result)[:300]}")
        url = video["url"]
        return MediaResult(
            data=self.client.download(url),
            ext=".mp4",
            mime="video/mp4",
            model=path,
            duration_s=float(body["duration"]),
            meta={"request_id": request_id, "source_url": url, "audio": body.get("sound", body.get("generate_audio")),
                  "end_frame_used": bool(end_url)},
        )

    def check(self) -> str:
        return self.client.check()
