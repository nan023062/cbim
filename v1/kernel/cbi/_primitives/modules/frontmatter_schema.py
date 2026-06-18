"""Frontmatter schema constants for module.md and the rendering helper."""

from services._fm import render_frontmatter

# v2 schema (PR-1): 5 required fields + 1 optional (`links`).
# `dependencies` and `includeDirs` are deleted — dependency relationships are
# now declared exclusively by parent-module class diagrams (..> arrows), and
# module mount scope is described by `links` (kind: local default).
#
# render_frontmatter (services/_fm.py) emits schema-listed keys first in
# this order, then any extra keys from `meta` in insertion order — so legacy
# files still carrying `dependencies`/`includeDirs` keep them on round-trip
# until the migration script (tools/migrate_2_x.py) strips them.
_MODULE_FM_SCHEMA = (
    "name", "owner", "description",
    "keywords", "status", "links",
)

# Frontmatter fields whose YAML type is a list. The CLI uses this to reject
# scalar `--value` writes against these fields and to require `--value-list`
# instead, so users never accidentally serialize "a,b,c" as a single string.
#
# v2: only `keywords` and `links` remain list-typed at the schema level.
_MODULE_FM_LIST_FIELDS = frozenset({
    "keywords", "links",
})

# Required fields under v2. PR-1 defines the tuple but does NOT enforce it
# (loader stays permissive) — strict validation lands in PR-2 once the
# migration script has rewritten every existing module.md.
_MODULE_FM_REQUIRED = (
    "name", "owner", "description", "keywords", "status",
)

# Allowed values for the `status` frontmatter field. Declared intent (set by
# the architect), orthogonal to the observed DNA state (0/1/2/3):
#   - spec         : designed; not yet implemented (state-3 source of truth)
#   - planned      : named only; design still pending (rarely used; early stub)
#   - implemented  : code matches the DNA (the steady state)
# Defined here once; engine/cli.py and resources/dna_module.py import this
# tuple — do NOT duplicate the value set.
_MODULE_FM_STATUS_VALUES = ("spec", "planned", "implemented")


def _build_module_md(meta: dict, body: str) -> str:
    """Reconstruct module.md from meta dict and body string."""
    return render_frontmatter(meta, _MODULE_FM_SCHEMA) + "\n" + body + "\n"


__all__ = [
    "_MODULE_FM_SCHEMA",
    "_MODULE_FM_LIST_FIELDS",
    "_MODULE_FM_REQUIRED",
    "_MODULE_FM_STATUS_VALUES",
    "_build_module_md",
]
