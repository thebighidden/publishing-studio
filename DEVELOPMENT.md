# Running FlowAI locally

Two pieces: the Laravel API in Docker (`backend/`), and the React app served by Vite (`frontend/`).
You need Docker Desktop and Node. PHP is not installed on your machine; it runs in the container.

```sh
docker compose up -d     # from the repo root: API on :8000, Mailpit (email inbox) on :8025
cd frontend
npm install
npm run dev              # the app on http://localhost:5173
```

The first `docker compose up` takes a few minutes: it installs PHP dependencies, creates
`backend/.env`, an app key and the SQLite database, and runs the migrations. Later starts take seconds.

If port 5173 is taken by another project, run the app on 5174 (`npm run dev -- --port 5174`) and set
`APP_URL` and `FRONTEND_URL` in `backend/.env` to `http://localhost:5174` (it's already a trusted origin).

To post from real phones, also run the FlowAI agent on the computer they're plugged into: see
`agent/README.md`.

Open http://localhost:5173, sign up, and you land in the studio at `/dashboard`.

## Email

Every email the API sends (reset your password) lands in Mailpit: http://localhost:8025. Nothing
leaves your machine. There's no email confirmation step: new accounts, and changed addresses, count
as confirmed right away.

## Google and GitHub sign-in

The buttons work once the API has credentials. Until then they say the provider isn't switched on.

1. Create an OAuth app:
   - Google: Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application).
     Authorized redirect URI: `http://localhost:5173/oauth/google/callback`
   - GitHub: Settings → Developer settings → OAuth Apps → New OAuth App.
     Authorization callback URL: `http://localhost:5173/oauth/github/callback`
2. Put the ID and secret in `backend/.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_…`).
3. `docker compose restart api`

## AI writing

The composer on the Create page writes a post from a brief, or rewrites the one in the editor, with Claude.
It's switched off until the API has a key; until then the composer says so.

1. Create a key at https://platform.claude.com/settings/keys
2. Put it in `backend/.env` as `ANTHROPIC_API_KEY`.
3. `docker compose restart api`

Every account can use it, at up to 10 requests a minute and 200 a day per person
(`AppServiceProvider`). The models on offer are listed in `backend/config/ai.php`; the first is the default.
The prompt is in `app/Services/Ai/PostPrompt.php`.

## Images and video: Higgsfield and ComfyUI

The Studio's photo and video generators run on whichever models are set up; the Models page shows
each one, how it's reached, and why one can't run yet.

- **Higgsfield** (cloud): put `HIGGSFIELD_KEY_ID` and `HIGGSFIELD_KEY_SECRET` in `backend/.env`
  (keys from console.higgsfield.ai), `docker compose restart api worker`, then press **Test** on the
  Models page (free: it asks for a request that doesn't exist). One key unlocks the catalog in
  `config/ai.php`:

  | | Models |
  | --- | --- |
  | Photos | Soul 2, Soul (one reference), Soul Cinema, Grok Image 2 (edits up to 10 references), Ideogram 4 |
  | Video | Kling 3.0 Pro and Seedance 2.0 (text or start frame, optional end frame, sound, up to 15 s), Hailuo 2.3 (fast 768p), Wan 2.7 (from an image) |

  Each entry mirrors the model's request schema on docs.higgsfield.ai: its route (and image-to-video
  route), which aspects, lengths and resolutions it accepts, where input images go, how sound is
  switched. The registry hands these to the Studio as `caps`, so the controls only offer what the
  model takes; `HiggsfieldProvider::request()` snaps anything else to the nearest accepted value.
  A new Higgsfield model is a new entry there, no code.
- **ComfyUI** (your GPU): set `COMFYUI_URL` to a ComfyUI started with `--listen` (from Docker, one
  on this computer is `http://host.docker.internal:8188`), restart, and **Test** on the Models page.
  Workflows are exported with *Save (API Format)* into `resources/comfyui/` and listed under
  `ai.providers.comfyui.workflows`, naming the inputs the studio fills (prompt, seed, size).
  Z-Image Turbo ships ready.

Generation is queued (`RunGeneration`, then `PollGeneration` until the provider is done) on the
`media` queue, so restart the worker after changing models: `docker compose restart worker`.

### Creative Lab and Gallery

Both sit under **Create** in the sidebar and use the same generations API as the Studio.

- **Creative Lab** (`/dashboard/lab`, `pages/Lab.tsx`) is for short-form vertical video. Pick where
  the piece is going (Reels, TikTok, Shorts, Story, feed shapes), a hook template and a look, then
  make one or more takes. The preview is a phone with that app's buttons and caption on top, plus
  the safe zone. Presets (formats, looks, hooks) live in `dashboard/lab/presets.ts`.
- What the Lab saves in `params`, besides the model's own settings: `format`, `style`, and
  `base_prompt` (the prompt as typed, before the look's text was added). A remake starts from these.
- **Gallery** (`/dashboard/gallery`, `pages/Gallery.tsx`) lists every finished photo and video:
  `GET /api/generations?media=1&status=succeeded`, filtered by `kind`, `aspect` and `q` (prompt
  search), 40 at a time with `before_id`. **Remake** opens `/dashboard/lab?remake={id}`, which loads
  that generation's prompt, model, settings and input images into the Lab. **Animate** opens
  `?animate={id}`, which turns a still into a video's first frame. Removing a piece deletes the
  generation only; its file stays in Media.
- Keys in the Lab: Ctrl+Enter makes; ← → move through the session strip; R remakes, V makes another
  take, A animates a still, S shows or hides the safe zones.

## Campaign intake

Uses the same `ANTHROPIC_API_KEY` as AI writing.

Campaigns (`/dashboard/campaigns`) interview the person about their brand, product and audience, collect
reference photos, and fill in a 25-field client brief. From the finished brief Claude writes a content kit:
pillars, hooks, a two-week schedule, ready-to-make posts, image prompts built on the photos, hashtags and KPIs.
Everything is saved with the account; the brief, kit and photos can be copied or downloaded as a zip.

- **With an API key,** Claude runs the interview: it asks one question at a time, fills the brief from
  the answers, and suggests answers for anything a quick interview skips (shown with a dashed underline).
  Without one, the standard question list runs it, one field per question, and the content kit stays off.
- The brief's fields and the standard questions are in `app/Services/Intake/Brief.php`; the prompts in
  `IntakePrompt.php`; the interview logic in `Interviewer.php`. The model and effort are in `config/ai.php`.
- Photos are kept on the private disk under `storage/app/private/campaigns/` and are only served to their
  owner. The page scales them to 1568 px before upload.
- Every step that can call Claude is limited to 20 requests a minute and 300 a day per person.

To try the AI interview without spending credit, point the API at a stand-in for the Messages API: the SDK
reads `ANTHROPIC_BASE_URL`, so any server that answers `POST /v1/messages` will do.

## The publishing engine

Approved posts publish themselves. When a scheduled post's time comes on an account with
automation on, the publisher books the account's phone (one job per phone, taken with a
conditional update — never read-then-write) and drives it: copy the media over, open the
platform's app, caption in, tap Publish, then **read the screen** — sending the command is not
the same as publishing. Proof (the caption on screen, or a post URL) ends the run *confirmed*;
no proof is an honest *uncertain*; a failure waits (5/15/30 minutes, R3) and tries again, and
after the last attempt the post goes to the Inbox for a person.

- **Phones** (`/dashboard/phones`) are either the built-in **simulator** — no hardware, the whole
  loop runs, with reliable/flaky/broken profiles — or **real phones** driven by the FlowAI agent
  (`agent/`, see `agent/README.md`) on the computer they're plugged into. The agent registers them
  itself, posts photos and videos (feed, Reel, story on Instagram; posts on X), and serves each
  phone's **live screen** with remote control (the **Live** button). **Scan for devices** lists
  every USB, Wi-Fi and emulator device on the agent's computer, phones nearby with Wireless
  debugging (connect or pair), installed emulators to start, and the simulators to add. A paused
  phone starts nothing new; the **stop button** on the Publishing page pauses all of it.
- **Runs** (`/dashboard/publishing`) are one record per attempt: goal, steps with timings,
  evidence, outcome, totals (steps, wall-clock, spend). `PublishingRun::record()` is exactly the
  hand-in JSON, downloadable from the run's detail view. Averages over finished runs are on the
  same page.
- The **scheduler** (`routes/console.php`) dispatches due posts every minute and sweeps runs that
  went quiet for ten minutes (the phone is released; the run ends uncertain if it had reached
  Publish, failed otherwise). Simulator runs are queue jobs on the `publishing` queue.
- Guardrails live in `backend/config/publishing.php`: attempts and backoff (R3), step budget and
  hard timeout (R7), and each platform's app package + named targets (R6: taps go through names,
  never raw coordinates).

### The agent API (for the automation service)

The FlowAI agent (`agent/`) drives real phones over a Bearer-token API. The token is on the Phones
page (one per studio; rotate any time — the old one dies immediately). Send it as
`Authorization: Bearer …`. Everything is under `/api/agent`:

```
POST /api/agent/hello                        → {"phones": [{ref, name, model, android, width, height, kind}],
                                                 "mirror_url"?}: registers them as HTTP phones (every 30 s)
POST /api/agent/devices/{ref}/screen         → multipart "file": an idle phone's screen, for its thumbnail
GET  /api/agent/next-job?device_ref={id}     → the run booked on that phone, or 204
POST /api/agent/runs/{run_id}/steps          → {"steps": [{"action", "ok", "ms", "note"?}, …]}
POST /api/agent/runs/{run_id}/screenshot     → multipart "file" image; kept as evidence
POST /api/agent/runs/{run_id}/finish         → {"outcome": "confirmed|failed|uncertain",
                                                 "post_url"?, "note"?}
GET  /api/agent/assets/{id}/file             → the media for a job, before it starts
```

- The job payload carries the account's app package and named targets, the caption, the media
  URLs, and the run's limits (`step_budget`, `hard_timeout_seconds`) — don't guess them.
- Each `steps` call is also the run's heartbeat: a run silent for `stale_minutes` is swept.
  Exceeding the step budget is a 422 — end the run instead.
- `confirmed` needs proof: a `post_url`, or a screenshot uploaded first. `uncertain` is the
  honest answer when the command was sent but nothing confirms it. Ended runs refuse more work
  (409), and a token only ever sees its own studio's phones and runs (404 otherwise).

### The seeded demo

Sign in as **demo@flowai.test / password**: two simulator phones (one reliable, one flaky), one
HTTP phone, three accounts, and four finished runs to inspect — three confirmed, one uncertain —
with the same loop ready to run again on the next due post.

## Community, autonomy and the investigator

- **Reposts** (`/dashboard/reposts`): pick an X post, record whether reuse is allowed and *why*
  (always a person), then the AI adapts it into an Instagram caption with hashtags. The credit
  line is appended by the model class, never by the AI.
- **Comments** (`/dashboard/comments`): report comments per account; the AI triages each —
  reply (with a draft), ignore, or send to a human — and a human approves every reply before
  it's recorded as sent.
- **Autonomy** (per account, shield icon on the Accounts page): mode A asks a person for
  everything; mode B runs actions covered by an approved rule (`allow`/`deny`, `max_per_day`).
  The matrix shows every action kind, the preview what would happen to what's waiting now, and
  the Inbox is the exception queue. Enforced at AI profile changes, comment replies and repost
  scheduling; gate 6B and publishing always keep their own human gate.
- **Investigations** (`/dashboard/investigations`): collect → compare → validate → report over
  the studio's records and their evidence (a queued job, `RunInvestigation`). Findings carry
  severity and an AI verdict; the report is markdown. Three role dashboards (operator,
  investigator, studio) sit on top.
- **Voice & memory** (per account, waveform icon on the Accounts page): the editorial profile
  with approval-gated changes, and memory in three kinds (instructions, liked examples, post
  history).

## Everyday commands

```sh
docker compose exec api php artisan test        # backend tests
docker compose exec api vendor/bin/pint         # PHP code style
docker compose exec api php artisan migrate     # after adding a migration (also runs on every start)
docker compose logs -f api                      # API request log
npm run build                                   # in frontend/: type-check and build the app
docker compose down                             # stop the API and Mailpit (data is kept)
```

## How the pieces fit

- **Sessions, not tokens.** The app signs in with Laravel Sanctum's cookie-based SPA auth. Vite proxies
  `/api`, `/sanctum` and `/oauth` to the API, so the browser sees one origin and the session cookie just works.
- **The API** lives in `backend/`: auth controllers under `app/Http/Controllers/Auth`, posts, the posting
  queue (`app/Services/PostQueue.php`), overview and analytics endpoints, and AI writing (`WritingController`,
  which streams the post back as server-sent events from `app/Services/Ai`). Routes are in `routes/api.php`;
  social login is in `routes/web.php`.
- **The app** lives in `frontend/`: the landing page and auth pages are in `src/pages`, the studio is in
  `src/dashboard` (loaded as its own chunk), and the API client and session are in `src/lib`.

## What isn't connected yet

- **Calibration on your phones.** The agent's named targets were written against a reference
  Instagram/X build and its simulator. A different app version can name a button differently; the
  run then fails at that exact step with screenshots, and the target is corrected in
  `agent/flowai_agent/devices/targets.py` (or `agent/data/targets.json` for one phone).
- **Carousels.** A post with several media items isn't driven on a phone yet; it fails with a note.
- **Engagement analytics.** Reach, likes and clicks come from each network's API, so Analytics covers your own
  output only: what you wrote, planned and published, where, and when.

## Deploying

Serve the built app (`frontend/dist/`) and the API under one domain: send `/api`, `/sanctum` and `/oauth` to Laravel,
and every other path to `index.html`. Then set `APP_URL` and `FRONTEND_URL` to that domain, add it to
`SANCTUM_STATEFUL_DOMAINS`, set `SESSION_SECURE_COOKIE=true`, and point `MAIL_*` at a real mail service.

### On the VPS (http://187.6.165.236:8090)

`deploy/` holds the production stack: nginx serving the built app and passing `/api`, `/sanctum`, `/oauth` and `/up`
to Laravel under PHP-FPM, with Postgres. It runs on its own port, apart from the other sites and their Caddy.
Settings and secrets are in `deploy/.env` (git-ignored; template in `deploy/.env.example`).

```sh
git pull && docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build   # deploy / update
docker compose -p flowai logs -f app      # API log; emails are logged here until a mail service is set
docker compose -p flowai down             # stop (the database volume is kept)
```

The seeded demo account works there too: **demo@flowai.test / password** — simulator phones,
one HTTP phone, accounts and due posts; the stack's scheduler and worker publish them on their
own, and the Publishing page fills with runs. It also has a mode-B rule (comment replies, max
2/day), an adapted repost with recorded permission, comments in three states, and one
deliberate lie for the investigator (a post marked published with no proof) — run an
investigation and it catches it.

Edit `deploy/.env`, then run the `up -d --build` line again to apply it (config is cached at start).
