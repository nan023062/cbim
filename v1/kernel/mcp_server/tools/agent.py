"""
mcp_server/tools/agent.py — MCP tools for the agent registry.

Read tools:
  agent_list(cwd)        — list installed agents in .claude/agents/
  agent_show(name, cwd)  — full agent .md (description + body)

Write tools (route through services.agent_service):
  agent_scaffold(name, description, model, cwd)
  agent_update(name, target, payload, mode, cwd)
  agent_add_skill(agent_name, skill_name, cwd)
  agent_archive(name, cwd)
"""

from __future__ import annotations


def register(mcp) -> None:
    @mcp.tool()
    def agent_list(cwd: str = "") -> str:
        """List registered Claude Code agents under `.claude/agents/`.

        Args:
            cwd: Project directory (default: current working dir).
        """
        from services import list_agents as _list_agents
        agents = _list_agents(cwd=cwd or None, include_builtin=True)
        if not agents:
            return "(no agents found)"
        return "\n".join(
            f"{a['name']:16s}  {a['model']:24s}  {a['description'][:60]}"
            for a in agents
        )

    @mcp.tool()
    def agent_show(name: str, cwd: str = "") -> str:
        """Show full content of agent `name` (the agent .md file body + frontmatter).

        Args:
            name: Agent directory name (e.g. 'architect', 'hr').
            cwd: Project directory (default: current working dir).
        """
        from services import get_agent
        # services.get_agent already enforces the path-traversal guard
        # (returns None for invalid names) and walks via the lenient
        # root resolver, so we don't need to call project_root here.
        info = get_agent(name, cwd=cwd)
        if info is None:
            return f"ERROR: agent not found: {name}"
        skill_ids = [s["id"] for s in info["skills"]]
        return (
            f"Name    : {info['name']}\n"
            f"Model   : {info['model']}\n"
            f"Tools   : {info['tools']}\n"
            f"Skills  : {', '.join(skill_ids) or '—'}\n\n"
            f"Description:\n  {info['description']}\n\n"
            f"{info['body']}"
        )

    @mcp.tool()
    def agent_scaffold(
        name: str,
        description: str = "",
        model: str = "claude-sonnet-4-6",
        cwd: str = "",
    ) -> str:
        """Create a new agent under `.claude/agents/<name>/`.

        Refuses to overwrite an existing agent.

        Args:
            name:        Agent id (directory name).
            description: Agent description (frontmatter).
            model:       Claude model id (default 'claude-sonnet-4-6').
            cwd:         Project directory (default: current working dir).

        Returns:
            Path of the created agent .md file, or `ERROR: ...` on failure.
        """
        from services import scaffold_agent
        try:
            return scaffold_agent(name, description=description, model=model, cwd=cwd)
        except FileExistsError as e:
            return f"ERROR: {e}"
        except (ValueError, FileNotFoundError) as e:
            return f"ERROR: {e}"

    @mcp.tool()
    def agent_update(
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
                     section     -> {"heading": str, "content": str | null,
                                     "level": 2|3, "mode": str,
                                     "create_if_missing": bool}
            mode:    Default section mode when payload omits its own "mode".
            cwd:     Project directory (default: current working dir).

        Returns:
            Path of the saved agent .md file, or `ERROR: ...` on failure.
        """
        from services import update_agent
        try:
            return update_agent(name, target, payload, mode=mode, cwd=cwd)
        except FileNotFoundError as e:
            return f"ERROR: {e}"
        except (ValueError, LookupError, RuntimeError) as e:
            return f"ERROR: {e}"

    @mcp.tool()
    def agent_add_skill(
        agent_name: str,
        skill_name: str,
        content: str = "",
        cwd: str = "",
    ) -> str:
        """Create a new skill markdown file under `<agent>/skills/<skill_name>.md`.

        Args:
            agent_name: Agent id.
            skill_name: Skill file stem (no `.md` suffix).
            content:    Skill markdown body.
            cwd:        Project directory (default: current working dir).

        Returns:
            Path of the created skill file, or `ERROR: ...` on failure.
        """
        from services import add_skill_to_agent
        try:
            return add_skill_to_agent(agent_name, skill_name, content=content, cwd=cwd)
        except FileNotFoundError as e:
            return f"ERROR: {e}"
        except FileExistsError as e:
            return f"ERROR: {e}"

    @mcp.tool()
    def agent_archive(name: str, cwd: str = "") -> str:
        """Archive an agent (move `.claude/agents/<name>/` to its archived twin).

        Args:
            name: Agent id.
            cwd:  Project directory (default: current working dir).

        Returns:
            Path of the archived directory, or `ERROR: ...` on failure.
        """
        from services import archive_agent
        try:
            return archive_agent(name, cwd=cwd)
        except FileNotFoundError as e:
            return f"ERROR: {e}"
