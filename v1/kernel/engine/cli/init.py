"""`cbim init` domain — bootstrap a new CBIM project at cwd."""

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> argparse.ArgumentParser:
    pinit = sub.add_parser("init", help="Bootstrap a new CBIM project in cwd")
    pinit.add_argument("--force", action="store_true",
                       help="Overwrite existing files (default: idempotent)")
    return pinit


def dispatch(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    from engine import cli as _pkg
    return _pkg._cmd_init(args)


def _cmd_init(args) -> int:
    """Bootstrap a new CBIM project at the current working directory.

    `init` MUST target cwd, never `project_root()`. The latter walks up to find
    an existing `.cbim/`, which is the wrong semantics for bootstrap and has
    historically caused init to clobber the user-global `~/.cbim/` when run
    from a non-project subdirectory.
    """
    from project.init import init_project

    target = Path.cwd().resolve()
    init_project(target, force=args.force)
    return 0


__all__ = ["register", "dispatch"]
