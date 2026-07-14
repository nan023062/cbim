"""checks/dna_notes.py — DNA module note-layer drift detection.

Findings:
  DNA_NOTE_OVERLOAD     info/warn/error  module owns too many notes under
                                          ``.dna/notes/``
  DNA_NOTE_STALE_RATIO  info/warn/error  ratio of stale notes (per-module)
                                          exceeds threshold; a note is
                                          "stale" when its ``last_reviewed``
                                          is older than the module.md
                                          ``body_edited_at`` stamp (missing
                                          ``last_reviewed`` counts as stale
                                          by construction)
  DNA_NOTE_DRAFT_STUCK  info/warn/error  a ``status="draft"`` note has not
                                          been reviewed/promoted for longer
                                          than the configured threshold —
                                          per-note finding

Metadata contract:
  ``DNA_NOTE_DRAFT_STUCK`` will fire daily on the same note, with the day
  count creeping up on every run. To keep the baseline fingerprint stable
  (see ``dna_freshness`` for the same invariant), the human ``message``
  stays static and the mutable values (``days_stuck``, ``last_reviewed``,
  reference kind) live in ``metadata`` — the audit baseline hashes over
  message text, so any daily-mutating string in the message would defeat
  ``cbim audit baseline accept``.

  ``DNA_NOTE_OVERLOAD`` and ``DNA_NOTE_STALE_RATIO`` fire per-module and
  carry counts / ratios in the message the same way ``dna_fission`` does
  for workflow overload — those numbers only shift when notes are added
  or reviewed, not on a wall-clock cadence.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path

from cbi._primitives.modules.notes_frontmatter_schema import (
    _NOTE_FM_STATUS_VALUES,
)
from services import get_module as _service_get_module
from services import list_modules as _service_list_modules
from services._fm import parse_frontmatter

from ..config import resolve_bands
from ..result import AuditFinding


# Draft status constant — the enum value declared in Task 0's note
# frontmatter schema. Import the tuple so a rename there breaks this
# check loudly rather than silently mis-matching a stringly-typed literal.
_STATUS_DRAFT = "draft"
assert _STATUS_DRAFT in _NOTE_FM_STATUS_VALUES, (
    f"_STATUS_DRAFT drifted out of {_NOTE_FM_STATUS_VALUES!r}"
)

# module.md frontmatter key for the freshness stamp. Mirrors
# ``dna_freshness._STAMP_KEY`` — kept local so we don't import a private
# name from a peer check.
_BODY_EDITED_AT_KEY = "body_edited_at"


def check(project_root: Path, config: dict) -> list[AuditFinding]:
    findings: list[AuditFinding] = []
    cfg = config.get("dna_notes", {})
    max_note_count = int(cfg.get("max_note_count", 20))
    max_stale_ratio_pct = float(cfg.get("max_stale_ratio_pct", 30))
    max_draft_stuck_days = int(cfg.get("max_draft_stuck_days", 30))

    modules = list(_service_list_modules(cwd=str(project_root)))
    if not modules:
        return findings

    now_utc = datetime.now(timezone.utc)

    for m in modules:
        rel_path = (m.get("path") or m.get("id") or "").strip()
        if not rel_path:
            continue

        # Task 0's contract: `get_module` returns `notes: list[{slug,
        # title, intent, status, last_reviewed}]`. Reuse it instead of
        # walking the filesystem ourselves so any future schema change
        # ripples through get_module and this check picks it up for free.
        mod = _service_get_module(rel_path, cwd=str(project_root))
        if mod is None:
            continue
        notes = mod.get("notes") or []

        # 1) DNA_NOTE_OVERLOAD
        note_count = len(notes)
        sev = resolve_bands(note_count, max_note_count)
        if sev:
            findings.append(AuditFinding(
                check="dna_notes",
                severity=sev,
                target=rel_path,
                message=(
                    f"module {rel_path!r} owns {note_count} notes "
                    f"(threshold {max_note_count})"
                ),
                suggestion=(
                    "Note sprawl usually signals the module has accumulated "
                    "multiple supplement themes; consider splitting the "
                    "module or promoting long-lived notes into module body "
                    "sections."
                ),
                code="DNA_NOTE_OVERLOAD",
                metadata={"count": note_count, "threshold": max_note_count},
            ))

        # 2) DNA_NOTE_STALE_RATIO — needs module.md body_edited_at as the
        # comparison anchor. When the module has no stamp (pre-migration),
        # there's nothing to be stale against; skip stale-ratio for this
        # module but keep the other two checks running.
        module_dir = (
            project_root if rel_path == "." else (project_root / rel_path)
        )
        body_edited_at = _read_body_edited_at(module_dir)

        if note_count > 0 and body_edited_at is not None:
            stale_count = 0
            for n in notes:
                if _is_note_stale(n, body_edited_at):
                    stale_count += 1
            pct = (stale_count * 100.0) / note_count
            sev = resolve_bands(pct, max_stale_ratio_pct)
            if sev:
                findings.append(AuditFinding(
                    check="dna_notes",
                    severity=sev,
                    target=rel_path,
                    message=(
                        f"module {rel_path!r} has {stale_count}/{note_count} "
                        f"notes stale relative to module.md body_edited_at "
                        f"(threshold {int(max_stale_ratio_pct)}%)"
                    ),
                    suggestion=(
                        "Review stale notes and refresh `last_reviewed` "
                        "(kebab-date, e.g. 2026-07-10) on each note whose "
                        "content still holds, or update the note body and "
                        "let the reviewer bump the stamp."
                    ),
                    code="DNA_NOTE_STALE_RATIO",
                    metadata={
                        "stale_count": stale_count,
                        "total_count": note_count,
                        "stale_pct": round(pct, 2),
                        "threshold_pct": max_stale_ratio_pct,
                        "body_edited_at": _iso(body_edited_at),
                    },
                ))

        # 3) DNA_NOTE_DRAFT_STUCK — per-note. Skips notes that aren't in
        # draft state; reference time is `last_reviewed` (preferred), else
        # the note file's mtime (last-touched fallback so a draft that
        # never got a `last_reviewed` still ages).
        for n in notes:
            if n.get("status") != _STATUS_DRAFT:
                continue
            slug = n.get("slug") or ""
            if not slug:
                continue
            ref_kind, ref_dt = _draft_reference(module_dir, n)
            if ref_dt is None:
                continue
            days_stuck = (now_utc - ref_dt).days
            if days_stuck <= 0:
                continue
            sev = resolve_bands(days_stuck, max_draft_stuck_days)
            if sev is None:
                continue
            findings.append(AuditFinding(
                check="dna_notes",
                severity=sev,
                target=f"{rel_path}/notes/{slug}",
                message=(
                    f"draft note {slug!r} under {rel_path!r} has not been "
                    "reviewed within the configured window"
                ),
                suggestion=(
                    "Either promote the note to `status: reviewed` (bumping "
                    "`last_reviewed`), rewrite it and re-review, or delete "
                    "it if the draft never materialised."
                ),
                code="DNA_NOTE_DRAFT_STUCK",
                metadata={
                    "days_stuck": int(days_stuck),
                    "threshold_days": max_draft_stuck_days,
                    "reference_kind": ref_kind,
                    "reference_at": _iso(ref_dt),
                    "status": _STATUS_DRAFT,
                    "intent": n.get("intent"),
                    "last_reviewed": n.get("last_reviewed"),
                },
            ))

    return findings


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _read_body_edited_at(module_dir: Path) -> datetime | None:
    """Return the module's ``body_edited_at`` as a tz-aware UTC datetime.

    Mirrors ``dna_freshness._read_stamp_from_disk`` semantics — direct
    frontmatter read because ``services.list_modules`` doesn't currently
    flatten this field onto its output dict. Missing / malformed stamp
    returns None so the stale-ratio computation can skip the module
    without exploding.
    """
    module_md = module_dir / ".dna" / "module.md"
    try:
        raw = module_md.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    try:
        meta = parse_frontmatter(raw)
    except ValueError:
        return None
    value = meta.get(_BODY_EDITED_AT_KEY)
    if not isinstance(value, str) or not value:
        return None
    return _parse_iso_ts(value)


def _is_note_stale(note: dict, body_edited_at: datetime) -> bool:
    """Return True when this note's ``last_reviewed`` is older than
    ``body_edited_at``.

    Missing ``last_reviewed`` is stale by convention (a never-reviewed
    note can't claim to be current). Malformed timestamps are also
    treated as stale — the reviewer should fix the stamp shape as a
    side effect of the next review pass.
    """
    lr = note.get("last_reviewed")
    if not isinstance(lr, str) or not lr.strip():
        return True
    lr_dt = _parse_iso_ts(lr)
    if lr_dt is None:
        return True
    return lr_dt < body_edited_at


def _draft_reference(
    module_dir: Path, note: dict
) -> tuple[str, datetime | None]:
    """Return the (kind, timestamp) tuple used to age a draft note.

    Prefers a parsed ``last_reviewed`` timestamp; when that field is
    absent or unparseable, falls back to the note file's mtime.
    ``kind`` is ``"last_reviewed"`` or ``"mtime"`` for the finding's
    metadata trail. Returns ``(None, None)`` when neither is available
    — the caller should skip the finding in that case.
    """
    lr = note.get("last_reviewed")
    if isinstance(lr, str) and lr.strip():
        dt = _parse_iso_ts(lr)
        if dt is not None:
            return "last_reviewed", dt

    slug = note.get("slug") or ""
    if not slug:
        return "mtime", None
    note_path = module_dir / ".dna" / "notes" / f"{slug}.md"
    try:
        mtime = note_path.stat().st_mtime
    except (OSError, FileNotFoundError):
        return "mtime", None
    return "mtime", datetime.fromtimestamp(mtime, tz=timezone.utc)


def _parse_iso_ts(value: str) -> datetime | None:
    """Parse an ISO-8601 date or datetime into a tz-aware UTC datetime.

    Bare dates (``"2026-07-09"``) are anchored to UTC midnight so the
    caller can compare them against a full ``body_edited_at`` timestamp
    without mixing naive and aware values. Trailing ``Z`` is normalised
    to ``+00:00`` for Python 3.11 fromisoformat portability. Naive
    datetimes (no explicit offset) are coerced to UTC — the note
    frontmatter schema keeps ``last_reviewed`` permissive on shape and
    the audit check is not the right place to reject that.
    """
    if not isinstance(value, str):
        return None
    v = value.strip()
    if not v:
        return None
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    try:
        parsed: date | datetime = datetime.fromisoformat(v)
    except ValueError:
        # ``date.fromisoformat`` handles ``"YYYY-MM-DD"`` explicitly on
        # older Python versions where ``datetime.fromisoformat`` refuses
        # a bare date; 3.11+ accepts both. Belt-and-braces path.
        try:
            parsed = date.fromisoformat(v)
        except ValueError:
            return None
    if isinstance(parsed, datetime):
        dt = parsed
    else:
        dt = datetime(parsed.year, parsed.month, parsed.day)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _iso(dt: datetime) -> str:
    """Serialise a datetime as ISO-8601 with second precision (UTC 'Z')."""
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )
