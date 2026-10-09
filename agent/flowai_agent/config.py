"""Settings for the FlowAI phone agent, from the environment or agent/.env."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """KEY=value lines; real environment variables win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(AGENT_DIR / ".env")

# Where FlowAI's API is, and the agent token from Dashboard → Phones → Automation service.
FLOWAI_URL = os.environ.get("FLOWAI_URL", "http://localhost:8000").rstrip("/")
AGENT_TOKEN = os.environ.get("FLOWAI_AGENT_TOKEN", "")

# The live view and remote control the dashboard opens. Bound to this computer only by default.
MIRROR_HOST = os.environ.get("FLOWAI_MIRROR_HOST", "127.0.0.1")
MIRROR_PORT = int(os.environ.get("FLOWAI_MIRROR_PORT", "8765"))
# The address the browser uses to reach the live view (differs when the agent runs elsewhere).
MIRROR_PUBLIC_URL = os.environ.get("FLOWAI_MIRROR_URL", f"http://localhost:{MIRROR_PORT}").rstrip("/")

POLL_SECONDS = float(os.environ.get("FLOWAI_POLL_SECONDS", "5"))
HELLO_SECONDS = float(os.environ.get("FLOWAI_HELLO_SECONDS", "30"))
# How often an idle phone's screen is sent for the Phones page thumbnail (0: never).
IDLE_SCREEN_SECONDS = float(os.environ.get("FLOWAI_IDLE_SCREEN_SECONDS", "60"))
# Simulated phones to run alongside real ones, e.g. "sim-1" (for trying the loop without hardware).
SIMULATED_PHONES = [p.strip() for p in os.environ.get("FLOWAI_SIMULATED_PHONES", "").split(",") if p.strip()]

# Hackathon phone-control API: base URL (no trailing slash) and team key from the console.
HACK_API_BASE = os.environ.get("HACK_API_BASE", "").rstrip("/")
HACK_TEAM_KEY = os.environ.get("HACK_TEAM_KEY", "")


def set_simulated(enabled: bool) -> str:
    """Switch the agent's simulated phone on or off, now and in agent/.env for next time."""
    SIMULATED_PHONES[:] = ["sim-1"] if enabled else []
    path = AGENT_DIR / ".env"
    lines = path.read_text(encoding="utf-8-sig").splitlines() if path.is_file() else []
    lines = [line for line in lines if not line.startswith("FLOWAI_SIMULATED_PHONES=")]
    if enabled:
        lines.append("FLOWAI_SIMULATED_PHONES=sim-1")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return "Simulated phone sim-1 is on." if enabled else "Simulated phone switched off."

DATA_DIR = Path(os.environ.get("FLOWAI_AGENT_DATA", AGENT_DIR / "data"))
EVIDENCE_DIR = DATA_DIR / "evidence"
MEDIA_DIR = DATA_DIR / "media"
for _d in (DATA_DIR, EVIDENCE_DIR, MEDIA_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# Defaults; every job carries its own limits from FlowAI (R7), which win.
RUN_TIMEOUT_SECONDS = int(os.environ.get("FLOWAI_RUN_TIMEOUT", "240"))
RUN_STEP_BUDGET = int(os.environ.get("FLOWAI_RUN_STEP_BUDGET", "40"))


def _find_adb() -> str:
    explicit = os.environ.get("FLOWAI_ADB") or os.environ.get("STUDIO_ADB")
    if explicit:
        return explicit
    if shutil.which("adb"):
        return "adb"
    local = Path(os.environ.get("LOCALAPPDATA", ""))
    for candidate in (
        Path("C:/platform-tools/adb.exe"),
        local / "Android/Sdk/platform-tools/adb.exe",
        local / "Microsoft/WinGet/Packages/Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe/platform-tools/adb.exe",
        Path(os.environ.get("ANDROID_HOME", "")) / "platform-tools/adb.exe",
        Path.home() / "Android/Sdk/platform-tools/adb",
        Path("/usr/local/bin/adb"),
        Path("/usr/bin/adb"),
    ):
        if candidate.is_file():
            return str(candidate)
    return "adb"


ADB_PATH = _find_adb()
