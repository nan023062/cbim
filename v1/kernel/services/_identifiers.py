"""services/_identifiers.py — shared identifier validation.

Agent and skill names flow from external callers (CLI / MCP / dashboard)
and get joined into ``.claude/agents/<name>/skills/<skill>/...`` paths.
Both ``agent_service`` and ``skill_service`` need the same rejection
rules for path separators and dot-segments, so the check lives here as
a single source of truth rather than being duplicated (or worse: drifted)
across service modules.

Previously this function lived as ``_validate_identifier`` inside
``agent_service`` with a leading underscore signalling module-private.
Promoting it to a shared services-internal helper keeps the same
semantics; the underscore is dropped because the module itself
(``_identifiers``) already carries the "package-internal" marker.
"""

from __future__ import annotations


def validate_identifier(value: str, *, kind: str) -> None:
    """Reject path-traversal attempts in agent / skill names.

    ``value`` is any identifier that will be joined into a filesystem
    path (agent name, skill name, and any future services-owned key
    that follows the same discipline). ``kind`` is included in the
    error message so callers do not need to wrap the raise themselves.
    """
    if not value or "/" in value or "\\" in value or value in (".", ".."):
        raise ValueError(f"invalid {kind} name: {value!r}")
