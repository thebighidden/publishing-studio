# Connecting and Monitoring a Phone

Publishing Studio publishes by **driving a real Android phone**, so the phone is the
single most important dependency in the system. This guide covers the three ways to
attach one — USB, Wi-Fi, emulator — and how to watch and control it from inside the app.

Everything here is handled by `backend/app/devices/` and surfaced in the UI under
**Studio settings → Phones**.

---

## 0. What a "phone" is to the studio

| Driver | What it is | When to use it |
| --- | --- | --- |
| `adb` | A real device or an Android emulator, reached through `adb` | Real publishing |
| `simulator` | A built-in fake phone that models screens, focus and a keyboard | Demos, tests, and development with no hardware |

The simulator is not a stub for convenience — it models the failure modes that matter,
including a caption silently lost because nothing had keyboard focus. You can run the
entire campaign → publish → verify loop on it.

Both drivers implement the same ten-capability `DeviceDriver` contract
(`backend/app/devices/base.py`), so **nothing above the device layer knows or cares which
one it is talking to.**

---

## 1. Prerequisites

### `adb` must be reachable

The studio looks for `adb` in this order (`backend/app/config.py`):

1. `STUDIO_ADB` environment variable, if set
2. `adb` on `PATH`
3. Known install locations:
   - `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`
   - `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Google.PlatformTools_…\platform-tools\adb.exe`
   - `$ANDROID_HOME/platform-tools/adb.exe`
   - `~/Android/Sdk/platform-tools/adb`
   - `/usr/local/bin/adb`

That fallback list exists for a real reason: a long-running server keeps the `PATH` it was
started with, so installing platform-tools *after* launching the backend leaves `adb`
invisible to it. The studio looks in the usual places rather than making you restart.

If `adb` still cannot be found, every device call fails with a clear message rather than a
stack trace:

```
adb not found at 'adb'. Install Android platform-tools, or set STUDIO_ADB.
```

Install it with:

```powershell
winget install Google.PlatformTools
```

### Optional, strongly recommended: `scrcpy`

Without `scrcpy` the live view works, but it is built from full-resolution PNG
screenshots — roughly **one frame per second** over Wi-Fi. With `scrcpy` installed the
phone encodes H.264 in hardware and the studio decodes it to JPEG frames, giving up to
**30 fps**.

```powershell
winget install Genymobile.scrcpy
```

Or set `STUDIO_SCRCPY` to the folder holding `scrcpy.exe` and `scrcpy-server`.

No backend restart is needed — `scrcpy.py` only caches a *successful* lookup, so installing
it mid-session is picked up on the next stream. The **Phones** panel tells you which mode
you are in:

- `· fast live view (scrcpy) ready`
- `· live view uses screenshots — install scrcpy for smooth video: winget install Genymobile.scrcpy`

---

## 2. Wired: USB

This is the fastest and most reliable connection, and the one to use for a live demo.

1. On the phone: **Settings → About phone → Build number**, tap it 7 times to unlock
   Developer options.
2. **Settings → Developer options → USB debugging** → on.
3. Plug the phone into the computer with a data-capable USB cable.
4. The phone shows **"Allow USB debugging?"** — tick *Always allow from this computer* and
   accept. Until you do, the device appears but is **`unauthorised`**, and no command will
   work.
5. In the studio: **Studio settings → Phones → Rescan**.
6. The device appears under *Attached now* with its model and a `ready` tag. Click **Add**.

The studio then calls `POST /api/phones/{id}/refresh`, which reads `ro.product.model`,
`ro.build.version.release` and `wm size` off the device and stores the real model, Android
version and resolution.

### Why USB is faster

On a USB serial (no `:` in it), `live_frame()` uses raw `screencap` instead of PNG —
skipping the on-device PNG encode, which dominates frame time. Raw frames are ~10 MB, so
wireless links deliberately stay on PNG. This is in `AdbDriver.live_frame()`:

```python
if ":" not in self.serial and "._adb" not in self.serial:
    raw = self._adb("exec-out", "screencap", timeout=20, binary=True)
```

---

## 3. Wireless: Wi-Fi debugging (Android 11+)

Wireless is a **two-step, two-port** process, and this trips up almost everyone the first
time: **the pairing port is not the connection port.** The studio's UI numbers the two
buttons `1. Pair` and `2. Connect over Wi-Fi` for exactly this reason.

Both the phone and the computer must be on the same network.

### Step 1 — Pair (once per computer)

On the phone: **Developer options → Wireless debugging → Pair device with pairing code**.

A dialog appears showing an address *and* a 6-digit code, e.g.:

```
IP address & Port
192.168.1.42:37123

Wi-Fi pairing code
418 652
```

In the studio, enter that address and that code, then click **1. Pair**.

```
POST /api/phones/pair   { "host_port": "192.168.1.42:37123", "code": "418652" }
```

This runs `adb pair`. The studio only accepts it as a success if the output actually says
`successfully paired` — because `adb` will happily exit 0 while printing a failure.

### Step 2 — Connect (every time the phone rejoins the network)

Now **close that dialog** and read the address from the *main* Wireless debugging screen.
It has a **different port**:

```
IP address & Port
192.168.1.42:41567
```

Enter it and click **2. Connect over Wi-Fi**.

```
POST /api/phones/connect   { "host_port": "192.168.1.42:41567" }
```

This runs `adb connect` and, again, verifies the *text* rather than the exit code — the
output must begin `connected to` or `already connected to`.

The response includes a fresh device list, so the newly attached phone appears immediately.
Click **Add** on it.

### Wireless gotchas

- The connect port **changes** when Wireless debugging is toggled off and on, or when the
  phone reconnects to the network. Pairing persists; the connection does not.
- Pairing is per-computer. A new machine must pair again.
- Many phones drop the ADB connection when the screen sleeps. Turn on **Stay awake** in
  Developer options.
- Wi-Fi is noticeably slower for screenshots and UI dumps than USB. For a timed demo, use
  USB.

---

## 4. Emulator

An emulator is a first-class `adb` device and needs no pairing — it simply shows up in
**Rescan** as `emulator-5554`.

One requirement: use a **Play Store** system image. Instagram and X need Google Play
Services, and images without it cannot install or run them.

A verified-working local setup is an Android 15 (API 35) Play Store AVD at 1080×2400.

---

## 5. Registering the phone in the studio

**Rescan → Add** is the normal path, but you can also add a phone by hand with **Add
phone**, which is how you create the simulator (no serial required).

```
POST /api/phones   { "name": "Pixel 7a", "driver": "adb", "serial": "39061FDJH0085T" }
```

Each phone row in **Phones in the studio** shows:

- name, driver tag (`adb` / `simulator`)
- serial · model · Android version · resolution
- the social accounts linked to it, e.g. `instagram:@studio.test`
- `online` / `offline`, plus a `busy` tag while a publishing run holds it
- **Refresh** · **Control** · **Remove**

`Remove` is refused while the phone is busy with a run (HTTP 409), and it unlinks any
accounts pointing at it rather than orphaning them.

### Linking a social account

A phone is only useful once an account is attached to it. Go to **Studio settings →
Accounts**, create the account with its platform and handle, and point it at the phone.

**The studio never stores a social password and never types credentials.** You sign in to
Instagram and X **by hand, on the device**, once.

To confirm a session actually exists, use **check login**:

```
POST /api/accounts/{id}/check-login
```

This opens the app on the phone and **looks at the screen** for a signed-in surface
(`instagram.profile_tab` / `x.profile_tab`). The stored `logged_in` flag is set from what
was observed, not from an assumption. If it fails you get told what to do:

```
com.instagram.android opened but no signed-in surface was found; sign in by hand on the phone
```

---

## 6. Monitoring the phone in the app

Click **Control** on any online phone to open the **device console** (`PhoneControl` in
`frontend/src/pages/Settings.jsx`).

### The live view

The left pane is the phone's screen, served as **MJPEG** from:

```
GET /api/phones/{id}/stream?fps=5&max_h=960
```

An `<img>` plays MJPEG natively, so there is no video player and no WebRTC. Two sources
feed it, chosen automatically:

| Source | Used when | Rate |
| --- | --- | --- |
| `scrcpy` | real `adb` device **and** scrcpy installed | up to 30 fps |
| `screencap` | everything else, or scrcpy failed to start | ~1–5 fps |

The response header `X-Stream-Source` tells you which one you got. If scrcpy fails for any
reason it is logged and the stream silently falls back — the live view never breaks because
an optional dependency misbehaved.

Design details that matter in practice:

- **Only the newest frame is kept.** A slow browser or network drops frames instead of
  accumulating lag.
- **The DB session is closed before streaming starts**, so a viewer left open for an hour
  holds no database connection.
- **Watching is read-only, so it stays available while a run holds the phone.** That is
  precisely when it is most worth seeing. The *controls*, by contrast, are locked out.
- After 5 consecutive frame failures the stream ends, the browser fires `onerror`, and the
  UI shows `Screen stream lost — reconnecting…` and retries.

Untick **Live view** to drop to single still frames from
`GET /api/phones/{id}/screenshot` with a manual **Refresh screen** button — useful on a
slow link or when you want to study one frame.

### The UI tree

Beside the picture, the console reads the live view hierarchy:

```
GET /api/phones/{id}/state
→ { "package": "...", "activity": "...", "nodes": [ { resource_id, text, content_desc, cls, clickable, bounds } ] }
```

It displays the current package, the activity, and `N visible UI elements`.

**This is the single most useful screen in the app when something breaks**, because it is
exactly what target resolution sees. If a publish failed on an unresolved target, open the
console on the same screen, read the tree, and you can see precisely which ids, texts and
descriptions are really there.

`uiautomator dump` is handled carefully. A failed dump ("could not get idle state", "null
root node") **exits 0 and leaves the previous file in place** — reading that back would
describe a screen that is no longer showing. So `_dump_window_xml()` deletes the file
first, requires the output to say `dumped to`, requires `<hierarchy` in the result, and
retries up to 3 times before raising.

### Controlling the phone by hand

Click directly on the picture:

- **click** → tap
- **drag** → swipe
- **hold** (≥500 ms) → long-press

Positions are sent as **fractions of the frame** (0..1), so the browser never needs to know
the device resolution and the downscaled stream maps back exactly:

```
POST /api/phones/{id}/touch   { "x": 0.52, "y": 0.81, "landscape": false, "hold_ms": 0 }
POST /api/phones/{id}/drag    { "x1": .., "y1": .., "x2": .., "y2": .., "duration_ms": 320 }
```

Rotation is resolved from the frame's own shape, because `wm size` always reports the
natural portrait size while input coordinates follow the current rotation.

The control panel also offers:

| Control | Endpoint |
| --- | --- |
| Open Instagram / X, Stop app | `POST /{id}/app-start`, `/app-stop` |
| Home · Back · Recent apps · Enter | `POST /{id}/key` |
| Directional swipes | `POST /{id}/swipe` |
| Tap a **named target** from a dropdown | `POST /{id}/tap` |
| Type into the focused field | `POST /{id}/type` |

`/key` accepts only a fixed alias set — `BACK`, `HOME`, `RECENTS`, `ENTER`, `DELETE`,
`TAB` — and rejects anything else with 422. `/swipe` validates direction and a 0.2–0.9
distance. `/type` returns what actually landed:

```json
{ "delivered": "Small change, real difference.", "lossless": true }
```

`lossless: false` means characters were dropped — `adb shell input text` only carries
ASCII, so emoji and accents are removed rather than silently mangled.

### Two rules the console deliberately respects

**Manual control is blocked while the phone is publishing.** Every control route goes
through `_free()`:

```python
if phone.busy_run_id:
    raise HTTPException(409, f"{phone.name} is busy with run {phone.busy_run_id}")
```

An operator and a run fighting over the same screen is how you publish a half-written
caption. The UI shows this as *"Controls are disabled automatically while this phone is
publishing."*

**Coordinate control lives outside the driver.** `touch` and `drag` are in
`devices/remote.py`, not in `DeviceDriver` — because recipes only ever see the driver, and
recipes must tap **named targets, never coordinates**. A person clicking on a live view is
a different case: they are looking at the screen and aiming themselves. Keeping the two
apart in code is what keeps that rule enforceable rather than aspirational.

---

## 7. Named targets: what the console is for

A publishing recipe never says "tap at 980, 2280". It says `instagram.share`, and
`devices/targets.py` resolves that name against the live UI tree using an ordered list of
candidate selectors, then taps a **random point inside the matched element**.

Selector keys: `id` · `text` · `desc` · `cls` · `clickable` · `exact` · `nth` · `zone` ·
`box`

```python
"instagram.new_post": [
    {"desc": "Create a post", "exact": False},
    {"id": "action_bar_left_button"},
    {"id": "tab_new_post"},
    ...
    {"cls": "android.widget.ImageView", "clickable": True, "zone": [0, 0, 0.18, 0.13]},
],
```

Every target carries fallbacks because apps rename their resource ids between releases.
The last two keys exist for real-world controls that refuse to cooperate:

- **`zone`** — `[left, top, right, bottom]` as fractions of the screen; the node's centre
  must fall inside it. For controls with **no id, text or description** at all. Instagram
  448's "+" in the top-left action bar is a bare `ImageView` — only its *place* identifies
  it. The tap still goes to a random point inside the matched node.
- **`box`** — `[left, top, right, bottom]` as fractions of the **matched node**; the target
  becomes that part of it. For controls **missing from the UI dump entirely** but sitting
  inside a container that *is* in the dump. Instagram 448's photo-editor *Next* button
  never appears in the dump, so it is addressed as the bottom-right of
  `quick_edit_compose_view`. Calibrate per app build and screen shape.

### Recalibrating without touching code

User-supplied selectors are stored in `STUDIO_DATA_DIR/targets.json` and merged **ahead of**
the built-in catalog, so your selectors win and the defaults remain as fallbacks:

```python
merged[name] = list(selectors) + merged.get(name, [])
```

The workflow when a new app version breaks a target:

1. The run fails with a `failed` outcome naming the exact step and target.
2. Open the device console, drive the phone to that screen by hand.
3. Read the UI tree and find the real id / text / description.
4. Save a new selector for that name.
5. Re-run. No code change, no redeploy.

There is an API for step 4, so this never requires editing a file on the server:

```
GET /api/phones/targets      # just the names a recipe may tap
GET /api/system/targets      # { "names": [...], "catalog": { ... } }
PUT /api/system/targets      # { "targets": { "instagram.share": [ {"id": "..."} ] } }
```

`PUT` writes `targets.json`. When an app update moves a button, **this is the fix — and it
is still never a raw coordinate.**

---

## 8. Verifying the device layer against real hardware

Before trusting a phone with a live account, prove the plumbing:

```bash
cd backend
python -m scripts.device_check emulator-5554
```

This exercises all ten `DeviceDriver` capabilities **through the studio's own
`AdbDriver`** — info, screenshot, screen state, app start, swipe, type + readback, key,
push media, app stop. A pass therefore means *the code the publisher depends on* works on
that device, not merely that raw `adb` works.

Currently **9/9** on an Android 15 emulator.

### The one hard-won rule it encodes

> **Never sleep and then type.**

`adb shell input text` delivers to whatever holds focus. With nothing focused, the
keystrokes are **discarded silently**. That publishes an empty caption — which still grows
the profile grid, so it survives to verification and surfaces only as a baffling token
mismatch.

`RunContext.type_into()` therefore waits for an **observed** focused field, types, then
reads the text back. The simulator models this too, so it can genuinely fail on a lost
caption.

On Instagram 448 the caption field is missing from the UI dump altogether, so focus cannot
be read from the hierarchy. `AdbDriver.focused_input()` falls back to the input method
service — `dumpsys input_method` — and trusts it **only** while `mInputShown=true` and the
served field belongs to the app currently in front.

---

## 9. Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `STUDIO_ADB` | auto-detected | Path to `adb` / `adb.exe` |
| `STUDIO_SCRCPY` | auto-detected | Folder holding `scrcpy.exe` and `scrcpy-server` |
| `STUDIO_DATA_DIR` | `backend/app/data` | DB, media, evidence, `targets.json`, Fernet key |
| `STUDIO_RUN_TIMEOUT` | `300` | Hard wall clock per publishing run (seconds) |
| `STUDIO_RUN_STEP_BUDGET` | `60` | Max device actions per run |
| `STUDIO_ACCOUNT_COOLDOWN` | `90` | Min seconds between publishes on one account |
| `STUDIO_SCHEDULER_TICK` | `10` | Scheduler poll interval (seconds) |

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `adb not found at 'adb'` | platform-tools missing or invisible to the server | `winget install Google.PlatformTools`, or set `STUDIO_ADB` |
| Device listed as `unauthorised` | USB debugging prompt not accepted | Unlock the phone, accept, tick *Always allow* |
| Nothing appears on **Rescan** | cable is charge-only, or USB debugging off | Swap cable, re-check Developer options |
| `could not connect to 192.168.1.42:41567` | used the **pairing** port | Read the address off the *main* Wireless debugging screen |
| `could not pair with …` | code expired, or wrong network | Reopen the pairing dialog for a fresh code |
| Wireless drops repeatedly | screen sleeping | Developer options → **Stay awake** |
| Live view is a slideshow | scrcpy not installed, or wireless link | `winget install Genymobile.scrcpy`; prefer USB |
| `Screen stream lost — reconnecting…` | 5 consecutive frame failures | Check the phone is awake and still attached |
| `{phone} is busy with run {id}` (409) | a publishing run holds the phone | Wait for it, or watch via the read-only live view |
| `could not dump UI hierarchy` | `uiautomator` could not reach an idle state | Retry; a busy animation or a modal system dialog usually explains it |
| `lossless: false` on type | non-ASCII characters in the text | Expected — `adb input` is ASCII only |
| Publish fails on an unresolved target | app version renamed its ids | Read the real tree in the console, add a selector to `targets.json` |

---

## Related

- **[Publishing to social media](publishing-to-social-media.md)** — how the app is driven
  to actually post, and how a result is proven.
