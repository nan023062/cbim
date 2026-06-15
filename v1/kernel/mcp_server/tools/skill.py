"""
mcp_server/tools/skill.py — MCP tools for skill discovery.

Exposes:
  skill_list()          — list all skill keys
  skill_show(name)      — print the SKILL markdown body

Implementation note (Batch 2): both tools route through
`services.skill_service` so engine.* and mcp_server.* never reach
into `cbi._primitives` (the banned-api Batch 2 enforces). The
underlying discovery walk still lives in `cbi.resources.Skill`,
which the service wraps.
"""

from __future__ import annotations

from services import get_skill, list_skills


def register(mcp) -> None:
    @mcp.tool()
    def skill_list() -> str:
        """List all CBIM skill keys (agent-scoped + global)."""
        keys = list_skills()
        if not keys:
            return "(no skills found)"
        return "\n".join(keys)

    @mcp.tool()
    def skill_show(name: str) -> str:
        """Print the SKILL markdown content for the given key.

        Keys look like 'architect.arch_modules' (agent-scoped) or
        'memory_write' (global).
        """
        info = get_skill(name)
        if info is None:
            available = ", ".join(list_skills())
            return f"ERROR: skill not found: {name}\n\nAvailable: {available}"
        return info["body"]
