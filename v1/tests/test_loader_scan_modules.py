"""Equivalence tests for _scan_modules walk-time pruning rewrite (Batch 6).

These tests assert that the new single-pass DFS implementation produces
the same module list (and same order) as the legacy rglob + post-filter
approach, so the optimisation is provably zero-behavior-change.
"""

from pathlib import Path

import pytest

from cbi._primitives.modules.loader import (
    _SCAN_SKIP_DIRS,
    _is_skipped,
    _scan_modules,
)


def _mk_module_md(root: Path, rel: str, name: str | None = None) -> None:
    mod_dir = root / rel
    aimod = mod_dir / ".dna"
    aimod.mkdir(parents=True, exist_ok=True)
    fm_name = name if name is not None else rel.replace("/", "-")
    (aimod / "module.md").write_text(
        f"---\nname: {fm_name}\n"
        f"owner: tester\n"
        f"description: test\n"
        f"keywords: []\n"
        f"status: implemented\n"
        f"---\nbody\n",
        encoding="utf-8",
    )


def _mk_module_json(root: Path, rel: str, name: str | None = None) -> None:
    mod_dir = root / rel
    aimod = mod_dir / ".dna"
    aimod.mkdir(parents=True, exist_ok=True)
    fm_name = name if name is not None else rel.replace("/", "-")
    import json as _json
    (aimod / "module.json").write_text(
        _json.dumps({"name": fm_name, "description": "legacy"}),
        encoding="utf-8",
    )
    # legacy format also needs an architecture.md placeholder
    (aimod / "architecture.md").write_text("legacy arch", encoding="utf-8")


def test_scan_skips_vendor_dirs_at_walk_time(tmp_path: Path) -> None:
    """Vendor / framework directories are pruned at walk time and never
    show up as modules even if they contain a valid .dna/module.md."""
    root = tmp_path

    # Should be picked up.
    _mk_module_md(root, "pkg-a")
    _mk_module_md(root, "pkg-b/sub")

    # Should NOT be picked up — skip dirs are pruned at walk time.
    _mk_module_md(root, "node_modules/x")
    _mk_module_md(root, ".git/refs")
    _mk_module_md(root, ".venv/lib")
    _mk_module_md(root, "build/foo")
    _mk_module_md(root, "__pycache__/bar")
    # Newly-added skip dirs in Batch 6.
    _mk_module_md(root, "venv/site")
    _mk_module_md(root, ".pytest_cache/baz")
    _mk_module_md(root, ".idea/q")

    modules = _scan_modules(root)
    ids = [m["id"] for m in modules]
    assert ids == ["pkg-a", "pkg-b/sub"], ids


def test_scan_order_matches_legacy_rglob(tmp_path: Path) -> None:
    """The new DFS output, after sorting, must equal the legacy
    rglob+_is_skipped output element-for-element. We compute the legacy
    answer in-test as ground truth."""
    root = tmp_path

    # Multiple nested .dna dirs in deliberately scrambled creation order.
    _mk_module_md(root, "z/last")
    _mk_module_md(root, "a")
    _mk_module_md(root, "m/mid")
    _mk_module_md(root, "a/nested")
    _mk_module_md(root, "b")
    # A legacy json-only module to also exercise the json path.
    _mk_module_json(root, "leg/legacy-only")
    # A skip dir in the middle that should drop out.
    _mk_module_md(root, "build/ignored")

    # Ground truth: replicate the *old* implementation here.
    md_truth: list[Path] = []
    seen_truth: set[Path] = set()
    for mm in sorted(root.rglob(".dna/module.md")):
        mod_dir = mm.parent.parent
        if _is_skipped(mod_dir, root):
            continue
        seen_truth.add(mod_dir)
        md_truth.append(mod_dir)
    json_truth: list[Path] = []
    for mj in sorted(root.rglob(".dna/module.json")):
        mod_dir = mj.parent.parent
        if mod_dir in seen_truth or _is_skipped(mod_dir, root):
            continue
        # Skip when the same dir already produced a module.md hit so we
        # don't double-count (the new impl achieves this via `seen`).
        json_truth.append(mod_dir)

    truth_ids = [
        (p.relative_to(root).as_posix() or ".") for p in (md_truth + json_truth)
    ]

    actual_ids = [m["id"] for m in _scan_modules(root)]

    assert actual_ids == truth_ids, (actual_ids, truth_ids)


def test_scan_md_takes_precedence_over_json(tmp_path: Path) -> None:
    """A module dir with BOTH module.md and module.json yields exactly
    one entry, sourced from the new (md) format."""
    root = tmp_path
    _mk_module_md(root, "pkg", name="pkg-md")
    # Add a module.json alongside; load_module's md-first preference plus
    # the walker's `seen` set must keep us at one entry total.
    import json as _json
    (root / "pkg" / ".dna" / "module.json").write_text(
        _json.dumps({"name": "pkg-json", "description": "legacy"}),
        encoding="utf-8",
    )
    (root / "pkg" / ".dna" / "architecture.md").write_text(
        "legacy arch",
        encoding="utf-8",
    )

    modules = _scan_modules(root)
    assert len(modules) == 1, modules
    assert modules[0]["id"] == "pkg"
    assert modules[0]["name"] == "pkg-md"


def test_scan_skip_dirs_membership_only_grows() -> None:
    """Sanity check: every legacy skip name is still in _SCAN_SKIP_DIRS
    after the Batch 6 additions. This guards against accidental removal
    during future edits."""
    legacy = {
        "node_modules", ".git", "dist", "build", "__pycache__",
        ".venv", ".cbim", ".pnpm-store", "coverage",
        ".next", ".cache",
    }
    assert legacy <= _SCAN_SKIP_DIRS


# --- Batch 5.6: load_module narrowed-except fixtures ---------------------


def test_load_module_returns_none_on_unreadable_md(tmp_path, monkeypatch):
    """`module.md` raises OSError on read → load_module returns None.
    Covers the narrowed `except (OSError, UnicodeDecodeError)` branch."""
    from cbi._primitives.modules.loader import load_module

    _mk_module_md(tmp_path, "pkg")
    real_read = Path.read_text

    def boom(self, *args, **kwargs):
        if self.name == "module.md" and self.parent.name == ".dna":
            raise OSError("simulated read failure")
        return real_read(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", boom)

    assert load_module(tmp_path / "pkg", tmp_path) is None


def test_load_module_returns_none_on_non_utf8(tmp_path):
    """Binary garbage in module.md → UnicodeDecodeError → caught → None."""
    from cbi._primitives.modules.loader import load_module

    mod = tmp_path / "pkg"
    (mod / ".dna").mkdir(parents=True)
    (mod / ".dna" / "module.md").write_bytes(b"\xff\xfe\x00garbage")

    assert load_module(mod, tmp_path) is None


def test_load_module_legacy_json_returns_none_on_corrupt(tmp_path):
    """Legacy module.json with broken JSON → JSONDecodeError → caught → None."""
    from cbi._primitives.modules.loader import load_module

    mod = tmp_path / "pkg"
    (mod / ".dna").mkdir(parents=True)
    (mod / ".dna" / "module.json").write_text(
        "{not valid json", encoding="utf-8"
    )

    assert load_module(mod, tmp_path) is None


def test_load_module_unrelated_exception_propagates(tmp_path, monkeypatch):
    """A RuntimeError inside the try block (e.g. _log_import blowing up
    for some reason) MUST propagate — narrowing's whole point is that
    we no longer swallow bug-class exceptions."""
    from cbi._primitives.modules import loader as loader_mod

    _mk_module_md(tmp_path, "pkg")

    def boom(*args, **kwargs):
        raise RuntimeError("simulated logger bug")

    monkeypatch.setattr(loader_mod, "_log_import", boom)

    with pytest.raises(RuntimeError, match="simulated logger bug"):
        loader_mod.load_module(tmp_path / "pkg", tmp_path)


# --- Batch 5.6: _telemetry._rel_for_log narrowed-except ------------------


def test_rel_for_log_returns_posix_on_value_error(tmp_path):
    """Cross-drive (or otherwise non-relative) path → ValueError caught,
    posix string returned."""
    from cbi._primitives.modules._telemetry import _rel_for_log

    # Construct a path that cannot be made relative to tmp_path.
    other = Path("/totally/unrelated/path") if not str(tmp_path).startswith("/") else Path("C:/elsewhere")
    out = _rel_for_log(other, tmp_path)
    # Whatever path we passed in, its as_posix() form is what we expect back.
    assert out == other.as_posix()


def test_rel_for_log_returns_posix_on_oserror(tmp_path, monkeypatch):
    """Path.resolve() raising OSError → caught → posix fallback."""
    from cbi._primitives.modules import _telemetry

    real_resolve = Path.resolve

    def boom(self, *args, **kwargs):
        # Only blow up the input path; let root resolve normally.
        if self == tmp_path / "x":
            raise OSError("simulated resolve failure")
        return real_resolve(self, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", boom)

    out = _telemetry._rel_for_log(tmp_path / "x", tmp_path)
    assert out == (tmp_path / "x").as_posix()

