"""Who has the phone, in words a human reads.

Publishing runs and performance readings book a phone through the same field,
`Phone.busy_run_id` (rule R8: one job per phone). That field holds a run id for
one kind of job and a `metrics-<post id>` string for the other, so any refusal
that prints it raw sends the operator looking for a publishing run that does not
exist -- or, worse, reports "busy with run metrics-ab12cd" and makes the studio
look broken when it is behaving correctly.

This lives in its own module because both sides need it: the collector imports
the runner for its recipes, so the runner cannot import the collector back.
"""

from __future__ import annotations

from typing import Optional

# A metrics booking is named rather than opaque so it can be told apart from a
# run id on sight. It ends up in evidence filenames too, hence a hyphen and not
# a colon, which Windows would turn into an alternate data stream.
BOOKING_PREFIX = "metrics-"


def describe_booking(busy_run_id: Optional[str]) -> str:
    if not busy_run_id:
        return "idle"
    if busy_run_id.startswith(BOOKING_PREFIX):
        return f"reading performance for post {busy_run_id[len(BOOKING_PREFIX):]}"
    return f"publishing run {busy_run_id}"
