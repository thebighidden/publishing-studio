from __future__ import annotations

import base64
import json
from typing import Any, Optional

import httpx

from .base import (
    ImageProvider,
    MediaResult,
    NotConfigured,
    ProviderError,
    TextProvider,
    TextResult,
    aspect_size,
)

DEFAULT_BASE = "https://api.openai.com/v1"
_RETRYABLE = {408, 409, 425, 429, 500, 502, 503, 504}


def _client(base_url: str, api_key: Optional[str], timeout: float) -> httpx.Client:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return httpx.Client(base_url=base_url.rstrip("/"), headers=headers, timeout=timeout)


def _raise(resp: httpx.Response, what: str) -> None:
    detail = resp.text[:400]
    try:
        payload = resp.json()
        detail = payload.get("error", {}).get("message") or payload.get("message") or detail
    except (json.JSONDecodeError, AttributeError, ValueError):
        pass
    raise ProviderError(
        f"{what} failed ({resp.status_code}): {detail}",
        retryable=resp.status_code in _RETRYABLE,
        status=resp.status_code,
    )


class OpenAICompatText(TextProvider):
    """Any server that speaks the OpenAI chat-completions shape.

    That covers OpenAI itself, a hackathon gateway, OpenRouter, vLLM or TGI on
    your own DGX, Ollama (`http://host:11434/v1`) and LM Studio. Only the base
    URL and model name change.
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE,
        api_key: Optional[str] = None,
        model: str = "gpt-4o-mini",
        options: Optional[dict[str, Any]] = None,
    ):
        self.base_url = base_url or DEFAULT_BASE
        self.api_key = api_key
        self.model = model
        self.options = options or {}

    def complete(
        self,
        prompt: str,
        *,
        system: str = "",
        json_object: bool = False,
        max_tokens: int = 1200,
        temperature: float = 0.7,
    ) -> TextResult:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        body: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if json_object:
            body["response_format"] = {"type": "json_object"}

        with _client(self.base_url, self.api_key, 120.0) as c:
            resp = c.post("/chat/completions", json=body)
            if resp.status_code == 400 and json_object:
                # Local servers often reject response_format. Ask again plainly;
                # the prompt itself still demands JSON.
                body.pop("response_format", None)
                resp = c.post("/chat/completions", json=body)
            if resp.status_code >= 400:
                _raise(resp, "chat completion")
            data = resp.json()

        try:
            text = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError(f"unexpected chat response shape: {str(data)[:300]}") from exc

        usage = data.get("usage") or {}
        return TextResult(
            text=text.strip(),
            model=data.get("model", self.model),
            tokens_in=usage.get("prompt_tokens", 0) or 0,
            tokens_out=usage.get("completion_tokens", 0) or 0,
            cost=float(usage.get("cost", 0.0) or 0.0),
        )

    def check(self) -> str:
        with _client(self.base_url, self.api_key, 30.0) as c:
            resp = c.get("/models")
            if resp.status_code >= 400:
                # Not every gateway exposes /models; a tiny completion proves more.
                out = self.complete("Reply with the single word: ok", max_tokens=8, temperature=0)
                return f"completion ok via {self.model}: {out.text[:40]!r}"
            try:
                ids = [m.get("id") for m in resp.json().get("data", [])][:6]
            except (json.JSONDecodeError, AttributeError):
                ids = []
        listed = ", ".join(i for i in ids if i) or "none listed"
        return f"reachable; models: {listed}"


class OpenAICompatImage(ImageProvider):
    """`POST /images/generations`. Works against OpenAI gpt-image-1/DALL·E and
    against a self-hosted server exposing the same route — which is how a local
    DGX image model is plugged in."""

    def __init__(
        self,
        base_url: str = DEFAULT_BASE,
        api_key: Optional[str] = None,
        model: str = "gpt-image-1",
        options: Optional[dict[str, Any]] = None,
    ):
        self.base_url = base_url or DEFAULT_BASE
        self.api_key = api_key
        self.model = model
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
        w, h = aspect_size(aspect)
        body: dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "n": 1,
            "size": self.options.get("size") or f"{w}x{h}",
        }
        if self.options.get("quality"):
            body["quality"] = self.options["quality"]
        if seed is not None and self.options.get("supports_seed", True):
            body["seed"] = seed
        if self.options.get("response_format"):
            body["response_format"] = self.options["response_format"]

        with _client(self.base_url, self.api_key, 240.0) as c:
            resp = c.post("/images/generations", json=body)
            if resp.status_code == 400 and "size" in resp.text.lower():
                body["size"] = "1024x1024"
                resp = c.post("/images/generations", json=body)
            if resp.status_code >= 400:
                _raise(resp, "image generation")
            payload = resp.json()
            item = (payload.get("data") or [{}])[0]

            if item.get("b64_json"):
                data = base64.b64decode(item["b64_json"])
            elif item.get("url"):
                dl = httpx.get(item["url"], timeout=180.0, follow_redirects=True)
                if dl.status_code >= 400:
                    raise ProviderError(f"could not download image ({dl.status_code})", retryable=True)
                data = dl.content
            else:
                raise ProviderError(f"no image in response: {str(payload)[:300]}")

        return MediaResult(
            data=data,
            ext=".png",
            mime="image/png",
            model=self.model,
            width=w,
            height=h,
            meta={"revised_prompt": item.get("revised_prompt")},
        )

    def check(self) -> str:
        if not self.base_url:
            raise NotConfigured("no base URL set")
        with _client(self.base_url, self.api_key, 30.0) as c:
            resp = c.get("/models")
        if resp.status_code >= 400:
            raise ProviderError(
                f"image endpoint not reachable ({resp.status_code}). "
                "Generate a test image to confirm the route works.",
                status=resp.status_code,
            )
        return f"reachable; configured model {self.model}"
