"""actions/arch_check_gate/scope.py — filter audit findings by touched_modules.

A finding is in scope when its ``target`` (a registered module path like
``v1/kernel/engine/audit``) matches one of the architect-declared
``touched_modules`` entries. Match rule per .dna/module.md decision
"scope_filter is the guard against historical drift":

  * Exact path match: ``finding.target == touched_path`` → in scope.
  * Prefix match with directory boundary: ``finding.target`` starts
    with ``touched_path + "/"`` → in scope (covers descendant modules).
  * Findings without a ``target`` (``None`` or empty string) are
    out-of-scope — they belong to project-wide concerns the gate has
    no authority over.

The naked ``startswith`` is deliberately avoided: ``"foo"`` must not
match ``"foobar"``. The trailing ``"/"`` enforces the boundary.

Both inputs are normalised the same way (strip leading ``"./"``,
trailing ``"/"``) so the gate stays robust to whichever shape the
architect emits in its ``arch_plan``.
"""

from __future__ import annotations

from typing import Iterable

from engine.audit import AuditFinding


def _normalise(p: str) -> str:
    """Canonicalise a module path for prefix comparison.

    Mirrors ``engine.audit.checks.dna_tree._normalise`` semantics: strip
    ``"./"`` prefix and trailing slash. Root path ``"."`` is kept as-is.
    Empty / non-string input collapses to empty string.
    """
    if not isinstance(p, str):
        return ""
    s = p.strip()
    if s.startswith("./"):
        s = s[2:]
    if s != "." and s.endswith("/"):
        s = s.rstrip("/")
    return s


def is_in_scope(finding: AuditFinding, touched_modules: Iterable[str]) -> bool:
    """Return True iff this finding's ``target`` falls under any touched module."""
    target = _normalise(finding.target or "")
    if not target:
        return False
    for raw in touched_modules:
        tp = _normalise(raw)
        if not tp:
            continue
        if target == tp:
            return True
        if target.startswith(tp + "/"):
            return True
    return False


def filter_by_scope(
    findings: list[AuditFinding],
    touched_modules: Iterable[str],
) -> list[AuditFinding]:
    """Return the subset of ``findings`` whose target is in ``touched_modules``.

    Pure: does not mutate the input list and does not modify any finding.
    Order of the returned list mirrors the input order so downstream
    rendering stays stable across runs.
    """
    touched = [_normalise(t) for t in touched_modules if isinstance(t, str)]
    touched = [t for t in touched if t]
    if not touched:
        return []
    return [f for f in findings if is_in_scope(f, touched)]


__all__ = ["filter_by_scope", "is_in_scope"]
