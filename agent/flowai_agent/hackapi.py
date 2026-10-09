"""The hackathon's phone-control API (console: Dashboard -> team key).

Thin wrapper only: one method per endpoint, no retry/backoff policy, not wired
into the publishing engine or DeviceDriver. Every call needs HACK_API_BASE and
HACK_TEAM_KEY in agent/.env.

Spec: GET {HACK_API_BASE}/openapi.json. Auth is `Authorization: Bearer <team key>`.
The console's TLS cert is self-signed, hence verify=False below.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

import httpx

from . import config

_MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
}


class HackApiError(RuntimeError):
    def __init__(self, message: str, status: int = 0, code: str = ""):
        super().__init__(message)
        self.status = status
        self.code = code


class HackPhone:
    def __init__(self, base_url: str = config.HACK_API_BASE, team_key: str = config.HACK_TEAM_KEY):
        if not base_url or not team_key:
            raise HackApiError(
                "No hackathon API base/team key. Set HACK_API_BASE and HACK_TEAM_KEY in agent/.env "
                "(from the team console)."
            )
        self.client = httpx.Client(
            base_url=base_url,
            headers={"Authorization": f"Bearer {team_key}", "Accept": "application/json"},
            timeout=30.0,
            verify=False,
        )

    def close(self) -> None:
        self.client.close()

    def __enter__(self) -> "HackPhone":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ---------------- plumbing ----------------

    def _data(self, r: httpx.Response) -> Any:
        if r.status_code >= 400:
            try:
                err = r.json()["error"]
                message, code = err["message"], err.get("code", "")
            except (ValueError, KeyError, TypeError):
                message, code = r.text, ""
            raise HackApiError(
                f"hack {r.request.method} {r.request.url.path} -> {r.status_code}: {message}",
                r.status_code,
                code,
            )
        return r.json()["data"]

    # ---------------- device state ----------------

    def status(self) -> dict[str, Any]:
        return self._data(self.client.get("/phone/status"))

    def geometry(self) -> dict[str, Any]:
        return self._data(self.client.get("/phone/geometry"))

    def rotation(self) -> dict[str, Any]:
        return self._data(self.client.get("/phone/rotation"))

    def screenshot(self, fmt: str = "png", max_width: Optional[int] = None) -> bytes:
        params: dict[str, Any] = {"format": fmt}
        if max_width is not None:
            params["max_width"] = max_width
        r = self.client.get("/phone/screenshot", params=params)
        if r.status_code >= 400:
            self._data(r)  # raises with the right message
        return r.content

    def apps(self) -> list[dict[str, Any]]:
        return self._data(self.client.get("/phone/apps"))

    # ---------------- input ----------------

    def tap(self, target: Optional[str] = None, x: Optional[int] = None, y: Optional[int] = None) -> dict[str, Any]:
        return self._data(self.client.post("/phone/tap", json={"target": target, "x": x, "y": y}))

    def long_press(
        self, target: Optional[str] = None, x: Optional[int] = None, y: Optional[int] = None, ms: int = 1000
    ) -> dict[str, Any]:
        body = {"target": target, "x": x, "y": y, "ms": ms}
        return self._data(self.client.post("/phone/long-press", json=body))

    def swipe(self, direction: str, distance: str = "medium") -> dict[str, Any]:
        return self._data(self.client.post("/phone/swipe", json={"direction": direction, "distance": distance}))

    def type_text(self, text: str) -> dict[str, Any]:
        return self._data(self.client.post("/phone/type", json={"text": text}))

    def key(self, key: str) -> dict[str, Any]:
        return self._data(self.client.post("/phone/key", json={"key": key}))

    def app_start(self, package: str) -> None:
        self._data(self.client.post("/phone/app-start", json={"package": package}))

    def app_stop(self, package: str) -> None:
        self._data(self.client.post("/phone/app-stop", json={"package": package}))

    # ---------------- media ----------------

    def list_media(self) -> list[dict[str, Any]]:
        return self._data(self.client.get("/phone/media"))

    def upload_media(self, path: Path) -> dict[str, Any]:
        path = Path(path)
        content_type = _MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")
        with path.open("rb") as fh:
            r = self.client.post("/phone/media", files={"file": (path.name, fh, content_type)})
        return self._data(r)

    # ---------------- named targets ----------------

    def targets(self) -> list[dict[str, Any]]:
        return self._data(self.client.get("/phone/targets"))

    def put_target(
        self, name: str, x: int, y: int, w: int, h: int, app: Optional[str] = None, description: Optional[str] = None
    ) -> dict[str, Any]:
        body = {"x": x, "y": y, "w": w, "h": h, "app": app, "description": description}
        return self._data(self.client.put(f"/phone/targets/{name}", json=body))

    def delete_target(self, name: str) -> None:
        self._data(self.client.delete(f"/phone/targets/{name}"))

    def test_target(self, name: str) -> dict[str, Any]:
        return self._data(self.client.post(f"/phone/targets/{name}/test"))

    # ---------------- team ----------------

    def me(self) -> dict[str, Any]:
        return self._data(self.client.get("/me"))

    def usage(self) -> dict[str, Any]:
        return self._data(self.client.get("/usage"))
