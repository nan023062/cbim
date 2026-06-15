"""audit/cli.py — `cbim audit ...` subparser + dispatch.

Subcommands:
  run [--severity {info,warn,error}] [--check NAME ...] [--json]
      [--baseline-mode {ignore,lenient,strict}]
  index | memory | agents | dna | tree         (single-check aliases)
  list-checks
  baseline init | accept [--check NAME ...] --yes | status | diff | clear

Exit codes (based on the post-filter findings):
  0   no findings, or highest severity = info
  1   highest severity = warn
  2   highest severity = error

Default exit-code gating considers only `origin="new"` findings — that is
the whole point of the baseline ratchet: previously-accepted drift does
not block CI. `--baseline-mode=ignore` reverts to full-population gating
for one-shot total inspection.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from context import resolve_root_or_cwd as find_project_root

from . import list_checks, run_audit
from .baseline import BaselineStore, fingerprint
from .registry import CHECKS
from .report import to_json, to_stdout
from .result import AuditFinding

_SEVERITY_EXIT = {None: 0, "info": 0, "warn": 1, "error": 2}
_SEVERITY_RANK = {"info": 0, "warn": 1, "error": 2}

_SINGLE_CHECK_ALIAS = {
    "index": "index_consistency",
    "memory": "memory_threshold",
    "agents": "agent_fission",
    "dna": "dna_fission",
    "tree": "dna_tree",
}

_BASELINE_MODES = ("ignore", "lenient", "strict")


def register_audit_subparser(parser: argparse.ArgumentParser) -> None:
    sub = parser.add_subparsers(dest="audit_command")

    run_p = sub.add_parser("run", help="Run governance drift checks")
    run_p.add_argument(
        "--severity",
        choices=["info", "warn", "error"],
        default=None,
        help="Only display findings at or above this severity (also affects exit code).",
    )
    run_p.add_argument(
        "--check",
        action="append",
        default=None,
        choices=sorted(CHECKS.keys()),
        help="Run only the named check (repeatable). Default: all checks.",
    )
    run_p.add_argument("--json", action="store_true", help="Emit JSON instead of text.")
    run_p.add_argument(
        "--baseline-mode",
        dest="baseline_mode",
        choices=_BASELINE_MODES,
        default="lenient",
        help=(
            "How to apply the audit baseline (default: lenient). "
            "ignore = no baseline classification, exit code from ALL findings; "
            "lenient = classify + downgrade baseline-origin findings one notch "
            "on lenient checks, exit code from new-origin only; "
            "strict = classify but never downgrade, exit code from new-origin only."
        ),
    )

    for alias in _SINGLE_CHECK_ALIAS:
        ap = sub.add_parser(alias, help=f"Alias for `run --check {_SINGLE_CHECK_ALIAS[alias]}`")
        ap.add_argument("--severity", choices=["info", "warn", "error"], default=None)
        ap.add_argument("--json", action="store_true")
        ap.add_argument(
            "--baseline-mode",
            dest="baseline_mode",
            choices=_BASELINE_MODES,
            default="lenient",
        )

    sub.add_parser("list-checks", help="Print available check names.")

    # -- baseline ratchet management ---------------------------------------
    bl = sub.add_parser(
        "baseline",
        help="Manage the audit baseline (.cbim/audit/baseline.json)",
    )
    bsub = bl.add_subparsers(dest="baseline_command")

    bsub.add_parser(
        "init",
        help="Create an empty baseline file (no-op if one exists).",
    )

    bl_accept = bsub.add_parser(
        "accept",
        help=(
            "Accept current new-origin findings into the baseline. "
            "Requires --yes (no implicit acceptance)."
        ),
    )
    bl_accept.add_argument(
        "--check",
        action="append",
        default=None,
        choices=sorted(CHECKS.keys()),
        help="Only accept findings from this check (repeatable). Default: all checks.",
    )
    bl_accept.add_argument(
        "--severity",
        choices=["info", "warn", "error"],
        default=None,
        help="Only accept findings at or above this severity.",
    )
    bl_accept.add_argument(
        "--yes",
        action="store_true",
        help="Required confirmation. Without --yes, accept is a dry-run preview.",
    )

    bsub.add_parser(
        "status",
        help="Show baseline file path, entry count, breakdown by check.",
    )

    bsub.add_parser(
        "diff",
        help=(
            "Compare current audit findings against the baseline. "
            "Lists new-origin and resolved (baseline-but-no-longer-present) entries."
        ),
    )

    bl_clear = bsub.add_parser(
        "clear",
        help="Remove baseline entries (all, or for selected checks).",
    )
    bl_clear.add_argument(
        "--check",
        action="append",
        default=None,
        choices=sorted(CHECKS.keys()),
        help="Only clear entries for this check (repeatable). Default: clear all.",
    )
    bl_clear.add_argument(
        "--yes",
        action="store_true",
        help="Required confirmation. Without --yes, clear is a dry-run preview.",
    )


def dispatch(args) -> int:
    cmd = getattr(args, "audit_command", None)
    if cmd is None:
        print(
            "usage: cbim audit {run,index,memory,agents,dna,tree,list-checks,baseline}",
            file=sys.stderr,
        )
        return 1

    if cmd == "list-checks":
        for name in list_checks():
            print(name)
        return 0

    if cmd in _SINGLE_CHECK_ALIAS:
        return _run(
            checks=[_SINGLE_CHECK_ALIAS[cmd]],
            severity=getattr(args, "severity", None),
            as_json=getattr(args, "json", False),
            baseline_mode=getattr(args, "baseline_mode", "lenient"),
        )

    if cmd == "run":
        return _run(
            checks=getattr(args, "check", None),
            severity=getattr(args, "severity", None),
            as_json=getattr(args, "json", False),
            baseline_mode=getattr(args, "baseline_mode", "lenient"),
        )

    if cmd == "baseline":
        return _dispatch_baseline(args)

    print(f"audit: unknown subcommand {cmd!r}", file=sys.stderr)
    return 1


# ---------------------------------------------------------------------------
# `cbim audit run` (+ single-check aliases)
# ---------------------------------------------------------------------------

def _run(
    *,
    checks: list[str] | None,
    severity: str | None,
    as_json: bool,
    baseline_mode: str,
) -> int:
    root = Path(find_project_root(None))
    try:
        result = run_audit(root, checks=checks, baseline_mode=baseline_mode)
    except ValueError as e:
        print(f"audit: {e}", file=sys.stderr)
        return 1

    if severity is not None:
        min_rank = _SEVERITY_RANK[severity]
        result.findings = [
            f for f in result.findings if _SEVERITY_RANK[f.severity] >= min_rank
        ]
        result.summary["total"] = len(result.findings)
        for s in ("error", "warn", "info"):
            result.summary[s] = sum(1 for f in result.findings if f.severity == s)
        result.summary["by_origin"] = {
            "new": sum(1 for f in result.findings if f.origin == "new"),
            "baseline": sum(1 for f in result.findings if f.origin == "baseline"),
        }

    if as_json:
        sys.stdout.write(to_json(result) + "\n")
    else:
        sys.stdout.write(to_stdout(result))

    return _exit_code(result.findings, baseline_mode)


def _exit_code(findings: list[AuditFinding], baseline_mode: str) -> int:
    """Compute exit code from the (possibly filtered) findings.

    Default semantics: only `origin="new"` findings count toward exit code.
    That is the ratchet's CI contract — previously-accepted drift no longer
    fails the build. `--baseline-mode=ignore` reverts to full-population
    gating so a human can run a one-shot total inspection without first
    blowing away the baseline file.
    """
    if baseline_mode == "ignore":
        considered = findings
    else:
        considered = [f for f in findings if f.origin == "new"]
    if not considered:
        return 0
    max_sev = max(considered, key=lambda f: _SEVERITY_RANK[f.severity]).severity
    return _SEVERITY_EXIT[max_sev]


# ---------------------------------------------------------------------------
# `cbim audit baseline ...`
# ---------------------------------------------------------------------------

def _dispatch_baseline(args) -> int:
    sub = getattr(args, "baseline_command", None)
    if sub is None:
        print(
            "usage: cbim audit baseline {init,accept,status,diff,clear}",
            file=sys.stderr,
        )
        return 1

    root = Path(find_project_root(None))
    store = BaselineStore(root)

    if sub == "init":
        return _baseline_init(store)
    if sub == "status":
        return _baseline_status(store)
    if sub == "diff":
        return _baseline_diff(store, root)
    if sub == "accept":
        return _baseline_accept(
            store, root,
            checks=getattr(args, "check", None),
            severity=getattr(args, "severity", None),
            yes=bool(getattr(args, "yes", False)),
        )
    if sub == "clear":
        return _baseline_clear(
            store,
            checks=getattr(args, "check", None),
            yes=bool(getattr(args, "yes", False)),
        )

    print(f"audit baseline: unknown subcommand {sub!r}", file=sys.stderr)
    return 1


def _baseline_init(store: BaselineStore) -> int:
    if store.exists():
        print(f"baseline already exists: {store.path}")
        return 0
    store.save({})
    print(f"baseline initialised (empty): {store.path}")
    return 0


def _baseline_status(store: BaselineStore) -> int:
    if not store.exists():
        print(f"baseline: not initialised (no {store.path})")
        print("hint: run `cbim audit baseline init` to create an empty baseline")
        return 0
    entries = store.list()
    print(f"baseline: {store.path}")
    print(f"  entries: {len(entries)}")
    if not entries:
        return 0
    by_check: dict[str, int] = {}
    for e in entries:
        by_check[e.check] = by_check.get(e.check, 0) + 1
    print("  by check:")
    for c in sorted(by_check):
        print(f"    {c:24s}  {by_check[c]}")
    return 0


def _baseline_diff(store: BaselineStore, root: Path) -> int:
    """Show new-origin findings + resolved entries vs the current baseline.

    Always runs the full check set, in `strict` mode (classify-but-don't-
    downgrade), so the operator sees raw severities of new findings rather
    than ratcheted-down ones.
    """
    try:
        result = run_audit(root, baseline_mode="strict")
    except ValueError as e:
        print(f"audit: {e}", file=sys.stderr)
        return 1
    accepted = store.load()
    seen_fps: set[str] = set()
    new_findings: list[AuditFinding] = []
    for f in result.findings:
        fp = fingerprint(f)
        seen_fps.add(fp)
        if f.origin == "new":
            new_findings.append(f)
    resolved = [e for fp, e in accepted.items() if fp not in seen_fps]

    print(f"baseline: {store.path}")
    print(f"  baseline entries:    {len(accepted)}")
    print(f"  new-origin findings: {len(new_findings)}")
    print(f"  resolved (gone):     {len(resolved)}")

    if new_findings:
        print("\n--- New findings (not in baseline) ---")
        for f in sorted(new_findings, key=lambda f: (f.check, f.code or "", f.target or "")):
            tgt = f.target or "-"
            print(f"  [{f.severity:5s}] {f.check}/{f.code or '?'} :: {tgt} :: {f.message}")
    if resolved:
        print("\n--- Resolved (in baseline, no longer detected) ---")
        for e in sorted(resolved, key=lambda e: (e.check, e.code or "", e.target or "")):
            tgt = e.target or "-"
            print(f"  {e.check}/{e.code or '?'} :: {tgt} :: {e.message}")
    return 0


def _baseline_accept(
    store: BaselineStore,
    root: Path,
    *,
    checks: list[str] | None,
    severity: str | None,
    yes: bool,
) -> int:
    """Accept current new-origin findings into the baseline.

    Always runs in `strict` mode so the operator accepts raw severities,
    not ratcheted-down ones. `--yes` is mandatory; without it the command
    prints what would be accepted and exits 0 without writing.
    """
    try:
        result = run_audit(root, checks=checks, baseline_mode="strict")
    except ValueError as e:
        print(f"audit: {e}", file=sys.stderr)
        return 1

    candidates = [f for f in result.findings if f.origin == "new"]
    if severity is not None:
        min_rank = _SEVERITY_RANK[severity]
        candidates = [f for f in candidates if _SEVERITY_RANK[f.severity] >= min_rank]

    if not candidates:
        print("baseline accept: no new-origin findings to accept; baseline unchanged")
        return 0

    print(f"baseline accept: {len(candidates)} new finding(s) would be accepted:")
    for f in sorted(candidates, key=lambda f: (f.check, f.code or "", f.target or "")):
        tgt = f.target or "-"
        print(f"  [{f.severity:5s}] {f.check}/{f.code or '?'} :: {tgt} :: {f.message}")

    if not yes:
        print("\nDry-run (no --yes); baseline file NOT written.")
        print(f"Run again with --yes to commit to {store.path}")
        return 0

    added = store.accept(candidates)
    print(f"\nbaseline accept: wrote {added} new entry(ies) -> {store.path}")
    return 0


def _baseline_clear(
    store: BaselineStore,
    *,
    checks: list[str] | None,
    yes: bool,
) -> int:
    if not store.exists():
        print(f"baseline: not initialised (no {store.path}); nothing to clear")
        return 0
    existing = store.load()
    if not existing:
        print("baseline: already empty; nothing to clear")
        return 0
    if checks:
        target = [e for e in existing.values() if e.check in set(checks)]
    else:
        target = list(existing.values())
    if not target:
        print(
            f"baseline clear: no entries matched filter checks={checks}; "
            "baseline unchanged"
        )
        return 0

    print(f"baseline clear: {len(target)} entry(ies) would be removed:")
    for e in sorted(target, key=lambda e: (e.check, e.code or "", e.target or "")):
        tgt = e.target or "-"
        print(f"  {e.check}/{e.code or '?'} :: {tgt} :: {e.message}")

    if not yes:
        print("\nDry-run (no --yes); baseline file NOT written.")
        return 0

    removed = store.clear(checks=checks)
    print(f"\nbaseline clear: removed {removed} entry(ies) from {store.path}")
    return 0
