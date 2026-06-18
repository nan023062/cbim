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
