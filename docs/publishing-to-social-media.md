# Controlling the App to Post to Social Media

This guide covers how Publishing Studio is driven to actually publish — from a campaign
brief to a post on a live account — and, more importantly, **how a result is proven rather
than assumed**.

Supported platforms today: **Instagram** (`com.instagram.android`) and
**X** (`com.twitter.android`), both driven through the real mobile app on a real phone.

Prerequisite: a phone attached and an account signed in. See
**[Connecting and monitoring a phone](connecting-and-monitoring-a-phone.md)**.

---

## 0. The one idea that matters

> **Sending a command is not the same as publishing a post.**

A tap being dispatched proves nothing. The phone may have been on the wrong screen, the
upload may have stalled, the caption may have been swallowed by an unfocused field. So
every run ends in one of three verdicts — and the third one exists because honesty is the
product:

| Outcome | Meaning |
| --- | --- |
| `confirmed` | We looked afterwards and the post was there. |
| `failed` | The post did not go out. |
| `uncertain` | The command went through, but we could not prove the result — so we do not claim it. |

`uncertain` is not a cop-out. It is the correct answer when the command was sent and the
result could not be confirmed. Critically, **`uncertain` is never retried automatically** —
re-running a post that may already be live is how an account ends up double-posting.

Everything below exists to make that verdict trustworthy.

---

## 1. The publishing pipeline end to end

```
brief → plan → ▣ gate 6A → produce → ▣ gate 6B → schedule → publish → verify → verdict
```

Two human approval gates, and neither can be bypassed by the automation.

### Step 1 — Create the campaign

**Campaigns → New campaign.** The brief is the input to everything downstream:

| Field | Purpose |
| --- | --- |
| Goal | What the campaign is for |
| Audience | Who it speaks to |
| Message | The one thing to land |
| Key facts | Concrete details the writer must not invent around |
| Accounts | Which handles this campaign posts to |
| Deadline | Optional |

```
POST /api/campaigns
```

### Step 2 — Plan

```
POST /api/campaigns/{id}/plan   { "item_count": 3 }
```

The writer agent returns a plan of items — angle, title, intent — one per piece of content.
Each account's `editorial_profile.tone` is fed in, so a plan for `@studio.test` on
Instagram and `@studio_test` on X reads differently.

The campaign moves to `plan_review` and `plan_approved_at` is cleared.

### Step 3 — Gate 6A: approve the plan

```
POST /api/campaigns/{id}/approve-plan
```

Production is the expensive step — image and video generation — so a human confirms the
plan is right *before* any of it is spent. `produce` refuses to start otherwise:

```
409  the plan has not been approved (gate 6A)
```

### Step 4 — Produce

```
POST /api/campaigns/{id}/produce
```

For each plan item and each attached account, the studio generates the caption, the
hashtags and the media, then runs a **platform spec check** and stores the report on the
post.

One bad item never sinks the batch — it is caught, reported as `campaign.item_failed`, and
the rest continue.

The campaign moves to `content_review` and `content_approved_at` is cleared.

#### The spec check

`backend/app/agents/specs.py` encodes what each placement actually accepts:

| Platform / placement | Aspects | Media | Caption max | Duration | Hashtags |
| --- | --- | --- | --- | --- | --- |
| Instagram feed | 1:1, 4:5 | image, video | 2200 | 3–60 s | 30 |
| Instagram Reel | 9:16 | **video only** | 2200 | 3–90 s | 30 |
| Instagram story | 9:16 | image, video | caption is burned in, not typed | 1–60 s | 30 |
| X post | 16:9, 1:1, 4:5 | image, video | **280** incl. hashtags and links | 0.5–140 s | **3** |

The report separates **issues** (hard blockers) from **warnings** (stylistic):

```json
{
  "ok": true,
  "placement": "Instagram feed",
  "issues": [],
  "warnings": ["12 hashtags, more than the 3 that read well here"],
  "details": { "caption_chars": 184, "caption_max": 2200, "aspect": "1:1" }
}
```

Caption length counts hashtags too. Aspect ratio is snapped to the nearest known ratio, so
the message is useful: `media is 1024x1024 (~1:1); Instagram Reel expects 9:16`.

### Step 5 — Gate 6B: approve the content

```
POST /api/campaigns/{id}/approve-content
```

**Nothing publishes automatically without passing this.** And a post that fails its spec
check *cannot* be approved:

```
409  2 post(s) fail their platform spec and cannot be approved: Proof (@studio.test), …
```

Approved posts get `approved_at` set and move to status `approved`.

#### Gates revoke themselves when the material changes

This is the part that makes the gates mean something rather than decorate the UI.

Editing a campaign's `goal`, `audience`, `message`, `key_facts`, `plan` or `account_ids`
clears `plan_approved_at` — the approval was given for the old version.

Editing a post's `caption`, `hashtags`, `media_id` or `placement`:

- clears that post's `approved_at`
- drops it from `approved`/`scheduled` back to `draft`
- clears the **campaign's** `content_approved_at` and returns it to `content_review`
- re-runs the spec check

Regenerating a post does the same. You cannot quietly change what gets published after
someone approved it.

### Step 6 — Schedule

Either place posts by hand:

```
POST /api/campaigns/{id}/schedule
{ "items": [ { "post_id": "...", "scheduled_at": "2026-10-07T14:00:00Z", "tz": "Europe/Paris" } ] }
```

Any post in that list without `approved_at` is refused with `409 … has not passed gate 6B`.

Or spread them automatically:

```
POST /api/campaigns/{id}/auto-schedule
{ "start_at": "2026-10-07T14:00:00Z", "spacing_minutes": 20, "tz": "Europe/Paris" }
```

Auto-schedule only considers approved posts, and **posts on the same account are forced
apart by at least the spacing** — which is how the no-tight-loops rule stays true even
when a human asks for everything at once. Times are stored UTC-naive with the display
timezone kept alongside.

### Step 7 — Publish

Two ways in.

**The scheduler** (`backend/app/publishing/scheduler.py`) — one worker thread, ticking
every `STUDIO_SCHEDULER_TICK` seconds (default 10). Each tick it selects posts that are
`scheduled` with `scheduled_at <= now`, then skips any post that:

- has no `approved_at` (gate 6B)
- has no account, or an account with no linked phone
- targets a phone that is `busy_run_id`, already claimed this tick, or already has a live
  worker

It dispatches **at most one job per phone per tick**, which is what keeps the
one-job-per-phone rule true with no locking beyond the booking flag.

**Publish now** — operator-triggered, from the post or the calendar:

```
POST /api/runs/publish-now?post_id=...
→ 202 { "started": true, "post_id": "..." }
```

The guards run synchronously so a refusal is immediate and explained, then the run itself
moves to a worker thread — a publish takes minutes, and the step feed is what you watch.

### Shortcut: publishing straight from Creative Lab

Generate an image in **Creative Lab**, write a caption, press **Post**:

```
POST /api/creative/assets/{asset_id}/publish
```

This skips the campaign machinery, because the operator looking at the image and the
caption *is* the human approval — so the post is created already `approved` with
`approved_at` set. **Everything after that is the normal path**: spec check, the runner's
full preflight, phone booking, cooldown, and a run whose outcome still needs evidence.

Two refusals worth knowing:

```
409  this is an offline placeholder, not real content; generate it with a real provider first
422  media is 1024x1024 (~1:1); X post expects 16:9 or 1:1 or 4:5
```

The first one matters: assets produced by the offline fallback generators are labelled
`simulated`, and the studio **will not post a placeholder to a live account**. The guards
are also checked *before* the post is saved, so a refusal leaves nothing behind in the
database.

---

## 2. What happens during a run

`backend/app/publishing/runner.py` → `execute()`.

### Preflight: everything that must be true before the phone is touched

```python
post.status in (scheduled, approved)      # else: "post is draft, not scheduled"
post.approved_at is not None              # else: "content has not passed approval gate 6B"
account exists
account.phone_id                          # else: "@handle is not linked to a phone"
phone exists
not phone.busy_run_id                     # else: "phone Sim phone B is busy with run ca737c0f"
account cooldown elapsed                  # else: "@handle published 31s ago; cooling down for 90s"
```

A refusal here is a `NotPublishable`, and it is **never retried automatically**. From
`publish-now` it surfaces as a `409` with the exact reason. From the scheduler the post
goes back to `approved` — back to the operator — and emits `run.blocked`.

### Booking

The phone is booked **before anything else**:

```python
phone.busy_run_id = run.id
post.status = PostStatus.publishing
post.attempts += 1
```

From this moment, every manual control route on that phone returns 409. The live view stays
available, because watching cannot interfere.

### Media transfer

If the post has media, the file is pushed **before the app opens**, so the gallery picker
sees it as the newest item in the camera roll:

```python
payload.media_path = ctx.push_media(str(local))
```

`push_media` copies to `/sdcard/DCIM/Camera/studio_<hex>.<ext>` and then makes it visible
to the picker — MediaStore `scan_file` first (Android 10+), legacy
`MEDIA_SCANNER_SCAN_FILE` broadcast second.

### The recipe contract

Every platform implements three methods (`publishing/recipes/base.py`):

```python
baseline(ctx)                     -> dict    # look before
publish(ctx, payload)             -> None    # do the thing
verify(ctx, payload, baseline)    -> Evidence # look after, and judge
```

`baseline` **before** `publish` is not ceremony. Without a before-count there is no delta,
and without a delta there is no evidence.

---

## 3. Instagram, step by step

`publishing/recipes/instagram.py`

### baseline

1. Start `com.instagram.android`, accept any permission dialog.
2. Tap `instagram.profile_tab`.
3. Read the post count.

The count prefers the profile header's **"N posts" label** over counting grid tiles, and
the reason is instructive: counting tiles only ever sees the ~9 that fit on screen, so
before and after come out identical **even when the post really went out** — a false
`failed`. If the label cannot be read it falls back to tiles and records which method was
used:

```python
n = labelled_count(ctx, "instagram.post_count")
if n >= 0:
    return n, "header label"
return count_on_screen(ctx, "instagram.first_profile_post"), "visible grid tiles"
```

4. Screenshot `profile-before`.

### publish

1. Refuse immediately if there is no media — `PublishFailed("Instagram needs an image or
   video", retryable=False)`. Instagram has no text-only post; retrying cannot help.
2. Tap `instagram.home_tab`, then `instagram.new_post`.
3. For a Reel or story, tap the placement selector.
4. Wait up to 15 s for `instagram.gallery_first_item`. If it never appears:
   `gallery never appeared; the picker may need permission`.
5. Tap the first gallery item — the file pushed moments ago.
6. Tap `instagram.next`. Some builds show a filter screen first and some go straight to
   the caption, so a **second** Next is tapped only if the caption field is not up yet.
   Still no caption screen after 12 s → `never reached the caption screen`.
7. `type_into("instagram.caption_field", payload.full_caption())` — see
   [§5](#5-the-caption-trap) for why this is its own method.
8. `KEYCODE_BACK` to dismiss the keyboard so Share is reachable.
9. Screenshot `before-share`, then tap `instagram.share`.
10. Wait 6 s for the upload. **This wait is not proof of anything** — `verify` decides.

### verify

1. Return to the profile and re-read the count.
2. If either count is unreadable → `confirmed: false, kind: "none"` → outcome
   **`uncertain`**: *"could not read the profile grid, so the post can be neither confirmed
   nor ruled out."*
3. If the count did not grow → **`failed`**: *"profile still shows N posts; nothing was
   added."*
4. The count grew. Open the newest post and look for a **distinctive token** from our own
   caption in the screen's text.

That last step is what makes this hard to fool. A stray notification, an unrelated upload,
or a caption lost to an unfocused field would all grow the grid — but none of them carry
our words.

The evidence that comes back:

```json
{
  "profile_posts_before": 0,
  "profile_posts_after": 1,
  "counted_by": "visible grid tiles",
  "grid_grew": true,
  "token": "operational",
  "caption_matched": true,
  "post_url": "https://instagram.com/p/b6734745c67"
}
```

If the token matched → `confirmed`, note *"grid grew by one and the new post carries our
caption."*

If it did not → still `confirmed` (the grid did grow) but honestly downgraded: *"grid grew
by one, but the caption could not be read back, so the match is positional rather than
textual."*

### About `post_url`

The simulator knows the canonical URL because it *is* the platform. A real phone does not
expose one, **and we do not invent it** — `_published_url()` returns `""` and the evidence
kind falls back to `profile_delta`.

---

## 4. X, step by step

`publishing/recipes/x.py`

### baseline

Start `com.twitter.android`, tap `x.profile_tab`, count `x.first_timeline_post`,
screenshot.

### publish

1. Build the caption. If it exceeds **280 characters** it is trimmed to fit and the trim is
   logged as a step — not silently truncated:
   `caption was 319 chars, over the 280 limit; trimmed to fit`
2. Tap `x.compose`; fail with `composer never opened` if the field does not appear in 12 s.
3. `type_into("x.compose_field", text)`.
4. If there is media: tap `x.add_media`, pick the first gallery item, confirm with
   `x.media_add_button`. **If the gallery does not open, the run does not fail** — the text
   still posts, and that is recorded as a non-ok step: *"gallery did not open; posting
   without media."* Unlike Instagram, X has a real text-only post.
5. Screenshot `before-post`, tap `x.post_button`, wait 5 s.

### verify

On X the caption is visible **right on the profile timeline**, so reading our own words
there is the strongest signal available — and it is checked *first*:

1. `caption_matched` → `confirmed`: *"our caption is visible on the account timeline."*
2. Else timeline grew → `confirmed`, downgraded: *"timeline grew by one, though the text
   could not be read back."*
3. Else counts unreadable → **`uncertain`**.
4. Else → **`failed`**: *"timeline still shows N posts; nothing was added."*

---

## 5. The caption trap

The single nastiest bug class in this system, and worth understanding before you trust any
run.

`adb shell input text` delivers to **whatever holds keyboard focus**. With nothing focused,
the keystrokes are **discarded silently** — no error, no non-zero exit.

The consequence is genuinely dangerous: you publish an **empty caption**, which still grows
the profile grid, so it sails through the count check and surfaces only as a baffling token
mismatch at the very last step.

So: **never sleep and then type.** `RunContext.type_into()` taps the field, polls until a
focused field is actually **observed**, types, then **reads the text back**.

Instagram 448 complicates this further by leaving its caption field out of the UI dump
entirely, so focus cannot be read from the hierarchy at all. The fallback is the input
method service (`dumpsys input_method`), trusted **only** when `mInputShown=true` and the
served field belongs to the app in front.

The simulator models all of this, so it can genuinely fail on a lost caption — which is the
only reason the safeguard can be tested without hardware.

Also note `type_text` returns what actually landed. `adb input` carries ASCII only, so
emoji and accents are **dropped rather than silently mangled**, and the step log records
the difference.

---

## 6. The verdict, and what happens next

```python
def _decide(evidence, error):
    if evidence and evidence.confirmed:          return confirmed, evidence.note
    if evidence and not evidence.confirmed:
        if evidence.kind == "none":              return uncertain, evidence.note
        return failed, evidence.note
    if error and _reached_submit(error):         return uncertain, "failed after submitting; could not check the account"
    return failed, error or "run failed before submitting"
```

That middle branch matters. If the run broke *before* it could look, whether the post went
out depends on how far it got — and **once Share was tapped, we genuinely do not know**. A
budget or timeout error is treated as possibly-published, so it becomes `uncertain` rather
than a guess in either direction.

### Post state after the run

| Outcome | Post becomes | Side effects |
| --- | --- | --- |
| `confirmed` | `published` | `published_at`, `post_url`, `account.last_published_at` set (starts the cooldown) |
| `uncertain` | `uncertain` | **Never auto-retried.** Needs a human to look. |
| `failed`, retryable, attempts < 3 | `scheduled` | Re-queued with backoff: **60 s**, then **180 s** |
| `failed`, not retryable or out of attempts | `failed` | Stops. `last_error` explains why. |

The phone booking is released in every case: `phone.busy_run_id = None`.

A run can never take the server down — the catch-all handler records the exception type and
emits the last 1500 characters of the traceback as a `run.trace` event.

---

## 7. Safety limits you cannot turn off from the UI

| Rule | Mechanism | Default |
| --- | --- | --- |
| One job at a time per phone | `Phone.busy_run_id`, booked before the first device call | — |
| Per-account cooldown | checked in `preflight`, enforced again by auto-schedule spacing | 90 s |
| Hard wall clock per run | `RunContext` timeout | 300 s |
| Step budget per run | `RunContext` step budget → `BudgetExceeded` | 60 actions |
| Max attempts per post | `MAX_ATTEMPTS` | 3 |
| Named targets only | `devices/targets.py`; coordinate control lives outside `DeviceDriver` | — |
| Gate 6B before any automatic publish | `preflight` **and** the scheduler loop | — |

> An unbounded loop on a logged-in account is the worst failure available. The step budget
> and wall clock exist for that single reason, and a run stopped by its own budget is
> reported as `uncertain`, not `failed`.

### The global stop button

```
POST /api/system/scheduler/pause   { "paused": true, "reason": "demo over" }
```

**In-flight runs finish; nothing new is dispatched.** While paused, `publish-now` and the
Creative Lab quick-post both refuse with `409 publishing is paused; resume it first`. The
flag is persisted in the `Setting` table, so it survives a restart. Live state from
`GET /api/system/scheduler`:

```json
{ "running": true, "paused": false, "tick_seconds": 10, "active_jobs": 1, "last_tick_at": 1760000000.0 }
```

---

## 8. Watching and auditing a run

### Live

Every device action is written to `RunStep` **and** emitted over the authenticated
notification websocket as it happens: `run.started` → `run.step` × N → `run.finished`.
The **Publishing runs** screen shows the feed, with per-step duration and inline
screenshots.

Open the phone's **device console** alongside it to watch the actual screen while the run
drives it. The live view stays available even though the controls are locked out.

### After the fact

```
GET /api/runs                      # recent runs
GET /api/runs/{id}                 # with full step list
GET /api/runs/{id}/record          # the hand-in artefact
```

`/record` is one self-contained JSON object per run — goal, account, platform, timestamps,
outcome, the full evidence block with checks and screenshot paths, every step with its
duration and ok flag, totals, and the error if any. Screenshots live under
`STUDIO_DATA_DIR/evidence/` and are served from `/evidence/` behind the same auth.

A real `confirmed` run looks like this:

```
-> @studio.test Proof
   outcome:  CONFIRMED  (published)
   evidence: post_url — grid grew by one and the new post carries our caption
   ref:      https://instagram.com/p/b6734745c67
   checks:   {'profile_posts_before': 0, 'profile_posts_after': 1,
              'counted_by': 'visible grid tiles', 'grid_grew': True,
              'token': 'operational', 'caption_matched': True}
   totals:   {'steps': 25, 'wall_clock_ms': 26952, 'failed_steps': 0}
   steps:    25/25 ok, 4 screenshots
```

And a refusal is just as legible:

```
-> @studio_test Proof
   refused:  phone Sim phone B is busy with run ca737c0f9c91
   waiting for the scheduler to take it instead
```

---

## 9. Adding another platform

The device layer, the gates, the scheduler, the budgets and the evidence model are all
platform-agnostic. A new platform is one file.

1. Add the platform to the `Platform` enum.
2. Add its placement rules to `SPECS` in `agents/specs.py`.
3. Add named targets under a new prefix in `devices/targets.py` — with fallbacks, because
   app ids churn between releases.
4. Write `recipes/<platform>.py` subclassing `Recipe` with `platform`, `package`,
   `home_target`, and `baseline` / `publish` / `verify`.
5. Register it in `runner.recipe_for()` and `accounts._RECIPES`.

**The hard part is always `verify`, and that is the point.** Ask: *what can I observe on
this phone, after the fact, that an unrelated event could not have produced?* A count that
grew is weak on its own. A count that grew **plus our own words read back off the screen**
is strong. If neither is available, the honest answer is `uncertain`.

### The rule that must survive

> **Never swap the device layer for a platform API.**

Driving the real app is the entire premise. An API call would be easier, faster and
unverifiable in exactly the way this system exists to refuse.

---

## 10. Current state and known gaps

**Verified end to end against the built-in simulator:** campaign → plan → 6A → posts →
6B → schedule → publish → `confirmed`, plus the `failed` path rolling a post back for retry
and releasing the device booking.

**Verified separately against real hardware:** the device layer, 9/9 capabilities through
the studio's own `AdbDriver` on an Android 15 emulator
(`python -m scripts.device_check <serial>`).

**Known gap:** the named targets were largely written against the simulator and then
calibrated against specific real builds — Instagram 450.0.0.50.77 on Android 15, and
Instagram 448.0.0.52.84 on a Pixel 7a. A different app version will likely fail on an
unresolved target. That surfaces as a **`failed` outcome naming the exact step**, which is
the signal to recalibrate `targets.json` from the device console — not a crash.

The `instagram.post_count` header-label path is still unverified on a real device; runs so
far fell back to `visible grid tiles`.

---

## 11. Troubleshooting

| Message | Meaning | Fix |
| --- | --- | --- |
| `content has not passed approval gate 6B` | not approved, or an edit revoked it | re-approve the content |
| `N post(s) fail their platform spec` | aspect, length or media kind is wrong | fix the post, or change the placement |
| `@handle is not linked to a phone` | account has no phone | link it under Accounts |
| `@handle published 31s ago; cooling down for 90s` | per-account cooldown | wait, or raise `STUDIO_ACCOUNT_COOLDOWN` |
| `phone X is busy with run Y` | one job per phone | wait, or let the scheduler pick it up |
| `publishing is paused; resume it first` | global stop is on | resume in settings |
| `Instagram needs an image or video` | no media on an Instagram post | attach media (not retryable) |
| `gallery never appeared; the picker may need permission` | media permission not granted | grant it by hand once on the device |
| `never reached the caption screen` | `instagram.next` resolved to the wrong control | recalibrate `instagram.next` from the console |
| `run stopped by its own budget` | hit 60 steps or 300 s | reported `uncertain`; check the account by hand |
| `TargetNotFound` on any step | app version renamed its ids | read the real UI tree, add a selector to `targets.json` |
| `caption_matched: false` but confirmed | post went out, text unreadable | check the caption really landed — this is the empty-caption signature |
| outcome `uncertain` | genuinely unknown | **look at the account yourself** before re-publishing |

---

## Related

- **[Connecting and monitoring a phone](connecting-and-monitoring-a-phone.md)** — USB,
  Wi-Fi, the device console, and recalibrating named targets.
