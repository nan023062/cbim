"""Module registry — .cbim/index.md read/write helpers.

The registry is the canonical, fast-path source of "which modules exist in
this project". Full filesystem rglob is expensive on large monorepos, so:
  - list_modules() / snapshot.py read the registry first (O(N) where N =
    module count, not filesystem size)
  - init_module() appends new modules in place
  - reindex() / update_index() rebuild from rglob (manual recovery)

The registry lives in .cbim/index.md — NOT in the project root and NOT
wrapped in a redundant .dna/ layer. This decouples the framework-managed
registry from the optional project-root module document. .cbim/ is the
framework, not a business module, and is excluded from module scans by
_SCAN_SKIP_DIRS.
"""

from pathlib import Path

from atomic_io import atomic_write_text  # kernel root leaf — see context.py

from ._telemetry import _log_import, _rel_for_log
from .loader import _scan_modules, load_module


def index_path(root: Path) -> Path:
    """Return the canonical location of the module registry.

    Public helper — install/bootstrap reuses this to stay in sync with the
    kernel's authoritative path.
    """
    return root / ".cbim" / "index.md"


# Backwards-compatible private alias used throughout this module.
_index_path = index_path


def ensure_registry(root: Path) -> Path:
    """Create an empty .cbim/index.md if missing. Idempotent."""
    p = _index_path(root)
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("# Module Index\n", encoding="utf-8")
    return p


def read_index(root: Path) -> list[str]:
    """Return the list of module paths registered in .cbim/index.md.

    Returns [] if the registry doesn't exist or is empty. Each line is parsed
    as `- <path> [optional annotation]`; only the first whitespace-delimited
    token is taken (so `- . (root module)` yields `.`).
    """
    p = _index_path(root)
    if not p.exists():
        _log_import(f"dna:{_rel_for_log(p, root)}", "miss", "dna.load")
        return []
    _log_import(f"dna:{_rel_for_log(p, root)}", "ok", "dna.load")
    out = []
    for line in p.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.startswith("- "):
            s = s[2:].strip()
        if not s or s.startswith("#"):
            continue
        first = s.split()[0] if s.split() else ""
        if first:
            out.append(first)
    return out


def _write_index(root: Path, paths: list[str]) -> None:
    """Atomically rewrite .cbim/index.md with the given paths (sorted)."""
    ensure_registry(root)
    lines = ["# Module Index", ""]
    for p_str in sorted(set(paths)):
        lines.append(f"- {p_str}")
    atomic_write_text(_index_path(root), "\n".join(lines) + "\n")


def _append_to_index(root: Path, rel_path: str) -> None:
    """Add a single module path to the registry, preserving existing entries."""
    paths = set(read_index(root))
    paths.add(rel_path)
    _write_index(root, list(paths))


def list_modules(root: Path, use_registry: bool = True) -> list[dict]:
    """Return all modules. Reads .cbim/index.md by default for speed; falls
    back to a full filesystem scan if the registry is missing/empty.

    Pass use_registry=False to force a fresh scan (used by reindex / governance
    validation that needs to compare on-disk state against the registry).
    """
    if use_registry:
        registered = read_index(root)
        if registered:
            modules = []
            for rel in registered:
                mod_dir = root if rel == "." else (root / rel)
                m = load_module(mod_dir, root)
                if m:
                    modules.append(m)
            return modules
    return _scan_modules(root)


def update_index(root: Path, paths: list[str] | None = None) -> None:
    """Rebuild .cbim/index.md from a fresh filesystem scan (or accept an
    explicit path list). Use this for one-shot recovery / migration; the
    normal CLI flow keeps the registry up to date via init_module."""
    if paths is None:
        paths = [m["path"] for m in _scan_modules(root)]
    _write_index(root, paths)


__all__ = [
    "index_path",
    "_index_path",
    "ensure_registry",
    "read_index",
    "_write_index",
    "_append_to_index",
    "list_modules",
    "update_index",
]
