"""`cbim agent` domain — agent roster commands.

Agent handlers drive cbi.resources.Agent directly. Previously these lived
in cbi/_primitives/cli.py as cmd_agents_*; that thin wrapper layer was
deleted in P3 Wave 1 so the CLI dispatch calls the resource model with no
detour.
"""

# Why one file: same rationale as dna.py — single-resource CLI surface, internal cohesion.

import argparse
import sys

from ._shared import _read_content_arg

# Frontmatter fields that `agent update --target frontmatter` is allowed to
# touch. `name` (and the on-disk basename) is intentionally NOT editable —
# renaming an agent is a separate operation, not a frontmatter edit.
_AGENT_FM_EDITABLE: tuple[str, ...] = ("description", "model", "tools")


def register(sub: argparse._SubParsersAction) -> argparse.ArgumentParser:
    pa = sub.add_parser("agent", help="Agent roster commands")
    asub = pa.add_subparsers(dest="command")
    asub.add_parser("list")
    _p = asub.add_parser("show"); _p.add_argument("name")
    _p = asub.add_parser("scaffold"); _p.add_argument("name"); _p.add_argument("--description", default=""); _p.add_argument("--model", default="claude-sonnet-4-6")
    _p = asub.add_parser("archive"); _p.add_argument("name")
    _p = asub.add_parser(
        "update",
        help=(
            "Edit an agent's frontmatter / body / section. The agent's `name` "
            "and the on-disk basename are NOT editable here (rename is a "
            "different operation)."
        ),
    )
    _p.add_argument("name", help="Agent id (directory name under .claude/agents/)")
    _p.add_argument("--target", required=True,
                    choices=["frontmatter", "body", "section"],
                    help="What to edit")
    _p.add_argument("--field", default=None,
                    help="Frontmatter field (frontmatter only): "
                         "description | model | tools")
    _p.add_argument("--value", default=None,
                    help="Frontmatter scalar value; mutually exclusive with --value-list")
    _p.add_argument("--value-list", dest="value_list", nargs="+", default=None,
                    metavar="ITEM",
                    help="Frontmatter list value (one or more items)")
    _p.add_argument("--clear", dest="clear", action="store_true",
                    help="Clear a list-typed frontmatter field (set to []). "
                         "Only valid with --target frontmatter and a list-typed --field.")
    _p.add_argument("--content", default=None, help="Inline markdown content (body/section)")
    _p.add_argument("--content-file", dest="content_file", default=None,
                    help="Read content from this path (body/section)")
    _p.add_argument("--stdin", action="store_true", help="Read content from stdin (body/section)")
    _p.add_argument("--heading", default=None, help="Exact heading text (section only)")
    _p.add_argument("--level", type=int, default=2, choices=[2, 3],
                    help="Heading level (section only; default: 2)")
    _p.add_argument("--mode", default=None,
                    choices=["replace", "append", "insert-after", "delete"],
                    help="Section edit mode (default: replace; section only)")
    _p.add_argument("--create-if-missing", dest="create_if_missing", action="store_true",
                    help="For section replace/append: if heading absent, append at EOF")
    _pos = _p.add_mutually_exclusive_group()
    _pos.add_argument("--insert-after", dest="insert_after", default=None,
                      metavar="HEADING",
                      help="When creating a new section, insert it after the section with this heading.")
    _pos.add_argument("--insert-at-top", dest="insert_at_top", action="store_true",
                      help="When creating a new section, insert it at the top of the body "
                           "(after frontmatter, before first section).")
    _p.add_argument("--dry-run", dest="dry_run", action="store_true",
                    help="Print rendered result to stdout; do not write to disk")

    _p = asub.add_parser(
        "add-skill",
        help="Create a new skill markdown file under an agent's skills/ directory",
    )
    _p.add_argument("agent_name", help="Agent id (directory name under .claude/agents/)")
    _p.add_argument("skill_name", help="Skill file stem (no .md suffix)")
    _p.add_argument("--content", default=None, help="Inline markdown content")
    _p.add_argument("--content-file", dest="content_file", default=None,
                    help="Read content from this path")
    _p.add_argument("--stdin", action="store_true", help="Read content from stdin")
    _p.add_argument("--dry-run", dest="dry_run", action="store_true",
                    help="Print content to stdout; do not create the file")
    return pa


def dispatch(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    if not args.command:
        parser.print_help(); return 1
    # Late lookup via the engine.cli package so monkeypatch.setattr(engine.cli, ...)
    # in tests rebinds the handler the dispatcher actually invokes.
    from engine import cli as _pkg
    agent_cmds = {
        "list": _pkg._handle_agent_list,
        "show": _pkg._handle_agent_show,
        "scaffold": _pkg._handle_agent_scaffold,
        "archive": _pkg._handle_agent_archive,
        "update": _pkg._handle_agent_update,
        "add-skill": _pkg._handle_agent_add_skill,
    }
    return agent_cmds[args.command](args)


def _handle_agent_list(args: argparse.Namespace) -> int:
    from cbi.resources import Agent
    agents = Agent.list_all()
    if not agents:
        print("  No agents found.")
        return 0
    for a in agents:
        skills_list = a.skills.list()
        skills = f"  [{', '.join(skills_list)}]" if skills_list else ""
        name = a.frontmatter.get("name", a.id)
        model = a.frontmatter.get("model", "")
        desc = a.frontmatter.get("description", "")
        print(f"  {name:16s}  {model:24s}  {desc[:48]}{skills}")
    return 0


def _handle_agent_show(args: argparse.Namespace) -> int:
    from cbi.resources import Agent
    try:
        agent = Agent.load(args.name)
    except FileNotFoundError:
        print(f"Agent not found: {args.name}", file=sys.stderr)
        return 1
    name = agent.frontmatter.get("name", agent.id)
    model = agent.frontmatter.get("model", "")
    tools = agent.frontmatter.get("tools", "")
    skills_list = agent.skills.list()
    description = agent.frontmatter.get("description", "")
    print(f"Name    : {name}")
    print(f"Model   : {model}")
    print(f"Tools   : {tools}")
    print(f"Skills  : {', '.join(skills_list) or '—'}")
    print(f"\nDescription:\n  {description}")
    print(f"\n{agent.body.read()}")
    return 0


def _handle_agent_scaffold(args: argparse.Namespace) -> int:
    from services import scaffold_agent
    try:
        path = scaffold_agent(
            args.name,
            description=args.description,
            model=args.model,
        )
        print(f"Created: {path}")
    except FileExistsError as e:
        print(str(e), file=sys.stderr)
        return 1
    return 0


def _handle_agent_archive(args: argparse.Namespace) -> int:
    from services import archive_agent
    try:
        archived = archive_agent(args.name)
        print(f"Archived: {archived}")
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        return 1
    return 0


def _render_agent(agent) -> str:
    """Mirror Agent.save() rendering without touching disk (for --dry-run)."""
    fm = agent.frontmatter.render()
    body = agent.body.read()
    if body and not body.startswith("\n"):
        text = fm + "\n" + body
    else:
        text = fm + body
    if not text.endswith("\n"):
        text += "\n"
    return text


def _warn_if_kernel_managed(name: str) -> None:
    """Warn (on stderr) when the user is mutating a kernel-managed agent.

    The 4 built-in agents are overwritten by `cbim project sync`; edits will
    not survive the next sync. Warning only — does not block.
    """
    from project.sync import KERNEL_AGENT_NAMES
    if name in KERNEL_AGENT_NAMES:
        print(
            f"warning: '{name}' is a kernel-managed agent; "
            f"your edits will be overwritten on the next `cbim project sync`",
            file=sys.stderr,
        )


def _handle_agent_update(args: argparse.Namespace) -> int:
    """Edit an existing agent's frontmatter, body, or a single body section.

    Routes by --target to the appropriate sub-object on the in-memory Agent.
    Frontmatter edits use --field plus --value (scalar) or --value-list
    (multi-item). The `name` field is locked. Body / section edits use the
    shared --content / --content-file / --stdin trio. Dry-run prints the
    rendered file to stdout and never touches disk.
    """
    from cbi.resources import Agent
    from services import update_agent

    target = args.target
    dry_run = bool(getattr(args, "dry_run", False))

    try:
        payload = _build_agent_update_payload(args, target)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    if dry_run:
        try:
            agent = Agent.load(args.name)
        except FileNotFoundError as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1
        try:
            _apply_agent_update_in_memory(agent, target, payload)
        except (ValueError, LookupError, FileNotFoundError, RuntimeError) as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1
        sys.stdout.write(_render_agent(agent))
        return 0

    try:
        path = update_agent(args.name, target, payload)
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    except (ValueError, LookupError, RuntimeError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    _warn_if_kernel_managed(args.name)
    print(path)
    return 0


def _build_agent_update_payload(args: argparse.Namespace, target: str) -> dict:
    """Convert argparse Namespace into the dict shape expected by services.update_agent."""
    if target == "frontmatter":
        if args.field is None:
            raise ValueError("--field is required for --target frontmatter")
        value_given = args.value is not None
        list_given = getattr(args, "value_list", None) is not None
        clear_given = bool(getattr(args, "clear", False))
        if sum([value_given, list_given, clear_given]) > 1:
            raise ValueError("--value, --value-list, --clear are mutually exclusive")
        if not (value_given or list_given or clear_given):
            raise ValueError(
                "one of --value / --value-list / --clear is required for --target frontmatter"
            )
        payload = {"field": args.field}
        if clear_given:
            payload["value_list"] = []
        elif list_given:
            payload["value_list"] = args.value_list
        else:
            payload["value"] = args.value
        return payload

    if target == "body":
        content = _read_content_arg(args)
        if content is None:
            raise ValueError("one of --content / --content-file / --stdin is required")
        return {"content": content}

    if target == "section":
        if args.heading is None:
            raise ValueError("--heading is required for --target section")
        mode = args.mode or "replace"
        needs_content = mode != "delete"
        content = _read_content_arg(args)
        if needs_content and content is None:
            raise ValueError("one of --content / --content-file / --stdin is required")
        if not needs_content and content is not None:
            raise ValueError("content sources are forbidden with --mode delete")
        return {
            "heading": args.heading,
            "content": content,
            "mode": mode,
            "level": args.level,
            "create_if_missing": bool(args.create_if_missing),
            "insert_after": getattr(args, "insert_after", None),
            "insert_at_top": bool(getattr(args, "insert_at_top", False)),
        }

    raise ValueError(f"unknown --target: {target!r}")


def _apply_agent_update_in_memory(agent, target: str, payload: dict) -> None:
    """Dry-run helper: apply the same mutations the service would, without saving."""
    if target == "frontmatter":
        if payload["field"] not in _AGENT_FM_EDITABLE:
            raise ValueError(
                f"field {payload['field']!r} is not editable; "
                f"allowed: {', '.join(_AGENT_FM_EDITABLE)} "
                f"(rename is a separate operation, not handled here)"
            )
        new_value = payload.get("value_list", payload.get("value"))
        agent.frontmatter.set(payload["field"], new_value)
    elif target == "body":
        agent.body.write(payload["content"])
    elif target == "section":
        agent.body.write_section(
            payload["heading"], payload.get("content"),
            level=int(payload.get("level", 2)),
            mode=payload.get("mode", "replace"),
            create_if_missing=bool(payload.get("create_if_missing", False)),
            insert_after=payload.get("insert_after"),
            insert_at_top=bool(payload.get("insert_at_top", False)),
        )


def _handle_agent_add_skill(args: argparse.Namespace) -> int:
    """Create a new skill markdown file under <agent>/skills/.

    Refuses to overwrite an existing skill (exit code 2). For modifying an
    existing skill, a future `cbim agent edit-skill` is planned but not yet
    implemented.
    """
    from services import add_skill_to_agent

    try:
        content = _read_content_arg(args)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    if content is None:
        print(
            "Error: one of --content / --content-file / --stdin is required",
            file=sys.stderr,
        )
        return 1

    if args.dry_run:
        sys.stdout.write(content if content.endswith("\n") else content + "\n")
        return 0

    try:
        path = add_skill_to_agent(args.agent_name, args.skill_name, content)
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    except FileExistsError as e:
        print(
            f"Error: {e} "
            f"(modifying an existing skill is not yet supported; "
            f"edit the file directly via the kernel in a future release)",
            file=sys.stderr,
        )
        return 2

    _warn_if_kernel_managed(args.agent_name)
    print(path)
    return 0


__all__ = ["register", "dispatch"]
