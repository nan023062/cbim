"""
services/skill_service.py — read-only façade for built-in skills.

The discovery walk lives in `cbi.resources.Skill` (single source of
truth for crawling `cbi/agents/*/skills/*` + `cbi/skills/*`). This
service wraps it so engine.* and mcp_server.* never have to import
from cbi.resources directly — Batch 2 banned-api keeps that boundary
clean.
"""

from __future__ import annotations


def list_skills() -> list[str]:
    """Return all built-in skill keys (agent-scoped + coordinator)."""
    from cbi.resources import Skill
    return Skill.list_builtin()


def get_skill(name: str) -> dict | None:
    """Load one built-in skill by key, or return None when absent.

    Returns a dict with two keys:
      - ``name``: the requested key (round-trip).
      - ``body``: the skill markdown body.

    Built-in skills are read-only and shipped as Python string
    constants, so the dict carries no path / mtime / frontmatter. Use
    `Skill.load_builtin` directly if you need the rich Resource object.
    """
    from cbi.resources import Skill
    try:
        skill = Skill.load_builtin(name)
    except FileNotFoundError:
        return None
    return {
        "name": name,
        "body": skill.body.read(),
    }
