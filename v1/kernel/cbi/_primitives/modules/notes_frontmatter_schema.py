"""Frontmatter schema constants for .dna/notes/<slug>.md plus validation.

Peer of ``frontmatter_schema.py`` — same style, same helpers, same
render pipeline. Notes are the module-supplement knowledge layer
(background / rationale / current-state / implementation-detail /
usage-example / historical-context) that lives beside ``module.md``
and ``workflows/`` under ``.dna/``. See root module.md decision D8.

Only ``title`` and ``status`` are required. Everything else is
optional and, when omitted from the input dict, is not rendered — the
kernel does not silently synthesize defaults.
"""

from services._fm import render_frontmatter


# Rendering order for the six schema keys. `render_frontmatter` emits
# schema-listed keys in this exact order (skipping the ones absent from
# ``meta``), then any extras in insertion order.
_NOTE_FM_SCHEMA = (
    "title",
    "intent",
    "keywords",
    "related_modules",
    "status",
    "last_reviewed",
    "authors",
)

# YAML-list frontmatter fields. Scalar assignment against these must be
# refused at the surface layer (CLI / MCP) — same convention module.md
# uses for ``keywords`` / ``links``.
_NOTE_FM_LIST_FIELDS = frozenset({
    "keywords",
    "related_modules",
    "authors",
})

# Allowed values for the ``status`` field (declared review state, set by
# the note author):
#   - draft    : in-progress; expect churn
#   - reviewed : passed a review pass; considered current
#   - stable   : long-lived; changes rarely
_NOTE_FM_STATUS_VALUES = ("draft", "reviewed", "stable")

# Allowed values for the optional ``intent`` field (what kind of
# supplementary knowledge this note carries). ``None`` / missing is
# legal — an untagged note is fine.
_NOTE_FM_INTENT_VALUES = (
    "rationale",
    "implementation-detail",
    "current-state",
    "usage-example",
    "historical-context",
)

# Minimum required frontmatter fields — everything else is optional.
_NOTE_FM_REQUIRED = ("title", "status")


def _validate_note_frontmatter(meta: dict) -> None:
    """Validate a note.md frontmatter dict. Raises ``ValueError`` on the
    first violation with a message identifying the field and value.

    Rules:
      - ``meta`` must be a dict.
      - Every required field in :data:`_NOTE_FM_REQUIRED` must be present.
      - ``title`` must be a non-empty string.
      - ``status`` must be a string in :data:`_NOTE_FM_STATUS_VALUES`.
      - ``intent``, when supplied and not None, must be a string in
        :data:`_NOTE_FM_INTENT_VALUES`. Absent/None is legal.
      - Every list-typed field (see :data:`_NOTE_FM_LIST_FIELDS`), when
        present, must be a ``list`` (empty list is fine).
      - ``last_reviewed``, when present and not None, must be a string
        (kept permissive on shape — architect can enforce ISO-8601 in a
        later pass; the surface just refuses non-strings here).
    """
    if not isinstance(meta, dict):
        raise ValueError(
            f"note frontmatter must be a dict; got: {type(meta).__name__}"
        )

    for field in _NOTE_FM_REQUIRED:
        if field not in meta:
            raise ValueError(
                f"note frontmatter is missing required field {field!r} "
                f"(required set: {list(_NOTE_FM_REQUIRED)})"
            )

    title = meta.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ValueError(
            f"note frontmatter field 'title' must be a non-empty string; "
            f"got: {title!r}"
        )

    status = meta.get("status")
    if status not in _NOTE_FM_STATUS_VALUES:
        raise ValueError(
            f"note frontmatter field 'status' must be one of "
            f"{_NOTE_FM_STATUS_VALUES}; got: {status!r}"
        )

    if "intent" in meta:
        intent = meta.get("intent")
        if intent is not None and intent not in _NOTE_FM_INTENT_VALUES:
            raise ValueError(
                f"note frontmatter field 'intent' must be one of "
                f"{_NOTE_FM_INTENT_VALUES} (or omitted/null); "
                f"got: {intent!r}"
            )

    for field in _NOTE_FM_LIST_FIELDS:
        if field in meta and not isinstance(meta[field], list):
            raise ValueError(
                f"note frontmatter field {field!r} must be a list; "
                f"got: {type(meta[field]).__name__}"
            )

    if "last_reviewed" in meta:
        lr = meta.get("last_reviewed")
        if lr is not None and not isinstance(lr, str):
            raise ValueError(
                f"note frontmatter field 'last_reviewed' must be a string "
                f"(ISO-8601 date recommended) or null; "
                f"got: {type(lr).__name__}"
            )


def _build_note_md(meta: dict, body: str) -> str:
    """Render a full ``notes/<slug>.md`` file from frontmatter + body.

    Mirrors ``_build_module_md``: schema-ordered frontmatter block,
    blank line, body, trailing newline.
    """
    body_text = body if body.endswith("\n") else body + "\n"
    return render_frontmatter(meta, _NOTE_FM_SCHEMA) + "\n" + body_text


__all__ = [
    "_NOTE_FM_SCHEMA",
    "_NOTE_FM_LIST_FIELDS",
    "_NOTE_FM_STATUS_VALUES",
    "_NOTE_FM_INTENT_VALUES",
    "_NOTE_FM_REQUIRED",
    "_validate_note_frontmatter",
    "_build_note_md",
]
