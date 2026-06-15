"""Frontmatter schema constants for module.md and the rendering helper."""

from services._fm import render_frontmatter

_MODULE_FM_SCHEMA = (
    "name", "owner", "description",
    "keywords", "dependencies", "includeDirs",
    "status",
)

# Frontmatter fields whose YAML type is a list. The CLI uses this to reject
# scalar `--value` writes against these fields and to require `--value-list`
# instead, so users never accidentally serialize "a,b,c" as a single string.
_MODULE_FM_LIST_FIELDS = frozenset({
    "keywords", "dependencies", "includeDirs",
})

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
    "_MODULE_FM_STATUS_VALUES",
    "_build_module_md",
]
