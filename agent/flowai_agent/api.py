"""FlowAI's agent API (DEVELOPMENT.md → "The agent API"), as the agent uses it."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

import httpx

from . import config


class ApiError(RuntimeError):
    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


class FlowAI:
    def __init__(self, base_url: str = config.FLOWAI_URL, token: str = config.AGENT_TOKEN):
        if not token:
            raise ApiError(
                "No agent token. Copy it from FlowAI → Phones → Automation service and set "
                "FLOWAI_AGENT_TOKEN in agent/.env"
            )
        self.base_url = base_url
        self.client = httpx.Client(
            base_url=f"{base_url}/api/agent",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=60.0,
        )

    def _check(self, r: httpx.Response) -> httpx.Response:
        if r.status_code >= 400:
            try:
                detail = r.json().get("message") or r.text
            except ValueError:
                detail = r.text
            raise ApiError(f"FlowAI {r.request.method} {r.request.url.path} → {r.status_code}: {str(detail)[:300]}", r.status_code)
        return r

    def hello(self, phones: list[dict[str, Any]], mirror_url: Optional[str], agent: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
        """Register this computer's phones; FlowAI lists them on its Phones page."""
        r = self._check(self.client.post("/hello", json={"phones": phones, "mirror_url": mirror_url, "agent": agent or {}}))
        return r.json().get("phones", [])

    def next_job(self, device_ref: str) -> Optional[dict[str, Any]]:
        r = self.client.get("/next-job", params={"device_ref": device_ref})
        if r.status_code == 204:
            return None
        return self._check(r).json()

    def steps(self, run_id: str, steps: list[dict[str, Any]]) -> None:
        self._check(self.client.post(f"/runs/{run_id}/steps", json={"steps": steps}))

    def screenshot(self, run_id: str, path: Path) -> None:
        with path.open("rb") as fh:
            self._check(self.client.post(f"/runs/{run_id}/screenshot", files={"file": (path.name, fh, "image/png")}))

    def finish(self, run_id: str, outcome: str, note: str = "", post_url: Optional[str] = None) -> None:
        body: dict[str, Any] = {"outcome": outcome, "note": note[:500]}
        if post_url:
            body["post_url"] = post_url
        self._check(self.client.post(f"/runs/{run_id}/finish", json=body))

    def screen(self, device_ref: str, png: bytes) -> None:
        """The phone's latest screen while idle, for the Phones page thumbnail."""
        self._check(self.client.post(f"/devices/{device_ref}/screen", files={"file": ("screen.png", png, "image/png")}))

    def download(self, url: str, dest: Path) -> Path:
        """Job media; `url` is the path FlowAI gave in the job (/api/agent/assets/{id}/file)."""
        with self.client.stream("GET", f"{self.base_url}{url}") as r:
            if r.status_code >= 400:
                r.read()
                self._check(r)
            with dest.open("wb") as fh:
                for chunk in r.iter_bytes():
                    fh.write(chunk)
        return dest
