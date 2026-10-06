# Hackathon build plan — AI Publishing Studio

Spec: `hackathon.html`. Core (starred) features are the target; this file tracks the build.
The split of work: **this repo = the studio** (content, approvals, scheduling, phones booking,
run records, the dashboard). **The Python automation service = driving the phones** (it picks up
jobs from the agent API and reports steps, screenshots and outcomes back).

## Already built (uncommitted work in the tree)

- [x] Content studio: project canvas, text/photo/video generators, model picker, Higgsfield gating, retry
- [x] Campaign brief form + agent pipeline (writer → visual director → media → adapter → QA)
- [x] Approval gate 6A (plan) and gate 6B (content)
- [x] Shot-by-shot video regeneration
- [x] Account memory + editorial profile (voice reaches every generation)
- [x] Campaign structure, items, variants per account, scheduling with timezones, conflict warnings
- [x] Platform specs + pre-export check
- [x] Model registry + evals, media recipes
- [x] Inbox (gates, profile changes, failed/unconfirmed posts)
- [x] Groundwork for publishing: `booked_run_id`, pause flags, post proof fields, PostStatus, simulator profiles

## To build now — the publishing engine (area 10, all core)

### Backend

- [x] `publishing_runs` table + `PublishingRun` model (`record()` = the hand-in JSON) — done
- [x] `config/publishing.php` (attempts/backoff R3, step budget + hard timeout R7, app packages/targets)
- [x] `Phones` factory + `PhoneDriver` contract + `SimulatorPhone` (reliable/flaky/broken)
- [x] `Publisher` service: due dispatch (approved + automation + not paused only), atomic phone booking,
      simulator runs, backoff retries → operator, confirm-live by hand, stale-run sweep
- [x] `PublishPost` job on the `publishing` queue + scheduler entries (due every minute, sweep)
- [x] Publishing API: run records (list/detail JSON), retry, confirm-live, device pause/resume,
      device screenshot, global stop button, agent-token rotate
- [x] Agent API for the Python service (Bearer token): next job, append steps, upload screenshot,
      finish run, download media
- [x] `PublishingTest` + agent API tests; whole suite green (118 tests)

### Dashboard (every feature usable from the UI)

- [x] Devices page: phone list, add simulator/HTTP phone, pause/resume, latest screenshot,
      live run view, automation-service card (agent token + endpoints)
- [x] Publishing page: stop button, run history, run detail (steps, evidence, JSON export).
      Doubles as the operations dashboard (area 7): jobs running/waiting/failed + phone status
- [x] Inbox: "try again" and "confirm live" recovery actions
- [x] Nav + api client types; `npm run build` green

### Docs

- [x] DEVELOPMENT.md: publishing architecture + the agent API contract for the Python dev
- [x] ~~TODO.md: mark publishing items~~ (TODO.md was removed earlier; this file is the tracker)

## Hand-in artefacts (section 06 of the spec)

- [x] Run records: one JSON object per run, exportable from the Publishing page (the
      `PublishingRun::record()` format) — four real runs on the dev database: three confirmed
      (one driven end-to-end over the real agent API with curl), one uncertain (the flaky
      phone proved nothing)
- [x] Usage numbers: steps, wall-clock and spend for a typical run — averages shown on the
      Publishing page, computed from `publishing_runs` (+ AI spend metered in `ai_usages`)
- [x] Working demo: brief → 6A → production → 6B → schedule → phone posts → confirmed live,
      runnable on the simulator with no external dependencies (demo@flowai.test / password)
- [x] Decision note: one page, honest — write at the end (`DECISIONS.md`)
- [x] Source with a README of exact run commands (README.md + DEVELOPMENT.md)

## For the Python dev (not this repo)

- Drive the provided phone-control API (type/key/tap/mouse/screenshot/app-start/app-stop + media transfer)
- Loop: `GET /api/agent/next-job` → drive the phone → `POST …/steps`, `…/screenshot` → `POST …/finish`
- Rules that bind them too: named targets only (R6), hard timeout + step budget (R7), one job per phone (R8)

## Spec coverage (audited against hackathon.html: 27 core + 26 optional)

- **Core: 27/27.** Area 10's "automated posting" runs end-to-end on the built-in simulator;
  a physical phone is the Python service's job (agent API contract in DEVELOPMENT.md).
- **Optional built (12/26):** video generator, shot-by-shot regeneration, conflict warnings,
  master→variants, shared-or-adapted, operations dashboard (Publishing page), model registry +
  evals, media recipes, stop button, device screens, autonomy level per account (Mode A).

## Champion features (built after the audit — everything in the spec is now in)

- [x] Repost from X to Instagram: pick posts, permission recorded by a person (decision + why),
      AI adaptation to caption + hashtags, attribution always on the outgoing caption
- [x] Autonomy mode B: rules engine (`Autonomy::decide`), action matrix, policy preview on live
      waiting items, exception queue (the Inbox), max_per_day + deny rules; enforced at AI
      profile changes, comment replies, repost scheduling
- [x] Comment inbox: report comments, AI triage (reply/ignore/human), human approves every
      reply before it's sent; mode B can auto-send within limits
- [x] Investigator: collect → compare → validate → report pipeline (queued job), findings with
      severities and AI verdicts, markdown report; dashboards for operator/investigator/studio
- [x] Editorial identity & memory screen: voice profile with approval-gated changes (person or
      AI proposed), memory in three kinds, on the Accounts page
- [x] Tests: `AutonomyTest`, `CommunityTest`, `InvestigationTest`; suite green (135 tests)
