"""Publishing on the hackathon's remote phone, through the hackathon's own phone agent.

The phone's API has no UI tree, so FlowAI's recipes (which find buttons by name) can't drive it.
The hackathon agent can: it looks at the screen and acts. So a FlowAI publishing run there is:

1. the post's image or video is uploaded to the phone (POST /phone/media);
2. one agent task, in "pro" mode (an independent check of the answer), with a goal that says
   exactly what to post, where, with which caption, and to confirm it on the profile; the answer
   comes back as JSON against a schema;
3. its events are reported to FlowAI as the run's steps (also its heartbeat); if the agent asks
   for an approval, the run says so and waits, and the person approves it in FlowAI's Agent panel;
4. the run ends honestly: confirmed only when the agent says it published *and* saw the post on
   the profile (with a screenshot as proof); published but unseen is uncertain; anything that may
   have tapped publish before failing is uncertain, never re-posted blind.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from typing import Any, Optional

from .. import config
from ..api import ApiError, FlowAI
from ..hackapi import HackApiError, HackPhone

log = logging.getLogger("flowai.agent")

APPS = {"instagram": "Instagram", "tiktok": "TikTok", "x": "X (Twitter)", "linkedin": "LinkedIn",
        "facebook": "Facebook", "youtube": "YouTube", "pinterest": "Pinterest"}
# A task that has answered goes "idle" (it could take a follow-up message); that is finished too.
DONE = ("succeeded", "idle", "failed", "cancelled")
FINISHED_OK = ("succeeded", "idle")
# Events worth a step in FlowAI's record; usage and artifacts are bookkeeping.
REPORTED = ("step", "action", "result", "message", "status", "error")
ANSWER = {
    "type": "object",
    "properties": {
        "published": {"type": "boolean", "description": "true only if the post was actually shared"},
        "confirmed_on_profile": {"type": "boolean", "description": "true only if you then saw it as the newest post on the profile, with the caption"},
        "post_url": {"type": ["string", "null"]},
        "note": {"type": "string", "description": "what happened, in one or two sentences"},
    },
    "required": ["published", "confirmed_on_profile", "note"],
}
# Words in the agent's own log that mean it may already have tapped the publish button.
SUBMIT_WORDS = ("share", "publish", "post now", "tweet", "upload", "post button", "tap post", "click post", "'post'", '"post"')


X_MAX_CHARS = 280
# Where each app shows what the account posted, for the check after publishing.
PROFILE = {
    "instagram": "open the profile and check that the newest post (or the story ring, for a story) is this one",
    "facebook": "open the profile or Page it was posted from and check that the newest post is this one",
    "x": "open the profile and check that the newest post on the timeline is this one",
}


def needs_media(platform: str, placement: str) -> bool:
    """Instagram posts, and stories and Reels anywhere, can't be text alone."""
    return platform in ("instagram", "tiktok", "youtube", "pinterest") or placement in ("story", "reel")


def fit_caption(platform: str, caption: str) -> str:
    caption = caption.strip()
    if platform == "x" and len(caption) > X_MAX_CHARS:
        cut = caption[: X_MAX_CHARS - 1]
        return (cut[: cut.rfind(" ")] if " " in cut else cut).rstrip() + "…"
    return caption


def goal_for(platform: str, handle: str, caption: str, placement: str, device_path: Optional[str], kind: str) -> str:
    app = APPS.get(platform, platform.title() or "the app")
    what = {"reel": "a Reel", "story": "a story"}.get(placement, "a post" if platform == "x" else "a feed post")
    lines = [f"Publish {what} on {app}" + (f" from the account @{handle}" if handle else "") + "."]
    if device_path:
        lines.append(f"The {kind} to post is already on the phone at {device_path}; it is the newest item in the gallery. Use that one.")
    if placement == "story":
        lines.append("Stories have no caption: don't add any text or stickers.")
        steps = f"Open the {app} app, add a new story, choose that {kind}, and share it to your story."
    else:
        lines.append("Use exactly this text, character for character, between the markers (do not include the markers):")
        lines.append(f"<<<CAPTION\n{fit_caption(platform, caption)}\nCAPTION>>>")
        if device_path:
            steps = f"Open the {app} app, start a new {'Reel' if placement == 'reel' else 'post'}, choose that {kind}, set the text, and publish it."
        else:
            steps = f"Open the {app} app, start a new post with text only (no photo or video), type the text, and publish it."
    lines.append(f"{steps} Then {PROFILE.get(platform, 'open the profile and check that the newest post is this one')}.")
    lines.append(f"Do nothing else: don't change settings, follow, like, comment or message anyone. If {app} isn't installed, "
                 "or no account is signed in, stop and say so without trying to sign in.")
    return "\n".join(lines)


NUMBERS = {
    "type": "object",
    "properties": {
        "found": {"type": "boolean", "description": "true only if you found this exact post"},
        "likes": {"type": ["integer", "null"]},
        "replies": {"type": ["integer", "null"]},
        "reposts": {"type": ["integer", "null"]},
        "views": {"type": ["integer", "null"]},
        "bookmarks": {"type": ["integer", "null"]},
        "note": {"type": "string"},
    },
    "required": ["found", "note"],
}


def read_x_numbers(phone: HackPhone, post: dict[str, Any], timeout: float = 240) -> dict[str, int]:
    """One X post's likes, replies, reposts, views and bookmarks, read by the hackathon agent.
    Read-only. Raises RuntimeError with the reason when it can't."""
    where = (f"Open this post in the X app: {post['post_url']}" if post.get("post_url")
             else f"Open the X app, go to the profile @{post.get('handle') or ''}, and find the post whose text starts with: "
                  f"<<<{(post.get('caption') or '')[:120]}>>>")
    goal = (f"{where}\nRead the numbers shown on that post: replies, reposts, likes, bookmarks and views. "
            "Write 1.2K as 1200. Use null for a number that isn't shown. Only look: don't like, repost, reply, "
            "bookmark, follow or change anything. If you can't find that exact post, say found=false.")
    task = phone.create_task(goal, mode="flash", max_steps=25, output_format="json", output_schema=NUMBERS)
    deadline = time.monotonic() + timeout
    current: dict[str, Any] = {}
    while time.monotonic() < deadline:
        current = phone.task(task["id"])
        if current.get("status") in DONE:
            break
        time.sleep(3)
    else:
        phone.cancel_task(task["id"])
        raise RuntimeError("the phone agent took too long to read the post")

    result = current.get("result_data") if isinstance(current.get("result_data"), dict) else {}
    if not result and isinstance(current.get("result_text"), str):
        try:
            result = json.loads(current["result_text"])
        except ValueError:
            result = {}
    if current.get("status") not in FINISHED_OK or not result.get("found"):
        raise RuntimeError(str(result.get("note") or current.get("error") or "the phone agent couldn't find the post")[:240])
    names = {"likes": "likes", "replies": "comments", "reposts": "shares", "views": "views", "bookmarks": "saves"}
    numbers = {ours: int(result[theirs]) for theirs, ours in names.items() if isinstance(result.get(theirs), (int, float)) and result[theirs] >= 0}
    if not numbers:
        raise RuntimeError("the phone agent found the post but read no numbers")
    return numbers


def describe(event: dict[str, Any]) -> str:
    """One readable line: "3. Open About phone", "tap (0.5, 0.23)", the answer, or the status."""
    kind, data = event.get("type"), event.get("data") or {}
    if kind == "step":
        return f"{data.get('n')}. {data.get('next_goal') or data.get('evaluation') or data.get('title') or ''}".strip()
    if kind == "action":
        params = {k: v for k, v in (data.get("params") or {}).items() if k not in ("transport", "perception")}
        shown = ", ".join(f"{k}={v}" for k, v in params.items())
        return f"{data.get('name')}({shown})" + (f" failed: {data.get('error')}" if data.get("error") else "")
    if kind == "result":
        return str(data.get("text") or json.dumps(data.get("data"), ensure_ascii=False))
    if kind == "status":
        return str(data.get("status") or "") + (f": {data['detail']}" if data.get("detail") else "")
    for key in ("text", "message", "error", "reason"):
        if isinstance(data.get(key), str) and data[key].strip():
            return data[key].strip()
    return json.dumps(data, ensure_ascii=False)[:200] if data else ""


def run(api: FlowAI, ref: str, job: dict[str, Any], phone_lock: threading.Lock) -> str:
    run_id = job["run_id"]
    account, post, limits = job.get("account") or {}, job.get("post") or {}, job.get("limits") or {}
    platform = account.get("platform", "")
    media = job.get("media") or []
    budget = max(5, int(limits.get("step_budget") or config.RUN_STEP_BUDGET) - 4)  # room for the last steps
    timeout = int(limits.get("hard_timeout_seconds") or config.RUN_TIMEOUT_SECONDS)
    sent = 0
    log_text: list[str] = []

    def step(action: str, ok: bool = True, note: Optional[str] = None) -> None:
        nonlocal sent
        if sent >= budget:
            return
        try:
            api.steps(run_id, [{"action": action[:60], "ok": ok, "ms": 0, "note": (note or None) and note[:200]}])
            sent += 1
        except ApiError as exc:
            log.warning("could not report a step for run %s: %s", run_id, exc)

    if len(media) > 1:
        api.finish(run_id, "failed", f"This post has {len(media)} media items; the phone agent posts one image or video at a time.")
        return "failed"
    placement = post.get("placement") or ("reel" if post.get("format") == "video" else "feed")
    if not media and needs_media(platform, placement):
        what = f"a {placement}" if placement in ("story", "reel") else f"a {APPS.get(platform, platform)} post"
        api.finish(run_id, "failed", f"{what[0].upper()}{what[1:]} needs a photo or video; this post has none.")
        return "failed"

    log.info("run %s on %s through the hackathon agent: %s (%s)", run_id, ref, job.get("goal"), platform)
    outcome, note, post_url, task_id = "failed", "", None, None
    with phone_lock:
        phone = HackPhone()
        try:
            device_path, kind = None, "photo"
            if media:
                item = media[0]
                kind = "video" if item.get("kind") == "video" else "photo"
                suffix = ".mp4" if kind == "video" else (".jpg" if "jpeg" in (item.get("mime") or "") else ".png")
                local = api.download(item["url"], config.MEDIA_DIR / f"{run_id}{suffix}")
                uploaded = phone.upload_media(local)
                device_path = uploaded.get("device_path")
                step("upload:media", True, f"{device_path} ({uploaded.get('bytes')} bytes)")

            goal = goal_for(platform, account.get("handle", ""), post.get("caption") or "", placement, device_path, kind)
            task = phone.create_task(goal, mode="pro", max_steps=min(200, max(10, budget * 2)), output_format="json", output_schema=ANSWER)
            task_id = task["id"]
            step("agent:task", True, f"hackathon agent task {task_id} (pro)")

            seq, asked, deadline = 0, set(), time.monotonic() + timeout
            answer: dict[str, Any] = {}
            while True:
                for event in phone.events(task_id, after_seq=seq):
                    seq = max(seq, int(event.get("seq") or 0))
                    if event.get("type") == "result":
                        answer = event.get("data") or {}
                    if event.get("type") not in REPORTED:
                        continue
                    text = describe(event)
                    if event.get("type") in ("action", "step"):  # not the goal echoed back, which says "publish"
                        log_text.append(text.lower())
                    failed = event.get("type") == "error" or (event.get("type") == "action" and (event.get("data") or {}).get("ok") is False)
                    step(f"agent:{event.get('type', 'event')}", not failed, text)
                current = phone.task(task_id)
                if current.get("status") in DONE:
                    break
                if current.get("status") == "awaiting_approval":
                    for approval in phone.approvals("pending"):
                        if approval.get("task_id") == task_id and approval.get("id") not in asked:
                            asked.add(approval.get("id"))
                            step("agent:approval-needed", True,
                                 f"{approval.get('action')}: {approval.get('reason')} — approve it in FlowAI, Phones, this phone, Agent")
                if time.monotonic() > deadline:
                    phone.cancel_task(task_id)
                    current = {"status": "cancelled", "error": f"ran past the run's {timeout} s limit"}
                    break
                time.sleep(2)

            # The JSON answer: on the task, or in its result event; the text answer as a fallback.
            result = current.get("result_data") if isinstance(current.get("result_data"), dict) else (answer.get("data") if isinstance(answer.get("data"), dict) else {})
            if not result and isinstance(answer.get("text"), str):
                try:
                    parsed = json.loads(answer["text"])
                    result = parsed if isinstance(parsed, dict) else {}
                except ValueError:
                    result = {}
            agent_note = str(result.get("note") or current.get("result_text") or answer.get("text") or current.get("error") or "").strip()
            ok = current.get("status") in FINISHED_OK and answer.get("success") is not False
            if ok and result.get("published") and result.get("confirmed_on_profile") and current.get("verified") is not False:
                outcome, note, post_url = "confirmed", f"the agent posted it and saw it on the profile: {agent_note}", result.get("post_url") or None
            elif ok and result.get("published"):
                outcome, note = "uncertain", f"the agent says it posted, but didn't see it on the profile: {agent_note}"
            elif any(word in line for line in log_text for word in SUBMIT_WORDS) and not ok:
                outcome, note = "uncertain", f"the agent stopped after it may have tapped publish ({agent_note or current.get('status')})"
            else:
                outcome, note = "failed", agent_note or f"the agent task ended {current.get('status')}"
        except HackApiError as exc:
            outcome, note = ("uncertain" if task_id else "failed"), f"hackathon phone API: {exc}"
        except ApiError as exc:
            outcome, note = ("uncertain" if task_id else "failed"), f"FlowAI: {exc}"
        except Exception as exc:  # noqa: BLE001 - one bad run must not stop the agent
            log.exception("run %s crashed", run_id)
            outcome, note = ("uncertain" if task_id else "failed"), f"{type(exc).__name__}: {exc}"

        # The screen the run ended on: the proof for a confirmed run, the context for any other.
        try:
            path = config.EVIDENCE_DIR / f"{run_id}_final_{uuid.uuid4().hex[:6]}.png"
            path.write_bytes(phone.screenshot("png"))
            api.screenshot(run_id, path)
        except Exception as exc:  # noqa: BLE001
            log.warning("final screenshot for run %s skipped: %s", run_id, exc)
            if outcome == "confirmed" and not post_url:
                outcome, note = "uncertain", f"{note}; but no screenshot could be uploaded as proof"
        finally:
            phone.close()

    api.finish(run_id, outcome, note[:480], post_url)
    log.info("run %s finished: %s — %s", run_id, outcome, note)
    return outcome
