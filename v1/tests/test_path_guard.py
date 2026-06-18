"""Tests for services._paths.resolve_within_root and the MCP tool guards.

Coverage matrix:
- direct unit tests for resolve_within_root: drive-relative reject, ``..``
  reject, symlink-out reject (POSIX), Windows-style ``..\\..\\foo`` reject,
  empty-with-allow_root_itself=False reject, legitimate child accept,
  legitimate-non-existent + must_exist accept-or-reject, root missing.
- integration: ``dna_show("../../etc/passwd")`` returns ``ERROR:`` and does
  not read anything outside root; ``memory_delete("../foo.md")`` likewise.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from services._paths import PathOutsideRootError, resolve_within_root

# ---------------------------------------------------------------------------
# Unit tests
# ---------------------------------------------------------------------------


def test_legitimate_child(tmp_path):
    target = resolve_within_root(tmp_path, "sub/dir")
    assert target == (tmp_path / "sub" / "dir").resolve()


def test_legitimate_existing_with_must_exist(tmp_path):
    sub = tmp_path / "child"
    sub.mkdir()
    out = resolve_within_root(tmp_path, "child", must_exist=True)
    assert out == sub.resolve()


def test_must_exist_missing_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        resolve_within_root(tmp_path, "nope", must_exist=True)


def test_drive_relative_rejected(tmp_path):
    # ``C:foo`` is drive-relative on Windows; never safe.
    with pytest.raises(PathOutsideRootError):
        resolve_within_root(tmp_path, "C:foo")


def test_drive_only_rejected(tmp_path):
    with pytest.raises(PathOutsideRootError):
        resolve_within_root(tmp_path, "C:")


def test_dotdot_escape_rejected(tmp_path):
    with pytest.raises(PathOutsideRootError):
        resolve_within_root(tmp_path, "../../etc/passwd")


@pytest.mark.skipif(
    sys.platform != "win32",
    reason="backslash is path separator on Windows only; on POSIX the string is a literal filename",
)
def test_windows_backslash_dotdot_rejected(tmp_path):
    with pytest.raises(PathOutsideRootError):
        resolve_within_root(tmp_path, "..\\..\\foo")


def test_absolute_inside_root_allowed(tmp_path):
    # CLI legitimately passes absolute paths that happen to live under root.
    inside = tmp_path / "x"
    inside.mkdir()
    out = resolve_within_root(tmp_path, str(inside))
    assert out == inside.resolve()


def test_absolute_outside_root_rejected(tmp_path):
    other = tmp_path.parent / "other"
    other.mkdir(exist_ok=True)
    with pytest.raises(PathOutsideRootError):
        resolve_within_root(tmp_path, str(other))


def test_empty_string_with_allow_root_itself_false(tmp_path):
    with pytest.raises(PathOutsideRootError):
        resolve_within_root(tmp_path, "", allow_root_itself=False)


def test_dot_with_allow_root_itself_false(tmp_path):
    with pytest.raises(PathOutsideRootError):
        resolve_within_root(tmp_path, ".", allow_root_itself=False)


def test_root_itself_allowed_by_default(tmp_path):
    out = resolve_within_root(tmp_path, ".")
    assert out == tmp_path.resolve()


def test_root_must_exist(tmp_path):
    missing = tmp_path / "nope"
    with pytest.raises(RuntimeError):
        resolve_within_root(missing, "sub")


@pytest.mark.skipif(sys.platform == "win32", reason="symlink test is POSIX-only")
def test_symlink_escaping_root_rejected(tmp_path):
    outside = tmp_path.parent / "outside_target"
    outside.mkdir(exist_ok=True)
    link = tmp_path / "link"
    link.symlink_to(outside)
    with pytest.raises(PathOutsideRootError):
        resolve_within_root(tmp_path, "link")


# ---------------------------------------------------------------------------
# MCP integration: confirm guards actually fire at the tool surface.
# ---------------------------------------------------------------------------


def _register_dna(monkeypatch, root: Path):
    """Helper: collect MCP-registered tools as plain callables."""
    import mcp_server.tools.dna as dna_tool

    class _Fake:
        def __init__(self):
            self.tools = {}

        def tool(self):
            def deco(fn):
                self.tools[fn.__name__] = fn
                return fn
            return deco

    fake = _Fake()
    dna_tool.register(fake)
    # Batch 1: tools/dna.py now imports `project_root` from `context` and
    # calls it with `cwd or None`. Patch the bound name on the tool module
    # to short-circuit the walk and return our test root regardless of cwd.
    monkeypatch.setattr(dna_tool, "project_root", lambda *_a, **_kw: root)
    return fake.tools


def test_dna_show_rejects_traversal(tmp_path, monkeypatch):
    (tmp_path / ".cbim").mkdir()
    tools = _register_dna(monkeypatch, tmp_path)
    out = tools["dna_show"](module_path="../../../etc/passwd", cwd="")
    assert out.startswith("ERROR:"), out
    # Must not have leaked anything that looks like the file content.
    assert "root:x" not in out


def test_dna_edit_rejects_traversal(tmp_path, monkeypatch):
    (tmp_path / ".cbim").mkdir()
    tools = _register_dna(monkeypatch, tmp_path)
    out = tools["dna_edit"](
        module_path="../../etc/passwd",
        target="body",
        payload={"content": "x"},
        mode="replace",
        cwd="",
    )
    assert out.startswith("ERROR:"), out


def test_dna_split_rejects_traversal(tmp_path, monkeypatch):
    (tmp_path / ".cbim").mkdir()
    tools = _register_dna(monkeypatch, tmp_path)
    out = tools["dna_split"](
        source_module_path="../escape",
        splits=[],
        strategy="comment",
        cwd="",
    )
    assert isinstance(out, dict) and "error" in out, out


def test_dna_split_rejects_bad_split_path(tmp_path, monkeypatch):
    (tmp_path / ".cbim").mkdir()
    src = tmp_path / "src"
    src.mkdir()
    (src / ".dna").mkdir()
    (src / ".dna" / "module.md").write_text("---\nname: src\n---\n", encoding="utf-8")
    tools = _register_dna(monkeypatch, tmp_path)
    out = tools["dna_split"](
        source_module_path="src",
        splits=[{"path": "../escape", "name": "X", "headings": []}],
        strategy="comment",
        cwd="",
    )
    assert isinstance(out, dict) and "error" in out, out


def _make_root_module(root: Path) -> None:
    """Stand up a minimum project root with a root module so dna_show / dna_edit
    can address it as ``"."`` / ``""`` / absolute root path.
    """
    (root / ".cbim").mkdir(exist_ok=True)
    (root / ".cbim" / "config.json").write_text("{}", encoding="utf-8")
    (root / ".cbim" / "index.md").write_text(
        "# Module Index\n\n- .\n", encoding="utf-8"
    )
    (root / ".dna").mkdir(exist_ok=True)
    (root / ".dna" / "module.md").write_text(
        "---\nname: root\nowner: arch\ndescription: rt\n"
        "keywords: []\ndependencies: []\nstatus: implemented\n---\n\n"
        "## Positioning\n\nroot positioning\n",
        encoding="utf-8",
    )


def test_dna_show_accepts_root_dot(tmp_path, monkeypatch):
    _make_root_module(tmp_path)
    tools = _register_dna(monkeypatch, tmp_path)
    out = tools["dna_show"](module_path=".", cwd=str(tmp_path))
    assert not out.startswith("ERROR:"), out
    assert "Name        : root" in out


def test_dna_show_accepts_root_empty_string(tmp_path, monkeypatch):
    _make_root_module(tmp_path)
    tools = _register_dna(monkeypatch, tmp_path)
    out = tools["dna_show"](module_path="", cwd=str(tmp_path))
    assert not out.startswith("ERROR:"), out
    assert "Name        : root" in out


def test_dna_edit_accepts_root_body(tmp_path, monkeypatch):
    _make_root_module(tmp_path)
    tools = _register_dna(monkeypatch, tmp_path)
    out = tools["dna_edit"](
        module_path=".",
        target="body",
        payload={"content": "## Positioning\n\nupdated by test\n"},
        mode="replace",
        cwd=str(tmp_path),
    )
    assert not out.startswith("ERROR:"), out
    written = (tmp_path / ".dna" / "module.md").read_text(encoding="utf-8")
    assert "updated by test" in written


def test_dna_edit_accepts_root_frontmatter(tmp_path, monkeypatch):
    _make_root_module(tmp_path)
    tools = _register_dna(monkeypatch, tmp_path)
    out = tools["dna_edit"](
        module_path=".",
        target="frontmatter",
        payload={"field": "description", "value": "rt-edited"},
        mode="replace",
        cwd=str(tmp_path),
    )
    assert not out.startswith("ERROR:"), out
    written = (tmp_path / ".dna" / "module.md").read_text(encoding="utf-8")
    assert "description: rt-edited" in written


def test_dna_edit_accepts_root_section(tmp_path, monkeypatch):
    _make_root_module(tmp_path)
    tools = _register_dna(monkeypatch, tmp_path)
    out = tools["dna_edit"](
        module_path=".",
        target="section",
        payload={
            "heading": "Positioning",
            "content": "fresh positioning\n",
            "level": 2,
        },
        mode="replace",
        cwd=str(tmp_path),
    )
    assert not out.startswith("ERROR:"), out
    written = (tmp_path / ".dna" / "module.md").read_text(encoding="utf-8")
    assert "fresh positioning" in written


def test_dna_split_still_rejects_root_source(tmp_path, monkeypatch):
    """Splitting *the root* is not unblocked by this change — the splitter
    primitive does not exercise the source-equals-root edge and the
    operation is semantically wrong (root is the aggregate, not a leaf)."""
    _make_root_module(tmp_path)
    tools = _register_dna(monkeypatch, tmp_path)
    out = tools["dna_split"](
        source_module_path=".",
        splits=[{"path": "child", "name": "Child", "headings": []}],
        strategy="comment",
        cwd=str(tmp_path),
    )
    assert isinstance(out, dict) and "error" in out, out


def test_dna_init_root_kind_accepts_root_dir(tmp_path, monkeypatch):
    """`kind="root"` REQUIRES `dir == "."` — entry guard must let it through.
    Other kinds at root still get rejected (covered separately below)."""
    # Bare project: registry exists but no root .dna/ yet (init's job).
    (tmp_path / ".cbim").mkdir()
    (tmp_path / ".cbim" / "config.json").write_text("{}", encoding="utf-8")
    (tmp_path / ".cbim" / "index.md").write_text("# Module Index\n", encoding="utf-8")
    tools = _register_dna(monkeypatch, tmp_path)
    out = tools["dna_init"](
        dir=".",
        kind="root",
        name="root",
        owner="arch",
        description="rt",
        with_contract=False,
        status="",
        cwd=str(tmp_path),
    )
    assert not out.startswith("ERROR:"), out
    assert (tmp_path / ".dna" / "module.md").is_file()


def test_dna_init_leaf_kind_still_rejects_root_dir(tmp_path, monkeypatch):
    """`kind="leaf"` (or "parent") at the project root is a caller error;
    keep the early reject so it surfaces with a clear message."""
    _make_root_module(tmp_path)
    tools = _register_dna(monkeypatch, tmp_path)
    out = tools["dna_init"](
        dir=".",
        kind="leaf",
        name="bogus",
        owner="arch",
        description="",
        with_contract=False,
        status="",
        cwd=str(tmp_path),
    )
    assert out.startswith("ERROR:"), out


def test_memory_delete_rejects_traversal(tmp_path, monkeypatch):
    (tmp_path / ".cbim" / "memory").mkdir(parents=True)
    import mcp_server.tools.memory as memory_tool

    class _Fake:
        def __init__(self):
            self.tools = {}

        def tool(self):
            def deco(fn):
                self.tools[fn.__name__] = fn
                return fn
            return deco

    fake = _Fake()
    memory_tool.register(fake)
    monkeypatch.setattr(memory_tool, "_store_dir", lambda _cwd: tmp_path / ".cbim" / "memory")
    out = fake.tools["memory_delete"](path="../../foo.md", cwd="")
    assert out.startswith("ERROR:"), out


def test_agent_name_rejected(tmp_path):
    """services.agent_service rejects path-bearing names directly."""
    from services.agent_service import scaffold_agent
    with pytest.raises(ValueError):
        scaffold_agent("../evil", cwd=str(tmp_path))
    with pytest.raises(ValueError):
        scaffold_agent("a/b", cwd=str(tmp_path))
    with pytest.raises(ValueError):
        scaffold_agent("..", cwd=str(tmp_path))
