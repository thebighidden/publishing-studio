from __future__ import annotations

import json
from dataclasses import replace
from typing import Any, Optional

from ..config import DATA_DIR
from .base import Bounds, TargetNotFound, UiNode

OVERRIDES_PATH = DATA_DIR / "targets.json"

# A named target is a list of candidate selectors, tried in order. Apps change
# their resource ids between releases, so every target carries fallbacks and
# teams can recalibrate from the UI without touching code.
#
# selector keys:  id | text | desc | cls | clickable | exact | nth | zone
#
#                 | box
#
# zone is [left, top, right, bottom] as fractions of the screen, and the node's
# centre must fall inside it. It is for controls that carry no id, text or
# description; the tap still goes to a random point inside the matched node.
#
# box is [left, top, right, bottom] as fractions of the matched node, and the
# target becomes that part of it. It is for controls missing from the UI dump
# altogether, located inside a container that is in the dump. Calibrate it per
# app build and screen shape; the selector only applies while that container
# is on screen.
DEFAULT_CATALOG: dict[str, list[dict[str, Any]]] = {
    # ---------------- Instagram (com.instagram.android) ----------------
    # Verified against Instagram 450.0.0.50.77 on Android 15.
    # 450 moved "create" out of the bottom tab bar to the top-left of the
    # action bar. Match the description first: action_bar_left_button is a
    # generic id that is a Back button on other screens.
    "instagram.new_post": [
        {"desc": "Create a post", "exact": False},
        {"id": "action_bar_left_button"},
        {"id": "tab_new_post"},
        {"id": "creation_tab"},
        {"desc": "New post", "exact": False},
        {"desc": "Create", "exact": True},
        # Instagram 448.0.0.52.84 on a Pixel 7a (Android 16): the "+" at the
        # top-left of the home action bar is an ImageView with no id and no
        # description, so only its place in the action bar identifies it.
        {"cls": "android.widget.ImageView", "clickable": True, "zone": [0, 0, 0.18, 0.13]},
    ],
    "instagram.gallery_first_item": [
        {"id": "gallery_grid_item", "nth": 0},
        {"id": "media_picker_grid_view_item", "nth": 0},
        {"desc": "Photo thumbnail", "nth": 0},
        {"cls": "android.widget.ImageView", "clickable": True, "nth": 1},
    ],
    "instagram.post_type_post": [
        {"text": "POST", "exact": True},
        {"text": "Post", "exact": True},
    ],
    "instagram.post_type_reel": [
        {"text": "REEL", "exact": True},
        {"text": "Reel", "exact": True},
    ],
    "instagram.post_type_story": [
        {"text": "STORY", "exact": True},
        {"text": "Story", "exact": True},
    ],
    "instagram.next": [
        {"id": "next_button_textview"},
        {"id": "next_button_imageview"},
        {"text": "Next", "exact": True},
        {"desc": "Next", "exact": True},
        # Instagram 448 photo editor (Audio / Text / Overlay / Filter / Edit /
        # Ratio): its Next button never appears in the UI dump, so it is the
        # bottom-right of the editor's full-screen container. Calibrated on a
        # Pixel 7a, 1080x2400.
        {"id": "quick_edit_compose_view", "box": [0.81, 0.94, 0.97, 0.985]},
    ],
    "instagram.caption_field": [
        {"id": "caption_text_view"},
        {"id": "caption_input_text_view"},
        {"text": "Write a caption", "exact": False},
        {"cls": "android.widget.EditText", "nth": 0},
        # Instagram 448 share screen: the caption row is often missing from the
        # UI dump while the screen's own container is present, so it is located
        # inside that container. Calibrated on a Pixel 7a, 1080x2400.
        {"id": "followers_share_content", "box": [0.05, 0.38, 0.95, 0.43]},
    ],
    "instagram.share": [
        {"id": "share_footer_button"},
        {"id": "next_button_textview", "text": "Share"},
        {"text": "Share", "exact": True},
        {"desc": "Share", "exact": True},
    ],
    "instagram.home_tab": [
        {"id": "feed_tab"},
        {"id": "tab_feed"},
        {"desc": "Home", "exact": True},
    ],
    "instagram.profile_tab": [
        {"id": "profile_tab"},
        {"id": "tab_avatar"},
        {"desc": "Profile", "exact": False},
    ],
    "instagram.first_profile_post": [
        {"id": "image_button", "nth": 0},
        {"cls": "android.widget.ImageView", "clickable": True, "nth": 0},
    ],
    # The profile header's "N posts" label. Far better evidence than counting
    # grid tiles, which only ever counts what fits on screen.
    "instagram.post_count": [
        {"id": "profile_header_post_count_front"},
        {"id": "profile_header_post_count"},
    ],
    # The caption on an open post. Used to prove the tile we opened is the post
    # we are collecting numbers for, before any of those numbers are believed.
    "instagram.post_detail_caption": [
        {"id": "row_feed_comment_textview_layout"},
        {"id": "caption_text_view"},
        {"id": "caption"},
    ],
    # ---- engagement counters, read off an open post ----
    # Instagram renders these as a label rather than a number on its own:
    # "1,234 likes", "View all 56 comments", "12.3K views". The collector keeps
    # the raw string next to the parsed number for exactly that reason.
    "instagram.post_like_count": [
        {"id": "row_feed_textview_likes"},
        {"id": "like_count"},
        {"desc": "likes", "exact": False},
        {"text": "likes", "exact": False},
    ],
    "instagram.post_comment_count": [
        {"id": "row_feed_textview_comments"},
        {"id": "comment_count"},
        {"text": "comments", "exact": False},
        {"desc": "comments", "exact": False},
    ],
    "instagram.post_view_count": [
        {"id": "video_view_count"},
        {"id": "play_count"},
        {"text": "views", "exact": False},
        {"text": "plays", "exact": False},
    ],
    "instagram.follower_count": [
        {"id": "row_profile_header_textview_followers_count"},
        {"id": "follower_count"},
    ],
    # ---------------- X / Twitter (com.twitter.android) ----------------
    "x.compose": [
        {"id": "composer_write"},
        {"desc": "Post", "exact": True},
        {"desc": "Tweet", "exact": True},
        {"desc": "Compose", "exact": False},
    ],
    "x.compose_field": [
        {"id": "tweet_text"},
        {"text": "What's happening?", "exact": False},
        {"cls": "android.widget.EditText", "nth": 0},
    ],
    "x.add_media": [
        {"id": "gallery"},
        {"id": "media_picker"},
        {"desc": "Add photos or video", "exact": False},
        {"desc": "Media", "exact": True},
    ],
    "x.gallery_first_item": [
        {"id": "image", "nth": 0},
        {"cls": "android.widget.ImageView", "clickable": True, "nth": 1},
    ],
    "x.media_add_button": [
        {"id": "button_add"},
        {"text": "Add", "exact": True},
        {"text": "Done", "exact": True},
    ],
    "x.post_button": [
        {"id": "button_tweet"},
        {"text": "Post", "exact": True},
        {"text": "Tweet", "exact": True},
    ],
    "x.profile_tab": [
        {"desc": "Profile", "exact": False},
        {"id": "profile"},
    ],
    "x.first_timeline_post": [
        {"id": "row", "nth": 0},
        {"cls": "android.view.ViewGroup", "clickable": True, "nth": 0},
    ],
    "x.post_detail_text": [
        {"id": "tweet_text"},
        {"id": "status_content"},
        {"id": "row"},
    ],
    # X puts the number in the content description ("12 Likes") and often leaves
    # the visible text abbreviated, so desc comes before text here.
    "x.post_like_count": [
        {"id": "like_count"},
        {"id": "inline_like_count"},
        {"desc": "Likes", "exact": False},
    ],
    "x.post_reply_count": [
        {"id": "reply_count"},
        {"id": "inline_reply_count"},
        {"desc": "Replies", "exact": False},
    ],
    "x.post_repost_count": [
        {"id": "retweet_count"},
        {"id": "inline_retweet_count"},
        {"desc": "Reposts", "exact": False},
    ],
    "x.post_view_count": [
        {"id": "view_count"},
        {"text": "Views", "exact": False},
        {"desc": "Views", "exact": False},
    ],
    # ---------------- generic / system ----------------
    "system.allow_permission": [
        {"id": "permission_allow_button"},
        {"text": "Allow", "exact": True},
        {"text": "ALLOW", "exact": True},
        {"text": "Allow all", "exact": False},
    ],
    "system.ok": [
        {"id": "button1"},
        {"text": "OK", "exact": True},
    ],
}


# Grid and timeline positions, one name per slot. The metrics collector has to
# be able to open something other than the newest post, and rule R6 says it may
# only ever ask for a *name* — so each position is a name rather than an index
# the caller passes in. The selectors are the ones above with `nth` rewritten.
for _slot in range(9):
    DEFAULT_CATALOG[f"instagram.profile_post_{_slot + 1}"] = [
        {**sel, "nth": _slot} for sel in DEFAULT_CATALOG["instagram.first_profile_post"]
    ]
for _slot in range(6):
    DEFAULT_CATALOG[f"x.timeline_post_{_slot + 1}"] = [
        {**sel, "nth": _slot} for sel in DEFAULT_CATALOG["x.first_timeline_post"]
    ]
del _slot


def _load_overrides() -> dict[str, list[dict[str, Any]]]:
    if not OVERRIDES_PATH.exists():
        return {}
    try:
        return json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def catalog() -> dict[str, list[dict[str, Any]]]:
    merged = {k: list(v) for k, v in DEFAULT_CATALOG.items()}
    for name, selectors in _load_overrides().items():
        # user selectors win, defaults stay as fallbacks
        merged[name] = list(selectors) + merged.get(name, [])
    return merged


def save_overrides(data: dict[str, list[dict[str, Any]]]) -> None:
    OVERRIDES_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _extent(nodes: list[UiNode]) -> tuple[int, int]:
    """Screen size, taken from the furthest edges the UI tree reaches."""
    width = max((n.bounds.right for n in nodes if n.bounds), default=0)
    height = max((n.bounds.bottom for n in nodes if n.bounds), default=0)
    return width, height


def _matches(node: UiNode, sel: dict[str, Any], screen: tuple[int, int] = (0, 0)) -> bool:
    if not node.bounds or node.bounds.area <= 0:
        return False
    if "zone" in sel:
        width, height = screen
        if not width or not height:
            return False
        left, top, right, bottom = sel["zone"]
        cx = (node.bounds.left + node.bounds.right) / 2 / width
        cy = (node.bounds.top + node.bounds.bottom) / 2 / height
        if not (left <= cx <= right and top <= cy <= bottom):
            return False
    if sel.get("clickable") and not node.clickable:
        return False
    exact = sel.get("exact", False)

    if "id" in sel:
        rid = (node.resource_id or "").lower()
        want = str(sel["id"]).lower()
        # resource ids arrive as "com.instagram.android:id/share_footer_button"
        tail = rid.split("/")[-1]
        if exact:
            if tail != want:
                return False
        elif want not in rid:
            return False

    if "text" in sel:
        txt = (node.text or "").strip().lower()
        want = str(sel["text"]).strip().lower()
        if (txt != want) if exact else (want not in txt):
            return False

    if "desc" in sel:
        desc = (node.content_desc or "").strip().lower()
        want = str(sel["desc"]).strip().lower()
        if (desc != want) if exact else (want not in desc):
            return False

    if "cls" in sel and str(sel["cls"]).lower() not in (node.cls or "").lower():
        return False

    return True


def resolve(target: str, nodes: list[UiNode]) -> Optional[UiNode]:
    """Resolve a *name* to a node on the current screen. No coordinates ever
    cross the wire from the caller."""
    screen = _extent(nodes)
    for sel in catalog().get(target, []):
        hits = [n for n in nodes if _matches(n, sel, screen)]
        if not hits:
            continue
        nth = sel.get("nth")
        if nth is not None:
            if nth < len(hits):
                return _within(hits[nth], sel)
            continue
        # unambiguous selectors should match one node; prefer the smallest
        # tappable box, which is almost always the control rather than its
        # container.
        hits.sort(key=lambda n: (not n.clickable, n.bounds.area if n.bounds else 0))
        return _within(hits[0], sel)
    return None


def _within(node: UiNode, sel: dict[str, Any]) -> UiNode:
    """Narrow a container node to the `box` part of it, when the selector has one."""
    if "box" not in sel:
        return node
    left, top, right, bottom = sel["box"]
    b = node.bounds
    width, height = b.right - b.left, b.bottom - b.top
    return replace(
        node,
        clickable=True,
        bounds=Bounds(
            left=b.left + round(width * left),
            top=b.top + round(height * top),
            right=b.left + round(width * right),
            bottom=b.top + round(height * bottom),
        ),
    )


def resolve_all(target: str, nodes: list[UiNode]) -> list[UiNode]:
    """Every node the first productive selector matches. Used to count things
    on screen, such as how many posts a profile grid is showing."""
    screen = _extent(nodes)
    for sel in catalog().get(target, []):
        probe = {k: v for k, v in sel.items() if k != "nth"}
        hits = [n for n in nodes if _matches(n, probe, screen)]
        if hits:
            return hits
    return []


def resolve_or_raise(target: str, nodes: list[UiNode]) -> UiNode:
    node = resolve(target, nodes)
    if node is None:
        raise TargetNotFound(target, tried=len(catalog().get(target, [])))
    return node


def known_targets() -> list[str]:
    return sorted(catalog().keys())
