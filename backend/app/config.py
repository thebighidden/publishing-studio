from __future__ import annotations

import os
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("STUDIO_DATA_DIR", BASE_DIR / "data"))
MEDIA_DIR = DATA_DIR / "media"
EVIDENCE_DIR = DATA_DIR / "evidence"
DB_PATH = DATA_DIR / "studio.db"
KEY_PATH = DATA_DIR / "secret.key"

def _find_adb() -> str:
    explicit = os.environ.get("STUDIO_ADB")
    if explicit:
        return explicit
    if shutil.which("adb"):
        return "adb"
    # A long-running server often holds the PATH it was started with, so a
    # platform-tools install done after launch stays invisible. Look where the
    # common installers actually put it before giving up.
    local = Path(os.environ.get("LOCALAPPDATA", "")) if os.name == "nt" else Path.home()
    candidates = [
        local / "Android/Sdk/platform-tools/adb.exe",
        local / "Microsoft/WinGet/Packages/Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe/platform-tools/adb.exe",
        Path(os.environ.get("ANDROID_HOME", "")) / "platform-tools/adb.exe",
        Path.home() / "Android/Sdk/platform-tools/adb",
        Path("/usr/local/bin/adb"),
    ]
    for c in candidates:
        if c.is_file():
            return str(c)
    return "adb"


ADB_PATH = _find_adb()

# A publishing run is killed past this wall clock, and past this many device
# actions. Hackathon rule R7: an unbounded loop on a logged-in account is the
# worst failure available.
RUN_TIMEOUT_SECONDS = int(os.environ.get("STUDIO_RUN_TIMEOUT", "300"))
RUN_STEP_BUDGET = int(os.environ.get("STUDIO_RUN_STEP_BUDGET", "60"))

# Minimum gap between two publishes on the same account (rule R3: don't burn
# the account with tight posting loops).
ACCOUNT_COOLDOWN_SECONDS = int(os.environ.get("STUDIO_ACCOUNT_COOLDOWN", "90"))

SCHEDULER_TICK_SECONDS = int(os.environ.get("STUDIO_SCHEDULER_TICK", "10"))

# Reading a post's likes and comments is a shorter trip than publishing one:
# open the app, find our post, read four labels. A tighter budget than a
# publishing run means a stuck collection can never hold a phone for long.
METRICS_STEP_BUDGET = int(os.environ.get("STUDIO_METRICS_STEP_BUDGET", "45"))
METRICS_TIMEOUT_SECONDS = int(os.environ.get("STUDIO_METRICS_TIMEOUT", "180"))
# Posts older than this stop being polled; engagement has long since settled
# and the phone is better used for publishing.
METRICS_WINDOW_DAYS = int(os.environ.get("STUDIO_METRICS_WINDOW_DAYS", "7"))

for _d in (DATA_DIR, MEDIA_DIR, EVIDENCE_DIR):
    _d.mkdir(parents=True, exist_ok=True)
