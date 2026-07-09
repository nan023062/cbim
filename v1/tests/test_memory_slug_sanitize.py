"""cbi.resources.memory._sanitize_slug — slug hardening tests.

The slug flows into the memory entry filename under
``.cbim/memory/<tier>/<ts>-<kind>-<slug>.md`` and is later rendered by
downstream consumers (notably the dashboard, where it lands inside HTML
attribute + JS-string contexts).  ``_sanitize_slug`` is the single
choke-point that rejects anything that would either

* redirect the on-disk write outside ``.cbim/memory/<tier>/`` (path
  separators, ``..``, NUL, control chars), or
* break the HTML / JS-string contexts a downstream renderer wraps it in
  (``'``, ``"``, `````, ``<``, ``>``, ``&``).

These tests lock down both categories plus the legitimate shapes callers
depend on (spaces collapse to hyphens, Unicode passes through).
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest

from cbi.resources.memory import Memory, _sanitize_slug


# ---------------------------------------------------------------------------
# Rejected inputs — one case per newly-blacklisted metacharacter, plus a
# representative from each pre-existing category so any future regression in
# the legacy checks trips a named test.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "bad_slug, hint",
    [
        # HTML/JS string-context metacharacters (this task's addition).
        ("evil'; alert(1); //", "single quote"),
        ('evil"; alert(1); //', "double quote"),
        ("evil`; alert(1); //", "backtick"),
        ("evil<script>", "less-than"),
        ("evil>x", "greater-than"),
        ("evil&amp;x", "ampersand"),
        # Pre-existing filesystem-shape blacklist (regression coverage).
        ("../../etc/passwd", "path separator + .."),
        ("a\\b", "backslash separator"),
        ("..", "bare .."),
        ("a\x00b", "NUL byte"),
        ("a\nb", "newline control char"),
        ("", "empty"),
        ("   ", "whitespace-only"),
    ],
)
def test_sanitize_slug_rejects(bad_slug, hint):
    with pytest.raises(ValueError):
        _sanitize_slug(bad_slug)


# ---------------------------------------------------------------------------
# Accepted inputs — the shapes existing callers depend on.
# NB: single-quote-in-slug used to be accepted; the extended blacklist now
# rejects it (see the parametrised case above). Any historic caller passing
# apostrophes will start getting a clean ValueError — that is intentional
# and part of the fix.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "good_slug, expected",
    [
        ("manual-foo", "manual-foo"),
        ("foo bar baz", "foo-bar-baz"),          # spaces collapse to hyphens
        ("  padded  ", "padded"),                # outer whitespace stripped
        ("with-dashes", "with-dashes"),
        ("a1b2c3", "a1b2c3"),
        ("UNICODE-中文", "UNICODE-中文"),
    ],
)
def test_sanitize_slug_accepts(good_slug, expected):
    assert _sanitize_slug(good_slug) == expected


# ---------------------------------------------------------------------------
# End-to-end: Memory.create with an unsafe slug must raise before any file
# lands on disk. Guards against a regression where the sanitiser is
# accidentally moved to run after path.write_text (the exact ordering bug
# the original vulnerability exploited).
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "bad_slug",
    ["evil'; x", 'evil"; x', "evil`x", "evil<x", "evil>x", "evil&x"],
)
def test_memory_create_rejects_and_writes_nothing(tmp_path, bad_slug):
    root = tmp_path
    store = root / ".cbim" / "memory"

    # snapshot filesystem state before the call — expect no changes on reject.
    before = _snapshot_tree(store)

    with pytest.raises(ValueError):
        Memory.create(
            slug=bad_slug,
            content="body",
            tier="medium",
            kind="manual",
            root=root,
        )

    after = _snapshot_tree(store)
    assert before == after, (
        f"Memory.create({bad_slug!r}) leaked to disk: {after - before}"
    )
    # Also confirm nothing landed in a traversed location outside the store.
    stray = list(root.rglob(f"*{_bad_marker(bad_slug)}*"))
    assert stray == [], f"stray files created by unsafe slug: {stray}"


def _snapshot_tree(root: Path) -> set[Path]:
    if not root.exists():
        return set()
    return {p for p in root.rglob("*")}


def _bad_marker(slug: str) -> str:
    """A short substring likely to appear if the slug leaked into a filename.

    We use the alphanumeric prefix ('evil') so the glob doesn't have to
    match shell metacharacters.
    """
    for i, ch in enumerate(slug):
        if not (ch.isalnum() or ch in "-_"):
            return slug[:i] or slug[:1]
    return slug
