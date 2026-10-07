from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from sqlalchemy import Column, Text
from sqlmodel import JSON, Field, SQLModel


def _uid() -> str:
    return uuid.uuid4().hex[:12]


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# --------------------------------------------------------------------------
# enums
# --------------------------------------------------------------------------


class ProviderKind(str, Enum):
    text = "text"
    image = "image"
    video = "video"


class ProviderAdapter(str, Enum):
    higgsfield = "higgsfield"
    openai_compat = "openai_compat"
    anthropic = "anthropic"
    simulated = "simulated"


class DriverKind(str, Enum):
    adb = "adb"
    simulator = "simulator"


class Platform(str, Enum):
    instagram = "instagram"
    x = "x"


class Autonomy(str, Enum):
    """Mode A: a human approves every action. Mode B: approved rules let
    matching actions run on their own. A campaign may tighten this, never
    loosen it."""

    manual = "manual"
    rules = "rules"


class CampaignStatus(str, Enum):
    draft = "draft"
    plan_review = "plan_review"
    producing = "producing"
    content_review = "content_review"
    scheduled = "scheduled"
    done = "done"


class PostStatus(str, Enum):
    draft = "draft"
    approved = "approved"
    scheduled = "scheduled"
    publishing = "publishing"
    published = "published"
    failed = "failed"
    uncertain = "uncertain"


class RunStatus(str, Enum):
    queued = "queued"
    running = "running"
    finished = "finished"


class Outcome(str, Enum):
    """`uncertain` is not a cop-out. It is the correct answer when the command
    was sent and the result could not be confirmed."""

    confirmed = "confirmed"
    failed = "failed"
    uncertain = "uncertain"


class MediaKind(str, Enum):
    image = "image"
    video = "video"


# --------------------------------------------------------------------------
# tables
# --------------------------------------------------------------------------


class ProviderConfig(SQLModel, table=True):
    __tablename__ = "provider_config"

    id: str = Field(default_factory=_uid, primary_key=True)
    name: str
    kind: ProviderKind
    adapter: ProviderAdapter
    base_url: Optional[str] = None
    api_key: Optional[str] = Field(default=None, sa_column=Column(Text))  # encrypted
    model: Optional[str] = None
    options: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    enabled: bool = True
    is_default: bool = False
    last_check_ok: Optional[bool] = None
    last_check_at: Optional[datetime] = None
    last_check_detail: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)


class Phone(SQLModel, table=True):
    id: str = Field(default_factory=_uid, primary_key=True)
    name: str
    driver: DriverKind = DriverKind.simulator
    serial: Optional[str] = None  # adb serial, or host:port for wireless
    model_name: Optional[str] = None
    android_version: Optional[str] = None
    screen_w: Optional[int] = None
    screen_h: Optional[int] = None
    online: bool = False
    options: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    busy_run_id: Optional[str] = None  # one job at a time per phone (R8)
    last_seen: Optional[datetime] = None
    last_error: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)


class Account(SQLModel, table=True):
    id: str = Field(default_factory=_uid, primary_key=True)
    platform: Platform
    handle: str
    phone_id: Optional[str] = Field(default=None, foreign_key="phone.id")
    autonomy: Autonomy = Autonomy.manual
    # tone / topics / style, injected into every generation for this account
    editorial_profile: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    liked_examples: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    logged_in: bool = False
    last_published_at: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)


class Campaign(SQLModel, table=True):
    id: str = Field(default_factory=_uid, primary_key=True)
    name: str
    goal: str = ""
    audience: str = ""
    message: str = ""
    key_facts: str = ""
    deadline: Optional[datetime] = None
    status: CampaignStatus = CampaignStatus.draft
    account_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    plan: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    # gate 6A: human approves the plan before production starts
    plan_approved_at: Optional[datetime] = None
    # gate 6B: human approves final content before it is scheduled
    content_approved_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)


class MediaAsset(SQLModel, table=True):
    __tablename__ = "media_asset"

    id: str = Field(default_factory=_uid, primary_key=True)
    kind: MediaKind
    filename: str
    prompt: Optional[str] = Field(default=None, sa_column=Column(Text))
    provider: Optional[str] = None
    model: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    duration_s: Optional[float] = None
    cost: float = 0.0
    meta: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)


class Post(SQLModel, table=True):
    id: str = Field(default_factory=_uid, primary_key=True)
    campaign_id: Optional[str] = Field(default=None, foreign_key="campaign.id")
    account_id: str = Field(foreign_key="account.id")
    platform: Platform
    title: Optional[str] = None
    caption: str = Field(default="", sa_column=Column(Text))
    hashtags: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    media_id: Optional[str] = Field(default=None, foreign_key="media_asset.id")
    placement: str = "feed"  # feed | reel | story
    status: PostStatus = PostStatus.draft
    scheduled_at: Optional[datetime] = None  # stored UTC naive
    tz: str = "UTC"
    approved_at: Optional[datetime] = None
    published_at: Optional[datetime] = None
    post_url: Optional[str] = None
    spec_check: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    attempts: int = 0
    last_error: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=utcnow)


class Run(SQLModel, table=True):
    id: str = Field(default_factory=_uid, primary_key=True)
    post_id: str = Field(foreign_key="post.id")
    phone_id: Optional[str] = Field(default=None, foreign_key="phone.id")
    account_id: Optional[str] = Field(default=None, foreign_key="account.id")
    goal: str = ""
    status: RunStatus = RunStatus.queued
    outcome: Optional[Outcome] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    # { kind: post_url | screenshot, ref: ..., note: ... }
    evidence: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    totals: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    error: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=utcnow)


class RunStep(SQLModel, table=True):
    __tablename__ = "run_step"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: str = Field(foreign_key="run.id", index=True)
    n: int
    action: str
    ok: bool = True
    ms: int = 0
    detail: Optional[str] = Field(default=None, sa_column=Column(Text))
    screenshot: Optional[str] = None
    at: datetime = Field(default_factory=utcnow)


class Setting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
