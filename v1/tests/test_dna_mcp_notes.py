"""MCP-surface tests for the note-aware behaviour of ``dna_edit`` /
``dna_show``.

Service-layer note lifecycle (create/update/delete + frontmatter/slug
validation) is exhaustively covered by ``test_dna_edit_note_lifecycle``.
This suite exercises only the MCP thin-shell contract:

  * ``dna_edit(target="note", …)`` passes the payload verbatim through to
    ``services.edit_module`` and reflects the resulting on-disk state.
  * ``dna_edit`` translates ``FileExistsError`` from a duplicate-create
    into an ``ERROR:`` string (previously it propagated uncaught — this
    aligns the surface with ``dna_init``).
  * ``dna_show`` grows a compact ``Notes       :`` summary line whenever
    notes exist (regardless of the new ``include_notes`` flag), preserves
    every existing line byte-for-byte otherwise, and expands note bodies
    only when ``include_notes=True``.
"""

from __future__ import annotations

from pathlib import Path


# ---------------------------------------------------------------------------
# Local FakeMCP — same shape as test_mcp_tools_thin_shell / test_path_guard
# so the two harnesses stay drop-in interchangeable.
# ---------------------------------------------------------------------------

class _FakeMCP:
    def __init__(self) -> None:
        self.tools: dict = {}

    def tool(self, *_args, **_kwargs):
        def deco(fn):
            self.tools[fn.__name__] = fn
            return fn
        return deco


def _register_dna(monkeypatch, root: Path) -> dict:
    import mcp_server.tools.dna as dna_tool
    fake = _FakeMCP()
    dna_tool.register(fake)
    # Short-circuit `context.project_root(cwd or None)` — every dna_* tool
    # calls it before invoking services. The test root already carries a
    # `.cbim/` marker but this keeps the resolution deterministic across
    # tmp_path layouts.
    monkeypatch.setattr(dna_tool, "project_root", lambda *_a, **_kw: root)
    return fake.tools


def _make_project(tmp_path: Path) -> tuple[Path, Path]:
    """Root with one child module ``src/foo``. Mirrors the fixture used by
    ``test_dna_edit_note_lifecycle`` so any failure diff is comparable."""
    root = tmp_path / "proj"
    (root / ".cbim").mkdir(parents=True)
    (root / ".cbim" / "config.json").write_text("{}", encoding="utf-8")
    (root / ".cbim" / "index.md").write_text(
        "# Module Index\n\n- src/foo\n", encoding="utf-8"
    )
    mod = root / "src" / "foo"
    (mod / ".dna").mkdir(parents=True)
    (mod / ".dna" / "module.md").write_text(
        "---\n"
        "name: Foo\n"
        "owner: platform\n"
        "description: a foo\n"
        "keywords: []\n"
        "status: implemented\n"
        "---\n"
        "## Positioning\n\nfoo positioning\n",
        encoding="utf-8",
    )
    return root, mod


def _fm(**overrides) -> dict:
    base = {
        "title": "Sample Note",
        "intent": "rationale",
        "keywords": ["alpha", "beta"],
        "related_modules": ["src/foo"],
        "status": "draft",
        "last_reviewed": "2026-07-09",
        "authors": ["architect"],
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# dna_edit(target="note") — thin passthrough
# ---------------------------------------------------------------------------

def test_dna_edit_note_create_writes_file(tmp_path, monkeypatch):
    root, mod = _make_project(tmp_path)
    tools = _register_dna(monkeypatch, root)

    result = tools["dna_edit"](
        module_path="src/foo",
        target="note",
        payload={
            "name": "why-single-file",
            "content": "# Why\n\nreason\n",
            "frontmatter": _fm(),
        },
        mode="replace",
        cwd=str(root),
    )
    note_path = mod / ".dna" / "notes" / "why-single-file.md"
    assert not result.startswith("ERROR:"), result
    assert Path(result).resolve() == note_path.resolve()
    assert note_path.is_file()
    raw = note_path.read_text(encoding="utf-8")
    assert "title: Sample Note" in raw
    assert "status: draft" in raw
    assert "# Why" in raw


def test_dna_edit_note_update_replaces_body(tmp_path, monkeypatch):
    root, mod = _make_project(tmp_path)
    tools = _register_dna(monkeypatch, root)

    tools["dna_edit"](
        module_path="src/foo", target="note",
        payload={"name": "n1", "content": "seed\n", "frontmatter": _fm()},
        mode="replace", cwd=str(root),
    )
    tools["dna_edit"](
        module_path="src/foo", target="note",
        payload={
            "name": "n1", "mode": "update",
            "content": "replaced body\n",
            "frontmatter": _fm(title="Renamed", status="reviewed"),
        },
        mode="replace", cwd=str(root),
    )
    raw = (mod / ".dna" / "notes" / "n1.md").read_text(encoding="utf-8")
    assert "replaced body" in raw
    assert "seed" not in raw
    assert "title: Renamed" in raw
    assert "status: reviewed" in raw


def test_dna_edit_note_delete_unlinks_file(tmp_path, monkeypatch):
    root, mod = _make_project(tmp_path)
    tools = _register_dna(monkeypatch, root)

    tools["dna_edit"](
        module_path="src/foo", target="note",
        payload={"name": "victim", "content": "bye\n", "frontmatter": _fm()},
        mode="replace", cwd=str(root),
    )
    p = mod / ".dna" / "notes" / "victim.md"
    assert p.is_file()

    result = tools["dna_edit"](
        module_path="src/foo", target="note",
        payload={"name": "victim", "mode": "delete"},
        mode="replace", cwd=str(root),
    )
    assert not result.startswith("ERROR:"), result
    assert not p.exists()
    # notes/ parent MUST survive — its lifecycle follows the module.
    assert (mod / ".dna" / "notes").is_dir()


def test_dna_edit_note_duplicate_returns_error_string(tmp_path, monkeypatch):
    """FileExistsError from a duplicate create must be translated to
    ``ERROR: …`` — this used to propagate uncaught out of dna_edit."""
    root, _ = _make_project(tmp_path)
    tools = _register_dna(monkeypatch, root)

    tools["dna_edit"](
        module_path="src/foo", target="note",
        payload={"name": "dup", "content": "first\n", "frontmatter": _fm()},
        mode="replace", cwd=str(root),
    )
    out = tools["dna_edit"](
        module_path="src/foo", target="note",
        payload={"name": "dup", "content": "second\n", "frontmatter": _fm()},
        mode="replace", cwd=str(root),
    )
    assert isinstance(out, str)
    assert out.startswith("ERROR:"), out
    assert "already exists" in out


def test_dna_edit_note_update_missing_returns_error_string(tmp_path, monkeypatch):
    root, _ = _make_project(tmp_path)
    tools = _register_dna(monkeypatch, root)

    out = tools["dna_edit"](
        module_path="src/foo", target="note",
        payload={"name": "ghost", "mode": "update",
                 "content": "x\n", "frontmatter": _fm()},
        mode="replace", cwd=str(root),
    )
    assert out.startswith("ERROR:"), out
    assert "does not exist" in out


def test_dna_edit_note_bad_frontmatter_returns_error_string(tmp_path, monkeypatch):
    """MCP layer does no frontmatter validation of its own — it just relays
    the primitive ValueError. Regression guard: any drift to a fresh
    validation branch at the MCP layer would break the layering rule."""
    root, _ = _make_project(tmp_path)
    tools = _register_dna(monkeypatch, root)

    bad_fm = _fm(status="finalized")  # not in the allowed enum
    out = tools["dna_edit"](
        module_path="src/foo", target="note",
        payload={"name": "n1", "content": "x\n", "frontmatter": bad_fm},
        mode="replace", cwd=str(root),
    )
    assert out.startswith("ERROR:"), out
    assert "status" in out


# ---------------------------------------------------------------------------
# dna_show — Notes summary + include_notes body expansion
# ---------------------------------------------------------------------------

def _baseline_show_output(tools, root: Path, module_path: str) -> str:
    return tools["dna_show"](module_path=module_path, cwd=str(root))


def test_dna_show_no_notes_output_unchanged(tmp_path, monkeypatch):
    """No notes → the Notes summary line MUST NOT appear."""
    root, _ = _make_project(tmp_path)
    tools = _register_dna(monkeypatch, root)
    out = _baseline_show_output(tools, root, "src/foo")
    assert not out.startswith("ERROR:"), out
    assert "Notes" not in out


def test_dna_show_notes_summary_appears_when_notes_exist(tmp_path, monkeypatch):
    """Even with default include_notes=False, the summary line renders."""
    root, mod = _make_project(tmp_path)
    tools = _register_dna(monkeypatch, root)

    tools["dna_edit"](
        module_path="src/foo", target="note",
        payload={"name": "alpha", "content": "aaa\n",
                 "frontmatter": _fm(title="Alpha note", status="reviewed")},
        mode="replace", cwd=str(root),
    )
    tools["dna_edit"](
        module_path="src/foo", target="note",
        payload={"name": "beta", "content": "bbb\n",
                 "frontmatter": _fm(title="Beta note", status="draft",
                                    intent="current-state")},
        mode="replace", cwd=str(root),
    )

    out = tools["dna_show"](module_path="src/foo", cwd=str(root))
    assert "Notes       : alpha (reviewed), beta (draft)" in out
    # Default (include_notes=False) MUST NOT expand bodies.
    assert "--- notes/alpha.md ---" not in out
    assert "--- notes/beta.md ---" not in out
    # And it MUST NOT leak the note body text via any other section.
    assert "aaa" not in out
    assert "bbb" not in out


def test_dna_show_include_notes_expands_bodies(tmp_path, monkeypatch):
    root, _ = _make_project(tmp_path)
    tools = _register_dna(monkeypatch, root)

    tools["dna_edit"](
        module_path="src/foo", target="note",
        payload={"name": "alpha", "content": "alpha body line\n",
                 "frontmatter": _fm(title="Alpha", status="reviewed")},
        mode="replace", cwd=str(root),
    )
    tools["dna_edit"](
        module_path="src/foo", target="note",
        payload={"name": "beta", "content": "beta body line\n",
                 "frontmatter": _fm(title="Beta", status="draft")},
        mode="replace", cwd=str(root),
    )

    out = tools["dna_show"](
        module_path="src/foo", cwd=str(root), include_notes=True,
    )
    # Summary line still there.
    assert "Notes       : alpha (reviewed), beta (draft)" in out
    # Each note gets its own delimiter + body.
    assert "--- notes/alpha.md ---" in out
    assert "alpha body line" in out
    assert "--- notes/beta.md ---" in out
    assert "beta body line" in out


def test_dna_show_default_output_byte_stable_when_no_notes(tmp_path, monkeypatch):
    """Byte-level invariant: on a module with no notes, adding the
    notes-aware code paths must not shift the rest of the output.

    Previous callers grep for exact ``Name        : …`` / ``Workflows   : …``
    lines; the retrieval-hit snippet path (240-char cap) is not our concern
    here, but this test pins the ``dna_show`` surface itself.
    """
    root, _ = _make_project(tmp_path)
    tools = _register_dna(monkeypatch, root)
    out = tools["dna_show"](module_path="src/foo", cwd=str(root))
    expected = (
        "Name        : Foo\n"
        "Owner       : platform\n"
        "Description : a foo\n"
        "\n"
        "--- module.md (body) ---\n"
        "## Positioning\n\nfoo positioning"
    )
    assert out == expected, repr(out)


def test_dna_show_include_notes_without_notes_is_noop(tmp_path, monkeypatch):
    """include_notes=True on a module with no notes must produce exactly
    the same bytes as include_notes=False."""
    root, _ = _make_project(tmp_path)
    tools = _register_dna(monkeypatch, root)
    a = tools["dna_show"](module_path="src/foo", cwd=str(root))
    b = tools["dna_show"](
        module_path="src/foo", cwd=str(root), include_notes=True,
    )
    assert a == b


def test_dna_show_notes_summary_survives_empty_status(tmp_path, monkeypatch):
    """Defensive: if a note somehow has an empty status (e.g. hand-edited
    frontmatter), the summary must render the slug alone rather than
    ``slug ()``. Composed by dropping the note file straight onto disk so
    the create path (which enforces status) is not exercised."""
    root, mod = _make_project(tmp_path)
    tools = _register_dna(monkeypatch, root)

    notes_dir = mod / ".dna" / "notes"
    notes_dir.mkdir(parents=True)
    (notes_dir / "raw.md").write_text(
        "---\ntitle: Raw\n---\n\nraw body\n", encoding="utf-8",
    )

    out = tools["dna_show"](module_path="src/foo", cwd=str(root))
    # The whole summary line must exist and reference the slug only.
    assert "Notes       : raw" in out
    assert "raw ()" not in out
