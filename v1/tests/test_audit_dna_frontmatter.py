"""Unit tests for engine.audit.checks.dna_frontmatter."""
from __future__ import annotations

from pathlib import Path

from engine.audit.checks.dna_frontmatter import check


def _make_module(root: Path, rel: str, fm: str) -> None:
    mod = root if rel == "." else (root / rel)
    dna = mod / ".dna"
    dna.mkdir(parents=True, exist_ok=True)
    (dna / "module.md").write_text(
        f"---\n{fm}\n---\n\nbody\n",
        encoding="utf-8",
    )


_V2_FM = (
    "name: m\n"
    "owner: x\n"
    "description: m\n"
    "keywords: []\n"
    "status: implemented"
)


def test_clean_v2_module_no_findings(tmp_path):
    _make_module(tmp_path, ".", _V2_FM)
    assert check(tmp_path, {}) == []


def test_dependencies_field_emits_warn(tmp_path):
    _make_module(
        tmp_path, ".",
        _V2_FM + "\ndependencies:\n  - some/other",
    )
    findings = check(tmp_path, {})
    assert len(findings) == 1
    f = findings[0]
    assert f.code == "DNA_FM_OBSOLETE_FIELD"
    assert f.severity == "warn"
    assert f.target == "."
    assert f.metadata["field"] == "dependencies"
    assert "migrate_2_x.py --apply" in f.suggestion


def test_includedirs_field_emits_warn(tmp_path):
    _make_module(
        tmp_path, ".",
        _V2_FM + "\nincludeDirs:\n  - foo/",
    )
    findings = check(tmp_path, {})
    assert len(findings) == 1
    f = findings[0]
    assert f.code == "DNA_FM_OBSOLETE_FIELD"
    assert f.metadata["field"] == "includeDirs"


def test_both_fields_emit_two_warnings(tmp_path):
    _make_module(
        tmp_path, ".",
        _V2_FM + "\ndependencies:\n  - x\nincludeDirs:\n  - y/",
    )
    findings = check(tmp_path, {})
    assert len(findings) == 2
    fields = sorted(f.metadata["field"] for f in findings)
    assert fields == ["dependencies", "includeDirs"]


def test_multiple_modules_each_reported(tmp_path):
    _make_module(tmp_path, ".", _V2_FM)
    _make_module(tmp_path, "alpha", _V2_FM + "\ndependencies:\n  - x")
    _make_module(tmp_path, "beta", _V2_FM + "\nincludeDirs:\n  - y/")
    findings = check(tmp_path, {})
    assert len(findings) == 2
    by_target = {f.target: f for f in findings}
    assert by_target["alpha"].metadata["field"] == "dependencies"
    assert by_target["beta"].metadata["field"] == "includeDirs"


def test_skip_dirs_not_walked(tmp_path):
    """Vendored copies under skip dirs (node_modules, .venv) are ignored."""
    _make_module(tmp_path, ".", _V2_FM)
    _make_module(
        tmp_path, "node_modules/pkg",
        _V2_FM + "\ndependencies:\n  - x",
    )
    findings = check(tmp_path, {})
    assert findings == []


def test_check_in_registry():
    """Ensure the new check is wired into the registry."""
    from engine.audit.registry import list_check_names
    assert "dna_frontmatter" in list_check_names()
