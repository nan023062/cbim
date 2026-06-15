"""actions/baseline_burndown.py — read-only baseline burn-down advice helper.

Pure function: opens the project's ``BaselineStore`` (audit module's facade
at ``.cbim/audit/baseline.json``), counts accepted historical findings,
and emits a short advice string per check carrying baseline entries.

Hard contracts (mirror T8 task scope):

* **Read-only.** The dream loop only ever calls ``BaselineStore.load()``
  here. No ``accept()``, no ``save()``, no ``classify()``, no ``clear()``.
  Baseline consumption (burn-down acceptance) is an explicit human
  gesture driven from ``cbim audit baseline clear --yes ...`` — the
  governance loop only *reminds* the architect that the pile is growing.
* **Graceful degradation on missing baseline.** Project never initialised
  a baseline → ``BaselineStore.load()`` returns ``{}`` → this helper
  returns an empty list. No advice is produced, no error is raised.
* **No new blackboard fields.** The returned strings are intended to be
  appended to an *existing* ``arch_governance_report["advice_pending"]``
  list — the caller decides the merge policy. We do not write the
  blackboard from here.

Output shape: ``list[str]`` — one human-readable advice per check that has
baseline entries, sorted by check name for stable ordering.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable


def _project_root() -> Path | None:
    """Best-effort project-root resolution for the dream context.

    Mirrors the lazy/fallback pattern used elsewhere in dream/api/dream_tick.py:
    prefer the kernel's canonical ``context.project_root()``; on any failure
    fall back to ``Path.cwd()`` so the helper still works in tests and odd
    runtime layouts. Returns ``None`` only when *both* paths raise — at which
    point burn-down advice is simply skipped.
    """
    try:
        from context import project_root  # type: ignore[import-not-found]
        return project_root()
    except ImportError:
        try:
            return Path.cwd()
        except OSError:
            return None


def collect_burndown_advice(project_root_override: Path | None = None) -> list[str]:
    """Return baseline burn-down advice lines for the architect report.

    Parameters
    ----------
    project_root_override : Path, optional
        Overrides the default ``context.project_root()`` resolution. Tests
        pass a tmp dir to keep filesystem reads hermetic. Production passes
        ``None`` and we resolve internally.

    Returns
    -------
    list[str]
        One advice string per check holding baseline entries, in
        ``(check_name)`` alphabetical order. Empty list when:
          * baseline.json absent (project never initialised the baseline),
          * baseline.json present but empty,
          * project root unresolvable,
          * any I/O or import error reading the baseline (fail-quiet by
            design — burn-down advice must never break the dream tick).
    """
    root = project_root_override if project_root_override is not None else _project_root()
    if root is None:
        return []

    try:
        # Lazy import: keep ``engine.audit`` off the dream module's import-
        # time graph. The dep is real (sibling module under engine/) and
        # should be declared in dream/.dna/module.md dependencies in a
        # follow-up architect pass; the lazy import only defers visibility,
        # not the actual coupling.
        from engine.audit import BaselineStore
    except ImportError:
        return []

    try:
        store = BaselineStore(root)
        if not store.exists():
            # No baseline file at all → nothing to burn down. Graceful
            # degradation per task spec.
            return []
        entries = store.load()
    except (OSError, json.JSONDecodeError, ValueError, RuntimeError):
        # Corrupt baseline.json (BaselineStore wraps JSONDecodeError in
        # RuntimeError), permission error, or any structural defect — we
        # are an advisory helper, never a blocker. Eat the error and skip.
        return []

    if not entries:
        return []

    return _format_advice(entries.values())


def _format_advice(entries: Iterable[object]) -> list[str]:
    """Group baseline entries by check name and render one advice each.

    Each entry is expected to expose a ``.check`` attribute (BaselineEntry
    does). Anything that doesn't is silently skipped — we never want a
    schema drift to take down the burn-down line.
    """
    per_check: dict[str, int] = {}
    for e in entries:
        name = getattr(e, "check", None)
        if not name:
            continue
        per_check[name] = per_check.get(name, 0) + 1

    if not per_check:
        return []

    total = sum(per_check.values())
    lines: list[str] = []
    # Per-check lines first, sorted for stable output.
    for check in sorted(per_check):
        n = per_check[check]
        lines.append(
            f"baseline burn-down: {check} 下还有 {n} 条历史 finding 未消化，"
            f"建议逐条审视后用 `cbim audit baseline clear --check {check}` 消化"
        )
    # Roll-up line at the end so the architect sees the aggregate.
    lines.append(
        f"baseline burn-down 汇总：共 {total} 条历史 finding 待消化，"
        f"涉及 {len(per_check)} 个 check；消化动作仅能通过 CLI 显式触发，治理循环只产建议"
    )
    return lines


__all__ = ["collect_burndown_advice"]
