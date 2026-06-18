"""audit/config.py — threshold loading + bands resolver.

Reads the `audit` section of `.cbim/config.json` if present, merging on top of
hardcoded DEFAULTS. Never writes config. Resolves a measured value against a
threshold into one of {"info", "warn", "error"} using:

    info  = 0.80 * threshold <= v < threshold
    warn  = threshold        <= v < 1.50 * threshold
    error = 1.50 * threshold <= v
    (None when v < 0.80 * threshold)
"""

from __future__ import annotations

from copy import deepcopy

from engine.config import load_config

from .result import Severity

DEFAULTS: dict = {
    "memory": {
        "short_max_entries": 80,
        "short_max_age_days": 7,
        "short_max_total_kb": 512,
        "medium_max_entries": 40,
    },
    "agent_fission": {
        "max_body_lines": 250,
        "max_skill_count": 6,
    },
    "dna_fission": {
        "max_body_lines": 350,
        "max_workflow_count": 8,
        # Cross-tree placeholder count (parent module class diagrams). Spec
        # bands are explicit, not ratio-based: 1–5 healthy, 6–10 warn (SUGGEST),
        # ≥11 error (MUST). The threshold names the upper edge of warn — see
        # MODULE-MD-DESIGN.zh-CN.md "单图容量上限". Reach for `resolve_explicit_bands`
        # rather than `resolve_bands` for this kind of explicit ladder.
        "max_cross_tree_placeholders": 10,
    },
    "dna_tree": {
        "allow_undeclared_deps": False,
    },
}

_INFO_FACTOR = 0.80
_ERROR_FACTOR = 1.50


def load_audit_config() -> dict:
    """Return effective audit config = DEFAULTS deep-merged with config.json.audit."""
    cfg = load_config().get("audit") or {}
    merged = deepcopy(DEFAULTS)
    _deep_merge(merged, cfg)
    return merged


def _deep_merge(base: dict, overlay: dict) -> None:
    for k, v in overlay.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v


def resolve_bands(value: float, threshold: float) -> Severity | None:
    """Map a measured value against a threshold to a severity band.

    Returns None when value is below the info band (i.e. healthy).
    """
    if threshold <= 0:
        return None
    if value >= _ERROR_FACTOR * threshold:
        return "error"
    if value >= threshold:
        return "warn"
    if value >= _INFO_FACTOR * threshold:
        return "info"
    return None


def resolve_explicit_bands(
    value: float,
    warn_max: float,
    error_min: float | None = None,
) -> Severity | None:
    """Resolve a value against an explicit two-edge severity ladder.

    Used by checks whose spec defines bands as concrete counts rather than
    ratios off a single threshold (e.g. cross-tree placeholder limit:
    1–5 healthy / 6–10 warn / ≥11 error).

    ``warn_max`` is the inclusive upper edge of the warn band (also the
    `error_min - 1` if ``error_min`` is omitted). ``value > warn_max``
    promotes to error. Below the warn band (``value < warn_min``, where
    ``warn_min = max(1, warn_max // 2 + 1)`` by default) returns None
    (healthy).

    Returns None for healthy / unset thresholds.
    """
    if warn_max <= 0:
        return None
    if error_min is None:
        error_min = warn_max + 1
    if value >= error_min:
        return "error"
    # Anything strictly below `error_min` and at or above 1 unit above the
    # designed-healthy ceiling is a warn. The "healthy ceiling" defaults to
    # half-of-warn-max rounded up — same heuristic the design doc uses for
    # the placeholder ladder (≤5 healthy, 6–10 warn, ≥11 error with
    # warn_max=10 → ceiling=5).
    healthy_ceiling = max(1, int(warn_max) // 2)
    if value > healthy_ceiling:
        return "warn"
    return None
