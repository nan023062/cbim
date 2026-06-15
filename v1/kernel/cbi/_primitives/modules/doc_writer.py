"""write_module_doc — body-only replace of .dna/{module.md,contract.md}.

Preserves any leading YAML frontmatter byte-for-byte; atomic via .tmp +
os.replace.
"""

import os
from pathlib import Path

_WRITE_DOC_ALLOWED = ("module.md", "contract.md")


def write_module_doc(mod_dir: Path, file_name: str, body: str) -> Path:
    """Replace the markdown body of <mod_dir>/.dna/<file_name>, preserving any
    leading YAML frontmatter verbatim.

    Rules:
      - file_name must be 'module.md' or 'contract.md'; anything else raises ValueError.
      - <mod_dir>/.dna/ must already exist (i.e. `dna init` has been run); otherwise FileNotFoundError.
      - If the target file does not yet exist, it is created (body only, no frontmatter).
      - If the target file exists and starts with `---` frontmatter, the frontmatter is
        preserved exactly as on disk and only the body is replaced.
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
                # Keep frontmatter block byte-for-byte: from start through "\n---" and its trailing newline.
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


__all__ = ["_WRITE_DOC_ALLOWED", "write_module_doc"]
