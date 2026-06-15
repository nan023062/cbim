"""Unit tests for memory.compaction.promote_builder.scan_for_promote_candidates.

Batch 7 — rule C. Covers:
  - flag default off → 0, candidates dir not even created
  - flag on → stages every medium entry whose tags include rule/flow
  - mismatched tag (e.g. tag=decision) is ignored under default scan_tags
  - idempotent: re-running produces 0 new stages and does not refresh mtime
  - removing a staged candidate causes the next run to re-stage it
  - misconfigured scan_tags (None, non-list) falls back to ["rule","flow"]
"""
from __future__ import annotations

import time
from pathlib import Path

import pytest

from memory.compaction import scan_for_promote_candidates
from memory.compaction.candidates import CandidatesArea


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_medium(store: Path, name: str, tag: str) -> Path:
    medium = store / "medium"
    medium.mkdir(parents=True, exist_ok=True)
    p = medium / name
    p.write_text(
        f"---\ntier: medium\ntags: {tag}\n---\n\nbody for {name}\n",
        encoding="utf-8",
    )
    return p


@pytest.fixture
def store(tmp_path: Path) -> Path:
    s = tmp_path / "memory"
    (s / "medium").mkdir(parents=True)
    return s


def _patch_promote(monkeypatch, *, enabled: bool, scan_tags=("rule", "flow")):
    """Pin the promote section of the loaded config to a known state.

    monkeypatch the module-level load_config used by promote_builder.
    """
    from memory import _config as _mem_config
    from memory.compaction import promote_builder as _pb

    def _fake_load(_cwd=None):
        return {"promote": {"enabled": enabled, "scan_tags": list(scan_tags)}}

    monkeypatch.setattr(_pb, "load_config", _fake_load)
    # Also pin the underlying module so any other importer sees the same
    # value for the duration of the test.
    monkeypatch.setattr(_mem_config, "load_config", _fake_load)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_flag_off_returns_zero_and_does_not_touch_disk(store, monkeypatch):
    _patch_promote(monkeypatch, enabled=False)
    _write_medium(store, "2026-06-01-rule-x.md", "rule")
    _write_medium(store, "2026-06-02-flow-y.md", "flow")

    n = scan_for_promote_candidates(store)

    assert n == 0
    # candidates/ must not have been created
    assert not (store / "candidates").exists()


def test_flag_on_stages_rule_and_flow_entries(store, monkeypatch):
    _patch_promote(monkeypatch, enabled=True)
    _write_medium(store, "2026-06-01-rule-x.md", "rule")
    _write_medium(store, "2026-06-02-flow-y.md", "flow")
    _write_medium(store, "2026-06-03-decision-z.md", "decision")

    n = scan_for_promote_candidates(store)

    assert n == 2
    cand_dir = store / "candidates"
    assert cand_dir.exists()
    files = sorted(cand_dir.glob("*.candidate.json"))
    assert len(files) == 2
    # The decision-tagged entry must NOT be staged.
    assert not any("decision-z" in f.name for f in files)


def test_flag_on_with_no_matching_tags_returns_zero(store, monkeypatch):
    _patch_promote(monkeypatch, enabled=True)
    _write_medium(store, "2026-06-01-fact-x.md", "fact")
    _write_medium(store, "2026-06-02-decision-y.md", "decision")

    n = scan_for_promote_candidates(store)

    assert n == 0
    cand_dir = store / "candidates"
    # CandidatesArea.stage was never invoked → directory not created.
    assert not cand_dir.exists() or not list(cand_dir.glob("*.candidate.json"))


def test_idempotent_second_run_stages_zero_and_does_not_refresh(store, monkeypatch):
    _patch_promote(monkeypatch, enabled=True)
    _write_medium(store, "2026-06-01-rule-x.md", "rule")

    first = scan_for_promote_candidates(store)
    assert first == 1
    cand_files = list((store / "candidates").glob("*.candidate.json"))
    assert len(cand_files) == 1
    first_mtime = cand_files[0].stat().st_mtime

    # Sleep enough that any rewrite would change mtime on every supported FS.
    time.sleep(0.05)

    second = scan_for_promote_candidates(store)
    assert second == 0
    cand_files_after = list((store / "candidates").glob("*.candidate.json"))
    assert len(cand_files_after) == 1
    # Same mtime → no rewrite happened.
    assert cand_files_after[0].stat().st_mtime == first_mtime


def test_deleting_candidate_lets_next_run_restage(store, monkeypatch):
    _patch_promote(monkeypatch, enabled=True)
    _write_medium(store, "2026-06-01-rule-x.md", "rule")

    first = scan_for_promote_candidates(store)
    assert first == 1

    cand = next((store / "candidates").glob("*.candidate.json"))
    cand.unlink()

    second = scan_for_promote_candidates(store)
    assert second == 1
    assert len(list((store / "candidates").glob("*.candidate.json"))) == 1


@pytest.mark.parametrize("bogus", [None, "rule,flow", 42, []])
def test_scan_tags_misconfig_falls_back_to_defaults(store, monkeypatch, bogus):
    """None / non-list / empty list scan_tags → silently fall back to
    ["rule","flow"]; the function still works as if the operator had not
    overridden the tag set."""
    _write_medium(store, "2026-06-01-rule-x.md", "rule")
    _write_medium(store, "2026-06-02-flow-y.md", "flow")

    from memory.compaction import promote_builder as _pb

    def _fake_load(_cwd=None):
        return {"promote": {"enabled": True, "scan_tags": bogus}}

    monkeypatch.setattr(_pb, "load_config", _fake_load)

    n = scan_for_promote_candidates(store)
    assert n == 2


def test_returns_area_path_handle_after_stage(store, monkeypatch):
    """Sanity: CandidatesArea.path is consistent with what stage uses,
    so _is_already_staged on the second run finds prior files."""
    _patch_promote(monkeypatch, enabled=True)
    _write_medium(store, "2026-06-01-rule-x.md", "rule")
    scan_for_promote_candidates(store)

    area = CandidatesArea(store)
    assert area.path.exists()
    assert area.count() == 1
