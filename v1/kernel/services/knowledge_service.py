"""
services/knowledge_service.py — .dna module read + transactional write facade.

Read side (`list_modules`) inflates module dicts with workflow records and
normalises list-typed frontmatter fields.

Write side (`init_module`, `edit_module`, `split_module`, `write_doc`,
`write_section`) is the single implementation shared by:
  - engine/cli.py `_handle_dna_*` (CLI surface)
  - mcp_server/tools/dna.py (MCP surface)

Phase 1 design note: previously this layer was read-only. The "No service
writes" rule was reversed so we don't duplicate the multi-file orchestration
(`.dna/module.md` + `.dna/contract.md` + registry update) on every surface.
"""

from __future__ import annotations

from pathlib import Path

from context import resolve_root_or_cwd as _resolve_root

from . import _reindex
from ._fm import parse_frontmatter, strip_frontmatter
from ._paths import resolve_within_root


# ---------------------------------------------------------------------------
# v2 `links` frontmatter validation. Single-source-of-truth — both CLI and
# MCP route through edit_module(target="frontmatter", field="links"), so
# validating here keeps the surfaces honest. CLI/MCP layers are pass-through.
#
# Schema (v2):
#   list[dict]            — each element a dict
#   dict["kind"]          — required; one of {"local", "git", "db"}
#   kind == "local"       — must carry "target" (path string)
#   kind == "git" / "db"  — extra fields are passed through verbatim (the
#                            specific protocol fields are out of scope here;
#                            once we materialise git/db loaders, those layers
#                            will validate their own required fields).
# ---------------------------------------------------------------------------
_LINK_KINDS = ("local", "git", "db")


def _validate_links(value) -> None:
    """Validate a `links` frontmatter value. Raises ValueError on first issue.

    Called from edit_module's frontmatter branch so CLI/MCP/programmatic
    callers all get the same rules. Empty list is allowed (clears links).
    """
    if not isinstance(value, list):
        raise ValueError(
            f"field 'links' must be a list of dicts; got: {type(value).__name__}"
        )
    for idx, item in enumerate(value):
        if not isinstance(item, dict):
            raise ValueError(
                f"links[{idx}] must be a dict; got: {type(item).__name__}"
            )
        kind = item.get("kind")
        if not kind:
            raise ValueError(f"links[{idx}] missing required key 'kind'")
        if kind not in _LINK_KINDS:
            raise ValueError(
                f"links[{idx}].kind must be one of {_LINK_KINDS}, "
                f"got: {kind!r}"
            )
        if kind == "local" and not item.get("target"):
            raise ValueError(
                f"links[{idx}] kind='local' requires non-empty 'target'"
            )


# ---------------------------------------------------------------------------
# Note doc_id contract (Task 0). Kept next to the module doc_id contract in
# services/_reindex.py so future readers can compare shapes side-by-side.
#
#   root module   ``notes/<slug>``          (NOT ``./notes/<slug>``)
#   sub module    ``<mod_rel>/notes/<slug>`` (POSIX separators, no leading .)
#
# Downstream index scan / cold-start / audit tasks compose the same doc_id
# from a filesystem walk; if this function's output diverges from those
# walks, the retrieval index ends up with duplicate entries. Keep the two
# in lock-step.
# ---------------------------------------------------------------------------
def _note_doc_id(root: Path, module_dir: Path, slug: str) -> str:
    try:
        rel = module_dir.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        # Off-tree module (defensive: services callers already anchor
        # module_dir under root, but preserve the module-side fallback).
        return f"{module_dir.resolve().as_posix()}/notes/{slug}"
    if not rel or rel == ".":
        return f"notes/{slug}"
    return f"{rel}/notes/{slug}"


def _delete_note_index(root: Path, module_dir: Path, slug: str) -> None:
    """Drop a note doc from the retrieval index (source="dna").

    Idempotent: ``index_delete`` silently no-ops when the doc_id is
    unknown. Failure is swallowed with the same rationale as
    :func:`services._reindex.reindex_notes`: the primary filesystem
    write (unlink) already succeeded; the dream loop's
    ``verify_consistency`` reconciles on the next governance pass.

    Delete stays inline here rather than going through
    ``reindex_notes`` because the note file no longer exists — there is
    no payload to assemble from disk. The doc_id contract is still the
    single :func:`_note_doc_id` helper, so batch and CRUD stay aligned
    on the identifier side.
    """
    try:
        doc_id = _note_doc_id(root, module_dir, slug)
        from engine.retrieval import index_delete
        index_delete("dna", doc_id)
    except Exception:  # noqa: BLE001 — main write succeeded; drift loop reconciles
        return


def _module_dir(module_path: str | Path, root: Path) -> Path:
    """Resolve a caller-supplied module path against the project root.

    Mirrors the read-side convention in `get_module`: absolute paths are
    honoured as-is; relative paths (including the root sentinel "." and
    "") are anchored to ``root``. This keeps every write function
    (`edit_module`, `split_module`, `write_doc`, `write_section`)
    independent of the calling process's cwd, and makes "." address the
    root module deterministically.
    """
    p = Path(module_path)
    return p if p.is_absolute() else (root / p)


def list_modules(cwd=None) -> list[dict]:
    """Return all registered .dna modules.

    Args:
        cwd: Project search base; walks up to find `.cbim/`.

    Returns:
        List of dicts shaped like::

            {
              "id":           <project-relative path>,
              "path":         <project-relative path>,
              "name":         <frontmatter name>,
              "owner":        <frontmatter owner>,
              "description":  <frontmatter description>,
              "keywords":     [str, ...],
              "architecture": <module.md body, frontmatter stripped>,
              "contract":     <contract.md content or "">,
              "workflows":    [ {"id": <slug>, "name": <fm name>, "body": <md>}, ... ],
            }
    """
    root = _resolve_root(cwd)

    from cbi._primitives.modules import list_modules as _list_modules

    modules = _list_modules(root)
    inflated = []
    for m in modules:
        mod_dir = root if m["path"] in (".", "") else (root / m["path"])
        m = dict(m)
        m["workflows"] = _collect_workflows(mod_dir / ".dna" / "workflows")
        kw = m.get("keywords", [])
        if isinstance(kw, str):
            kw = [k.strip() for k in kw.split(",") if k.strip()] if kw else []
        m["keywords"] = kw if isinstance(kw, list) else []
        inflated.append(m)
    return inflated


def _collect_workflows(workflows_dir: Path) -> list[dict]:
    if not workflows_dir.exists():
        return []
    out = []
    for wf_dir in sorted(workflows_dir.iterdir()):
        if not wf_dir.is_dir():
            continue
        wf_file = wf_dir / "workflow.md"
        if not wf_file.exists():
            continue
        try:
            raw = wf_file.read_text(encoding="utf-8")
        except (FileNotFoundError, PermissionError):
            raw = ""
        meta = parse_frontmatter(raw)
        out.append({
            "id": wf_dir.name,
            "name": meta.get("name", wf_dir.name),
            "body": strip_frontmatter(raw),
        })
    return out


def scan_workflows(
    module_paths: list[str],
    keywords: list[str],
    cwd: str = "",
) -> list[dict]:
    """Return workflow records whose triggers match any of ``keywords``.

    Args:
        module_paths: Candidate module directories (relative to the project
            root or absolute; ``""`` / ``"."`` addresses the root module).
            Each path is confined to the project root via
            :func:`services._paths.resolve_within_root` — a traversal attempt
            (``../…``, drive-relative, off-volume) raises
            :class:`services.PathOutsideRootError`. Unregistered paths (not
            present in ``.cbim/index.md``) are **silently skipped** so the
            caller can pass a broad candidate list without pre-filtering; the
            return list only contains matches, never markers.
        keywords: Free-form search terms. Case-insensitive; leading/trailing
            whitespace is stripped. Empty list → returns ``[]`` (no error,
            no "match everything" semantics).
        cwd: Project search base; walks up to find ``.cbim/``.

    Returns:
        List of pure-data dicts, sorted by ``(module_path, workflow_id)``::

            [
              {
                "module_path":       <project-relative POSIX path>,
                "workflow_id":       <directory slug under .dna/workflows/>,
                "name":              <frontmatter.name, or slug on absence>,
                "purpose":           <frontmatter.purpose, or "">,
                "matched_triggers":  [<trigger phrase that matched>, ...],
                "body":              <workflow.md with frontmatter stripped>,
              },
              ...
            ]

    Matching semantics:
        A workflow is included when any of its declared ``triggers`` and any
        of the supplied ``keywords`` overlap via a case-insensitive
        substring relation in *either* direction (``keyword ⊆ trigger``
        *or* ``trigger ⊆ keyword``). The bidirectional rule handles both
        practical patterns — a short generic keyword hitting a longer
        specific trigger phrase, and a long specific search query hitting
        a short generic trigger — without silently missing either.

    Purity:
        Read-only. Does NOT touch the retrieval index; the dream loop
        reconciles retrieval state independently.
    """
    if not keywords:
        return []

    from cbi._primitives.modules.registry import read_index

    root = _resolve_root(cwd)
    registered = set(read_index(root))

    # Normalise every input path to its canonical registry form. Traversal
    # attempts raise PathOutsideRootError (subclass of ValueError) — that
    # propagates to the caller so it can't be silently dropped.
    seen_paths: set[str] = set()
    normalised: list[str] = []
    for raw in module_paths or []:
        abs_path = resolve_within_root(root, raw, allow_root_itself=True)
        try:
            rel = abs_path.resolve().relative_to(root.resolve()).as_posix()
        except ValueError:
            # resolve_within_root guarantees containment, so this branch
            # is defensive — skip rather than raise on a normalisation
            # edge case we haven't identified.
            continue
        canonical = rel if rel and rel != "." else "."
        if canonical in seen_paths:
            continue
        seen_paths.add(canonical)
        normalised.append(canonical)

    # Prepare keyword needles once — strip + lowercase + dedupe.
    needles: list[str] = []
    seen_needles: set[str] = set()
    for k in keywords:
        if not isinstance(k, str):
            continue
        n = k.strip().lower()
        if not n or n in seen_needles:
            continue
        seen_needles.add(n)
        needles.append(n)
    if not needles:
        return []

    results: list[dict] = []
    for mp in normalised:
        if mp not in registered:
            continue  # silently skip unregistered — see docstring
        mod_dir = root if mp == "." else (root / mp)
        wf_root = mod_dir / ".dna" / "workflows"
        if not wf_root.is_dir():
            continue
        for wf_dir in sorted(wf_root.iterdir()):
            if not wf_dir.is_dir():
                continue
            wf_file = wf_dir / "workflow.md"
            if not wf_file.is_file():
                continue
            try:
                raw = wf_file.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            meta = parse_frontmatter(raw)
            triggers = meta.get("triggers") or []
            if not isinstance(triggers, list):
                continue
            matched: list[str] = []
            for t in triggers:
                if not isinstance(t, str):
                    continue
                t_norm = t.strip().lower()
                if not t_norm:
                    continue
                if any(n in t_norm or t_norm in n for n in needles):
                    matched.append(t)
            if not matched:
                continue
            purpose = meta.get("purpose", "")
            results.append({
                "module_path": mp,
                "workflow_id": wf_dir.name,
                "name": meta.get("name", wf_dir.name),
                "purpose": purpose if isinstance(purpose, str) else "",
                "matched_triggers": matched,
                "body": strip_frontmatter(raw),
            })

    results.sort(key=lambda x: (x["module_path"], x["workflow_id"]))
    return results


# ---------------------------------------------------------------------------
# Read façade — single-point lookups, schema accessor, snapshot wrapper.
#
# These exist so callers (engine/cli.py, mcp_server/tools/*) never need
# to reach into cbi._primitives directly. Both layers go through here,
# which is what the Batch 2 banned-api rule enforces.
# ---------------------------------------------------------------------------


def get_module(module_path: str | Path, cwd: str = "") -> dict | None:
    """Return one module's flattened representation, or None when absent.

    Single-point load — does NOT iterate `list_modules`. The module dict
    mirrors what `list_modules` returns for a single entry (frontmatter
    fields + body + contract + workflows + keywords normalisation) and
    additionally exposes ``module_dir`` as an absolute Path so callers
    don't have to recompute it.

    Returns None when the module.md file is missing. Missing contract.md
    is NOT an error — the contract field is just an empty string.
    """
    from cbi.resources import DNAModule

    root = _resolve_root(cwd)
    mod_dir = Path(module_path) if Path(module_path).is_absolute() else (root / module_path)
    try:
        m = DNAModule.load(mod_dir, root=root)
    except FileNotFoundError:
        return None

    fm = m.frontmatter
    keywords = fm.get("keywords") or []
    if isinstance(keywords, str):
        keywords = [k.strip() for k in keywords.split(",") if k.strip()] if keywords else []

    contract_text = m.contract.body.read() if m.contract.exists() else ""
    workflows = _collect_workflows(m.path.parent / "workflows")
    # Task 0: notes are the module-supplement layer (.dna/notes/<slug>.md).
    # Emit metadata-only records — callers who need body must read the
    # file directly to keep the payload light.
    from cbi._primitives.modules import list_notes as _list_notes
    notes = _list_notes(m.path.parent.parent)
    try:
        rel = m.path.parent.parent.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        rel = str(m.path.parent.parent.resolve())

    return {
        "id": rel or ".",
        "path": rel or ".",
        "name": fm.get("name", m.id),
        "owner": fm.get("owner", ""),
        "description": fm.get("description", ""),
        "status": fm.get("status", ""),
        "keywords": keywords if isinstance(keywords, list) else [],
        "architecture": m.body.read(),
        "body": m.body.read(),
        "contract": contract_text,
        "workflows": workflows,
        "notes": notes,
        "module_dir": m.path.parent.parent.resolve(),
    }


def build_snapshot(cwd: str = "") -> str:
    """Render the project knowledge snapshot (module tree + agents + recent activity).

    Thin wrapper around the snapshot primitive that keeps callers out of
    `cbi._primitives.snapshot`. Resolves the project root leniently so
    CLI invocations from a scratch dir still produce a deterministic
    output (an empty tree) rather than raising.
    """
    from cbi._primitives.snapshot import build_snapshot as _build
    return _build(_resolve_root(cwd))


def get_module_fm_schema() -> dict:
    """Expose the module frontmatter schema constants as a stable dict.

    Returns a dict with three keys:
      - ``list_fields``: ``frozenset[str]`` — frontmatter fields whose
        YAML type must be a list (v2 schema: ``keywords``, ``links``).
      - ``status_values``: ``tuple[str, ...]`` — allowed values for the
        ``status`` field.
      - ``required``: ``tuple[str, ...]`` — fields that must remain
        present in module.md and therefore cannot be deleted via
        ``edit_module(target='frontmatter', payload={'delete': True})``.

    The CLI uses these to enforce shape constraints without having to
    import from `cbi._primitives.modules` directly.
    """
    from cbi._primitives.modules import (
        _MODULE_FM_LIST_FIELDS,
        _MODULE_FM_REQUIRED,
        _MODULE_FM_STATUS_VALUES,
    )
    return {
        "list_fields": _MODULE_FM_LIST_FIELDS,
        "status_values": _MODULE_FM_STATUS_VALUES,
        "required": _MODULE_FM_REQUIRED,
    }


def reindex_modules(cwd: str = "") -> int:
    """Rescan the filesystem and rebuild `.cbim/index.md`. Returns the new module count.

    Wraps `DNAModule.reindex` + `len(list_all)` so the CLI handler
    `cbim dna reindex` can route through services without poking at
    cbi.resources from engine.* code paths (Batch 2 banned-api).
    """
    from cbi.resources import DNAModule

    root = _resolve_root(cwd)
    DNAModule.reindex(root=root)
    return len(DNAModule.list_all(root=root))


def dry_run_section(
    module_path: str | Path,
    file: str,
    heading: str,
    level: int,
    mode: str,
    content: str | None,
    create_if_missing: bool = False,
) -> str:
    """Render the would-be result of a section edit without touching disk.

    The other write functions in this module are commit-only (they
    write to disk and return the saved path); the CLI's `--dry-run`
    flag for `dna write-section` needs the *rendered text* instead. This
    wrapper isolates that one read-only side of the primitive so the
    CLI doesn't have to reach into `cbi._primitives` itself.
    """
    from cbi._primitives.modules import write_module_section
    if file not in ("module.md", "contract.md"):
        raise ValueError(f"file must be 'module.md' or 'contract.md', got: {file!r}")
    result = write_module_section(
        Path(module_path),
        file,
        heading,
        level,
        mode,
        content,
        create_if_missing=create_if_missing,
        dry_run=True,
    )
    return result if isinstance(result, str) else str(result)


# ---------------------------------------------------------------------------
# Write facade — shared by engine/cli.py and mcp_server/tools/dna.py
# ---------------------------------------------------------------------------


def init_module(
    dir: str | Path,
    kind: str,
    name: str,
    owner: str,
    description: str = "",
    with_contract: bool = False,
    status: str | None = None,
    cwd: str = "",
) -> str:
    """Create a new `.dna/` module at `dir` and register it.

    Args:
        dir:           Directory that will own the new `.dna/` subdir.
        kind:          "root" | "parent" | "leaf".
        name:          Module name (frontmatter).
        owner:         Owning role (frontmatter).
        description:   Optional description (frontmatter).
        with_contract: Also create `.dna/contract.md`.
        status:        "spec" | "planned" | "implemented" — default decided
                       by `init_module` primitive (spec for parent/leaf,
                       implemented for root).
        cwd:           Project search base.

    Returns the absolute path to the created `.dna/` directory as a string.
    Raises `FileExistsError` when `.dna/` already exists, `ValueError` for
    invalid kind / status, `FileNotFoundError` when the registry is missing.
    """
    from cbi.resources import DNAModule
    root = _resolve_root(cwd)
    m = DNAModule.create(
        _module_dir(dir, root),
        name=name,
        owner=owner,
        description=description,
        with_contract=with_contract,
        type=kind,
        status=status,
        root=root,
    )
    # m.path == <module_dir>/.dna/module.md; module_dir = m.path.parent.parent.
    _reindex.reindex_dna(root, m.path.parent.parent)
    return str(m.path.parent.resolve())


def edit_module(
    module_path: str | Path,
    target: str,
    payload: dict,
    mode: str = "replace",
    cwd: str = "",
) -> str:
    """Edit module.md / contract.md / workflow under `<module_path>/.dna/`.

    Args:
        module_path: Path to the module directory (the one containing `.dna/`).
        target:      "frontmatter" | "body" | "section" | "contract" |
                     "contract-section" | "workflow".
        payload:     Per-target dict; shape mirrors `agent_service.update_agent`.
                     workflow -> {"name": str, "content": str}
                     contract / contract-section -> like body / section but on
                     contract.md (auto-creates contract.md if missing).
        mode:        Default section mode when payload omits its own "mode".
        cwd:         Project search base.

    Returns the absolute path to the saved file as a string.
    """
    from cbi._primitives.modules import (
        _MODULE_FM_LIST_FIELDS,
        _MODULE_FM_REQUIRED,
        _MODULE_FM_STATUS_VALUES,
    )
    from cbi.resources import DNAModule

    root = _resolve_root(cwd)
    module_dir = _module_dir(module_path, root)
    m = DNAModule.load(module_dir, root=root)

    if target == "frontmatter":
        field = payload.get("field")
        if field is None:
            raise ValueError("payload.field is required for target=frontmatter")
        has_scalar = "value" in payload and payload["value"] is not None
        has_list = "value_list" in payload and payload["value_list"] is not None
        has_delete = bool(payload.get("delete"))
        given = sum([has_scalar, has_list, has_delete])
        if given > 1:
            raise ValueError(
                "payload.value, payload.value_list, and payload.delete are "
                "mutually exclusive"
            )
        if given == 0:
            raise ValueError(
                "one of payload.value, payload.value_list, or payload.delete is required"
            )
        if has_delete:
            if field in _MODULE_FM_REQUIRED:
                raise ValueError(
                    f"field {field!r} is required and cannot be deleted "
                    f"(required set: {list(_MODULE_FM_REQUIRED)})"
                )
            if not m.frontmatter.has(field):
                raise LookupError(
                    f"field {field!r} is not present in module frontmatter"
                )
            m.frontmatter.delete(field)
            m.save()
            _reindex.reindex_dna(root, module_dir)
            return str(m.path.resolve())
        if field in _MODULE_FM_LIST_FIELDS and has_scalar:
            raise ValueError(
                f"field {field!r} is a list-typed field; use payload.value_list"
            )
        new_value = payload["value_list"] if has_list else payload["value"]
        if has_list and new_value == [] and field not in _MODULE_FM_LIST_FIELDS:
            raise ValueError(
                f"field {field!r} is not list-typed; cannot clear "
                f"(allowed list-typed fields: {sorted(_MODULE_FM_LIST_FIELDS)})"
            )
        if field == "status":
            if has_list:
                raise ValueError("field 'status' is a scalar enum; use payload.value")
            if new_value not in _MODULE_FM_STATUS_VALUES:
                raise ValueError(
                    f"status must be one of {_MODULE_FM_STATUS_VALUES}, "
                    f"got: {new_value!r}"
                )
        if field == "links" and has_list:
            _validate_links(new_value)
        m.frontmatter.set(field, new_value)
        m.save()
        _reindex.reindex_dna(root, module_dir)
        return str(m.path.resolve())

    if target == "body":
        content = payload.get("content")
        if content is None:
            raise ValueError("payload.content is required for target=body")
        m.body.write(content)
        m.save()
        _reindex.reindex_dna(root, module_dir)
        return str(m.path.resolve())

    if target == "section":
        heading = payload.get("heading")
        if heading is None:
            raise ValueError("payload.heading is required for target=section")
        sec_mode = payload.get("mode") or mode or "replace"
        needs_content = sec_mode != "delete"
        content = payload.get("content")
        if needs_content and content is None:
            raise ValueError("payload.content is required unless mode=delete")
        if not needs_content and content is not None:
            raise ValueError("payload.content forbidden with mode=delete")
        insert_after = payload.get("insert_after")
        insert_at_top = bool(payload.get("insert_at_top", False))
        if insert_after is not None and insert_at_top:
            raise ValueError(
                "payload.insert_after and payload.insert_at_top are mutually exclusive"
            )
        m.body.write_section(
            heading,
            content,
            level=int(payload.get("level", 2)),
            mode=sec_mode,
            create_if_missing=bool(payload.get("create_if_missing", False)),
            insert_after=insert_after,
            insert_at_top=insert_at_top,
        )
        m.save()
        _reindex.reindex_dna(root, module_dir)
        return str(m.path.resolve())

    if target == "contract":
        content = payload.get("content")
        if content is None:
            raise ValueError("payload.content is required for target=contract")
        m.contract.ensure()
        m.contract.body.write(content)
        m.save()
        _reindex.reindex_dna(root, module_dir)
        return str(m.contract.path.resolve())

    if target == "contract-section":
        heading = payload.get("heading")
        if heading is None:
            raise ValueError("payload.heading is required for target=contract-section")
        sec_mode = payload.get("mode") or mode or "replace"
        needs_content = sec_mode != "delete"
        content = payload.get("content")
        if needs_content and content is None:
            raise ValueError("payload.content is required unless mode=delete")
        if not needs_content and content is not None:
            raise ValueError("payload.content forbidden with mode=delete")
        insert_after = payload.get("insert_after")
        insert_at_top = bool(payload.get("insert_at_top", False))
        if insert_after is not None and insert_at_top:
            raise ValueError(
                "payload.insert_after and payload.insert_at_top are mutually exclusive"
            )
        m.contract.ensure()
        m.contract.body.write_section(
            heading,
            content,
            level=int(payload.get("level", 2)),
            mode=sec_mode,
            create_if_missing=bool(payload.get("create_if_missing", False)),
            insert_after=insert_after,
            insert_at_top=insert_at_top,
        )
        m.save()
        _reindex.reindex_dna(root, module_dir)
        return str(m.contract.path.resolve())

    if target == "workflow":
        wf_name = payload.get("name")
        if not wf_name:
            raise ValueError("payload.name is required for target=workflow")
        wf_mode = payload.get("mode", "create")
        if wf_mode not in ("create", "update", "delete"):
            raise ValueError(
                f"payload.mode for target=workflow must be one of "
                f"'create' | 'update' | 'delete' (default 'create'), "
                f"got: {wf_mode!r}"
            )
        content = payload.get("content")
        workflows_dir = m.path.parent / "workflows"
        wf_dir = workflows_dir / wf_name

        if wf_mode == "create":
            if content is None:
                raise ValueError(
                    "payload.content is required for target=workflow, mode=create"
                )
            m.workflows.add(wf_name, content)
            result_path = str((wf_dir / "workflow.md").resolve())
        elif wf_mode == "update":
            if content is None:
                raise ValueError(
                    "payload.content is required for target=workflow, mode=update"
                )
            if wf_name not in m.workflows:
                raise FileNotFoundError(
                    f"workflow {wf_name!r} does not exist under {module_path}, "
                    f"cannot update"
                )
            wf = m.workflows.get(wf_name)
            wf.body.write(content)
            wf.save()
            result_path = str((wf_dir / "workflow.md").resolve())
        else:  # wf_mode == "delete"
            if content:
                raise ValueError(
                    "payload.content is not accepted for target=workflow, mode=delete"
                )
            # WorkflowCollection.remove is idempotent — silently skips when
            # workflow.md is absent. Preserve that: delete on a missing
            # workflow is a no-op, not an error.
            m.workflows.remove(wf_name)
            # Services-layer responsibility: clean up the now-empty <name>/
            # dir. Primitives layer (WorkflowCollection.remove) intentionally
            # only unlinks the file. If the dir has unexpected residual
            # files, surface an error rather than silently rmtree-ing
            # non-empty state.
            if wf_dir.is_dir():
                residual = [p.name for p in wf_dir.iterdir()]
                if residual:
                    raise RuntimeError(
                        f"workflow dir {wf_dir} is not empty after removing "
                        f"workflow.md; unexpected residual files: {residual}"
                    )
                wf_dir.rmdir()
            result_path = str(wf_dir.resolve())
        # Module.md is unchanged here, but the historical MCP wrapper
        # reindexed every dna_edit call regardless of target — keep that
        # behaviour so the retrieval index stays warm on workflow churn too.
        _reindex.reindex_dna(root, module_dir)
        return result_path

    if target == "note":
        # Payload contract:
        #   {"name": <slug>, "mode": "create",  "content": <body>, "frontmatter": <dict>}
        #   {"name": <slug>, "mode": "update",  "content": <body>, "frontmatter": <dict>}
        #   {"name": <slug>, "mode": "delete"}
        #
        # Frontmatter validation happens in `_validate_note_frontmatter`
        # (single source of truth for the note schema). ValueError is
        # allowed to propagate — surfaces must see the exact reason.
        from cbi._primitives.modules import (
            create_note as _create_note,
            delete_note as _delete_note,
            update_note as _update_note,
        )

        note_name = payload.get("name")
        if not note_name:
            raise ValueError("payload.name is required for target=note")
        note_mode = payload.get("mode", "create")
        if note_mode not in ("create", "update", "delete"):
            raise ValueError(
                f"payload.mode for target=note must be one of "
                f"'create' | 'update' | 'delete' (default 'create'), "
                f"got: {note_mode!r}"
            )
        content = payload.get("content")
        frontmatter = payload.get("frontmatter")

        if note_mode == "create":
            if content is None:
                raise ValueError(
                    "payload.content is required for target=note, mode=create"
                )
            if not isinstance(frontmatter, dict):
                raise ValueError(
                    "payload.frontmatter (dict) is required for target=note, mode=create"
                )
            written = _create_note(module_dir, note_name, frontmatter, content)
            # Route the single-note upsert through the same helper that
            # the batch rebuild path uses — metadata assembly is
            # centralised in ``_reindex._note_index_payload`` so the
            # CRUD side and the batch side cannot drift.
            _reindex.reindex_notes(root, module_dir, only_slug=note_name)
            result_path = str(written.resolve())
        elif note_mode == "update":
            if content is None:
                raise ValueError(
                    "payload.content is required for target=note, mode=update"
                )
            if not isinstance(frontmatter, dict):
                raise ValueError(
                    "payload.frontmatter (dict) is required for target=note, mode=update"
                )
            written = _update_note(module_dir, note_name, frontmatter, content)
            _reindex.reindex_notes(root, module_dir, only_slug=note_name)
            result_path = str(written.resolve())
        else:  # note_mode == "delete"
            if content is not None:
                raise ValueError(
                    "payload.content is not accepted for target=note, mode=delete"
                )
            if "frontmatter" in payload and payload["frontmatter"] is not None:
                raise ValueError(
                    "payload.frontmatter is not accepted for target=note, mode=delete"
                )
            # Slug validation still fires here so a bad name never
            # reaches the retrieval index_delete call.
            path_after = _delete_note(module_dir, note_name)
            _delete_note_index(root, module_dir, note_name)
            result_path = str(path_after.resolve())

        # Module.md unchanged → skip module.md reindex. Note-level
        # upsert/delete already happened above (reindex_notes /
        # _delete_note_index).
        return result_path

    raise ValueError(f"unknown target: {target!r}")


def split_module(
    source_module_path: str | Path,
    splits: list[dict],
    strategy: str = "comment",
    cwd: str = "",
) -> dict:
    """Atomically split one source module into one source + N new modules.

    Args:
        source_module_path: Path to the source module directory.
        splits:             List of split specs, each like
                            {"path": str, "name": str, "headings": [str, ...],
                             "owner"?: str}.
        strategy:           "comment" (default) — leave a `<!-- split: -->`
                            marker in the source; "move" — strip the section
                            from source entirely.
        cwd:                Project search base.

    Returns a dict describing the result::

        {
          "created":          [<abs path of each new module.md>, ...],
          "dependency_refs":  [{"module": ..., "action_required": ...}, ...],
        }
    """
    from cbi.resources import DNAModule

    if strategy not in ("comment", "move"):
        raise ValueError(f"strategy must be 'comment' or 'move', got: {strategy!r}")

    root = _resolve_root(cwd)
    source_dir = _module_dir(source_module_path, root)
    result = DNAModule.split(
        source_dir,
        splits,
        root=root,
        dry_run=False,
        keep_source=(strategy == "comment"),
    )
    # Source body changed in either strategy; every newly created module
    # also needs its own retrieval entry. result.created_modules carries
    # primitive module objects whose .path is `<created>/.dna/module.md`.
    _reindex.reindex_dna(root, source_dir)
    for created_m in result.created_modules:
        _reindex.reindex_dna(root, created_m.path.parent.parent)
    return {
        "created": [str(m.path.resolve()) for m in result.created_modules],
        "dependency_refs": list(result.dependency_refs_report or []),
    }


def write_doc(
    module_path: str | Path,
    file: str,
    body: str,
    cwd: str = "",
) -> str:
    """[deprecated] Whole-file body write of `.dna/<file>`, preserving frontmatter.

    Prefer `edit_module(target="body")` or `edit_module(target="contract")`.
    """
    from cbi._primitives.modules import write_module_doc
    if file not in ("module.md", "contract.md"):
        raise ValueError(f"file must be 'module.md' or 'contract.md', got: {file!r}")
    root = _resolve_root(cwd)
    module_dir = _module_dir(module_path, root)
    written = write_module_doc(module_dir, file, body)
    _reindex.reindex_dna(root, module_dir)
    return str(written.resolve())


def write_section(
    module_path: str | Path,
    file: str,
    heading: str,
    content: str | None,
    mode: str,
    cwd: str = "",
    *,
    level: int = 2,
    create_if_missing: bool = False,
) -> str:
    """[deprecated] Section-level edit of `.dna/<file>`.

    Prefer `edit_module(target="section")` or `edit_module(target="contract-section")`.
    """
    from cbi._primitives.modules import write_module_section
    if file not in ("module.md", "contract.md"):
        raise ValueError(f"file must be 'module.md' or 'contract.md', got: {file!r}")
    root = _resolve_root(cwd)
    module_dir = _module_dir(module_path, root)
    result = write_module_section(
        module_dir,
        file,
        heading,
        level,
        mode,
        content,
        create_if_missing=create_if_missing,
        dry_run=False,
    )
    _reindex.reindex_dna(root, module_dir)
    return str(Path(result).resolve())
