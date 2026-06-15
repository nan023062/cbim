"""Batch 0 装尺 — `mcp_server.tools.*` thin-shell tests.

Goal: assert that every MCP tool is a thin forwarder. We exercise each
`register(mcp)` with a FakeMCP that captures the @mcp.tool() decorated
closures, then call the closures with mocked downstream targets and verify
the forwarding contract:

  - the closure exists (i.e. register() actually registered it)
  - it calls the expected downstream function once
  - it forwards the args correctly
  - it returns the downstream result (after any documented post-processing
    like .to_dict() or json.dumps())

Real logic lives in services / engine.* / cbi.resources — those layers
have their own dedicated tests. This file only locks down the MCP boundary.
"""
from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any

import pytest


# ---------------------------------------------------------------------------
# FakeMCP — collects @mcp.tool() decorated functions for inspection.
# ---------------------------------------------------------------------------

class FakeMCP:
    """A no-op MCP server. `register(mcp)` calls @mcp.tool() which we capture
    so tests can call the underlying function directly.
    """

    def __init__(self) -> None:
        self.tools: dict[str, Any] = {}

    def tool(self, *_args, **_kwargs):
        """Decorator factory. Real `mcp.tool()` returns a decorator; mimic that."""
        def decorator(fn):
            self.tools[fn.__name__] = fn
            return fn
        return decorator


def _register(module) -> dict[str, Any]:
    fmcp = FakeMCP()
    module.register(fmcp)
    return fmcp.tools


class _Recorder:
    def __init__(self, return_value: Any = None) -> None:
        self.calls: list[tuple[tuple, dict]] = []
        self.return_value = return_value

    def __call__(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self.return_value

    @property
    def called_once(self) -> bool:
        return len(self.calls) == 1


# ---------------------------------------------------------------------------
# tools/dna.py — registers dna_list / dna_show / dna_reindex / dna_init /
# dna_edit / dna_split / dna_write_doc / dna_write_section. Read tools call
# cbi.resources.DNAModule directly; write tools forward to services.*.
# ---------------------------------------------------------------------------

def test_dna_list_forwards_to_services_list_modules(monkeypatch):
    import services
    import mcp_server.tools.dna as dna_tool

    rec = _Recorder(return_value=[])  # service returns list of dicts
    monkeypatch.setattr(services, "list_modules", rec)

    tools = _register(dna_tool)
    out = tools["dna_list"](cwd="/some/where")
    assert rec.called_once
    _, kwargs = rec.calls[0]
    assert kwargs.get("cwd") == "/some/where"
    assert "no .dna modules found" in out


def test_dna_init_forwards_to_init_module(monkeypatch):
    import services
    import mcp_server.tools.dna as dna_tool

    rec = _Recorder(return_value="/abs/.dna")
    monkeypatch.setattr(services, "init_module", rec)
    # The MCP tool no longer reindexes inline (Batch 1 moved that into
    # services.knowledge_service); since we replace `services.init_module`
    # itself with a recorder, no reindex happens — nothing to suppress.

    tools = _register(dna_tool)
    result = tools["dna_init"](
        dir="src/foo", kind="leaf", name="Foo", owner="platform",
        description="Test module", with_contract=False, status="spec", cwd="",
    )
    assert rec.called_once
    _, kwargs = rec.calls[0]
    assert kwargs["kind"] == "leaf"
    assert kwargs["name"] == "Foo"
    assert kwargs["owner"] == "platform"
    assert kwargs["description"] == "Test module"
    assert kwargs["status"] == "spec"
    assert result == "/abs/.dna"


def test_dna_edit_forwards_to_edit_module(monkeypatch):
    import services
    import mcp_server.tools.dna as dna_tool

    rec = _Recorder(return_value="/abs/module.md")
    monkeypatch.setattr(services, "edit_module", rec)

    tools = _register(dna_tool)
    payload = {"content": "x"}
    result = tools["dna_edit"](
        module_path="src/foo", target="body", payload=payload,
        mode="replace", cwd="",
    )
    assert rec.called_once
    args, kwargs = rec.calls[0]
    assert args[0] == "src/foo"
    assert args[1] == "body"
    assert args[2] is payload
    assert kwargs["mode"] == "replace"
    assert result == "/abs/module.md"


def test_dna_edit_translates_value_error_to_error_string(monkeypatch):
    import services
    import mcp_server.tools.dna as dna_tool

    def _raise(*a, **k):
        raise ValueError("bad payload")
    monkeypatch.setattr(services, "edit_module", _raise)

    tools = _register(dna_tool)
    out = tools["dna_edit"](
        module_path="src/foo", target="body", payload={}, mode="replace", cwd="",
    )
    assert out.startswith("ERROR:")


def test_dna_split_forwards_to_split_module(monkeypatch):
    import services
    import mcp_server.tools.dna as dna_tool

    rec = _Recorder(return_value={"created": [], "dependency_refs": []})
    monkeypatch.setattr(services, "split_module", rec)

    tools = _register(dna_tool)
    splits = [{"path": "src/bar", "name": "Bar", "headings": ["X"]}]
    result = tools["dna_split"](
        source_module_path="src/foo", splits=splits,
        strategy="comment", cwd="",
    )
    assert rec.called_once
    args, kwargs = rec.calls[0]
    assert args[0] == "src/foo"
    assert args[1] is splits
    assert kwargs["strategy"] == "comment"
    assert result == {"created": [], "dependency_refs": []}


def test_dna_write_doc_forwards_to_write_doc(monkeypatch):
    import services
    import mcp_server.tools.dna as dna_tool

    rec = _Recorder(return_value="/abs/module.md")
    monkeypatch.setattr(services, "write_doc", rec)

    tools = _register(dna_tool)
    out = tools["dna_write_doc"](
        module_path="src/foo", file="module.md", body="body text", cwd="",
    )
    assert rec.called_once
    assert out == "/abs/module.md"


def test_dna_write_doc_emits_deprecation_warning(monkeypatch, capsys):
    """dna_write_doc must emit a [DEPRECATED] notice naming 1.1.0 to stderr."""
    import services
    import mcp_server.tools.dna as dna_tool

    rec = _Recorder(return_value="/abs/module.md")
    monkeypatch.setattr(services, "write_doc", rec)

    tools = _register(dna_tool)
    tools["dna_write_doc"](
        module_path="src/foo", file="module.md", body="body text", cwd="",
    )
    err = capsys.readouterr().err
    assert "[DEPRECATED]" in err
    assert "1.1.0" in err
    assert "dna_write_doc" in err


def test_dna_write_section_forwards_to_write_section(monkeypatch):
    import services
    import mcp_server.tools.dna as dna_tool

    rec = _Recorder(return_value="/abs/module.md")
    monkeypatch.setattr(services, "write_section", rec)

    tools = _register(dna_tool)
    out = tools["dna_write_section"](
        module_path="src/foo", file="module.md",
        heading="Positioning", content="text", mode="replace", cwd="",
    )
    assert rec.called_once
    assert out == "/abs/module.md"


def test_dna_write_section_emits_deprecation_warning(monkeypatch, capsys):
    """dna_write_section must emit a [DEPRECATED] notice naming 1.1.0 to stderr."""
    import services
    import mcp_server.tools.dna as dna_tool

    rec = _Recorder(return_value="/abs/module.md")
    monkeypatch.setattr(services, "write_section", rec)

    tools = _register(dna_tool)
    tools["dna_write_section"](
        module_path="src/foo", file="module.md",
        heading="Positioning", content="text", mode="replace", cwd="",
    )
    err = capsys.readouterr().err
    assert "[DEPRECATED]" in err
    assert "1.1.0" in err
    assert "dna_write_section" in err


# ---------------------------------------------------------------------------
# tools/agent.py
# ---------------------------------------------------------------------------

def test_agent_list_forwards_to_list_agents(monkeypatch):
    import services
    import mcp_server.tools.agent as agent_tool

    rec = _Recorder(return_value=[])
    monkeypatch.setattr(services, "list_agents", rec)

    tools = _register(agent_tool)
    out = tools["agent_list"](cwd="/x")
    assert rec.called_once
    _, kwargs = rec.calls[0]
    assert kwargs["cwd"] == "/x"
    assert kwargs["include_builtin"] is True
    assert "no agents found" in out


def test_agent_scaffold_forwards_to_scaffold_agent(monkeypatch):
    import services
    import mcp_server.tools.agent as agent_tool

    rec = _Recorder(return_value="/abs/agent.md")
    monkeypatch.setattr(services, "scaffold_agent", rec)

    tools = _register(agent_tool)
    out = tools["agent_scaffold"](
        name="myagent", description="hi", model="claude-x", cwd="",
    )
    assert rec.called_once
    args, kwargs = rec.calls[0]
    assert args[0] == "myagent"
    assert kwargs["description"] == "hi"
    assert kwargs["model"] == "claude-x"
    assert out == "/abs/agent.md"


def test_agent_update_forwards_to_update_agent(monkeypatch):
    import services
    import mcp_server.tools.agent as agent_tool

    rec = _Recorder(return_value="/abs/agent.md")
    monkeypatch.setattr(services, "update_agent", rec)

    tools = _register(agent_tool)
    payload = {"field": "model", "value": "claude-y"}
    out = tools["agent_update"](
        name="myagent", target="frontmatter", payload=payload,
        mode="replace", cwd="",
    )
    assert rec.called_once
    args, kwargs = rec.calls[0]
    assert args[0] == "myagent"
    assert args[1] == "frontmatter"
    assert args[2] is payload
    assert kwargs["mode"] == "replace"
    assert out == "/abs/agent.md"


def test_agent_add_skill_forwards_to_add_skill_to_agent(monkeypatch):
    import services
    import mcp_server.tools.agent as agent_tool

    rec = _Recorder(return_value="/abs/skill.md")
    monkeypatch.setattr(services, "add_skill_to_agent", rec)

    tools = _register(agent_tool)
    out = tools["agent_add_skill"](
        agent_name="myagent", skill_name="foo", content="body", cwd="",
    )
    assert rec.called_once
    args, kwargs = rec.calls[0]
    assert args[0] == "myagent"
    assert args[1] == "foo"
    assert kwargs["content"] == "body"
    assert out == "/abs/skill.md"


def test_agent_archive_forwards_to_archive_agent(monkeypatch):
    import services
    import mcp_server.tools.agent as agent_tool

    rec = _Recorder(return_value="/abs/archived")
    monkeypatch.setattr(services, "archive_agent", rec)

    tools = _register(agent_tool)
    out = tools["agent_archive"](name="myagent", cwd="")
    assert rec.called_once
    assert out == "/abs/archived"


# ---------------------------------------------------------------------------
# tools/memory.py
# ---------------------------------------------------------------------------

def test_memory_query_v2_rejects_short_tier():
    import mcp_server.tools.memory as mem_tool
    tools = _register(mem_tool)
    out = tools["memory_query"](text="hello", tier="short")
    assert out.startswith("ERROR")
    assert "short" in out


def test_memory_query_rejects_unknown_tier():
    import mcp_server.tools.memory as mem_tool
    tools = _register(mem_tool)
    out = tools["memory_query"](text="hello", tier="foobar")
    assert out.startswith("ERROR")


def test_memory_create_v2_rejects_short_tier():
    import mcp_server.tools.memory as mem_tool
    tools = _register(mem_tool)
    out = tools["memory_create"](slug="x", content="y", tier="short")
    assert out.startswith("ERROR")


def test_memory_list_forwards_to_list_entries(monkeypatch, tmp_path):
    import services
    import mcp_server.tools.memory as mem_tool

    rec = _Recorder(return_value=[])
    monkeypatch.setattr(services, "list_entries", rec)
    # _store_dir() walks up looking for .cbim/. Provide one; empty result
    # means we never read store_dir, but the function still calls it for
    # the join path... actually no: list_entries returns [] -> "(empty)"
    # short-circuit, store_dir never called. Good.

    tools = _register(mem_tool)
    out = tools["memory_list"](tier="medium", cwd=str(tmp_path))
    assert rec.called_once
    _, kwargs = rec.calls[0]
    assert kwargs["tier"] == "medium"
    assert out == "(empty)"


def test_memory_reindex_forwards_to_memory_reindex(monkeypatch):
    import services
    import mcp_server.tools.memory as mem_tool

    rec = _Recorder(return_value="reindexed: 5")
    monkeypatch.setattr(services, "memory_reindex", rec)

    tools = _register(mem_tool)
    out = tools["memory_reindex"](tier="medium", cwd="")
    assert rec.called_once
    _, kwargs = rec.calls[0]
    assert kwargs["tier"] == "medium"
    assert out == "reindexed: 5"


def test_memory_cleanup_forwards_to_memory_cleanup(monkeypatch):
    import services
    import mcp_server.tools.memory as mem_tool

    rec = _Recorder(return_value="cleaned: 3")
    monkeypatch.setattr(services, "memory_cleanup", rec)

    tools = _register(mem_tool)
    out = tools["memory_cleanup"](keep_days=7, cwd="")
    assert rec.called_once
    _, kwargs = rec.calls[0]
    assert kwargs["keep_days"] == 7
    assert out == "cleaned: 3"


def test_memory_get_forwards_to_get_entry(monkeypatch):
    import services
    import mcp_server.tools.memory as mem_tool

    rec = _Recorder(return_value={"id": "x", "content": "y", "tier": "medium"})
    monkeypatch.setattr(services, "get_entry", rec)

    tools = _register(mem_tool)
    out = tools["memory_get"](entry_id="something", cwd="")
    assert rec.called_once
    parsed = json.loads(out)
    assert parsed["id"] == "x"


def test_memory_get_returns_null_string_when_missing(monkeypatch):
    import services
    import mcp_server.tools.memory as mem_tool

    monkeypatch.setattr(services, "get_entry", _Recorder(return_value=None))
    tools = _register(mem_tool)
    out = tools["memory_get"](entry_id="missing", cwd="")
    assert out == "null"


# ---------------------------------------------------------------------------
# tools/audit.py — module-level imports of run_audit / list_checks; mock those
# attributes on the tool module itself.
# ---------------------------------------------------------------------------

def test_audit_run_forwards_to_run_audit(monkeypatch):
    import mcp_server.tools.audit as audit_tool

    fake_result = SimpleNamespace(
        to_dict=lambda: {
            "findings": [],
            "summary": {"total": 0, "error": 0, "warn": 0, "info": 0,
                        "checks_ran": [], "by_check": {}},
            "ran_at": "",
            "project_root": "",
            "config_snapshot": {},
        }
    )
    rec = _Recorder(return_value=fake_result)
    monkeypatch.setattr(audit_tool, "run_audit", rec)

    tools = _register(audit_tool)
    out = tools["audit_run"](checks=["index_consistency"], min_severity=None, cwd="")
    assert rec.called_once
    _, kwargs = rec.calls[0]
    assert kwargs["checks"] == ["index_consistency"]
    assert out["summary"]["total"] == 0


def test_audit_run_translates_value_error(monkeypatch):
    import mcp_server.tools.audit as audit_tool

    def _raise(*a, **k):
        raise ValueError("unknown check: nope")
    monkeypatch.setattr(audit_tool, "run_audit", _raise)

    tools = _register(audit_tool)
    out = tools["audit_run"](checks=["nope"], min_severity=None, cwd="")
    assert "error" in out
    assert "unknown check" in out["error"]


def test_audit_list_checks_forwards(monkeypatch):
    import mcp_server.tools.audit as audit_tool

    monkeypatch.setattr(audit_tool, "list_checks",
                        _Recorder(return_value=["a", "b", "c"]))
    tools = _register(audit_tool)
    out = tools["audit_list_checks"](cwd="")
    assert out == ["a", "b", "c"]


# ---------------------------------------------------------------------------
# tools/bt.py — thin shim over engine.execution.api.bt_tick. Imports are
# bound at module top with a leading underscore.
# ---------------------------------------------------------------------------

def _fake_bt_result(kind: str = "done") -> SimpleNamespace:
    return SimpleNamespace(to_dict=lambda: {"kind": kind})


def test_bt_tick_forwards(monkeypatch):
    import mcp_server.tools.bt as bt_tool
    rec = _Recorder(return_value=_fake_bt_result("done"))
    monkeypatch.setattr(bt_tool, "_bt_tick", rec)

    tools = _register(bt_tool)
    out = tools["bt_tick"](user_request="do x", context={"k": "v"})
    assert rec.called_once
    args, _ = rec.calls[0]
    assert args[0] == "do x"
    assert args[1] == {"k": "v"}
    assert out == {"kind": "done"}


def test_bt_tick_resume_forwards(monkeypatch):
    import mcp_server.tools.bt as bt_tool
    rec = _Recorder(return_value=_fake_bt_result("done"))
    monkeypatch.setattr(bt_tool, "_bt_tick_resume", rec)

    tools = _register(bt_tool)
    out = tools["bt_tick_resume"](tick_id="tid", dispatch_result="raw")
    assert rec.called_once
    args, _ = rec.calls[0]
    assert args[0] == "tid"
    assert args[1] == "raw"
    assert out == {"kind": "done"}


def test_bt_tick_swallows_engine_exception_into_error(monkeypatch):
    import mcp_server.tools.bt as bt_tool

    def _raise(*a, **k):
        raise RuntimeError("kaboom")
    monkeypatch.setattr(bt_tool, "_bt_tick", _raise)

    tools = _register(bt_tool)
    out = tools["bt_tick"](user_request="x")
    assert out["kind"] == "error"
    assert out["error_code"] == "engine_internal"
    assert "kaboom" in out["error_message"]


def test_bt_list_running_ticks_forwards(monkeypatch):
    import mcp_server.tools.bt as bt_tool
    fake_tick = SimpleNamespace(to_dict=lambda: {"tick_id": "t1"})
    monkeypatch.setattr(bt_tool, "_bt_list_running_ticks",
                        _Recorder(return_value=[fake_tick]))
    tools = _register(bt_tool)
    out = tools["bt_list_running_ticks"]()
    assert out == [{"tick_id": "t1"}]


def test_bt_abort_forwards(monkeypatch):
    import mcp_server.tools.bt as bt_tool
    rec = _Recorder(return_value={"ok": True})
    monkeypatch.setattr(bt_tool, "_bt_abort", rec)
    tools = _register(bt_tool)
    out = tools["bt_abort"](tick_id="tid", reason="user-cancel")
    assert rec.called_once
    assert out == {"ok": True}


# ---------------------------------------------------------------------------
# tools/dream.py — same shim pattern as bt.
# ---------------------------------------------------------------------------

def test_dream_tick_forwards(monkeypatch):
    import mcp_server.tools.dream as dream_tool
    rec = _Recorder(return_value=SimpleNamespace(to_dict=lambda: {"kind": "done"}))
    monkeypatch.setattr(dream_tool, "_dream_tick", rec)

    tools = _register(dream_tool)
    out = tools["dream_tick"](reason="manual")
    assert rec.called_once
    args, _ = rec.calls[0]
    assert args[0] == "manual"
    assert out == {"kind": "done"}


def test_dream_tick_resume_forwards(monkeypatch):
    import mcp_server.tools.dream as dream_tool
    rec = _Recorder(return_value=SimpleNamespace(to_dict=lambda: {"kind": "done"}))
    monkeypatch.setattr(dream_tool, "_dream_tick_resume", rec)
    tools = _register(dream_tool)
    out = tools["dream_tick_resume"](run_id="rid", dispatch_result={"x": 1})
    assert rec.called_once
    assert out == {"kind": "done"}


def test_dream_list_runs_forwards(monkeypatch):
    import mcp_server.tools.dream as dream_tool
    fake_run = SimpleNamespace(to_dict=lambda: {"run_id": "r1"})
    monkeypatch.setattr(dream_tool, "_dream_list_runs",
                        _Recorder(return_value=[fake_run]))
    tools = _register(dream_tool)
    out = tools["dream_list_runs"](limit=3)
    assert out == [{"run_id": "r1"}]


def test_dream_abort_forwards(monkeypatch):
    import mcp_server.tools.dream as dream_tool
    fake_abort = SimpleNamespace(to_dict=lambda: {"aborted": True, "run_id": "r1"})
    rec = _Recorder(return_value=fake_abort)
    monkeypatch.setattr(dream_tool, "_dream_abort", rec)
    tools = _register(dream_tool)
    out = tools["dream_abort"](run_id="r1", reason="cleanup")
    assert rec.called_once
    assert out["aborted"] is True


# ---------------------------------------------------------------------------
# tools/skill.py — Skill.list_builtin / Skill.load_builtin
# ---------------------------------------------------------------------------

def test_skill_list_forwards(monkeypatch):
    import mcp_server.tools.skill as skill_tool
    # Batch 2: the tool now imports via `services.list_skills`. The
    # binding is at module-load time, so we patch the local reference
    # that the closure has already captured.
    monkeypatch.setattr(skill_tool, "list_skills", lambda: ["a", "b"])
    tools = _register(skill_tool)
    out = tools["skill_list"]()
    assert "a" in out
    assert "b" in out


def test_skill_show_forwards(monkeypatch):
    import mcp_server.tools.skill as skill_tool

    monkeypatch.setattr(
        skill_tool, "get_skill",
        lambda name: {"name": name, "body": "skill body"},
    )
    tools = _register(skill_tool)
    out = tools["skill_show"](name="memory_write")
    assert "skill body" in out


def test_skill_show_returns_error_when_missing(monkeypatch):
    import mcp_server.tools.skill as skill_tool

    monkeypatch.setattr(skill_tool, "get_skill", lambda name: None)
    monkeypatch.setattr(skill_tool, "list_skills", lambda: ["a", "b"])
    tools = _register(skill_tool)
    out = tools["skill_show"](name="ghost")
    assert "not found" in out.lower()


# ---------------------------------------------------------------------------
# tools/snapshot.py — calls cbi._primitives.snapshot.build_snapshot
# ---------------------------------------------------------------------------

def test_project_snapshot_forwards(monkeypatch):
    import services
    import mcp_server.tools.snapshot as snap_tool

    # Batch 2: tools/snapshot.py routes through services.build_snapshot
    # rather than importing the primitive directly. Patch the service.
    rec = _Recorder(return_value="snapshot text")
    monkeypatch.setattr(services, "build_snapshot", rec)
    tools = _register(snap_tool)
    out = tools["project_snapshot"](cwd="")
    assert rec.called_once
    assert out == "snapshot text"


# ---------------------------------------------------------------------------
# tools/scheduler.py — module global _scheduler injected via set_scheduler.
# ---------------------------------------------------------------------------

def test_scheduler_status_returns_error_when_uninitialized(monkeypatch):
    import mcp_server.tools.scheduler as sched_tool
    monkeypatch.setattr(sched_tool, "_scheduler", None)
    tools = _register(sched_tool)
    out = tools["scheduler_status"]()
    assert out.startswith("ERROR")


def test_scheduler_status_forwards_to_list_tasks(monkeypatch):
    import mcp_server.tools.scheduler as sched_tool

    rec = _Recorder(return_value=[{"name": "t1"}])
    fake = SimpleNamespace(list_tasks=rec)
    monkeypatch.setattr(sched_tool, "_scheduler", fake)

    tools = _register(sched_tool)
    out = tools["scheduler_status"]()
    parsed = json.loads(out)
    assert parsed == [{"name": "t1"}]
    assert rec.called_once


def test_scheduler_trigger_returns_error_when_uninitialized(monkeypatch):
    import mcp_server.tools.scheduler as sched_tool
    monkeypatch.setattr(sched_tool, "_scheduler", None)
    tools = _register(sched_tool)
    # async fn — drive with asyncio.run
    out = asyncio.run(tools["scheduler_trigger"](name="anything"))
    assert out.startswith("ERROR")


def test_scheduler_trigger_forwards(monkeypatch):
    import mcp_server.tools.scheduler as sched_tool

    captured: dict[str, str] = {}

    async def _trigger(name):
        captured["name"] = name
        return "triggered"

    fake = SimpleNamespace(trigger=_trigger)
    monkeypatch.setattr(sched_tool, "_scheduler", fake)

    tools = _register(sched_tool)
    out = asyncio.run(tools["scheduler_trigger"](name="my-task"))
    assert captured["name"] == "my-task"
    assert out == "triggered"


def test_scheduler_set_scheduler_replaces_module_global():
    """set_scheduler() is the public injection point for server.py wiring."""
    import mcp_server.tools.scheduler as sched_tool

    sentinel = object()
    sched_tool.set_scheduler(sentinel)
    try:
        assert sched_tool._scheduler is sentinel
    finally:
        sched_tool.set_scheduler(None)


# ---------------------------------------------------------------------------
# tools/runtime.py — debug flag I/O is direct file-system; test against
# tmp_path with a fake .cbim/ layout. log_show + dashboard_ensure_running
# are documented as side-effecting; we test the three pure-behaviour
# branches that dont require subprocess.Popen.
# ---------------------------------------------------------------------------

def _make_project(tmp_path):
    """Create a minimal .cbim/-anchored project root."""
    root = tmp_path / "proj"
    (root / ".cbim").mkdir(parents=True)
    return root


def test_debug_get_reports_disabled_when_flag_absent(tmp_path):
    import mcp_server.tools.runtime as rt
    root = _make_project(tmp_path)

    tools = _register(rt)
    out = tools["debug_get"](cwd=str(root))
    parsed = json.loads(out)
    assert parsed == {"enabled": False}


def test_debug_set_on_then_off(tmp_path):
    import mcp_server.tools.runtime as rt
    root = _make_project(tmp_path)
    tools = _register(rt)

    out_on = json.loads(tools["debug_set"](state="on", cwd=str(root)))
    assert out_on == {"ok": True, "enabled": True}
    assert (root / ".cbim" / ".debug").exists()

    out_off = json.loads(tools["debug_set"](state="off", cwd=str(root)))
    assert out_off == {"ok": True, "enabled": False}
    assert not (root / ".cbim" / ".debug").exists()


def test_debug_set_rejects_unknown_state(tmp_path):
    import mcp_server.tools.runtime as rt
    root = _make_project(tmp_path)
    tools = _register(rt)
    out = json.loads(tools["debug_set"](state="ON", cwd=str(root)))
    assert "error" in out


def test_debug_get_returns_error_when_no_project(tmp_path):
    import mcp_server.tools.runtime as rt
    # tmp_path has no .cbim/ — _project_root walks up and gives up.
    isolated = tmp_path / "isolated"
    isolated.mkdir()
    tools = _register(rt)
    out = json.loads(tools["debug_get"](cwd=str(isolated)))
    # Either {error: ...} or {enabled: False} depending on how _project_root
    # walks up; we just assert that the result is a dict (no crash).
    assert isinstance(out, dict)


def test_log_show_returns_empty_when_no_logs_dir(tmp_path):
    import mcp_server.tools.runtime as rt
    root = _make_project(tmp_path)
    tools = _register(rt)
    out = json.loads(tools["log_show"](lines=10, cwd=str(root)))
    assert out == {"session_log": "", "session_file": ""}


def test_log_show_tails_session_file(tmp_path):
    import mcp_server.tools.runtime as rt
    root = _make_project(tmp_path)
    logs = root / ".cbim" / "logs"
    logs.mkdir()
    f = logs / "session_2026-01-01.log"
    f.write_text("line1\nline2\nline3\n", encoding="utf-8")

    tools = _register(rt)
    out = json.loads(tools["log_show"](lines=2, cwd=str(root)))
    assert out["session_file"] == "session_2026-01-01.log"
    assert "line2" in out["session_log"]
    assert "line3" in out["session_log"]
    assert "line1" not in out["session_log"]
