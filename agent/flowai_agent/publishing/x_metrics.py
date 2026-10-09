"""Reading an X post's likes, replies, reposts, views and bookmarks off the phone's screen.

X's API charges for reading, so FlowAI asks the phone instead: open the post by its link, or
find it on the account's profile timeline by its own words, and read the counts the app shows.
Read-only: nothing on the post is tapped, liked or replied to.

Abbreviated counts ("1.2K") are read as approximations, which is fine for numbers people look
at, unlike publishing proof, where only an exact count will do.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any, Optional

from ..devices.base import Bounds, DeviceDriver, DeviceError, UiNode
from .recipes.base import distinctive_token

log = logging.getLogger("flowai.agent")

X_PACKAGE = "com.twitter.android"

# The words X puts next to each number, mapped to FlowAI's metric names.
_METRIC = {
    "like": "likes", "likes": "likes",
    "reply": "comments", "replies": "comments",
    "repost": "shares", "reposts": "shares", "retweet": "shares", "retweets": "shares",
    "view": "views", "views": "views",
    "bookmark": "saves", "bookmarks": "saves",
}
_NUM = r"(\d[\d.,]*\s?[KkMm]?)"
_WORD = r"(likes?|repl(?:y|ies)|reposts?|retweets?|views?|bookmarks?)"
_NUMBER_THEN_WORD = re.compile(_NUM + r"\s+" + _WORD + r"\b", re.I)  # "12 Likes", "1.2K views"
_WORD_THEN_NUMBER = re.compile(r"\b" + _WORD + r":\s*" + _NUM, re.I)  # "Likes: 12"


class ReadFailed(RuntimeError):
    """The numbers couldn't be read this time; the post waits for the next round."""


def parse_count(raw: str) -> Optional[int]:
    """'12' → 12, '1,234' → 1234, '1.2K' → 1200, '3M' → 3000000."""
    s = raw.strip().replace(" ", "").replace(" ", "")
    m = re.fullmatch(r"(\d[\d.,]*)([KkMm]?)", s)
    if not m:
        return None
    number, suffix = m.groups()
    if suffix:
        try:
            value = float(number.replace(",", "."))
        except ValueError:
            return None
        return int(round(value * (1_000 if suffix.lower() == "k" else 1_000_000)))
    digits = re.sub(r"[^\d]", "", number)
    return int(digits) if digits else None


def _inside(node: UiNode, area: Optional[Bounds]) -> bool:
    if area is None:
        return True
    if node.bounds is None:
        return False
    cx = (node.bounds.left + node.bounds.right) / 2
    cy = (node.bounds.top + node.bounds.bottom) / 2
    return area.left <= cx <= area.right and area.top <= cy <= area.bottom


def _scan(text: str, out: dict[str, int]) -> None:
    for pattern, num_first in ((_NUMBER_THEN_WORD, True), (_WORD_THEN_NUMBER, False)):
        for m in pattern.finditer(text):
            raw, word = (m.group(1), m.group(2)) if num_first else (m.group(2), m.group(1))
            key = _METRIC.get(word.lower())
            value = parse_count(raw)
            if key and value is not None and key not in out:
                out[key] = value


def read_numbers(nodes: list[UiNode], area: Optional[Bounds] = None) -> dict[str, int]:
    """Every count on screen (or inside `area`), top to bottom; the first of each kind wins,
    which on a post's own page is the post rather than the replies under it."""
    ordered = sorted(
        (n for n in nodes if _inside(n, area)),
        key=lambda n: (n.bounds.top, n.bounds.left) if n.bounds else (0, 0),
    )
    out: dict[str, int] = {}
    for node in ordered:
        for text in (node.content_desc, node.text):
            if text:
                _scan(text, out)
    # A number and its word can sit in two separate views ("12" above "Likes").
    joined = " ".join(t for n in ordered for t in (n.text, n.content_desc) if t)
    _scan(joined, out)
    return out


def _row_of(hit: UiNode, nodes: list[UiNode]) -> Optional[Bounds]:
    """The timeline row holding the post's text: the smallest container around it."""
    if hit.bounds is None:
        return None
    b = hit.bounds
    rows = [
        n.bounds for n in nodes
        if n.bounds is not None and n is not hit
        and n.bounds.left <= b.left and n.bounds.top <= b.top and n.bounds.right >= b.right and n.bounds.bottom >= b.bottom
        and ((n.resource_id or "").endswith("/row") or (n.resource_id or "") == "row" or (n.clickable and "ViewGroup" in (n.cls or "")))
    ]
    if rows:
        return min(rows, key=lambda r: r.area)
    # No container in the dump: the band under the text, where the counts sit.
    return Bounds(0, b.top, 10_000, b.bottom + 520)


def read_post(driver: DeviceDriver, job: dict[str, Any], settle: float = 3.5) -> dict[str, int]:
    """One post's numbers. Raises ReadFailed with the reason when it can't."""
    url = job.get("post_url") or ""
    if "/status/" in url:
        try:
            driver.open_url(url, X_PACKAGE)
            time.sleep(settle)
            numbers = read_numbers(driver.screen_state().nodes)
            if numbers:
                return numbers
        except DeviceError as exc:
            log.info("post %s: couldn't open its link (%s); looking on the profile", job.get("id"), exc)

    token = distinctive_token(job.get("caption") or "")
    if not token:
        raise ReadFailed("the post has no link and no distinctive words to find it by")
    driver.app_start(X_PACKAGE)
    time.sleep(settle)
    driver.tap("x.profile_tab")
    time.sleep(2.5)
    for _ in range(6):
        nodes = driver.screen_state().nodes
        hit = next((n for n in nodes if token.lower() in f"{n.text} {n.content_desc}".lower()), None)
        if hit is not None:
            numbers = read_numbers(nodes, _row_of(hit, nodes))
            if numbers:
                return numbers
            raise ReadFailed("found the post on the profile but no counts next to it")
        driver.swipe("up", 0.5)
        time.sleep(1.5)
    raise ReadFailed(f"couldn't find the post on @{job.get('handle') or 'the account'}'s profile")
