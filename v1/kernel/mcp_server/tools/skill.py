"""
mcp_server/tools/skill.py — MCP tools for skill discovery + per-agent skill CRUD.

Read tools:
  skill_list()          — list all built-in skill keys
  skill_show(name)      — print the SKILL markdown body

Write tools (route through services.skill_service):
  skill_create(agent_name, skill_name, body, as_dir, cwd)
  skill_update(agent_name, skill_name, target, payload, cwd)
  skill_delete(agent_name, skill_name, cwd)
  skill_add_asset(agent_name, skill_name, asset_rel_path, content, is_executable, cwd)
  skill_remove_asset(agent_name, skill_name, asset_rel_path, cwd)

Implementation note (Batch 2): read tools route through
`services.skill_service` so engine.* and mcp_server.* never reach
into `cbi._primitives` (the banned-api Batch 2 enforces). The
underlying discovery walk still lives in `cbi.resources.Skill`,
which the service wraps.

Write tools import from `services.skill_service` directly because the
new per-agent skill CRUD methods are not re-exported at the
`services` package top level (services/__init__.py surfaces only the
read facade).
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

    @mcp.tool()
    def skill_create(
        agent_name: str,
        skill_name: str,
        body: str = "",
        as_dir: bool = False,
        cwd: str = "",
    ) -> str:
        """Create a new per-agent skill under `.claude/agents/<agent>/skills/`.

        Two storage forms:
          * `as_dir=False` (default) — file-form: `<skill>.md`. The skill
            auto-upgrades to dir-form on the first `skill_add_asset` call.
          * `as_dir=True` — dir-form: `<skill>/skill.md` (empty `assets/`
            materialises on the first `skill_add_asset`).

        Framework-owned agents (`architect`, `auditor`, `hr`, `programmer`)
        are read-only — writes raise ForbiddenAgentError.

        Args:
            agent_name: Agent id (directory name under `.claude/agents/`).
            skill_name: Skill file stem / dir name (no `.md` suffix).
            body:       Skill markdown body (may include frontmatter).
            as_dir:     If True, create dir-form directly; otherwise file-form.
            cwd:        Project directory (default: current working dir).

        Returns:
            Absolute path of the created primary markdown file, or
            `ERROR: <msg>` on failure.
        """
        from services.skill_service import create_agent_skill
        try:
            return create_agent_skill(
                agent_name, skill_name, body, as_dir=as_dir, cwd=cwd
            )
        except FileExistsError as e:
            return f"ERROR: {e}"
        except (ValueError, FileNotFoundError) as e:
            return f"ERROR: {e}"

    @mcp.tool()
    def skill_update(
        agent_name: str,
        skill_name: str,
        target: str,
        payload: dict,
        cwd: str = "",
    ) -> str:
        """Update an existing per-agent skill in place.

        Currently only ``target="body"`` is supported, with payload shape
        ``{"content": "<new body>"}`` — matches the ``agent_update``
        convention. Frontmatter is preserved verbatim across the update.
        Any other target value raises ValueError.

        Framework-owned agents (`architect`, `auditor`, `hr`, `programmer`)
        are read-only — writes raise ForbiddenAgentError.

        Args:
            agent_name: Agent id.
            skill_name: Skill name (existing).
            target:     "body" (only value currently supported).
            payload:    For target="body": {"content": str}.
            cwd:        Project directory (default: current working dir).

        Returns:
            Absolute path of the saved primary markdown file, or
            `ERROR: <msg>` on failure.
        """
        from services.skill_service import update_agent_skill
        try:
            return update_agent_skill(
                agent_name, skill_name, target, payload, cwd=cwd
            )
        except FileNotFoundError as e:
            return f"ERROR: {e}"
        except ValueError as e:
            return f"ERROR: {e}"

    @mcp.tool()
    def skill_delete(
        agent_name: str,
        skill_name: str,
        cwd: str = "",
    ) -> str:
        """Delete a per-agent skill entirely.

        File-form skills lose their `.md` file; dir-form skills lose the
        whole `<skill>/` tree including `assets/`.

        Framework-owned agents (`architect`, `auditor`, `hr`, `programmer`)
        are read-only — deletes raise ForbiddenAgentError.

        Args:
            agent_name: Agent id.
            skill_name: Skill name.
            cwd:        Project directory (default: current working dir).

        Returns:
            Absolute path of the removed file or directory, or
            `ERROR: <msg>` on failure.
        """
        from services.skill_service import delete_agent_skill
        try:
            return delete_agent_skill(agent_name, skill_name, cwd=cwd)
        except FileNotFoundError as e:
            return f"ERROR: {e}"
        except ValueError as e:
            return f"ERROR: {e}"

    @mcp.tool()
    def skill_add_asset(
        agent_name: str,
        skill_name: str,
        asset_rel_path: str,
        content: str,
        is_executable: bool = False,
        cwd: str = "",
    ) -> str:
        """Add an asset file under `<agent>/skills/<skill>/assets/<asset_rel_path>`.

        If the target skill is currently in file-form it is atomically
        promoted to dir-form as part of this write.

        Executable-asset gating:
          When `asset_rel_path` has a suffix in the known-executable set
          (`.ps1`, `.sh`, `.py`, `.js`, `.ts`, `.rb`, `.pl`, `.bat`, `.cmd`,
          `.exe`, `.dll`, `.so`, `.dylib`, `.command`, `.app`) you MUST
          pass `is_executable=True`, otherwise the call is rejected with
          ExecutableAssetRequiresFlagError. Assets acknowledged as
          executable (either by whitelisted suffix or explicit flag) get a
          sibling zero-byte marker `<asset>.executable-declared` on disk —
          this marker is what the `skill_scripts` audit check keys on — and
          an audit line is appended to the session log.

        Path safety: `asset_rel_path` must be relative and resolve inside
        `<skill>/assets/`. Absolute paths, drive-relative paths, and `..`
        traversal are rejected.

        Framework-owned agents (`architect`, `auditor`, `hr`, `programmer`)
        are read-only — writes raise ForbiddenAgentError.

        Args:
            agent_name:     Agent id.
            skill_name:     Skill name.
            asset_rel_path: Relative path under `<skill>/assets/` (may
                            contain subdirs, e.g. "scripts/run.ps1").
            content:        Asset file body (text).
            is_executable:  Required True for whitelisted-executable
                            suffixes; also enables the marker + audit
                            line for non-whitelisted suffixes.
            cwd:            Project directory (default: current working dir).

        Returns:
            Absolute path of the written asset, or `ERROR: <msg>` on failure.
        """
        from services.skill_service import add_skill_asset
        try:
            return add_skill_asset(
                agent_name,
                skill_name,
                asset_rel_path,
                content,
                is_executable=is_executable,
                cwd=cwd,
            )
        except FileNotFoundError as e:
            return f"ERROR: {e}"
        except ValueError as e:
            return f"ERROR: {e}"

    @mcp.tool()
    def skill_remove_asset(
        agent_name: str,
        skill_name: str,
        asset_rel_path: str,
        cwd: str = "",
    ) -> str:
        """Remove an asset from `<agent>/skills/<skill>/assets/`.

        Also removes the sibling `<asset>.executable-declared` marker if
        one exists. If the pre-removal state was executable-declared an
        audit line is appended to the session log.

        Path safety: `asset_rel_path` must be relative and resolve inside
        `<skill>/assets/`.

        Framework-owned agents (`architect`, `auditor`, `hr`, `programmer`)
        are read-only — deletes raise ForbiddenAgentError.

        Args:
            agent_name:     Agent id.
            skill_name:     Skill name (must be in dir-form with assets/).
            asset_rel_path: Relative path under `<skill>/assets/`.
            cwd:            Project directory (default: current working dir).

        Returns:
            Absolute path of the removed asset, or `ERROR: <msg>` on failure.
        """
        from services.skill_service import remove_skill_asset
        try:
            return remove_skill_asset(
                agent_name, skill_name, asset_rel_path, cwd=cwd
            )
        except FileNotFoundError as e:
            return f"ERROR: {e}"
        except ValueError as e:
            return f"ERROR: {e}"
