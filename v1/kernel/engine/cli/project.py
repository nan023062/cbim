"""`cbim project` domain — project-level template & layout maintenance."""

import argparse
import sys


def register(sub: argparse._SubParsersAction) -> argparse.ArgumentParser:
    pproj = sub.add_parser("project", help="Project-level template & layout maintenance")
    projsub = pproj.add_subparsers(dest="command")
    _p = projsub.add_parser(
        "sync",
        help="Refresh kernel-managed project files (CLAUDE.md, agents, settings.json, .gitignore)",
    )
    _p.add_argument("--dry-run", action="store_true", dest="dry_run",
                    help="Print what would be synced without writing anything")
    return pproj


def dispatch(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    if not args.command:
        parser.print_help(); return 1
    from engine import cli as _pkg
    return _pkg._cmd_project(args)


def _cmd_project(args) -> int:
    """Route `cbim project <subcommand>`.

    Currently only `sync` is wired. Targets the resolved project root (walks up
    from cwd looking for .cbim/config.json), not bare cwd, because sync is
    meaningless outside a project.
    """
    from context import project_root as find_project_root
    from project.sync import sync_templates

    if args.command != "sync":
        return 1

    # project_root() walks up from cwd looking for .cbim/config.json (or .cbim/).
    # It never returns None; on miss it degrades to cwd. Validate that the
    # resolved root actually has .cbim/config.json — sync is meaningless without
    # a real project.
    try:
        root = find_project_root()
    except RuntimeError as e:
        print(f"project sync: {e}", file=sys.stderr)
        return 1
    if not (root / ".cbim" / "config.json").is_file():
        print(
            "project sync: no CBIM project found (no .cbim/config.json in cwd "
            "or any ancestor); cd into a project root first",
            file=sys.stderr,
        )
        return 1

    prefix = "[cbim] [dry-run] " if args.dry_run else "[cbim] "
    print(f"{prefix}Syncing kernel-managed templates in {root}")
    for action in sync_templates(root, dry_run=args.dry_run):
        print(f"{prefix}{action}")
    if args.dry_run:
        print(f"{prefix}--- DRY RUN complete ---")
    else:
        print("[cbim] Sync complete.")
    return 0


__all__ = ["register", "dispatch"]
