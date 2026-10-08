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


@dataclass
class MetricReading:
    """What one look at a published post actually showed.

    `found` is separate from the numbers on purpose: a post we could not locate
    on the grid is not a post with zero likes, and the two must never collapse
    into the same row. Any counter the screen did not show stays None.
    """

    found: bool = False
    likes: Optional[int] = None
    comments: Optional[int] = None
    views: Optional[int] = None
    shares: Optional[int] = None
    saves: Optional[int] = None
    approximate: bool = False
    note: str = ""
    raw: dict[str, Any] = field(default_factory=dict)
    matched_by: dict[str, Any] = field(default_factory=dict)
    screenshot: Optional[str] = None


_ABBREV = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}


def parse_count(raw: str) -> tuple[Optional[int], bool]:
    """Turn a label such as "1,234 likes", "View all 56 comments" or "12.3K
    views" into a number, plus whether that number is approximate.

    Returns (None, False) when there is no number at all. "12.3K" becomes
    12300 with approximate=True: it is the real order of magnitude and worth
    charting, but it cannot prove a delta of one, so the row says so.
    """
    text = (raw or "").strip()
    if not text:
        return None, False
    m = re.search(r"(\d[\d.,\s]*)\s*([KkMmBb])?", text)
    if not m:
        return None, False
    digits, suffix = m.group(1).strip(), (m.group(2) or "").lower()
    if suffix:
        # "12.3K" — the dot is a decimal point here, not a thousands separator.
        number = digits.replace(",", "").replace(" ", "")
        try:
            return int(float(number) * _ABBREV[suffix]), True
        except ValueError:
            return None, False
    plain = re.sub(r"[^\d]", "", digits)
    return (int(plain), False) if plain else (None, False)


def read_count(ctx: RunContext, target: str) -> tuple[Optional[int], bool, str]:
    """Resolve a counter target and read the number off it.

    Returns (value, approximate, raw_text). The raw text is kept by the caller
    so a surprising number can be audited against what was on the screen.
    """
    try:
        nodes = ctx.driver.screen_state().nodes
    except Exception:
        return None, False, ""
    node = resolve(target, nodes)
    if node is None:
        return None, False, ""
    raw = (node.text or node.content_desc or "").strip()
    value, approximate = parse_count(raw)
    return value, approximate, raw


def screen_has_token(ctx: RunContext, token: str) -> bool:
    """Is our own caption on the screen in front of us?"""
    if not token:
        return False
    try:
        nodes = ctx.driver.screen_state().nodes
    except Exception:
        return False
    needle = token.lower()
    return any(
        needle in (n.text or "").lower() or needle in (n.content_desc or "").lower()
        for n in nodes
    )


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

    def collect(self, ctx: RunContext, payload: PostPayload, *, max_slots: int = 6) -> MetricReading:
        """Open our own published post and read its engagement counters.

        The same rule as verification applies: find the post by recognising our
        own caption on it, never by assuming the newest tile is ours. A platform
        whose recipe does not implement this reports that plainly.
        """
        return MetricReading(found=False, note=f"{self.platform} cannot read performance yet")

    def cleanup(self, ctx: RunContext) -> None:
        try:
            ctx.app_stop(self.package)
        except Exception:
            pass
