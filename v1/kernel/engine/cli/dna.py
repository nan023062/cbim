"""`cbim dna` domain — module (.dna) commands.

Drives cbi.resources.DNAModule directly. write-doc and write-section retain
their stderr DeprecationWarning and continue calling the surgical engine
primitives (write_module_doc / write_module_section) that preserve
frontmatter byte-for-byte; the object model's save() path re-renders
frontmatter and would break that guarantee.
"""

# Why one file: this is the CLI surface of one resource (DNAModule); register/dispatch/handlers/helpers are mutually exclusive consumers — splitting would fragment the args->payload->service flow.

import argparse
import sys
from pathlib import Path

from ._shared import _read_content_arg


def register(sub: argparse._SubParsersAction) -> argparse.ArgumentParser:
    pd = sub.add_parser("dna", help="Module (.dna) commands")
    dsub = pd.add_subparsers(dest="command")
    _p = dsub.add_parser("list"); _p.add_argument("--root", default=None)
    _p = dsub.add_parser("show"); _p.add_argument("path")
    _p = dsub.add_parser("init"); _p.add_argument("dir"); _p.add_argument("--type", required=True, choices=["root", "parent", "leaf"]); _p.add_argument("--name", required=True); _p.add_argument("--owner", required=True); _p.add_argument("--description", default=""); _p.add_argument("--with-contract", action="store_true", dest="with_contract"); _p.add_argument("--status", default=None, choices=["spec", "planned", "implemented"], help="Declared intent (default: spec for parent/leaf, implemented for root)")
    _p = dsub.add_parser("reindex"); _p.add_argument("--root", default=None)
    _p = dsub.add_parser(
        "edit",
        help=(
            "Unified module edit: frontmatter / body / section / contract / "
            "contract-section / workflow. Replaces write-doc and write-section."
        ),
    )
    _p.add_argument("module_path", help="Path to the module directory (the one containing .dna/)")
    _p.add_argument("--target", required=True,
                    choices=["frontmatter", "body", "section", "contract", "contract-section", "workflow"],
                    help="What to edit")
    _p.add_argument("--field", default=None, help="Frontmatter field name (for --target frontmatter)")
    _p.add_argument("--value", default=None,
                    help="Frontmatter scalar value (for --target frontmatter); "
                         "use --value-list for list-typed fields")
    _p.add_argument("--value-list", dest="value_list", nargs="+", default=None,
                    metavar="ITEM",
                    help="Frontmatter list value (one or more items, space-separated); "
                         "mutually exclusive with --value")
    _p.add_argument("--clear", dest="clear", action="store_true",
                    help="Clear a list-typed frontmatter field (set to []). "
                         "Only valid with --target frontmatter and a list-typed --field.")
    _p.add_argument("--content", default=None, help="Inline markdown content")
    _p.add_argument("--content-file", dest="content_file", default=None, help="Read content from this path")
    _p.add_argument("--stdin", action="store_true", help="Read content from stdin")
    _p.add_argument("--heading", default=None, help="Exact heading text (for section / contract-section)")
    _p.add_argument("--level", type=int, default=2, choices=[2, 3], help="Heading level (default: 2)")
    _p.add_argument("--mode", default=None, choices=["replace", "append", "insert-after", "delete"],
                    help="Section edit mode (default: replace; ignored for non-section targets)")
    _p.add_argument("--name", default=None, help="Workflow slug (for --target workflow)")
    _p.add_argument("--create-if-missing", dest="create_if_missing", action="store_true",
                    help="For section replace/append: if heading absent, append a new section at EOF")
    _pos = _p.add_mutually_exclusive_group()
    _pos.add_argument("--insert-after", dest="insert_after", default=None,
                      metavar="HEADING",
                      help="When creating a new section, insert it after the section with this heading.")
    _pos.add_argument("--insert-at-top", dest="insert_at_top", action="store_true",
                      help="When creating a new section, insert it at the top of the body "
                           "(after frontmatter, before first section).")
    _p.add_argument("--dry-run", dest="dry_run", action="store_true",
                    help="Print rendered result to stdout; do not write to disk")

    _p = dsub.add_parser("write-doc", help="[deprecated] use `dna edit --target body` instead")
    _p.add_argument("module_path", help="Path to the module directory (the one containing .dna/)")
    _p.add_argument("--file", required=True, choices=["module.md", "contract.md"], help="Which file in .dna/ to write")
    _p.add_argument("--content", default=None, help="Body markdown as an inline string")
    _p.add_argument("--content-file", dest="content_file", default=None, help="Read body markdown from this path")
    _p = dsub.add_parser(
        "write-section",
        help="[deprecated] use `dna edit --target section` instead",
    )
    _p.add_argument("module_path", help="Path to the module directory (the one containing .dna/)")
    _p.add_argument("--file", required=True, choices=["module.md", "contract.md"], help="Which file in .dna/ to edit")
    _p.add_argument("--heading", required=True, help="Exact heading text (without leading '#'s)")
    _p.add_argument("--level", type=int, default=2, choices=[2, 3], help="Heading level (default: 2)")
    _p.add_argument("--mode", required=True, choices=["replace", "append", "insert-after", "delete"], help="Edit mode")
    _p.add_argument("--content", default=None, help="Inline markdown content")
    _p.add_argument("--content-file", dest="content_file", default=None, help="Read content from this path")
    _p.add_argument("--stdin", action="store_true", help="Read content from stdin")
    _p.add_argument("--create-if-missing", dest="create_if_missing", action="store_true",
                    help="For replace/append: if heading absent, append a new section at EOF")
    _pos = _p.add_mutually_exclusive_group()
    _pos.add_argument("--insert-after", dest="insert_after", default=None,
                      metavar="HEADING",
                      help="When creating a new section, insert it after the section with this heading.")
    _pos.add_argument("--insert-at-top", dest="insert_at_top", action="store_true",
                      help="When creating a new section, insert it at the top of the body "
                           "(after frontmatter, before first section).")
    _p.add_argument("--dry-run", dest="dry_run", action="store_true",
                    help="Print resulting file to stdout; do not write")
    _p = dsub.add_parser(
        "split",
        help=(
            "Atomically decompose one source module into one source + N new "
            "modules by extracting named H2 sections. Reports (does NOT "
            "rewrite) other modules whose dependencies reference the source."
        ),
    )
    _p.add_argument("source", help="Source module directory (the one containing .dna/)")
    _p.add_argument("--into", action="append", default=[], dest="into",
                    metavar="PATH:NAME:HEADINGS",
                    help="Repeatable. PATH:NAME:H1|H2|... — H is a literal H2 heading "
                         "text (no leading '##'); multiple headings separated by '|'. "
                         "Example: --into packages/foo:Foo:Positioning|Key Decisions")
    _p.add_argument("--owner-override", dest="owner_override", default=None,
                    help="Override owner for every new split (default: inherit source owner)")
    _p.add_argument("--keep-source", dest="keep_source", action="store_true", default=True,
                    help="(default) Leave split sections in source body with a "
                         "'<!-- split: moved ... -->' comment beneath each heading")
    _p.add_argument("--no-keep-source", dest="keep_source", action="store_false",
                    help="Remove the migrated sections from source entirely")
    _p.add_argument("--dry-run", dest="dry_run", action="store_true",
                    help="Print the plan + dependency_refs report; touch zero files")
    return pd


def dispatch(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    if not args.command:
        parser.print_help(); return 1
    # Late lookup via the engine.cli package so monkeypatch.setattr(engine.cli, ...)
    # in tests rebinds the handler the dispatcher actually invokes (this matches
    # the pre-split monolith semantics where every name was already at module scope).
    from engine import cli as _pkg
    dna_cmds = {
        "list": _pkg._handle_dna_list,
        "show": _pkg._handle_dna_show,
        "init": _pkg._handle_dna_init,
        "reindex": _pkg._handle_dna_reindex,
        "edit": _pkg._handle_dna_edit,
        "split": _pkg._handle_dna_split,
        "write-doc": _pkg._handle_dna_write_doc,
        "write-section": _pkg._handle_dna_write_section,
    }
    return dna_cmds[args.command](args)


def _handle_dna_list(args: argparse.Namespace) -> int:
    from cbi.resources import DNAModule
    root = Path(args.root) if args.root else Path.cwd()
    modules = DNAModule.list_all(root=root)
    if not modules:
        print("  No .dna modules found.")
        return 0
    for m in modules:
        keywords = m.frontmatter.get("keywords") or []
        kw = f"  [{', '.join(keywords)}]" if keywords else ""
        owner = m.frontmatter.get("owner", "") or ""
        desc = m.frontmatter.get("description", "") or ""
        # Status default = "implemented" matches load_module()'s back-compat
        # default; here we render straight from frontmatter for the same effect.
        status = m.frontmatter.get("status", "implemented") or "implemented"
        print(f"  {m.id:32s}  [{owner:12s}]  <{status:11s}>  {desc[:40]}{kw}")
    return 0


def _handle_dna_show(args: argparse.Namespace) -> int:
    from cbi.resources import DNAModule
    mod_dir = Path(args.path)
    root = mod_dir.parent if mod_dir.parent != mod_dir else Path.cwd()
    try:
        m = DNAModule.load(mod_dir, root=root)
    except FileNotFoundError:
        print(f"No .dna/ found in: {mod_dir}", file=sys.stderr)
        return 1

    name = m.frontmatter.get("name", m.id)
    owner = m.frontmatter.get("owner", "") or ""
    description = m.frontmatter.get("description", "") or ""
    keywords = m.frontmatter.get("keywords") or []
    dependencies = m.frontmatter.get("dependencies") or []
    status = m.frontmatter.get("status", "implemented") or "implemented"
    workflows = m.workflows.list()
    architecture = m.body.read()
    contract = m.contract.body.read() if m.contract.exists() else ""

    print(f"Name        : {name}")
    print(f"Owner       : {owner}")
    print(f"Status      : {status}")
    print(f"Description : {description}")
    if keywords:     print(f"Keywords    : {', '.join(keywords)}")
    if dependencies: print(f"Dependencies: {', '.join(dependencies)}")
    if workflows:    print(f"Workflows   : {', '.join(workflows)}")
    if architecture: print(f"\n--- module.md (body) ---\n{architecture[:600]}")
    if contract:     print(f"\n--- contract.md ---\n{contract[:600]}")
    return 0


def _handle_dna_init(args: argparse.Namespace) -> int:
    from services import init_module
    try:
        aimod_dir = init_module(
            args.dir,
            kind=args.type,
            name=args.name,
            owner=args.owner,
            description=args.description,
            with_contract=args.with_contract,
            status=args.status,
        )
        # init_module returns the absolute path to .dna/ (the directory containing module.md).
        print(f"Initialized [{args.type}]: {aimod_dir}/")
        files = ".dna/module.md"
        if args.type == "root":
            files += ", index.md"
        if args.with_contract:
            files += ", contract.md"
        print(f"  Edit {files}")
        if args.type != "root":
            print(f"  Then run: python .cbim/engine dna reindex")
    except (FileExistsError, FileNotFoundError, ValueError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    return 0


def _handle_dna_reindex(args: argparse.Namespace) -> int:
    from services import reindex_modules
    count = reindex_modules(cwd=args.root or "")
    print(f"Rebuilt index.md  ({count} modules)")
    return 0


def _handle_dna_write_doc(args: argparse.Namespace) -> int:
    """[DEPRECATED] Write body into <module-path>/.dna/<file>, preserving frontmatter."""
    from services import write_doc
    print(
        "[DEPRECATED] 'dna write-doc' is deprecated and will be removed in "
        "the next minor release (1.1.0); use 'dna edit --target body' instead.",
        file=sys.stderr,
    )
    if args.content is None and args.content_file is None:
        print("Error: one of --content or --content-file is required", file=sys.stderr)
        return 1
    if args.content is not None and args.content_file is not None:
        print("Error: --content and --content-file are mutually exclusive", file=sys.stderr)
        return 1

    if args.content is not None:
        body = args.content
    else:
        src = Path(args.content_file)
        if not src.is_file():
            print(f"Error: --content-file not found: {src}", file=sys.stderr)
            return 1
        body = src.read_text(encoding="utf-8")

    try:
        path = write_doc(args.module_path, args.file, body)
    except (ValueError, FileNotFoundError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    print(path)
    return 0


def _handle_dna_write_section(args: argparse.Namespace) -> int:
    """[DEPRECATED] Section-level surgical edit of .dna/{module.md,contract.md}."""
    print(
        "[DEPRECATED] 'dna write-section' is deprecated and will be removed in "
        "the next minor release (1.1.0); use 'dna edit --target section' instead.",
        file=sys.stderr,
    )
    if getattr(args, "insert_after", None) or getattr(args, "insert_at_top", False):
        print(
            "Error: --insert-after / --insert-at-top are not supported by the "
            "deprecated 'dna write-section'; use 'dna edit --target section' instead.",
            file=sys.stderr,
        )
        return 1
    needs_content = args.mode != "delete"
    sources = [
        ("--content", args.content is not None),
        ("--content-file", args.content_file is not None),
        ("--stdin", bool(getattr(args, "stdin", False))),
    ]
    provided = [name for name, ok in sources if ok]

    if needs_content:
        if len(provided) == 0:
            print(
                "Error: one of --content, --content-file, or --stdin is required",
                file=sys.stderr,
            )
            return 1
        if len(provided) > 1:
            print(
                f"Error: {', '.join(provided)} are mutually exclusive",
                file=sys.stderr,
            )
            return 1
        if args.content is not None:
            body = args.content
        elif args.content_file is not None:
            src = Path(args.content_file)
            if not src.is_file():
                print(f"Error: --content-file not found: {src}", file=sys.stderr)
                return 1
            body = src.read_text(encoding="utf-8")
        else:
            body = sys.stdin.read()
    else:
        if provided:
            print(
                f"Error: {', '.join(provided)} forbidden with --mode delete",
                file=sys.stderr,
            )
            return 1
        body = None

    # Dry-run renders the would-be file text as a string. The regular
    # write_section service is commit-only; the dedicated dry_run_section
    # service exposes the read-only side of the primitive so cli.py
    # stays free of `cbi._primitives` reach-ins (Batch 2 banned-api).
    if bool(getattr(args, "dry_run", False)):
        from services import dry_run_section
        try:
            result = dry_run_section(
                args.module_path,
                args.file,
                args.heading,
                args.level,
                args.mode,
                body,
                create_if_missing=bool(getattr(args, "create_if_missing", False)),
            )
        except (ValueError, FileNotFoundError, LookupError, RuntimeError) as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1
        sys.stdout.write(result)
        if not result.endswith("\n"):
            sys.stdout.write("\n")
        return 0

    from services import write_section
    try:
        path = write_section(
            args.module_path,
            args.file,
            args.heading,
            body,
            args.mode,
            level=args.level,
            create_if_missing=bool(getattr(args, "create_if_missing", False)),
        )
    except (ValueError, FileNotFoundError, LookupError, RuntimeError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    print(path)
    return 0


def _handle_dna_edit(args: argparse.Namespace) -> int:
    """Unified module-edit entry point.

    Routes by --target to the appropriate sub-object on the in-memory
    DNAModule. Frontmatter edits use --field/--value; everything else uses
    the --content / --content-file / --stdin trio resolved by _read_content_arg.

    Dry-run prints the rendered result to stdout and does NOT touch disk.
    """
    from cbi.resources import DNAModule
    from services import edit_module

    target = args.target
    dry_run = bool(getattr(args, "dry_run", False))

    try:
        payload = _build_dna_edit_payload(args, target)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    if target == "workflow" and dry_run:
        sys.stdout.write(payload["content"] if payload["content"].endswith("\n")
                         else payload["content"] + "\n")
        return 0

    if dry_run:
        try:
            m = DNAModule.load(Path(args.module_path))
        except FileNotFoundError as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1
        try:
            _apply_dna_edit_in_memory(m, target, payload)
        except (ValueError, LookupError, FileNotFoundError, RuntimeError) as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1
        if target in ("contract", "contract-section"):
            out = m.contract.body.read()
        else:
            out = m._render()
        sys.stdout.write(out)
        if out and not out.endswith("\n"):
            sys.stdout.write("\n")
        return 0

    try:
        path = edit_module(args.module_path, target, payload)
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    except (ValueError, LookupError, RuntimeError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    print(path)
    return 0


def _build_dna_edit_payload(args: argparse.Namespace, target: str) -> dict:
    """Convert argparse Namespace into the dict shape expected by services.edit_module."""
    if target == "frontmatter":
        if args.field is None:
            raise ValueError("--field is required for --target frontmatter")
        value_given = args.value is not None
        list_given = getattr(args, "value_list", None) is not None
        clear_given = bool(getattr(args, "clear", False))
        if sum([value_given, list_given, clear_given]) > 1:
            raise ValueError("--value, --value-list, --clear are mutually exclusive")
        if not (value_given or list_given or clear_given):
            raise ValueError(
                "one of --value / --value-list / --clear is required for --target frontmatter"
            )
        from services import get_module_fm_schema
        _MODULE_FM_LIST_FIELDS = get_module_fm_schema()["list_fields"]
        if args.field in _MODULE_FM_LIST_FIELDS and value_given:
            raise ValueError(
                f"field {args.field!r} is a list-typed field; "
                f"use --value-list instead of --value\n"
                f"       example: cbim dna edit ... --field {args.field} "
                f"--value-list item_a item_b"
            )
        if args.field == "status" and (list_given or clear_given):
            raise ValueError(
                "field 'status' is a scalar enum; use --value, not --value-list / --clear"
            )
        payload = {"field": args.field}
        if clear_given:
            payload["value_list"] = []
        elif list_given:
            payload["value_list"] = args.value_list
        else:
            payload["value"] = args.value
        return payload

    if target in ("body", "contract"):
        content = _read_content_arg(args)
        if content is None:
            raise ValueError("one of --content / --content-file / --stdin is required")
        return {"content": content}

    if target in ("section", "contract-section"):
        if args.heading is None:
            raise ValueError(f"--heading is required for --target {target}")
        mode = args.mode or "replace"
        needs_content = mode != "delete"
        content = _read_content_arg(args)
        if needs_content and content is None:
            raise ValueError("one of --content / --content-file / --stdin is required")
        if not needs_content and content is not None:
            raise ValueError("content sources are forbidden with --mode delete")
        return {
            "heading": args.heading,
            "content": content,
            "mode": mode,
            "level": args.level,
            "create_if_missing": bool(args.create_if_missing),
            "insert_after": getattr(args, "insert_after", None),
            "insert_at_top": bool(getattr(args, "insert_at_top", False)),
        }

    if target == "workflow":
        if not args.name:
            raise ValueError("--name is required for --target workflow")
        content = _read_content_arg(args)
        if content is None:
            raise ValueError("one of --content / --content-file / --stdin is required")
        return {"name": args.name, "content": content}

    raise ValueError(f"unknown --target: {target!r}")


def _apply_dna_edit_in_memory(m, target: str, payload: dict) -> None:
    """Dry-run helper: apply the same mutations the service would, without saving."""
    if target == "frontmatter":
        from services import get_module_fm_schema
        _MODULE_FM_STATUS_VALUES = get_module_fm_schema()["status_values"]
        new_value = payload.get("value_list", payload.get("value"))
        if payload["field"] == "status" and new_value not in _MODULE_FM_STATUS_VALUES:
            raise ValueError(
                f"status must be one of {_MODULE_FM_STATUS_VALUES}, got: {new_value!r}"
            )
        m.frontmatter.set(payload["field"], new_value)
    elif target == "body":
        m.body.write(payload["content"])
    elif target == "section":
        m.body.write_section(
            payload["heading"], payload.get("content"),
            level=int(payload.get("level", 2)),
            mode=payload.get("mode", "replace"),
            create_if_missing=bool(payload.get("create_if_missing", False)),
            insert_after=payload.get("insert_after"),
            insert_at_top=bool(payload.get("insert_at_top", False)),
        )
    elif target == "contract":
        m.contract.body.write(payload["content"])
    elif target == "contract-section":
        m.contract.body.write_section(
            payload["heading"], payload.get("content"),
            level=int(payload.get("level", 2)),
            mode=payload.get("mode", "replace"),
            create_if_missing=bool(payload.get("create_if_missing", False)),
            insert_after=payload.get("insert_after"),
            insert_at_top=bool(payload.get("insert_at_top", False)),
        )


def _parse_into_spec(spec: str) -> dict:
    """Parse one --into PATH:NAME:H1|H2|... value into a split dict.

    Format: <path>:<name>:<heading>[|<heading>...]
    Headings are literal H2 text (no leading '##'); pipe-separated.
    """
    parts = spec.split(":")
    if len(parts) < 3:
        raise ValueError(
            f"--into value must be PATH:NAME:HEADINGS, got: {spec!r}"
        )
    # Path may itself contain a drive letter on Windows (e.g. C:\foo). To stay
    # cross-platform we accept the FIRST colon as the path/name delimiter and
    # the LAST as the name/headings delimiter; everything between is the name.
    # For simplicity in this v1 surface, we require POSIX-style paths in --into
    # (the typical usage is project-relative). Document this in --help if it
    # ever causes friction.
    path = parts[0]
    name = parts[1]
    headings_raw = ":".join(parts[2:])
    headings = [h.strip() for h in headings_raw.split("|") if h.strip()]
    if not headings:
        raise ValueError(f"--into has no headings after the second colon: {spec!r}")
    return {
        "path": path,
        "name": name,
        "headings": headings,
    }


def _handle_dna_split(args: argparse.Namespace) -> int:
    """Atomic cross-module split. See `cbim dna split --help`.

    Prints the report (created paths + dependency_refs warnings) to stdout.
    Returns 0 on success, 1 on validation / atomicity failure.
    """
    from cbi.resources import DNAModule

    if not args.into:
        print(
            "Error: at least one --into PATH:NAME:HEADINGS is required",
            file=sys.stderr,
        )
        return 1

    try:
        splits = [_parse_into_spec(s) for s in args.into]
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    if args.owner_override:
        for s in splits:
            s["owner"] = args.owner_override

    if args.dry_run:
        try:
            result = DNAModule.split(
                Path(args.source),
                splits,
                dry_run=True,
                keep_source=bool(args.keep_source),
            )
        except (ValueError, LookupError, FileNotFoundError, FileExistsError, RuntimeError) as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1
        print("[dry-run] Would create:")
        for s in splits:
            print(f"  - {s['path']}/.dna/module.md  (name={s['name']}, "
                  f"sections={s['headings']})")
        refs = result.dependency_refs_report
        if refs:
            print(
                f"\nWARNING: {len(refs)} module(s) have `dependencies:` entries "
                f"pointing at the source. These are NOT rewritten automatically "
                f"(out of scope for `dna split`):"
            )
            for r in refs:
                print(f"  - {r['module']}: {r['action_required']}")
        return 0

    from services import split_module as _split_module
    try:
        result = _split_module(
            args.source,
            splits,
            strategy="comment" if args.keep_source else "move",
        )
    except (ValueError, LookupError, FileNotFoundError, FileExistsError, RuntimeError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    print("Created:")
    for p in result["created"]:
        print(f"  - {p}")
    refs = result.get("dependency_refs") or []
    if refs:
        print(
            f"\nWARNING: {len(refs)} module(s) have `dependencies:` entries "
            f"pointing at the source. These are NOT rewritten automatically "
            f"(out of scope for `dna split`):"
        )
        for r in refs:
            print(f"  - {r['module']}: {r['action_required']}")
    return 0


__all__ = ["register", "dispatch"]
