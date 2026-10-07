from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from ..models import MediaKind, Platform


@dataclass
class PlacementSpec:
    name: str
    aspects: list[str]
    media: list[str]
    caption_max: int
    duration_s: Optional[tuple[float, float]] = None
    hashtag_max: int = 30
    note: str = ""


SPECS: dict[tuple[str, str], PlacementSpec] = {
    ("instagram", "feed"): PlacementSpec(
        "Instagram feed", ["1:1", "4:5"], ["image", "video"], 2200,
        duration_s=(3, 60), note="4:5 takes the most screen height in the feed",
    ),
    ("instagram", "reel"): PlacementSpec(
        "Instagram Reel", ["9:16"], ["video"], 2200,
        duration_s=(3, 90), note="vertical video only",
    ),
    ("instagram", "story"): PlacementSpec(
        "Instagram story", ["9:16"], ["image", "video"], 0,
        duration_s=(1, 60), note="caption is burned in, not typed",
    ),
    ("x", "feed"): PlacementSpec(
        "X post", ["16:9", "1:1", "4:5"], ["image", "video"], 280,
        duration_s=(0.5, 140), hashtag_max=3,
        note="280 characters including hashtags and links",
    ),
}


def spec_for(platform: Platform | str, placement: str) -> PlacementSpec:
    key = (str(getattr(platform, "value", platform)), placement)
    return SPECS.get(key) or SPECS[(str(getattr(platform, "value", platform)), "feed")]


def default_aspect(platform: Platform | str, placement: str) -> str:
    return spec_for(platform, placement).aspects[0]


@dataclass
class SpecReport:
    ok: bool
    placement: str
    issues: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "placement": self.placement,
            "issues": self.issues,
            "warnings": self.warnings,
            "details": self.details,
        }


def check(
    platform: Platform | str,
    placement: str,
    *,
    caption: str,
    hashtags: list[str],
    media_kind: Optional[MediaKind | str] = None,
    width: Optional[int] = None,
    height: Optional[int] = None,
    duration_s: Optional[float] = None,
) -> SpecReport:
    """Nothing is exported or scheduled until it passes this (feature f802)."""
    spec = spec_for(platform, placement)
    issues: list[str] = []
    warnings: list[str] = []

    full_len = len(caption) + sum(len(h) + 1 for h in hashtags)
    if spec.caption_max and full_len > spec.caption_max:
        issues.append(
            f"caption is {full_len} characters, over the {spec.caption_max} limit for {spec.name}"
        )
    if len(hashtags) > spec.hashtag_max:
        warnings.append(
            f"{len(hashtags)} hashtags, more than the {spec.hashtag_max} that read well here"
        )

    kind = str(getattr(media_kind, "value", media_kind) or "")
    if kind and kind not in spec.media:
        issues.append(f"{spec.name} does not take {kind}")

    aspect = None
    if width and height:
        aspect = _nearest_aspect(width, height)
        if aspect not in spec.aspects:
            issues.append(
                f"media is {width}x{height} (~{aspect}); {spec.name} expects "
                f"{' or '.join(spec.aspects)}"
            )

    if duration_s and spec.duration_s:
        lo, hi = spec.duration_s
        if duration_s < lo:
            issues.append(f"video is {duration_s:.1f}s, under the {lo}s minimum")
        elif duration_s > hi:
            issues.append(f"video is {duration_s:.1f}s, over the {hi}s maximum")

    return SpecReport(
        ok=not issues,
        placement=spec.name,
        issues=issues,
        warnings=warnings,
        details={
            "caption_chars": full_len,
            "caption_max": spec.caption_max,
            "aspect": aspect,
            "allowed_aspects": spec.aspects,
            "note": spec.note,
        },
    )


_RATIOS = {"1:1": 1.0, "4:5": 0.8, "9:16": 0.5625, "16:9": 1.7778, "3:2": 1.5, "2:3": 0.6667}


def _nearest_aspect(width: int, height: int) -> str:
    r = width / height if height else 1.0
    return min(_RATIOS, key=lambda k: abs(_RATIOS[k] - r))
