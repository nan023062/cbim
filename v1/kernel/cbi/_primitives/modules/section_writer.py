"""Section-level surgical edits on .dna/{module.md,contract.md} bodies.

Frontmatter is preserved byte-for-byte; only the body is rewritten. Atomic
via .tmp + os.replace, like write_module_doc.
"""

import os
import sys
from pathlib import Path

from services._fm import parse_frontmatter

from .section_parser import (
    _normalize_content_lines,
    _split_frontmatter_block,
    _split_sections,
)

_WRITE_SECTION_ALLOWED = ("module.md", "contract.md")
_WRITE_SECTION_MODES = ("replace", "append", "insert-after", "delete")


def write_module_section(
    mod_dir: Path,
    file_name: str,
    heading: str,
    level: int,
    mode: str,
    content: str | None,
    create_if_missing: bool = False,
    dry_run: bool = False,
) -> Path | str:
    """Section-level surgical edit of <mod_dir>/.dna/<file_name>.

    Returns the absolute Path of the written file on success, or the resulting
    file content (str) when dry_run=True.

    Modes:
      - 'replace'      : replace section body (keep heading line)
      - 'append'       : append content to end of section body
      - 'insert-after' : insert content as a new section right after this one
      - 'delete'       : remove heading line and its body

    Raises ValueError / FileNotFoundError on misuse; raises LookupError when the
    heading cannot be found and create_if_missing is not applicable.
    """
    if file_name not in _WRITE_SECTION_ALLOWED:
        raise ValueError(
            f"--file must be one of {_WRITE_SECTION_ALLOWED}, got: {file_name!r}"
        )
    if mode not in _WRITE_SECTION_MODES:
        raise ValueError(
            f"--mode must be one of {_WRITE_SECTION_MODES}, got: {mode!r}"
        )
    if level not in (2, 3):
        raise ValueError(f"--level must be 2 or 3, got: {level!r}")
    if mode == "delete":
        if content is not None:
            raise ValueError("--content is forbidden when --mode delete")
    else:
        if content is None:
            raise ValueError(f"--content is required when --mode {mode}")

    aimod = mod_dir.resolve() / ".dna"
    if not aimod.is_dir():
        raise FileNotFoundError(
            f"module not initialized at {mod_dir}; run `dna init` first "
            f"(missing {aimod})"
        )

    target = aimod / file_name
    if not target.is_file():
        raise FileNotFoundError(
            f"file does not exist: {target} (use `dna init` or `dna write-doc` "
            f"to create it first)"
        )

    original = target.read_text(encoding="utf-8")
    had_frontmatter = original.startswith("---") and original.find("\n---", 3) != -1
    original_meta = parse_frontmatter(original) if had_frontmatter else {}

    frontmatter_block, body_text = _split_frontmatter_block(original)
    body_lines = body_text.splitlines()

    sections = _split_sections(body_text)
    matches = [s for s in sections if s.level == level and s.heading == heading]

    if len(matches) > 1:
        raise LookupError(
            f"ambiguous: {len(matches)} sections match heading "
            f"'{heading}' at level {level}; heading must be unique within file"
        )

    if not matches:
        # Heading absent — behaviour depends on mode.
        if mode == "delete":
            # No-op: report on stderr, return current file path.
            print(
                f"write-section: heading not found: '{heading}' at level {level}; "
                f"delete is a no-op",
                file=sys.stderr,
            )
            return target
        if mode == "insert-after":
            raise LookupError(
                f"heading not found: '{heading}' at level {level} "
                f"(insert-after has no create-if-missing fallback)"
            )
        # replace / append
        if not create_if_missing:
            raise LookupError(
                f"heading not found: '{heading}' at level {level} "
                f"(pass --create-if-missing to append a new section instead)"
            )
        # Create a new section at EOF.
        content_lines = _normalize_content_lines(content or "")
        new_lines = list(body_lines)
        # Ensure separation before the new section.
        while new_lines and new_lines[-1].strip() == "":
            new_lines.pop()
        if new_lines:
            new_lines.append("")
        new_lines.append(f"{'#' * level} {heading}")
        new_lines.append("")
        new_lines.extend(content_lines)
    else:
        sec = matches[0]
        content_lines = _normalize_content_lines(content) if content is not None else []
        new_lines = list(body_lines)

        if mode == "replace":
            # Keep heading line; replace lines (start+1 .. end) with blank + content + blank.
            replacement = [""] + content_lines + [""]
            new_lines[sec.start + 1:sec.end] = replacement
        elif mode == "append":
            # Insert content_lines just before sec.end. Ensure a leading blank
            # line if the section body doesn't already end in one.
            insertion: list[str] = []
            # Determine if section body already ends in blank.
            tail_blank = (sec.end - 1 >= sec.start + 1) and \
                new_lines[sec.end - 1].strip() == ""
            if not tail_blank:
                insertion.append("")
            insertion.extend(content_lines)
            insertion.append("")
            new_lines[sec.end:sec.end] = insertion
        elif mode == "insert-after":
            # Caller provides the heading line themselves. Surround with blanks.
            insertion = [""] + content_lines + [""]
            new_lines[sec.end:sec.end] = insertion
        elif mode == "delete":
            # Drop the section entirely. Collapse surrounding double blanks.
            del new_lines[sec.start:sec.end]
            # Collapse: if both the line before and after the deletion site are
            # blank, drop one.
            i = sec.start
            if 0 < i < len(new_lines):
                if new_lines[i - 1].strip() == "" and new_lines[i].strip() == "":
                    del new_lines[i]

    # Reassemble file. Drop leading blanks in body and re-insert exactly one
    # separator blank line between frontmatter and body, so the output is
    # idempotent under repeated edits.
    while new_lines and new_lines[0].strip() == "":
        new_lines.pop(0)
    new_body = "\n".join(new_lines).rstrip() + "\n"
    if frontmatter_block:
        # frontmatter_block already ends in "\n"; add one blank line then body.
        new_content = frontmatter_block + "\n" + new_body
    else:
        new_content = new_body

    # Validate frontmatter still parses if it did before.
    if had_frontmatter:
        new_meta = parse_frontmatter(new_content)
        if not new_meta and original_meta:
            raise RuntimeError(
                "post-edit frontmatter failed to parse; aborting (file unchanged)"
            )

    if dry_run:
        return new_content

    tmp = target.with_suffix(target.suffix + ".tmp")
    try:
        tmp.write_text(new_content, encoding="utf-8")
        os.replace(tmp, target)
    except Exception:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
        raise

    return target


__all__ = [
    "_WRITE_SECTION_ALLOWED",
    "_WRITE_SECTION_MODES",
    "write_module_section",
]
