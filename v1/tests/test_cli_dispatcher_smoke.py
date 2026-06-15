"""Batch 0 装尺 — `engine.cli.main` argparse-dispatcher smoke tests.

Goal: assert that every top-level sub-parser routes its parsed args to the
correct handler. We do *not* execute any real handler — they're all
monkeypatched to no-op recorders that capture the resulting argparse
Namespace. This locks down the dispatcher contract so later refactors
(splitting cli.py, swapping argparse for click, etc.) cannot silently
break command routing.

What's exercised per sub-parser:
  - argv parses without error
  - parsed Namespace.domain (and .command, where the sub-parser has one) is correct
  - the *exact* handler the dispatcher calls is the one this test patches
  - main() returns the patched handler's return code

Concretely: patching `engine.cli._handle_dna_list` (etc.) works because the
dispatch dictionary in `engine.cli.main()` is materialised inside the
function body — after our patch — and resolves names from the module
globals. Patches to other modules (memory.cli, services, etc.) work the
same way: the dispatch dict captures attribute references after import.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

import engine.cli as cli_mod


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _Recorder:
    """Records every call. Returns the configured exit code."""

    def __init__(self, return_value: Any = 0) -> None:
        self.calls: list[tuple[tuple, dict]] = []
        self.return_value = return_value

    def __call__(self, *args, **kwargs) -> Any:
        self.calls.append((args, kwargs))
        return self.return_value

    @property
    def called_once(self) -> bool:
        return len(self.calls) == 1

    @property
    def last_args_namespace(self):
        """First positional arg of last call, expected to be argparse.Namespace."""
        if not self.calls:
            return None
        positional, _ = self.calls[-1]
        return positional[0] if positional else None


def _run_cli(monkeypatch, argv: list[str]) -> int:
    """Inject argv into sys.argv and run engine.cli.main()."""
    import sys
    monkeypatch.setattr(sys, "argv", ["cbim", *argv])
    return cli_mod.main()


# ---------------------------------------------------------------------------
# memory: create / add / query / delete / reindex / cleanup
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "argv, expected_command, attr, extra_attrs",
    [
        (["memory", "create", "--slug", "x", "--content", "y"], "create",
         "cmd_create", {"slug": "x", "content": "y", "tier": "short"}),
        (["memory", "add", "/tmp/foo.md"], "add", "cmd_add",
         {"path": "/tmp/foo.md", "tier": "short"}),
        (["memory", "query", "hello"], "query", "cmd_query",
         {"text": "hello"}),
        (["memory", "delete", "some/path"], "delete", "cmd_delete",
         {"path": "some/path"}),
        (["memory", "reindex"], "reindex", "cmd_reindex", {}),
        (["memory", "cleanup"], "cleanup", "cmd_cleanup", {}),
    ],
)
def test_memory_subparser_routes(monkeypatch, argv, expected_command, attr, extra_attrs):
    """Each `memory <cmd>` routes to the matching memory.cli.cmd_<cmd>."""
    import memory.cli as mcli
    rec = _Recorder()
    monkeypatch.setattr(mcli, attr, rec)
    assert _run_cli(monkeypatch, argv) == 0
    assert rec.called_once
    ns = rec.last_args_namespace
    assert ns.domain == "memory"
    assert ns.command == expected_command
    for k, v in extra_attrs.items():
        assert getattr(ns, k) == v


# ---------------------------------------------------------------------------
# dna: list / show / init / reindex / edit / split / write-doc / write-section
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "argv, expected_command, handler_name, extra_attrs",
    [
        (["dna", "list"], "list", "_handle_dna_list", {}),
        (["dna", "show", "src/foo"], "show", "_handle_dna_show",
         {"path": "src/foo"}),
        (["dna", "init", "src/foo", "--type", "leaf",
          "--name", "Foo", "--owner", "platform"],
         "init", "_handle_dna_init",
         {"dir": "src/foo", "type": "leaf", "name": "Foo", "owner": "platform"}),
        (["dna", "reindex"], "reindex", "_handle_dna_reindex", {}),
        (["dna", "edit", "src/foo", "--target", "body"],
         "edit", "_handle_dna_edit",
         {"module_path": "src/foo", "target": "body"}),
        (["dna", "split", "src/foo"], "split", "_handle_dna_split",
         {"source": "src/foo"}),
    ],
)
def test_dna_subparser_routes(monkeypatch, argv, expected_command, handler_name, extra_attrs):
    rec = _Recorder()
    monkeypatch.setattr(cli_mod, handler_name, rec)
    assert _run_cli(monkeypatch, argv) == 0
    assert rec.called_once
    ns = rec.last_args_namespace
    assert ns.domain == "dna"
    assert ns.command == expected_command
    for k, v in extra_attrs.items():
        assert getattr(ns, k) == v


# ---------------------------------------------------------------------------
# agent: list / show / scaffold / archive / update / add-skill
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "argv, expected_command, handler_name, extra_attrs",
    [
        (["agent", "list"], "list", "_handle_agent_list", {}),
        (["agent", "show", "auditor"], "show", "_handle_agent_show",
         {"name": "auditor"}),
        (["agent", "scaffold", "fooagent"], "scaffold", "_handle_agent_scaffold",
         {"name": "fooagent"}),
        (["agent", "archive", "fooagent"], "archive", "_handle_agent_archive",
         {"name": "fooagent"}),
        (["agent", "update", "fooagent", "--target", "frontmatter",
          "--field", "model", "--value", "x"],
         "update", "_handle_agent_update",
         {"name": "fooagent", "target": "frontmatter", "field": "model", "value": "x"}),
        (["agent", "add-skill", "fooagent", "myskill", "--content", "x"],
         "add-skill", "_handle_agent_add_skill",
         {"agent_name": "fooagent", "skill_name": "myskill"}),
    ],
)
def test_agent_subparser_routes(monkeypatch, argv, expected_command, handler_name, extra_attrs):
    rec = _Recorder()
    monkeypatch.setattr(cli_mod, handler_name, rec)
    assert _run_cli(monkeypatch, argv) == 0
    assert rec.called_once
    ns = rec.last_args_namespace
    assert ns.domain == "agent"
    assert ns.command == expected_command
    for k, v in extra_attrs.items():
        assert getattr(ns, k) == v


# ---------------------------------------------------------------------------
# snapshot: top-level, no sub-command. Calls cbi._primitives.snapshot.build_snapshot.
# ---------------------------------------------------------------------------

def test_snapshot_routes_to_build_snapshot(monkeypatch):
    """`cbim snapshot` calls build_snapshot(Path(args.root).resolve())."""
    import cbi._primitives.snapshot as snap_mod
    rec = _Recorder(return_value="(snapshot)")
    monkeypatch.setattr(snap_mod, "build_snapshot", rec)
    assert _run_cli(monkeypatch, ["snapshot", "--root", "."]) == 0
    assert rec.called_once
    # build_snapshot is called with the resolved Path
    (passed_root,), _ = rec.calls[0]
    from pathlib import Path
    assert isinstance(passed_root, Path)


# ---------------------------------------------------------------------------
# skill: list / show
# ---------------------------------------------------------------------------

def test_skill_subparser_routes(monkeypatch):
    """`cbim skill list` routes through _cmd_skill which queries Skill resource."""
    rec = _Recorder()
    monkeypatch.setattr(cli_mod, "_cmd_skill", rec)
    assert _run_cli(monkeypatch, ["skill", "list"]) == 0
    assert rec.called_once
    ns = rec.last_args_namespace
    assert ns.domain == "skill"
    assert ns.command == "list"


def test_skill_show_passes_name(monkeypatch):
    rec = _Recorder()
    monkeypatch.setattr(cli_mod, "_cmd_skill", rec)
    assert _run_cli(monkeypatch, ["skill", "show", "memory_write"]) == 0
    assert rec.called_once
    ns = rec.last_args_namespace
    assert ns.domain == "skill"
    assert ns.command == "show"
    assert ns.name == "memory_write"


# ---------------------------------------------------------------------------
# soul: list / show
# ---------------------------------------------------------------------------

def test_soul_subparser_routes(monkeypatch):
    rec = _Recorder()
    monkeypatch.setattr(cli_mod, "_cmd_soul", rec)
    assert _run_cli(monkeypatch, ["soul", "list"]) == 0
    assert rec.called_once
    ns = rec.last_args_namespace
    assert ns.domain == "soul"
    assert ns.command == "list"


# ---------------------------------------------------------------------------
# log: show / tail
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "argv, expected_command, attr",
    [
        (["log", "show"], "show", "cmd_log_show"),
        (["log", "tail"], "tail", "cmd_log_tail"),
    ],
)
def test_log_subparser_routes(monkeypatch, argv, expected_command, attr):
    """log show / tail route to engine.log_view.cmd_log_*."""
    # The dict is built inside main() so patching the module attribute
    # before calling main() is what gets captured.
    import engine.log_view as lv
    rec = _Recorder()
    monkeypatch.setattr(lv, attr, rec)
    # Also patch the names re-exported into engine.cli, since main()
    # builds the dispatch dict from those local imports.
    monkeypatch.setattr(cli_mod, attr, rec)
    assert _run_cli(monkeypatch, argv) == 0
    assert rec.called_once
    ns = rec.last_args_namespace
    assert ns.domain == "log"
    assert ns.command == expected_command


# ---------------------------------------------------------------------------
# config: get / set / show
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "argv, expected_command, attr, extras",
    [
        (["config", "get", "memory.short_term.keep_days"], "get", "cmd_config_get",
         {"key": "memory.short_term.keep_days"}),
        (["config", "set", "k", "v"], "set", "cmd_config_set",
         {"key": "k", "value": "v"}),
        (["config", "show"], "show", "cmd_config_show", {}),
    ],
)
def test_config_subparser_routes(monkeypatch, argv, expected_command, attr, extras):
    """config get/set/show route to engine.config.cmd_config_*. The dispatch
    dict is built fresh inside main(), so patching engine.config.<attr>
    before main() runs is what gets resolved."""
    import engine.config as cfg
    rec = _Recorder()
    monkeypatch.setattr(cfg, attr, rec)
    assert _run_cli(monkeypatch, argv) == 0
    assert rec.called_once
    ns = rec.last_args_namespace
    assert ns.domain == "config"
    assert ns.command == expected_command
    for k, v in extras.items():
        assert getattr(ns, k) == v


# ---------------------------------------------------------------------------
# dashboard
# ---------------------------------------------------------------------------

def test_dashboard_routes_to_cmd_dashboard(monkeypatch):
    rec = _Recorder()
    monkeypatch.setattr(cli_mod, "cmd_dashboard", rec)
    assert _run_cli(monkeypatch, ["dashboard", "--no-browser"]) == 0
    assert rec.called_once
    ns = rec.last_args_namespace
    assert ns.domain == "dashboard"
    assert ns.no_browser is True


def test_preview_alias_routes_to_cmd_dashboard(monkeypatch, capsys):
    """`preview` is a deprecated alias; it must still reach cmd_dashboard
    and emit the [DEPRECATED] notice naming 1.1.0 to stderr."""
    rec = _Recorder()
    monkeypatch.setattr(cli_mod, "cmd_dashboard", rec)
    assert _run_cli(monkeypatch, ["preview", "--no-browser"]) == 0
    assert rec.called_once
    err = capsys.readouterr().err
    assert "[DEPRECATED]" in err
    assert "1.1.0" in err
    assert "preview" in err


# ---------------------------------------------------------------------------
# debug: on / off / status
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "argv, expected_command",
    [
        (["debug", "on"], "on"),
        (["debug", "off"], "off"),
        (["debug", "status"], "status"),
    ],
)
def test_debug_subparser_routes(monkeypatch, argv, expected_command):
    rec = _Recorder()
    monkeypatch.setattr(cli_mod, "_cmd_debug", rec)
    assert _run_cli(monkeypatch, argv) == 0
    assert rec.called_once
    ns = rec.last_args_namespace
    assert ns.domain == "debug"
    assert ns.command == expected_command


# ---------------------------------------------------------------------------
# mcp: starts the MCP server. Patch `mcp_server.server.mcp.run`.
# ---------------------------------------------------------------------------

def test_mcp_routes_to_server_run(monkeypatch):
    """`cbim mcp` imports mcp_server.server lazily and invokes mcp.run()."""
    # Build a fake mcp_server.server module before the lazy import in main().
    import sys
    fake_run = _Recorder(return_value=None)
    fake_mcp = SimpleNamespace(run=fake_run)
    fake_mod = SimpleNamespace(mcp=fake_mcp)
    # Replace the import resolution; lazy `from mcp_server import server`
    # in main() will pick this up via sys.modules.
    monkeypatch.setitem(sys.modules, "mcp_server.server", fake_mod)
    assert _run_cli(monkeypatch, ["mcp"]) == 0
    assert fake_run.called_once


# ---------------------------------------------------------------------------
# audit: dispatched via engine.audit.cli.dispatch
# ---------------------------------------------------------------------------

def test_audit_routes_to_audit_dispatch(monkeypatch):
    """`cbim audit list-checks` is parsed at the top level, then handed to
    engine.audit.cli.dispatch via the lazy import in main()."""
    import engine.audit.cli as audit_cli
    rec = _Recorder()
    monkeypatch.setattr(audit_cli, "dispatch", rec)
    assert _run_cli(monkeypatch, ["audit", "list-checks"]) == 0
    assert rec.called_once
    ns = rec.last_args_namespace
    assert ns.domain == "audit"


# ---------------------------------------------------------------------------
# init: dispatched via engine.cli._cmd_init
# ---------------------------------------------------------------------------

def test_init_routes_to_cmd_init(monkeypatch):
    rec = _Recorder()
    monkeypatch.setattr(cli_mod, "_cmd_init", rec)
    assert _run_cli(monkeypatch, ["init"]) == 0
    assert rec.called_once
    ns = rec.last_args_namespace
    assert ns.domain == "init"
    assert ns.force is False


def test_init_force_flag_propagates(monkeypatch):
    rec = _Recorder()
    monkeypatch.setattr(cli_mod, "_cmd_init", rec)
    assert _run_cli(monkeypatch, ["init", "--force"]) == 0
    assert rec.last_args_namespace.force is True


# ---------------------------------------------------------------------------
# project sync
# ---------------------------------------------------------------------------

def test_project_sync_routes_to_cmd_project(monkeypatch):
    rec = _Recorder()
    monkeypatch.setattr(cli_mod, "_cmd_project", rec)
    assert _run_cli(monkeypatch, ["project", "sync", "--dry-run"]) == 0
    assert rec.called_once
    ns = rec.last_args_namespace
    assert ns.domain == "project"
    assert ns.command == "sync"
    assert ns.dry_run is True


# ---------------------------------------------------------------------------
# No domain — print help, return 1
# ---------------------------------------------------------------------------

def test_no_domain_prints_help(monkeypatch, capsys):
    """Bare `cbim` with no args prints top-level help and returns 1."""
    rc = _run_cli(monkeypatch, [])
    assert rc == 1
    out = capsys.readouterr().out
    # argparse top-level help mentions every domain
    for domain in ("memory", "dna", "agent", "snapshot", "audit"):
        assert domain in out
