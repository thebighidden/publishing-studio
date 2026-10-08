# Publishing Studio

Plan a social campaign, generate the text and media, then **publish it by driving a real
Android phone** — not by calling a platform API. Every run ends with a verdict backed by
what the phone screen actually showed afterwards.

Instagram and X, via ADB (physical device or emulator).

---

## The one idea that matters

**Sending a command is not the same as publishing a post.**

A run never reports success because a tap was dispatched. It reports one of three outcomes,
and the third one exists because honesty is the point:

| Outcome | Meaning |
| --- | --- |
| `confirmed` | We looked afterwards and the post was there. |
| `failed` | The post did not go out. |
| `uncertain` | The command went through, but we could not prove the result — so we do not claim it. |

Confirmation is earned by observation: count the posts on the profile *before*, publish,
count again, open the newest post and match a distinctive token from the caption. The
screenshots and per-step log are kept as a downloadable run record.

---

## Running it

Requires Python 3.12+, Node 18+, and `adb` on PATH for real devices.

```bash
# backend  → http://127.0.0.1:8000
cd backend
python -m venv .venv && .venv/Scripts/activate      # Windows
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000 --timeout-graceful-shutdown 3

# frontend → http://127.0.0.1:5173
cd frontend
npm install
npm run dev
```

The frontend proxies `/api`, `/media` and `/evidence` to the backend; override the target
with `STUDIO_API`.

On the first visit, create the local administrator account. No phone or API key is required to
try the publishing flow: the studio falls back to a built-in simulator and offline generators,
and labels every asset `simulated`. `backend/scripts/demo.py` drives a full campaign end to end;
set `STUDIO_USERNAME` and `STUDIO_PASSWORD` in that process so it can authenticate.

### Creative studio

**Creative studio** (`/creative`) is where content is made and sent out:

- **Generate** images or video with any enabled model, each labelled local, cloud or offline. The
  controls follow the model: its formats, lengths, quality tiers, sound, reference images and
  start/end frames. Style presets, 1–4 variations, a fixed or random seed, and advanced controls
  (steps, guidance, shift, sampler, scheduler) when the model exposes them.
- **Jobs run on the server** (`/api/creative/jobs`): queue as many as you like, close the tab, come
  back to finished work. Cloud models run up to three at once, a local GPU one at a time. Busy or
  rate-limited providers are retried; a queued Higgsfield job can be stopped before it starts. A job
  cut off by a restart is marked failed, never silently re-run, because it may already have been charged.
- **✦ Improve** turns a short idea into a detailed prompt with the text model (undoable).
- **Work with results**: favourite, tag, move between **projects**, download, delete (refused while a
  post uses the file), **Remix** (load its prompt, model and seed), **More like this** (four new seeds),
  **Animate** (a video from that exact frame). Every asset keeps the settings that made it.
- **Library**: everything ever made, by project, favourites or search over prompts and captions.
- **Publish**: an Instagram-style preview, **✦ Write with AI** for the caption in the account's
  brand voice, live spec checks, then **post now** or **schedule** onto the calendar, through a phone.
  Approving there is the content approval (gate 6B) for that one post; drafts are kept on the asset.

Settings that shape it: **Studio** (defaults, style presets), **Accounts & voice** (tone, topics,
words to avoid, sign-off, default hashtags), **Publishing** (cooldown, retries, run limits, posting
hours, phone readiness) and **ComfyUI workflows** (bring your own exported workflow, see below).

### Higgsfield: one key, many models

Add **Higgsfield** under **Settings → AI providers** with a `KEY_ID:KEY_SECRET` key from
console.higgsfield.ai. That one key unlocks the studio's catalog
(`backend/app/providers/higgsfield_catalog.py`):

| Kind | Models |
| --- | --- |
| Image | Soul 2, Soul (takes a reference), Soul Cinema, Grok Image 2 (edits up to 10 references) |
| Video | Kling 3.0 Pro and Seedance 2.0 (sound, start and end frames, up to 15 s), Hailuo 2.3 (fast 768p) |

Each entry records the request fields its endpoint accepts, taken from docs.higgsfield.ai. A model
the catalog does not list still works: enter its endpoint path as the provider's model.

### ComfyUI models and workflows

Add your ComfyUI server under **Settings → AI providers** (adapter *ComfyUI server*, model
`z_image_turbo`), started with `--listen`. To use another workflow, export it from ComfyUI with
**Save (API Format)**, add it under **Settings → ComfyUI workflows**, confirm which inputs hold the
prompt, seed and size (the studio suggests them), and press **Use in studio**.

### Gemini images and Veo video

The studio works immediately with the offline image renderer and real local MP4 encoder. To use the
Google path, open **Settings → AI providers → Add provider**:

1. Add **Google Gemini + Veo (Aluna workflow)** as the default image provider. A Gemini API key is
   sufficient, or use a Google Cloud project with Application Default Credentials.
2. Add it again as the default video provider. Veo uses Vertex AI, so enter the Google Cloud project,
   Veo location (normally `us-central1`), and a `gs://...` output path. Authenticate with Application
   Default Credentials or paste a service-account JSON document into the encrypted credential field.
3. Use **Test** on each provider before generating. Stored credentials are encrypted and are never
   returned to the browser.

The defaults mirror Aluna: `gemini-3.1-flash-image` for images and
`veo-3.1-fast-generate-001` for video. Both model fields remain editable as Google releases newer
versions.

### Connecting a real device

Enable Developer options → USB debugging, plug in, accept the debugging prompt, then
**Settings → Phones → Rescan**. An emulator works too (use a *Play Store* system image, since
Instagram and X need Play Services). Sign in to the apps **by hand on the device** — see
Authentication below.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `STUDIO_ADB` | auto-detected | Path to `adb.exe` |
| `STUDIO_DATA_DIR` | `backend/app/data` | DB, media, evidence, Fernet key |
| `STUDIO_RUN_TIMEOUT` | `300` | Hard wall clock per run |
| `STUDIO_RUN_STEP_BUDGET` | `60` | Max device actions per run |
| `STUDIO_ACCOUNT_COOLDOWN` | `90` | Min seconds between publishes on one account |

---

## Layout

```
backend/app/
  devices/      adb.py · simulator.py · targets.py   device drivers, named-target resolution
  publishing/   runner.py · scheduler.py · recipes/  the publish loop and per-platform steps
  agents/       pipeline.py · specs.py               campaign generation, platform rules
  providers/    google_genai · higgsfield · ...      pluggable image/video/text models
  api/          FastAPI routers
frontend/src/
  pages/        Dashboard · CreativeLab · Campaigns · Calendar · Runs · Settings
  ui.jsx        shared primitives (Tag, Modal, Banner, Empty)
  styles.css    all styling — plain CSS, no framework
```

Plain JSX throughout, deliberately — no TypeScript.

---

## Invariants — please do not "simplify" these away

These look like friction and are actually the product:

1. **Never swap the device layer for a platform API.** Driving the real app is the point.
2. **Never report success without observational evidence.** If it cannot be proven, it is
   `uncertain`.
3. **Taps resolve named targets, never raw coordinates** (`devices/targets.py`), and land on a
   randomised point inside the matched element.
4. **Two approval gates.** 6A on the plan, 6B on the content. Editing the underlying material
   revokes the gate automatically. A post failing its platform spec check cannot pass 6B.
5. **One job at a time per phone** (`Phone.busy_run_id`), and a per-account cooldown. No tight
   posting loops.
6. **Hard timeout and step budget on every run.** An unbounded loop on a logged-in account is
   the worst failure available.

---

## Authentication and secrets

The first browser visit creates a local administrator account. Passwords are stored as salted
PBKDF2-SHA256 hashes; authenticated sessions use encrypted, HttpOnly, SameSite cookies and expire
after seven days. The Security settings screen can rotate the password and invalidate other
sessions. All API, media and evidence routes are protected after setup.

For the social accounts, the design is deliberate and worth preserving:

- **The studio never stores a social password and never types credentials.** You sign in once,
  by hand, on the device.
- `POST /api/accounts/{id}/check-login` verifies a session by **reading the screen** — it opens
  the app and looks for signed-in UI — rather than assuming.
- Provider API keys (Higgsfield etc.) *are* stored, encrypted with Fernet. The key lives in
  `STUDIO_DATA_DIR/secret.key`, which is gitignored. Keys are masked on read and never sent
  back to the browser.

The interface also includes persistent light/dark themes, an authenticated live notification
center, and a device console for viewing and controlling simulator or ADB-connected phones.

---

## Status

Built as a hackathon MVP. The full loop is verified end to end against the built-in simulator:
campaign → plan → gate 6A → generated posts → gate 6B → schedule → publish → `confirmed`, plus
the `failed` path rolling a post back for retry and releasing the device booking.

The **device layer is separately verified against real hardware**. From `backend/`:

```bash
python -m scripts.device_check emulator-5554
```

This exercises all ten `DeviceDriver` capabilities through the studio's own `AdbDriver` — so a
pass means the code the publisher depends on works on that device, not that raw `adb` does.
Currently 9/9 on an Android 15 emulator.

> One hard-won rule it encodes: **never sleep and then type.** `adb shell input text` delivers
> to whatever holds focus, and with nothing focused the keystrokes are discarded *silently*.
> That publishes an empty caption, which still grows the profile grid — so it survives to
> verification and surfaces only as a baffling token mismatch. `RunContext.type_into()` waits
> for an observed focused field, types, then reads the text back. The simulator models this
> too, so it can actually fail on a lost caption.

**Known gap:** the named targets in `publishing/recipes/` were written against the simulator.
Real Instagram and X builds use different resource IDs, so the first run on a physical device
will likely fail on an unresolved target. That surfaces as a `failed` outcome naming the exact
step — which is the signal to correct the target list, not a crash.
