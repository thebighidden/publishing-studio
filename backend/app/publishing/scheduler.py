from __future__ import annotations

import threading
import time
from typing import Optional

from sqlmodel import select

from ..config import SCHEDULER_TICK_SECONDS
from ..db import session_scope
from ..models import Account, Phone, Post, PostStatus, Setting, utcnow
from . import events
from .runner import NotPublishable, execute

STOP_KEY = "publishing_paused"


class Scheduler:
    """Watches the calendar and starts publishing jobs when their time comes.

    One worker thread. It dispatches at most one job per phone per tick, which
    is what keeps rule R8 true without any locking beyond the booking flag.
    """

    def __init__(self, tick: int = SCHEDULER_TICK_SECONDS):
        self.tick = tick
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._workers: dict[str, threading.Thread] = {}
        self.last_tick_at: Optional[float] = None

    # ---------------- lifecycle ----------------

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="scheduler", daemon=True)
        self._thread.start()

    def shutdown(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    # ---------------- the global stop button (feature fa09) ----------------

    @staticmethod
    def is_paused() -> bool:
        with session_scope() as s:
            row = s.get(Setting, STOP_KEY)
            return bool(row and row.value.get("paused"))

    @staticmethod
    def set_paused(paused: bool, reason: str = "") -> None:
        with session_scope() as s:
            row = s.get(Setting, STOP_KEY)
            if row is None:
                row = Setting(key=STOP_KEY, value={})
            row.value = {"paused": paused, "reason": reason, "at": utcnow().isoformat()}
            s.add(row)
        events.emit("publishing.paused" if paused else "publishing.resumed", reason=reason)

    # ---------------- the loop ----------------

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._dispatch_due()
            except Exception as exc:  # noqa: BLE001 - the loop must survive anything
                events.emit("scheduler.error", error=f"{type(exc).__name__}: {exc}")
            self.last_tick_at = time.time()
            self._stop.wait(self.tick)

    def _dispatch_due(self) -> None:
        self._reap_workers()
        if self.is_paused():
            return

        with session_scope() as session:
            due = session.exec(
                select(Post)
                .where(
                    Post.status == PostStatus.scheduled,
                    Post.scheduled_at != None,  # noqa: E711
                    Post.scheduled_at <= utcnow(),
                )
                .order_by(Post.scheduled_at)
            ).all()

            claimed: set[str] = set()
            for post in due:
                if post.approved_at is None:
                    continue  # gate 6B; the API surfaces these as blocked
                account = session.get(Account, post.account_id)
                if account is None or not account.phone_id:
                    continue
                phone = session.get(Phone, account.phone_id)
                if phone is None or phone.busy_run_id or phone.id in claimed:
                    continue
                if phone.id in self._workers and self._workers[phone.id].is_alive():
                    continue
                claimed.add(phone.id)
                self._spawn(post.id, phone.id)

    def _spawn(self, post_id: str, phone_id: str) -> None:
        def work() -> None:
            with session_scope() as session:
                post = session.get(Post, post_id)
                if post is None:
                    return
                try:
                    execute(session, post)
                except NotPublishable as exc:
                    post.last_error = str(exc)
                    post.status = PostStatus.approved  # back to the operator
                    session.add(post)
                    events.emit("run.blocked", post_id=post_id, reason=str(exc))

        t = threading.Thread(target=work, name=f"publish-{post_id}", daemon=True)
        self._workers[phone_id] = t
        t.start()

    def _reap_workers(self) -> None:
        for phone_id, thread in list(self._workers.items()):
            if not thread.is_alive():
                self._workers.pop(phone_id, None)

    def status(self) -> dict:
        return {
            "running": self.running,
            "paused": self.is_paused(),
            "tick_seconds": self.tick,
            "active_jobs": sum(1 for t in self._workers.values() if t.is_alive()),
            "last_tick_at": self.last_tick_at,
        }


scheduler = Scheduler()
