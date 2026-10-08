"""Lets a long-running provider call see the studio job it belongs to.

The job worker sets `current` before calling a provider; a provider that can
be stopped (Higgsfield, while the request is still queued on their side)
reports its remote id and checks for a cancel request while it polls. Calls
made outside a job see None and behave as before.
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Callable, Optional


class JobControl:
    def __init__(self, cancelled: Callable[[], bool], on_remote_id: Callable[[str], None]):
        self.cancelled = cancelled
        self.on_remote_id = on_remote_id


class Cancelled(Exception):
    """The operator stopped the job before the provider started generating."""


current: ContextVar[Optional[JobControl]] = ContextVar("studio_job_control", default=None)
