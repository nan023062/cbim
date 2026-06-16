"""hooks_src/_lib/turn_capture.py — pure helpers for per-turn realtime capture.

Phase 4 of the memory redesign. Stop / SubagentStop hooks call into here to
turn a Claude Code transcript JSONL into zero-or-one structured "incoming
candidate" line.

Pure stdlib. No engine imports, no filesystem writes. The hook shell drives
the IO; this module only does:

  - read_last_n_lines(path, n)   — reverse-read tail of a JSONL file.
  - parse_jsonl_records(lines)   — JSON-decode + drop garbage.
  - last_complete_turn(records)  — slice the last user→assistant→... turn.
  - turn_has_user_input(turn)    — filter pure tool-roundtrip turns.
  - extract_turn_text(turn)      — concatenate user + assistant text for grep.
  - find_signal_hits(text)       — return list of (category, snippet).
  - redact(text)                 — low-cost regex masking of secrets.

Failure stance: every helper is best-effort; on bad input it returns an
empty / safe value rather than raising. The hook layer stays exit-0.
"""

from __future__ import annotations

import json
import os
import re
from typing import Iterable


# ---------------------------------------------------------------------------
# Reverse JSONL reader
# ---------------------------------------------------------------------------

# Default chunk size for the seek-backwards reader. 64 KiB is plenty for
# typical CC turns; large enough that 50 MiB transcripts finish in <100ms,
# small enough that we don't waste a megabyte for short logs.
_REVERSE_CHUNK = 64 * 1024


def read_last_n_lines(path: str, n: int) -> list[str]:
    """Return up to the last `n` non-empty text lines of a UTF-8 file.

    Uses ``seek`` from the end so a 50 MiB transcript doesn't get fully
    loaded. Returns ``[]`` when the file is missing, unreadable, or empty.
    Lines are returned **in original order** (oldest of the tail first,
    newest last) — this matches "list-of-records" semantics callers expect.

    The decoder is utf-8 with errors="replace": a torn multi-byte character
    at the chunk boundary may produce one replacement char on the spliced
    line, but never raises.
    """
    if not isinstance(path, str) or not path or n <= 0:
        return []
    try:
        size = os.path.getsize(path)
    except OSError:
        return []
    if size <= 0:
        return []

    try:
        f = open(path, "rb")
    except OSError:
        return []

    collected: list[bytes] = []
    leftover = b""
    pos = size
    try:
        while pos > 0 and len(collected) <= n:
            read_size = min(_REVERSE_CHUNK, pos)
            pos -= read_size
            f.seek(pos)
            chunk = f.read(read_size)
            if not chunk:
                break
            buf = chunk + leftover
            parts = buf.split(b"\n")
            # The first element of `parts` may be a partial line whose
            # head still lives in an earlier chunk; preserve it as
            # leftover for the next iteration. Special case: when pos==0
            # we've read the whole file, so the first part is a complete
            # line, and we flush it.
            if pos > 0:
                leftover = parts[0]
                tail_lines = parts[1:]
            else:
                leftover = b""
                tail_lines = parts
            # Append in reverse so `collected` ends up newest-first while
            # iterating — we'll flip at the end.
            for line in reversed(tail_lines):
                if line.strip():
                    collected.append(line)
                    if len(collected) >= n:
                        break
    finally:
        try:
            f.close()
        except OSError:
            pass

    collected.reverse()  # restore chronological order
    out: list[str] = []
    for raw in collected[-n:]:
        try:
            decoded = raw.decode("utf-8", errors="replace")
        except UnicodeDecodeError:
            continue
        # Tolerate CRLF — splitting on b"\n" leaves a trailing \r on Windows.
        if decoded.endswith("\r"):
            decoded = decoded[:-1]
        out.append(decoded)
    return out


# ---------------------------------------------------------------------------
# JSONL → record list
# ---------------------------------------------------------------------------


def parse_jsonl_records(lines: Iterable[str]) -> list[dict]:
    """Decode a list of JSONL lines into dicts; drop non-object / malformed rows."""
    out: list[dict] = []
    for ln in lines:
        if not ln:
            continue
        s = ln.strip()
        if not s:
            continue
        try:
            obj = json.loads(s)
        except (ValueError, TypeError):
            continue
        if isinstance(obj, dict):
            out.append(obj)
    return out


# ---------------------------------------------------------------------------
# Turn segmentation
# ---------------------------------------------------------------------------

# A "turn" is the slice [user_prompt, assistant_reply, tool_use*, tool_result*]
# from one user message up to (but not including) the next user message. Pure
# tool-roundtrip turns (no user input in the slice) are filtered out by
# ``turn_has_user_input``. We err on the side of conservative classification:
# unknown / missing role → ignored.

_USER_ROLES = ("user",)
_ASSIST_ROLES = ("assistant",)


def _record_role(rec: dict) -> str:
    """Best-effort role extraction from a CC transcript record.

    CC writes records as either ``{"type": "user", "message": {...}}`` or
    ``{"role": "user", ...}`` depending on the surface. We accept both,
    plus ``message.role`` nesting. Unknown shapes return ``""``.
    """
    t = rec.get("type")
    if isinstance(t, str) and t:
        return t
    r = rec.get("role")
    if isinstance(r, str) and r:
        return r
    msg = rec.get("message")
    if isinstance(msg, dict):
        r2 = msg.get("role")
        if isinstance(r2, str) and r2:
            return r2
    return ""


def last_complete_turn(records: list[dict]) -> list[dict]:
    """Return the slice from the LAST user record to the end of the list.

    Empty list if no user record is present. The slice is the in-progress
    turn boundaries we capture for; "complete" means "we have the user
    prompt and any assistant/tool follow-up CC has flushed". We do NOT
    require an assistant tail — partial turns still count, the snippet
    extractor falls back gracefully.
    """
    if not records:
        return []
    last_user_idx = -1
    for i in range(len(records) - 1, -1, -1):
        if _record_role(records[i]) in _USER_ROLES:
            last_user_idx = i
            break
    if last_user_idx < 0:
        return []
    return records[last_user_idx:]


def turn_has_user_input(turn: list[dict]) -> bool:
    """True iff the turn contains a user record with non-empty text content.

    "Pure tool roundtrip" = an assistant→tool_use→tool_result→assistant
    sequence with no user record carrying real content. Those skip capture.
    """
    for rec in turn:
        if _record_role(rec) not in _USER_ROLES:
            continue
        if _has_text_content(rec):
            return True
    return False


def _has_text_content(rec: dict) -> bool:
    text = _record_text(rec)
    return bool(text and text.strip())


def _record_text(rec: dict) -> str:
    """Best-effort text extraction from a CC transcript record.

    Handles three shapes seen in the wild:
      - ``rec["content"]`` is a string                  → return as-is
      - ``rec["content"]`` is a list of dicts           → concat ``text`` parts
      - ``rec["message"]["content"]`` (any of the above) → recurse one level
    Returns ``""`` when nothing text-like is found. tool_result content is
    intentionally included if it lives in a text block — distinguishing
    user prose from tool echo is the signal-word filter's job.
    """
    c = rec.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        parts = []
        for item in c:
            if isinstance(item, dict):
                t = item.get("text")
                if isinstance(t, str):
                    parts.append(t)
        if parts:
            return "\n".join(parts)
    msg = rec.get("message")
    if isinstance(msg, dict):
        return _record_text(msg)
    return ""


def extract_turn_text(turn: list[dict]) -> str:
    """Return the concatenated user + assistant text of a turn (one string).

    tool_use / tool_result records are skipped — signal words live in
    natural-language utterances, not in shell commands or JSON tool
    payloads. Empty string when the turn has no text-bearing role.
    """
    parts: list[str] = []
    for rec in turn:
        role = _record_role(rec)
        if role not in _USER_ROLES and role not in _ASSIST_ROLES:
            continue
        text = _record_text(rec)
        if text:
            parts.append(text)
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Signal-word matching
# ---------------------------------------------------------------------------

# Per the architect's decision (confirmed in user instruction):
#   decision         — 决定 / 选了 / 采用 / 拍板 / 定了 / decided / chose / going with / settled on
#   rule             — 规则是 / 原则是 / 必须 / 绝不 / 硬规则 / the rule is / must / never / always
#   negation         — 不要 / 别 / 不用 / 放弃 / don't / stop / drop / abandon
#   memory_explicit  — 记住 / 记一下 / 备忘 / 以后注意 / remember this / save this / for the record
#
# Each pattern uses word-boundary matching for ASCII; CJK signals are
# substring-matched (CJK has no \b). All patterns are compiled once.

_SIGNAL_PATTERNS: tuple[tuple[str, "re.Pattern[str]"], ...] = (
    # decision
    ("decision", re.compile(
        r"(?:决定|选了|采用|拍板|定了)"
        r"|\b(?:decided|chose|going\s+with|settled\s+on)\b",
        re.IGNORECASE,
    )),
    # rule
    ("rule", re.compile(
        r"(?:规则是|原则是|必须|绝不|硬规则)"
        r"|\b(?:the\s+rule\s+is|must|never|always)\b",
        re.IGNORECASE,
    )),
    # negation
    ("negation", re.compile(
        r"(?:不要|别|不用|放弃)"
        r"|\b(?:don'?t|stop|drop|abandon)\b",
        re.IGNORECASE,
    )),
    # explicit memory request
    ("memory_explicit", re.compile(
        r"(?:记住|记一下|备忘|以后注意)"
        r"|\b(?:remember\s+this|save\s+this|for\s+the\s+record)\b",
        re.IGNORECASE,
    )),
)


def find_signal_hits(text: str, *, max_snippet: int = 240) -> list[dict]:
    """Return one entry per signal-word category that matches in ``text``.

    Each entry: ``{"category": str, "snippet": str}``. The snippet is the
    redacted line containing the first match for that category, trimmed to
    ``max_snippet`` chars. Empty list when nothing matches.
    """
    if not isinstance(text, str) or not text:
        return []
    hits: list[dict] = []
    seen: set[str] = set()
    for category, pat in _SIGNAL_PATTERNS:
        m = pat.search(text)
        if m is None:
            continue
        if category in seen:
            continue
        seen.add(category)
        line = _line_around(text, m.start())
        snippet = redact(line)
        if len(snippet) > max_snippet:
            snippet = snippet[:max_snippet] + "..."
        hits.append({"category": category, "snippet": snippet})
    return hits


def _line_around(text: str, pos: int) -> str:
    """Return the single text line containing ``pos`` (excluding newlines)."""
    if pos < 0 or pos >= len(text):
        return ""
    left = text.rfind("\n", 0, pos)
    right = text.find("\n", pos)
    start = 0 if left < 0 else left + 1
    end = len(text) if right < 0 else right
    return text[start:end].strip()


# ---------------------------------------------------------------------------
# Redaction
# ---------------------------------------------------------------------------

# Order matters — KEY-prefixed patterns run before the generic long-token
# pattern so the labeling stays informative ("KEY" not "LONG_TOKEN").
_REDACT_PATTERNS: tuple[tuple["re.Pattern[str]", str], ...] = (
    # Vendor key prefixes (Anthropic / OpenAI / GitHub / Slack / AWS).
    # Keep the prefix in the output so debugging dumps still show what
    # KIND of secret was here.
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}"), "<REDACTED:KEY>"),
    (re.compile(r"\bghp_[A-Za-z0-9]{16,}"), "<REDACTED:KEY>"),
    (re.compile(r"\bxoxb-[A-Za-z0-9\-]{16,}"), "<REDACTED:KEY>"),
    (re.compile(r"\bAKIA[A-Z0-9]{12,}"), "<REDACTED:KEY>"),
    # Generic long unbroken token (>=32 chars of [A-Za-z0-9_]). Catches
    # most JWT body chunks and arbitrary base64 secrets. Word-boundary
    # anchored so it doesn't eat across whitespace.
    (re.compile(r"\b[A-Za-z0-9_]{32,}\b"), "<REDACTED:LONG_TOKEN>"),
)


def redact(text: str) -> str:
    """Run the low-cost redaction patterns over ``text``.

    Emails and IPs are intentionally NOT scrubbed — they have collaboration
    value (per architect's decision) and rarely encode secrets.
    """
    if not isinstance(text, str) or not text:
        return ""
    for pat, repl in _REDACT_PATTERNS:
        text = pat.sub(repl, text)
    return text
