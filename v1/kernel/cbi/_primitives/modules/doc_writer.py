"""write_module_doc — body-only replace of .dna/{module.md,contract.md}.

For ``contract.md`` frontmatter is preserved byte-for-byte via .tmp +
os.replace.

For ``module.md`` a small extra step runs before the atomic write: the
frontmatter is parsed, the kernel-managed ``body_edited_at`` field is
stamped with ``datetime.now(timezone.utc)`` in RFC-3339 UTC shape, and the
frontmatter is re-rendered via :func:`_build_module_md`. This makes the
kernel's writer the single source of truth for ``body_edited_at`` — the
field is never hand-edited, and every module.md write path in the kernel
(``write_module_doc``, ``write_module_section``, ``init_module``,
``update_module_meta``, ``DNAModule.save``, ``split_module``) routes
through :func:`stamp_module_md_content` before hitting disk.

The re-render loosens the byte-for-byte frontmatter preservation
guarantee for module.md specifically — the trade-off is intentional and
documented in Key Decisions. contract.md keeps the byte-for-byte guarantee.
"""

import os
from datetime import datetime, timezone
from pathlib import Path

from services._fm import parse_frontmatter, strip_frontmatter

from .frontmatter_schema import _build_module_md

_WRITE_DOC_ALLOWED = ("module.md", "contract.md")

# Frontmatter key auto-maintained by the kernel on every module.md write.
_BODY_EDITED_AT_KEY = "body_edited_at"


def _now_body_edited_at() -> str:
    """Current UTC time in the canonical RFC-3339-with-Z shape.

    ``datetime.now(timezone.utc).isoformat`` emits ``+00:00`` for the
    offset, which is ISO-8601 conformant but visually noisier than the
    ``Z`` shorthand every audit report + human reader prefers. We render
    ``Z`` directly and drop sub-second precision.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def stamp_module_md_content(content: str) -> str:
    """Given the full text of a would-be module.md, stamp ``body_edited_at``
    in the frontmatter and return the re-rendered text.

    Empty or missing frontmatter is treated as "nothing to stamp" — callers
    with truly bodyless-and-frontmatterless input (splitter dry-runs, tests
    that skip frontmatter) get the original content back unchanged.
    """
    meta = parse_frontmatter(content)
    if not meta:
        return content
    body = strip_frontmatter(content)
    meta[_BODY_EDITED_AT_KEY] = _now_body_edited_at()
    return _build_module_md(meta, body)


def write_module_doc(mod_dir: Path, file_name: str, body: str) -> Path:
    """Replace the markdown body of <mod_dir>/.dna/<file_name>.

    Rules:
      - file_name must be 'module.md' or 'contract.md'; anything else raises ValueError.
      - <mod_dir>/.dna/ must already exist (i.e. `dna init` has been run); otherwise FileNotFoundError.
      - If the target file does not yet exist, it is created (body only, no frontmatter).
      - For ``contract.md``: if the target exists and starts with `---` frontmatter,
        the frontmatter is preserved exactly as on disk and only the body is replaced.
      - For ``module.md``: if the target exists and has frontmatter, the frontmatter
        is parsed, ``body_edited_at`` is stamped with the current UTC time, and the
        frontmatter is re-rendered via :func:`_build_module_md`. Byte-for-byte
        preservation is deliberately dropped for module.md — see module docstring.
      - Atomic: write to <file>.tmp then os.replace to <file>. Crash mid-write leaves
        either the old file intact or no .tmp residue visible to readers.

    Returns the absolute path of the written file.
    """
    if file_name not in _WRITE_DOC_ALLOWED:
        raise ValueError(
            f"--file must be one of {_WRITE_DOC_ALLOWED}, got: {file_name!r}"
        )

    aimod = mod_dir.resolve() / ".dna"
    if not aimod.is_dir():
        raise FileNotFoundError(
            f"module not initialized at {mod_dir}; run `dna init` first "
            f"(missing {aimod})"
        )

    target = aimod / file_name
    body_text = body if body.endswith("\n") else body + "\n"

    if target.exists():
        existing = target.read_text(encoding="utf-8")
        if existing.startswith("---"):
            end = existing.find("\n---", 3)
            if end != -1:
                # Keep frontmatter block byte-for-byte for contract.md; for
                # module.md we re-render after stamping (below).
                fm_end = end + 4  # past "\n---"
                # Preserve the single newline that conventionally follows the closing ---
                if fm_end < len(existing) and existing[fm_end] == "\n":
                    fm_end += 1
                frontmatter = existing[:fm_end]
                new_content = frontmatter + body_text
            else:
                # Malformed frontmatter (opens but never closes) — treat whole file as body, overwrite.
                new_content = body_text
        else:
            new_content = body_text
    else:
        new_content = body_text

    if file_name == "module.md":
        new_content = stamp_module_md_content(new_content)

    tmp = target.with_suffix(target.suffix + ".tmp")
    try:
        tmp.write_text(new_content, encoding="utf-8")
        os.replace(tmp, target)
    except OSError:
        # Best-effort cleanup of half-written tmp; suppress secondary errors.
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
        raise

    return target


__all__ = [
    "_WRITE_DOC_ALLOWED",
    "_BODY_EDITED_AT_KEY",
    "write_module_doc",
    "stamp_module_md_content",
    "_now_body_edited_at",
]
