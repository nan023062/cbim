"""`cbim audit` domain — governance drift checks (read-only).

Thin shell over engine.audit.cli.
"""

import argparse


def register(sub: argparse._SubParsersAction) -> argparse.ArgumentParser:
    audit_p = sub.add_parser("audit", help="Run governance drift checks (read-only)")
    from engine.audit.cli import register_audit_subparser
    register_audit_subparser(audit_p)
    return audit_p


def dispatch(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    from engine.audit.cli import dispatch as _audit_dispatch
    return _audit_dispatch(args)


__all__ = ["register", "dispatch"]
