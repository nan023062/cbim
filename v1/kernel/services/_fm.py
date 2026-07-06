"""
services/_fm.py — frontmatter helpers shared across service modules.

Intentionally minimal: a permissive scalar/list YAML-frontmatter parser
that matches what dashboard/server.py used to do inline. No PyYAML dep.

Supported list element shapes (per v2 `links` schema, PR-1):
  - scalars (block- or flow-style)        ->  list[str]
  - dict elements (block- or flow-style)  ->  list[dict[str, str]]

Block-style nested map list ("- key: value" plus 4-space-continuation
"    target: src" lines) and flow-style nested map list
("[{kind: local, target: \".\"}]") both round-trip back to a Python
list of dicts. Mixed lists (some scalars, some dicts in the same key)
are NOT supported and raise ValueError — the caller's frontmatter is
broken, not this parser.

Anchors / tags / `!!str` / nested dicts-of-dicts / multi-document
streams are also rejected with a clear ValueError; we do not silently
drop unsupported shapes. Round-trip self-consistency is the contract:

    parse_frontmatter(render_frontmatter(meta)) == meta

for every meta this parser is willing to accept.
"""

from __future__ import annotations

import re


_UNSUPPORTED_PREFIXES = ("&", "*", "!")


def _unescape_scalar(s: str) -> str:
    """Reverse the escapes produced by `_quote_scalar` (double-quoted values).

    Single-pass character walker: on encountering a backslash, translate
    the next character per the mirror of `_quote_scalar`'s replacement
    table. Unknown escapes are preserved verbatim (backslash + the
    following char), matching this module's forgiving-parser stance —
    strict rejection here would surprise callers who hand-write quoted
    values.

    A single-pass walker is required (not sequential `str.replace`s):
    the escape order in `_quote_scalar` is backslash-first-then-quote,
    so a value containing both a literal backslash AND a literal quote
    round-trips through a `\\\\` + `\\"` sequence which a naive replace
    chain would mis-decode.
    """
    out: list[str] = []
    i = 0
    n = len(s)
    while i < n:
        ch = s[i]
        if ch == "\\" and i + 1 < n:
            nxt = s[i + 1]
            if nxt == "\\":
                out.append("\\")
            elif nxt == '"':
                out.append('"')
            elif nxt == "n":
                out.append("\n")
            elif nxt == "t":
                out.append("\t")
            elif nxt == "r":
                out.append("\r")
            elif nxt == "0":
                out.append("\x00")
            else:
                out.append("\\")
                out.append(nxt)
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _is_quoted(s: str) -> bool:
    """True when `s` is wrapped in a matched pair of `'`/`"` quotes."""
    return len(s) >= 2 and s[0] == s[-1] and s[0] in "'\""


def _strip_quotes(s: str) -> str:
    """Strip a single layer of surrounding quotes if balanced.

    For double-quoted values, also reverses the backslash / control-char
    escapes applied by `_quote_scalar` — the round-trip contract in the
    module docstring depends on it. Single-quoted values are stripped
    but not unescaped (our writer never emits single quotes; parsers
    reading hand-written single-quoted content get raw inner content,
    which is what YAML plain-scalar semantics call for).
    """
    if _is_quoted(s):
        inner = s[1:-1]
        if s[0] == '"':
            return _unescape_scalar(inner)
        return inner
    return s


# Leading characters that make a plain YAML scalar ambiguous or invalid.
# Anchors/aliases/tags (`&`, `*`, `!`), directives (`%`), unquoted flow
# indicators (`,`, `[`, `]`, `{`, `}`), block scalar heads (`|`, `>`),
# comments (`#`), quotes (`'`, `"`), mapping / sequence indicators
# (`:`, `-`, `?`), reserved (`@`, `` ` ``).
_INDICATOR_LEADS = frozenset("*&!%@`#|>'\",[]{}?:-")

_BOOL_NULL_LITERALS = frozenset({
    "true", "false", "yes", "no", "on", "off", "null", "~",
})

_NUMERIC_RES = (
    re.compile(r"^-?\d+$"),
    re.compile(r"^-?\d+\.\d*([eE][+-]?\d+)?$"),
    re.compile(r"^-?\.\d+([eE][+-]?\d+)?$"),
    re.compile(r"^0[xX][0-9a-fA-F]+$"),
    re.compile(r"^0[oO][0-7]+$"),
)


def _needs_quoting(s: str) -> bool:
    """True when `s` cannot survive a plain-scalar round-trip through our parser."""
    if s == "":
        return True
    if s.strip() != s:
        return True
    if s[0] in _INDICATOR_LEADS:
        return True
    if s.endswith(":"):
        return True
    if ": " in s:
        return True
    if " #" in s:
        return True
    for ch in s:
        code = ord(ch)
        if ch == "\n" or (code < 0x20 and ch != "\t") or code == 0x7f:
            return True
    if s.lower() in _BOOL_NULL_LITERALS:
        return True
    for pat in _NUMERIC_RES:
        if pat.match(s):
            return True
    if s in ("...", "---"):
        return True
    return False


def _quote_scalar(val) -> str:
    """Render `val` as a YAML-safe scalar.

    Returns the string unchanged (plain scalar) when it can survive our
    permissive parser unquoted; otherwise wraps in double quotes with the
    standard backslash + control-char escapes. Non-string inputs are cast
    via `str()` first so boolean/number rules still trigger.
    """
    s = val if isinstance(val, str) else str(val)
    if not _needs_quoting(s):
        return s
    # Order matters: escape backslashes first, then the char classes that
    # produce a backslash + letter output. Control chars use the standard
    # YAML double-quoted escapes.
    escaped = (
        s.replace("\\", "\\\\")
         .replace('"', '\\"')
         .replace("\n", "\\n")
         .replace("\t", "\\t")
         .replace("\r", "\\r")
         .replace("\x00", "\\0")
    )
    return f'"{escaped}"'


def _check_unsupported(token: str, what: str) -> None:
    """Reject anchors/aliases/tags so callers don't silently lose data."""
    if not token:
        return
    if token[0] in _UNSUPPORTED_PREFIXES or token.startswith("!!"):
        raise ValueError(
            f"frontmatter: unsupported YAML construct in {what}: {token!r} "
            "(anchors / tags / !!str are not supported)"
        )


def _split_flow_items(inner: str) -> list[str]:
    """Split a flow-sequence body by top-level commas.

    Respects {…} nesting and quotes so `"[{kind: a, target: \"b,c\"}]"`
    yields one element, not three.
    """
    out: list[str] = []
    depth = 0
    quote: str | None = None
    buf: list[str] = []
    for ch in inner:
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in "'\"":
            quote = ch
            buf.append(ch)
            continue
        if ch in "[{":
            depth += 1
            buf.append(ch)
            continue
        if ch in "]}":
            depth -= 1
            buf.append(ch)
            continue
        if ch == "," and depth == 0:
            out.append("".join(buf).strip())
            buf = []
            continue
        buf.append(ch)
    tail = "".join(buf).strip()
    if tail:
        out.append(tail)
    return out


def _parse_flow_map(body: str) -> dict[str, str]:
    """Parse `k1: v1, k2: "v 2"` (no surrounding braces) into a str->str dict."""
    result: dict[str, str] = {}
    for piece in _split_flow_items(body):
        if ":" not in piece:
            raise ValueError(
                f"frontmatter: flow-map entry missing ':' separator: {piece!r}"
            )
        k, _, v = piece.partition(":")
        k = k.strip()
        v = _strip_quotes(v.strip())
        _check_unsupported(v, f"flow-map value for key {k!r}")
        if not k:
            raise ValueError(f"frontmatter: empty key in flow map: {piece!r}")
        result[k] = v
    return result


def _parse_flow_list(value: str) -> list:
    """Parse a flow-style list value like `[a, b]` or `[{k: v}, {k: v}]`.

    Caller guarantees value starts with `[` and ends with `]`. Returns
    `list[str]` (scalar elements only) or `list[dict[str,str]]` (every
    element a `{...}` map). Mixed scalar+map lists are rejected.
    """
    inner = value[1:-1].strip()
    if not inner:
        return []
    items = _split_flow_items(inner)
    has_map = any(it.startswith("{") and it.endswith("}") for it in items)
    has_scalar = any(not (it.startswith("{") and it.endswith("}")) for it in items)
    if has_map and has_scalar:
        raise ValueError(
            "frontmatter: flow list mixes map elements with scalar elements; "
            "every element must be the same shape"
        )
    if has_map:
        out_maps: list[dict[str, str]] = []
        for it in items:
            if not (it.startswith("{") and it.endswith("}")):
                raise ValueError(
                    f"frontmatter: flow-list element must be a flow map: {it!r}"
                )
            out_maps.append(_parse_flow_map(it[1:-1]))
        return out_maps
    return [_strip_quotes(it) for it in items]


def _is_block_map_list_continuation(line: str) -> bool:
    """Block-style continuation: 4-space indent, no leading '-', has ':'."""
    if not line.startswith("    "):
        return False
    rest = line[4:]
    if rest.startswith(" "):
        # Deeper-than-4 indent = nested map under a list element; we don't
        # support dict-of-dict, raise so the caller doesn't silently lose it.
        raise ValueError(
            f"frontmatter: nested-map indentation deeper than 4 spaces is not "
            f"supported: {line!r}"
        )
    if rest.startswith("- "):
        return False
    return ":" in rest


def parse_frontmatter(text: str) -> dict:
    """Parse a leading `---\\n...\\n---` block. Returns {} when absent.

    Recognised value shapes:
      - scalar:                         ``key: value``
      - empty list:                     ``key: []``
      - flow scalar list:               ``key: [a, b, c]``
      - flow nested-map list:           ``key: [{k: v, ...}, {k: v, ...}]``
      - block scalar list:              ``key:\\n  - a\\n  - b``
      - block nested-map list:          ``key:\\n  - k: v\\n    k2: v2``

    Raises ``ValueError`` on shapes we can't faithfully round-trip
    (anchors/tags, mixed scalar+map lists, nested dict-of-dicts,
    multi-document streams, etc.).
    """
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}

    body = text[3:end]
    meta: dict = {}
    current_key = ""
    current_dict: dict | None = None  # the dict element we're filling
    lines = body.splitlines()

    for raw in lines:
        # Skip blank lines and comments (full-line, not trailing — keeping
        # trailing-comment parsing out is a deliberate scope cap).
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue

        # ---- block-style list element ("  - ...") ----
        if raw.startswith("  - ") and current_key:
            if not isinstance(meta.get(current_key), list):
                meta[current_key] = []
            element = raw[4:].strip()
            _check_unsupported(element, f"list element under {current_key!r}")
            # A quoted element is always a plain scalar — the `:` inside it
            # is content, not a mapping indicator. Skip the dict-entry
            # heuristic before it corrupts values like `"foo: bar"` into
            # `{'"foo': 'bar"'}`.
            if _is_quoted(element):
                if meta[current_key] and isinstance(meta[current_key][-1], dict):
                    raise ValueError(
                        f"frontmatter: list under {current_key!r} mixes scalar "
                        "and map elements"
                    )
                current_dict = None
                meta[current_key].append(_strip_quotes(element))
                continue
            if ":" in element and not (element.startswith("{") and element.endswith("}")):
                # `- k: v` opens a new dict element; subsequent 4-space
                # `    k2: v2` lines append into it until the next `  - ` or
                # next top-level key.
                k, _, v = element.partition(":")
                k = k.strip()
                v = _strip_quotes(v.strip())
                if not k:
                    raise ValueError(
                        f"frontmatter: list-of-map entry missing key: {element!r}"
                    )
                # Sanity: don't mix scalar and dict elements within one key.
                if meta[current_key] and not isinstance(meta[current_key][-1], dict):
                    raise ValueError(
                        f"frontmatter: list under {current_key!r} mixes map "
                        "and scalar elements"
                    )
                current_dict = {k: v}
                meta[current_key].append(current_dict)
            elif element.startswith("{") and element.endswith("}"):
                # Inline flow map inside a block list — uncommon but legal.
                current_dict = None  # closed; flow maps don't continue
                if meta[current_key] and not isinstance(meta[current_key][-1], dict):
                    raise ValueError(
                        f"frontmatter: list under {current_key!r} mixes map "
                        "and scalar elements"
                    )
                meta[current_key].append(_parse_flow_map(element[1:-1]))
            else:
                # Plain scalar list element.
                if meta[current_key] and isinstance(meta[current_key][-1], dict):
                    raise ValueError(
                        f"frontmatter: list under {current_key!r} mixes scalar "
                        "and map elements"
                    )
                current_dict = None
                meta[current_key].append(_strip_quotes(element))
            continue

        # ---- continuation of the current dict element ----
        if current_dict is not None and _is_block_map_list_continuation(raw):
            kv = raw[4:]
            k, _, v = kv.partition(":")
            k = k.strip()
            v = _strip_quotes(v.strip())
            if not k:
                raise ValueError(
                    f"frontmatter: continuation line missing key: {raw!r}"
                )
            current_dict[k] = v
            continue

        # Anything else terminates the current dict element.
        current_dict = None

        # ---- top-level "key: value" ----
        if ":" in stripped:
            k, _, v = stripped.partition(":")
            k = k.strip()
            v = v.strip()
            if not k:
                raise ValueError(f"frontmatter: empty key in line: {raw!r}")
            current_key = k

            if not v:
                # Block list / empty scalar — defer until we see continuations.
                meta[k] = []
            elif v.startswith("[") and v.endswith("]"):
                meta[k] = _parse_flow_list(v)
            elif v.startswith("{") and v.endswith("}"):
                # Top-level flow map = a single dict value. We don't support
                # dict-of-dict frontmatter; fail loud rather than silently.
                raise ValueError(
                    f"frontmatter: top-level flow map values are not "
                    f"supported (key {k!r})"
                )
            else:
                _check_unsupported(v, f"scalar value for key {k!r}")
                meta[k] = _strip_quotes(v)
            continue

        # Lines we don't recognise (no ':' at top level, no list-element
        # marker) are surprising — refuse rather than guess.
        raise ValueError(f"frontmatter: cannot parse line: {raw!r}")

    return meta


def strip_frontmatter(text: str) -> str:
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            return text[end + 4:].strip()
    return text.strip()


def render_frontmatter(meta: dict, schema: tuple[str, ...] = ()) -> str:
    """Render `meta` as a `---\\n...\\n---\\n` YAML frontmatter block.

    Fields listed in `schema` are emitted first, in the given order, only if
    present in `meta`. Remaining keys follow in insertion order. Lists render
    block-style when populated (``key:`` then ``  - item`` lines) and ``[]``
    when empty. List elements that are dicts render as block-style nested
    maps (``  - k: v`` then 4-space-indented continuations). Scalar values
    render as ``key: value``.
    """
    lines: list[str] = ["---"]
    emitted: set[str] = set()
    for key in schema:
        if key in meta:
            lines.extend(_render_field(key, meta[key]))
            emitted.add(key)
    for key, val in meta.items():
        if key in emitted:
            continue
        lines.extend(_render_field(key, val))
    lines.append("---")
    return "\n".join(lines) + "\n"


def _render_field(key: str, val) -> list[str]:
    if isinstance(val, list):
        if not val:
            return [f"{key}: []"]
        # Determine list-element shape; reject mixed.
        all_dicts = all(isinstance(item, dict) for item in val)
        all_scalars = all(not isinstance(item, (dict, list)) for item in val)
        if not (all_dicts or all_scalars):
            raise ValueError(
                f"frontmatter: list under {key!r} mixes map and scalar elements"
            )
        out = [f"{key}:"]
        if all_scalars:
            for item in val:
                out.append(f"  - {_quote_scalar(item)}")
            return out
        # all_dicts: block-style nested map list
        for item in val:
            if not item:
                # Empty dict in a list has no faithful block form; refuse.
                raise ValueError(
                    f"frontmatter: empty dict element under {key!r} cannot be "
                    "rendered (no fields to anchor the '- ' line)"
                )
            keys_iter = iter(item.items())
            first_k, first_v = next(keys_iter)
            out.append(f"  - {first_k}: {_quote_scalar(first_v)}")
            for sub_k, sub_v in keys_iter:
                out.append(f"    {sub_k}: {_quote_scalar(sub_v)}")
        return out
    if isinstance(val, dict):
        raise ValueError(
            f"frontmatter: top-level dict value under {key!r} is not "
            "supported (use a list of dicts or a scalar)"
        )
    return [f"{key}: {_quote_scalar(val)}"]
