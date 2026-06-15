"""`cbim dashboard` domain — local CBIM dashboard UI server.

Includes the deprecated `preview` alias as a separate domain that prints a
deprecation warning and forwards to dispatch().
"""

import argparse
import os
import sys


def register(sub: argparse._SubParsersAction) -> argparse.ArgumentParser:
    pdash = sub.add_parser("dashboard", help="Start the local CBIM dashboard UI server")
    pdash.add_argument("--port", type=int, default=None,
                       help="TCP port (default: dashboard.port in .cbim/config.json, or 8765)")
    pdash.add_argument("--no-browser", dest="no_browser", action="store_true",
                       help="Do not auto-open a browser window (set automatically when CI env var is present)")
    return pdash


def register_preview(sub: argparse._SubParsersAction) -> argparse.ArgumentParser:
    pp = sub.add_parser("preview", help="[deprecated] use `dashboard` instead")
    pp.add_argument("--port", type=int, default=None)
    pp.add_argument("--no-browser", dest="no_browser", action="store_true")
    return pp


def dispatch(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    # Late lookup so tests monkey-patching engine.cli.cmd_dashboard see the patch.
    from engine import cli as _pkg
    return _pkg.cmd_dashboard(args)


def dispatch_preview(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    print("[DEPRECATED] 'preview' subcommand is deprecated and will be removed "
          "in the next minor release (1.1.0); use 'dashboard' instead.",
          file=sys.stderr)
    from engine import cli as _pkg
    return _pkg.cmd_dashboard(args)


def cmd_dashboard(args) -> int:
    """Top-level `dashboard` command. Launches the HTTP UI server.

    Honours $CI to force --no-browser (server still starts; we just
    don't try to spawn a browser on a headless box).
    """
    from context import cbim_dir as _cbim_dir
    from context import kernel_root, project_root
    from dashboard.server import load_port, start_server

    cbim_dir = _cbim_dir()
    dashboard_dir = kernel_root() / "dashboard"
    root_dir = project_root()

    open_browser = not args.no_browser and not os.environ.get("CI")
    port = args.port if args.port is not None else load_port(cbim_dir)
    start_server(dashboard_dir, cbim_dir, root_dir,
                 port=port, open_browser=open_browser)
    return 0


__all__ = [
    "register",
    "register_preview",
    "dispatch",
    "dispatch_preview",
    "cmd_dashboard",
]
