"""`cbim mcp` domain — start the CBIM MCP server (stdio transport)."""

import argparse


def register(sub: argparse._SubParsersAction) -> argparse.ArgumentParser:
    return sub.add_parser("mcp", help="Start the CBIM MCP server (stdio transport)")


def dispatch(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    from mcp_server import server as mcp_server
    mcp_server.mcp.run()
    return 0


__all__ = ["register", "dispatch"]
