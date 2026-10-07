from __future__ import annotations

import colorsys
import hashlib
import io
import json
import random
import re
import subprocess
import tempfile
import textwrap
from pathlib import Path
from typing import Any, Optional

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .base import (
    ImageProvider,
    MediaResult,
    TextProvider,
    TextResult,
    VideoProvider,
    aspect_size,
)

# Prompts carry a task marker so the offline provider can answer in the right
# shape without the pipeline needing a second code path.
TASK_RE = re.compile(r"<<task:(\w+)>>")


def _seed_of(text: str) -> int:
    return int(hashlib.sha256(text.encode()).hexdigest()[:8], 16)


def _font(size: int, bold: bool = False):
    for name in (("seguisb.ttf", "arialbd.ttf") if bold else ("segoeui.ttf", "arial.ttf")):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


class SimulatedText(TextProvider):
    """Writes usable copy with no API key and no network.

    It is not a language model. It is a deterministic templater that keeps the
    whole studio demoable offline — every output is tagged so nobody mistakes
    it for generated copy.
    """

    def __init__(self, options: Optional[dict[str, Any]] = None):
        self.options = options or {}

    def complete(
        self,
        prompt: str,
        *,
        system: str = "",
        json_object: bool = False,
        max_tokens: int = 1200,
        temperature: float = 0.7,
    ) -> TextResult:
        rng = random.Random(_seed_of(prompt + system))
        match = TASK_RE.search(prompt)
        task = match.group(1) if match else ("plan" if json_object else "caption")
        fields = _parse_fields(prompt)

        if task == "plan":
            payload = self._plan(fields, rng)
        elif task == "caption":
            payload = self._caption(fields, rng)
        elif task == "adapt":
            payload = self._adapt(fields, rng)
        elif task == "visual":
            payload = self._visual(fields, rng)
        elif task == "qa":
            payload = {"verdict": "pass", "issues": [], "notes": "offline check: no blockers found"}
        else:
            payload = {"text": f"{fields.get('message', 'Update')} — drafted offline."}

        text = json.dumps(payload, ensure_ascii=False, indent=2) if json_object else _as_text(payload)
        return TextResult(text=text, model="simulated/offline-writer", cost=0.0)

    def check(self) -> str:
        return "offline writer: no network, no key, deterministic output"

    def _plan(self, f: dict[str, str], rng: random.Random) -> dict[str, Any]:
        goal = f.get("goal") or "introduce the product"
        audience = f.get("audience") or "our audience"
        message = f.get("message") or goal
        angles = [
            ("The hook", f"Lead with the single most surprising thing about {message.lower()}."),
            ("Proof", f"Show it working. Concrete detail beats adjectives for {audience.lower()}."),
            ("The human angle", f"Who does {message.lower()} actually help, and how."),
            ("Behind the scenes", "How it was made, in one honest frame."),
            ("Call to action", "One clear next step, no hedging."),
        ]
        rng.shuffle(angles)
        chosen = angles[: int(f.get("count", 3) or 3)]
        return {
            "summary": f"A short run aimed at {audience.lower()}: {goal}",
            "tone": f.get("tone") or "direct, concrete, no hype",
            "items": [
                {
                    "title": title,
                    "angle": angle,
                    "caption_brief": f"{angle} Reference: {message}",
                    "visual_brief": f"{title.lower()} — clean editorial photograph, natural light",
                    "media_kind": "image",
                    "placement": "feed",
                }
                for title, angle in chosen
            ],
        }

    def _caption(self, f: dict[str, str], rng: random.Random) -> dict[str, Any]:
        brief = f.get("brief") or f.get("message") or "An update worth reading."
        opener = rng.choice(
            [
                "Here is the short version.",
                "One thing worth your attention today.",
                "We shipped something.",
                "Small change, real difference.",
            ]
        )
        body = textwrap.shorten(brief, width=180, placeholder="…")
        cta = rng.choice(["Details in bio.", "Come and see.", "Tell us what you think."])
        tags = _hashtags(f.get("topics") or f.get("message") or "update", rng)
        return {"caption": f"{opener}\n\n{body}\n\n{cta}", "hashtags": tags}

    def _adapt(self, f: dict[str, str], rng: random.Random) -> dict[str, Any]:
        caption = f.get("caption") or f.get("brief") or "Update"
        if (f.get("platform") or "").lower() == "x":
            short = textwrap.shorten(caption.replace("\n\n", " "), width=250, placeholder="…")
            return {"caption": short, "hashtags": _hashtags(caption, rng)[:2]}
        return {"caption": caption, "hashtags": _hashtags(caption, rng)}

    def _visual(self, f: dict[str, str], rng: random.Random) -> dict[str, Any]:
        subject = f.get("brief") or f.get("message") or "product on a clean surface"
        return {
            "prompt": (
                f"Editorial photograph: {subject}. Natural window light from the left, "
                "shallow depth of field, muted palette, no text, no logos, 50mm."
            ),
            "negative": "text, watermark, logo, distorted hands, oversaturated",
        }


def _parse_fields(prompt: str) -> dict[str, str]:
    """Pull `Key: value` lines out of the prompt so templates have material."""
    fields: dict[str, str] = {}
    for line in prompt.splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            key = k.strip().lower().replace(" ", "_")
            if key and len(key) < 32 and v.strip():
                fields[key] = v.strip()
    return fields


def _as_text(payload: dict[str, Any]) -> str:
    for key in ("caption", "text", "prompt", "summary"):
        if key in payload:
            return str(payload[key])
    return json.dumps(payload, ensure_ascii=False)


def _hashtags(source: str, rng: random.Random) -> list[str]:
    words = [w.lower() for w in re.findall(r"[A-Za-z]{4,}", source)][:6]
    base = [f"#{w}" for w in dict.fromkeys(words)][:3]
    extra = rng.sample(["#behindthescenes", "#madehere", "#newrelease", "#studio"], 2)
    return base + extra


class SimulatedImage(ImageProvider):
    """Renders a readable placeholder that carries the prompt, so a reviewer
    can judge framing and layout before any credits are spent."""

    def __init__(self, options: Optional[dict[str, Any]] = None):
        self.options = options or {}

    def generate(self, prompt: str, *, aspect: str = "1:1", seed: int | None = None) -> MediaResult:
        w, h = aspect_size(aspect)
        rng = random.Random(seed if seed is not None else _seed_of(prompt))
        img = _gradient(w, h, rng)
        d = ImageDraw.Draw(img)

        d.rounded_rectangle((60, 60, w - 60, h - 60), radius=28, outline=(255, 255, 255, 90), width=3)
        d.text((88, 96), "SIMULATED MEDIA", font=_font(max(20, w // 42), True), fill=(255, 255, 255))
        wrapped = textwrap.fill(prompt.strip(), width=max(22, w // 26))
        d.multiline_text(
            (88, 96 + w // 24),
            "\n".join(wrapped.splitlines()[:9]),
            font=_font(max(18, w // 34)),
            fill=(255, 255, 255),
            spacing=10,
        )
        d.text(
            (88, h - 120),
            f"{w}x{h} · {aspect} · no credits spent",
            font=_font(max(16, w // 48)),
            fill=(255, 255, 255, 200),
        )

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return MediaResult(
            data=buf.getvalue(),
            ext=".png",
            mime="image/png",
            model="simulated/placeholder",
            width=w,
            height=h,
            meta={"simulated": True},
        )

    def check(self) -> str:
        return "offline placeholder renderer, always available"


def _gradient(w: int, h: int, rng: random.Random) -> Image.Image:
    hue = rng.random()
    c1 = tuple(int(v * 255) for v in colorsys.hsv_to_rgb(hue, 0.55, 0.42))
    c2 = tuple(int(v * 255) for v in colorsys.hsv_to_rgb((hue + 0.12) % 1.0, 0.65, 0.78))
    base = Image.new("RGB", (w, h), c1)
    top = Image.new("RGB", (w, h), c2)
    mask = Image.linear_gradient("L").resize((w, h)).rotate(rng.choice([0, 90, 180]), expand=False)
    img = Image.composite(top, base, mask)
    for _ in range(3):
        x, y = rng.randint(0, w), rng.randint(0, h)
        r = rng.randint(w // 8, w // 3)
        ImageDraw.Draw(img).ellipse((x - r, y - r, x + r, y + r), fill=c2)
    return img.filter(ImageFilter.GaussianBlur(radius=max(8, w // 40)))


class SimulatedVideo(VideoProvider):
    """A real MP4, encoded locally with the ffmpeg binary that ships with
    imageio-ffmpeg. Slow pan over a generated still, so downstream code gets a
    genuine video file to transfer and post."""

    def __init__(self, options: Optional[dict[str, Any]] = None):
        self.options = options or {}

    def generate(
        self,
        prompt: str,
        *,
        aspect: str = "9:16",
        duration_s: float = 5.0,
        image: bytes | None = None,
    ) -> MediaResult:
        w, h = aspect_size(aspect)
        w, h = w - w % 2, h - h % 2
        duration_s = max(2.0, min(float(duration_s), 15.0))

        if image:
            still = Image.open(io.BytesIO(image)).convert("RGB").resize((w, h))
        else:
            still = Image.open(
                io.BytesIO(SimulatedImage().generate(prompt, aspect=aspect).data)
            ).convert("RGB")

        data = _encode_pan(still, w, h, duration_s)
        return MediaResult(
            data=data,
            ext=".mp4",
            mime="video/mp4",
            model="simulated/ffmpeg-pan",
            width=w,
            height=h,
            duration_s=duration_s,
            meta={"simulated": True},
        )

    def check(self) -> str:
        return f"local encoder ready ({_ffmpeg()})"


def _ffmpeg() -> str:
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def _encode_pan(still: Image.Image, w: int, h: int, duration_s: float) -> bytes:
    fps = 24
    frames = int(duration_s * fps)
    big = still.resize((int(w * 1.18), int(h * 1.18)))
    max_dx, max_dy = big.width - w, big.height - h

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        for i in range(frames):
            t = i / max(1, frames - 1)
            crop = big.crop(
                (int(max_dx * t), int(max_dy * t), int(max_dx * t) + w, int(max_dy * t) + h)
            )
            crop.save(tmpdir / f"f{i:05d}.jpg", quality=92)

        out = tmpdir / "out.mp4"
        proc = subprocess.run(
            [
                _ffmpeg(), "-y", "-loglevel", "error",
                "-framerate", str(fps),
                "-i", str(tmpdir / "f%05d.jpg"),
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-crf", "22", "-movflags", "+faststart",
                str(out),
            ],
            capture_output=True,
            timeout=240,
        )
        if proc.returncode != 0 or not out.exists():
            raise RuntimeError(f"ffmpeg failed: {proc.stderr.decode(errors='replace')[:300]}")
        return out.read_bytes()
