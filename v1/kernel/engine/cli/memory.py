"""`cbim memory` domain — register sub-parser, dispatch to memory.cli."""

import argparse


def register(sub: argparse._SubParsersAction) -> argparse.ArgumentParser:
    from memory._config import load_config

    cfg = load_config()
    pm = sub.add_parser("memory", help="Memory engine commands")
    msub = pm.add_subparsers(dest="command")
    _p = msub.add_parser("create"); _p.add_argument("--slug", required=True); _p.add_argument("--content", required=True); _p.add_argument("--tier", default="short", choices=["short", "medium"]); _p.add_argument("--store-dir", dest="store_dir", default=None)
    _p = msub.add_parser("add"); _p.add_argument("path"); _p.add_argument("--tier", default="short", choices=["short", "medium"]); _p.add_argument("--store-dir", dest="store_dir", default=None)
    _p = msub.add_parser("query"); _p.add_argument("text"); _p.add_argument("--tier", choices=["short", "medium"], default=None); _p.add_argument("--top-k", type=int, default=cfg["query"]["default_top_k"], dest="top_k"); _p.add_argument("--verbose", action="store_true"); _p.add_argument("--store-dir", dest="store_dir", default=None)
    _p = msub.add_parser("delete"); _p.add_argument("path"); _p.add_argument("--store-dir", dest="store_dir", default=None)
    _p = msub.add_parser("reindex"); _p.add_argument("--tier", choices=["short", "medium"], default=None); _p.add_argument("--store-dir", dest="store_dir", default=None)
    _p = msub.add_parser("cleanup"); _p.add_argument("--keep-days", type=int, default=cfg["short_term"]["keep_days"], dest="keep_days"); _p.add_argument("--store-dir", dest="store_dir", default=None)
    return pm


def dispatch(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    from memory import cli as mcli

    if not args.command:
        parser.print_help(); return 1
    mem_cmds = {
        "create": mcli.cmd_create, "add": mcli.cmd_add, "query": mcli.cmd_query,
        "delete": mcli.cmd_delete, "reindex": mcli.cmd_reindex,
        "cleanup": mcli.cmd_cleanup,
    }
    return mem_cmds[args.command](args)


__all__ = ["register", "dispatch"]
