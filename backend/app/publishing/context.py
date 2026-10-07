from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from ..config import EVIDENCE_DIR, RUN_STEP_BUDGET, RUN_TIMEOUT_SECONDS
from ..devices.base import DeviceDriver, DeviceError, ScreenState, TapResult


class BudgetExceeded(RuntimeError):
    """Hit the step budget or the wall clock. Rule R7: every run is bounded."""


@dataclass
class StepRecord:
    n: int
    action: str
    ok: bool
    ms: int
    detail: str = ""
    screenshot: Optional[str] = None


StepSink = Callable[[StepRecord], None]


@dataclass
class RunContext:
    """Wraps a driver so every device action is counted, timed and logged.

    Recipes only ever talk to this. They cannot exceed the budget, cannot run
    past the deadline and cannot touch the device without leaving a record.
    """

    run_id: str
    driver: DeviceDriver
    sink: StepSink
    step_budget: int = RUN_STEP_BUDGET
    timeout_s: int = RUN_TIMEOUT_SECONDS
    started: float = field(default_factory=time.monotonic)
    steps: list[StepRecord] = field(default_factory=list)
    _n: int = 0

    # ---------------- budget ----------------

    @property
    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self.started) * 1000)

    def _charge(self, action: str) -> None:
        if self._n >= self.step_budget:
            raise BudgetExceeded(f"step budget of {self.step_budget} exhausted at {action!r}")
        if time.monotonic() - self.started > self.timeout_s:
            raise BudgetExceeded(f"run exceeded {self.timeout_s}s at {action!r}")
        self._n += 1

    def _record(self, action: str, ok: bool, ms: int, detail: str = "", shot: str | None = None):
        rec = StepRecord(n=self._n, action=action, ok=ok, ms=ms, detail=detail[:800], screenshot=shot)
        self.steps.append(rec)
        self.sink(rec)
        return rec

    def _do(self, action: str, fn, detail_fn=None):
        self._charge(action)
        t0 = time.monotonic()
        try:
            result = fn()
        except Exception as exc:
            self._record(action, False, int((time.monotonic() - t0) * 1000), str(exc))
            raise
        ms = int((time.monotonic() - t0) * 1000)
        detail = detail_fn(result) if detail_fn else ""
        self._record(action, True, ms, detail)
        return result

    # ---------------- device actions ----------------

    def app_start(self, package: str) -> None:
        self._do("app-start", lambda: self.driver.app_start(package), lambda _: package)
        time.sleep(2.5)

    def app_stop(self, package: str) -> None:
        self._do("app-stop", lambda: self.driver.app_stop(package), lambda _: package)

    def tap(self, target: str) -> TapResult:
        def detail(r: TapResult) -> str:
            return f"{target} -> {r.matched} @ ({r.x},{r.y})"

        result = self._do(f"tap:{target}", lambda: self.driver.tap(target), detail)
        time.sleep(1.0)
        return result

    def type_text(self, text: str) -> str:
        def detail(delivered: str) -> str:
            note = f"{len(delivered)} chars"
            if delivered != text:
                note += f" (adb input is ASCII only; {len(text) - len(delivered)} dropped)"
            return note

        return self._do("type", lambda: self.driver.type_text(text), detail)

    def key(self, keycode: str) -> None:
        self._do(f"key:{keycode}", lambda: self.driver.key(keycode))
        time.sleep(0.6)

    def swipe(self, direction: str, distance: float = 0.6) -> None:
        self._do(f"swipe:{direction}", lambda: self.driver.swipe(direction, distance))
        time.sleep(0.6)

    def push_media(self, local_path: str) -> str:
        return self._do(
            "media-transfer", lambda: self.driver.push_media(local_path), lambda r: str(r)
        )

    def state(self) -> ScreenState:
        return self._do(
            "screen-state",
            self.driver.screen_state,
            lambda s: f"{s.package}/{s.activity} · {len(s.nodes)} nodes",
        )

    def wait_for(self, target: str, timeout: float = 12.0) -> bool:
        def run():
            return self.driver.wait_for(target, timeout=timeout) is not None

        return self._do(
            f"wait:{target}", run, lambda found: "found" if found else "not found (timed out)"
        )

    def tap_if_present(self, target: str) -> bool:
        """For things that only sometimes appear, like a permission dialog."""
        from ..devices.targets import resolve

        try:
            nodes = self.driver.screen_state().nodes
        except DeviceError:
            return False
        if resolve(target, nodes) is None:
            return False
        self.tap(target)
        return True

    # ---------------- evidence ----------------

    def screenshot(self, label: str) -> Optional[str]:
        """Saved to disk and attached to the step. This is what proof is made of."""
        self._charge(f"screenshot:{label}")
        t0 = time.monotonic()
        try:
            png = self.driver.screenshot()
        except Exception as exc:
            self._record(f"screenshot:{label}", False, int((time.monotonic() - t0) * 1000), str(exc))
            return None
        name = f"{self.run_id}_{label}_{uuid.uuid4().hex[:6]}.png"
        (EVIDENCE_DIR / name).write_bytes(png)
        self._record(
            f"screenshot:{label}",
            True,
            int((time.monotonic() - t0) * 1000),
            f"{len(png) // 1024} KB",
            shot=name,
        )
        return name

    def note(self, action: str, detail: str, ok: bool = True) -> None:
        """A decision worth having in the record that cost no device action."""
        self._n += 1
        self._record(action, ok, 0, detail)

    def totals(self) -> dict[str, Any]:
        return {
            "steps": len(self.steps),
            "wall_clock_ms": self.elapsed_ms,
            "failed_steps": sum(1 for s in self.steps if not s.ok),
        }
