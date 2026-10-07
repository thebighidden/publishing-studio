from __future__ import annotations

import json
from typing import Any, Optional

from ..config import DATA_DIR
from .base import TargetNotFound, UiNode

OVERRIDES_PATH = DATA_DIR / "targets.json"

# A named target is a list of candidate selectors, tried in order. Apps change
# their resource ids between releases, so every target carries fallbacks and
# teams can recalibrate from the UI without touching code.
#
# selector keys:  id | text | desc | cls | clickable | exact | nth
DEFAULT_CATALOG: dict[str, list[dict[str, Any]]] = {
    # ---------------- Instagram (com.instagram.android) ----------------
    "instagram.new_post": [
        {"id": "tab_new_post"},
        {"id": "creation_tab"},
        {"desc": "New post", "exact": False},
        {"desc": "Create", "exact": True},
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
    ],
    "instagram.caption_field": [
        {"id": "caption_text_view"},
        {"id": "caption_input_text_view"},
        {"text": "Write a caption", "exact": False},
        {"cls": "android.widget.EditText", "nth": 0},
    ],
    "instagram.share": [
        {"id": "share_footer_button"},
        {"id": "next_button_textview", "text": "Share"},
        {"text": "Share", "exact": True},
        {"desc": "Share", "exact": True},
    ],
    "instagram.home_tab": [
        {"id": "tab_feed"},
        {"desc": "Home", "exact": True},
    ],
    "instagram.profile_tab": [
        {"id": "tab_avatar"},
        {"desc": "Profile", "exact": False},
    ],
    "instagram.first_profile_post": [
        {"id": "image_button", "nth": 0},
        {"cls": "android.widget.ImageView", "clickable": True, "nth": 0},
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


def _matches(node: UiNode, sel: dict[str, Any]) -> bool:
    if not node.bounds or node.bounds.area <= 0:
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
    for sel in catalog().get(target, []):
        hits = [n for n in nodes if _matches(n, sel)]
        if not hits:
            continue
        nth = sel.get("nth")
        if nth is not None:
            if nth < len(hits):
                return hits[nth]
            continue
        # unambiguous selectors should match one node; prefer the smallest
        # tappable box, which is almost always the control rather than its
        # container.
        hits.sort(key=lambda n: (not n.clickable, n.bounds.area if n.bounds else 0))
        return hits[0]
    return None


def resolve_all(target: str, nodes: list[UiNode]) -> list[UiNode]:
    """Every node the first productive selector matches. Used to count things
    on screen, such as how many posts a profile grid is showing."""
    for sel in catalog().get(target, []):
        probe = {k: v for k, v in sel.items() if k != "nth"}
        hits = [n for n in nodes if _matches(n, probe)]
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
