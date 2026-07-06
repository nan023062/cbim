"""
services/agent_service.py — agent roster + transactional write facade.

Read side (`list_agents`) wraps `cbi._primitives.agents` with a stable,
dashboard/MCP-facing surface and filters out built-in framework agents.

Write side exposes transactional facades (`scaffold_agent`, `update_agent`,
`add_skill_to_agent`, `archive_agent`) that both the engine CLI handlers
(`engine/cli.py`) and the MCP tools (`mcp_server/tools/agent.py`) call.

Phase 1 design note: previously this layer was read-only. The "No service
writes" rule was reversed so CLI and MCP can share one transactional
implementation instead of duplicating the orchestration of frontmatter +
body + skill-dir edits.
"""

from __future__ import annotations

from pathlib import Path

from context import resolve_root_or_cwd as _resolve_root

from . import _reindex
from ._fm import parse_frontmatter, strip_frontmatter

_BUILTIN_AGENTS = frozenset({"architect", "hr", "auditor", "programmer"})

_AGENT_FM_EDITABLE: tuple[str, ...] = ("description", "model", "tools")
# Frontmatter fields that may be *removed* entirely (as opposed to set to a
# new value). Only `tools` is deletable — omitting it means "inherit the
# default toolset from Claude Code"; `description` and `model` must remain
# present to keep the agent addressable.
_AGENT_FM_DELETABLE: tuple[str, ...] = ("tools",)


def list_agents(cwd=None, include_builtin: bool = False) -> list[dict]:
    """Return all agent definitions found under `.claude/agents/`.

    Args:
        cwd:             Project search base; walks up to find `.cbim/`.
        include_builtin: When True, framework agents are included
                         (default False — dashboard caller decides).

    Returns:
        List of dicts shaped like::

            {
              "id":          <directory name>,
              "name":        <frontmatter name or id>,
              "description": <frontmatter description>,
              "model":       <frontmatter model>,
              "tools":       <frontmatter tools string>,
              "skills":      [ {"id": <stem>, "body": <md body>}, ... ],
              "body":        <agent .md body with frontmatter stripped>,
            }
    """
    root = _resolve_root(cwd)
    agents_dir = root / ".claude" / "agents"
    if not agents_dir.exists():
        return []

    agents: list[dict] = []
    for agent_dir in sorted(agents_dir.iterdir()):
        if not agent_dir.is_dir():
            continue
        if not include_builtin and agent_dir.name in _BUILTIN_AGENTS:
            continue
        md = agent_dir / f"{agent_dir.name}.md"
        if not md.exists():
            continue
        try:
            raw = md.read_text(encoding="utf-8")
        except (FileNotFoundError, PermissionError):
            continue
        meta = parse_frontmatter(raw)
        agents.append({
            "id": agent_dir.name,
            "name": meta.get("name", agent_dir.name),
            "description": meta.get("description", ""),
            "model": meta.get("model", ""),
            "tools": meta.get("tools", ""),
            "skills": _load_skills(agent_dir),
            "body": strip_frontmatter(raw),
        })
    return agents


def _load_skills(agent_dir: Path) -> list[dict]:
    skills_dir = agent_dir / "skills"
    if not skills_dir.exists():
        return []
    out = []
    for skill_file in sorted(skills_dir.glob("*.md")):
        try:
            raw = skill_file.read_text(encoding="utf-8")
        except (FileNotFoundError, PermissionError):
            raw = ""
        out.append({"id": skill_file.stem, "body": strip_frontmatter(raw)})
    return out


# ---------------------------------------------------------------------------
# Read façade — single-agent lookup.
# ---------------------------------------------------------------------------


def get_agent(name: str, cwd: str = "") -> dict | None:
    """Return one agent's flattened representation, or None when absent.

    Same dict shape as a single element of `list_agents` plus an
    additional ``agent_md_path`` key carrying the absolute Path of the
    backing `.md` file. Filters out path-traversal in the same way as
    the write facade.
    """
    if not name or "/" in name or "\\" in name or name in (".", ".."):
        return None
    root = _resolve_root(cwd)
    agent_dir = root / ".claude" / "agents" / name
    md = agent_dir / f"{name}.md"
    if not md.is_file():
        return None
    try:
        raw = md.read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError):
        return None
    meta = parse_frontmatter(raw)
    return {
        "id": name,
        "name": meta.get("name", name),
        "description": meta.get("description", ""),
        "model": meta.get("model", ""),
        "tools": meta.get("tools", ""),
        "skills": _load_skills(agent_dir),
        "body": strip_frontmatter(raw),
        "agent_md_path": md.resolve(),
    }


# ---------------------------------------------------------------------------
# Write facade — shared by engine/cli.py and mcp_server/tools/agent.py
# ---------------------------------------------------------------------------


def _validate_identifier(value: str, *, kind: str) -> None:
    """Reject path-traversal attempts in agent / skill names.

    Names flow from external callers (CLI / MCP / dashboard) and are
    joined into ``.claude/agents/<name>/...`` paths. We disallow path
    separators and dot-segments so the identifier can never escape its
    parent directory.
    """
    if not value or "/" in value or "\\" in value or value in (".", ".."):
        raise ValueError(f"invalid {kind} name: {value!r}")


def scaffold_agent(
    name: str,
    description: str = "",
    model: str = "claude-sonnet-4-6",
    cwd: str = "",
) -> str:
    """Create a new agent under `.claude/agents/<name>/`.

    Raises `FileExistsError` if the agent already exists (no silent overwrite).
    Returns the absolute path to the created agent.md as a string.
    """
    from cbi.resources import Agent
    _validate_identifier(name, kind="agent")
    root = _resolve_root(cwd)
    agent = Agent.create(name, description=description, model=model, root=root)
    _reindex.reindex_agent(root, name)
    return str(agent.path)


def update_agent(
    name: str,
    target: str,
    payload: dict,
    mode: str = "replace",
    cwd: str = "",
) -> str:
    """Edit an existing agent's frontmatter / body / section.

    Args:
        name:    Agent id (directory name under `.claude/agents/`).
        target:  "frontmatter" | "body" | "section".
        payload: Per-target dict.
                 frontmatter -> {"field": str, "value": scalar} OR
                                {"field": str, "value_list": list[str]}
                 body        -> {"content": str}
                 section     -> {"heading": str, "content": str | None,
                                 "level": 2|3, "mode": "replace"|"append"|
                                          "insert-after"|"delete",
                                 "create_if_missing": bool}
        mode:    Reserved for forward-compatibility; payload-level "mode"
                 takes precedence for section edits. Kept for API symmetry
                 with the original task spec.
        cwd:     Project search base.

    Returns the absolute path to the saved agent.md as a string. Raises
    ValueError / LookupError on bad input, FileNotFoundError when the agent
    is missing.
    """
    from cbi.resources import Agent
    _validate_identifier(name, kind="agent")
    root = _resolve_root(cwd)
    agent = Agent.load(name, root=root)

    if target == "frontmatter":
        field = payload.get("field")
        if field is None:
            raise ValueError("payload.field is required for target=frontmatter")
        has_scalar = "value" in payload and payload["value"] is not None
        has_list = "value_list" in payload and payload["value_list"] is not None
        has_delete = bool(payload.get("delete"))
        given = sum([has_scalar, has_list, has_delete])
        if given > 1:
            raise ValueError(
                "payload.value, payload.value_list, and payload.delete are "
                "mutually exclusive"
            )
        if given == 0:
            raise ValueError(
                "one of payload.value, payload.value_list, or payload.delete is required"
            )
        if has_delete:
            if field not in _AGENT_FM_DELETABLE:
                raise ValueError(
                    f"field {field!r} cannot be deleted; "
                    f"deletable fields: {', '.join(_AGENT_FM_DELETABLE)} "
                    f"(description/model are required for the agent to be addressable)"
                )
            if not agent.frontmatter.has(field):
                raise LookupError(
                    f"field {field!r} is not present in agent frontmatter"
                )
            agent.frontmatter.delete(field)
        else:
            if field not in _AGENT_FM_EDITABLE:
                raise ValueError(
                    f"field {field!r} is not editable; "
                    f"allowed: {', '.join(_AGENT_FM_EDITABLE)} "
                    f"(rename is a separate operation, not handled here)"
                )
            new_value = payload["value_list"] if has_list else payload["value"]
            agent.frontmatter.set(field, new_value)

    elif target == "body":
        content = payload.get("content")
        if content is None:
            raise ValueError("payload.content is required for target=body")
        agent.body.write(content)

    elif target == "section":
        heading = payload.get("heading")
        if heading is None:
            raise ValueError("payload.heading is required for target=section")
        sec_mode = payload.get("mode") or mode or "replace"
        needs_content = sec_mode != "delete"
        content = payload.get("content")
        if needs_content and content is None:
            raise ValueError("payload.content is required unless mode=delete")
        if not needs_content and content is not None:
            raise ValueError("payload.content forbidden with mode=delete")
        insert_after = payload.get("insert_after")
        insert_at_top = bool(payload.get("insert_at_top", False))
        if insert_after is not None and insert_at_top:
            raise ValueError(
                "payload.insert_after and payload.insert_at_top are mutually exclusive"
            )
        agent.body.write_section(
            heading,
            content,
            level=int(payload.get("level", 2)),
            mode=sec_mode,
            create_if_missing=bool(payload.get("create_if_missing", False)),
            insert_after=insert_after,
            insert_at_top=insert_at_top,
        )
    else:
        raise ValueError(f"unknown target: {target!r}")

    agent.save()
    _reindex.reindex_agent(root, name)
    return str(agent.path.resolve())


def add_skill_to_agent(agent_name: str, skill_name: str, content: str = "", cwd: str = "") -> str:
    """Create a new skill markdown file under `<agent>/skills/<skill_name>.md`.

    Raises `FileNotFoundError` if the agent does not exist, or `FileExistsError`
    if the skill already exists. Returns the absolute path to the new skill file.
    """
    from cbi.resources import Agent
    _validate_identifier(agent_name, kind="agent")
    _validate_identifier(skill_name, kind="skill")
    root = _resolve_root(cwd)
    agent = Agent.load(agent_name, root=root)
    if skill_name in agent.skills:
        raise FileExistsError(f"skill already exists: {skill_name}")
    skill = agent.skills.add(skill_name, content)
    return str(skill.path.resolve())


def archive_agent(name: str, cwd: str = "") -> str:
    """Move `.claude/agents/<name>/` to its archived twin and return the new path."""
    from cbi.resources import Agent
    _validate_identifier(name, kind="agent")
    root = _resolve_root(cwd)
    agent = Agent.load(name, root=root)
    archived = agent.archive()
    _reindex.drop_agent(name)
    return str(archived)
