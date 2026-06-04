"""audit/result.py — AuditFinding / AuditResult dataclasses + JSON helpers.

Pure data; no I/O. Both `report.py` and the JSON CLI mode consume this.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

Severity = Literal["info", "warn", "error"]
Origin = Literal["baseline", "new"]

_SEVERITY_RANK = {"info": 0, "warn": 1, "error": 2}


@dataclass
class AuditFinding:
    check: str
    severity: Severity
    target: str | None
    message: str
    metadata: dict[str, Any] = field(default_factory=dict)
    suggestion: str | None = None
    code: str | None = None
    # T2 baseline ratchet: every finding carries an origin tag. Defaults to
    # "new" so all pre-baseline callers stay zero-change; BaselineStore.classify
    # flips it to "baseline" when the fingerprint is already accepted on disk.
    # Old JSON reports that lack this field are read as "new" (see from_dict).
    origin: Origin = "new"

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "AuditFinding":
        """Construct from a dict (e.g. an older JSON report).

        Missing `origin` is silently coerced to "new" so legacy report files
        round-trip without surprise. Unknown extra keys are ignored.
        """
        return cls(
            check=d["check"],
            severity=d["severity"],
            target=d.get("target"),
            message=d["message"],
            metadata=dict(d.get("metadata") or {}),
            suggestion=d.get("suggestion"),
            code=d.get("code"),
            origin=d.get("origin") or "new",
        )


@dataclass
class AuditResult:
    findings: list[AuditFinding]
    summary: dict
    ran_at: str
    project_root: str
    config_snapshot: dict

    def to_dict(self) -> dict:
        return {
            "findings": [f.to_dict() for f in self.findings],
            "summary": self.summary,
            "ran_at": self.ran_at,
            "project_root": self.project_root,
            "config_snapshot": self.config_snapshot,
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)

    def max_severity(self) -> Severity | None:
        if not self.findings:
            return None
        return max(self.findings, key=lambda f: _SEVERITY_RANK[f.severity]).severity


def severity_rank(s: Severity) -> int:
    return _SEVERITY_RANK[s]
