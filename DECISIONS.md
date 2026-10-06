# Decision note

One page, honest. What we decided building the AI Publishing Studio, and why.

## The split: the studio drives nothing itself

The Laravel app never touches a phone directly. It owns the content, the approvals, the
schedule, the bookings and the records; driving a phone is the automation service's job, behind
a small Bearer-token API (`/api/agent/*`). That made the boundary testable: everything the
Python dev needs is one job payload (app package + named targets, caption, media URLs, limits)
and four endpoints. It also meant the whole loop — booking, steps, screenshots, proof, retries —
had to be built and proven before any hardware existed, which is why the simulator came first.

## Proof, or it didn't happen

Sending "publish" is not publishing. Every run ends by reading the screen: the caption visible
on the account is proof; anything else ends the run **uncertain**, a first-class outcome, not a
failure with better PR. Uncertain posts go to the Inbox with "try again" and "confirm live" —
a person checks the account and either re-runs it or pastes the post URL, which becomes the
run's evidence. The hand-in's "one run not successful" is this path, and the UI makes it a
normal Tuesday rather than an error page.

## One job per phone, booked atomically

Phones are booked with a conditional `UPDATE … WHERE booked_run_id IS NULL`, never
read-then-write. Two posts due on the same phone simply can't double-book; the loser waits for
the next minute. The same discipline releases: only the run that holds the phone can free it.

## Retries wait, then a person takes over

Three attempts, 5/15/30-minute backoff (R3), then the post is marked failed and lands in the
Inbox — we don't burn accounts to look autonomous. Runs that go quiet are swept after ten
minutes and end honestly: uncertain if the steps show a successful Publish tap, failed
otherwise. Every run lives under a step budget and a hard timeout (R7), enforced on both sides:
the agent gets a 422 past the budget, the worker kills a simulator run past it.

## The simulator is a feature, not a mock

The demo — brief → gate 6A → production → gate 6B → schedule → phone posts → confirmed live —
runs end-to-end on the built-in simulator with zero external dependencies. Its reliable/flaky/
broken profiles exercise the three endings (confirmed, uncertain, failed-with-retries) on
demand, which is also how the test suite rigs outcomes deterministically.

## The champion features, and what they cost

After the core we built all four champion areas, in spec order of difficulty. The honest
shape of each:

- **Mode B** is a real rules engine (`Autonomy::decide` with allow/deny and `max_per_day`
  narrowers), but it's enforced at three points only — AI profile changes, comment replies,
  repost scheduling. Publishing keeps its own switch and gate 6B is always a person; the action
  matrix says so rather than pretending otherwise.
- **Repost** makes the permission check a human-only step that records *why*, and attribution
  is appended by the model class, never by the AI — so the credit line can't be "forgotten" by
  a prompt.
- **Comments** don't go to a real platform (no connector exists at this stage); "sent" means
  recorded with a timestamp after human approval. The triage and the approval discipline around
  it are the feature.
- **Investigator** verifies the studio's own records against their evidence; its AI validation
  falls back to showing a person everything when AI is off — erring loud, not quiet.

## Costs

A simulator run spends nothing, so run spend shows 0; AI spend from writing and media
generation is metered separately (`ai_usages`) and shows in the studio. The usage numbers on
the Publishing page — steps, wall-clock, spend — are straight averages over `publishing_runs`.
