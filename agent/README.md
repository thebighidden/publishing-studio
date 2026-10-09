# FlowAI phone agent

The agent runs on the computer your Android phones are plugged into. It:

- registers the phones with FlowAI, so they appear on **Dashboard → Phones** on their own;
- picks up each phone's publishing jobs from FlowAI's agent API and drives Instagram or X on
  the phone, through named targets only (R6), within the job's step budget and timeout (R7);
- reports every step as it happens, uploads the screenshots that prove what happened, and ends
  each run **confirmed** (the post is on the profile, with our caption), **failed**, or
  **uncertain** (publish was tapped but nothing confirms it, so it is never re-posted blind);
- serves each phone's **live screen** with remote control, opened from the Phones page.

Posts can be a photo or a video, as a feed post, a Reel or a story (Instagram), or a post (X).
Carousels (several media in one post) are not driven yet; such a run fails with a clear note.

## Set up (once)

Python 3.11+ and Android platform-tools (`adb`) are needed. On Windows:

```powershell
cd agent
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env      # then paste the agent token into it
```

The token is on **Dashboard → Phones → The automation service** (Show → Copy). Put it in
`agent/.env` as `FLOWAI_AGENT_TOKEN=…`. If FlowAI isn't on `http://localhost:8000`, set `FLOWAI_URL`.

`adb` is found on PATH, in `C:\platform-tools`, or in the Android SDK; otherwise set `FLOWAI_ADB`.

## Connect a phone

1. On the phone: **Settings → About phone → tap Build number 7 times**, then
   **Settings → Developer options → USB debugging** on.
2. Plug it in with USB and accept **Allow USB debugging** on the phone (tick "Always allow").
3. Sign in to Instagram (and/or X) **on the phone, by hand**. The agent never types passwords.
4. Check it and prepare it:

   ```powershell
   .venv\Scripts\python -m flowai_agent phones            # lists phones and what they still need
   .venv\Scripts\python -m flowai_agent prepare SERIAL    # animations off, Gboard as keyboard
   ```

   Animations off lets the agent read a still screen; Gboard makes sure typed captions arrive.

Wireless instead of USB (Android 11+): Developer options → **Wireless debugging** → *Pair device
with pairing code*, then

```powershell
.venv\Scripts\python -m flowai_agent connect 192.168.1.42:41235 123456 37099
#                                             connect address    code   pairing port
```

## Run

```powershell
.venv\Scripts\python -m flowai_agent
```

Within 30 seconds the phone appears on the Phones page, online, named after its model. Then in
FlowAI: **Accounts** → the Instagram/X account → link it to that phone and turn **automation** on.
Approved, scheduled posts on that account now publish from the phone by themselves; the run, its
steps and screenshots are on the **Publishing** page.

Keep the agent running while you want phones to post. It notices phones being plugged in or out.

## Scan for devices

**Phones → Scan for devices** in FlowAI asks the agent what this computer can drive, and what each
device still needs:

- **Connected:** USB phones, phones on Wi-Fi and running emulators, each one ready, waiting for
  you to tap *Allow USB debugging*, or offline. Ready devices join FlowAI on their own within seconds.
- **On this Wi-Fi:** phones with Wireless debugging on. A phone paired before connects in one tap;
  a new one is paired with the 6-digit code it shows (Wireless debugging → *Pair device with pairing code*).
- **Android emulators:** devices created in Android Studio, started with one tap. Use a Google
  Play system image so Instagram and X can be installed. `FLOWAI_EMULATOR` can point at `emulator.exe`.
- **Simulators:** add FlowAI's built-in simulator, or switch the agent's virtual phone on or off.

The same list in a terminal: `.venv\Scripts\python -m flowai_agent scan`.

## Live view

On the Phones page, **Live** opens the phone's screen. Tap or drag on it, use Back / Home / Apps,
or type into the focused field. The view is served by the agent at `http://localhost:8765` and
needs the agent token, so only the studio's own dashboard can open it.

- Install **scrcpy** (`winget install Genymobile.scrcpy`) for a smooth stream (up to 24 fps);
  without it the view falls back to screenshots (about 2 per second). `FLOWAI_SCRCPY` can point
  at its folder.
- While a post is publishing you can watch, but the agent refuses taps until the run ends.
- If the browser isn't on the agent's computer, set `FLOWAI_MIRROR_HOST=0.0.0.0` and
  `FLOWAI_MIRROR_URL=http://<this computer's address>:8765`.

## Try it without a phone

```powershell
$env:FLOWAI_SIMULATED_PHONES = "sim-1"
.venv\Scripts\python -m flowai_agent
```

A simulated phone (`sim-1`) registers alongside any real ones. It renders real screens and
accepts the same named-target taps, so the whole loop — job, transfer, Instagram, caption,
share, verify, proof — runs and shows up in FlowAI exactly like a real phone's.

## Settings (`agent/.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `FLOWAI_URL` | `http://localhost:8000` | FlowAI's API |
| `FLOWAI_AGENT_TOKEN` | — | From the Phones page; required |
| `FLOWAI_ADB` | found automatically | Path to `adb.exe` |
| `FLOWAI_SCRCPY` | found automatically | Folder holding `scrcpy.exe` and `scrcpy-server` |
| `FLOWAI_MIRROR_HOST` / `FLOWAI_MIRROR_PORT` | `127.0.0.1` / `8765` | Where the live view listens |
| `FLOWAI_MIRROR_URL` | `http://localhost:8765` | The address the dashboard uses for it |
| `FLOWAI_SIMULATED_PHONES` | — | e.g. `sim-1`, for trying the loop without hardware |
| `FLOWAI_POLL_SECONDS` | `5` | How often each phone asks for a job |
| `FLOWAI_HELLO_SECONDS` | `30` | How often phones are re-registered (plugged in/out) |
| `FLOWAI_IDLE_SCREEN_SECONDS` | `60` | Idle screen thumbnail for the Phones page (0: off) |

## When a run doesn't confirm

- **failed: … not found on screen** — a named target didn't match this Instagram/X version. The
  run's screenshots show where it stopped. Targets live in `flowai_agent/devices/targets.py`;
  overrides for one phone can go in `agent/data/targets.json` without touching code.
- **uncertain** — Publish was tapped, but the profile couldn't prove the post (e.g. a video
  still processing). Check the account, then use **Confirm live** or **Try again** in the Inbox.
- **typed … but the field is still empty** — the keyboard dropped the caption; run `prepare`.
- Emoji and accented letters can't be typed through adb and are dropped from captions.

## Layout

```
flowai_agent/
  __main__.py    CLI: run, phones, prepare, connect, screenshot
  api.py         FlowAI's agent API (hello, next-job, steps, screenshot, finish, assets, screen)
  worker.py      one thread per phone: job → recipe → steps, proof, honest outcome
  mirror.py      the live view and remote control
  devices/       adb driver, named targets, scrcpy stream, simulator
  publishing/    the run context (budget, timing, step log) and the Instagram/X recipes
```
