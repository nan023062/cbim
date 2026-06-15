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
        print(f"[DEPRECATED] {mod_dir}: using legacy module.json + architecture.md; "
              f"migrate to module.md", file=sys.stderr)
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
}


def _is_skipped(mod_dir: Path, root: Path) -> bool:
    try:
        parts = mod_dir.relative_to(root).parts
    except ValueError:
        return False
    return any(p in _SCAN_SKIP_DIRS for p in parts)


def _scan_modules(root: Path) -> list[dict]:
    """Slow path: rglob the filesystem for all .dna/module.md (and legacy
    module.json) files, skipping vendor/build/framework dirs. Used by reindex
    and as a fallback when the registry is missing."""
    modules = []
    seen_dirs: set[Path] = set()

    for mm in sorted(root.rglob(".dna/module.md")):
        mod_dir = mm.parent.parent
        if _is_skipped(mod_dir, root):
            continue
        seen_dirs.add(mod_dir)
        m = load_module(mod_dir, root)
        if m:
            modules.append(m)

    for mj in sorted(root.rglob(".dna/module.json")):
        mod_dir = mj.parent.parent
        if mod_dir in seen_dirs or _is_skipped(mod_dir, root):
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
