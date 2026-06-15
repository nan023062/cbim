"""`cbim log` domain — view per-session logs."""

import argparse


def register(sub: argparse._SubParsersAction) -> argparse.ArgumentParser:
    pl = sub.add_parser("log", help="View per-session logs")
    lsub = pl.add_subparsers(dest="command")
    _p = lsub.add_parser("show"); _p.add_argument("--lines", type=int, default=50); _p.add_argument("--session", default=None, help="Session slug substring (default: current)")
    _p = lsub.add_parser("tail"); _p.add_argument("--interval", type=float, default=1.0); _p.add_argument("--session", default=None, help="Session slug substring (default: current)")
    return pl


def dispatch(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    if not args.command:
        parser.print_help(); return 1
    # Late lookup via the engine.cli package: tests monkey-patch
    # engine.cli.cmd_log_show / cmd_log_tail (the historic module-level names),
    # AND engine.log_view.cmd_log_*. Resolving via the package picks up the
    # cli-level patch; the package re-exports the names from log_view so the
    # log_view-level patch also flows through (both paths work).
    from engine import cli as _pkg
    log_cmds = {"show": _pkg.cmd_log_show, "tail": _pkg.cmd_log_tail}
    return log_cmds[args.command](args)


__all__ = ["register", "dispatch"]
