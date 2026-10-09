from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional

from ...devices.targets import resolve, resolve_all
from ..context import RunContext


class PublishFailed(RuntimeError):
    """The post demonstrably did not go out."""

    def __init__(self, message: str, *, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


@dataclass
class PostPayload:
    caption: str
    hashtags: list[str] = field(default_factory=list)
    media_path: Optional[str] = None
    placement: str = "feed"
    handle: str = ""

    def full_caption(self) -> str:
        tags = " ".join(t if t.startswith("#") else f"#{t}" for t in self.hashtags)
        return f"{self.caption}\n\n{tags}".strip() if tags else self.caption.strip()


@dataclass
class Evidence:
    """Why we believe a post is live — or why we will not claim that.

    `confirmed` requires something observed after the fact. A tap that returned
    without error is not evidence of anything.
    """

    confirmed: bool
    kind: str  # profile_delta | post_url | screenshot | none
    ref: str = ""
    note: str = ""
    screenshots: list[str] = field(default_factory=list)
    checks: dict[str, Any] = field(default_factory=dict)


def distinctive_token(caption: str) -> str:
    """The longest ordinary word in the caption, used to recognise our own post
    on screen. Short and common words would match anything."""
    words = re.findall(r"[A-Za-z]{5,}", caption)
    words = [w for w in words if w.lower() not in _STOPWORDS]
    return max(words, key=len) if words else ""


_STOPWORDS = {
    "about", "after", "again", "their", "there", "these", "those", "where",
    "which", "while", "would", "could", "should", "every", "other", "today",
    "thing", "things", "going", "really", "right",
}


def count_on_screen(ctx: RunContext, target: str) -> int:
    try:
        return len(resolve_all(target, ctx.driver.screen_state().nodes))
    except Exception:
        return -1


def labelled_count(ctx: RunContext, target: str) -> int:
    """Read a total straight off a profile header label, e.g. "21 posts".

    Counting grid tiles only counts what is *on screen*. Real Instagram shows
    about nine, no matter how many posts exist, so a before/after comparison
    never moves and a genuine publish reads as unconfirmed. When the app gives
    us the real number, trust that instead.

    Returns -1 when there is no usable number — including abbreviated counts
    like "1.2K", which cannot prove a delta of one.
    """
    try:
        nodes = ctx.driver.screen_state().nodes
    except Exception:
        return -1
    node = resolve(target, nodes)
    if node is None:
        return -1
    raw = (node.text or node.content_desc or "").strip()
    if re.search(r"\d\s*[KkMm]\b|\d[.,]\d\s*[KkMm]", raw):
        return -1
    m = re.search(r"\d[\d,\s]*", raw)
    if not m:
        return -1
    digits = re.sub(r"[^\d]", "", m.group(0))
    return int(digits) if digits else -1


class Recipe(ABC):
    """How one platform's app is driven. Device-agnostic: the same recipe runs
    against adb and against the simulator."""

    platform: str = ""
    package: str = ""
    # A target that only exists once the account is signed in, used by the
    # Settings screen to check a login by looking rather than by assuming.
    home_target: str = ""

    @abstractmethod
    def baseline(self, ctx: RunContext) -> dict[str, Any]:
        """Observe the account *before* posting, so the change can be measured."""

    @abstractmethod
    def publish(self, ctx: RunContext, payload: PostPayload) -> None:
        """Drive the app to the point where the post has been submitted."""

    @abstractmethod
    def verify(self, ctx: RunContext, payload: PostPayload, baseline: dict[str, Any]) -> Evidence:
        """Go and look. Return what was actually observed."""

    def back_in_app(self, ctx: RunContext, wait_target: str, timeout: float = 20.0) -> None:
        """Make sure this app is in front before looking at the result.

        On a real phone, finishing a share can hand the screen back to whatever app was open
        before the run started, so the profile tab isn't there to tap. Reopen the app and wait
        for its screen rather than fail the check (which would end a published post uncertain).
        """
        try:
            in_front = ctx.driver.screen_state().package
        except Exception:
            in_front = ""
        if in_front != self.package:
            ctx.note("return-to-app", f"after publishing, {in_front or 'another app'} was in front; reopening {self.platform}")
            ctx.app_start(self.package)
        ctx.wait_for(wait_target, timeout=timeout)

    def cleanup(self, ctx: RunContext) -> None:
        try:
            ctx.app_stop(self.package)
        except Exception:
            pass
