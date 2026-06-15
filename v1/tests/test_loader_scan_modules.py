"""Equivalence tests for _scan_modules walk-time pruning rewrite (Batch 6).

These tests assert that the new single-pass DFS implementation produces
the same module list (and same order) as the legacy rglob + post-filter
approach, so the optimisation is provably zero-behavior-change.
"""

from pathlib import Path

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
        f"description: test\n"
        f"keywords: []\n"
        f"dependencies: []\n"
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
