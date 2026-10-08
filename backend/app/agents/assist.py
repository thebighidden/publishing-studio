"""Studio helpers on the text model: an idea becomes an image prompt, and an
image gets a caption in an account's own voice."""
from __future__ import annotations

from typing import Any, Optional

from sqlmodel import Session

from ..models import Account, MediaAsset, ProviderAdapter, ProviderKind
from ..providers import registry
from ..providers.base import ProviderError
from . import specs
from .pipeline import SYSTEM as EDITORIAL_SYSTEM
from .pipeline import _json

PROMPT_SYSTEM = (
    "You write prompts for image and video generation models. You turn a short idea into "
    "one precise, visual description a model can render. Answer with JSON only."
)


def _writer(session: Session) -> tuple[Any, str, bool]:
    text, cfg = registry.get_text(session)
    simulated = cfg is None or cfg.adapter == ProviderAdapter.simulated
    return text, registry.describe(cfg, ProviderKind.text), simulated


def improve_prompt(session: Session, idea: str, *, style: str = "", kind: str = "image") -> dict[str, Any]:
    text, model, simulated = _writer(session)
    prompt = f"""<<task:visual>>
Turn a short idea into one detailed {kind} generation prompt. Return JSON only.

Brief: {idea}
Style already applied separately: {style or 'none'}
Rules: one paragraph, at most 90 words. Describe the subject, setting, composition,
light, camera or lens, mood and colour. Keep every specific thing the brief mentions.
Concrete nouns, no lists, no "8k", "masterpiece" or other filler. No text or logos in
the image unless the brief asks for them.{' Describe motion and camera movement too.' if kind == 'video' else ''}

Return: {{"prompt": "..."}}"""
    out = _json(text.complete(prompt, system=PROMPT_SYSTEM, json_object=True, max_tokens=500, temperature=0.8).text)
    result = str(out.get("prompt") or "").strip()
    if not result:
        raise ProviderError("the text model returned no prompt; try again or write it by hand")
    return {"prompt": result, "model": model, "simulated": simulated}


def write_caption(
    session: Session,
    asset: MediaAsset,
    account: Optional[Account],
    *,
    brief: str = "",
    placement: str = "feed",
) -> dict[str, Any]:
    """Writer plus adapter for one studio asset: the account's voice, inside the platform's limits."""
    text, model, simulated = _writer(session)
    platform = account.platform.value if account else "instagram"
    spec = specs.spec_for(platform, placement)
    profile = (account.editorial_profile if account else None) or {}
    examples = "\n".join(f"- {e}" for e in ((account.liked_examples if account else None) or [])[:3])
    defaults = [h.lstrip("#") for h in profile.get("default_hashtags", []) if h.strip()]
    hashtag_max = min(spec.hashtag_max, 8)
    image = (asset.params or {}).get("prompt") or asset.prompt or "an image"

    prompt = f"""<<task:caption>>
Write the caption for one post about this {asset.kind.value}. Return JSON only.

Platform: {platform}
Placement: {placement}
Account: {'@' + account.handle if account else 'not chosen yet'}
Tone: {profile.get('tone', 'warm, direct and concrete')}
Topics: {profile.get('topics', image)}
Style: {profile.get('style', 'short sentences, no hype')}
Image: {image}
Brief: {brief or image}
Goal: say what the image shows and why it is worth a look; do not describe it like a prompt
Hard limit: {spec.caption_max} characters including hashtags
Hashtags: at most {hashtag_max}{', always include ' + ', '.join('#' + d for d in defaults) if defaults else ''}
{f"Sign-off: end the caption with exactly: {profile['signature']}" if profile.get('signature') else ''}
{f"Never use: {profile['avoid']}" if profile.get('avoid') else ''}
{f'Liked examples:{chr(10)}{examples}' if examples else ''}

Return: {{"caption": "...", "hashtags": ["#one", "#two"]}}"""

    out = _json(text.complete(prompt, system=EDITORIAL_SYSTEM, json_object=True, max_tokens=900).text)
    caption = str(out.get("caption") or "").strip()
    if not caption:
        raise ProviderError("the text model returned no caption; try again or write it by hand")
    hashtags: list[str] = []
    for tag in [*defaults, *[str(h) for h in (out.get("hashtags") or [])]]:
        clean = tag.strip().lstrip("#").replace(" ", "")
        if clean and clean.lower() not in {h.lower() for h in hashtags}:
            hashtags.append(clean)
    hashtags = hashtags[:hashtag_max]
    signature = str(profile.get("signature") or "").strip()
    if signature and not caption.rstrip().endswith(signature):
        caption = f"{caption.rstrip()}\n\n{signature}"

    # The limit is enforced here, not hoped for.
    budget = spec.caption_max - sum(len(h) + 2 for h in hashtags)
    if spec.caption_max and len(caption) > budget:
        caption = caption[: max(0, budget - 1)].rstrip() + "…"
    return {"caption": caption, "hashtags": hashtags, "model": model, "simulated": simulated}
