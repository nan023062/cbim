"""
memory.py — Memory resource.

Thin object facade over the memory module. A Memory instance is one
markdown entry file under .cbim/memory/<tier>/. The class-level helpers
(create, query, list_all, cleanup) wrap the crud / compaction / facade
APIs directly — no MemoryEngine adapter in between.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from ._base import Resource
from ._body import Body
from ._frontmatter import Frontmatter
from ._io import atomic_write_text
from services._fm import parse_frontmatter, strip_frontmatter
from memory.crud.primitives import _check_tier, resolve_entry_path


def _sanitize_slug(slug: str) -> str:
    """Normalise and validate a user-supplied slug fragment for filename use.

    The slug becomes part of ``<ts>-<kind>-<slug>.md`` under
    ``.cbim/memory/<tier>/`` and is subsequently rendered by downstream
    consumers (including CLI output, where the filename is rendered as text
    attribute + JS-string contexts). Anything that could redirect the final
    path outside that directory, embed non-printable bytes in the filename,
    or break the HTML/JS string contexts a downstream consumer wraps it in
    is rejected up front. Spaces are collapsed to hyphens to preserve the
    historical behaviour that callers rely on.
    """
    cleaned = slug.strip().replace(" ", "-")
    if not cleaned:
        raise ValueError("slug must not be empty after stripping whitespace")
    if "/" in cleaned or "\\" in cleaned:
        raise ValueError(
            f"slug must not contain path separators: {slug!r}"
        )
    if ".." in cleaned:
        raise ValueError(
            f"slug must not contain '..' traversal segments: {slug!r}"
        )
    # HTML / JS string-context metacharacters. Blocking these at the source
    # keeps downstream renderers and CLI output from
    # having to defend the JS-in-HTML-attribute context in isolation.
    for ch in ("'", '"', "`", "<", ">", "&"):
        if ch in cleaned:
            raise ValueError(
                f"slug must not contain HTML/JS metacharacter {ch!r}: {slug!r}"
            )
    for ch in cleaned:
        code = ord(ch)
        if code < 0x20 or code == 0x7f:
            raise ValueError(
                f"slug must not contain control characters: {slug!r}"
            )
    return cleaned


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _default_store(root: Path | None = None) -> Path:
    if root is not None:
        return Path(root) / ".cbim" / "memory"
    from context import cbim_dir
    return cbim_dir() / "memory"


def _build_backend(store_dir: Path):
    """Construct a FileBackend at `store_dir`.

    Mirrors memory/cli.py:_build_backend so behaviour stays in lockstep.
    """
    from memory.crud.file_backend import FileBackend
    return FileBackend(store_dir)


# ---------------------------------------------------------------------------
# Memory resource
# ---------------------------------------------------------------------------

class Memory(Resource):

    def __init__(self, path: Path, *, frontmatter: Frontmatter, body: Body,
                 store_dir: Path | None = None):
        self._path = resolve_entry_path(path, store_dir or _default_store(), writable=True)
        self._id = path.stem
        self._dirty = False
        self._store_dir = Path(store_dir or _default_store()).resolve()
        self.frontmatter = frontmatter
        self.body = body
        frontmatter._on_change = self._mark_dirty
        body._on_change = self._mark_dirty

    # ------------------------------------------------------------------
    # Classmethods
    # ------------------------------------------------------------------

    @classmethod
    def load(cls, path: Path | str, *, store_dir: Path | None = None, root: Path | None = None, **_kw) -> "Memory":
        store = Path(store_dir) if store_dir is not None else _default_store(root)
        p = resolve_entry_path(path, store, writable=True)
        if not p.is_file():
            raise FileNotFoundError(f"memory entry not found: {p}")
        raw = p.read_text(encoding="utf-8")
        return cls(
            p,
            frontmatter=Frontmatter(parse_frontmatter(raw)),
            body=Body(strip_frontmatter(raw)),
            store_dir=store,
        )

    @classmethod
    def create(
        cls,
        *,
        slug: str,
        content: str,
        tier: str = "medium",
        kind: str = "manual",
        root: Path | None = None,
        store_dir: Path | None = None,
    ) -> "Memory":
        """Write a new memory entry file and index it through crud.primitives."""
        from memory.crud.primitives import write as _crud_write

        # Validate BEFORE any disk write. Slug flows into the filename, so
        # an unchecked '/' or '..' would let a caller redirect the write
        # outside `.cbim/memory/<tier>/` — see security note in the module
        # docstring for `_sanitize_slug`.
        _check_tier(tier)
        slug_clean = _sanitize_slug(slug)
        kind = _sanitize_slug(kind)
        if not isinstance(content, str):
            raise ValueError("content must be a string")
        store = Path(store_dir) if store_dir is not None else _default_store(root)
        ts = datetime.now().strftime("%Y-%m-%d-%H%M%S-%f")
        filename = f"{ts}-{kind}-{slug_clean}.md"
        path = resolve_entry_path(store.resolve() / tier / filename, store, writable=True)
        atomic_write_text(path, content)

        backend = _build_backend(store)
        _crud_write(path, tier, backend)
        return cls.load(path, store_dir=store)

    @classmethod
    def exists(cls, path: Path | str, **_kw) -> bool:
        store = _kw.get("store_dir") or _default_store(_kw.get("root"))
        return resolve_entry_path(path, store, writable=True).is_file()

    @classmethod
    def query(
        cls,
        text: str,
        *,
        tier: str | None = None,
        top_k: int = 5,
        verbose: bool = False,
        root: Path | None = None,
    ) -> list[dict]:
        """Return result dicts (doc_id, score, metadata) from the parent facade.

        The `verbose` flag is accepted for interface symmetry; callers can
        inspect each dict regardless.
        """
        from memory import query as _q

        store = _default_store(root)
        backend = _build_backend(store)
        return _q(text, tier=tier, limit=top_k, store_dir=store, backend=backend)

    @classmethod
    def list_all(
        cls,
        *,
        tier: str | None = None,
        root: Path | None = None,
    ) -> list["Memory"]:
        store = _default_store(root)
        if tier is not None:
            _check_tier(tier)
        tiers = [tier] if tier else ["medium"]
        out: list[Memory] = []
        for t in tiers:
            tier_dir = store / t
            if not tier_dir.is_dir():
                continue
            for md in sorted(tier_dir.glob("*.md")):
                try:
                    out.append(cls.load(md, store_dir=store))
                except FileNotFoundError:
                    continue
        return out

    @classmethod
    def cleanup(
        cls,
        *,
        keep_days: int = 3,
        root: Path | None = None,
    ) -> int:
        from memory.compaction import sweep_expired

        store = _default_store(root)
        backend = _build_backend(store)
        return sweep_expired(store, backend, keep_days=keep_days)

    # ------------------------------------------------------------------
    # Save / Promote
    # ------------------------------------------------------------------

    def save(self) -> None:
        from memory.crud.primitives import write as _crud_write

        fm = self.frontmatter.render() if self.frontmatter.to_dict() else ""
        body = self.body.read()
        if fm:
            text = fm + "\n" + body if not body.startswith("\n") else fm + body
        else:
            text = body
        if not text.endswith("\n"):
            text += "\n"
        tier = self.frontmatter.get("tier") or self._path.parent.name
        _check_tier(tier)
        resolve_entry_path(self._path, self._store_dir, writable=True)
        atomic_write_text(self._path, text)
        # Re-index so the backend picks up the new content.
        backend = _build_backend(self._store_dir)
        _crud_write(self._path, tier, backend)
        self._mark_clean()

    def delete(self, *, force: bool = False) -> None:
        """Remove this entry from the backend index and unlink the file.

        Overrides the base default (which only unlinks) so the backend index
        stays consistent — leaving a stale doc_id behind would surface as a
        phantom hit in `Memory.query`.
        """
        from memory.crud.primitives import delete as _crud_delete

        resolve_entry_path(self._path, self._store_dir, writable=True)
        backend = _build_backend(self._store_dir)
        _crud_delete(self._path, backend)
        if self._path.is_file():
            self._path.unlink()

    def promote(self, to_tier: str) -> None:
        """Move this entry from its current tier directory to <to_tier>/.

        Updates the backend index (delete old doc_id, re-add at new path via
        save()) and rewrites the in-memory `tier` field in frontmatter.
        """
        _check_tier(to_tier)
        # Medium is the sole writable tier; do not delete or move the entry.
        resolve_entry_path(self._path, self._store_dir, writable=True)
        self.frontmatter.set("tier", to_tier)
        self.save()
