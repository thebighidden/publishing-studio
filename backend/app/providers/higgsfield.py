from __future__ import annotations

import time
from typing import Any, Optional

import httpx

from .base import ImageProvider, MediaResult, NotConfigured, ProviderError, VideoProvider

BASE_URL = "https://api.higgsfield.ai"

# Terminal states. `nsfw` and `canceled` end the job without a result.
TERMINAL_OK = {"completed"}
TERMINAL_BAD = {"failed", "nsfw", "canceled"}

DEFAULT_IMAGE_PATH = "/higgsfield-ai/soul/standard"
DEFAULT_T2V_PATH = "/minimax/hailuo-2.3/standard/text-to-video"
DEFAULT_I2V_PATH = "/minimax/hailuo-2.3/standard/image-to-video"

# Only these aspect ratios are accepted by soul/standard.
IMAGE_ASPECTS = {"1:1", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "16:9", "9:16", "21:9"}

UPLOAD_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


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
        return request_id

    def poll(self, request_id: str, timeout_s: float, interval: float = 5.0) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_s
        last_status = "unknown"
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
                if last_status in TERMINAL_BAD:
                    reason = data.get("error") or last_status
                    raise ProviderError(
                        f"Higgsfield job {request_id} ended as {last_status}: {reason}",
                        retryable=False,
                    )
                time.sleep(interval)
        raise ProviderError(
            f"Higgsfield job {request_id} still {last_status} after {timeout_s:.0f}s",
            retryable=True,
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


class HiggsfieldImage(ImageProvider):
    def __init__(
        self,
        api_key: str,
        base_url: str = BASE_URL,
        model: str = DEFAULT_IMAGE_PATH,
        options: Optional[dict[str, Any]] = None,
    ):
        self.client = _HiggsfieldClient(api_key, base_url)
        # `model` is the endpoint path. New models are new paths, so a team can
        # point at one without a code change.
        self.model = model or DEFAULT_IMAGE_PATH
        self.options = options or {}

    def generate(
        self,
        prompt: str,
        *,
        aspect: str = "1:1",
        seed: int | None = None,
        image: bytes | None = None,
        image_mime: str = "image/png",
    ) -> MediaResult:
        body: dict[str, Any] = {"prompt": prompt, "num_images": 1}
        if aspect in IMAGE_ASPECTS:
            body["aspect_ratio"] = aspect
        resolution = self.options.get("resolution", "2K")
        if resolution:
            body["resolution"] = resolution
        body.update(self.options.get("extra_body") or {})

        request_id = self.client.submit(self.model, body)
        result = self.client.poll(
            request_id, timeout_s=float(self.options.get("timeout_s", 600))
        )
        images = result.get("images") or []
        if not images or not images[0].get("url"):
            raise ProviderError(f"job completed with no image: {str(result)[:300]}")
        url = images[0]["url"]
        return MediaResult(
            data=self.client.download(url),
            ext=".png",
            mime="image/png",
            model=self.model,
            meta={"request_id": request_id, "source_url": url, "aspect": aspect},
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
    ):
        self.client = _HiggsfieldClient(api_key, base_url)
        self.model = model or DEFAULT_T2V_PATH
        self.options = options or {}

    @property
    def _i2v_path(self) -> str:
        return self.options.get("image_to_video_path") or DEFAULT_I2V_PATH

    def generate(
        self,
        prompt: str,
        *,
        aspect: str = "9:16",
        duration_s: float = 5.0,
        image: bytes | None = None,
    ) -> MediaResult:
        body: dict[str, Any] = {"prompt": prompt}
        path = self.model

        if image:
            # Video orientation follows the input image; these endpoints carry
            # no aspect_ratio field of their own.
            path = self._i2v_path
            body["image_url"] = self.client.upload(image, ".png")

        allowed = self.options.get("durations") or [6, 10]
        body["duration"] = min(allowed, key=lambda d: abs(d - duration_s))
        body.update(self.options.get("extra_body") or {})

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
            meta={"request_id": request_id, "source_url": url},
        )

    def check(self) -> str:
        return self.client.check()
