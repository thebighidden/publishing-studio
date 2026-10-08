"""The Higgsfield models the studio offers out of the box, and what each accepts.

Every entry is taken from the model's page at docs.higgsfield.ai (checked
2026-10). One Higgsfield key unlocks all of them; a model that is not listed
can still be used by adding its endpoint path as a provider's model, which
falls back to a generic spec.

Fields mirror the request schemas:
  aspects      values the endpoint accepts for `aspect_ratio` (empty: not sent)
  resolutions  values for `resolution` (empty: not sent)
  durations    seconds offered in the studio (the endpoint's own range may be wider)
  seed_range   inclusive range for `seed`, or None when the model takes no seed
  reference    image models: the field that carries reference images
  end_frame    video models: the field for an optional last frame
  audio        "sound" ("on"/"off") or "generate_audio" (bool), or "" when silent
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass(frozen=True)
class ModelSpec:
    key: str
    name: str
    family: str
    kind: str  # "image" | "video"
    path: str  # text-to-image / text-to-video endpoint
    i2v_path: str = ""  # video: image-to-video endpoint
    blurb: str = ""
    aspects: tuple[str, ...] = ()
    resolutions: tuple[str, ...] = ()
    default_resolution: str = ""
    durations: tuple[int, ...] = ()
    seed_range: Optional[tuple[int, int]] = None
    reference: str = ""
    max_references: int = 0
    end_frame: str = ""
    audio: str = ""
    batch_field: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def public(self) -> dict[str, Any]:
        """What the studio's model picker needs to draw the right controls."""
        return {
            "key": self.key,
            "name": self.name,
            "family": self.family,
            "blurb": self.blurb,
            "aspects": list(self.aspects),
            "resolutions": list(self.resolutions),
            "default_resolution": self.default_resolution,
            "durations": list(self.durations),
            "seed": self.seed_range is not None,
            "reference_input": bool(self.reference) or (self.kind == "video" and bool(self.i2v_path)),
            "end_frame": bool(self.end_frame),
            "audio": bool(self.audio),
            "text_to_video": self.kind == "video" and bool(self.path),
        }


_SOUL_ASPECTS = ("1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16")

CATALOG: tuple[ModelSpec, ...] = (
    # ---------------- images ----------------
    ModelSpec(
        key="soul-v2",
        name="Soul 2",
        family="Higgsfield Soul",
        kind="image",
        path="/higgsfield-ai/soul/v2/standard",
        blurb="Photoreal fashion and editorial images with a natural, shot-on-camera look.",
        aspects=_SOUL_ASPECTS,
        resolutions=("720p", "1080p"),
        default_resolution="1080p",
        seed_range=(1, 1_000_000),
        batch_field="batch_size",
    ),
    ModelSpec(
        key="soul",
        name="Soul",
        family="Higgsfield Soul",
        kind="image",
        path="/higgsfield-ai/soul/standard",
        blurb="The original Soul. Takes one reference image to steer the look.",
        aspects=_SOUL_ASPECTS,
        resolutions=("720p", "1080p"),
        default_resolution="1080p",
        seed_range=(1, 1_000_000),
        reference="image_reference_url",
        max_references=1,
        batch_field="batch_size",
    ),
    ModelSpec(
        key="soul-cinema",
        name="Soul Cinema",
        family="Higgsfield Soul",
        kind="image",
        path="/higgsfield-ai/soul/cinema",
        blurb="Cinematic stills: film lighting, lens character and grade.",
        aspects=_SOUL_ASPECTS,
        resolutions=("720p", "1080p"),
        default_resolution="1080p",
        seed_range=(1, 1_000_000),
        batch_field="batch_size",
    ),
    ModelSpec(
        key="grok-image-2",
        name="Grok Image 2",
        family="xAI Grok",
        kind="image",
        path="/xai/grok-imagine-image-2.0",
        blurb="Generates from text, or edits up to 10 reference images: product swaps, restyles, composites.",
        aspects=("1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"),
        resolutions=("1k", "2k"),
        default_resolution="2k",
        reference="image_urls",
        max_references=10,
        extra={"quality": "medium"},
    ),
    # ---------------- video ----------------
    ModelSpec(
        key="kling-3-pro",
        name="Kling 3.0 Pro",
        family="Kling",
        kind="video",
        path="/kling-video/v3.0/pro/text-to-video",
        i2v_path="/kling-video/v3.0/pro/image-to-video",
        blurb="Strong motion and physics, native sound, up to 15 s. Start and end frames.",
        aspects=("16:9", "9:16", "1:1"),
        durations=(5, 8, 10, 15),
        end_frame="last_image_url",
        audio="sound",
    ),
    ModelSpec(
        key="seedance-2",
        name="Seedance 2.0",
        family="ByteDance Seedance",
        kind="video",
        path="/bytedance/seedance-2.0/text-to-video",
        i2v_path="/bytedance/seedance-2.0/image-to-video",
        blurb="Cinematic shots with generated audio, up to 4K and 15 s. Start and end frames.",
        aspects=("16:9", "9:16", "1:1", "4:3", "3:4", "21:9"),
        resolutions=("480p", "720p", "1080p", "4k"),
        default_resolution="1080p",
        durations=(5, 8, 10, 15),
        end_frame="end_image_url",
        audio="generate_audio",
    ),
    ModelSpec(
        key="hailuo-2-3",
        name="Hailuo 2.3",
        family="MiniMax Hailuo",
        kind="video",
        path="/minimax/hailuo-2.3/standard/text-to-video",
        i2v_path="/minimax/hailuo-2.3/standard/image-to-video",
        blurb="Fast, affordable 768p clips of 6 or 10 s. Good for drafts.",
        durations=(6, 10),
        extra={"prompt_optimizer": True},
    ),
)

BY_KEY = {spec.key: spec for spec in CATALOG}


def find(key_or_path: str) -> Optional[ModelSpec]:
    """A catalog entry by key, or by either of its endpoint paths."""
    if key_or_path in BY_KEY:
        return BY_KEY[key_or_path]
    for spec in CATALOG:
        if key_or_path in (spec.path, spec.i2v_path):
            return spec
    return None


def generic(kind: str, path: str) -> ModelSpec:
    """A model added by endpoint path that the catalog does not know. Sends only
    the fields every Higgsfield endpoint of that kind accepts."""
    is_i2v = "image-to-video" in path
    return ModelSpec(
        key=path,
        name=path.strip("/").replace("/", " · "),
        family="Higgsfield (custom path)",
        kind=kind,
        path="" if is_i2v else path,
        i2v_path=path if is_i2v else "",
        blurb="Added by endpoint path. Only the prompt, and an image for image-to-video, are sent.",
        durations=(5, 10) if kind == "video" else (),
    )


def nearest_aspect(aspect: str, allowed: tuple[str, ...]) -> str:
    """The allowed ratio closest to the one asked for."""
    if aspect in allowed or not allowed:
        return aspect

    def ratio(value: str) -> float:
        try:
            w, h = value.split(":")
            return float(w) / float(h)
        except (ValueError, ZeroDivisionError):
            return 1.0

    want = ratio(aspect)
    return min(allowed, key=lambda a: abs(ratio(a) - want))


def nearest_duration(seconds: float, allowed: tuple[int, ...]) -> int:
    return min(allowed, key=lambda d: abs(d - seconds)) if allowed else int(round(seconds))


def fit_seed(seed: Optional[int], seed_range: Optional[tuple[int, int]]) -> Optional[int]:
    """Studio seeds go up to 2^32; Higgsfield takes 1..1,000,000. A seed already
    in range is kept as is, so a remixed seed reproduces the same image."""
    if seed is None or seed_range is None:
        return None
    lo, hi = seed_range
    if lo <= seed <= hi:
        return seed
    return lo + seed % (hi - lo + 1)
