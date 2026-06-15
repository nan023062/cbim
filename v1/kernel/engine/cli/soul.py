"""`cbim soul` domain — list / show built-in agent soul content."""

import argparse
import importlib
import pkgutil
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
    from cbi import agents as souls_pkg
    souls: dict[str, str] = {}
    for info in pkgutil.iter_modules(souls_pkg.__path__):
        module_path = f"{souls_pkg.__name__}.{info.name}.agent"
        try:
            mod = importlib.import_module(module_path)
            if trigger is not None:
                log_import(module_path, "ok", trigger)
        except ModuleNotFoundError:
            if trigger is not None:
                log_import(module_path, "miss", trigger)
            continue
        for attr in dir(mod):
            if attr.endswith("_MD"):
                souls[info.name] = getattr(mod, attr)
                break

    coord_template = "CLAUDE.md.tmpl"
    try:
        from project.sync import read_template
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
        print(souls[args.name]); return 0
    parser.print_help(); return 1


__all__ = ["register", "dispatch"]
