"""
services - shared CBIM service layer.

Stable, dependency-light functions that return structured Python data
(no HTTP, no MCP SDK, no formatting for LLM consumption). Both the
dashboard HTTP server and the MCP tool layer consume this package as
their single source of truth.

Dependency direction (single, hard rule):
    mcp_server.tools --> services <-- dashboard.server
The dashboard layer MUST NOT import from mcp_server; MCP tools MUST NOT
import from dashboard. If either direction shows up, the boundary is broken.
"""

from ._paths import PathOutsideRootError, resolve_within_root
from .agent_service import (
    add_skill_to_agent,
    archive_agent,
    get_agent,
    list_agents,
    scaffold_agent,
    update_agent,
)
from .knowledge_service import (
    build_snapshot,
    dry_run_section,
    edit_module,
    get_module,
    get_module_fm_schema,
    init_module,
    list_modules,
    reindex_modules,
    scan_workflows,
    split_module,
    write_doc,
    write_section,
)
from .log_service import read_log
from .memory_service import (
    cleanup as memory_cleanup,
)
from .memory_service import (
    get_entry,
    list_entries,
)
from .memory_service import (
    reindex as memory_reindex,
)
from .skill_service import get_skill, list_skills

__all__ = [
    "PathOutsideRootError",
    "resolve_within_root",
    "list_entries",
    "get_entry",
    "list_agents",
    "get_agent",
    "list_modules",
    "get_module",
    "get_module_fm_schema",
    "build_snapshot",
    "reindex_modules",
    "scan_workflows",
    "dry_run_section",
    "list_skills",
    "get_skill",
    "read_log",
    # writes
    "scaffold_agent",
    "update_agent",
    "add_skill_to_agent",
    "archive_agent",
    "init_module",
    "edit_module",
    "split_module",
    "write_doc",
    "write_section",
    "memory_reindex",
    "memory_cleanup",
]
