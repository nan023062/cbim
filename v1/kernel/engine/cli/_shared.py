"""Shared CLI helpers used across multiple domain handlers.

Stdlib-only — must NOT import any other engine.cli sub-module to avoid
circular imports back through engine.cli.__init__.
"""

import argparse
import sys
from pathlib import Path


def _read_content_arg(args: argparse.Namespace, *, allow_stdin: bool = True) -> str | None:
    """Resolve --content / --content-file / --stdin into one body string.

    Shared by `dna edit`, `agent update`, and `agent add-skill`. Returns the
    resolved string, None when no source was provided. Raises ValueError on
    mutually-exclusive misuse or unreadable --content-file.
    """
    sources = [
        ("--content", args.content is not None),
        ("--content-file", getattr(args, "content_file", None) is not None),
    ]
    if allow_stdin:
        sources.append(("--stdin", bool(getattr(args, "stdin", False))))
    provided = [name for name, ok in sources if ok]

    if len(provided) == 0:
        return None
    if len(provided) > 1:
        raise ValueError(f"{', '.join(provided)} are mutually exclusive")

    if args.content is not None:
        return args.content
    if getattr(args, "content_file", None) is not None:
        src = Path(args.content_file)
        if not src.is_file():
            raise ValueError(f"--content-file not found: {src}")
        return src.read_text(encoding="utf-8")
    return sys.stdin.read()


__all__ = ["_read_content_arg"]
