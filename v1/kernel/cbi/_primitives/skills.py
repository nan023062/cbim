"""
cbi/_primitives/skills.py — agent-private skill CRUD primitives.

Two storage forms coexist under `.claude/agents/<agent>/skills/`:

  * file form  : `<skill>.md`                       (legacy, no assets)
  * dir  form  : `<skill>/skill.md` + `<skill>/assets/**`  (new, supports assets)

Detection rules (`_detect_form`):
  * only `<skill>.md`                       -> "file"
  * only `<skill>/skill.md`                 -> "dir"
  * both exist                              -> `AmbiguousSkillError`
  * neither                                 -> None

This module is the lowest layer — it does raw filesystem writes, no
executability / security judgements (those belong to services.skill_service).
The atomic file->dir upgrade inside `add_skill_asset` uses a `<skill>.tmp`
staging directory + a final `os.replace` so a mid-write crash leaves either
the untouched file form or a fully-populated dir form (the tiny window
between rename and .md unlink is detectable via `AmbiguousSkillError`).

Import scope (deliberate — see cbi/_primitives/__init__.py):
  * services._fm  (frontmatter helpers, reused not reinvented)
  * pathlib / os / shutil  (stdlib only)

Anything upward (cbi.resources, engine.*) is forbidden — would create a
dependency cycle.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from services._fm import parse_frontmatter


class AmbiguousSkillError(ValueError):
    """Raised when both file-form and dir-form exist for the same skill."""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _skill_paths(agents_dir: Path, agent: str, skill: str) -> tuple[Path, Path, Path]:
    """Return (skills_dir, file_form_path, dir_form_path)."""
    skills_dir = agents_dir / agent / "skills"
    return skills_dir, skills_dir / f"{skill}.md", skills_dir / skill


def _detect_form(file_path: Path, dir_path: Path) -> str | None:
    """Return 'file', 'dir', or None; raise AmbiguousSkillError if both exist."""
    file_exists = file_path.is_file()
    dir_exists = dir_path.is_dir() and (dir_path / "skill.md").is_file()
    if file_exists and dir_exists:
        raise AmbiguousSkillError(
            f"skill has both file-form and dir-form: "
            f"{file_path} and {dir_path / 'skill.md'}"
        )
    if file_exists:
        return "file"
    if dir_exists:
        return "dir"
    return None


def _list_assets(assets_dir: Path) -> list[str]:
    """Recursively list files under `assets_dir` as POSIX-style relative paths.

    Returns [] if the directory does not exist. Order is deterministic
    (sorted) so callers can compare snapshots.
    """
    if not assets_dir.is_dir():
        return []
    out: list[str] = []
    for p in sorted(assets_dir.rglob("*")):
        if p.is_file():
            out.append(p.relative_to(assets_dir).as_posix())
    return out


def _extract_frontmatter_block(text: str) -> str:
    """Return the leading `---\\n...\\n---` block verbatim (incl. delimiters), '' if none.

    Uses `parse_frontmatter` first to validate structural correctness; then
    extracts the raw substring so round-trip preserves whitespace / key order
    that a parse+render cycle would normalise away.
    """
    if not text.startswith("---"):
        return ""
    # Validate (raises ValueError if malformed); return value unused, we only
    # want the exception on malformed input.
    parse_frontmatter(text)
    end = text.find("\n---", 3)
    if end == -1:
        return ""
    return text[:end + 4]  # up to and including the closing '---'


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

def load_agent_skill(agents_dir: Path, agent: str, skill: str) -> dict | None:
    """Load a single skill by name.

    Returns a dict {"form", "path", "body", "assets"} or None if the skill
    does not exist. `path` is the primary markdown file (`<skill>.md` for
    file-form, `<skill>/skill.md` for dir-form). `assets` is a list of
    POSIX-style paths relative to `<skill>/assets/`, empty for file-form.
    """
    _, file_path, dir_path = _skill_paths(agents_dir, agent, skill)
    form = _detect_form(file_path, dir_path)
    if form is None:
        return None
    if form == "file":
        body = file_path.read_text(encoding="utf-8")
        return {"form": "file", "path": file_path, "body": body, "assets": []}
    md = dir_path / "skill.md"
    body = md.read_text(encoding="utf-8")
    assets = _list_assets(dir_path / "assets")
    return {"form": "dir", "path": md, "body": body, "assets": assets}


def list_agent_skills(agents_dir: Path, agent: str) -> list[dict]:
    """List every skill owned by `agent`, sorted by skill name.

    Each element mirrors `load_agent_skill`'s dict shape. Skills whose file
    form is malformed enough that `load_agent_skill` returns None are
    silently omitted; `AmbiguousSkillError` propagates so the caller sees
    the inconsistency (do not swallow — the two forms are semantically
    different).
    """
    skills_dir, _, _ = _skill_paths(agents_dir, agent, "")
    if not skills_dir.is_dir():
        return []
    names: set[str] = set()
    for p in skills_dir.iterdir():
        if p.is_file() and p.suffix == ".md":
            names.add(p.stem)
        elif p.is_dir() and (p / "skill.md").is_file():
            names.add(p.name)
    out: list[dict] = []
    for name in sorted(names):
        rec = load_agent_skill(agents_dir, agent, name)
        if rec is not None:
            out.append(rec)
    return out


# ---------------------------------------------------------------------------
# Write — create / update / delete
# ---------------------------------------------------------------------------

def create_agent_skill(
    agents_dir: Path,
    agent: str,
    skill: str,
    body: str,
    *,
    as_dir: bool = False,
) -> Path:
    """Create a new skill. Returns the primary markdown file path.

    Raises FileExistsError if either form already exists. `body` is written
    verbatim; the caller is responsible for including / excluding frontmatter
    as appropriate. When `as_dir=True` the skill is created in dir-form
    (empty `assets/` is NOT pre-created — it will materialise on first
    `add_skill_asset`).
    """
    skills_dir, file_path, dir_path = _skill_paths(agents_dir, agent, skill)
    if file_path.exists() or dir_path.exists():
        raise FileExistsError(f"skill already exists: {agent}/{skill}")
    skills_dir.mkdir(parents=True, exist_ok=True)
    if as_dir:
        dir_path.mkdir()
        target = dir_path / "skill.md"
    else:
        target = file_path
    target.write_text(body, encoding="utf-8")
    return target


def update_agent_skill_body(
    agents_dir: Path,
    agent: str,
    skill: str,
    body: str,
) -> Path:
    """Replace the skill body while preserving any existing frontmatter block.

    Returns the primary markdown file path. Raises FileNotFoundError if the
    skill does not exist. Frontmatter is preserved verbatim (raw bytes, not a
    parse+render round-trip) so key order and quoting style survive.
    """
    _, file_path, dir_path = _skill_paths(agents_dir, agent, skill)
    form = _detect_form(file_path, dir_path)
    if form is None:
        raise FileNotFoundError(f"skill not found: {agent}/{skill}")
    target = file_path if form == "file" else dir_path / "skill.md"
    original = target.read_text(encoding="utf-8")
    fm_block = _extract_frontmatter_block(original)
    body_norm = body if body.endswith("\n") else body + "\n"
    if fm_block:
        # `fm_block` ends with '---' (no trailing newline). Add a newline
        # after the closing delimiter and a blank separator line before the
        # body so the result is a canonical `---\n...\n---\n\n<body>`.
        new_content = fm_block + "\n\n" + body_norm.lstrip("\n")
    else:
        new_content = body_norm
    target.write_text(new_content, encoding="utf-8")
    return target


def delete_agent_skill(agents_dir: Path, agent: str, skill: str) -> Path:
    """Delete the skill entirely (file or full directory including assets).

    Returns the path that was removed. Raises FileNotFoundError if neither
    form is present.
    """
    _, file_path, dir_path = _skill_paths(agents_dir, agent, skill)
    form = _detect_form(file_path, dir_path)
    if form is None:
        raise FileNotFoundError(f"skill not found: {agent}/{skill}")
    if form == "file":
        file_path.unlink()
        return file_path
    shutil.rmtree(dir_path)
    return dir_path


# ---------------------------------------------------------------------------
# Write — form promotion + assets
# ---------------------------------------------------------------------------

def promote_skill_to_dir(agents_dir: Path, agent: str, skill: str) -> Path:
    """Convert a file-form skill to dir-form; idempotent for already-dir skills.

    Returns the skill directory path. Raises FileNotFoundError if the skill
    does not exist in either form. Uses the tmp-dir + rename dance so a
    crash mid-promotion never yields a half-migrated skill.
    """
    _, file_path, dir_path = _skill_paths(agents_dir, agent, skill)
    form = _detect_form(file_path, dir_path)
    if form == "dir":
        return dir_path
    if form is None:
        raise FileNotFoundError(f"skill not found: {agent}/{skill}")
    # form == "file": stage in tmp dir, then atomic-rename, then unlink original.
    tmp_dir = file_path.parent / f"{skill}.tmp"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir()
    try:
        body_content = file_path.read_text(encoding="utf-8")
        (tmp_dir / "skill.md").write_text(body_content, encoding="utf-8")
        os.replace(tmp_dir, dir_path)
    except Exception:
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir, ignore_errors=True)
        raise
    # Between os.replace and unlink there is a brief window where both forms
    # exist; a concurrent load would surface AmbiguousSkillError, which is
    # the safest observable failure mode.
    file_path.unlink()
    return dir_path


def add_skill_asset(
    agents_dir: Path,
    agent: str,
    skill: str,
    asset_rel_path: str,
    content: str,
) -> Path:
    """Write an asset file under `<skill>/assets/<asset_rel_path>`.

    When the skill is currently in file-form the promotion happens atomically
    in the same operation:
      1. mkdir `<skill>.tmp/`
      2. copy `<skill>.md` -> `<skill>.tmp/skill.md`
      3. write asset into `<skill>.tmp/assets/<asset_rel_path>`
      4. os.replace `<skill>.tmp` -> `<skill>` (dir), unlink `<skill>.md`

    A crash before step 4 leaves the original file untouched; a crash
    between rename and unlink is detectable as `AmbiguousSkillError`.

    `asset_rel_path` may contain subdirectories (e.g. "scripts/run.ps1");
    the necessary parent dirs are created automatically. Safety judgements
    (path traversal, is-executable, marker files) are NOT enforced here —
    that is the caller's (services.SkillService) responsibility. Returns
    the absolute path of the written asset.

    Raises FileNotFoundError if the skill does not exist.
    """
    _, file_path, dir_path = _skill_paths(agents_dir, agent, skill)
    form = _detect_form(file_path, dir_path)
    if form is None:
        raise FileNotFoundError(f"skill not found: {agent}/{skill}")

    if form == "dir":
        target = dir_path / "assets" / asset_rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return target

    # form == "file": atomic promote-with-asset.
    tmp_dir = file_path.parent / f"{skill}.tmp"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir()
    try:
        body_content = file_path.read_text(encoding="utf-8")
        (tmp_dir / "skill.md").write_text(body_content, encoding="utf-8")
        asset_tmp = tmp_dir / "assets" / asset_rel_path
        asset_tmp.parent.mkdir(parents=True, exist_ok=True)
        asset_tmp.write_text(content, encoding="utf-8")
        os.replace(tmp_dir, dir_path)
    except Exception:
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir, ignore_errors=True)
        raise
    file_path.unlink()
    return dir_path / "assets" / asset_rel_path


def remove_skill_asset(
    agents_dir: Path,
    agent: str,
    skill: str,
    asset_rel_path: str,
) -> Path:
    """Delete `<skill>/assets/<asset_rel_path>` and its sibling executable-marker.

    The sibling marker file `<asset_rel_path>.executable-declared` (if
    present) is also removed; its absence is not an error. Returns the
    deleted asset's path (not the marker's).

    Raises FileNotFoundError if the skill is not in dir-form or the asset
    does not exist.
    """
    _, file_path, dir_path = _skill_paths(agents_dir, agent, skill)
    form = _detect_form(file_path, dir_path)
    if form != "dir":
        raise FileNotFoundError(
            f"asset not found (skill has no assets/): {agent}/{skill}/{asset_rel_path}"
        )
    asset_path = dir_path / "assets" / asset_rel_path
    if not asset_path.is_file():
        raise FileNotFoundError(f"asset not found: {asset_path}")
    asset_path.unlink()
    marker = asset_path.with_name(f"{asset_path.name}.executable-declared")
    if marker.exists():
        try:
            marker.unlink()
        except OSError:
            # Marker cleanup is best-effort; the asset is already gone.
            pass
    return asset_path
