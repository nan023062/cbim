"""`cbim skill` domain — list / show built-in agent skills."""

import argparse
import sys


def register(sub: argparse._SubParsersAction) -> argparse.ArgumentParser:
    pk = sub.add_parser("skill", help="List or show skill content")
    ksub = pk.add_subparsers(dest="command")
    ksub.add_parser("list")
    _p = ksub.add_parser("show"); _p.add_argument("name")
    return pk


def dispatch(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    # Late lookup so tests monkey-patching engine.cli._cmd_skill see the patch.
    from engine import cli as _pkg
    return _pkg._cmd_skill(args, parser)


def _cmd_skill(args, parser):
    from cbi.resources import Skill

    if not args.command:
        parser.print_help(); return 1
    if args.command == "list":
        for name in Skill.list_builtin():
            print(name)
        return 0
    if args.command == "show":
        try:
            skill = Skill.load_builtin(args.name, trigger="skill.show")
        except FileNotFoundError:
            print(f"Skill not found: {args.name}", file=sys.stderr)
            return 1
        print(skill.body.read())
        return 0
    parser.print_help()
    return 1


__all__ = ["register", "dispatch"]
