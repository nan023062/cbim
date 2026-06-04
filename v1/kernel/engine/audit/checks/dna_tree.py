"""checks/dna_tree.py — DNA module tree integrity.

Two relations:
  - Parent/child (decided by path nesting; tree only).
  - Dependencies (frontmatter `dependencies`; must be single-directional DAG).

Findings:
  TREE_ORPHAN                warn   module has no enclosing parent (and isn't root)
  TREE_DEP_DANGLING          warn   declared dep path is unknown
  TREE_DEP_ANCESTOR_DECLARED warn   dep targets an ancestor (implicit; must not be declared)
  TREE_DEP_UP_TREE           warn   dep points up the tree to a non-ancestor unstable side
  TREE_CYCLE                 error  dep graph has a strongly-connected component
  TREE_DEP_DIAGRAM_MISMATCH  warn   frontmatter `dependencies` disagrees with parent
                                    module's classDiagram `..>` edges from this module
"""

from __future__ import annotations

import re
from pathlib import Path

from services import list_modules as _service_list_modules

from ..result import AuditFinding


def _normalise(p: str) -> str:
    s = (p or "").strip()
    if s.startswith("./"):
        s = s[2:]
    if s != "." and s.endswith("/"):
        s = s.rstrip("/")
    return s


def _ancestors(path: str) -> list[str]:
    """Return ancestor paths (root-first, excluding self). Root path is '.'."""
    if path in (".", ""):
        return []
    parts = path.split("/")
    out: list[str] = []
    for i in range(len(parts)):
        anc = "/".join(parts[:i])
        out.append(anc if anc else ".")
    return out


def _find_parent(path: str, all_paths: set[str]) -> str | None:
    """Closest registered ancestor (could be '.' for root)."""
    for anc in reversed(_ancestors(path)):
        if anc in all_paths:
            return anc
    return None


def _tarjan_sccs(graph: dict[str, list[str]]) -> list[list[str]]:
    index_counter = [0]
    stack: list[str] = []
    on_stack: set[str] = set()
    index: dict[str, int] = {}
    lowlink: dict[str, int] = {}
    sccs: list[list[str]] = []

    def strongconnect(v: str) -> None:
        index[v] = index_counter[0]
        lowlink[v] = index_counter[0]
        index_counter[0] += 1
        stack.append(v)
        on_stack.add(v)
        for w in graph.get(v, []):
            if w not in index:
                strongconnect(w)
                lowlink[v] = min(lowlink[v], lowlink[w])
            elif w in on_stack:
                lowlink[v] = min(lowlink[v], index[w])
        if lowlink[v] == index[v]:
            comp: list[str] = []
            while True:
                w = stack.pop()
                on_stack.discard(w)
                comp.append(w)
                if w == v:
                    break
            sccs.append(comp)

    for v in list(graph.keys()):
        if v not in index:
            strongconnect(v)
    return sccs


# ---------------------------------------------------------------------------
# Class-diagram dependency parsing (TREE_DEP_DIAGRAM_MISMATCH support).
# ---------------------------------------------------------------------------

# Match opening fence of a mermaid block. Captures everything after `mermaid`
# until the next ```` ``` ```` on its own line. We use a non-greedy multi-line
# capture so unclosed fences (no terminating ```) match nothing.
_MERMAID_BLOCK_RE = re.compile(
    r"^```mermaid[ \t]*\r?\n(.*?)^```",
    re.MULTILINE | re.DOTALL,
)

# Edge in a classDiagram: `<src> ..> <dst>` optionally followed by `: <label>`.
# We're permissive about whitespace and accept anything-but-newline on either
# side; cleanup (stereotype strip, quote strip) happens after the match.
_EDGE_RE = re.compile(
    r"^[ \t]*([^\n:]+?)[ \t]*\.\.>[ \t]*([^\n:]+?)[ \t]*(?::[^\n]*)?$",
    re.MULTILINE,
)

# Stereotype tag like `<<module>>` / `<<dataclass>>` — strip wherever it appears.
_STEREOTYPE_RE = re.compile(r"<<[^<>]*>>")


def _clean_node_name(raw: str) -> str:
    """Normalise a class-diagram node token.

    Strips stereotype markers, surrounding quotes, and whitespace.
    Returns empty string on pure-punctuation / empty input.
    """
    if not raw:
        return ""
    s = _STEREOTYPE_RE.sub("", raw).strip()
    # Drop trailing `{...}` body if the node was written inline like
    # `class core { <<module>> }`.
    brace = s.find("{")
    if brace != -1:
        s = s[:brace].strip()
    # Drop leading `class ` keyword if someone wrote `class "engine/audit"`.
    if s.startswith("class "):
        s = s[len("class "):].strip()
    # Strip matching surrounding quotes.
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ('"', "'"):
        s = s[1:-1].strip()
    if not s:
        return ""
    # Reject pure-punctuation tokens.
    if not any(ch.isalnum() or ch in "_/.-" for ch in s):
        return ""
    return s


def _parse_class_diagram_deps(parent_body: str) -> dict[str, set[str]]:
    """Extract `..>` edges from every ```mermaid classDiagram``` block in body.

    Returns {src_node_name: set(dst_node_names)}. Non-classDiagram mermaid
    blocks (flowchart / graph / ...) are ignored. Unclosed fences yield no
    edges (the regex won't match). Syntax errors inside a block degrade
    gracefully: unparseable lines just don't produce edges.

    Pure function; no I/O. Safe to unit-test in isolation.
    """
    out: dict[str, set[str]] = {}
    if not parent_body:
        return out
    for block in _MERMAID_BLOCK_RE.findall(parent_body):
        # First non-blank line decides the diagram kind.
        first = ""
        for line in block.splitlines():
            stripped = line.strip()
            if stripped:
                first = stripped
                break
        if not first.startswith("classDiagram"):
            continue
        for m in _EDGE_RE.finditer(block):
            src = _clean_node_name(m.group(1))
            dst = _clean_node_name(m.group(2))
            if not src or not dst:
                continue
            out.setdefault(src, set()).add(dst)
    return out


def _node_name_for(m: dict, path: str) -> str:
    """Preferred diagram node name for a module: frontmatter name, else basename."""
    nm = (m.get("name") or "").strip()
    if nm:
        return nm
    return path.rsplit("/", 1)[-1] if "/" in path else path


def check(project_root: Path, config: dict) -> list[AuditFinding]:
    findings: list[AuditFinding] = []

    modules = _service_list_modules(cwd=str(project_root))
    if not modules:
        return findings

    by_path: dict[str, dict] = {}
    for m in modules:
        norm = _normalise(m.get("path") or m.get("id") or "")
        by_path[norm] = m

    all_paths = set(by_path.keys())
    has_root = "." in all_paths

    for path, m in sorted(by_path.items()):
        if path == ".":
            continue
        parent = _find_parent(path, all_paths)
        if parent is None and not has_root:
            findings.append(AuditFinding(
                check="dna_tree",
                severity="warn",
                target=path,
                message=f"module {path!r} has no enclosing parent and no root module exists",
                suggestion=(
                    "Create the missing parent module via `cbim dna init <parent-dir> "
                    "--type parent ...` or move this module under an existing parent."
                ),
                code="TREE_ORPHAN",
            ))

    dep_graph: dict[str, list[str]] = {}
    for path, m in by_path.items():
        deps = [_normalise(d) for d in (m.get("dependencies") or []) if d]
        dep_graph[path] = deps
        ancestors = set(_ancestors(path))
        for dep in deps:
            if dep not in all_paths:
                findings.append(AuditFinding(
                    check="dna_tree",
                    severity="warn",
                    target=path,
                    message=f"module {path!r} declares dependency on unknown path {dep!r}",
                    suggestion=(
                        "Remove the stale dependency via `cbim dna edit "
                        "--target frontmatter --field dependencies` or create the "
                        "missing module."
                    ),
                    code="TREE_DEP_DANGLING",
                    metadata={"dep": dep},
                ))
                continue
            if dep in ancestors:
                findings.append(AuditFinding(
                    check="dna_tree",
                    severity="warn",
                    target=path,
                    message=(
                        f"module {path!r} declares ancestor {dep!r} as a dependency; "
                        "sub-module-to-parent imports are implicit and must not be declared"
                    ),
                    suggestion=(
                        f"Remove ancestor {dep!r} from `dependencies` frontmatter; "
                        "sub-module-to-parent imports are implicit and should not be "
                        "declared as cross-boundary deps."
                    ),
                    code="TREE_DEP_ANCESTOR_DECLARED",
                    metadata={"dep": dep},
                ))
                continue

    for comp in _tarjan_sccs(dep_graph):
        if len(comp) <= 1:
            v = comp[0] if comp else None
            if v is None or v not in dep_graph.get(v, []):
                continue
        findings.append(AuditFinding(
            check="dna_tree",
            severity="error",
            target=None,
            message=f"dependency cycle detected: {' -> '.join(sorted(comp))}",
            suggestion="Break the cycle by extracting the shared concern into a leaf module.",
            code="TREE_CYCLE",
            metadata={"cycle": sorted(comp)},
        ))

    # --- TREE_DEP_DIAGRAM_MISMATCH ----------------------------------------
    # Parent module's `classDiagram` `..>` edges are the SOURCE OF TRUTH for
    # dependency declarations; frontmatter `dependencies` is the derived
    # cache. Disagreement = drift. See .dna/module.md Key Decision
    # "TREE_DEP_DIAGRAM_MISMATCH 解析规则 (T4 实装契约)".
    name_to_path: dict[str, str] = {}
    for p, mm in by_path.items():
        nm = (mm.get("name") or "").strip()
        if nm and nm not in name_to_path:
            name_to_path[nm] = p

    def _resolve_node(node: str) -> str | None:
        if not node:
            return None
        if node in name_to_path:
            return name_to_path[node]
        for p in by_path:
            base = p.rsplit("/", 1)[-1] if "/" in p else p
            if base == node:
                return p
        return None

    for path, m in sorted(by_path.items()):
        if path == ".":
            continue
        parent_path = path.rsplit("/", 1)[0] if "/" in path else "."
        parent = by_path.get(parent_path)
        if parent is None:
            continue
        parent_body = parent.get("architecture") or ""
        if not parent_body:
            continue
        edges = _parse_class_diagram_deps(parent_body)
        if not edges:
            # Parent has no classDiagram block (or only empty / flowchart
            # blocks) — defer; this isn't drift, it's a not-yet-migrated
            # parent. T4 deliberately stays silent here.
            continue

        self_node = _node_name_for(m, path)
        diag_targets_raw = edges.get(self_node, set())
        d_diag: set[str] = set()
        for tgt_node in diag_targets_raw:
            resolved = _resolve_node(tgt_node)
            if resolved is None:
                # External / placeholder node; not in registry, not our
                # concern here (and not a TREE_DEP_DANGLING either — that
                # check operates on frontmatter, not class diagrams).
                continue
            d_diag.add(resolved)

        raw_decl = m.get("dependencies") or []
        if not isinstance(raw_decl, list):
            raw_decl = []
        d_decl: set[str] = {_normalise(d) for d in raw_decl if d}

        for missing_in_diag in sorted(d_decl - d_diag):
            findings.append(AuditFinding(
                check="dna_tree",
                severity="warn",
                target=path,
                message=(
                    f"module {path!r} frontmatter declares dependency on "
                    f"{missing_in_diag!r} but parent module {parent_path!r}'s "
                    "class diagram has no `..>` edge from this module to it"
                ),
                suggestion=(
                    f"Add `{self_node} ..> <{missing_in_diag} node>` to parent "
                    f"module {parent_path!r}'s classDiagram, then regenerate "
                    "this module's frontmatter dependencies."
                ),
                code="TREE_DEP_DIAGRAM_MISMATCH",
                metadata={"dep": missing_in_diag, "parent": parent_path},
            ))
        for missing_in_decl in sorted(d_diag - d_decl):
            findings.append(AuditFinding(
                check="dna_tree",
                severity="warn",
                target=path,
                message=(
                    f"parent module {parent_path!r}'s class diagram has a `..>` "
                    f"edge from this module to {missing_in_decl!r} but module "
                    f"{path!r}'s frontmatter `dependencies` does not include it"
                ),
                suggestion=(
                    f"Update parent module {parent_path!r}'s classDiagram or "
                    "regenerate this module's frontmatter dependencies so the "
                    "two agree."
                ),
                code="TREE_DEP_DIAGRAM_MISMATCH",
                metadata={"dep": missing_in_decl, "parent": parent_path},
            ))

    return findings
