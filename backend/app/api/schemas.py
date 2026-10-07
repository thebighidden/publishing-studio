from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from ..models import Autonomy, DriverKind, MediaKind, Platform, ProviderAdapter, ProviderKind


# ---------------- providers ----------------


class ProviderIn(BaseModel):
    name: str
    kind: ProviderKind
    adapter: ProviderAdapter
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    options: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True
    is_default: bool = False


class ProviderUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    # Omit to keep the stored key; send "" to clear it.
    api_key: Optional[str] = None
    model: Optional[str] = None
    options: Optional[dict[str, Any]] = None
    enabled: Optional[bool] = None
    is_default: Optional[bool] = None


class ProviderOut(BaseModel):
    id: str
    name: str
    kind: ProviderKind
    adapter: ProviderAdapter
    base_url: Optional[str]
    model: Optional[str]
    options: dict[str, Any]
    enabled: bool
    is_default: bool
    has_key: bool
    key_masked: Optional[str]
    last_check_ok: Optional[bool]
    last_check_at: Optional[datetime]
    last_check_detail: Optional[str]


# ---------------- phones ----------------


class PhoneIn(BaseModel):
    name: str
    driver: DriverKind = DriverKind.simulator
    serial: Optional[str] = None
    options: dict[str, Any] = Field(default_factory=dict)


class PhoneUpdate(BaseModel):
    name: Optional[str] = None
    driver: Optional[DriverKind] = None
    serial: Optional[str] = None
    options: Optional[dict[str, Any]] = None


class WirelessConnect(BaseModel):
    host_port: str = Field(description="e.g. 192.168.1.42:5555")


class TapIn(BaseModel):
    target: str


class TypeIn(BaseModel):
    text: str


class AppIn(BaseModel):
    package: str


class KeyIn(BaseModel):
    keycode: str


class SwipeIn(BaseModel):
    direction: str
    distance: float = Field(default=0.6, ge=0.2, le=0.9)


# ---------------- accounts ----------------


class AccountIn(BaseModel):
    platform: Platform
    handle: str
    phone_id: Optional[str] = None
    autonomy: Autonomy = Autonomy.manual
    editorial_profile: dict[str, Any] = Field(default_factory=dict)
    liked_examples: list[str] = Field(default_factory=list)
    logged_in: bool = False
    notes: Optional[str] = None


class AccountUpdate(BaseModel):
    handle: Optional[str] = None
    phone_id: Optional[str] = None
    autonomy: Optional[Autonomy] = None
    editorial_profile: Optional[dict[str, Any]] = None
    liked_examples: Optional[list[str]] = None
    logged_in: Optional[bool] = None
    notes: Optional[str] = None


# ---------------- campaigns ----------------


class CampaignIn(BaseModel):
    name: str
    goal: str = ""
    audience: str = ""
    message: str = ""
    key_facts: str = ""
    deadline: Optional[datetime] = None
    account_ids: list[str] = Field(default_factory=list)


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    goal: Optional[str] = None
    audience: Optional[str] = None
    message: Optional[str] = None
    key_facts: Optional[str] = None
    deadline: Optional[datetime] = None
    account_ids: Optional[list[str]] = None
    plan: Optional[dict[str, Any]] = None


class PlanIn(BaseModel):
    item_count: int = Field(default=3, ge=1, le=8)


class PostUpdate(BaseModel):
    title: Optional[str] = None
    caption: Optional[str] = None
    hashtags: Optional[list[str]] = None
    placement: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    tz: Optional[str] = None
    media_id: Optional[str] = None


class ScheduleItem(BaseModel):
    post_id: str
    scheduled_at: datetime
    tz: str = "UTC"


class ScheduleIn(BaseModel):
    items: list[ScheduleItem]


class AutoScheduleIn(BaseModel):
    start_at: Optional[datetime] = None
    spacing_minutes: int = Field(default=60, ge=2, le=10080)
    tz: str = "UTC"


class RegenerateIn(BaseModel):
    prompt: Optional[str] = None
    kind: MediaKind = MediaKind.image
    aspect: Optional[str] = None


# ---------------- system ----------------


class PauseIn(BaseModel):
    paused: bool
    reason: str = ""


class TargetsIn(BaseModel):
    targets: dict[str, list[dict[str, Any]]]
