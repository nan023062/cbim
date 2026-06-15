"""Module loaders — read .dna/module.md (new format) or .dna/module.json
(legacy) plus the rglob scanner used by reindex / fallback paths.
"""

import json
import sys
from pathlib import Path

from services._fm import parse_frontmatter, strip_frontmatter

from ._telemetry import _log_import, _rel_for_log

# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

def load_module(mod_dir: Path, root: Path) -> dict | None:
    aimod = mod_dir / ".dna"
    module_md = aimod / "module.md"
    legacy_json = aimod / "module.json"

    if module_md.exists():
        return _load_new_format(mod_dir, root, aimod, module_md)
    elif legacy_json.exists():
        print(f"[DEPRECATED] {mod_dir}: legacy module.json + architecture.md "
              f"format is deprecated and will be removed in the next minor "
              f"release (1.1.0); migrate to module.md.", file=sys.stderr)
        return _load_legacy_format(mod_dir, root, aimod, legacy_json)
    else:
        _log_import(f"dna:{_rel_for_log(module_md, root)}", "miss", "dna.load")
        return None


def _load_new_format(mod_dir: Path, root: Path, aimod: Path, module_md: Path) -> dict | None:
    try:
        raw = module_md.read_text(encoding="utf-8")
        _log_import(f"dna:{_rel_for_log(module_md, root)}", "ok", "dna.load")
    except Exception:
        _log_import(f"dna:{_rel_for_log(module_md, root)}", "miss", "dna.load")
        return None

    data = parse_frontmatter(raw)
    body = strip_frontmatter(raw)
    rel = mod_dir.relative_to(root).as_posix()

    contract_path = aimod / "contract.md"
    if contract_path.exists():
        contract = contract_path.read_text(encoding="utf-8")
        _log_import(f"dna:{_rel_for_log(contract_path, root)}", "ok", "dna.load")
    else:
        contract = ""
    workflows_dir = aimod / "workflows"
    workflows = sorted(w.parent.name for w in workflows_dir.glob("*/workflow.md")) \
        if workflows_dir.exists() else []

    return {
        "id": rel or ".",
        "path": rel or ".",
        "name": data.get("name", rel),
        "owner": data.get("owner", ""),
        "description": data.get("description", ""),
        "keywords": data.get("keywords", []),
        "dependencies": data.get("dependencies", []),
        # Backward compat: older module.md files have no `status` — default to
        # "implemented" because by definition the existing code in the repo
        # already realises whatever the DNA describes (otherwise the file
        # wouldn't be there yet).
        "status": data.get("status", "implemented"),
        "architecture": body,
        "contract": contract,
        "workflows": workflows,
    }


def _load_legacy_format(mod_dir: Path, root: Path, aimod: Path,
                        legacy_json: Path) -> dict | None:
    try:
        data = json.loads(legacy_json.read_text(encoding="utf-8"))
        _log_import(f"dna:{_rel_for_log(legacy_json, root)}", "ok", "dna.load")
    except Exception:
        _log_import(f"dna:{_rel_for_log(legacy_json, root)}", "miss", "dna.load")
        return None

    rel = mod_dir.relative_to(root).as_posix()
    arch_path = aimod / "architecture.md"
    if arch_path.exists():
        arch = arch_path.read_text(encoding="utf-8")
        _log_import(f"dna:{_rel_for_log(arch_path, root)}", "ok", "dna.load")
    else:
        arch = ""
    contract_path = aimod / "contract.md"
    if contract_path.exists():
        contract = contract_path.read_text(encoding="utf-8")
        _log_import(f"dna:{_rel_for_log(contract_path, root)}", "ok", "dna.load")
    else:
        contract = ""
    workflows_dir = aimod / "workflows"
    workflows = sorted(w.parent.name for w in workflows_dir.glob("*/workflow.md")) \
        if workflows_dir.exists() else []

    return {
        "id": rel or ".",
        "path": rel or ".",
        "name": data.get("name", rel),
        "owner": data.get("owner", ""),
        "description": data.get("description", ""),
        "keywords": data.get("keywords", []),
        "dependencies": data.get("dependencies", []),
        # Legacy module.json was authored before the status field existed —
        # treat as implemented for backward compat (see _load_new_format).
        "status": data.get("status", "implemented"),
        "architecture": arch,
        "contract": contract,
        "workflows": workflows,
    }


# Directories never scanned for .dna/ — they're vendor/build/framework noise,
# not user business modules. Notably:
#   - node_modules (+ .pnpm/...): pnpm copies workspace pkgs in, which duplicates
#     real .dna/ many times and pollutes the index.
#   - .cbim: the framework itself; user projects host it but shouldn't index it.
#   - .git / dist / build / __pycache__ / .venv / coverage / .next / .cache:
#     standard tool output / VCS metadata.
_SCAN_SKIP_DIRS = {
    "node_modules", ".git", "dist", "build", "__pycache__",
    ".venv", ".cbim", ".pnpm-store", "coverage",
    ".next", ".cache",
    # Walk-time pruning additions (Batch 6): these were already filtered
    # post-hoc by _is_skipped via path-segment scan in some call sites, but
    # adding them here lets the DFS skip whole subtrees up front.
    "venv", ".tox", ".idea", ".vscode",
    ".mypy_cache", ".pytest_cache", ".ruff_cache", "htmlcov",
}


def _is_skipped(mod_dir: Path, root: Path) -> bool:
    try:
        parts = mod_dir.relative_to(root).parts
    except ValueError:
        return False
    return any(p in _SCAN_SKIP_DIRS for p in parts)


def _walk_dna_dirs(root: Path) -> tuple[list[Path], list[Path]]:
    """Single-pass DFS that returns (md_dirs, json_dirs).

    Each list contains module directories (parent of .dna/) where a
    module.md (resp. module.json) was found. md takes precedence: if a
    module dir has both, it appears only in md_dirs.

    Pruning rules (must stay equivalent to ``rglob(".dna/module.*")``
    followed by ``_is_skipped`` filtering):
      * directory name in ``_SCAN_SKIP_DIRS`` -> do not descend
      * symlink -> skip (rglob default does not follow symlinks)
      * ``.dna`` directory -> collect its module.md / module.json from
        the parent, then do NOT descend into .dna/ itself
      * OSError on iterdir / is_dir / is_symlink -> skip silently
        (matches hooks _iter_dna_modules behavior on permission denied
        / broken symlink / path too long)
    """
    md_dirs: list[Path] = []
    json_dirs: list[Path] = []
    seen: set[Path] = set()

    def _walk(d: Path) -> None:
        try:
            children = list(d.iterdir())
        except OSError:
            return
        for child in children:
            name = child.name
            if name in _SCAN_SKIP_DIRS:
                continue
            try:
                if child.is_symlink() or not child.is_dir():
                    continue
            except OSError:
                continue
            if name == ".dna":
                mod_dir = child.parent
                if mod_dir in seen:
                    continue
                if (child / "module.md").is_file():
                    md_dirs.append(mod_dir)
                    seen.add(mod_dir)
                elif (child / "module.json").is_file():
                    json_dirs.append(mod_dir)
                    seen.add(mod_dir)
                # Never descend into .dna/ itself.
                continue
            _walk(child)

    _walk(root)
    return md_dirs, json_dirs


def _scan_modules(root: Path) -> list[dict]:
    """Slow path: walk the filesystem for all .dna/module.md (and legacy
    module.json) files, skipping vendor/build/framework dirs at walk time.
    Used by reindex and as a fallback when the registry is missing.

    Equivalent in output (modulo identical ordering) to the prior
    rglob-based implementation; the rewrite is a pure traversal speedup
    that prunes skip dirs up front instead of post-filtering.
    """
    md_dirs, json_dirs = _walk_dna_dirs(root)

    # Re-establish the legacy ordering: previously the implementation
    # used ``sorted(root.rglob(".dna/module.md"))``, which sorts Path
    # objects lexicographically including the trailing ``.dna/module.md``
    # segment. DFS visit order is not guaranteed to match that, so we
    # sort with the equivalent key.
    md_dirs.sort(key=lambda p: p / ".dna" / "module.md")
    json_dirs.sort(key=lambda p: p / ".dna" / "module.json")

    modules: list[dict] = []
    for mod_dir in md_dirs:
        # Belt-and-suspenders: walk-time pruning already excludes these,
        # but keep _is_skipped as a second gate in case a skip name
        # appears mid-path via an exotic mount.
        if _is_skipped(mod_dir, root):
            continue
        m = load_module(mod_dir, root)
        if m:
            modules.append(m)

    for mod_dir in json_dirs:
        if _is_skipped(mod_dir, root):
            continue
        m = load_module(mod_dir, root)
        if m:
            modules.append(m)

    return modules


__all__ = [
    "load_module",
    "_load_new_format",
    "_load_legacy_format",
    "_SCAN_SKIP_DIRS",
    "_is_skipped",
    "_scan_modules",
]
