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

## Real phones: the agent keeps the same rules

The automation service now exists (`agent/`): it registers the phones on its computer
(`/api/agent/hello`), and for each job drives Instagram or X through named targets, inside the
job's own budget and timeout. Confirmed still means observed: the profile's post count grew *and*
the newest post carries the caption, with the screenshots uploaded as proof. If the run stops
after Publish was tapped, the agent can't know whether the post went out, so it says uncertain
rather than failed; a failed post is retried, and retrying one that's actually live is how an
account double-posts. Remote control from the live view is refused while a run holds the phone.

Real hardware moved one guardrail. A real Instagram run (cold start, permission dialogs, caption
read-back, the profile checked before and after) takes 35–50 device actions, and a video can take
minutes to upload, so the step budget went from 40 to 60 and the hard timeout from 240 to 420
seconds (`PUBLISHING_STEP_BUDGET`, `PUBLISHING_HARD_TIMEOUT`). Both are still enforced on both sides.

## Models are described, not guessed

Each Higgsfield model in `config/ai.php` carries its request schema from Higgsfield's docs: which
route, aspects, lengths, resolutions, image fields and sound switch it takes. The Studio only
offers those, and the provider snaps anything else to the nearest accepted value, so a request
never fails on a field the model doesn't know. The previous stand-ins sent fields Soul doesn't
accept and marked every result PNG; results are now typed from their bytes.

## Costs

A simulator run spends nothing, so run spend shows 0; AI spend from writing and media
generation is metered separately (`ai_usages`) and shows in the studio. The usage numbers on
the Publishing page — steps, wall-clock, spend — are straight averages over `publishing_runs`.
