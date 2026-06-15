"""Cross-module split (split_module) and its helpers.

split_module decomposes one source .dna/module.md into one source + N new
modules, by extracting named H2 sections into freshly-initialized leaf
modules. Atomicity unit is the COMMAND (not an fs syscall): all writes are
staged into .tmp files first; if any validation / staging step fails, the
.tmp files are unlinked and disk is untouched. Only after the full plan
validates do we run init_module (which creates .dna/ + appends to index)
for each new module and rewrite the source body in-place.

Cross-module dependency references (other modules whose frontmatter
`dependencies:` list mentions the source path) are SCAN-ONLY: they're
reported back in the return dict for architect follow-up. This command
does NOT mutate any other module's frontmatter — splitting one module
should not silently rewrite the entire project's reference graph.
"""

# Why one file: split_module is an atomic 7-phase transaction sharing 7+ locals across phases; its helpers (_scan_dependency_refs / _rm_rf / _rollback_index_entries) are consumed only by it.

import os
from pathlib import Path

from services._fm import parse_frontmatter, strip_frontmatter

from .loader import _scan_modules
from .registry import _write_index, read_index
from .section_parser import _split_frontmatter_block, _split_sections


# Tests (and historic call patterns from the pre-split monolith) rely on
# monkey-patching `cbi._primitives.modules.write_module_doc` /
# `init_module` at the package level to inject failures into split_module.
# Look up these names via the package each call so the patches are honoured;
# `from .doc_writer import write_module_doc` would freeze the binding at
# import time and silently bypass the patch. Zero behaviour change vs. the
# pre-split monolith where the names lived in the same module scope.
def _write_module_doc(*args, **kwargs):
    from . import write_module_doc as _fn
    return _fn(*args, **kwargs)


def _init_module(*args, **kwargs):
    from . import init_module as _fn
    return _fn(*args, **kwargs)


def split_module(
    source_mod_dir: Path,
    splits: list[dict],
    root: Path,
    dry_run: bool = False,
    keep_source: bool = True,
) -> dict:
    """Decompose `source_mod_dir`'s .dna/module.md into one source + N new modules.

    Parameters
    ----------
    source_mod_dir : Path
        Directory containing the source `.dna/module.md` to split.
    splits : list[dict]
        Each dict describes a new module to create:
            {
                "path": "<absolute or root-relative module dir>",
                "name": "<frontmatter name for new module>",
                "headings": ["## Foo", "## Bar"],   # H2 sections to move
                "owner": "<optional; defaults to source's owner>",
                "description": "<optional>",
            }
    root : Path
        Project root (the one containing .cbim/).
    dry_run : bool
        If True, validate and plan only; touch zero files; return the report
        with `created` listing the would-be paths.
    keep_source : bool
        If True (default), leave the split sections in source body and append
        an HTML comment beneath each migrated heading noting the new location.
        If False, remove the migrated sections from source entirely.

    Returns
    -------
    dict
        {
            "created": [<absolute Path of each new .dna/module.md>],
            "updated_source": bool,
            "dependency_refs": [
                {"module": "<rel path>", "dep_line": "<source rel path>",
                 "action_required": "..."},
                ...
            ],
        }

    Raises
    ------
    FileNotFoundError, ValueError, FileExistsError, LookupError
        Any precondition failure aborts before any disk write.
    """
    source_mod_dir = source_mod_dir.resolve()
    root = root.resolve()

    # --- 1. Validate source --------------------------------------------------
    source_aimod = source_mod_dir / ".dna"
    source_md = source_aimod / "module.md"
    if not source_md.is_file():
        raise FileNotFoundError(
            f"source module has no .dna/module.md: {source_md}"
        )

    source_raw = source_md.read_text(encoding="utf-8")
    source_meta = parse_frontmatter(source_raw)
    source_body = strip_frontmatter(source_raw)
    source_owner = source_meta.get("owner", "")

    try:
        source_rel = source_mod_dir.relative_to(root).as_posix()
    except ValueError:
        raise ValueError(
            f"source module {source_mod_dir} is not inside project root {root}"
        )

    # --- 2. Validate split specs --------------------------------------------
    if not splits:
        raise ValueError("splits must list at least one new module")

    norm_splits: list[dict] = []
    requested_headings: list[str] = []
    for i, spec in enumerate(splits):
        if not isinstance(spec, dict):
            raise ValueError(f"splits[{i}] must be a dict")
        if "path" not in spec or "name" not in spec or "headings" not in spec:
            raise ValueError(
                f"splits[{i}] missing required keys; need: path, name, headings"
            )
        if not spec["headings"] or not isinstance(spec["headings"], list):
            raise ValueError(
                f"splits[{i}].headings must be a non-empty list"
            )
        spec_path = Path(spec["path"])
        if not spec_path.is_absolute():
            spec_path = (root / spec_path).resolve()
        else:
            spec_path = spec_path.resolve()
        if (spec_path / ".dna").exists():
            raise FileExistsError(
                f"target module already has .dna/: {spec_path}"
            )
        # Headings are stored with their leading '## '; normalise to bare text
        # for the section finder.
        norm_headings = []
        for h in spec["headings"]:
            h = h.strip()
            if h.startswith("## "):
                h = h[3:].strip()
            elif h.startswith("##"):
                h = h[2:].strip()
            norm_headings.append(h)
            requested_headings.append(h)
        norm_splits.append({
            "path": spec_path,
            "name": spec["name"],
            "headings": norm_headings,
            "owner": spec.get("owner") or source_owner,
            "description": spec.get("description", ""),
        })

    # Reject overlap: same heading claimed by two splits.
    seen: set[str] = set()
    for h in requested_headings:
        if h in seen:
            raise ValueError(
                f"heading '{h}' claimed by more than one split target"
            )
        seen.add(h)

    # --- 3. Validate headings exist in source as H2 -------------------------
    sections = _split_sections(source_body)
    h2_index = {s.heading: s for s in sections if s.level == 2}
    missing = [h for h in requested_headings if h not in h2_index]
    if missing:
        raise LookupError(
            f"source module is missing required H2 headings: {missing}"
        )

    # --- 4. Build new body text for each split + new source body -----------
    body_lines = source_body.splitlines()

    extracted: dict[str, list[str]] = {}
    for h in requested_headings:
        sec = h2_index[h]
        extracted[h] = body_lines[sec.start:sec.end]

    # Build new source body. Two modes:
    #   keep_source=True  : leave section in place + append HTML comment beneath heading
    #   keep_source=False : drop the section entirely
    new_source_lines = list(body_lines)
    # Process from bottom up so prior indices stay valid.
    sec_list = sorted(
        [(h, h2_index[h]) for h in requested_headings],
        key=lambda x: x[1].start,
        reverse=True,
    )
    heading_to_dest: dict[str, str] = {}
    for split in norm_splits:
        try:
            dest_rel = split["path"].relative_to(root).as_posix()
        except ValueError:
            dest_rel = str(split["path"])
        for h in split["headings"]:
            heading_to_dest[h] = dest_rel

    if keep_source:
        for h, sec in sec_list:
            dest_rel = heading_to_dest[h]
            comment = f"<!-- split: moved '{h}' -> {dest_rel} -->"
            new_source_lines.insert(sec.start + 1, comment)
    else:
        for h, sec in sec_list:
            del new_source_lines[sec.start:sec.end]

    while new_source_lines and new_source_lines[-1].strip() == "":
        new_source_lines.pop()
    new_source_body = "\n".join(new_source_lines) + "\n" if new_source_lines else ""

    frontmatter_block, _ = _split_frontmatter_block(source_raw)
    if frontmatter_block:
        new_source_text = frontmatter_block + "\n" + new_source_body
    else:
        new_source_text = new_source_body

    # --- 5. Scan dependency references (SCAN ONLY, no mutation) -------------
    dependency_refs = _scan_dependency_refs(root, source_rel)

    # --- 6. Plan list of would-be-created paths -----------------------------
    created_paths = [
        (split["path"] / ".dna" / "module.md") for split in norm_splits
    ]

    if dry_run:
        return {
            "created": created_paths,
            "updated_source": True,
            "dependency_refs": dependency_refs,
        }

    # --- 7. Execute: stage source rewrite to .tmp first, then init each
    # new split (init_module creates .dna/ + appends to index), then sweep
    # the source rewrite with os.replace.
    #
    # Atomicity contract: if anything fails after .tmp staging, we unlink
    # the .tmp and roll back every newly-created .dna/ dir + corresponding
    # index.md entry, leaving the source file untouched.

    source_tmp = source_md.with_suffix(source_md.suffix + ".tmp")
    try:
        source_tmp.write_text(new_source_text, encoding="utf-8")
    except OSError:
        if source_tmp.exists():
            try:
                source_tmp.unlink()
            except OSError:
                pass
        raise

    created_dirs: list[Path] = []
    try:
        for split in norm_splits:
            # ContextPack mandates status='spec' for new splits (task-12 dep).
            try:
                _init_module(
                    split["path"],
                    name=split["name"],
                    owner=split["owner"],
                    description=split["description"],
                    type_="leaf",
                    project_root=root,
                    status="spec",
                )
            except TypeError:
                # task-12 (status field on init_module) not yet landed in
                # this checkout. Fall back to current signature so split is
                # usable in dev; the architect will see the missing status
                # field and can fix it manually once task-12 ships.
                _init_module(
                    split["path"],
                    name=split["name"],
                    owner=split["owner"],
                    description=split["description"],
                    type_="leaf",
                    project_root=root,
                )
            created_dirs.append(split["path"] / ".dna")

            # Populate body with the extracted sections (frontmatter intact).
            body_chunks: list[str] = []
            for h in split["headings"]:
                lines = extracted[h]
                body_chunks.append("\n".join(lines))
            new_body = "\n\n".join(body_chunks) + "\n"
            _write_module_doc(split["path"], "module.md", new_body)

        os.replace(source_tmp, source_md)

    except Exception:
        # Rollback boundary: any sub-step exception
        # (OSError/ValueError/RuntimeError from _init_module / _write_module_doc)
        # must trigger full rollback; narrowing risks leaving half-baked splits
        # behind. ruff treats trace-then-raise as valid — no BLE001 reported.
        if source_tmp.exists():
            try:
                source_tmp.unlink()
            except OSError:
                pass
        for d in created_dirs:
            _rm_rf(d)
            parent = d.parent
            try:
                if parent.is_dir() and not any(parent.iterdir()):
                    parent.rmdir()
            except OSError:
                pass
        _rollback_index_entries(
            root,
            [d.parent for d in created_dirs],
        )
        raise

    return {
        "created": created_paths,
        "updated_source": True,
        "dependency_refs": dependency_refs,
    }


def _scan_dependency_refs(root: Path, source_rel: str) -> list[dict]:
    """Report every module whose frontmatter `dependencies:` mentions
    `source_rel`. SCAN ONLY — no mutation.

    The split command surfaces these so the architect can manually rewrite
    each affected module's dependencies afterward via `cbim dna edit`.
    """
    refs: list[dict] = []
    for mod_dict in _scan_modules(root):
        deps = mod_dict.get("dependencies") or []
        if not isinstance(deps, list):
            continue
        for dep in deps:
            if isinstance(dep, str) and dep.strip() == source_rel:
                refs.append({
                    "module": mod_dict["path"],
                    "dep_line": dep,
                    "action_required": (
                        f"`dependencies:` lists '{source_rel}'; consider "
                        f"updating to point at the new split target(s)."
                    ),
                })
                break
    return refs


def _rm_rf(p: Path) -> None:
    """Best-effort recursive delete; suppress errors (called during rollback)."""
    if not p.exists():
        return
    try:
        if p.is_file() or p.is_symlink():
            p.unlink()
            return
        for child in p.iterdir():
            _rm_rf(child)
        p.rmdir()
    except OSError:
        pass


def _rollback_index_entries(root: Path, mod_dirs: list[Path]) -> None:
    """Remove a list of module-dir paths from .cbim/index.md.

    Used by split_module's rollback path to undo the per-module appends
    init_module made before the overall command failed.
    """
    if not mod_dirs:
        return
    try:
        existing = read_index(root)
    except Exception:  # noqa: BLE001 - rollback sub-step is best-effort; any failure here must not crash and bury the original split-time exception
        return
    to_remove: set[str] = set()
    for d in mod_dirs:
        try:
            rel = d.resolve().relative_to(root.resolve()).as_posix()
            to_remove.add(rel)
        except ValueError:
            continue
    remaining = [p for p in existing if p not in to_remove]
    try:
        _write_index(root, remaining)
    except Exception:  # noqa: BLE001 - rollback sub-step is best-effort; same rationale as the read above
        pass


__all__ = [
    "split_module",
    "_scan_dependency_refs",
    "_rm_rf",
    "_rollback_index_entries",
]
