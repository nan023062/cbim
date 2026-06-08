"""Smoke test for kernel.__version__ resolution.

Verifies that the version resolver in v1/kernel/__init__.py returns a
non-empty, non-fallback value. The resolver tries (in order):
  1. VERSION file next to __init__.py (release tarball case)
  2. `git describe --tags --always --dirty` (dev checkout case)
  3. Literal "0.0.0+unknown" (last-resort fallback)

In CI / dev with git available we expect path 2 to succeed; in container
environments without git the assertion is relaxed to "non-empty" only.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path


def _import_kernel_package():
    # conftest puts v1/kernel/ on sys.path so subpackages (engine, cbi, ...)
    # import directly; for the kernel package itself we need v1/ on the path.
    v1_dir = Path(__file__).resolve().parent.parent
    s = str(v1_dir)
    if s not in sys.path:
        sys.path.insert(0, s)
    # Drop any cached half-import so we re-evaluate the resolver
    sys.modules.pop("kernel", None)
    import kernel  # noqa: E402
    return kernel


def test_kernel_version_resolves():
    kernel = _import_kernel_package()
    assert kernel.__version__, "kernel.__version__ must be a non-empty string"

    # If git is on PATH we expect path 2 (git describe) to win over the
    # literal fallback. Without git (rare CI image), accept fallback.
    if shutil.which("git") is not None:
        assert kernel.__version__ != "0.0.0+unknown", (
            "git is available but version resolver fell back to literal — "
            "VERSION file or git describe should have produced a real value"
        )
