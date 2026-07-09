"""Module scaffolding — init_module + body templates + frontmatter merge."""

import json
from pathlib import Path

from services._fm import parse_frontmatter, strip_frontmatter

from . import doc_writer as _doc_writer
from .frontmatter_schema import (
    _MODULE_FM_STATUS_VALUES,
    _build_module_md,
)
from .registry import _append_to_index, _index_path


def _now_body_edited_at() -> str:
    """Late-lookup shim over :func:`doc_writer._now_body_edited_at`.

    Import-time binding (``from .doc_writer import _now_body_edited_at``)
    would freeze the reference here and defeat the tests' monkeypatch
    against ``cbi._primitives.modules.doc_writer._now_body_edited_at``.
    Going through the module attribute each call keeps the patch honoured.
    """
    return _doc_writer._now_body_edited_at()

_VALID_TYPES = ("root", "parent", "leaf")

_LEAF_BODY = """
## Positioning

<!-- One sentence: what this module is and why it exists. -->

## Class Diagram

```mermaid
classDiagram
    %% classes, interfaces, key method signatures, relationships
```

## Key Decisions

<!-- Design choices whose "why" is invisible from the code itself.
     Each decision applies to the module as a whole. -->
"""

_PARENT_BODY = """
## Positioning

<!-- One sentence: what this module is and why it exists. -->

## Class Diagram

```mermaid
classDiagram
    %% Each class node = one sub-module (use <<module>> stereotype).
    %% Edges = inter-sub-module dependencies (..> associations).
```

**Mermaid syntax requirement**: Must use `classDiagram`. Each class node represents one sub-module (use `<<module>>` stereotype). Use `..>` association arrows for dependencies. Example:

```mermaid
classDiagram
    class cache { <<module>> }
    class memory { <<module>> }
    class io { <<module>> }
    cache ..> memory : uses
    io ..> cache : configures
```

## Key Decisions

<!-- ONLY cross-sub-module emergent insights:
     why these sub-modules exist together, how they relate at boundaries.
     DO NOT write any single sub-module's internal design here —
     that belongs in the sub-module's own .dna/module.md. -->
"""


def init_module(mod_dir: Path, name: str, owner: str,
                description: str = "",
                with_contract: bool = False,
                type_: str = "leaf",
                status: str | None = None,
                project_root: Path | None = None) -> Path:
    """Initialize a new module.

    type_: 'root' | 'parent' | 'leaf'
      - root: must be the project root; auto-creates index.md
      - parent: requires root .dna/ to exist; uses parent body template
      - leaf: requires root .dna/ to exist; uses leaf body template

    status: 'spec' | 'planned' | 'implemented' — declared intent of the new
      module. When omitted, defaults to 'spec' for parent/leaf (architect is
      writing DNA ahead of code) and 'implemented' for root (the project root
      module of an existing repo is by definition already real). Validated
      against _MODULE_FM_STATUS_VALUES.
    """
    if type_ not in _VALID_TYPES:
        raise ValueError(
            f"type_ must be one of {_VALID_TYPES}, got: {type_!r}"
        )
    if status is None:
        status = "implemented" if type_ == "root" else "spec"
    if status not in _MODULE_FM_STATUS_VALUES:
        raise ValueError(
            f"status must be one of {_MODULE_FM_STATUS_VALUES}, got: {status!r}"
        )

    target = mod_dir.resolve()
    root = (project_root or Path.cwd()).resolve()

    # Registry (.cbim/index.md) must exist — proves cbim is installed.
    # The project-root .dna/ is OPTIONAL; mixed monorepos can skip it.
    if not _index_path(root).exists():
        raise FileNotFoundError(
            f"Registry missing at {_index_path(root)}.\n"
            f"Run `python .cbim/install.py` first to install cbim into this project."
        )

    if type_ == "root":
        if target != root:
            raise ValueError(
                f"--type root must be the project root (creates ./.dna/module.md).\n"
                f"  project root : {root}\n"
                f"  target       : {target}\n"
                f"For monorepos, a project-root module is optional — consider "
                f"`--type parent` on your workspace dir (e.g. `packages/`) instead."
            )

    aimod = mod_dir / ".dna"
    if aimod.exists():
        raise FileExistsError(f".dna already exists: {aimod}")

    aimod.mkdir(parents=True)

    # v2 frontmatter (PR-1): 5 required fields (`name`, `owner`, `description`,
    # `keywords`, `status`) + optional `links`. `dependencies` / `includeDirs`
    # are gone — dependency edges live exclusively in parent module class
    # diagrams; mount scope is described by `links` (kind: local default,
    # injected in-memory by loader when omitted on disk).
    fm_lines = [
        "---",
        f"name: {name}",
        f"owner: {owner}",
    ]
    if description:
        fm_lines.append(f"description: {description}")
    else:
        # Loader (services/_fm.parse_frontmatter) skips `#`-leading lines but
        # does NOT strip inline comments — a trailing `# ...` would be
        # captured into the value verbatim and pollute retrieval. So we emit
        # the human-facing hint as a separate comment line above the value.
        fm_lines.append("# description ≤80 字单句，结构「定位语+职责边界」")
        fm_lines.append("description: TODO")
    fm_lines.append("# keywords 5–8 条 kebab，详见元数据检索规范节")
    fm_lines.append("keywords: [TODO]")
    fm_lines.append(f"status: {status}")
    # Kernel-managed freshness stamp; see doc_writer.stamp_module_md_content
    # for the writer-wide policy. Init is the first "write" for this module,
    # so the initial value is now.
    fm_lines.append(f"body_edited_at: {_now_body_edited_at()}")
    fm_lines.append("---")

    body = _LEAF_BODY if type_ == "leaf" else _PARENT_BODY

    (aimod / "module.md").write_text(
        "\n".join(fm_lines) + body,
        encoding="utf-8",
    )

    if with_contract:
        (aimod / "contract.md").write_text(
            f"# {name} — Contract\n\n## Interfaces\n\n## Events\n",
            encoding="utf-8",
        )

    # Append to the registry so list_modules / snapshot see it immediately.
    # (Note: index.md lives at .cbim/index.md, not under any .dna/.)
    rel = mod_dir.resolve().relative_to(root).as_posix()
    _append_to_index(root, rel)

    return aimod


def update_module_meta(mod_dir: Path, **kwargs) -> None:
    """Merge kwargs into module.md frontmatter (or legacy module.json)."""
    module_md = mod_dir / ".dna" / "module.md"
    legacy_json = mod_dir / ".dna" / "module.json"

    if module_md.exists():
        raw = module_md.read_text(encoding="utf-8")
        meta = parse_frontmatter(raw)
        body = strip_frontmatter(raw)
        meta.update({k: v for k, v in kwargs.items() if v is not None})
        # module.md write path: stamp freshness (see doc_writer for the
        # writer-wide policy).
        meta["body_edited_at"] = _now_body_edited_at()
        module_md.write_text(_build_module_md(meta, body), encoding="utf-8")
    elif legacy_json.exists():
        data = json.loads(legacy_json.read_text(encoding="utf-8"))
        data.update({k: v for k, v in kwargs.items() if v is not None})
        legacy_json.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


__all__ = [
    "_VALID_TYPES",
    "_LEAF_BODY",
    "_PARENT_BODY",
    "init_module",
    "update_module_meta",
]
