"""CBIM kernel package version."""
from pathlib import Path as _Path

def _read_version() -> str:
    # 1. Release tarball / installed kernel: VERSION sits next to __init__.py
    version_file = _Path(__file__).parent / "VERSION"
    if version_file.is_file():
        try:
            v = version_file.read_text(encoding="utf-8").strip()
            if v:
                return v
        except OSError:
            pass
    # 2. Dev / git checkout: derive from git describe
    try:
        import subprocess
        result = subprocess.run(
            ["git", "describe", "--tags", "--always", "--dirty"],
            cwd=_Path(__file__).resolve().parent,
            capture_output=True, text=True, timeout=2, check=False,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip().lstrip("v") + "+dev"
    except (OSError, subprocess.SubprocessError):
        pass
    # 3. Last resort
    return "0.0.0+unknown"

__version__ = _read_version()
