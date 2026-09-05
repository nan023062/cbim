"""Explicit memory maintenance helpers.

These operations are available only through an explicit user request; no
lifecycle hook or background process invokes them.
"""

from .archiver import sweep_expired
from .candidates import CANDIDATES_SUBDIR, CandidatesArea
from .compactor import CompactionReport, compact
from .health import HealthChecker, HealthReport
from .promote_builder import scan_for_promote_candidates
from .rebuilder import rebuild

__all__ = [
    "CANDIDATES_SUBDIR",
    "CandidatesArea",
    "CompactionReport",
    "HealthChecker",
    "HealthReport",
    "compact",
    "rebuild",
    "scan_for_promote_candidates",
    "sweep_expired",
]
