"""engine.cli — Unified CBIM CLI entry point.

Usage (from project root):
  .cbim/run <domain> <command> [args]

Domains:
  memory      create | add | query | delete | reindex | cleanup
  dna         list | show | init | reindex | edit | write-doc (deprecated) | write-section (deprecated) | split
  agent       list | show | scaffold | archive | update | add-skill
  snapshot    [--root PATH]
  skill       list | show <name> | create | update | delete | add-asset | remove-asset
  soul        list | show <name>
  config      get <key> | set <key> <value> | show
  dashboard   [--port N] [--no-browser]   (preview = deprecated alias)
  debug       on | off | status
  log         show | tail
  init        Bootstrap a new CBIM project in cwd
  project     sync (refresh kernel-managed templates)
  audit       run | index | memory | agents | dna | tree | list-checks
  mcp         Start the CBIM MCP server (stdio)

Each domain is a standalone module with a `register(sub)` (returns its own
argparse parser) and a `dispatch(args, parser)` (returns exit code). The
top-level `main()` knows nothing about any domain's internals — it just
wires sub-parsers and routes by `args.domain`.
"""

import argparse

from . import agent as _agent
from . import audit as _audit
from . import config as _config
from . import dashboard as _dashboard
from . import debug as _debug
from . import dna as _dna
from . import init as _init
from . import log as _log
from . import mcp as _mcp
from . import memory as _memory
from . import project as _project
from . import skill as _skill
from . import snapshot as _snapshot
from . import soul as _soul


def main() -> int:
    parser = argparse.ArgumentParser(prog=".cbim/run")
    sub = parser.add_subparsers(dest="domain")

    parsers: dict[str, argparse.ArgumentParser] = {
        "memory": _memory.register(sub),
        "dna": _dna.register(sub),
        "agent": _agent.register(sub),
        "snapshot": _snapshot.register(sub),
        "skill": _skill.register(sub),
        "soul": _soul.register(sub),
        "log": _log.register(sub),
        "config": _config.register(sub),
        "dashboard": _dashboard.register(sub),
        "preview": _dashboard.register_preview(sub),
        "debug": _debug.register(sub),
        "mcp": _mcp.register(sub),
        "init": _init.register(sub),
        "audit": _audit.register(sub),
        "project": _project.register(sub),
    }

    dispatch_table = {
        "memory": _memory.dispatch,
        "dna": _dna.dispatch,
        "agent": _agent.dispatch,
        "snapshot": _snapshot.dispatch,
        "skill": _skill.dispatch,
        "soul": _soul.dispatch,
        "log": _log.dispatch,
        "config": _config.dispatch,
        "dashboard": _dashboard.dispatch,
        "preview": _dashboard.dispatch_preview,
        "debug": _debug.dispatch,
        "mcp": _mcp.dispatch,
        "init": _init.dispatch,
        "audit": _audit.dispatch,
        "project": _project.dispatch,
    }

    args = parser.parse_args()
    domain = args.domain
    if domain in dispatch_table:
        return dispatch_table[domain](args, parsers.get(domain))

    parser.print_help()
    return 1


# Re-exports for tests and any in-tree caller that historically reached into
# engine.cli for handler/helper functions when they all lived in one module.
# These names predate the cli/ package split; keeping them visible here keeps
# the test suite a-zero-touch and lets monkey-patching engine.cli.<name>
# rebind the function the dispatcher actually invokes (the dispatchers do a
# late lookup via this package).
from engine.log_view import cmd_log_show as cmd_log_show
from engine.log_view import cmd_log_tail as cmd_log_tail
from .agent import _AGENT_FM_EDITABLE as _AGENT_FM_EDITABLE
from .agent import _apply_agent_update_in_memory as _apply_agent_update_in_memory
from .agent import _build_agent_update_payload as _build_agent_update_payload
from .agent import _handle_agent_add_skill as _handle_agent_add_skill
from .agent import _handle_agent_archive as _handle_agent_archive
from .agent import _handle_agent_list as _handle_agent_list
from .agent import _handle_agent_scaffold as _handle_agent_scaffold
from .agent import _handle_agent_show as _handle_agent_show
from .agent import _handle_agent_update as _handle_agent_update
from .agent import _render_agent as _render_agent
from .agent import _warn_if_kernel_managed as _warn_if_kernel_managed
from .dashboard import cmd_dashboard as cmd_dashboard
from .debug import _cmd_debug as _cmd_debug
from .debug import _debug_flag_path as _debug_flag_path
from .dna import _apply_dna_edit_in_memory as _apply_dna_edit_in_memory
from .dna import _build_dna_edit_payload as _build_dna_edit_payload
from .dna import _handle_dna_edit as _handle_dna_edit
from .dna import _handle_dna_init as _handle_dna_init
from .dna import _handle_dna_list as _handle_dna_list
from .dna import _handle_dna_reindex as _handle_dna_reindex
from .dna import _handle_dna_show as _handle_dna_show
from .dna import _handle_dna_split as _handle_dna_split
from .dna import _handle_dna_stamp_freshness as _handle_dna_stamp_freshness
from .dna import _handle_dna_write_doc as _handle_dna_write_doc
from .dna import _handle_dna_write_section as _handle_dna_write_section
from .dna import _parse_into_spec as _parse_into_spec
from .init import _cmd_init as _cmd_init
from .project import _cmd_project as _cmd_project
from .skill import _cmd_skill as _cmd_skill
from .skill import _handle_skill_add_asset as _handle_skill_add_asset
from .skill import _handle_skill_create as _handle_skill_create
from .skill import _handle_skill_delete as _handle_skill_delete
from .skill import _handle_skill_remove_asset as _handle_skill_remove_asset
from .skill import _handle_skill_update as _handle_skill_update
from .soul import _cmd_soul as _cmd_soul
from .soul import _load_souls as _load_souls

__all__ = ["main"]
