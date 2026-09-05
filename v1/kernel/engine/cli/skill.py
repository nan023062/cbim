"""`cbim skill` domain — list / show built-in skills + per-agent skill CRUD.

Read commands (`list` / `show`) surface built-in kernel-vendored skills
(the ones ``Skill.load_builtin`` exposes). Write commands
(``create`` / ``update`` / ``delete`` / ``add-asset`` / ``remove-asset``)
target user-owned per-agent skills under ``.claude/agents/<agent>/skills/``
and share the exact service-layer functions the MCP tool layer calls —
this is the "CLI + MCP fan into one services layer" invariant from the
project CLAUDE.md.
"""

import argparse
import sys

from ._shared import _read_content_arg


def register(sub: argparse._SubParsersAction) -> argparse.ArgumentParser:
    pk = sub.add_parser("skill", help="List / show built-in skills; CRUD per-agent skills")
    ksub = pk.add_subparsers(dest="command")

    # --- read commands (built-in skills) ----------------------------------
    ksub.add_parser("list", help="List all built-in skill keys")
    _p = ksub.add_parser("show", help="Print the SKILL markdown body")
    _p.add_argument("name")

    # --- write commands (per-agent skills) --------------------------------
    _p = ksub.add_parser(
        "create",
        help="Create a new skill under an agent's skills/ directory",
    )
    _p.add_argument("agent_name", help="Agent id (directory name under .claude/agents/)")
    _p.add_argument("skill_name", help="Skill file stem / dir name (no .md suffix)")
    _p.add_argument("--content", default=None, help="Inline markdown body")
    _p.add_argument("--content-file", dest="content_file", default=None,
                    help="Read body markdown from this path")
    _p.add_argument("--stdin", action="store_true", help="Read body markdown from stdin")
    _p.add_argument("--as-dir", dest="as_dir", action="store_true",
                    help="Create dir-form skill directly (`<skill>/skill.md`) "
                         "instead of file-form (`<skill>.md`)")

    _p = ksub.add_parser(
        "update",
        help="Replace an existing skill's body (frontmatter preserved)",
    )
    _p.add_argument("agent_name")
    _p.add_argument("skill_name")
    _p.add_argument("--target", default="body", choices=["body"],
                    help="What to update (only 'body' is currently supported)")
    _p.add_argument("--content", default=None, help="Inline markdown body")
    _p.add_argument("--content-file", dest="content_file", default=None,
                    help="Read body markdown from this path")
    _p.add_argument("--stdin", action="store_true", help="Read body markdown from stdin")

    _p = ksub.add_parser("delete", help="Delete a skill (file-form file or dir-form tree)")
    _p.add_argument("agent_name")
    _p.add_argument("skill_name")

    _p = ksub.add_parser(
        "add-asset",
        help="Add an asset file under `<skill>/assets/<rel_path>`",
    )
    _p.add_argument("agent_name")
    _p.add_argument("skill_name")
    _p.add_argument("asset_rel_path",
                    help="Path under `<skill>/assets/` (may contain subdirs, "
                         "e.g. 'scripts/run.ps1')")
    _p.add_argument("--content", default=None, help="Inline asset content")
    _p.add_argument("--content-file", dest="content_file", default=None,
                    help="Read asset content from this path")
    _p.add_argument("--stdin", action="store_true", help="Read asset content from stdin")
    _p.add_argument("--is-executable", dest="is_executable", action="store_true",
                    help="Acknowledge the asset is executable. Required for "
                         "whitelisted executable suffixes "
                         "(.ps1/.sh/.py/.js/.ts/.rb/.pl/.bat/.cmd/.exe/.dll/"
                         ".so/.dylib/.command/.app). Enabling the flag drops "
                         "a sibling `.executable-declared` marker and appends "
                         "an audit line to the session log.")

    _p = ksub.add_parser(
        "remove-asset",
        help="Remove an asset file (and its executable marker, if any) "
             "from `<skill>/assets/`",
    )
    _p.add_argument("agent_name")
    _p.add_argument("skill_name")
    _p.add_argument("asset_rel_path")

    return pk


def dispatch(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    if not args.command:
        parser.print_help(); return 1
    # Late lookup via the engine.cli package so tests monkey-patching
    # engine.cli._handle_skill_* see the patched handler.
    from engine import cli as _pkg
    if args.command in ("list", "show"):
        return _pkg._cmd_skill(args, parser)
    write_cmds = {
        "create": _pkg._handle_skill_create,
        "update": _pkg._handle_skill_update,
        "delete": _pkg._handle_skill_delete,
        "add-asset": _pkg._handle_skill_add_asset,
        "remove-asset": _pkg._handle_skill_remove_asset,
    }
    handler = write_cmds.get(args.command)
    if handler is None:
        parser.print_help(); return 1
    return handler(args)


# ---------------------------------------------------------------------------
# Read handlers (unchanged — legacy `_cmd_skill` retained for test parity)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Write handlers — thin wrappers around services.skill_service.
# The same service functions back the native CLI surface;
# both entry points share one enforcement layer (identifier validation,
# forbidden-agent list, path-traversal guard, executable-asset gating).
# ---------------------------------------------------------------------------

def _read_body_or_err(args: argparse.Namespace) -> tuple[str | None, int]:
    """Resolve --content / --content-file / --stdin.

    Returns (content, exit_code). On success exit_code is 0; on failure
    exit_code is 1 and content is None. Callers should propagate the
    non-zero exit code as their own return value.
    """
    try:
        content = _read_content_arg(args)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return None, 1
    if content is None:
        print(
            "Error: one of --content / --content-file / --stdin is required",
            file=sys.stderr,
        )
        return None, 1
    return content, 0


def _handle_skill_create(args: argparse.Namespace) -> int:
    from services.skill_service import create_agent_skill

    content, rc = _read_body_or_err(args)
    if rc != 0:
        return rc
    try:
        path = create_agent_skill(
            args.agent_name,
            args.skill_name,
            content,
            as_dir=bool(getattr(args, "as_dir", False)),
        )
    except FileExistsError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    print(path)
    return 0


def _handle_skill_update(args: argparse.Namespace) -> int:
    from services.skill_service import update_agent_skill

    content, rc = _read_body_or_err(args)
    if rc != 0:
        return rc
    try:
        path = update_agent_skill(
            args.agent_name,
            args.skill_name,
            args.target,
            {"content": content},
        )
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    print(path)
    return 0


def _handle_skill_delete(args: argparse.Namespace) -> int:
    from services.skill_service import delete_agent_skill

    try:
        removed = delete_agent_skill(args.agent_name, args.skill_name)
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    print(removed)
    return 0


def _handle_skill_add_asset(args: argparse.Namespace) -> int:
    from services.skill_service import (
        ExecutableAssetRequiresFlagError,
        add_skill_asset,
    )

    content, rc = _read_body_or_err(args)
    if rc != 0:
        return rc
    try:
        path = add_skill_asset(
            args.agent_name,
            args.skill_name,
            args.asset_rel_path,
            content,
            is_executable=bool(getattr(args, "is_executable", False)),
        )
    except ExecutableAssetRequiresFlagError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    print(path)
    return 0


def _handle_skill_remove_asset(args: argparse.Namespace) -> int:
    from services.skill_service import remove_skill_asset

    try:
        removed = remove_skill_asset(
            args.agent_name,
            args.skill_name,
            args.asset_rel_path,
        )
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    print(removed)
    return 0


__all__ = [
    "register",
    "dispatch",
    "_cmd_skill",
    "_handle_skill_create",
    "_handle_skill_update",
    "_handle_skill_delete",
    "_handle_skill_add_asset",
    "_handle_skill_remove_asset",
]
