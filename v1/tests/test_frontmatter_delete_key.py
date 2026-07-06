"""Bug-fix regression: `dna_edit(target='frontmatter')` and
`agent_update(target='frontmatter')` support a `delete: True` payload
variant that removes the key entirely (instead of setting it to an
empty value, which leaves the key present).

Coverage
--------
Service layer (`services.knowledge_service.edit_module`,
`services.agent_service.update_agent`):
  - Delete an optional module field (e.g. ``links``) succeeds; reload
    shows the key absent.
  - Delete a required module field raises ``ValueError`` naming the
    required set.
  - Delete a key that is not currently in frontmatter raises
    ``LookupError``.
  - ``delete=True`` combined with ``value`` or ``value_list`` raises
    ``ValueError`` (three-way mutex).
  - Providing none of ``value`` / ``value_list`` / ``delete`` raises
    ``ValueError``.
  - ``update_agent`` accepts ``delete=True`` for ``tools`` only —
    ``description`` / ``model`` deletes are refused.

CLI layer (`engine.cli._build_dna_edit_payload`,
`engine.cli._build_agent_update_payload`):
  - ``--delete-key`` produces ``{"field": ..., "delete": True}``.
  - ``--delete-key`` is mutually exclusive with the other verbs.

End-to-end (CLI handler → service → on-disk file):
  - ``cbim dna edit --target frontmatter --field links --delete-key``
    against a real ``tmp_path`` project drops the key from the saved
    ``module.md``.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import pytest

from engine.cli import (
    _build_agent_update_payload,
    _build_dna_edit_payload,
)
from services import edit_module, scaffold_agent, update_agent
from services._fm import parse_frontmatter


# ---------------------------------------------------------------------------
# Helpers (copied from test_dna_edit_clear_and_position.py style)
# ---------------------------------------------------------------------------

def _dna_ns(**kw) -> argparse.Namespace:
    """Namespace mirroring `cbim dna edit`'s argparse defaults."""
    defaults = dict(
        target=None, field=None, value=None, value_list=None,
        value_list_json=None, clear=False, delete_key=False,
        content=None, content_file=None, stdin=False,
        heading=None, level=2, mode=None, name=None,
        create_if_missing=False, insert_after=None, insert_at_top=False,
        dry_run=False, module_path="dummy",
    )
    defaults.update(kw)
    return argparse.Namespace(**defaults)


def _agent_ns(**kw) -> argparse.Namespace:
    defaults = dict(
        target=None, field=None, value=None, value_list=None,
        clear=False, delete_key=False,
        content=None, content_file=None, stdin=False,
        heading=None, level=2, mode=None,
        create_if_missing=False, insert_after=None, insert_at_top=False,
        dry_run=False, name="dummy",
    )
    defaults.update(kw)
    return argparse.Namespace(**defaults)


def _make_project(tmp_path: Path) -> Path:
    (tmp_path / ".cbim").mkdir()
    (tmp_path / ".cbim" / "config.json").write_text("{}", encoding="utf-8")
    (tmp_path / ".dna").mkdir()
    (tmp_path / ".dna" / "module.md").write_text(
        "---\nname: root\nowner: arch\ndescription: rt\n"
        "keywords: []\nstatus: implemented\n---\n\n## Positioning\n\nroot\n",
        encoding="utf-8",
    )
    (tmp_path / "index.md").write_text("# Index\n", encoding="utf-8")
    return tmp_path


def _make_module(root: Path, rel: str) -> Path:
    mod = root / rel
    (mod / ".dna").mkdir(parents=True)
    (mod / ".dna" / "module.md").write_text(
        f"---\nname: {rel}\nowner: arch\ndescription: x\n"
        f"keywords: []\nstatus: implemented\n---\n\n## Positioning\n\nbody\n",
        encoding="utf-8",
    )
    return mod


# ---------------------------------------------------------------------------
# Service layer — edit_module frontmatter delete
# ---------------------------------------------------------------------------

def test_service_delete_optional_module_field_round_trip(tmp_path):
    """Round-trip: pre-populate `links`, delete it, key must be absent on reload."""
    root = _make_project(tmp_path)
    mod = _make_module(root, "mymod")
    # Pre-populate with a `links` entry so we have something to delete.
    edit_module(
        mod, "frontmatter",
        {"field": "links",
         "value_list": [{"kind": "local", "target": "src"}]},
        cwd=str(root),
    )
    # Sanity: the key is present after set.
    fm_before = parse_frontmatter(
        (mod / ".dna" / "module.md").read_text(encoding="utf-8")
    )
    assert "links" in fm_before

    edit_module(
        mod, "frontmatter",
        {"field": "links", "delete": True},
        cwd=str(root),
    )

    fm_after = parse_frontmatter(
        (mod / ".dna" / "module.md").read_text(encoding="utf-8")
    )
    assert "links" not in fm_after
    # The other frontmatter keys are untouched.
    for k in ("name", "owner", "description", "keywords", "status"):
        assert k in fm_after


def test_service_delete_required_module_field_raises(tmp_path):
    """Deleting one of {name, owner, description, keywords, status} refused."""
    root = _make_project(tmp_path)
    mod = _make_module(root, "mymod")
    for required in ("name", "owner", "description", "keywords", "status"):
        with pytest.raises(ValueError, match="required"):
            edit_module(
                mod, "frontmatter",
                {"field": required, "delete": True},
                cwd=str(root),
            )


def test_service_delete_absent_module_field_raises_lookuperror(tmp_path):
    """Deleting a key that is not in the current frontmatter raises LookupError."""
    root = _make_project(tmp_path)
    mod = _make_module(root, "mymod")
    # `links` was never set on this module.
    with pytest.raises(LookupError, match="not present"):
        edit_module(
            mod, "frontmatter",
            {"field": "links", "delete": True},
            cwd=str(root),
        )


def test_service_delete_module_mutex_with_value(tmp_path):
    root = _make_project(tmp_path)
    mod = _make_module(root, "mymod")
    with pytest.raises(ValueError, match="mutually exclusive"):
        edit_module(
            mod, "frontmatter",
            {"field": "keywords", "value": "x", "delete": True},
            cwd=str(root),
        )


def test_service_delete_module_mutex_with_value_list(tmp_path):
    root = _make_project(tmp_path)
    mod = _make_module(root, "mymod")
    with pytest.raises(ValueError, match="mutually exclusive"):
        edit_module(
            mod, "frontmatter",
            {"field": "keywords", "value_list": ["x"], "delete": True},
            cwd=str(root),
        )


def test_service_module_none_of_three_verbs_raises(tmp_path):
    """`{field: X}` alone (no value / value_list / delete) is invalid."""
    root = _make_project(tmp_path)
    mod = _make_module(root, "mymod")
    with pytest.raises(ValueError, match="one of"):
        edit_module(
            mod, "frontmatter",
            {"field": "keywords"},
            cwd=str(root),
        )


# ---------------------------------------------------------------------------
# Service layer — update_agent frontmatter delete
# ---------------------------------------------------------------------------

def _bootstrap_agent(root: Path, name: str) -> Path:
    """Scaffold an agent under `<root>/.claude/agents/<name>/`."""
    (root / ".cbim").mkdir(exist_ok=True)
    (root / ".cbim" / "config.json").write_text("{}", encoding="utf-8")
    scaffold_agent(name, description="tester", cwd=str(root))
    return root / ".claude" / "agents" / name / f"{name}.md"


def test_service_delete_agent_tools_round_trip(tmp_path):
    """Deleting `tools` on an agent removes the key from frontmatter."""
    md = _bootstrap_agent(tmp_path, "worker")
    # Sanity: scaffolded agents carry a default `tools` string.
    fm_before = parse_frontmatter(md.read_text(encoding="utf-8"))
    assert "tools" in fm_before

    update_agent("worker", "frontmatter",
                 {"field": "tools", "delete": True},
                 cwd=str(tmp_path))

    fm_after = parse_frontmatter(md.read_text(encoding="utf-8"))
    assert "tools" not in fm_after
    # description / model remain, so the agent stays addressable.
    assert "description" in fm_after
    assert "model" in fm_after


def test_service_delete_agent_description_refused(tmp_path):
    _bootstrap_agent(tmp_path, "worker")
    with pytest.raises(ValueError, match="cannot be deleted"):
        update_agent("worker", "frontmatter",
                     {"field": "description", "delete": True},
                     cwd=str(tmp_path))


def test_service_delete_agent_model_refused(tmp_path):
    _bootstrap_agent(tmp_path, "worker")
    with pytest.raises(ValueError, match="cannot be deleted"):
        update_agent("worker", "frontmatter",
                     {"field": "model", "delete": True},
                     cwd=str(tmp_path))


def test_service_delete_agent_absent_tools_raises_lookuperror(tmp_path):
    """Second consecutive delete raises LookupError (key already gone)."""
    _bootstrap_agent(tmp_path, "worker")
    update_agent("worker", "frontmatter",
                 {"field": "tools", "delete": True},
                 cwd=str(tmp_path))
    with pytest.raises(LookupError, match="not present"):
        update_agent("worker", "frontmatter",
                     {"field": "tools", "delete": True},
                     cwd=str(tmp_path))


def test_service_delete_agent_mutex_with_value(tmp_path):
    _bootstrap_agent(tmp_path, "worker")
    with pytest.raises(ValueError, match="mutually exclusive"):
        update_agent("worker", "frontmatter",
                     {"field": "tools", "value": "x", "delete": True},
                     cwd=str(tmp_path))


def test_service_agent_none_of_three_verbs_raises(tmp_path):
    _bootstrap_agent(tmp_path, "worker")
    with pytest.raises(ValueError, match="one of"):
        update_agent("worker", "frontmatter",
                     {"field": "tools"},
                     cwd=str(tmp_path))


# ---------------------------------------------------------------------------
# CLI payload builders — --delete-key wiring
# ---------------------------------------------------------------------------

def test_dna_delete_key_produces_delete_payload():
    payload = _build_dna_edit_payload(
        _dna_ns(target="frontmatter", field="links", delete_key=True),
        "frontmatter",
    )
    assert payload == {"field": "links", "delete": True}


def test_dna_delete_key_mutex_with_value():
    with pytest.raises(ValueError, match="mutually exclusive"):
        _build_dna_edit_payload(
            _dna_ns(target="frontmatter", field="links",
                    value="x", delete_key=True),
            "frontmatter",
        )


def test_dna_delete_key_mutex_with_value_list():
    with pytest.raises(ValueError, match="mutually exclusive"):
        _build_dna_edit_payload(
            _dna_ns(target="frontmatter", field="links",
                    value_list=["x"], delete_key=True),
            "frontmatter",
        )


def test_dna_delete_key_mutex_with_clear():
    with pytest.raises(ValueError, match="mutually exclusive"):
        _build_dna_edit_payload(
            _dna_ns(target="frontmatter", field="keywords",
                    clear=True, delete_key=True),
            "frontmatter",
        )


def test_agent_delete_key_produces_delete_payload():
    payload = _build_agent_update_payload(
        _agent_ns(target="frontmatter", field="tools", delete_key=True),
        "frontmatter",
    )
    assert payload == {"field": "tools", "delete": True}


def test_agent_delete_key_mutex_with_value():
    with pytest.raises(ValueError, match="mutually exclusive"):
        _build_agent_update_payload(
            _agent_ns(target="frontmatter", field="tools",
                      value="x", delete_key=True),
            "frontmatter",
        )


# ---------------------------------------------------------------------------
# End-to-end CLI handler — `cbim dna edit --delete-key`
# ---------------------------------------------------------------------------

def test_cli_dna_edit_delete_key_end_to_end(tmp_path, monkeypatch):
    """Exercise the CLI handler with a real project; the key must land absent."""
    from engine.cli import _handle_dna_edit
    from services import _reindex

    root = _make_project(tmp_path)
    mod = _make_module(root, "mymod")
    # Pre-populate `links` so there's something to delete.
    edit_module(
        mod, "frontmatter",
        {"field": "links",
         "value_list": [{"kind": "local", "target": "src"}]},
        cwd=str(root),
    )

    monkeypatch.setattr(_reindex, "reindex_dna", lambda *_a, **_k: None)
    monkeypatch.chdir(root)

    ns = _dna_ns(
        target="frontmatter", field="links", delete_key=True,
        module_path=str(mod),
    )
    rc = _handle_dna_edit(ns)
    assert rc == 0

    fm = parse_frontmatter(
        (mod / ".dna" / "module.md").read_text(encoding="utf-8")
    )
    assert "links" not in fm
