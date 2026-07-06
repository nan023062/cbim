"""Coverage for services._fm.parse_frontmatter / render_frontmatter v2 shapes.

Focus: nested-map list elements (block + flow), regression guards on the
pre-v2 scalar/scalar-list shapes, and round-trip self-consistency.
"""

from __future__ import annotations

import pytest

from services._fm import (
    parse_frontmatter,
    render_frontmatter,
    strip_frontmatter,
)


# ---------------------------------------------------------------------------
# Regression guards — pre-v2 scalar / string-list shapes must not change.
# ---------------------------------------------------------------------------


def test_parse_scalar_fields_unchanged():
    text = (
        "---\n"
        "name: foo\n"
        "owner: alice\n"
        "description: hello world\n"
        "---\n"
        "body text\n"
    )
    meta = parse_frontmatter(text)
    assert meta == {
        "name": "foo",
        "owner": "alice",
        "description": "hello world",
    }


def test_parse_quoted_scalar_strips_quotes():
    text = '---\nname: "quoted"\nowner: \'alice\'\n---\n'
    assert parse_frontmatter(text) == {"name": "quoted", "owner": "alice"}


def test_parse_block_scalar_list_unchanged():
    text = (
        "---\n"
        "keywords:\n"
        "  - alpha\n"
        "  - beta\n"
        "  - gamma\n"
        "---\n"
    )
    assert parse_frontmatter(text) == {
        "keywords": ["alpha", "beta", "gamma"],
    }


def test_parse_flow_scalar_list_unchanged():
    text = "---\nkeywords: [alpha, beta, gamma]\n---\n"
    assert parse_frontmatter(text) == {
        "keywords": ["alpha", "beta", "gamma"],
    }


def test_parse_empty_list_unchanged():
    text = "---\nkeywords: []\n---\n"
    assert parse_frontmatter(text) == {"keywords": []}


def test_parse_no_frontmatter_returns_empty_dict():
    assert parse_frontmatter("just body, no fence") == {}


def test_parse_unterminated_frontmatter_returns_empty_dict():
    # `---` opener but no closing fence — we tolerate by returning {}, same
    # as the pre-v2 behaviour callers depend on.
    assert parse_frontmatter("---\nname: foo\n") == {}


# ---------------------------------------------------------------------------
# Block-style nested map list — single / multi / mixed-field-order.
# ---------------------------------------------------------------------------


def test_parse_block_map_list_single_element():
    text = (
        "---\n"
        "links:\n"
        "  - kind: local\n"
        "    target: src\n"
        "---\n"
    )
    assert parse_frontmatter(text) == {
        "links": [{"kind": "local", "target": "src"}],
    }


def test_parse_block_map_list_multiple_elements():
    text = (
        "---\n"
        "links:\n"
        "  - kind: local\n"
        "    target: src\n"
        "  - kind: local\n"
        "    target: docs\n"
        "  - kind: git\n"
        "    url: https://example.com/repo.git\n"
        "    rev: main\n"
        "---\n"
    )
    assert parse_frontmatter(text) == {
        "links": [
            {"kind": "local", "target": "src"},
            {"kind": "local", "target": "docs"},
            {"kind": "git", "url": "https://example.com/repo.git", "rev": "main"},
        ],
    }


def test_parse_block_map_list_field_order_preserved():
    # Iteration order out of parse_frontmatter must follow the file order
    # so render_frontmatter can faithfully reproduce it.
    text = (
        "---\n"
        "links:\n"
        "  - target: src\n"
        "    kind: local\n"
        "---\n"
    )
    parsed = parse_frontmatter(text)
    keys = list(parsed["links"][0].keys())
    assert keys == ["target", "kind"]


def test_parse_block_map_list_then_top_level_key():
    text = (
        "---\n"
        "links:\n"
        "  - kind: local\n"
        "    target: src\n"
        "owner: alice\n"
        "---\n"
    )
    assert parse_frontmatter(text) == {
        "links": [{"kind": "local", "target": "src"}],
        "owner": "alice",
    }


# ---------------------------------------------------------------------------
# Flow-style nested map list — single / multi / quoting / spacing.
# ---------------------------------------------------------------------------


def test_parse_flow_map_list_single_element():
    text = '---\nlinks: [{kind: local, target: "."}]\n---\n'
    assert parse_frontmatter(text) == {
        "links": [{"kind": "local", "target": "."}],
    }


def test_parse_flow_map_list_multiple_elements():
    text = "---\nlinks: [{kind: local, target: src}, {kind: local, target: docs}]\n---\n"
    assert parse_frontmatter(text) == {
        "links": [
            {"kind": "local", "target": "src"},
            {"kind": "local", "target": "docs"},
        ],
    }


def test_parse_flow_map_list_with_extra_spaces():
    text = "---\nlinks:  [  {kind: local,  target: src} ,{ kind: git, url: x } ]\n---\n"
    assert parse_frontmatter(text) == {
        "links": [
            {"kind": "local", "target": "src"},
            {"kind": "git", "url": "x"},
        ],
    }


def test_parse_flow_map_list_with_quoted_value_containing_comma():
    # The flow-list splitter must respect quotes — a comma inside `"a,b"`
    # is part of the value, not an item separator.
    text = '---\nlinks: [{kind: local, target: "src,docs"}]\n---\n'
    assert parse_frontmatter(text) == {
        "links": [{"kind": "local", "target": "src,docs"}],
    }


# ---------------------------------------------------------------------------
# Mixed top-level fields — scalars + list-of-strings + list-of-dicts.
# ---------------------------------------------------------------------------


def test_parse_mixed_scalar_keywords_links():
    text = (
        "---\n"
        "name: combat\n"
        "owner: alice\n"
        "description: combat module\n"
        "keywords:\n"
        "  - rpg\n"
        "  - turn-based\n"
        "status: implemented\n"
        "links:\n"
        "  - kind: local\n"
        "    target: src/combat\n"
        "  - kind: local\n"
        "    target: src/combat-ui\n"
        "---\n"
    )
    meta = parse_frontmatter(text)
    assert meta == {
        "name": "combat",
        "owner": "alice",
        "description": "combat module",
        "keywords": ["rpg", "turn-based"],
        "status": "implemented",
        "links": [
            {"kind": "local", "target": "src/combat"},
            {"kind": "local", "target": "src/combat-ui"},
        ],
    }


# ---------------------------------------------------------------------------
# Render — scalar / scalar-list / map-list / empty-list.
# ---------------------------------------------------------------------------


def test_render_scalar_and_string_list():
    out = render_frontmatter(
        {"name": "foo", "keywords": ["a", "b"]},
        schema=("name", "keywords"),
    )
    assert out == "---\nname: foo\nkeywords:\n  - a\n  - b\n---\n"


def test_render_empty_list_uses_inline_brackets():
    assert render_frontmatter({"keywords": []}) == "---\nkeywords: []\n---\n"


def test_render_block_map_list():
    meta = {
        "links": [
            {"kind": "local", "target": "src"},
            {"kind": "local", "target": "docs"},
        ],
    }
    out = render_frontmatter(meta, schema=("links",))
    assert out == (
        "---\n"
        "links:\n"
        "  - kind: local\n"
        "    target: src\n"
        "  - kind: local\n"
        "    target: docs\n"
        "---\n"
    )


def test_render_schema_order_then_extras_in_insertion_order():
    meta = {
        "extra": "z",
        "name": "foo",
        "owner": "alice",
    }
    out = render_frontmatter(meta, schema=("name", "owner"))
    assert out == "---\nname: foo\nowner: alice\nextra: z\n---\n"


# ---------------------------------------------------------------------------
# Round-trip — parse(render(meta)) == meta and render is stable.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("meta", [
    {"name": "foo"},
    {"keywords": []},
    {"keywords": ["a", "b", "c"]},
    {"links": [{"kind": "local", "target": "."}]},
    {
        "name": "combat",
        "owner": "alice",
        "description": "combat module",
        "keywords": ["rpg"],
        "status": "implemented",
        "links": [
            {"kind": "local", "target": "src/combat"},
            {"kind": "git", "url": "https://example.com/x.git", "rev": "main"},
        ],
    },
])
def test_round_trip_parse_render(meta):
    rendered = render_frontmatter(meta, schema=tuple(meta.keys()))
    assert parse_frontmatter(rendered) == meta


def test_render_is_stable_under_repeated_round_trip():
    text = (
        "---\n"
        "name: combat\n"
        "links:\n"
        "  - kind: local\n"
        "    target: src/combat\n"
        "---\n"
        "body\n"
    )
    parsed = parse_frontmatter(text)
    rendered_once = render_frontmatter(parsed, schema=("name", "links"))
    rendered_twice = render_frontmatter(
        parse_frontmatter(rendered_once), schema=("name", "links")
    )
    assert rendered_once == rendered_twice


# ---------------------------------------------------------------------------
# Edge cases — strip_frontmatter and unsupported shapes.
# ---------------------------------------------------------------------------


def test_strip_frontmatter_returns_body_without_fence():
    text = (
        "---\n"
        "name: foo\n"
        "links:\n"
        "  - kind: local\n"
        "    target: .\n"
        "---\n"
        "body text\n"
    )
    assert strip_frontmatter(text) == "body text"


def test_strip_frontmatter_no_fence_returns_stripped_text():
    assert strip_frontmatter("  hello\n  ") == "hello"


def test_parse_rejects_yaml_anchor():
    text = "---\nlinks: &anchor\n---\n"
    with pytest.raises(ValueError, match="anchors|unsupported"):
        parse_frontmatter(text)


def test_parse_rejects_yaml_tag():
    text = '---\nname: !!str foo\n---\n'
    with pytest.raises(ValueError, match="anchors|unsupported"):
        parse_frontmatter(text)


def test_parse_rejects_top_level_flow_map_value():
    # Top-level dict value isn't part of our schema — refuse loudly.
    text = "---\nmeta: {a: 1, b: 2}\n---\n"
    with pytest.raises(ValueError, match="flow map"):
        parse_frontmatter(text)


def test_parse_rejects_mixed_scalar_and_map_list():
    # Block-style: first element is a map, second is a bare scalar.
    text = (
        "---\n"
        "links:\n"
        "  - kind: local\n"
        "    target: src\n"
        "  - just-a-string\n"
        "---\n"
    )
    with pytest.raises(ValueError, match="mixes"):
        parse_frontmatter(text)


def test_parse_rejects_flow_list_mixing_scalar_and_map():
    text = "---\nlinks: [a, {kind: local}]\n---\n"
    with pytest.raises(ValueError, match="mixes"):
        parse_frontmatter(text)


def test_parse_rejects_nested_dict_of_dict_indentation():
    # Six-space indent inside a block map list = nested dict-of-dicts.
    text = (
        "---\n"
        "links:\n"
        "  - kind: local\n"
        "    target: src\n"
        "      nested: x\n"
        "---\n"
    )
    with pytest.raises(ValueError, match="indentation"):
        parse_frontmatter(text)


def test_render_rejects_mixed_list_elements():
    with pytest.raises(ValueError, match="mixes"):
        render_frontmatter({"links": [{"kind": "local"}, "scalar"]})


def test_render_rejects_top_level_dict_value():
    with pytest.raises(ValueError, match="dict"):
        render_frontmatter({"meta": {"a": 1}})


def test_render_rejects_empty_dict_in_list():
    with pytest.raises(ValueError, match="empty dict"):
        render_frontmatter({"links": [{}]})


# ---------------------------------------------------------------------------
# YAML-safe scalar quoting regression — bug fix for `render_frontmatter`
# emitting values with YAML-special leading chars (e.g. `*ResultEvent`,
# `&anchor`, `!tag`) as bare unquoted scalars, which then blew up on the
# next parse. All values below must survive `parse(render(...))` intact.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("value", [
    # Anchor / alias / tag lookalikes — the original bug report.
    "*ResultEvent",
    "&anchor-lookalike",
    "!tag-lookalike",
    "*",
    "*Updated*Event",
    # Star-in-the-middle used to work already (leading `G`); regression guard.
    "G2U*Event",
    # Directives, reserved, block-scalar heads, comments, flow openers,
    # mapping / sequence indicators — every character in _INDICATOR_LEADS
    # that trips a plain-scalar's leading position.
    "%directive",
    "@ref",
    "|literal-lookalike",
    ">folded-lookalike",
    "#leading-hash",
    "?maybe-key",
    "-dash-first",
    "[bracket",
    "{brace",
    ", comma",
])
def test_list_scalar_with_yaml_special_leading_char_round_trips(value):
    meta = {"keywords": [value]}
    rendered = render_frontmatter(meta, schema=("keywords",))
    assert parse_frontmatter(rendered) == meta


@pytest.mark.parametrize("value", [
    # Same leading-char classes but as a top-level scalar (not a list element).
    "*ResultEvent",
    "&x",
    "!x",
    # Boolean / null literals — YAML would coerce these to bool/None if
    # unquoted, but our parser returns them as strings; still, they need
    # quoting so a real YAML consumer (or a future upgrade of this parser)
    # does not lose the type distinction.
    "true",
    "false",
    "null",
    "yes",
    "no",
    # Numeric-looking strings.
    "42",
    "3.14",
    # ": " inside — would otherwise get partition-split into k/v.
    "foo: bar",
    # Trailing colon — same partition risk.
    "trailing:",
    # " #" inside — YAML treats as trailing comment start when unquoted.
    "foo #bar",
    # Empty string.
    "",
    # Leading/trailing whitespace preservation.
    "  spaced  ",
])
def test_top_level_scalar_with_yaml_special_content_round_trips(value):
    meta = {"description": value}
    rendered = render_frontmatter(meta, schema=("description",))
    assert parse_frontmatter(rendered) == meta


def test_bug_report_exact_repro_keywords_with_star_leads():
    """Verbatim reproduction of the module-frontmatter case that triggered
    this bug: a `keywords` list documenting wildcard event names, several
    of which start with `*`. Before the fix, this rendered as unquoted
    `- *ResultEvent` and the next parse crashed."""
    meta = {"keywords": ["G2U*Event", "*Updated*Event", "*ResultEvent"]}
    rendered = render_frontmatter(meta, schema=("keywords",))
    assert parse_frontmatter(rendered) == meta


@pytest.mark.parametrize("value", [
    "combat",
    "alice",
    "hello world",
    "foo-bar",
    "snake_case",
    "PascalCase",
    "with.dot",
    "path/segment",
])
def test_safe_scalars_render_without_quotes(value):
    """No-clutter guard: values that don't need quoting must render as plain
    scalars (zero double-quote characters in the frontmatter), and still
    round-trip. Prevents the fix from over-quoting benign values."""
    meta = {"description": value, "keywords": [value]}
    rendered = render_frontmatter(meta, schema=("description", "keywords"))
    assert '"' not in rendered
    assert parse_frontmatter(rendered) == meta


def test_parse_block_list_strips_quotes_symmetric_with_top_level():
    """Parser symmetry: the block-list scalar branch must strip surrounding
    quotes, matching the flow-list branch and the top-level scalar branch.
    Before the fix, quoted list elements survived with their quotes intact,
    so writer-emitted quoted data could not round-trip."""
    text = (
        "---\n"
        "keywords:\n"
        '  - "with quotes"\n'
        "  - unquoted\n"
        "---\n"
    )
    assert parse_frontmatter(text) == {
        "keywords": ["with quotes", "unquoted"],
    }


@pytest.mark.parametrize("value", ["*anchor", "&team-a"])
def test_parse_still_rejects_unquoted_alias_in_list(value):
    """Guard rail: quoting is a *writer-side* fix. The parser must continue
    to reject legitimate unquoted alias / anchor / tag syntax — that shape
    is a real YAML construct we can't faithfully round-trip, so it stays
    a hard error, not a silently-parsed string. Both values here are a
    prefix followed by a clean identifier (letters/digits/dash/underscore,
    no second special char) — indistinguishable from a real anchor/alias
    name, unlike `*Updated*Event` or `*.md` above."""
    text = f"---\nkeywords:\n  - {value}\n---\n"
    with pytest.raises(ValueError, match="anchors|unsupported"):
        parse_frontmatter(text)


@pytest.mark.parametrize("value", [
    "*Updated*Event",
    "*Created*Event",
    "*",
    "*.md",
])
def test_parse_accepts_raw_unquoted_wildcard_leading_star(value):
    """Production bug: a hand-written/legacy `.dna/module.md` had unquoted
    `- *Updated*Event` in its `keywords` list (predating the writer-side
    quoting fix above). The parser rejected it outright as an unsupported
    YAML anchor/alias, which then blocked every read of that file (dna_show,
    dna_list, project_snapshot, and any dna_edit needed to fix it) — a
    dead end, since the fix-the-file path itself required a successful
    parse first.

    None of these values are shaped like a real anchor/alias reference
    (`*anchor_name`): they either have a second special char after the
    prefix or are the bare prefix alone. They must parse as plain scalars
    without the caller pre-quoting the source file."""
    text = f"---\nkeywords:\n  - {value}\n---\n"
    assert parse_frontmatter(text) == {"keywords": [value]}


def test_render_map_list_value_with_yaml_special_leading_char_round_trips():
    """The map-list value quoting site (first_v / sub_v) is a separate code
    path from the plain-scalar and block-list branches — verify it too."""
    meta = {
        "links": [
            {"kind": "local", "target": "*Star.md"},
            {"kind": "local", "target": "&anchor-target"},
        ],
    }
    rendered = render_frontmatter(meta, schema=("links",))
    assert parse_frontmatter(rendered) == meta


# ---------------------------------------------------------------------------
# Gap 1 — quoted block-list element must not hit the dict-entry heuristic.
# A value like `"foo: bar"` used to get partition-split into `{'"foo': 'bar"'}`
# because the parser ran the `:` test on the raw (still-quoted) element text.
# ---------------------------------------------------------------------------


def test_round_trip_block_list_element_with_colon_space():
    meta = {"keywords": ["foo: bar"]}
    rendered = render_frontmatter(meta, schema=("keywords",))
    assert parse_frontmatter(rendered) == meta


def test_round_trip_block_list_element_with_trailing_colon():
    meta = {"keywords": ["trailing:"]}
    rendered = render_frontmatter(meta, schema=("keywords",))
    assert parse_frontmatter(rendered) == meta


def test_round_trip_block_list_element_with_leading_colon():
    # Edge case in the colon-in-list-element family: leading colon.
    # `_needs_quoting` fires (`:` is in _INDICATOR_LEADS) so writer quotes it;
    # reader must recognise the quoted element as a plain scalar.
    meta = {"keywords": [":leading-colon"]}
    rendered = render_frontmatter(meta, schema=("keywords",))
    assert parse_frontmatter(rendered) == meta


# ---------------------------------------------------------------------------
# Gap 2 — reader must un-escape backslash / quote / control-char sequences
# emitted by `_quote_scalar`. Without this, quoted values with embedded
# specials round-trip with literal backslashes preserved (`\"quoted\"`
# instead of `"quoted"`).
# ---------------------------------------------------------------------------


def test_round_trip_top_level_scalar_with_embedded_double_quotes():
    meta = {"description": '"quoted"'}
    rendered = render_frontmatter(meta, schema=("description",))
    assert parse_frontmatter(rendered) == meta


def test_round_trip_top_level_scalar_star_leading_with_embedded_quote():
    meta = {"description": '*a"b'}
    rendered = render_frontmatter(meta, schema=("description",))
    assert parse_frontmatter(rendered) == meta


def test_round_trip_scalar_with_embedded_backslash_and_quote():
    # Ordering-bug catcher: escape does `\\`→`\\\\` first, then `"`→`\\"`,
    # so unescape must do the inverse in the right order. A naive
    # sequential-replace unescape (`\\\\`→`\\` then `\\"`→`"`) will mis-decode
    # this input; the single-pass walker in `_unescape_scalar` gets it right.
    meta = {"description": 'back\\slash and "quote"'}
    rendered = render_frontmatter(meta, schema=("description",))
    assert parse_frontmatter(rendered) == meta


def test_round_trip_scalar_with_embedded_newline():
    # `_quote_scalar` escapes real newlines as literal `\n` when the value
    # is quoted (rule 7: quote if `\n` or control char present). Reader must
    # translate the literal `\n` back to a real newline for the round trip.
    meta = {"description": "line1\nline2"}
    rendered = render_frontmatter(meta, schema=("description",))
    # Sanity: the rendered form contains no real newline in the value line
    # (the newline was escaped to `\n`), so parsing is still line-safe.
    assert "line1\\nline2" in rendered
    assert parse_frontmatter(rendered) == meta


def test_round_trip_scalar_with_embedded_tab_and_cr():
    # Mirror-escape verification for the remaining control chars that
    # `_quote_scalar` explicitly handles.
    meta = {"description": "col1\tcol2\rend"}
    rendered = render_frontmatter(meta, schema=("description",))
    assert parse_frontmatter(rendered) == meta


def test_round_trip_block_list_element_with_embedded_quote():
    # Gap 1 + Gap 2 together: block-list branch must both skip the
    # dict-entry heuristic on quoted elements AND unescape the payload.
    meta = {"keywords": ['embedded "quote" here']}
    rendered = render_frontmatter(meta, schema=("keywords",))
    assert parse_frontmatter(rendered) == meta


def test_round_trip_map_list_value_with_embedded_quote():
    # Third quote-strip site (nested-map value) must also unescape.
    meta = {"links": [{"kind": "local", "target": 'has "quote" in name'}]}
    rendered = render_frontmatter(meta, schema=("links",))
    assert parse_frontmatter(rendered) == meta


def test_round_trip_flow_list_scalar_with_embedded_quote():
    # Fourth quote-strip site (flow-list scalar element) must also unescape.
    # Route through a hand-written frontmatter using flow syntax rather than
    # the writer (the writer always emits block-style scalar lists), so we
    # exercise the flow-list unescape branch directly.
    text = '---\nkeywords: ["has \\"quote\\" here", plain]\n---\n'
    assert parse_frontmatter(text) == {
        "keywords": ['has "quote" here', "plain"],
    }
