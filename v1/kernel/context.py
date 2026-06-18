"""
Single source of truth for runtime path resolution.

Two public root resolvers — one strict, one lenient. The split exists
because runtime callers (MCP / dashboard / hooks) want a hard error when
they're invoked from somewhere that isn't a CBIM project, while CLI /
tests / service-internals want a graceful degradation to cwd when no
project marker is found (so unit tests and ad-hoc commands keep working
in scratch directories).

Both paths share the same env-var override and the same hard
home-directory boundary; the only difference is what happens when the
walk reaches the filesystem root with no `.cbim/` marker found.

Functions
---------
project_root(cwd=None)        STRICT — raises RuntimeError when no .cbim/.
resolve_root_or_cwd(cwd=None) LENIENT — falls back to cwd when no .cbim/.
kernel_root()                 Kernel installation root (env var or __file__).
cbim_dir()                    project_root() / ".cbim".
"""
import os
from pathlib import Path


def _coerce_cwd(cwd: Path | str | None) -> Path:
    if cwd is None:
        return Path.cwd().resolve()
    return Path(cwd).resolve()


def _check_home_boundary(candidate: Path, home: Path | None) -> None:
    """Raise if `candidate` equals the user home directory.

    Treating ~/.cbim/ as a project root has caused `cbim init` to silently
    overwrite user-global files; the home boundary is non-negotiable on
    every walk regardless of strict/lenient mode.
    """
    if home is not None and candidate == home:
        raise RuntimeError(
            "refusing to treat user home as a CBIM project root "
            f"({candidate}); run from inside a project directory or set "
            "CBIM_PROJECT_ROOT explicitly"
        )


def _resolved_home() -> Path | None:
    try:
        return Path.home().resolve()
    except (RuntimeError, OSError):
        return None


def project_root(cwd: Path | str | None = None) -> Path:
    """Return the project root directory (the directory containing `.cbim/`).

    STRICT — raises RuntimeError when the walk reaches the filesystem root
    without finding a `.cbim/` marker. Used by runtime entry points
    (MCP server, dashboard, hooks) where a missing project is a misconfig
    and should fail loudly.

    Resolution order:
      1. CBIM_PROJECT_ROOT env var wins **when no explicit cwd was passed**
         (env is a fallback, not an override; no walk, no validation).
      2. Walk up from `cwd` (default: Path.cwd()) preferring
         `.cbim/config.json` over a bare `.cbim/` directory; no step limit.
      3. If the walk reaches `Path.home()`, raise RuntimeError (home boundary).
      4. If the walk reaches the filesystem root with no marker, raise
         RuntimeError (the strict differentiator from `resolve_root_or_cwd`).
    """
    if cwd is None and "CBIM_PROJECT_ROOT" in os.environ:
        return Path(os.environ["CBIM_PROJECT_ROOT"])
    start = _coerce_cwd(cwd)
    home = _resolved_home()
    for candidate in [start, *start.parents]:
        _check_home_boundary(candidate, home)
        if (candidate / ".cbim" / "config.json").exists():
            return candidate
        if (candidate / ".cbim").is_dir():
            return candidate
    raise RuntimeError(
        f"no .cbim/ marker found walking up from {start}; "
        f"set CBIM_PROJECT_ROOT or run from inside a CBIM project"
    )


def resolve_root_or_cwd(cwd: Path | str | None = None) -> Path:
    """Return the project root if found, else degrade to `cwd`.

    LENIENT — used by CLI, tests, and service internals where running
    outside a CBIM project is a legitimate use-case (scratch dirs,
    ad-hoc invocations). Mirrors the legacy `services._fm.find_project_root`
    semantics but also enforces the home-directory boundary.

    Resolution order:
      1. CBIM_PROJECT_ROOT env var wins **when no explicit cwd was passed**
         (env is a fallback, not an override).
      2. Walk up from `cwd` looking for `.cbim/`, capped at 10 ancestors
         (preserves the historical `_fm.find_project_root` budget).
      3. Home boundary still raises (the home guard is never relaxed).
      4. No marker found → return `cwd.resolve()` unchanged.
    """
    if cwd is None and "CBIM_PROJECT_ROOT" in os.environ:
        return Path(os.environ["CBIM_PROJECT_ROOT"])
    start = _coerce_cwd(cwd)
    home = _resolved_home()
    cur = start
    for _ in range(10):
        _check_home_boundary(cur, home)
        if (cur / ".cbim").is_dir():
            return cur
        if cur.parent == cur:
            break
        cur = cur.parent
    return start


def kernel_root() -> Path:
    """Return the kernel installation root (the directory containing engine/, cbi/, ...)."""
    if "CBIM_KERNEL_ROOT" in os.environ:
        return Path(os.environ["CBIM_KERNEL_ROOT"])
    return Path(__file__).parent


def cbim_dir() -> Path:
    """Return the .cbim/ state directory (always project_root() / '.cbim')."""
    return project_root() / ".cbim"
