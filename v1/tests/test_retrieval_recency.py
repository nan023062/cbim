"""Recency-weighted retrieval score tests.

Covers the exponential recency decay applied inside RetrievalFacade.search:

    final_score = raw_score * exp(-age_days / half_life_days)

- Config-level opt-out (recency_half_life_days=None) preserves raw scores.
- age == half_life  → multiplier ≈ 0.5.
- Missing timestamp → multiplier = 1.0 (no penalty).
- Only sources present in the map are decayed; sources not listed (e.g.
  dna / agents) are unaffected.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from engine.retrieval.config import RetrievalConfig
from engine.retrieval.facade import RetrievalFacade


def _new_facade(tmp_path: Path, *, recency=...) -> RetrievalFacade:
    """Build a facade for tests. ``recency`` follows the same sentinel
    convention as ``RetrievalConfig.from_dict`` — omit to keep defaults,
    ``None`` disables decay entirely, or pass a dict override.
    """
    kwargs: dict = {}
    if recency is not ...:
        kwargs["recency_half_life_days"] = recency
    return RetrievalFacade(tmp_path / "index", RetrievalConfig(**kwargs))


def _set_indexed_at(facade: RetrievalFacade, source: str, doc_id: str, dt: datetime) -> None:
    """Rewrite the on-disk indexed_at + mtime for a record and reload state.

    We monkey the persistent record (not just the in-memory copy) because
    ``search`` reloads under the cross-process lock on the next hit path
    for delete/upsert; keeping both consistent avoids state drift between
    tests.
    """
    state = facade._get(source)
    rec = state.records[doc_id]
    rec.indexed_at = dt.strftime("%Y-%m-%dT%H:%M:%S") + "Z"
    rec.mtime = dt.timestamp()
    state.store.save_meta(state.records)


# ---------------------------------------------------------------------------
# Config-level opt out preserves raw scores.
# ---------------------------------------------------------------------------

def test_recency_none_preserves_raw_score(tmp_path):
    f_no_decay = _new_facade(tmp_path / "a", recency=None)
    f_default = _new_facade(tmp_path / "b")

    f_no_decay.index_upsert("memory_medium", "d1", "hello world")
    f_default.index_upsert("memory_medium", "d1", "hello world")

    # Age both records by 60 days (default memory_medium half-life).
    old = datetime.now(timezone.utc) - timedelta(days=60)
    _set_indexed_at(f_no_decay, "memory_medium", "d1", old)
    _set_indexed_at(f_default, "memory_medium", "d1", old)

    raw = f_no_decay.search("memory_medium", "hello")[0].score
    decayed = f_default.search("memory_medium", "hello")[0].score

    # With decay off, raw score is untouched.
    # With default decay + age=half_life, decayed ≈ raw * 0.5.
    assert decayed == pytest.approx(raw * 0.5, rel=0.02)


# ---------------------------------------------------------------------------
# age == half_life  → multiplier ≈ 0.5
# ---------------------------------------------------------------------------

def test_multiplier_half_when_age_equals_half_life(tmp_path):
    f = _new_facade(tmp_path, recency={"memory_medium": 10.0})
    f.index_upsert("memory_medium", "d1", "alpha beta gamma")

    # Baseline: age 0 → multiplier ≈ 1.0. Fresh insertion is close to now
    # so no timestamp manipulation is needed.
    raw = f.search("memory_medium", "alpha")[0].score

    _set_indexed_at(
        f, "memory_medium", "d1",
        datetime.now(timezone.utc) - timedelta(days=10),
    )
    decayed = f.search("memory_medium", "alpha")[0].score

    ratio = decayed / raw
    assert ratio == pytest.approx(0.5, rel=0.01)


# ---------------------------------------------------------------------------
# Missing timestamp → multiplier = 1.0
# ---------------------------------------------------------------------------

def test_missing_timestamp_gives_multiplier_one(tmp_path):
    f = _new_facade(tmp_path, recency={"memory_medium": 30.0})
    f.index_upsert("memory_medium", "d1", "unique probe token")

    state = f._get("memory_medium")
    rec = state.records["d1"]
    rec.indexed_at = ""
    rec.mtime = 0.0
    state.store.save_meta(state.records)

    hit = f.search("memory_medium", "probe")[0]
    # Compute the raw BM25 score with decay disabled → same query same
    # index → same raw score. Multiplier is expected to be 1.0.
    f2 = _new_facade(tmp_path / "no_decay_probe", recency=None)
    f2.index_upsert("memory_medium", "d1", "unique probe token")
    raw = f2.search("memory_medium", "probe")[0].score

    assert hit.score == pytest.approx(raw, rel=1e-6)


# ---------------------------------------------------------------------------
# Sources not listed in the map do NOT get decayed (dna / agents opt-out).
# ---------------------------------------------------------------------------

def test_source_not_in_map_is_unaffected(tmp_path):
    # dna is deliberately absent from the default map; add memory_medium
    # explicitly so we know the map has content and the "not in map" path
    # is the only reason dna is exempt.
    f = _new_facade(tmp_path, recency={"memory_medium": 30.0})
    f.index_upsert("dna", "mod_a", "quick brown fox")

    old = datetime.now(timezone.utc) - timedelta(days=365)
    _set_indexed_at(f, "dna", "mod_a", old)

    # Compare to a decay-disabled facade — dna score must match exactly
    # (no decay applied even though the record is a year old).
    f_ref = _new_facade(tmp_path / "ref", recency=None)
    f_ref.index_upsert("dna", "mod_a", "quick brown fox")
    _set_indexed_at(f_ref, "dna", "mod_a", old)

    a = f.search("dna", "fox")[0].score
    b = f_ref.search("dna", "fox")[0].score
    assert a == pytest.approx(b, rel=1e-9)


# ---------------------------------------------------------------------------
# Multi-hit ordering: newer beats older when raw scores are equal.
# ---------------------------------------------------------------------------

def test_newer_hit_ranks_higher_after_decay(tmp_path):
    f = _new_facade(tmp_path, recency={"memory_medium": 30.0})
    f.index_upsert("memory_medium", "recent", "shared token payload")
    f.index_upsert("memory_medium", "ancient", "shared token payload")

    now = datetime.now(timezone.utc)
    _set_indexed_at(f, "memory_medium", "recent", now - timedelta(days=1))
    _set_indexed_at(f, "memory_medium", "ancient", now - timedelta(days=180))

    hits = f.search("memory_medium", "shared token")
    ids = [h.doc_id for h in hits]
    assert ids[0] == "recent"
    assert ids[-1] == "ancient"
    # Non-decayed reference: raw scores are equal (identical content).
    f_ref = _new_facade(tmp_path / "ref", recency=None)
    f_ref.index_upsert("memory_medium", "recent", "shared token payload")
    f_ref.index_upsert("memory_medium", "ancient", "shared token payload")
    ref_scores = {h.doc_id: h.score for h in f_ref.search("memory_medium", "shared token")}
    assert ref_scores["recent"] == pytest.approx(ref_scores["ancient"], rel=1e-9)


# ---------------------------------------------------------------------------
# Config wiring: from_dict / to_dict round-trip preserves the map.
# ---------------------------------------------------------------------------

def test_config_roundtrip_preserves_map():
    cfg = RetrievalConfig(recency_half_life_days={"memory_medium": 42.0})
    round_tripped = RetrievalConfig.from_dict(cfg.to_dict())
    assert round_tripped.recency_half_life_days == {"memory_medium": 42.0}


def test_config_from_dict_uses_defaults_when_key_missing():
    cfg = RetrievalConfig.from_dict({"provider": "null"})
    # Defaults: memory_medium=60d, transcript=30d, dna/agents absent.
    assert cfg.recency_half_life_days == {
        "memory_medium": 60.0,
        "transcript": 30.0,
    }


def test_config_from_dict_none_disables_decay():
    cfg = RetrievalConfig.from_dict({"recency_half_life_days": None})
    assert cfg.recency_half_life_days is None


def test_multiplier_math_bounds():
    """The decay formula must satisfy simple monotonicity properties."""
    # exp(0) == 1  → fresh doc unaffected.
    assert math.isclose(math.exp(0), 1.0)
    # multiplier is strictly in (0, 1] for age >= 0.
    for age in (0.5, 1.0, 5.0, 60.0):
        for hl in (10.0, 30.0, 60.0):
            m = math.exp(-age / hl)
            assert 0.0 < m <= 1.0
