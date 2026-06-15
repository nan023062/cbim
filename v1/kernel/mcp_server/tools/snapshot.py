"""
mcp_server/tools/snapshot.py — Project knowledge snapshot tool.
"""

from __future__ import annotations


def register(mcp) -> None:
    @mcp.tool()
    def project_snapshot(cwd: str = "") -> str:
        """Generate the project knowledge snapshot: module tree, registered agents,
        recent activity. Equivalent to `python .cbim/engine snapshot`.

        Args:
            cwd: Project directory (default: current working dir of the MCP server).
        """
        # Batch 2: route through services.build_snapshot so the tool stays
        # within the engine.* / mcp_server.* → services boundary that the
        # banned-api rule enforces. The service walks up from `cwd` to
        # locate the .cbim/ marker (Batch 1 bug fix).
        from services import build_snapshot
        return build_snapshot(cwd=cwd)
