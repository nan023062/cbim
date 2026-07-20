"""Scheduler-template rendering by `project.sync.sync_scheduler_templates`.

Covers:
- Windows path: three files rendered (ps1, xml, README) with placeholders
  substituted from `{{project_root}}`, `{{trigger_script_abs}}`,
  `{{trigger_time}}`.
- Non-Windows path: only the README is rendered.
- trigger_time override via `.cbim/config.json.scheduler.dream_trigger_time`
  flows into the XML.
- Idempotent overwrite: running twice yields byte-identical output.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from project import sync as _sync


def _make_project(tmp_path: Path, *, trigger_time: str | None = None) -> Path:
    """Build a minimal project layout: .cbim/config.json only."""
    (tmp_path / ".cbim").mkdir(parents=True, exist_ok=True)
    cfg: dict = {"dashboard": {"port": 8765}}
    if trigger_time is not None:
        cfg["scheduler"] = {"dream_trigger_time": trigger_time}
    (tmp_path / ".cbim" / "config.json").write_text(
        json.dumps(cfg, indent=2), encoding="utf-8"
    )
    return tmp_path


def test_windows_render_all_three(tmp_path, monkeypatch):
    monkeypatch.setattr(_sync.sys, "platform", "win32")
    root = _make_project(tmp_path)

    actions = _sync.sync_scheduler_templates(root)

    tools = root / ".cbim" / "scheduler" / "tools"
    ps1 = tools / "dream_trigger.ps1"
    xml = tools / "win_dream_task.xml"
    readme = tools / "README.md"

    assert ps1.is_file()
    assert xml.is_file()
    assert readme.is_file()

    # Placeholder substitution happened.
    ps1_text = ps1.read_text(encoding="utf-8")
    assert "{{project_root}}" not in ps1_text
    assert str(root.resolve()) in ps1_text

    xml_text = xml.read_text(encoding="utf-8")
    assert "{{trigger_script_abs}}" not in xml_text
    assert "{{trigger_time}}" not in xml_text
    assert str(ps1.resolve()) in xml_text
    # Default trigger_time.
    assert "03:30" in xml_text

    # actions summary references each rendered file.
    joined = " ".join(actions)
    assert "dream_trigger.ps1" in joined
    assert "win_dream_task.xml" in joined
    assert "README.md" in joined


def test_non_windows_renders_readme_only(tmp_path, monkeypatch):
    monkeypatch.setattr(_sync.sys, "platform", "linux")
    root = _make_project(tmp_path)

    _sync.sync_scheduler_templates(root)

    tools = root / ".cbim" / "scheduler" / "tools"
    assert (tools / "README.md").is_file()
    assert not (tools / "dream_trigger.ps1").exists()
    assert not (tools / "win_dream_task.xml").exists()


def test_trigger_time_override_flows_into_xml(tmp_path, monkeypatch):
    monkeypatch.setattr(_sync.sys, "platform", "win32")
    root = _make_project(tmp_path, trigger_time="04:15")

    _sync.sync_scheduler_templates(root)

    xml_text = (
        root / ".cbim" / "scheduler" / "tools" / "win_dream_task.xml"
    ).read_text(encoding="utf-8")
    assert "04:15" in xml_text
    assert "03:30" not in xml_text


def test_missing_config_json_falls_back_to_default_trigger_time(tmp_path, monkeypatch):
    monkeypatch.setattr(_sync.sys, "platform", "win32")
    # No .cbim/config.json at all.
    root = tmp_path
    (root / ".cbim").mkdir(parents=True)

    _sync.sync_scheduler_templates(root)

    xml_text = (
        root / ".cbim" / "scheduler" / "tools" / "win_dream_task.xml"
    ).read_text(encoding="utf-8")
    assert "03:30" in xml_text


def test_render_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setattr(_sync.sys, "platform", "win32")
    root = _make_project(tmp_path)

    _sync.sync_scheduler_templates(root)
    tools = root / ".cbim" / "scheduler" / "tools"
    ps1_first = (tools / "dream_trigger.ps1").read_text(encoding="utf-8")
    xml_first = (tools / "win_dream_task.xml").read_text(encoding="utf-8")

    _sync.sync_scheduler_templates(root)
    ps1_second = (tools / "dream_trigger.ps1").read_text(encoding="utf-8")
    xml_second = (tools / "win_dream_task.xml").read_text(encoding="utf-8")

    assert ps1_first == ps1_second
    assert xml_first == xml_second


def test_ps1_carries_allowed_tool_whitelist(tmp_path, monkeypatch):
    monkeypatch.setattr(_sync.sys, "platform", "win32")
    root = _make_project(tmp_path)
    _sync.sync_scheduler_templates(root)

    ps1_text = (
        root / ".cbim" / "scheduler" / "tools" / "dream_trigger.ps1"
    ).read_text(encoding="utf-8")

    for tool in (
        "mcp__cbim__dream_tick",
        "mcp__cbim__dream_tick_resume",
        "mcp__cbim__dream_abort",
        "mcp__cbim__dream_list_runs",
        "Task",
    ):
        assert tool in ps1_text, f"{tool} not in the rendered whitelist"
    assert "--dangerously-skip-permissions" not in ps1_text
