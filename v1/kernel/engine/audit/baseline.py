"""audit/baseline.py — BaselineStore facade for the audit-ratchet mechanism (T2).

A `baseline` is a set of audit findings the team has explicitly accepted as
"already known, do not block CI on it". The store lives at
`.cbim/audit/baseline.json` and is the single source of truth for which
findings carry `origin="baseline"` vs `origin="new"`.

Design contract (mirrors `.dna/module.md` Key Decisions):

  * Read-only by run_audit. `run_audit` only calls `load()` + `classify()`;
    it never writes. Writes are explicit human gestures driven from CLI
    (`cbim audit baseline accept --yes ...`).
  * Atomic writes via tempfile + os.replace. No file lock — writes happen
    only at the CLI, single-process, single-flight by construction.
  * Fingerprint = sha256(check | code | target | sha256(message)). The hash
    of `message` is folded in so editing a finding's wording invalidates the
    baseline acceptance — prevents "rename a message to silently downgrade".
  * Fingerprint is the dedupe key. accept() merges into the existing set.

This module owns NO severity logic — the ratchet (downgrade table) lives in
`ratchet.py`. Baseline only answers: "is this finding fingerprint already
accepted? If yes, tag origin='baseline'; else tag origin='new'."
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .result import AuditFinding

BASELINE_REL_PATH = Path(".cbim") / "audit" / "baseline.json"
_BASELINE_SCHEMA_VERSION = 1


def fingerprint(finding: AuditFinding) -> str:
    """Stable hash that identifies a finding for baseline dedupe.

    Folds in sha256(message) rather than message itself so that:
      (a) Message wording changes invalidate the baseline entry — caller
          must re-accept. Prevents "edit description, silently downgrade".
      (b) The on-disk fingerprint stays short (64-char hex) regardless of
          how long the underlying message is.

    target=None and code=None are normalised to empty string so the hash
    function is total over all AuditFinding values.
    """
    check = finding.check or ""
    code = finding.code or ""
    target = finding.target or ""
    msg = finding.message or ""
    msg_hash = hashlib.sha256(msg.encode("utf-8")).hexdigest()
    payload = f"{check}|{code}|{target}|{msg_hash}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


@dataclass
class BaselineEntry:
    """One row in the baseline file.

    `accepted_at` is purely advisory metadata for humans reading the file;
    it never participates in fingerprinting or dedupe.
    """
    fingerprint: str
    check: str
    code: str | None
    target: str | None
    message: str
    accepted_at: str

    def to_dict(self) -> dict:
        return {
            "fingerprint": self.fingerprint,
            "check": self.check,
            "code": self.code,
            "target": self.target,
            "message": self.message,
            "accepted_at": self.accepted_at,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "BaselineEntry":
        return cls(
            fingerprint=d["fingerprint"],
            check=d.get("check", ""),
            code=d.get("code"),
            target=d.get("target"),
            message=d.get("message", ""),
            accepted_at=d.get("accepted_at", ""),
        )


class BaselineStore:
    """Per-project baseline file facade.

    Construct with the project root (the directory containing `.cbim/`);
    the store reads/writes `.cbim/audit/baseline.json` underneath it.

    Public surface intentionally tiny: load / accept / clear / list /
    classify / fingerprint(static). Anything more elaborate (diff, status)
    is composed by the CLI layer on top of these primitives.
    """

    def __init__(self, project_root: Path | str) -> None:
        self._root = Path(project_root).resolve()
        self._path = self._root / BASELINE_REL_PATH

    # --- path helpers ----------------------------------------------------

    @property
    def path(self) -> Path:
        return self._path

    def exists(self) -> bool:
        return self._path.is_file()

    # --- IO --------------------------------------------------------------

    def load(self) -> dict[str, BaselineEntry]:
        """Return {fingerprint: entry}. Missing file → empty dict."""
        if not self._path.is_file():
            return {}
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise RuntimeError(
                f"baseline file is not valid JSON: {self._path} ({e})"
            ) from e
        entries = raw.get("entries") or []
        out: dict[str, BaselineEntry] = {}
        for d in entries:
            try:
                e = BaselineEntry.from_dict(d)
            except KeyError:
                continue
            out[e.fingerprint] = e
        return out

    def save(self, entries: dict[str, BaselineEntry]) -> None:
        """Atomic write: tempfile in same dir + os.replace.

        Same-directory tempfile guarantees the rename is on one filesystem,
        which means os.replace is atomic on POSIX and atomic-enough on
        Windows (atomic since NTFS; survives a crash mid-write).
        """
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema_version": _BASELINE_SCHEMA_VERSION,
            "saved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "entries": [
                e.to_dict()
                for e in sorted(entries.values(), key=lambda e: (e.check, e.code or "", e.target or "", e.fingerprint))
            ],
        }
        body = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
        # NamedTemporaryFile + manual rename keeps us off shutil.move's
        # cross-device copy fallback.
        fd, tmp_path = tempfile.mkstemp(
            prefix=".baseline.", suffix=".json.tmp", dir=str(self._path.parent)
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fp:
                fp.write(body)
            os.replace(tmp_path, self._path)
        except Exception:
            # Best-effort cleanup of the tempfile if replace failed.
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    # --- mutating operations (explicit human commands) ------------------

    def accept(self, findings: Iterable[AuditFinding]) -> int:
        """Add findings to the baseline. Returns number of NEW entries added.

        Re-accepting an already-baselined finding (same fingerprint) is a
        no-op for that entry; the rest still go in.
        """
        existing = self.load()
        added = 0
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for f in findings:
            fp = fingerprint(f)
            if fp in existing:
                continue
            existing[fp] = BaselineEntry(
                fingerprint=fp,
                check=f.check,
                code=f.code,
                target=f.target,
                message=f.message,
                accepted_at=now,
            )
            added += 1
        if added > 0:
            self.save(existing)
        return added

    def clear(self, checks: Iterable[str] | None = None) -> int:
        """Drop baselined entries. With `checks` filter, only drop matching.

        Returns number of entries removed. If the file would become empty
        it is still written (empty `entries` list) rather than deleted —
        keeps the path stable for downstream consumers (CI inspectors etc.).
        """
        existing = self.load()
        if not existing:
            return 0
        if checks is None:
            removed = len(existing)
            self.save({})
            return removed
        check_set = set(checks)
        kept = {fp: e for fp, e in existing.items() if e.check not in check_set}
        removed = len(existing) - len(kept)
        if removed > 0:
            self.save(kept)
        return removed

    def list(self) -> list[BaselineEntry]:
        """Return baseline entries sorted by (check, code, target) for display."""
        return sorted(
            self.load().values(),
            key=lambda e: (e.check, e.code or "", e.target or "", e.fingerprint),
        )

    # --- read-only classification (used by run_audit) -------------------

    def classify(self, findings: list[AuditFinding]) -> list[AuditFinding]:
        """Stamp each finding's `origin` based on the current baseline.

        Mutates findings in place AND returns the same list, so callers can
        chain or ignore the return value. Findings whose fingerprint is in
        the baseline get `origin="baseline"`; everything else keeps the
        default `origin="new"`.

        If the baseline file is absent, every finding stays `origin="new"`
        — which is the audit's documented zero-state behaviour.
        """
        accepted = self.load()
        if not accepted:
            for f in findings:
                f.origin = "new"
            return findings
        for f in findings:
            if fingerprint(f) in accepted:
                f.origin = "baseline"
            else:
                f.origin = "new"
        return findings

    # --- convenience reflection ----------------------------------------

    @staticmethod
    def fingerprint(finding: AuditFinding) -> str:
        """Expose the module-level fingerprint helper on the class too."""
        return fingerprint(finding)


__all__ = [
    "BaselineStore",
    "BaselineEntry",
    "BASELINE_REL_PATH",
    "fingerprint",
]
