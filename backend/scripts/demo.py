"""Drives a whole campaign through the live API: brief -> plan -> 6A -> produce
-> 6B -> schedule -> publish -> evidence.

Run the server first, then:  python scripts/demo.py [base_url]
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"


def call(method: str, path: str, body: dict | None = None, *, allow: tuple[int, ...] = ()):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, method=method, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()[:400]
        if exc.code in allow:
            return {"_refused": exc.code, "detail": detail}
        raise SystemExit(f"{method} {path} -> {exc.code}\n{detail}") from exc


def step(n: str) -> None:
    print(f"\n=== {n} ===")


def main() -> None:
    step("accounts")
    accounts = call("GET", "/api/accounts")
    for a in accounts:
        print(f"  @{a['handle']:<14} {a['platform']:<10} phone={a['phone_name']} ready={a['ready']}")
    if not accounts:
        raise SystemExit("no accounts; the seed did not run")

    step("campaign")
    campaign = call(
        "POST",
        "/api/campaigns",
        {
            "name": "Coffee machine replacement",
            "goal": "Tell people we replaced the office coffee machine",
            "audience": "Our own team and anyone who likes small operational details",
            "message": "The old machine lasted four years and about nine thousand cups",
            "key_facts": "Replaced on a Tuesday. New machine grinds per cup. Old one kept for parts.",
            "account_ids": [a["id"] for a in accounts],
        },
    )
    cid = campaign["id"]
    print(f"  {cid}  {campaign['name']}")

    step("plan (agent 1)")
    campaign = call("POST", f"/api/campaigns/{cid}/plan", {"item_count": 2})
    plan = campaign["plan"]
    print(f"  by {plan.get('generated_by')}: {plan.get('summary')}")
    for item in plan.get("items", []):
        print(f"   - {item.get('title')} [{item.get('media_kind')}/{item.get('placement')}]")
    assert campaign["status"] == "plan_review", campaign["status"]

    step("gate 6A")
    campaign = call("POST", f"/api/campaigns/{cid}/approve-plan")
    print(f"  plan approved at {campaign['plan_approved_at']}")

    step("produce (agents 2-5)")
    campaign = call("POST", f"/api/campaigns/{cid}/produce")
    for p in campaign["posts"]:
        media = p["media"]
        spec = p["spec_check"]
        print(f"  @{p['handle']:<14} {p['platform']:<10} {p['title']}")
        print(f"      caption: {p['caption'][:70]!r}")
        print(f"      media:   {media['url'] if media else 'none'} "
              f"({media['width']}x{media['height']})" if media else "      media:   none")
        print(f"      spec:    ok={spec.get('ok')} {spec.get('issues') or ''}")

    step("gate 6B")
    campaign = call("POST", f"/api/campaigns/{cid}/approve-content")
    print(f"  content approved at {campaign['content_approved_at']}")

    step("schedule")
    campaign = call(
        "POST", f"/api/campaigns/{cid}/auto-schedule", {"spacing_minutes": 2, "tz": "UTC"}
    )
    for p in campaign["posts"]:
        print(f"  @{p['handle']:<14} {p['status']:<10} at {p['scheduled_at']}")

    step("publish now")
    for p in campaign["posts"]:
        print(f"  -> @{p['handle']} {p['title']}")
        res = call("POST", f"/api/runs/publish-now?post_id={p['id']}", allow=(409,))
        if res.get("_refused"):
            # The account cooldown (R3) refusing a manual publish is the system
            # working. The scheduler will pick the post up once it expires.
            print(f"     refused:  {json.loads(res['detail'])['detail']}")
            print("     waiting for the scheduler to take it instead")
        settle(p["id"])

    step("summary")
    print(json.dumps(call("GET", "/api/overview"), indent=1))


TERMINAL = {"published", "failed", "uncertain"}


def settle(post_id: str, timeout: float = 600) -> None:
    """Follow a post until it stops moving, reporting every run on the way.

    A failed attempt is rescheduled with a backoff, so the interesting part is
    what the post settles on, not what the first run returned.
    """
    deadline = time.time() + timeout
    seen: set[str] = set()
    while time.time() < deadline:
        for run in reversed(call("GET", f"/api/runs?post_id={post_id}")):
            if run["id"] in seen or run["status"] != "finished":
                continue
            seen.add(run["id"])
            report(call("GET", f"/api/runs/{run['id']}"))
        post = call("GET", f"/api/posts/{post_id}")
        if post["status"] in TERMINAL:
            print(f"     final:    post is {post['status']} "
                  f"after {post['attempts']} attempt(s) {post['post_url'] or ''}")
            return
        time.sleep(3)
    raise SystemExit(f"post {post_id} never settled")


def report(run: dict) -> None:
    ev = run["evidence"]
    print(f"     outcome:  {run['outcome'].upper()}  ({run['post_status']})")
    print(f"     evidence: {ev.get('kind')} — {ev.get('note')}")
    if ev.get("ref"):
        print(f"     ref:      {ev['ref']}")
    print(f"     checks:   {ev.get('checks')}")
    print(f"     totals:   {run['totals']}")
    if run.get("error"):
        print(f"     error:    {run['error']}")
    ok = sum(1 for s in run["steps"] if s["ok"])
    print(f"     steps:    {ok}/{len(run['steps'])} ok, "
          f"{sum(1 for s in run['steps'] if s['screenshot'])} screenshots")


if __name__ == "__main__":
    main()
