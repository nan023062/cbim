"""`cbim config` domain — read/write .cbim/config.json."""

import argparse


def register(sub: argparse._SubParsersAction) -> argparse.ArgumentParser:
    pc = sub.add_parser("config", help="Read/write .cbim/config.json")
    csub = pc.add_subparsers(dest="command")
    _p = csub.add_parser("get"); _p.add_argument("key")
    _p = csub.add_parser("set"); _p.add_argument("key"); _p.add_argument("value")
    csub.add_parser("show")
    return pc


def dispatch(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    from engine.config import cmd_config_get as _cmd_config_get
    from engine.config import cmd_config_set as _cmd_config_set
    from engine.config import cmd_config_show as _cmd_config_show

    if not args.command:
        parser.print_help(); return 1
    return {"get": _cmd_config_get, "set": _cmd_config_set, "show": _cmd_config_show}[args.command](args)


__all__ = ["register", "dispatch"]
