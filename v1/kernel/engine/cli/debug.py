"""`cbim debug` domain — toggle the .cbim/.debug flag."""

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> argparse.ArgumentParser:
    pdb = sub.add_parser("debug", help="Toggle debug logging flag")
    dbsub = pdb.add_subparsers(dest="command")
    dbsub.add_parser("on")
    dbsub.add_parser("off")
    dbsub.add_parser("status")
    return pdb


def dispatch(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    if not args.command:
        parser.print_help(); return 1
    from engine import cli as _pkg
    return _pkg._cmd_debug(args)


def _debug_flag_path() -> Path | None:
    """Return the project-local opt-in diagnostic logging flag."""
    from context import cbim_dir
    return cbim_dir() / ".debug"


def _cmd_debug(args) -> int:
    """Explicitly toggle the project-local diagnostic logging flag."""
    flag = _debug_flag_path()
    if flag is None:
        print("debug: cannot locate project root")
        return 1
    if args.command == "on":
        flag.parent.mkdir(parents=True, exist_ok=True)
        flag.touch()
        print(f"debug: on (flag at {flag})")
        return 0
    if args.command == "off":
        if flag.exists():
            flag.unlink()
        print("debug: off (flag removed)")
        return 0
    if args.command == "status":
        state = "on" if flag.exists() else "off"
        print(f"debug: {state}")
        return 0
    return 1


__all__ = ["register", "dispatch"]
