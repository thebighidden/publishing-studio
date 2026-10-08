"""Operator settings kept in the database, each with a safe default.

Values live in Setting rows as {"value": ...}. The publishing rules are read at
the moment they are needed, so a change in Settings applies to the next run
without a restart. Their ranges keep the hackathon guardrails true whatever is
typed: no tight posting loops (R3), and every run has a hard timeout and a step
budget (R7).
"""
from __future__ import annotations

from datetime import datetime, time, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlmodel import Session

from . import config
from .db import session_scope
from .models import Setting

PUBLISHING_KEY = "publishing_rules"

PUBLISHING_DEFAULTS: dict[str, Any] = {
    "cooldown_seconds": config.ACCOUNT_COOLDOWN_SECONDS,
    "run_timeout_seconds": config.RUN_TIMEOUT_SECONDS,
    "step_budget": config.RUN_STEP_BUDGET,
    "max_attempts": 3,
    "retry_backoff_seconds": [60, 180],
    "timezone": "UTC",
    "posting_hours": {"enabled": False, "start": "08:00", "end": "22:00"},
}

# (minimum, maximum) for each number. The minimums are the guardrails.
PUBLISHING_LIMITS: dict[str, tuple[int, int]] = {
    "cooldown_seconds": (30, 86400),
    "run_timeout_seconds": (60, 900),
    "step_budget": (20, 150),
    "max_attempts": (1, 5),
}


class SettingsError(ValueError):
    pass


def get(session: Session, key: str, default: Any) -> Any:
    row = session.get(Setting, key)
    if row is None or not isinstance(row.value, dict) or "value" not in row.value:
        return default
    return row.value["value"]


def put(session: Session, key: str, value: Any) -> None:
    row = session.get(Setting, key) or Setting(key=key, value={})
    row.value = {"value": value}
    session.add(row)
    session.commit()


def publishing(session: Optional[Session] = None) -> dict[str, Any]:
    """The rules in force: stored values over defaults."""
    if session is None:
        with session_scope() as s:
            stored = get(s, PUBLISHING_KEY, {})
    else:
        stored = get(session, PUBLISHING_KEY, {})
    rules = {**PUBLISHING_DEFAULTS, **(stored or {})}
    rules["posting_hours"] = {**PUBLISHING_DEFAULTS["posting_hours"], **(rules.get("posting_hours") or {})}
    return rules


def validate_publishing(data: dict[str, Any]) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for key, (lo, hi) in PUBLISHING_LIMITS.items():
        if key in data:
            try:
                value = int(data[key])
            except (TypeError, ValueError) as exc:
                raise SettingsError(f"{key} must be a whole number") from exc
            if not lo <= value <= hi:
                raise SettingsError(f"{key.replace('_', ' ')} must be between {lo} and {hi}")
            clean[key] = value
    if "retry_backoff_seconds" in data:
        try:
            backoff = [int(v) for v in data["retry_backoff_seconds"]]
        except (TypeError, ValueError) as exc:
            raise SettingsError("retry waits must be whole numbers of seconds") from exc
        if not 1 <= len(backoff) <= 4 or any(not 30 <= v <= 3600 for v in backoff):
            raise SettingsError("give 1 to 4 retry waits, each between 30 and 3600 seconds")
        clean["retry_backoff_seconds"] = backoff
    if "timezone" in data:
        try:
            ZoneInfo(str(data["timezone"]))
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise SettingsError(f"unknown time zone {data['timezone']!r}; use a name like Africa/Casablanca") from exc
        clean["timezone"] = str(data["timezone"])
    if "posting_hours" in data:
        hours = data["posting_hours"] or {}
        start, end = str(hours.get("start", "08:00")), str(hours.get("end", "22:00"))
        for label, value in (("start", start), ("end", end)):
            try:
                time.fromisoformat(value)
            except ValueError as exc:
                raise SettingsError(f"posting hours {label} must look like 08:00") from exc
        if start == end:
            raise SettingsError("posting hours start and end must differ")
        clean["posting_hours"] = {"enabled": bool(hours.get("enabled")), "start": start, "end": end}
    return clean


def within_posting_hours(rules: dict[str, Any], now_utc: Optional[datetime] = None) -> bool:
    """True when posting is allowed right now. Windows may cross midnight (22:00-06:00)."""
    hours = rules.get("posting_hours") or {}
    if not hours.get("enabled"):
        return True
    now = (now_utc or datetime.now(timezone.utc)).astimezone(ZoneInfo(rules.get("timezone") or "UTC")).time()
    start, end = time.fromisoformat(hours["start"]), time.fromisoformat(hours["end"])
    return start <= now < end if start < end else (now >= start or now < end)
