"""
services/skill_service.py — read facade + per-agent skill CRUD.

Read side (`list_skills` / `get_skill`) wraps `cbi.resources.Skill` and
surfaces the built-in framework skills (agent-scoped + coordinator).

Write side (`create_agent_skill`, `update_agent_skill`,
`delete_agent_skill`, `add_skill_asset`, `remove_skill_asset`) targets
user-defined skills under `.claude/agents/<agent>/skills/`. It layers
policy guards — identifier validation, framework-agent forbid list,
path-traversal check, executable-asset gating + audit log — on top of
the policy-free primitives in `cbi._primitives.skills`. The primitive
layer deliberately does not judge is-executable / path-safety; those
belong here so that CLI and MCP callers share one enforcement point.

Boundaries:
  * Read side only surfaces built-in skills. Per-agent skill reads are
    exposed via the Agent resource / `agent_show` MCP tool, not this
    module.
  * This service never converts exceptions to "ERROR:" strings — raw
    exceptions propagate. Wire-format conversion is the mcp_server tool
    layer's job.
"""

from __future__ import annotations

from pathlib import Path

from context import resolve_root_or_cwd as _resolve_root

from . import _paths, _reindex
from ._identifiers import validate_identifier as _validate_identifier

# Framework-owned agents whose skills.md files are shipped built-in and
# not user-editable. Writes against these raise `ForbiddenAgentError`.
_FORBIDDEN_AGENTS = frozenset({"architect", "auditor", "hr", "programmer"})

# Suffixes we recognise as "obviously executable" content. Writing one
# without the `is_executable=True` opt-in raises
# `ExecutableAssetRequiresFlagError`. The list is deliberately broad
# (POSIX shells + Windows scripts + native binaries + a couple of app
# bundle wrappers). It is a safety net, not a security boundary — the
# `is_executable=True` escape hatch still works for non-whitelisted
# suffixes so callers can declare exotic formats we forgot.
_EXECUTABLE_ASSET_SUFFIXES = frozenset({
    ".ps1", ".sh", ".py", ".js", ".ts", ".rb", ".pl",
    ".bat", ".cmd", ".exe", ".dll", ".so", ".dylib",
    ".command", ".app",
})

_EXECUTABLE_MARKER_SUFFIX = ".executable-declared"


class ForbiddenAgentError(ValueError):
    """Raised when a write targets a framework-owned agent's skills."""


class ExecutableAssetRequiresFlagError(ValueError):
    """Raised when a whitelisted-executable-suffix asset is added without `is_executable=True`."""


# ---------------------------------------------------------------------------
# Read facade — built-in framework skills.
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Write facade — per-agent skills under `.claude/agents/<agent>/skills/`
# ---------------------------------------------------------------------------

def _agents_dir(root: Path) -> Path:
    return root / ".claude" / "agents"


def _guard_write(agent_name: str, skill_name: str) -> None:
    """Steps 1-2 of the write-guard sequence: identifier + forbidden-agent."""
    _validate_identifier(agent_name, kind="agent")
    _validate_identifier(skill_name, kind="skill")
    if agent_name in _FORBIDDEN_AGENTS:
        raise ForbiddenAgentError(
            f"framework-owned agent {agent_name!r} — skill writes not permitted"
        )


def _resolve_asset_target(
    root: Path, agent_name: str, skill_name: str, asset_rel_path: str
) -> Path:
    """Compute the absolute asset target and prove it stays under `<skill>/assets/`.

    Uses `_paths.resolve_within_root` (project root as anchor) to reject
    absolute paths and `..` traversal, then double-checks the resolved
    path lives under the notional `<agent>/skills/<skill>/assets/`
    directory. The notional directory may not exist yet — a file-form
    skill materialises it on the first `add_skill_asset` — so we compare
    resolved absolute paths rather than requiring existence.
    """
    if not asset_rel_path:
        raise ValueError("asset_rel_path must not be empty")
    # Pre-reject absolute-looking paths BEFORE we splice `asset_rel_path`
    # into a longer prefixed rel string. Once spliced, a leading `/` or
    # `\` becomes a mid-string `//` which pathlib normalises away —
    # losing the "this path was absolute" signal that `resolve_within_root`
    # relies on for its commonpath check. Drive-letter variants
    # (`C:\foo`, `C:foo`) get the same explicit handling for the same
    # reason (and drive-relative `C:foo` is always unsafe regardless).
    if asset_rel_path.startswith(("/", "\\")):
        raise _paths.PathOutsideRootError(
            f"asset_rel_path must not start with a path separator: {asset_rel_path!r}"
        )
    if Path(asset_rel_path).is_absolute():
        raise _paths.PathOutsideRootError(
            f"asset_rel_path must be relative: {asset_rel_path!r}"
        )
    if (
        len(asset_rel_path) >= 2
        and asset_rel_path[1] == ":"
        and asset_rel_path[0].isalpha()
    ):
        raise _paths.PathOutsideRootError(
            f"drive-relative asset_rel_path not allowed: {asset_rel_path!r}"
        )
    rel_from_root = (
        f".claude/agents/{agent_name}/skills/{skill_name}/assets/{asset_rel_path}"
    )
    target = _paths.resolve_within_root(root, rel_from_root, allow_root_itself=False)
    notional_assets = (
        _agents_dir(root) / agent_name / "skills" / skill_name / "assets"
    ).resolve()
    try:
        target.relative_to(notional_assets)
    except ValueError as exc:
        raise _paths.PathOutsideRootError(
            f"asset path must resolve under {skill_name}/assets/: {asset_rel_path!r}"
        ) from exc
    return target


def _audit_log(action: str, agent: str, skill: str, asset: str, is_executable: bool) -> None:
    """Best-effort audit line for asset writes that touch executable context.

    Logger failure is swallowed — the primary filesystem write already
    succeeded, and losing an audit line must not sink the operation.
    """
    try:
        from engine import logger
        logger.append(
            "CBIM:skill_asset",
            f"{action}|agent={agent}|skill={skill}|asset={asset}"
            f"|is_executable={is_executable}",
        )
    except Exception:  # noqa: BLE001 — logging is side-effect; primary write already landed
        pass


def create_agent_skill(
    agent_name: str,
    skill_name: str,
    body: str = "",
    *,
    as_dir: bool = False,
    cwd: str = "",
) -> str:
    """Create a new per-agent skill.

    ``as_dir=False`` (default) creates the file-form `<skill>.md`;
    ``as_dir=True`` creates the dir-form `<skill>/skill.md` with an
    empty `assets/` (materialised on the first `add_skill_asset`).

    Returns the absolute path of the primary markdown file.

    Raises:
        ValueError             — invalid identifier.
        ForbiddenAgentError    — `agent_name` is framework-owned.
        FileNotFoundError      — agent directory does not exist.
        FileExistsError        — the skill already exists in either form.
    """
    from cbi._primitives import skills as _skill_primitives

    _guard_write(agent_name, skill_name)
    root = _resolve_root(cwd)
    agents_dir = _agents_dir(root)
    if not (agents_dir / agent_name).is_dir():
        raise FileNotFoundError(f"agent not found: {agent_name}")

    target = _skill_primitives.create_agent_skill(
        agents_dir, agent_name, skill_name, body, as_dir=as_dir
    )
    _reindex.reindex_agent(root, agent_name)
    return str(target.resolve())


def update_agent_skill(
    agent_name: str,
    skill_name: str,
    target: str,
    payload: dict,
    *,
    cwd: str = "",
) -> str:
    """Update a per-agent skill in place.

    Only ``target="body"`` is currently supported — the primitive layer
    exposes `update_agent_skill_body` (whole-body replace, frontmatter
    preserved verbatim) and nothing finer-grained. Section- or
    frontmatter-field-level edits would require new primitives; this
    service layer refuses to invent them via string manipulation (that
    was the exact anti-pattern the primitive/service split was designed
    to prevent).

    Payload shape for ``target="body"``: ``{"content": str}`` — matches
    the ``agent_service.update_agent`` convention.

    Returns the absolute path of the primary markdown file.

    Raises:
        ValueError             — invalid identifier, unknown target, or
                                 missing/mistyped payload field.
        ForbiddenAgentError    — `agent_name` is framework-owned.
        FileNotFoundError      — skill does not exist.
    """
    from cbi._primitives import skills as _skill_primitives

    _guard_write(agent_name, skill_name)
    if target != "body":
        raise ValueError(
            f"unsupported target: {target!r} "
            "(only 'body' is supported until a matching primitive exists)"
        )
    body = payload.get("content")
    if body is None:
        raise ValueError("payload.content is required for target='body'")
    if not isinstance(body, str):
        raise ValueError("payload.content must be a string")

    root = _resolve_root(cwd)
    agents_dir = _agents_dir(root)
    result = _skill_primitives.update_agent_skill_body(
        agents_dir, agent_name, skill_name, body
    )
    _reindex.reindex_agent(root, agent_name)
    return str(result.resolve())


def delete_agent_skill(
    agent_name: str,
    skill_name: str,
    *,
    cwd: str = "",
) -> str:
    """Delete a per-agent skill entirely (file-form or full dir tree).

    Returns the absolute path that was removed.

    Raises:
        ValueError             — invalid identifier.
        ForbiddenAgentError    — `agent_name` is framework-owned.
        FileNotFoundError      — skill does not exist in either form.
    """
    from cbi._primitives import skills as _skill_primitives

    _guard_write(agent_name, skill_name)
    root = _resolve_root(cwd)
    agents_dir = _agents_dir(root)
    removed = _skill_primitives.delete_agent_skill(agents_dir, agent_name, skill_name)
    _reindex.reindex_agent(root, agent_name)
    return str(removed.resolve())


def add_skill_asset(
    agent_name: str,
    skill_name: str,
    asset_rel_path: str,
    content: str,
    *,
    is_executable: bool = False,
    cwd: str = "",
) -> str:
    """Write an asset under `<agent>/skills/<skill>/assets/<asset_rel_path>`.

    Executable-asset gating (in the order they fire):
      * `asset_rel_path` suffix in :data:`_EXECUTABLE_ASSET_SUFFIXES`
        with ``is_executable=False`` → :class:`ExecutableAssetRequiresFlagError`.
      * Suffix whitelisted OR ``is_executable=True`` → zero-byte marker
        ``<asset>.executable-declared`` is created alongside the asset
        and an audit line is appended to the session log.
      * Suffix not whitelisted AND ``is_executable=False`` → no marker,
        no audit line — a plain content asset.

    Returns the absolute path of the written asset.

    Raises:
        ValueError                         — invalid identifier or empty rel path.
        ForbiddenAgentError                — `agent_name` is framework-owned.
        _paths.PathOutsideRootError        — path escapes `<skill>/assets/`.
        ExecutableAssetRequiresFlagError   — whitelisted-suffix asset without flag.
        FileNotFoundError                  — skill does not exist.
    """
    from cbi._primitives import skills as _skill_primitives

    _guard_write(agent_name, skill_name)
    root = _resolve_root(cwd)
    _resolve_asset_target(root, agent_name, skill_name, asset_rel_path)

    ext = Path(asset_rel_path).suffix.lower()
    in_whitelist = ext in _EXECUTABLE_ASSET_SUFFIXES
    if in_whitelist and not is_executable:
        raise ExecutableAssetRequiresFlagError(
            f"{asset_rel_path!r} has an executable suffix ({ext}); "
            "pass is_executable=True to acknowledge"
        )
    executable_context = in_whitelist or is_executable

    agents_dir = _agents_dir(root)
    written = _skill_primitives.add_skill_asset(
        agents_dir, agent_name, skill_name, asset_rel_path, content
    )

    if executable_context:
        marker = written.with_name(written.name + _EXECUTABLE_MARKER_SUFFIX)
        try:
            marker.write_bytes(b"")
        except OSError:
            # Marker is best-effort — the asset itself already landed and
            # `remove_skill_asset`'s primitive-level marker cleanup handles
            # absent markers cleanly. Losing the marker only affects the
            # `is_executable=True` inference on subsequent remove-time
            # audit logs; that is a much smaller failure than sinking the
            # whole operation.
            pass
        _audit_log("add", agent_name, skill_name, asset_rel_path, is_executable)

    _reindex.reindex_agent(root, agent_name)
    return str(written.resolve())


def remove_skill_asset(
    agent_name: str,
    skill_name: str,
    asset_rel_path: str,
    *,
    cwd: str = "",
) -> str:
    """Remove an asset from `<agent>/skills/<skill>/assets/`.

    The primitive removes both the asset file and any sibling
    ``<asset>.executable-declared`` marker atomically. We inspect the
    marker BEFORE calling the primitive so the audit line — written
    afterwards — reflects the pre-removal executable-context state.

    Returns the absolute path that was removed.

    Raises:
        ValueError                    — invalid identifier or empty rel path.
        ForbiddenAgentError           — `agent_name` is framework-owned.
        _paths.PathOutsideRootError   — path escapes `<skill>/assets/`.
        FileNotFoundError             — skill has no assets dir or asset missing.
    """
    from cbi._primitives import skills as _skill_primitives

    _guard_write(agent_name, skill_name)
    root = _resolve_root(cwd)
    target = _resolve_asset_target(root, agent_name, skill_name, asset_rel_path)

    # Capture marker state BEFORE the primitive fires — the primitive
    # removes both the asset and the marker atomically, so a post-call
    # `marker.exists()` check would always report False and the audit
    # line would lose its `is_executable` signal.
    marker = target.with_name(target.name + _EXECUTABLE_MARKER_SUFFIX)
    was_executable_declared = marker.exists()

    agents_dir = _agents_dir(root)
    removed = _skill_primitives.remove_skill_asset(
        agents_dir, agent_name, skill_name, asset_rel_path
    )

    if was_executable_declared:
        _audit_log("remove", agent_name, skill_name, asset_rel_path, True)

    _reindex.reindex_agent(root, agent_name)
    return str(removed.resolve())
