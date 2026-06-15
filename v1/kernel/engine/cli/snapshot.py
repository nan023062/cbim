"""`cbim snapshot` domain — print project knowledge snapshot."""

import argparse


def register(sub: argparse._SubParsersAction) -> argparse.ArgumentParser:
    ps = sub.add_parser("snapshot", help="Project knowledge snapshot")
    ps.add_argument("--root", default=".")
    return ps


def dispatch(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    from services import build_snapshot
    print(build_snapshot(cwd=args.root))
    return 0


__all__ = ["register", "dispatch"]
