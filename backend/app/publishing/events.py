from __future__ import annotations

import asyncio
import threading
from collections import deque
from typing import Any

_LOCK = threading.Lock()
_SUBS: set[asyncio.Queue] = set()
_RECENT: deque[dict[str, Any]] = deque(maxlen=200)
_LOOP: asyncio.AbstractEventLoop | None = None


def bind_loop(loop: asyncio.AbstractEventLoop) -> None:
    """The publishing worker is a plain thread; it needs the server's loop to
    hand events to websocket subscribers."""
    global _LOOP
    _LOOP = loop


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
    with _LOCK:
        _SUBS.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    with _LOCK:
        _SUBS.discard(q)


def recent() -> list[dict[str, Any]]:
    with _LOCK:
        return list(_RECENT)


def emit(kind: str, **payload: Any) -> None:
    event = {"kind": kind, **payload}
    with _LOCK:
        _RECENT.append(event)
        subs = list(_SUBS)
    if _LOOP is None:
        return
    for q in subs:
        try:
            _LOOP.call_soon_threadsafe(q.put_nowait, event)
        except (RuntimeError, asyncio.QueueFull):
            pass
