"""Exercise the performance collector against the simulator.

Publishing proves a post went out; this proves the studio can go back and read
how that post is doing — likes, comments, reposts, views — by looking at the
phone, with no platform API anywhere in the path.

    python -m scripts.metrics_check

The simulator is seeded with several posts per platform and the collector is
asked for the *second* one, so a pass means it located our post by recognising
our own caption rather than by assuming the newest tile is ours. That is the
failure this whole design exists to prevent: a number attached to the wrong
post is worse than no number at all.
"""

from __future__ import annotations

import sys
import time

from app.devices.simulator import SimulatorDriver, _PublishedPost, get_phone
from app.publishing.context import RunContext
from app.publishing.recipes.base import PostPayload, parse_count
from app.publishing.recipes.instagram import InstagramRecipe
from app.publishing.recipes.x import XRecipe

PASS, FAIL = "  ok  ", " FAIL "
_results: list[tuple[bool, str]] = []


def check(ok: bool, label: str, detail: str = "") -> bool:
    _results.append((ok, label))
    print(f"[{PASS if ok else FAIL}] {label}" + (f" — {detail}" if detail else ""))
    return ok


def _seed(serial: str, platform: str, captions: list[str], *, age_minutes: float = 90) -> None:
    """Put posts on the phone as if they had been published a while ago.

    Backdating matters: engagement in the simulator saturates over time, so a
    post published one second ago would legitimately read zero everywhere and
    the check would prove nothing.
    """
    phone = get_phone(serial)
    phone.published.clear()
    for i, caption in enumerate(captions):
        phone.published.append(
            _PublishedPost(
                platform=platform,
                caption=caption,
                media=None,
                url=f"https://example.invalid/{platform}/{serial}/{i}",
                at=time.time() - age_minutes * 60,
            )
        )


def _context(serial: str) -> RunContext:
    driver = SimulatorDriver(serial)
    return RunContext(run_id=f"check-{serial}", driver=driver, sink=lambda rec: None)


# --------------------------------------------------------------------------


def test_parse_count() -> None:
    cases = [
        ("1,234 likes", 1234, False),
        ("View all 56 comments", 56, False),
        ("12.3K views", 12300, True),
        ("2M Likes", 2_000_000, True),
        ("942", 942, False),
        ("Likes", None, False),
        ("", None, False),
    ]
    for raw, want, want_approx in cases:
        value, approx = parse_count(raw)
        check(
            value == want and approx == want_approx,
            f"parse {raw!r}",
            f"got ({value}, approximate={approx}), wanted ({want}, approximate={want_approx})",
        )


def test_instagram() -> None:
    serial = "check-ig"
    captions = [
        "Harbour lights across the estuary at dusk",
        "Sunrise over the quarry escarpment this morning",  # the one we collect
        "Street food stalls on the riverside promenade",
    ]
    _seed(serial, "instagram", captions)
    ctx = _context(serial)

    # captions[1] is the middle tile, so tile 0 is somebody else's newer post.
    reading = InstagramRecipe().collect(ctx, PostPayload(caption=captions[1]))

    check(reading.found, "instagram: found our own post on the grid", reading.note)
    if not reading.found:
        return
    check(
        reading.matched_by.get("slot") == 2,
        "instagram: walked past the newest tile to the right one",
        f"matched at slot {reading.matched_by.get('slot')}",
    )
    check(
        reading.likes is not None and reading.likes > 0,
        "instagram: read a like count",
        f"likes={reading.likes} raw={reading.raw.get('likes')!r}",
    )
    check(
        reading.comments is not None,
        "instagram: read a comment count",
        f"comments={reading.comments} raw={reading.raw.get('comments')!r}",
    )
    check(
        reading.screenshot is not None,
        "instagram: kept a screenshot as evidence for the number",
        str(reading.screenshot),
    )


def test_instagram_absent_post() -> None:
    """A post that is not on the grid must produce no reading at all."""
    serial = "check-ig-absent"
    _seed(serial, "instagram", ["Allotment tomatoes finally ripening in the greenhouse"])
    ctx = _context(serial)

    reading = InstagramRecipe().collect(
        ctx, PostPayload(caption="Completely unrelated lighthouse photograph")
    )
    check(
        not reading.found and reading.likes is None,
        "instagram: a post that is not there reads as not found, not as zero",
        reading.note,
    )


def test_x() -> None:
    serial = "check-x"
    captions = [
        "Shipping forecast says gale nine later",
        "Rebuilt the whole indexer over the weekend and it is finally fast",
        "Coffee queue down the block again",
    ]
    _seed(serial, "x", captions)
    ctx = _context(serial)

    reading = XRecipe().collect(ctx, PostPayload(caption=captions[1]))

    check(reading.found, "x: found our own post on the timeline", reading.note)
    if not reading.found:
        return
    check(
        reading.likes is not None and reading.comments is not None,
        "x: read likes and replies",
        f"likes={reading.likes} replies={reading.comments} raw={reading.raw}",
    )
    check(
        reading.shares is not None,
        "x: read reposts",
        f"reposts={reading.shares} raw={reading.raw.get('shares')!r}",
    )
    check(
        reading.views is not None and reading.views >= (reading.likes or 0),
        "x: read a view count, and it is not below the like count",
        f"views={reading.views}",
    )


def test_approximate_label() -> None:
    """A post big enough for the app to print "1.2K" must come back flagged.

    An approximate reading is still worth charting, but it cannot prove a delta
    of one, and the row has to say which kind it is.
    """
    serial = "check-viral"
    caption = "The ferry terminal renovation timelapse everyone asked for"
    phone = get_phone(serial)

    # The simulator derives engagement from the post's URL, so walk URLs until
    # one lands on a post the app would abbreviate.
    for i in range(200):
        phone.published.clear()
        phone.published.append(
            _PublishedPost(
                platform="x",
                caption=caption,
                media=None,
                url=f"https://example.invalid/x/viral/{i}",
                at=time.time() - 36 * 3600,
            )
        )
        if phone.published[0].stats()["likes"] >= 1000:
            break
    else:
        check(False, "x: could find no post large enough to be abbreviated")
        return

    reading = XRecipe().collect(_context(serial), PostPayload(caption=caption))
    check(
        reading.found and reading.approximate,
        "x: an abbreviated label is read and flagged as approximate",
        f"likes={reading.likes} from raw {reading.raw.get('likes')!r}",
    )
    check(
        (reading.likes or 0) >= 1000,
        "x: the abbreviated label still parses to the right order of magnitude",
        f"likes={reading.likes}",
    )


def test_growth() -> None:
    """Two readings of the same post, taken at different ages, must differ —
    otherwise a trend chart would be a flat line and nobody would notice the
    collector had silently stopped working."""
    serial = "check-growth"
    caption = "Winter timetable changes at the junction station"
    _seed(serial, "instagram", [caption], age_minutes=10)
    early = InstagramRecipe().collect(_context(serial), PostPayload(caption=caption))

    _seed(serial, "instagram", [caption], age_minutes=600)
    later = InstagramRecipe().collect(_context(serial), PostPayload(caption=caption))

    check(
        early.found and later.found and (later.likes or 0) > (early.likes or 0),
        "engagement grows with the age of the post",
        f"{early.likes} likes at 10 min, {later.likes} likes at 10 hours",
    )


def main() -> int:
    print("Collecting post performance from the simulator\n")
    test_parse_count()
    print()
    test_instagram()
    print()
    test_instagram_absent_post()
    print()
    test_x()
    print()
    test_approximate_label()
    print()
    test_growth()

    passed = sum(1 for ok, _ in _results if ok)
    print(f"\n{passed}/{len(_results)} checks passed")
    return 0 if passed == len(_results) else 1


if __name__ == "__main__":
    sys.exit(main())
