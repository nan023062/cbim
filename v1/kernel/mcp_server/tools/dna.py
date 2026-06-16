"""
mcp_server/tools/dna.py — MCP tools for the CBIM module knowledge system (.dna/).

Read tools:
  dna_list(cwd)                  — all registered modules
  dna_show(module_path, cwd)     — full module.md + contract.md content
  dna_reindex(cwd)               — rescan filesystem, rebuild registry

Write tools (route through services.knowledge_service):
  dna_init(dir, kind, name, owner, description, with_contract, status, cwd)
  dna_edit(module_path, target, payload, mode, cwd)
  dna_split(source_module_path, splits, strategy, cwd)
  dna_write_doc(module_path, file, body, cwd)            [deprecated]
  dna_write_section(module_path, file, heading, content, mode, cwd) [deprecated]
"""

from __future__ import annotations

import sys

from context import project_root


def register(mcp) -> None:
    @mcp.tool()
    def dna_list(cwd: str = "") -> str:
        """List all registered .dna/ modules.

        Args:
            cwd: Project directory (default: current working dir of the MCP server).

        Returns:
            One module per line as `<path> [<owner>] <description>`.
        """
        from services import list_modules as _list_modules
        modules = _list_modules(cwd=cwd or None)
        if not modules:
            return "(no .dna modules found)"
        return "\n".join(
            f"{m['path']:32s}  [{m['owner']:12s}]  {m['description'][:40]}"
            for m in modules
        )

    @mcp.tool()
    def dna_show(module_path: str, cwd: str = "") -> str:
        """Show metadata + architecture body for the .dna/ module at `module_path`.

        Returns frontmatter + Positioning + Class Diagram + Key Decisions per v1/docs/MODULE-MD-DESIGN.zh-CN.md.

        Args:
            module_path: Path to the module directory (containing .dna/), e.g. 'src/combat'.
            cwd: Project directory (default: current working dir).
        """
        from services import (
            PathOutsideRootError,
            get_module,
            resolve_within_root,
        )
        root = project_root(cwd or None)
        try:
            # Root module ('' / '.') is a normal readable module — service
            # layer (knowledge_service.get_module, list_modules, registry)
            # already treats path "." as "root itself", so the entry guard
            # only needs to keep traversal-out attempts out, not the root
            # in.
            mod_dir = resolve_within_root(root, module_path, allow_root_itself=True)
        except PathOutsideRootError as e:
            return f"ERROR: {e}"
        info = get_module(module_path, cwd=cwd)
        if info is None:
            return f"ERROR: no .dna/ found in {mod_dir}"
        lines = [
            f"Name        : {info['name']}",
            f"Owner       : {info['owner']}",
            f"Description : {info['description']}",
        ]
        if info["keywords"]:
            lines.append(f"Keywords    : {', '.join(info['keywords'])}")
        if info["dependencies"]:
            lines.append(f"Dependencies: {', '.join(info['dependencies'])}")
        wf_ids = [w["id"] for w in info["workflows"]]
        if wf_ids:
            lines.append(f"Workflows   : {', '.join(wf_ids)}")
        if info["body"]:
            lines.append("\n--- module.md (body) ---\n" + info["body"])
        if info["contract"]:
            lines.append("\n--- contract.md ---\n" + info["contract"])
        return "\n".join(lines)

    @mcp.tool()
    def dna_reindex(cwd: str = "") -> str:
        """Rescan the filesystem and rebuild `.cbim/index.md` registry.

        Args:
            cwd: Project directory (default: current working dir).
        """
        from services import reindex_modules
        count = reindex_modules(cwd=cwd)
        return f"Rebuilt registry  ({count} modules)"

    @mcp.tool()
    def dna_init(
        dir: str,
        kind: str,
        name: str,
        owner: str,
        description: str = "",
        with_contract: bool = False,
        status: str = "",
        cwd: str = "",
    ) -> str:
        """Create a new `.dna/` module at `dir` and register it.

        Args:
            dir:           Directory that will own the new `.dna/` subdir
                           (relative to the project root or absolute).
            kind:          "root" | "parent" | "leaf".
            name:          Module name (frontmatter).
            owner:         Owning role (frontmatter).
            description:   Optional description.
            with_contract: Also create `.dna/contract.md`.
            status:        "spec" | "planned" | "implemented" or "" for default.
            cwd:           Project directory (default: current working dir).

        Returns:
            Path of the created `.dna/` directory, or `ERROR: ...` on failure.

        All three module kinds use classDiagram-based templates; parent/root use <<module>> stereotype per sub-module node, leaf shows code-level classes.
        """
        from services import PathOutsideRootError, init_module, resolve_within_root
        root = project_root(cwd or None)
        # `kind == "root"` REQUIRES the target to be the project root itself
        # (cbi._primitives.modules.scaffold.init_module enforces this), so
        # the entry guard must allow `dir == "."` precisely for that kind.
        # Other kinds (parent / leaf) are still rejected — initialising a
        # parent/leaf at the project root is a caller mistake.
        allow_root = kind == "root"
        try:
            resolve_within_root(root, dir, allow_root_itself=allow_root)
        except PathOutsideRootError as e:
            return f"ERROR: {e}"
        try:
            dna_dir = init_module(
                dir,
                kind=kind,
                name=name,
                owner=owner,
                description=description,
                with_contract=with_contract,
                status=status or None,
                cwd=cwd,
            )
        except FileExistsError as e:
            return f"ERROR: {e}"
        except (ValueError, FileNotFoundError) as e:
            return f"ERROR: {e}"
        return dna_dir

    @mcp.tool()
    def dna_edit(
        module_path: str,
        target: str,
        payload: dict,
        mode: str = "replace",
        cwd: str = "",
    ) -> str:
        """Edit `module.md` / `contract.md` / a workflow under `<module_path>/.dna/`.

        Args:
            module_path: Path to the module directory (the one containing `.dna/`).
            target:      "frontmatter" | "body" | "section" | "contract" |
                         "contract-section" | "workflow".
            payload:     Per-target dict; see services.knowledge_service.edit_module.
            mode:        Default section mode when payload omits its own "mode".
            cwd:         Project directory (default: current working dir).

        Returns:
            Path of the saved file, or `ERROR: ...` on failure.
        """
        from services import PathOutsideRootError, edit_module, resolve_within_root
        root = project_root(cwd or None)
        try:
            # Root module is a normal editable module — frontmatter,
            # body, sections, contract, and workflows all apply just as
            # they do for child modules; services.edit_module routes
            # `module_path == "."` to `<root>/.dna/module.md` correctly.
            resolve_within_root(root, module_path, allow_root_itself=True)
        except PathOutsideRootError as e:
            return f"ERROR: {e}"
        # Path-confine the input string here; the service write also
        # handles the post-edit retrieval reindex inline now (Batch 1).
        try:
            return edit_module(module_path, target, payload, mode=mode, cwd=cwd)
        except FileNotFoundError as e:
            return f"ERROR: {e}"
        except (ValueError, LookupError, RuntimeError) as e:
            return f"ERROR: {e}"

    @mcp.tool()
    def dna_split(
        source_module_path: str,
        splits: list,
        strategy: str = "comment",
        cwd: str = "",
    ) -> dict:
        """Atomically split one source module into one source + N new modules.

        Args:
            source_module_path: Path to the source module directory.
            splits:             List of split specs, each like
                                {"path": str, "name": str, "headings": [str, ...],
                                 "owner"?: str}.
            strategy:           "comment" (default — leave `<!-- split -->` marker)
                                or "move" (strip the section entirely).
            cwd:                Project directory (default: current working dir).

        Returns:
            {"created": [paths], "dependency_refs": [refs]} on success, or
            {"error": str} on failure.
        """
        from services import PathOutsideRootError, resolve_within_root, split_module
        root = project_root(cwd or None)
        try:
            # Splitting the root module itself is intentionally rejected:
            # the splitter's `source_rel = source_mod_dir.relative_to(root)`
            # path produces an empty string when source == root, which is
            # not exercised by any primitive code path. Splitting downward
            # from root is also semantically wrong — the root module is
            # the aggregate, not a leaf to be decomposed. Use child modules
            # as split sources.
            resolve_within_root(
                root, source_module_path, allow_root_itself=False
            )
        except PathOutsideRootError as e:
            return {"error": str(e)}
        # Each split spec carries a ``path`` from LLM input — reject
        # any that escape the project root, and also reject the root
        # itself (you cannot create a "new root" via split).
        for spec in splits or []:
            if not isinstance(spec, dict):
                continue
            spec_path = spec.get("path")
            if not spec_path:
                continue
            try:
                resolve_within_root(root, spec_path, allow_root_itself=False)
            except PathOutsideRootError as e:
                return {"error": str(e)}
        # Source + every newly-created module are reindexed inside
        # services.knowledge_service.split_module; nothing to do here.
        try:
            return split_module(
                source_module_path,
                splits,
                strategy=strategy,
                cwd=cwd,
            )
        except (ValueError, LookupError, FileNotFoundError, FileExistsError, RuntimeError) as e:
            return {"error": str(e)}

    @mcp.tool()
    def dna_write_doc(
        module_path: str,
        file: str,
        body: str,
        cwd: str = "",
    ) -> str:
        """[deprecated] Whole-file body write of `.dna/<file>`, preserving frontmatter.

        Prefer `dna_edit(target="body")` or `dna_edit(target="contract")`.

        Args:
            module_path: Path to the module directory.
            file:        "module.md" or "contract.md".
            body:        Body markdown (frontmatter is preserved separately).
            cwd:         Project directory (default: current working dir).
        """
        print(
            "[DEPRECATED] dna_write_doc is deprecated and will be removed in "
            "the next minor release (1.1.0); use dna_edit(target='body' or "
            "'contract') instead.",
            file=sys.stderr,
        )
        from services import PathOutsideRootError, resolve_within_root, write_doc
        root = project_root(cwd or None)
        try:
            # Mirror dna_edit(target='body'/'contract') — root module's
            # module.md / contract.md are legitimate write targets.
            resolve_within_root(root, module_path, allow_root_itself=True)
        except PathOutsideRootError as e:
            return f"ERROR: {e}"
        try:
            return write_doc(module_path, file, body, cwd=cwd)
        except (ValueError, FileNotFoundError) as e:
            return f"ERROR: {e}"

    @mcp.tool()
    def dna_write_section(
        module_path: str,
        file: str,
        heading: str,
        content: str,
        mode: str,
        cwd: str = "",
    ) -> str:
        """[deprecated] Section-level edit of `.dna/<file>`.

        Prefer `dna_edit(target="section")` or `dna_edit(target="contract-section")`.

        Args:
            module_path: Path to the module directory.
            file:        "module.md" or "contract.md".
            heading:     Exact heading text (no leading '#').
            content:     Markdown body for the section (ignored when mode='delete').
            mode:        "replace" | "append" | "insert-after" | "delete".
            cwd:         Project directory (default: current working dir).
        """
        print(
            "[DEPRECATED] dna_write_section is deprecated and will be removed "
            "in the next minor release (1.1.0); use dna_edit(target='section' "
            "or 'contract-section') instead.",
            file=sys.stderr,
        )
        from services import PathOutsideRootError, resolve_within_root, write_section
        root = project_root(cwd or None)
        try:
            # Mirror dna_edit(target='section'/'contract-section') — root
            # module's sections are legitimate write targets.
            resolve_within_root(root, module_path, allow_root_itself=True)
        except PathOutsideRootError as e:
            return f"ERROR: {e}"
        try:
            return write_section(
                module_path, file, heading,
                None if mode == "delete" else content,
                mode,
                cwd=cwd,
            )
        except (ValueError, FileNotFoundError, LookupError, RuntimeError) as e:
            return f"ERROR: {e}"
