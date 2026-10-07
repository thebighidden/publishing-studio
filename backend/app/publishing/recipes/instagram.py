from __future__ import annotations

import time
from typing import Any

from ..context import RunContext
from .base import (
    Evidence,
    MetricReading,
    PostPayload,
    PublishFailed,
    Recipe,
    count_on_screen,
    distinctive_token,
    labelled_count,
    read_count,
    screen_has_token,
)


def _profile_posts(ctx: RunContext) -> tuple[int, str]:
    """How many posts the profile claims, and how we worked that out.

    Prefer the header's "N posts" label: counting grid tiles only sees the
    ~9 that fit on screen, so before and after are identical even when the
    post really went out.
    """
    n = labelled_count(ctx, "instagram.post_count")
    if n >= 0:
        return n, "header label"
    return count_on_screen(ctx, "instagram.first_profile_post"), "visible grid tiles"


class InstagramRecipe(Recipe):
    platform = "instagram"
    package = "com.instagram.android"
    home_target = "instagram.profile_tab"

    def baseline(self, ctx: RunContext) -> dict[str, Any]:
        ctx.app_start(self.package)
        ctx.tap_if_present("system.allow_permission")
        ctx.tap("instagram.profile_tab")
        time.sleep(1.5)
        before, how = _profile_posts(ctx)
        shot = ctx.screenshot("profile-before")
        ctx.note("baseline", f"profile shows {before} posts before publishing (via {how})")
        return {"profile_posts": before, "counted_by": how, "screenshot": shot}

    def publish(self, ctx: RunContext, payload: PostPayload) -> None:
        if not payload.media_path:
            raise PublishFailed("Instagram needs an image or video", retryable=False)

        ctx.tap("instagram.home_tab")
        ctx.tap("instagram.new_post")
        ctx.tap_if_present("system.allow_permission")

        if payload.placement == "reel":
            ctx.tap_if_present("instagram.post_type_reel")
        elif payload.placement == "story":
            ctx.tap_if_present("instagram.post_type_story")

        if not ctx.wait_for("instagram.gallery_first_item", timeout=15):
            raise PublishFailed("gallery never appeared; the picker may need permission")
        # The transferred file is the most recent item in the camera roll.
        ctx.tap("instagram.gallery_first_item")

        ctx.tap("instagram.next")
        # Filter screen on one build, caption screen on another: a second Next
        # is sometimes needed, so only tap it if the caption field is not up yet.
        if not ctx.wait_for("instagram.caption_field", timeout=6):
            ctx.tap_if_present("instagram.next")
        if not ctx.wait_for("instagram.caption_field", timeout=12):
            raise PublishFailed("never reached the caption screen")

        ctx.type_into("instagram.caption_field", payload.full_caption())
        ctx.key("KEYCODE_BACK")  # dismiss the keyboard so Share is reachable

        shot = ctx.screenshot("before-share")
        ctx.note("pre-share", f"about to tap Share (screenshot {shot})")
        ctx.tap("instagram.share")
        # Upload takes a moment. Waiting here is not proof of anything; the
        # verify step is what decides.
        time.sleep(6)

    def verify(self, ctx: RunContext, payload: PostPayload, baseline: dict[str, Any]) -> Evidence:
        shots: list[str] = []
        before = baseline.get("profile_posts", -1)

        ctx.tap_if_present("instagram.home_tab")
        ctx.tap("instagram.profile_tab")
        time.sleep(2.5)
        after, how = _profile_posts(ctx)
        shots.append(ctx.screenshot("profile-after") or "")

        checks: dict[str, Any] = {
            "profile_posts_before": before,
            "profile_posts_after": after,
            "counted_by": how,
            "grid_grew": after > before >= 0,
        }

        if before < 0 or after < 0:
            return Evidence(
                confirmed=False,
                kind="none",
                note=(
                    "could not read the profile grid, so the post can be neither "
                    "confirmed nor ruled out"
                ),
                screenshots=[s for s in shots if s],
                checks=checks,
            )

        if after <= before:
            return Evidence(
                confirmed=False,
                kind="profile_delta",
                note=f"profile still shows {after} posts; nothing was added",
                screenshots=[s for s in shots if s],
                checks=checks,
            )

        # The grid grew. Open the newest post and look for our own words in it,
        # which is what makes this hard to fool: a stray notification or an
        # unrelated upload would not carry our caption.
        token = distinctive_token(payload.caption)
        checks["token"] = token
        matched = False
        try:
            ctx.tap("instagram.first_profile_post")
            time.sleep(2)
            shots.append(ctx.screenshot("post-detail") or "")
            if token:
                state = ctx.state()
                matched = any(
                    token.lower() in (n.text or "").lower() for n in state.nodes
                )
        except Exception as exc:
            ctx.note("verify-detail", f"could not open the new post: {exc}", ok=False)
        checks["caption_matched"] = matched

        url = _published_url(ctx)
        if url:
            checks["post_url"] = url

        if matched:
            return Evidence(
                confirmed=True,
                kind="post_url" if url else "profile_delta",
                ref=url or f"profile grid {before} -> {after}",
                note="grid grew by one and the new post carries our caption",
                screenshots=[s for s in shots if s],
                checks=checks,
            )
        return Evidence(
            confirmed=True,
            kind="profile_delta",
            ref=url or f"profile grid {before} -> {after}",
            note=(
                "grid grew by one, but the caption could not be read back, so the "
                "match is positional rather than textual"
            ),
            screenshots=[s for s in shots if s],
            checks=checks,
        )


    def collect(self, ctx: RunContext, payload: PostPayload, *, max_slots: int = 6) -> MetricReading:
        """Walk the profile grid until a tile carries our caption, then read the
        counters off that post.

        Opening tile 0 and trusting it would be wrong the moment the account
        posts anything by hand, and a wrong number is worse than no number: the
        whole point of this studio is that what it reports was observed.
        """
        ctx.app_start(self.package)
        ctx.tap_if_present("system.allow_permission")
        ctx.tap("instagram.profile_tab")
        time.sleep(1.5)

        token = distinctive_token(payload.caption)
        if not token:
            return MetricReading(
                found=False,
                note=(
                    "this caption has no distinctive word, so its post cannot be "
                    "told apart from the others on the grid"
                ),
            )

        tiles = min(max_slots, 9)
        for slot in range(1, tiles + 1):
            target = f"instagram.profile_post_{slot}"
            try:
                ctx.tap(target)
            except Exception as exc:
                ctx.note("collect-grid", f"grid position {slot} did not open: {exc}", ok=False)
                break
            time.sleep(1.8)

            if not screen_has_token(ctx, token):
                ctx.key("KEYCODE_BACK")
                time.sleep(1.0)
                continue

            likes, likes_approx, likes_raw = read_count(ctx, "instagram.post_like_count")
            comments, comments_approx, comments_raw = read_count(ctx, "instagram.post_comment_count")
            views, views_approx, views_raw = read_count(ctx, "instagram.post_view_count")
            shot = ctx.screenshot(f"metrics-{slot}")

            seen = [n for n in (likes, comments, views) if n is not None]
            reading = MetricReading(
                found=True,
                likes=likes,
                comments=comments,
                views=views,
                approximate=any([likes_approx, comments_approx, views_approx]),
                note=(
                    f"read off the post at grid position {slot}, recognised by the "
                    f"word {token!r} in its caption"
                    if seen
                    else (
                        f"found our post at grid position {slot}, but it showed no "
                        "counters to read"
                    )
                ),
                raw={"likes": likes_raw, "comments": comments_raw, "views": views_raw},
                matched_by={"matched_by": "caption_token", "token": token, "slot": slot},
                screenshot=shot,
            )
            ctx.note(
                "collect",
                f"likes={likes} comments={comments} views={views}"
                + (" (abbreviated on screen)" if reading.approximate else ""),
            )
            ctx.key("KEYCODE_BACK")
            return reading

        return MetricReading(
            found=False,
            matched_by={"matched_by": "caption_token", "token": token, "searched": tiles},
            note=(
                f"the word {token!r} was not on any of the first {tiles} posts of the "
                "grid; the post may be older than that, or may no longer be up"
            ),
        )


def _published_url(ctx: RunContext) -> str:
    """The simulator knows the canonical URL because it is the platform. A real
    phone does not expose one, and we do not invent it."""
    getter = getattr(ctx.driver, "published_urls", None)
    if not callable(getter):
        return ""
    urls = getter()
    return urls[-1] if urls else ""
