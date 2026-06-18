"""Bug-fix regression: `cbim dna edit ...` (CLI) MUST reindex the module.

Pre-Batch-1 history
-------------------
The retrieval index reindex side-effect was inlined into
`mcp_server.tools.dna._safe_reindex_dna` and only the MCP tool wrappers
called it; the CLI handler `_handle_dna_edit` (engine/cli.py) went
straight to `services.edit_module` without any reindex step. Editing a
module from the CLI therefore left the retrieval index stale until the
next manual `cbim dna reindex` or dream-loop pass.

Fix (Batch 1)
-------------
The reindex helper moved into `services._reindex` and is invoked
*inside* the service write functions (`init_module`, `edit_module`,
`split_module`, `write_doc`, `write_section`). Both CLI and MCP routes
share that single inline reindex now — the CLI bug fixes itself
automatically once the duplication is eliminated.

This test pins the contract: drive the CLI handler with a real
`tmp_path`-anchored project, monkeypatch `services._reindex.reindex_dna`
to record calls, and assert it fired exactly once with the right args.
"""
from __future__ import annotations

import argparse
from pathlib import Path


def _make_project(tmp_path: Path) -> Path:
    """Minimal CBIM project with one .dna/ module ready to edit."""
    root = tmp_path / "proj"
    (root / ".cbim").mkdir(parents=True)
    (root / ".cbim" / "config.json").write_text("{}", encoding="utf-8")
    mod = root / "src" / "foo"
    (mod / ".dna").mkdir(parents=True)
    (mod / ".dna" / "module.md").write_text(
        "---\nname: Foo\nowner: platform\ndescription: x\n"
        "keywords: []\nstatus: implemented\n---\n## Positioning\nold body\n",
        encoding="utf-8",
    )
    return root


def _edit_ns(module_path: str, **kw) -> argparse.Namespace:
    defaults = dict(
        target="body", field=None, value=None, value_list=None, clear=False,
        content="new body", content_file=None, stdin=False,
        heading=None, level=2, mode=None, name=None,
        create_if_missing=False, insert_after=None, insert_at_top=False,
        dry_run=False, module_path=module_path,
    )
    defaults.update(kw)
    return argparse.Namespace(**defaults)


def test_cli_dna_edit_triggers_reindex(tmp_path, monkeypatch):
    """`cbim dna edit --target body ...` from the CLI must reindex the module.

    The pre-Batch-1 CLI handler skipped reindex entirely; this test would
    have failed against that code (zero recorded calls). After the
    Batch-1 service-internal reindex, the handler still doesn't call
    reindex itself — but the service it calls does, which is the whole
    point of consolidating the side-effect into the service layer.
    """
    from engine.cli import _handle_dna_edit
    from services import _reindex

    root = _make_project(tmp_path)
    mod_dir = root / "src" / "foo"

    calls: list[tuple[Path, Path]] = []

    def _record(r: Path, m: Path) -> None:
        calls.append((Path(r), Path(m)))

    monkeypatch.setattr(_reindex, "reindex_dna", _record)
    monkeypatch.chdir(root)

    rc = _handle_dna_edit(_edit_ns(str(mod_dir)))
    assert rc == 0, "CLI handler returned non-zero"

    # The body was actually written — sanity check.
    saved = (mod_dir / ".dna" / "module.md").read_text(encoding="utf-8")
    assert "new body" in saved

    # The bug-fix contract: exactly one reindex call, against the module dir.
    assert len(calls) == 1, (
        f"expected exactly one reindex call from the CLI edit path, got {len(calls)}: {calls}"
    )
    recorded_root, recorded_mod = calls[0]
    assert recorded_root.resolve() == root.resolve()
    assert recorded_mod.resolve() == mod_dir.resolve()
