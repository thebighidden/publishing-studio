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
python -m uvicorn app.main:app --reload --port 8000

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

### Creative Lab: Gemini images and Veo video

**Creative Lab** is a standalone image/video test surface inspired by Aluna's production flow.
Upload a product reference, describe the new scene, and the studio adds a strict identity direction:
change the world around the product without changing its shape, materials, colors, packaging, logos,
labels, or visible text. For video, the studio can first art-direct a clean opening frame with the
selected image model and then animate that frame with the selected video model.

The lab works immediately with the offline image renderer and real local MP4 encoder. To use the
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
