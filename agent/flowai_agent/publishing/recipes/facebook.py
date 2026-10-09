from __future__ import annotations

import time
from typing import Any

from ..context import RunContext
from .base import Evidence, PostPayload, PublishFailed, Recipe, distinctive_token


class FacebookRecipe(Recipe):
    """A text, photo or video post from the Facebook app.

    Reels and Stories go through the Pages API instead (Accounts → Connect), which is also the
    way to post as a Page without switching the app. Proof is our own words on the profile;
    when they can't be seen the run ends uncertain, never failed, so nothing is re-posted blind.
    """

    platform = "facebook"
    package = "com.facebook.katana"
    home_target = "facebook.profile_tab"

    def baseline(self, ctx: RunContext) -> dict[str, Any]:
        ctx.app_start(self.package)
        ctx.tap_if_present("system.allow_permission")
        if not ctx.wait_for("facebook.composer_entry", timeout=20):
            ctx.tap_if_present("facebook.home_tab")
        shot = ctx.screenshot("home-before")
        return {"screenshot": shot}

    def publish(self, ctx: RunContext, payload: PostPayload) -> None:
        if payload.placement in ("reel", "story"):
            raise PublishFailed(
                f"Facebook {payload.placement}s publish through the Pages API: connect the Page on the Accounts page",
                retryable=False,
            )

        ctx.tap("facebook.composer_entry")
        if not ctx.wait_for("facebook.compose_field", timeout=15):
            raise PublishFailed("the composer never opened")
        ctx.type_into("facebook.compose_field", payload.full_caption())

        if payload.media_path:
            ctx.tap("facebook.add_media")
            ctx.tap_if_present("system.allow_permission")
            if not ctx.wait_for("facebook.gallery_first_item", timeout=15):
                raise PublishFailed("the photo picker never appeared; it may need permission")
            ctx.tap("facebook.gallery_first_item")
            time.sleep(1)
            ctx.tap_if_present("facebook.media_done")
            if not ctx.wait_for("facebook.compose_field", timeout=15):
                raise PublishFailed("didn't come back to the post after picking the media")

        shot = ctx.screenshot("before-post")
        ctx.note("pre-post", f"about to tap Post (screenshot {shot})")
        if not ctx.wait_for("facebook.post_button", timeout=4) and ctx.tap_if_present("facebook.next"):
            if not ctx.wait_for("facebook.post_button", timeout=10):
                raise PublishFailed("the audience screen had no Post button")
        ctx.tap("facebook.post_button")
        # Uploads finish in the background; give a video longer before looking.
        time.sleep(12 if payload.media_path and payload.media_path.endswith(".mp4") else 6)

    def verify(self, ctx: RunContext, payload: PostPayload, baseline: dict[str, Any]) -> Evidence:
        shots: list[str] = []
        token = distinctive_token(payload.caption)
        self.back_in_app(ctx, "facebook.profile_tab")
        ctx.tap("facebook.profile_tab")
        time.sleep(3)

        matched, readable = False, False
        for _ in range(4):  # the posts sit below the profile header
            try:
                state = ctx.state()
                readable = True
                matched = bool(token) and any(token.lower() in f"{n.text} {n.content_desc}".lower() for n in state.nodes)
            except Exception as exc:  # noqa: BLE001
                ctx.note("verify-read", f"could not read the profile: {exc}", ok=False)
            if matched:
                break
            ctx.swipe("up", 0.45)
            time.sleep(1.5)
        shots.append(ctx.screenshot("profile-after") or "")

        checks = {"token": token, "caption_matched": matched}
        if matched:
            return Evidence(confirmed=True, kind="screenshot", ref=shots[0], note="our caption is on the profile", screenshots=[s for s in shots if s], checks=checks)
        return Evidence(
            confirmed=False,
            kind="none",
            note="tapped Post, but the caption isn't visible on the profile yet" if readable else "couldn't read the profile, so the result is unknown",
            screenshots=[s for s in shots if s],
            checks=checks,
        )
