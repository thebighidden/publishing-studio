from __future__ import annotations

import time
from typing import Any

from ..context import RunContext
from .base import Evidence, PostPayload, PublishFailed, Recipe, count_on_screen, distinctive_token

MAX_CHARS = 280


class XRecipe(Recipe):
    platform = "x"
    package = "com.twitter.android"
    home_target = "x.profile_tab"

    def baseline(self, ctx: RunContext) -> dict[str, Any]:
        ctx.app_start(self.package)
        ctx.tap_if_present("system.allow_permission")
        ctx.tap("x.profile_tab")
        time.sleep(1.5)
        before = count_on_screen(ctx, "x.first_timeline_post")
        shot = ctx.screenshot("profile-before")
        ctx.note("baseline", f"profile shows {before} posts before publishing")
        return {"profile_posts": before, "screenshot": shot}

    def publish(self, ctx: RunContext, payload: PostPayload) -> None:
        text = payload.full_caption()
        if len(text) > MAX_CHARS:
            trimmed = text[: MAX_CHARS - 1].rstrip() + "…"
            ctx.note(
                "trim",
                f"caption was {len(text)} chars, over the {MAX_CHARS} limit; trimmed to fit",
            )
            text = trimmed

        ctx.tap("x.compose")
        if not ctx.wait_for("x.compose_field", timeout=12):
            raise PublishFailed("composer never opened")

        ctx.tap("x.compose_field")
        ctx.type_text(text)

        if payload.media_path:
            ctx.tap("x.add_media")
            ctx.tap_if_present("system.allow_permission")
            if ctx.wait_for("x.gallery_first_item", timeout=12):
                ctx.tap("x.gallery_first_item")
                ctx.tap_if_present("x.media_add_button")
            else:
                # Text still posts. Say so rather than failing the whole run.
                ctx.note("media", "gallery did not open; posting without media", ok=False)

        shot = ctx.screenshot("before-post")
        ctx.note("pre-post", f"about to tap Post (screenshot {shot})")
        ctx.tap("x.post_button")
        time.sleep(5)

    def verify(self, ctx: RunContext, payload: PostPayload, baseline: dict[str, Any]) -> Evidence:
        shots: list[str] = []
        before = baseline.get("profile_posts", -1)

        ctx.tap("x.profile_tab")
        time.sleep(2.5)
        after = count_on_screen(ctx, "x.first_timeline_post")
        shots.append(ctx.screenshot("profile-after") or "")

        token = distinctive_token(payload.caption)
        matched = False
        try:
            state = ctx.state()
            matched = bool(token) and any(
                token.lower() in (n.text or "").lower() for n in state.nodes
            )
        except Exception as exc:
            ctx.note("verify-read", f"could not read the profile timeline: {exc}", ok=False)

        checks = {
            "profile_posts_before": before,
            "profile_posts_after": after,
            "grid_grew": after > before >= 0,
            "token": token,
            "caption_matched": matched,
        }

        url = _published_url(ctx)
        if url:
            checks["post_url"] = url

        # On X the caption is visible right on the profile timeline, so seeing
        # our own words there is the strongest signal available.
        if matched:
            return Evidence(
                confirmed=True,
                kind="post_url" if url else "screenshot",
                ref=url or (shots[0] if shots else ""),
                note="our caption is visible on the account timeline",
                screenshots=[s for s in shots if s],
                checks=checks,
            )

        if before >= 0 and after > before:
            return Evidence(
                confirmed=True,
                kind="profile_delta",
                ref=url or f"timeline {before} -> {after}",
                note="timeline grew by one, though the text could not be read back",
                screenshots=[s for s in shots if s],
                checks=checks,
            )

        if before < 0 or after < 0:
            return Evidence(
                confirmed=False,
                kind="none",
                note="could not read the timeline, so the result is unknown",
                screenshots=[s for s in shots if s],
                checks=checks,
            )

        return Evidence(
            confirmed=False,
            kind="profile_delta",
            note=f"timeline still shows {after} posts; nothing was added",
            screenshots=[s for s in shots if s],
            checks=checks,
        )


def _published_url(ctx: RunContext) -> str:
    getter = getattr(ctx.driver, "published_urls", None)
    if not callable(getter):
        return ""
    urls = getter()
    return urls[-1] if urls else ""
