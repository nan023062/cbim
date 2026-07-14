"""Unit tests for engine.audit.checks.dna_notes.

Three findings under one check name (``dna_notes``):

  * ``DNA_NOTE_OVERLOAD``     — per-module note count exceeds threshold
  * ``DNA_NOTE_STALE_RATIO``  — per-module stale-note ratio exceeds threshold
                                (stale = note ``last_reviewed`` older than
                                module.md ``body_edited_at``; missing
                                ``last_reviewed`` counts as stale)
  * ``DNA_NOTE_DRAFT_STUCK``  — per-note; a ``status="draft"`` note has
                                not been reviewed within the configured
                                window (reference: ``last_reviewed`` if
                                set, else the note file's mtime)

All three read the module list via ``services.list_modules`` + Task 0's
``services.get_module`` notes contract — the check never re-scans the
filesystem itself.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from engine.audit.checks.dna_notes import check


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _seed_index(root: Path, registered: list[str]) -> None:
    (root / ".cbim").mkdir(parents=True, exist_ok=True)
    lines = ["# Module Index", ""] + [f"- {e}" for e in registered]
    (root / ".cbim" / "index.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )


def _write_module(
    root: Path,
    rel: str,
    *,
    body_edited_at: str | None = None,
) -> Path:
    """Create ``<rel>/.dna/module.md`` and return its module dir."""
    mod = root if rel == "." else (root / rel)
    dna = mod / ".dna"
    dna.mkdir(parents=True, exist_ok=True)
    fm_lines = [
        "---",
        f"name: {rel}",
        "owner: x",
        "description: m",
        "keywords: []",
        "status: implemented",
    ]
    if body_edited_at is not None:
        fm_lines.append(f"body_edited_at: {body_edited_at}")
    fm_lines.append("---")
    (dna / "module.md").write_text(
        "\n".join(fm_lines) + "\n\nbody\n", encoding="utf-8"
    )
    return mod


def _write_note(
    mod_dir: Path,
    slug: str,
    *,
    title: str = "Sample",
    intent: str | None = "rationale",
    status: str = "draft",
    last_reviewed: str | None = None,
    mtime_days_ago: int | None = None,
) -> Path:
    """Create a note file. ``mtime_days_ago`` retroactively sets os.utime."""
    notes_dir = mod_dir / ".dna" / "notes"
    notes_dir.mkdir(parents=True, exist_ok=True)
    fm_lines = [
        "---",
        f"title: {title}",
    ]
    if intent is not None:
        fm_lines.append(f"intent: {intent}")
    fm_lines.append(f"status: {status}")
    if last_reviewed is not None:
        fm_lines.append(f"last_reviewed: {last_reviewed}")
    fm_lines.append("---")
    note_path = notes_dir / f"{slug}.md"
    note_path.write_text(
        "\n".join(fm_lines) + "\n\nnote body\n", encoding="utf-8"
    )
    if mtime_days_ago is not None:
        target_ts = time.time() - mtime_days_ago * 86400
        os.utime(note_path, (target_ts, target_ts))
    return note_path


def _cfg(**overrides) -> dict:
    """Assemble a dna_notes config dict for tests."""
    base = {
        "max_note_count": 20,
        "max_stale_ratio_pct": 30,
        "max_draft_stuck_days": 30,
    }
    base.update(overrides)
    return {"dna_notes": base}


# ---------------------------------------------------------------------------
# Empty / clean cases
# ---------------------------------------------------------------------------


def test_no_modules_returns_empty(tmp_path):
    """Fresh project with an empty registry yields no findings."""
    _seed_index(tmp_path, [])
    assert check(tmp_path, _cfg()) == []


def test_module_without_notes_yields_no_findings(tmp_path):
    """A module with 0 notes never triggers overload / stale-ratio /
    draft-stuck — division-by-zero guarded, count-below-info-band."""
    _seed_index(tmp_path, ["alpha"])
    _write_module(tmp_path, "alpha", body_edited_at="2026-06-01T12:00:00Z")
    findings = check(tmp_path, _cfg())
    assert findings == []


def test_clean_module_with_fresh_notes_no_findings(tmp_path):
    """Two reviewed notes, all fresh, well below overload threshold."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2026-06-01T12:00:00Z"
    )
    _write_note(
        mod, "note-one", status="reviewed",
        last_reviewed="2026-06-05",
    )
    _write_note(
        mod, "note-two", status="reviewed",
        last_reviewed="2026-06-05",
    )
    assert check(tmp_path, _cfg()) == []


# ---------------------------------------------------------------------------
# DNA_NOTE_OVERLOAD
# ---------------------------------------------------------------------------


def test_note_overload_warn(tmp_path):
    """count == threshold → warn severity."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2020-01-01T00:00:00Z"
    )
    # 5 fresh reviewed notes; threshold 5 → warn (count >= threshold).
    for i in range(5):
        _write_note(
            mod, f"n{i}", status="reviewed",
            last_reviewed="2030-01-01",  # future -> not stale
        )
    findings = check(tmp_path, _cfg(max_note_count=5))
    ov = [f for f in findings if f.code == "DNA_NOTE_OVERLOAD"]
    assert len(ov) == 1
    assert ov[0].severity == "warn"
    assert ov[0].target == "alpha"
    assert ov[0].metadata == {"count": 5, "threshold": 5}


def test_note_overload_info_band(tmp_path):
    """0.8 * threshold <= count < threshold → info severity."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2020-01-01T00:00:00Z"
    )
    # 8 reviewed fresh notes, threshold 10 → 8 >= 0.8*10 → info.
    for i in range(8):
        _write_note(
            mod, f"n{i}", status="reviewed", last_reviewed="2030-01-01",
        )
    findings = check(tmp_path, _cfg(max_note_count=10))
    ov = [f for f in findings if f.code == "DNA_NOTE_OVERLOAD"]
    assert len(ov) == 1
    assert ov[0].severity == "info"


def test_note_overload_error_band(tmp_path):
    """count >= 1.5 * threshold → error severity."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2020-01-01T00:00:00Z"
    )
    for i in range(9):
        _write_note(
            mod, f"n{i}", status="reviewed", last_reviewed="2030-01-01",
        )
    findings = check(tmp_path, _cfg(max_note_count=6))
    ov = [f for f in findings if f.code == "DNA_NOTE_OVERLOAD"]
    assert len(ov) == 1
    assert ov[0].severity == "error"


def test_note_overload_below_info_band_no_finding(tmp_path):
    """count < 0.8 * threshold → healthy, no finding."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2020-01-01T00:00:00Z"
    )
    # 3 notes vs threshold 10 → 3 < 8 → below info band.
    for i in range(3):
        _write_note(
            mod, f"n{i}", status="reviewed", last_reviewed="2030-01-01",
        )
    findings = check(tmp_path, _cfg(max_note_count=10))
    ov = [f for f in findings if f.code == "DNA_NOTE_OVERLOAD"]
    assert ov == []


# ---------------------------------------------------------------------------
# DNA_NOTE_STALE_RATIO
# ---------------------------------------------------------------------------


def test_stale_ratio_warn(tmp_path):
    """1/3 stale ≈ 33.3% in [threshold 30, 1.5*threshold 45) → warn severity."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2026-06-01T12:00:00Z"
    )
    _write_note(
        mod, "stale-1", status="reviewed", last_reviewed="2026-05-01",
    )
    _write_note(
        mod, "fresh-1", status="reviewed", last_reviewed="2026-06-15",
    )
    _write_note(
        mod, "fresh-2", status="reviewed", last_reviewed="2026-06-20",
    )
    findings = check(tmp_path, _cfg(max_stale_ratio_pct=30))
    sr = [f for f in findings if f.code == "DNA_NOTE_STALE_RATIO"]
    assert len(sr) == 1
    assert sr[0].severity == "warn"
    assert sr[0].metadata["stale_count"] == 1
    assert sr[0].metadata["total_count"] == 3
    assert 33.0 < sr[0].metadata["stale_pct"] < 34.0
    assert sr[0].metadata["threshold_pct"] == 30


def test_stale_ratio_missing_last_reviewed_counts_as_stale(tmp_path):
    """A note with no ``last_reviewed`` is stale by construction."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2026-06-01T12:00:00Z"
    )
    for i in range(3):
        _write_note(mod, f"n{i}", status="reviewed")  # never reviewed
    findings = check(tmp_path, _cfg(max_stale_ratio_pct=30))
    sr = [f for f in findings if f.code == "DNA_NOTE_STALE_RATIO"]
    assert len(sr) == 1
    assert sr[0].metadata["stale_count"] == 3
    assert sr[0].metadata["total_count"] == 3


def test_stale_ratio_all_fresh_no_finding(tmp_path):
    """All notes reviewed after body_edited_at → 0% stale → no finding."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2026-06-01T12:00:00Z"
    )
    _write_note(
        mod, "n1", status="reviewed", last_reviewed="2026-06-15",
    )
    _write_note(
        mod, "n2", status="reviewed", last_reviewed="2026-06-20",
    )
    findings = check(tmp_path, _cfg(max_stale_ratio_pct=30))
    assert [f for f in findings if f.code == "DNA_NOTE_STALE_RATIO"] == []


def test_stale_ratio_skipped_when_body_edited_at_missing(tmp_path):
    """Module without ``body_edited_at`` cannot be scored — check must not
    crash and must not emit stale-ratio findings for that module."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(tmp_path, "alpha", body_edited_at=None)
    for i in range(3):
        _write_note(mod, f"n{i}", status="reviewed")
    findings = check(tmp_path, _cfg())
    assert [f for f in findings if f.code == "DNA_NOTE_STALE_RATIO"] == []


def test_stale_ratio_boundary_below_info_no_finding(tmp_path):
    """1/10 stale = 10% < 0.8 * 30 = 24 → below info band → no finding."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2026-06-01T12:00:00Z"
    )
    _write_note(
        mod, "stale", status="reviewed", last_reviewed="2026-05-01",
    )
    for i in range(9):
        _write_note(
            mod, f"fresh-{i}", status="reviewed",
            last_reviewed="2026-06-15",
        )
    findings = check(tmp_path, _cfg(max_stale_ratio_pct=30))
    assert [f for f in findings if f.code == "DNA_NOTE_STALE_RATIO"] == []


def test_stale_ratio_error_band(tmp_path):
    """100% stale (all missing last_reviewed) → 100 >= 1.5 * 30 = 45 → error."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2026-06-01T12:00:00Z"
    )
    for i in range(4):
        _write_note(mod, f"n{i}", status="reviewed")
    findings = check(tmp_path, _cfg(max_stale_ratio_pct=30))
    sr = [f for f in findings if f.code == "DNA_NOTE_STALE_RATIO"]
    assert len(sr) == 1
    assert sr[0].severity == "error"


# ---------------------------------------------------------------------------
# DNA_NOTE_DRAFT_STUCK
# ---------------------------------------------------------------------------


def _days_ago_date(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()


def test_draft_stuck_warn_via_last_reviewed(tmp_path):
    """draft note with last_reviewed 30d ago vs threshold 30 → warn."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2030-01-01T00:00:00Z",
        # future body_edited_at prevents note from counting as stale so
        # the stale-ratio finding stays quiet and we can assert draft
        # findings in isolation.
    )
    _write_note(
        mod, "draft-1", status="draft",
        last_reviewed=_days_ago_date(30),
    )
    findings = check(tmp_path, _cfg(max_draft_stuck_days=30))
    ds = [f for f in findings if f.code == "DNA_NOTE_DRAFT_STUCK"]
    assert len(ds) == 1
    f = ds[0]
    assert f.severity == "warn"
    assert f.target == "alpha/notes/draft-1"
    assert f.metadata["reference_kind"] == "last_reviewed"
    assert f.metadata["days_stuck"] >= 30
    assert f.metadata["status"] == "draft"


def test_draft_stuck_error_via_last_reviewed(tmp_path):
    """days_stuck >= 1.5 * threshold → error."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2030-01-01T00:00:00Z",
    )
    _write_note(
        mod, "draft-old", status="draft",
        last_reviewed=_days_ago_date(60),
    )
    findings = check(tmp_path, _cfg(max_draft_stuck_days=30))
    ds = [f for f in findings if f.code == "DNA_NOTE_DRAFT_STUCK"]
    assert len(ds) == 1
    assert ds[0].severity == "error"


def test_draft_stuck_info_band_via_last_reviewed(tmp_path):
    """0.8 * threshold <= days_stuck < threshold → info."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2030-01-01T00:00:00Z",
    )
    _write_note(
        mod, "draft-warm", status="draft",
        last_reviewed=_days_ago_date(25),  # 25 >= 0.8*30 → info
    )
    findings = check(tmp_path, _cfg(max_draft_stuck_days=30))
    ds = [f for f in findings if f.code == "DNA_NOTE_DRAFT_STUCK"]
    assert len(ds) == 1
    assert ds[0].severity == "info"


def test_draft_stuck_below_info_no_finding(tmp_path):
    """Recent last_reviewed → below info band → no finding."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2030-01-01T00:00:00Z",
    )
    _write_note(
        mod, "draft-fresh", status="draft",
        last_reviewed=_days_ago_date(3),
    )
    findings = check(tmp_path, _cfg(max_draft_stuck_days=30))
    assert [f for f in findings if f.code == "DNA_NOTE_DRAFT_STUCK"] == []


def test_draft_stuck_falls_back_to_mtime_when_last_reviewed_missing(tmp_path):
    """No ``last_reviewed`` → age by file mtime."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2030-01-01T00:00:00Z",
    )
    _write_note(
        mod, "draft-orphan", status="draft",
        last_reviewed=None,
        mtime_days_ago=45,
    )
    findings = check(tmp_path, _cfg(max_draft_stuck_days=30))
    ds = [f for f in findings if f.code == "DNA_NOTE_DRAFT_STUCK"]
    assert len(ds) == 1
    assert ds[0].metadata["reference_kind"] == "mtime"
    assert ds[0].metadata["days_stuck"] >= 30
    # error band (>= 1.5*30 = 45)
    assert ds[0].severity == "error"


def test_draft_stuck_ignores_non_draft_status(tmp_path):
    """Notes with status other than 'draft' are not draft-stuck candidates."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2030-01-01T00:00:00Z",
    )
    _write_note(
        mod, "old-reviewed", status="reviewed",
        last_reviewed=_days_ago_date(120),
    )
    _write_note(
        mod, "old-stable", status="stable",
        last_reviewed=_days_ago_date(120),
    )
    findings = check(tmp_path, _cfg(max_draft_stuck_days=30))
    assert [f for f in findings if f.code == "DNA_NOTE_DRAFT_STUCK"] == []


def test_draft_stuck_malformed_last_reviewed_uses_mtime(tmp_path):
    """A garbled ``last_reviewed`` value falls through to the mtime path."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2030-01-01T00:00:00Z",
    )
    _write_note(
        mod, "bad-stamp", status="draft",
        last_reviewed="not-a-date-really",
        mtime_days_ago=40,
    )
    findings = check(tmp_path, _cfg(max_draft_stuck_days=30))
    ds = [f for f in findings if f.code == "DNA_NOTE_DRAFT_STUCK"]
    assert len(ds) == 1
    assert ds[0].metadata["reference_kind"] == "mtime"


def test_draft_stuck_message_carries_no_mutable_day_count(tmp_path):
    """Message must stay static so the audit baseline fingerprint doesn't
    churn as ``days_stuck`` increments on subsequent runs. Mirror of the
    freshness check's stability invariant."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2030-01-01T00:00:00Z",
    )
    _write_note(
        mod, "draft-old", status="draft",
        last_reviewed=_days_ago_date(60),
    )
    findings = check(tmp_path, _cfg(max_draft_stuck_days=30))
    ds = [f for f in findings if f.code == "DNA_NOTE_DRAFT_STUCK"]
    assert len(ds) == 1
    f = ds[0]
    assert str(f.metadata["days_stuck"]) not in f.message
    assert f.metadata["reference_at"] not in f.message


# ---------------------------------------------------------------------------
# Cross-check independence — one broken sub-check must not silence peers
# ---------------------------------------------------------------------------


def test_overload_and_stale_ratio_coexist(tmp_path):
    """A module can trigger overload AND stale-ratio in the same run —
    both findings should surface."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(
        tmp_path, "alpha", body_edited_at="2026-06-01T12:00:00Z"
    )
    # 5 notes, all with old last_reviewed → stale + count boundary.
    for i in range(5):
        _write_note(
            mod, f"n{i}", status="reviewed", last_reviewed="2026-05-01",
        )
    findings = check(
        tmp_path, _cfg(max_note_count=5, max_stale_ratio_pct=30)
    )
    codes = {f.code for f in findings}
    assert "DNA_NOTE_OVERLOAD" in codes
    assert "DNA_NOTE_STALE_RATIO" in codes


def test_missing_body_edited_at_does_not_suppress_other_checks(tmp_path):
    """Module without ``body_edited_at`` skips stale-ratio, but overload
    and draft-stuck must still fire when their conditions hold."""
    _seed_index(tmp_path, ["alpha"])
    mod = _write_module(tmp_path, "alpha", body_edited_at=None)
    for i in range(5):
        _write_note(
            mod, f"reviewed-{i}", status="reviewed",
            last_reviewed=_days_ago_date(1),
        )
    _write_note(
        mod, "draft-old", status="draft",
        last_reviewed=_days_ago_date(60),
    )
    findings = check(
        tmp_path, _cfg(max_note_count=5, max_draft_stuck_days=30)
    )
    codes = {f.code for f in findings}
    assert "DNA_NOTE_OVERLOAD" in codes  # 6 notes >= threshold 5
    assert "DNA_NOTE_DRAFT_STUCK" in codes
    assert "DNA_NOTE_STALE_RATIO" not in codes  # skipped safely
