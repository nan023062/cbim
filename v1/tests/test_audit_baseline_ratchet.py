"""Unit tests for T2 audit baseline + ratchet (engine.audit.{baseline,ratchet})."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from engine.audit import run_audit
from engine.audit.baseline import BaselineStore, fingerprint
from engine.audit.cli import _baseline_accept, _exit_code
from engine.audit.ratchet import apply as ratchet_apply
from engine.audit.ratchet import check_mode, downgrade
from engine.audit.result import AuditFinding


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _seed(root: Path) -> None:
    (root / ".cbim").mkdir(parents=True)


def _make_index(root: Path, entries: list[str]) -> None:
    lines = ["# Module Index", ""] + [f"- {e}" for e in entries]
    (root / ".cbim" / "index.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _make_module(root: Path, rel: str, deps: list[str] | None = None) -> None:
    """v2-conformant fixture. The legacy ``deps`` parameter is preserved
    for signature stability but ignored — v2 sources deps from parent
    class diagrams, not frontmatter.
    """
    mod = root if rel == "." else (root / rel)
    dna = mod / ".dna"
    dna.mkdir(parents=True)
    fm = [
        "---",
        f"name: {rel}",
        "owner: x",
        "description: m",
        "keywords: []",
        "status: implemented",
        "---",
    ]
    (dna / "module.md").write_text("\n".join(fm) + "\n\nbody\n", encoding="utf-8")


def _make_finding(
    check: str = "dna_tree",
    severity: str = "error",
    target: str = "alpha",
    message: str = "msg",
    code: str = "X1",
) -> AuditFinding:
    return AuditFinding(
        check=check, severity=severity, target=target, message=message, code=code,
    )


# ---------------------------------------------------------------------------
# AuditFinding.origin defaults + serialization
# ---------------------------------------------------------------------------

def test_finding_origin_defaults_to_new():
    f = _make_finding()
    assert f.origin == "new"


def test_finding_to_dict_includes_origin():
    f = _make_finding()
    d = f.to_dict()
    assert "origin" in d
    assert d["origin"] == "new"


def test_finding_from_dict_missing_origin_is_new():
    """Old JSON reports written before T2 must round-trip cleanly."""
    old = {
        "check": "dna_tree",
        "severity": "warn",
        "target": "alpha",
        "message": "missing parent",
        "metadata": {},
        "suggestion": None,
        "code": "TREE_X",
        # no 'origin' field
    }
    f = AuditFinding.from_dict(old)
    assert f.origin == "new"


def test_finding_from_dict_explicit_baseline():
    d = {
        "check": "dna_tree", "severity": "warn", "target": "alpha",
        "message": "m", "code": "C", "origin": "baseline",
    }
    assert AuditFinding.from_dict(d).origin == "baseline"


# ---------------------------------------------------------------------------
# fingerprint
# ---------------------------------------------------------------------------

def test_fingerprint_stable_for_same_finding():
    a = _make_finding()
    b = _make_finding()
    assert fingerprint(a) == fingerprint(b)


def test_fingerprint_changes_with_message():
    a = _make_finding(message="orig")
    b = _make_finding(message="orig.")
    assert fingerprint(a) != fingerprint(b)


def test_fingerprint_changes_with_check_code_target():
    base = _make_finding()
    assert fingerprint(base) != fingerprint(_make_finding(check="other"))
    assert fingerprint(base) != fingerprint(_make_finding(code="OTHER"))
    assert fingerprint(base) != fingerprint(_make_finding(target="other"))


def test_fingerprint_handles_none_target_and_code():
    f = AuditFinding(check="c", severity="warn", target=None, message="m", code=None)
    # Should not raise, and should be deterministic.
    assert fingerprint(f) == fingerprint(f)


# ---------------------------------------------------------------------------
# BaselineStore: load / save / accept / classify
# ---------------------------------------------------------------------------

def test_baseline_load_missing_returns_empty(tmp_path):
    _seed(tmp_path)
    store = BaselineStore(tmp_path)
    assert store.load() == {}
    assert not store.exists()


def test_baseline_accept_persists_and_dedupes(tmp_path):
    _seed(tmp_path)
    store = BaselineStore(tmp_path)
    f1 = _make_finding(target="a")
    f2 = _make_finding(target="b")
    assert store.accept([f1, f2]) == 2
    assert store.exists()
    # Re-accept same fingerprints — no new entries.
    assert store.accept([f1, f2]) == 0
    # File still readable + has both entries.
    loaded = store.load()
    assert len(loaded) == 2
    assert {e.target for e in loaded.values()} == {"a", "b"}


def test_baseline_accept_writes_atomic_json(tmp_path):
    _seed(tmp_path)
    store = BaselineStore(tmp_path)
    store.accept([_make_finding()])
    raw = json.loads(store.path.read_text(encoding="utf-8"))
    assert raw["schema_version"] == 1
    assert "entries" in raw
    assert len(raw["entries"]) == 1
    assert raw["entries"][0]["check"] == "dna_tree"


def test_baseline_classify_marks_origin(tmp_path):
    _seed(tmp_path)
    store = BaselineStore(tmp_path)
    accepted = _make_finding(target="known")
    store.accept([accepted])

    # Build a fresh list with one matching + one new finding.
    fresh = [_make_finding(target="known"), _make_finding(target="brand_new")]
    store.classify(fresh)
    assert fresh[0].origin == "baseline"
    assert fresh[1].origin == "new"


def test_baseline_classify_no_baseline_stays_new(tmp_path):
    _seed(tmp_path)
    store = BaselineStore(tmp_path)
    f = _make_finding()
    store.classify([f])
    assert f.origin == "new"


def test_baseline_message_edit_invalidates_acceptance(tmp_path):
    """Editing a finding's message should re-surface it as origin=new."""
    _seed(tmp_path)
    store = BaselineStore(tmp_path)
    store.accept([_make_finding(message="original wording")])
    # Same check/code/target but different message → different fingerprint.
    edited = [_make_finding(message="updated wording")]
    store.classify(edited)
    assert edited[0].origin == "new"


def test_baseline_clear_all(tmp_path):
    _seed(tmp_path)
    store = BaselineStore(tmp_path)
    store.accept([_make_finding(target="a"), _make_finding(target="b")])
    removed = store.clear()
    assert removed == 2
    assert store.load() == {}


def test_baseline_clear_by_check(tmp_path):
    _seed(tmp_path)
    store = BaselineStore(tmp_path)
    store.accept([
        _make_finding(check="dna_tree", target="a"),
        _make_finding(check="index_consistency", target="b"),
    ])
    removed = store.clear(checks=["dna_tree"])
    assert removed == 1
    remaining = store.list()
    assert len(remaining) == 1
    assert remaining[0].check == "index_consistency"


# ---------------------------------------------------------------------------
# ratchet
# ---------------------------------------------------------------------------

def test_ratchet_table_matches_blueprint():
    assert check_mode("dna_tree") == "lenient"
    assert check_mode("dna_fission") == "lenient"
    assert check_mode("agent_fission") == "lenient"
    assert check_mode("index_consistency") == "strict"
    assert check_mode("memory_threshold") == "strict"


def test_ratchet_downgrade_ladder():
    assert downgrade("error") == "warn"
    assert downgrade("warn") == "info"
    # info is floor — never drops further.
    assert downgrade("info") == "info"


def test_ratchet_new_origin_never_downgrades():
    f = _make_finding(check="dna_tree", severity="error")
    f.origin = "new"
    ratchet_apply([f], baseline_mode="lenient")
    assert f.severity == "error"


def test_ratchet_lenient_check_baseline_origin_drops_one_notch():
    f = _make_finding(check="dna_tree", severity="error")
    f.origin = "baseline"
    ratchet_apply([f], baseline_mode="lenient")
    assert f.severity == "warn"


def test_ratchet_strict_check_baseline_origin_unchanged():
    f = _make_finding(check="index_consistency", severity="error")
    f.origin = "baseline"
    ratchet_apply([f], baseline_mode="lenient")
    assert f.severity == "error"


def test_ratchet_strict_mode_disables_all_downgrades():
    f = _make_finding(check="dna_tree", severity="error")
    f.origin = "baseline"
    ratchet_apply([f], baseline_mode="strict")
    assert f.severity == "error"


def test_ratchet_ignore_mode_rejected():
    f = _make_finding()
    with pytest.raises(ValueError):
        ratchet_apply([f], baseline_mode="ignore")


def test_ratchet_unknown_mode_rejected():
    f = _make_finding()
    with pytest.raises(ValueError):
        ratchet_apply([f], baseline_mode="bogus")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# run_audit integration: origin tagging + summary by_origin
# ---------------------------------------------------------------------------

def test_run_audit_ignore_mode_keeps_default_origin(tmp_path):
    _seed(tmp_path)
    _make_index(tmp_path, ["ghost"])  # 1 stale entry → INDEX_STALE_ENTRY warn
    result = run_audit(tmp_path, baseline_mode="ignore")
    assert result.findings
    for f in result.findings:
        assert f.origin == "new"
    assert result.summary["baseline_mode"] == "ignore"


def test_run_audit_lenient_no_baseline_treats_all_as_new(tmp_path):
    _seed(tmp_path)
    _make_index(tmp_path, ["ghost"])
    result = run_audit(tmp_path, baseline_mode="lenient")
    assert result.summary["by_origin"]["baseline"] == 0
    assert result.summary["by_origin"]["new"] == len(result.findings)


def test_run_audit_strict_with_baseline_classifies_but_does_not_downgrade(tmp_path):
    """index_consistency is strict by table → no downgrade either way."""
    _seed(tmp_path)
    _make_index(tmp_path, ["ghost"])
    first = run_audit(tmp_path, baseline_mode="strict")
    assert first.findings, "expected stale entry to produce at least one finding"

    # Accept everything; re-run.
    store = BaselineStore(tmp_path)
    store.accept(first.findings)
    second = run_audit(tmp_path, baseline_mode="strict")
    severities_after = {(f.check, f.code, f.severity, f.origin) for f in second.findings}
    severities_before = {(f.check, f.code, f.severity, f.origin) for f in first.findings}
    # Same severities, but origin flipped to baseline.
    for chk, code, sev, _ in severities_before:
        assert (chk, code, sev, "baseline") in severities_after


def test_run_audit_lenient_downgrades_lenient_check_baseline_findings(tmp_path):
    """Make dna_tree produce a finding, accept it, then verify lenient downgrade."""
    _seed(tmp_path)
    # Module with broken dep → dna_tree TREE_DEP_DANGLING (severity = error).
    _make_module(tmp_path, ".", deps=[])
    _make_module(tmp_path, "alpha", deps=["nonexistent/module"])
    _make_index(tmp_path, ["alpha"])

    # Strict baseline run produces raw severities.
    first = run_audit(tmp_path, baseline_mode="strict")
    dna_tree_findings = [f for f in first.findings if f.check == "dna_tree"]
    assert dna_tree_findings, "expected dna_tree to flag the broken dep"

    store = BaselineStore(tmp_path)
    store.accept(dna_tree_findings)

    second = run_audit(tmp_path, baseline_mode="lenient")
    second_dna = [f for f in second.findings if f.check == "dna_tree"]
    # All previously-error dna_tree findings should now be at most "warn"
    # (lenient downgrade) AND tagged baseline.
    for orig in dna_tree_findings:
        match = [
            f for f in second_dna
            if f.code == orig.code and f.target == orig.target
        ]
        assert match, f"missing baselined finding {orig.code}/{orig.target}"
        f = match[0]
        assert f.origin == "baseline"
        # downgrade ladder: error→warn, warn→info, info→info.
        if orig.severity == "error":
            assert f.severity == "warn"
        elif orig.severity == "warn":
            assert f.severity == "info"
        else:
            assert f.severity == "info"


def test_run_audit_does_not_create_baseline_file(tmp_path):
    """Critical invariant: run_audit is read-only on baseline.json."""
    _seed(tmp_path)
    _make_index(tmp_path, ["ghost"])
    result = run_audit(tmp_path, baseline_mode="lenient")
    assert result.findings
    assert not (tmp_path / ".cbim" / "audit" / "baseline.json").exists()


def test_run_audit_unknown_baseline_mode_raises(tmp_path):
    _seed(tmp_path)
    with pytest.raises(ValueError):
        run_audit(tmp_path, baseline_mode="bogus")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Back-compat: summary still has old keys
# ---------------------------------------------------------------------------

def test_run_audit_summary_has_legacy_keys(tmp_path):
    _seed(tmp_path)
    _make_index(tmp_path, ["ghost"])
    result = run_audit(tmp_path, baseline_mode="lenient")
    s = result.summary
    for key in ("total", "error", "warn", "info", "checks_ran", "by_check"):
        assert key in s, f"summary missing legacy key {key!r}"
    # Additive new keys.
    assert "by_origin" in s
    assert "baseline_mode" in s


# ---------------------------------------------------------------------------
# T7 gap-fill (1): atomic write — no .tmp leftover after accept
# ---------------------------------------------------------------------------

def test_baseline_accept_leaves_no_tmpfile(tmp_path):
    """Atomic write contract: tempfile + os.replace must clean up after itself."""
    _seed(tmp_path)
    store = BaselineStore(tmp_path)
    store.accept([_make_finding(target="a"), _make_finding(target="b")])
    assert store.path.is_file()
    leftovers = list(store.path.parent.glob(".baseline.*.json.tmp"))
    assert leftovers == [], f"atomic-write tmpfiles not cleaned up: {leftovers}"


# ---------------------------------------------------------------------------
# T7 gap-fill (2): CLI accept --yes is the sole write trigger
# ---------------------------------------------------------------------------

def test_cli_accept_without_yes_is_dry_run(tmp_path, capsys):
    """`cbim audit baseline accept` without --yes must NOT write baseline.json.

    Defends INV-AUDIT-3 (architecture): all baseline writes are explicit
    human gestures gated on --yes. Implicit acceptance silently grows the
    baseline and would defeat the ratchet.
    """
    _seed(tmp_path)
    _make_index(tmp_path, ["ghost"])  # produces at least one new finding

    store = BaselineStore(tmp_path)
    assert not store.exists()

    rc = _baseline_accept(
        store, tmp_path, checks=None, severity=None, yes=False,
    )
    assert rc == 0
    # Critical invariant: dry-run path NEVER writes the file.
    assert not store.exists(), "accept without --yes wrote baseline.json"

    # Output should mention dry-run so operators know it was a preview.
    out = capsys.readouterr().out
    assert "Dry-run" in out or "dry-run" in out.lower()


def test_cli_accept_with_yes_writes_baseline(tmp_path, capsys):
    """Counterpart to the dry-run test: --yes actually persists."""
    _seed(tmp_path)
    _make_index(tmp_path, ["ghost"])

    store = BaselineStore(tmp_path)
    rc = _baseline_accept(
        store, tmp_path, checks=None, severity=None, yes=True,
    )
    assert rc == 0
    assert store.exists(), "accept --yes did not write baseline.json"
    assert len(store.load()) >= 1


def test_cli_accept_no_new_findings_no_write(tmp_path, capsys):
    """If everything is already baselined, accept --yes still must not churn the file."""
    _seed(tmp_path)
    _make_index(tmp_path, ["ghost"])

    store = BaselineStore(tmp_path)
    # First call: --yes commits everything.
    _baseline_accept(store, tmp_path, checks=None, severity=None, yes=True)
    assert store.exists()
    mtime_before = store.path.stat().st_mtime_ns
    entries_before = store.load()

    # Second call: no new candidates → no save() invocation.
    rc = _baseline_accept(store, tmp_path, checks=None, severity=None, yes=True)
    assert rc == 0
    mtime_after = store.path.stat().st_mtime_ns
    entries_after = store.load()
    assert entries_before.keys() == entries_after.keys()
    # mtime invariance is the on-disk proof that no rewrite happened.
    assert mtime_before == mtime_after, "baseline file rewritten despite zero new entries"


# ---------------------------------------------------------------------------
# T7 gap-fill (3): exit code semantics — new-origin only, ignore mode = full
# ---------------------------------------------------------------------------

def test_exit_code_zero_for_empty_findings():
    assert _exit_code([], baseline_mode="lenient") == 0
    assert _exit_code([], baseline_mode="strict") == 0
    assert _exit_code([], baseline_mode="ignore") == 0


def test_exit_code_only_counts_new_origin_in_lenient_and_strict():
    """Baseline-origin findings are excluded from the gate signal.

    The ratchet's whole CI contract: previously-accepted drift no longer
    fails the build. Only new-origin findings drive a non-zero exit code.
    """
    baseline_err = _make_finding(target="old", severity="error")
    baseline_err.origin = "baseline"
    new_info = _make_finding(target="fresh", severity="info")
    new_info.origin = "new"

    # Lenient: baseline error ignored; only the new-info counts → exit 0
    # (info is below the failure threshold).
    assert _exit_code([baseline_err, new_info], baseline_mode="lenient") == 0
    # Strict: same — baseline still excluded; new-origin info is non-blocking.
    assert _exit_code([baseline_err, new_info], baseline_mode="strict") == 0


def test_exit_code_new_origin_error_fails():
    new_err = _make_finding(target="fresh", severity="error")
    new_err.origin = "new"
    rc = _exit_code([new_err], baseline_mode="lenient")
    assert rc != 0


def test_exit_code_new_origin_warn_fails():
    new_warn = _make_finding(target="fresh", severity="warn")
    new_warn.origin = "new"
    rc = _exit_code([new_warn], baseline_mode="lenient")
    assert rc != 0


def test_exit_code_ignore_mode_counts_all_findings():
    """`--baseline-mode=ignore` reverts to full-population gating.

    The escape hatch: a human can run a one-shot total inspection without
    blowing away the baseline file. Under ignore, even baseline-origin
    errors must surface as a non-zero exit.
    """
    baseline_err = _make_finding(target="old", severity="error")
    baseline_err.origin = "baseline"

    # Under non-ignore modes this would be filtered out and exit 0.
    assert _exit_code([baseline_err], baseline_mode="lenient") == 0
    # Under ignore mode it counts → non-zero.
    rc_ignore = _exit_code([baseline_err], baseline_mode="ignore")
    assert rc_ignore != 0
