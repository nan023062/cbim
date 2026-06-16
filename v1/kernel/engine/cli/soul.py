"""`cbim soul` domain — list / show built-in agent soul content."""

import argparse
import sys

from engine.import_log import log_import


def register(sub: argparse._SubParsersAction) -> argparse.ArgumentParser:
    psl = sub.add_parser("soul", help="List or show built-in agent soul content")
    slsub = psl.add_subparsers(dest="command")
    slsub.add_parser("list")
    _p = slsub.add_parser("show"); _p.add_argument("name")
    return psl


def dispatch(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    from engine import cli as _pkg
    return _pkg._cmd_soul(args, parser)


def _load_souls(trigger: str | None = None) -> dict[str, str]:
    from project.sync import KERNEL_AGENT_NAMES, read_agent_md, read_template
    souls: dict[str, str] = {}
    for name in KERNEL_AGENT_NAMES:
        label = f"project.agents.{name}.md"
        try:
            souls[name] = read_agent_md(name)
            if trigger is not None:
                log_import(label, "ok", trigger)
        except FileNotFoundError:
            if trigger is not None:
                log_import(label, "miss", trigger)
            continue
    coord_template = "CLAUDE.md.tmpl"
    try:
        souls["assistant"] = read_template(coord_template)
        if trigger is not None:
            log_import(f"project.templates.{coord_template}", "ok", trigger)
    except FileNotFoundError:
        if trigger is not None:
            log_import(f"project.templates.{coord_template}", "miss", trigger)
    return souls


def _cmd_soul(args, parser):
    if not args.command:
        parser.print_help(); return 1
    if args.command == "list":
        souls = _load_souls()
        for name in sorted(souls): print(name)
        return 0
    if args.command == "show":
        souls = _load_souls(trigger="soul.show")
        if args.name not in souls:
            print(f"Soul not found: {args.name}", file=sys.stderr); return 1
        sys.stdout.write(souls[args.name]); return 0
    parser.print_help(); return 1


__all__ = ["register", "dispatch"]
