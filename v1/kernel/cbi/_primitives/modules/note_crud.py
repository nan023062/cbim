"""Note CRUD primitives — ``<module>/.dna/notes/<slug>.md`` single-file docs.

Notes are the module-supplement knowledge layer (see root module.md
decision D8). Structurally distinct from workflows:
  - ``workflows/<slug>/workflow.md`` (directory + file)
  - ``notes/<slug>.md``              (single file)

Consequences that matter for delete: unlinking the last note MUST NOT
remove the ``notes/`` directory itself — the directory tracks the
module, not any specific note.

All writes go through :func:`atomic_io.atomic_write_text`. slug
validation is enforced here at the primitive layer so the services
layer / MCP layer can rely on a canonical shape when composing doc_ids.
"""

from __future__ import annotations

import re
from pathlib import Path

from atomic_io import atomic_write_text
from services._fm import parse_frontmatter, strip_frontmatter

from .notes_frontmatter_schema import (
    _build_note_md,
    _validate_note_frontmatter,
)


# kebab-case: lowercase alphanumerics + hyphens. No path separators, no
# leading/trailing hyphens are enforced at the caller level (an ambient
# convention, not enforced here — matches how ``workflow`` slugs are
# passed through untouched). Empty string is refused.
_NOTE_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _validate_note_slug(slug: str) -> None:
    """Validate ``slug`` against the kebab-case rule.

    Path separators and traversal segments (``.``, ``..``) are rejected
    implicitly — the regex only matches alphanumerics + interior
    hyphens.
    """
    if not isinstance(slug, str) or not slug:
        raise ValueError(
            f"note slug must be a non-empty string; got: {slug!r}"
        )
    if not _NOTE_SLUG_RE.match(slug):
        raise ValueError(
            f"note slug must be kebab-case matching [a-z0-9-]+ "
            f"(no path separators, no leading/trailing hyphens, "
            f"no consecutive hyphens); got: {slug!r}"
        )


def _notes_dir(mod_dir: Path) -> Path:
    return mod_dir.resolve() / ".dna" / "notes"


def _note_path(mod_dir: Path, slug: str) -> Path:
    return _notes_dir(mod_dir) / f"{slug}.md"


def create_note(mod_dir: Path, slug: str, meta: dict, body: str) -> Path:
    """Create ``<mod_dir>/.dna/notes/<slug>.md``.

    Raises:
        ValueError:       slug or frontmatter is invalid.
        FileNotFoundError: ``<mod_dir>/.dna/`` does not exist.
        FileExistsError:  target file already exists.

    Returns the absolute path of the written file.
    """
    _validate_note_slug(slug)
    _validate_note_frontmatter(meta)

    aimod = mod_dir.resolve() / ".dna"
    if not aimod.is_dir():
        raise FileNotFoundError(
            f"module not initialized at {mod_dir}; run `dna init` first "
            f"(missing {aimod})"
        )

    target = _note_path(mod_dir, slug)
    if target.exists():
        raise FileExistsError(f"note already exists: {target}")

    # atomic_write_text handles parent-dir mkdir, so we don't need to
    # pre-create ``notes/``.
    atomic_write_text(target, _build_note_md(meta, body))
    return target


def update_note(mod_dir: Path, slug: str, meta: dict, body: str) -> Path:
    """Overwrite ``<mod_dir>/.dna/notes/<slug>.md`` with fresh meta + body.

    Full-file rewrite (not a section-level edit). Matches the workflow
    update semantics.

    Raises:
        ValueError:        slug or frontmatter is invalid.
        FileNotFoundError: target file does not exist.

    Returns the absolute path of the written file.
    """
    _validate_note_slug(slug)
    _validate_note_frontmatter(meta)

    target = _note_path(mod_dir, slug)
    if not target.is_file():
        raise FileNotFoundError(
            f"note {slug!r} does not exist at {target}, cannot update"
        )

    atomic_write_text(target, _build_note_md(meta, body))
    return target


def delete_note(mod_dir: Path, slug: str) -> Path:
    """Unlink ``<mod_dir>/.dna/notes/<slug>.md``.

    Idempotent: missing file is a silent no-op — the returned path
    still refers to the (would-be) location so callers can log it.
    The ``notes/`` parent directory is NEVER removed here even when it
    becomes empty; its lifecycle follows the module itself.

    Raises:
        ValueError: slug is invalid.

    Returns the absolute path of the (now-absent) file.
    """
    _validate_note_slug(slug)
    target = _note_path(mod_dir, slug)
    if target.is_file():
        target.unlink()
    return target


def note_exists(mod_dir: Path, slug: str) -> bool:
    return _note_path(mod_dir, slug).is_file()


def list_notes(mod_dir: Path) -> list[dict]:
    """List note metadata under ``<mod_dir>/.dna/notes/``.

    Returns a list sorted by slug, each entry shaped as::

        {
          "slug":          <str, filename stem>,
          "title":         <str, from frontmatter; "" when absent>,
          "intent":        <str | None>,
          "status":        <str, from frontmatter; "" when absent>,
          "last_reviewed": <str | None>,
        }

    Body content is NOT loaded here — this is the metadata listing
    consumed by ``services.get_module`` and dashboard callers who only
    want the "what notes exist" answer. Callers who need the body can
    read the file directly.
    """
    notes_dir = _notes_dir(mod_dir)
    if not notes_dir.is_dir():
        return []
    out: list[dict] = []
    for note_file in sorted(notes_dir.iterdir()):
        if not note_file.is_file() or note_file.suffix != ".md":
            continue
        # Skip broken slugs so the listing can't be poisoned by a
        # renamed-outside-the-CLI file.
        stem = note_file.stem
        if not _NOTE_SLUG_RE.match(stem):
            continue
        try:
            raw = note_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        try:
            fm = parse_frontmatter(raw)
        except ValueError:
            # Malformed frontmatter — surface only the slug so the
            # metadata list stays useful; caller can drill into the
            # broken file.
            fm = {}
        out.append({
            "slug": stem,
            "title": fm.get("title", "") if isinstance(fm.get("title"), str) else "",
            "intent": fm.get("intent") if isinstance(fm.get("intent"), (str, type(None))) else None,
            "status": fm.get("status", "") if isinstance(fm.get("status"), str) else "",
            "last_reviewed": (
                fm.get("last_reviewed")
                if isinstance(fm.get("last_reviewed"), (str, type(None)))
                else None
            ),
        })
    return out


def read_note(mod_dir: Path, slug: str) -> tuple[dict, str]:
    """Return ``(frontmatter, body)`` for ``<mod_dir>/.dna/notes/<slug>.md``.

    Raises FileNotFoundError when the file is absent.
    """
    _validate_note_slug(slug)
    target = _note_path(mod_dir, slug)
    if not target.is_file():
        raise FileNotFoundError(f"note not found: {target}")
    raw = target.read_text(encoding="utf-8")
    return parse_frontmatter(raw), strip_frontmatter(raw)


__all__ = [
    "_NOTE_SLUG_RE",
    "_validate_note_slug",
    "create_note",
    "update_note",
    "delete_note",
    "note_exists",
    "list_notes",
    "read_note",
]
