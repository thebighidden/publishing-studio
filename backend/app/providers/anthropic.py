from __future__ import annotations

from typing import Any, Optional

import httpx

from .base import NotConfigured, ProviderError, TextProvider, TextResult

BASE_URL = "https://api.anthropic.com/v1"
API_VERSION = "2023-06-01"
DEFAULT_MODEL = "claude-sonnet-4-6"


class AnthropicText(TextProvider):
    def __init__(
        self,
        api_key: str,
        base_url: str = BASE_URL,
        model: str = DEFAULT_MODEL,
        options: Optional[dict[str, Any]] = None,
    ):
        if not api_key:
            raise NotConfigured("Anthropic needs an API key")
        self.api_key = api_key
        self.base_url = (base_url or BASE_URL).rstrip("/")
        self.model = model or DEFAULT_MODEL
        self.options = options or {}

    def _client(self, timeout: float) -> httpx.Client:
        return httpx.Client(
            base_url=self.base_url,
            headers={
                "x-api-key": self.api_key,
                "anthropic-version": API_VERSION,
                "content-type": "application/json",
            },
            timeout=timeout,
        )

    def complete(
        self,
        prompt: str,
        *,
        system: str = "",
        json_object: bool = False,
        max_tokens: int = 1200,
        temperature: float = 0.7,
    ) -> TextResult:
        body: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            body["system"] = system
        if json_object:
            # Prefilling an open brace is the reliable way to force bare JSON.
            body["messages"].append({"role": "assistant", "content": "{"})

        with self._client(120.0) as c:
            resp = c.post("/messages", json=body)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("error", {}).get("message", resp.text)
            except ValueError:
                detail = resp.text
            raise ProviderError(
                f"Anthropic call failed ({resp.status_code}): {str(detail)[:300]}",
                retryable=resp.status_code in (429, 500, 502, 503, 529),
                status=resp.status_code,
            )

        data = resp.json()
        parts = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
        text = "".join(parts).strip()
        if json_object and not text.startswith("{"):
            text = "{" + text

        usage = data.get("usage") or {}
        return TextResult(
            text=text,
            model=data.get("model", self.model),
            tokens_in=usage.get("input_tokens", 0),
            tokens_out=usage.get("output_tokens", 0),
        )

    def check(self) -> str:
        out = self.complete("Reply with the single word: ok", max_tokens=8, temperature=0)
        return f"{out.model} replied {out.text[:30]!r}"
