"""Markdown body parsing — heading regex, fence regex, _Section dataclass,
and the section-walker used by section_writer and splitter.
"""

import re
from dataclasses import dataclass, field

# Heading: 1-6 '#'s, space, text, optional trailing '#'s. Only matched outside
# fenced code blocks (see _split_sections).
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
# Code-fence opener/closer. Toggled regardless of language tag after the fence.
_FENCE_RE = re.compile(r"^(?:```|~~~)")


@dataclass
class _Section:
    level: int           # 1..6
    heading: str         # trimmed text, no leading '#'s
    start: int           # line index of the heading line
    end: int             # line index after the section (exclusive)
    body_lines: list[str] = field(default_factory=list)


def _split_frontmatter_block(text: str) -> tuple[str, str]:
    """Return (frontmatter_block, body_text). frontmatter_block includes the
    closing '---' and its trailing newline if present. If no frontmatter,
    returns ('', text)."""
    if not text.startswith("---"):
        return "", text
    end = text.find("\n---", 3)
    if end == -1:
        return "", text
    fm_end = end + 4  # past "\n---"
    if fm_end < len(text) and text[fm_end] == "\n":
        fm_end += 1
    return text[:fm_end], text[fm_end:]


def _split_sections(body_text: str) -> list[_Section]:
    """Walk markdown body lines and return all headings as _Section objects,
    skipping headings inside fenced code blocks. section.end points to the
    start of the next section whose level <= section.level, or len(lines).
    """
    lines = body_text.splitlines()
    in_fence = False
    raw: list[_Section] = []
    for i, line in enumerate(lines):
        if _FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = _HEADING_RE.match(line)
        if not m:
            continue
        level = len(m.group(1))
        heading = m.group(2).strip()
        raw.append(_Section(level=level, heading=heading, start=i, end=len(lines)))

    # Compute end for each section: index of next section with level <= self.level.
    for idx, sec in enumerate(raw):
        end = len(lines)
        for j in range(idx + 1, len(raw)):
            if raw[j].level <= sec.level:
                end = raw[j].start
                break
        sec.end = end
        sec.body_lines = lines[sec.start + 1:end]
    return raw


def _normalize_content_lines(content: str) -> list[str]:
    """Strip surrounding newlines and split into lines (no trailing empty)."""
    return content.strip("\n").splitlines()


__all__ = [
    "_HEADING_RE",
    "_FENCE_RE",
    "_Section",
    "_split_frontmatter_block",
    "_split_sections",
    "_normalize_content_lines",
]
