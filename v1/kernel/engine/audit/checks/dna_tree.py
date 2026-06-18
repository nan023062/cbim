"""checks/dna_tree.py — DNA module tree integrity.

Two relations:
  - Parent/child (decided by path nesting; tree only).
  - Dependencies (parent module class diagram is the v2 authoritative
    source; v2 deleted the frontmatter ``dependencies`` field, so there
    is no fallback path).

Findings:
  TREE_ORPHAN                 warn   module has no enclosing parent (and isn't root)
  TREE_DEP_DANGLING           warn   declared dep path is unknown
  TREE_DEP_ANCESTOR_DECLARED  warn   dep targets an ancestor (implicit; must not be declared)
  TREE_DEP_UP_TREE            warn   dep points up the tree to a non-ancestor unstable side
  TREE_CYCLE                  error  dep graph has a strongly-connected component
  TREE_DIAGRAM_R1_PLACEHOLDER_EXPANDED  warn  placeholder annotation points at a path
                                              that belongs to the diagram-host's own
                                              subtree (should be a regular sub-node)
  TREE_DIAGRAM_R2_DEEP_SOURCE           warn  arrow source resolves to a descendant
                                              deeper than one level under the parent
  TREE_DIAGRAM_R3_UNGROUPED              info  parent class diagram with cross-tree
                                              placeholders is missing the four-section
                                              `%% --- N. ... ---` group markers
"""

from __future__ import annotations

import re
from pathlib import Path

from cbi._primitives.modules.graph_builder import _parse_placeholder_origins
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


# ---------------------------------------------------------------------------
# R3: four-section group marker detection
# ---------------------------------------------------------------------------

# A R3-compliant parent diagram with cross-tree placeholders carries comment
# lines that look like ``%% --- 1. ... ---`` for each of the four sections.
# We only require the leading marker pattern (digit 1..4) inside the diagram
# block; the prose content after the digit is human-facing decoration.
_R3_MARKER_RE = re.compile(
    r"^\s*%%\s*-{2,}\s*([1-4])\b",
    re.MULTILINE,
)


def _has_four_section_grouping(block: str) -> bool:
    """True when the diagram block names all four R3 group markers (1..4)."""
    seen = {m.group(1) for m in _R3_MARKER_RE.finditer(block)}
    return seen == {"1", "2", "3", "4"}


def _classdiagram_blocks(body: str) -> list[str]:
    """Yield the inner text of every ```mermaid classDiagram``` block."""
    if not body:
        return []
    out: list[str] = []
    for block in _MERMAID_BLOCK_RE.findall(body):
        first = next(
            (ln.strip() for ln in block.splitlines() if ln.strip()),
            "",
        )
        if first.startswith("classDiagram"):
            out.append(block)
    return out


# ---------------------------------------------------------------------------
# Per-module authoritative dep set (class diagram first, frontmatter fallback)
# ---------------------------------------------------------------------------


def _resolve_node_factory(by_path: dict[str, dict], name_to_path: dict[str, str]):
    """Build a closure that turns a class-diagram node id into a module path."""
    def _resolve(node: str) -> str | None:
        if not node:
            return None
        if node in name_to_path:
            return name_to_path[node]
        for p in by_path:
            base = p.rsplit("/", 1)[-1] if "/" in p else p
            if base == node:
                return p
        return None
    return _resolve


def _diagram_deps_for_module(
    module_path: str,
    parent_module: dict,
    parent_path: str,
    by_path: dict[str, dict],
    name_to_path: dict[str, str],
) -> set[str] | None:
    """Resolve the authoritative dep set for ``module_path`` from its parent's
    class diagram.

    Returns:
      - ``set[str]`` of module paths (possibly empty) when the parent body
        contains at least one classDiagram block. An empty set means "the
        diagram is authoritative and lists no edges from this module".
      - ``None`` when the parent has no classDiagram block at all → caller
        should fall back to frontmatter ``dependencies``.
    """
    body = parent_module.get("architecture") or ""
    if not body:
        return None
    blocks = _classdiagram_blocks(body)
    if not blocks:
        return None

    # Resolver enriched with placeholder origins so `submodule_cbim_v2` (a
    # placeholder id) maps onto the real `submodule/cbim/v2` path.
    placeholder_origins: dict[str, str] = {}
    for block in blocks:
        # Re-run the parser on each block for full fidelity; concatenating
        # blocks would let placeholders bleed across siblings.
        placeholder_origins.update(
            _parse_placeholder_origins("```mermaid\n" + block + "\n```\n")
        )
    local_name_to_path = dict(name_to_path)
    # Placeholder origins override; they're authoritative within the diagram.
    local_name_to_path.update(placeholder_origins)
    resolve = _resolve_node_factory(by_path, local_name_to_path)

    edges = _parse_class_diagram_deps(body)
    self_node = _node_name_for(by_path[module_path], module_path)

    # Per R2, deeper sources are rendered as their top-level-under-parent
    # ancestor. Honour that: an arrow whose source resolves to `module_path`
    # OR to `module_path`'s top-level ancestor under `parent_path` counts
    # towards this module's authoritative dep set.
    deep_alias = _top_level_under_parent(module_path, parent_path)
    candidates = {self_node}
    if deep_alias is not None:
        candidates.add(deep_alias)

    out: set[str] = set()
    for src_token, dst_tokens in edges.items():
        src_path = resolve(src_token)
        # Either the resolved path is the module itself, or the raw token
        # equals one of its diagram aliases (covers cases where the source
        # is unregistered but matches by name).
        is_match = (src_path == module_path) or (src_token in candidates)
        if not is_match:
            continue
        for dst in dst_tokens:
            dst_path = resolve(dst)
            if dst_path is None:
                # External / placeholder unresolved — drop. The TREE_DEP_*
                # checks operate on registered paths only.
                continue
            out.add(dst_path)
    return out


def _top_level_under_parent(path: str, parent: str) -> str | None:
    """Return the top-level component of ``path`` immediately beneath ``parent``.

    e.g. ``_top_level_under_parent("a/b/c", ".")`` → ``"a"``;
         ``_top_level_under_parent("a/b/c", "a")`` → ``"a/b"``;
         ``_top_level_under_parent("x", "y")`` → ``None`` (not a descendant).
    """
    if path == parent:
        return None
    if parent == ".":
        head = path.split("/", 1)[0]
        return head if head else None
    prefix = parent + "/"
    if not path.startswith(prefix):
        return None
    rest = path[len(prefix):]
    head = rest.split("/", 1)[0]
    return f"{parent}/{head}" if head else None


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

    name_to_path: dict[str, str] = {}
    for p, mm in by_path.items():
        nm = (mm.get("name") or "").strip()
        if nm and nm not in name_to_path:
            name_to_path[nm] = p

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

    # --- Build the authoritative dep graph from parent class diagrams.
    # v2 deleted the frontmatter `dependencies` field; there is no
    # fallback. A module without a parent (or whose parent has no
    # classDiagram block) contributes no edges — that's not drift,
    # just "nothing declared".
    dep_graph: dict[str, list[str]] = {}
    for path, m in by_path.items():
        parent_path = (
            "." if path == "." else
            (path.rsplit("/", 1)[0] if "/" in path else ".")
        )
        parent_module = by_path.get(parent_path) if path != "." else None

        diagram_deps: set[str] = set()
        if parent_module is not None:
            resolved = _diagram_deps_for_module(
                path, parent_module, parent_path, by_path, name_to_path,
            )
            if resolved is not None:
                diagram_deps = resolved
        deps = sorted(diagram_deps)
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
                        "Remove the stale dependency from the parent class "
                        "diagram or create the missing module."
                    ),
                    code="TREE_DEP_DANGLING",
                    metadata={"dep": dep, "origin": "diagram"},
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
                        f"Remove ancestor {dep!r} from the parent class diagram "
                        "edges; sub-module-to-parent imports are implicit and "
                        "should not be declared as cross-boundary deps."
                    ),
                    code="TREE_DEP_ANCESTOR_DECLARED",
                    metadata={"dep": dep, "origin": "diagram"},
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

    # --- R1 / R2 / R3 topology consistency on parent class diagrams --------
    # Triggered only on parent modules whose body contains at least one
    # classDiagram block; leaf modules and prose-only parents are skipped.
    # All three findings are warn / info (no error), per PR-1 lenient
    # semantics — the ratchet's fingerprint mechanism then auto-baselines
    # them on first audit run after PR-1 lands.
    findings.extend(
        _diagram_rule_findings(by_path, all_paths, name_to_path)
    )

    return findings


def _diagram_rule_findings(
    by_path: dict[str, dict],
    all_paths: set[str],
    name_to_path: dict[str, str],
) -> list[AuditFinding]:
    """Detect R1/R2/R3 violations across every parent module's class diagrams."""
    out: list[AuditFinding] = []
    for parent_path, parent_module in sorted(by_path.items()):
        body = parent_module.get("architecture") or ""
        if not body:
            continue
        blocks = _classdiagram_blocks(body)
        if not blocks:
            continue

        for block in blocks:
            block_text = "```mermaid\n" + block + "\n```\n"
            placeholder_origins = _parse_placeholder_origins(block_text)

            # ----- R1: placeholder origin lives inside this parent's subtree
            # (so it shouldn't be a placeholder — it's a regular sub-node).
            # Only fire when the origin path resolves to a registered
            # module — unregistered paths could be future mounts or external
            # references and aren't ours to flag.
            for pid, origin_path in placeholder_origins.items():
                norm_origin = _normalise(origin_path)
                if norm_origin not in all_paths:
                    continue
                if not _is_descendant(norm_origin, parent_path):
                    continue
                out.append(AuditFinding(
                    check="dna_tree",
                    severity="warn",
                    target=parent_path,
                    message=(
                        f"parent module {parent_path!r}'s class diagram lists "
                        f"placeholder {pid!r} pointing at {origin_path!r}, "
                        "which is a descendant of this parent — placeholders "
                        "are reserved for cross-tree references, not local "
                        "sub-modules"
                    ),
                    suggestion=(
                        "Replace the placeholder with a regular `class "
                        "<sub-module> { <<module>> }` node in this same diagram."
                    ),
                    code="TREE_DIAGRAM_R1_PLACEHOLDER_EXPANDED",
                    metadata={
                        "placeholder": pid,
                        "origin": origin_path,
                    },
                ))

            # ----- R2: arrow sources whose resolved path is more than one
            # level below `parent_path`. Common-ancestor diagrams may only
            # name their direct-child layer as the source side.
            edges = _parse_class_diagram_deps(block_text)
            local_name_to_path = dict(name_to_path)
            local_name_to_path.update(placeholder_origins)

            def _resolve_local(token: str) -> str | None:
                if not token:
                    return None
                if token in local_name_to_path:
                    return local_name_to_path[token]
                for p in by_path:
                    base = p.rsplit("/", 1)[-1] if "/" in p else p
                    if base == token:
                        return p
                return None

            for src_token in edges:
                src_path = _resolve_local(src_token)
                if src_path is None:
                    continue
                # Only flag when the source is a descendant of this parent.
                # External placeholders aren't R2 violations — they're cross-
                # tree references and obey their own rules.
                if not _is_descendant(src_path, parent_path):
                    continue
                depth = _depth_under_parent(src_path, parent_path)
                if depth is None or depth <= 1:
                    continue
                top_level = _top_level_under_parent(src_path, parent_path)
                out.append(AuditFinding(
                    check="dna_tree",
                    severity="warn",
                    target=parent_path,
                    message=(
                        f"parent module {parent_path!r}'s class diagram has an "
                        f"arrow originating at {src_token!r} (resolves to "
                        f"{src_path!r}), which is {depth} levels below the "
                        "parent — only direct-child level nodes may be "
                        "sources here"
                    ),
                    suggestion=(
                        f"Render the source as {top_level!r} (its top-level "
                        f"ancestor under {parent_path!r}); recurse into "
                        f"{top_level!r}'s own diagram for the inner detail."
                    ),
                    code="TREE_DIAGRAM_R2_DEEP_SOURCE",
                    metadata={
                        "source": src_token,
                        "resolved": src_path,
                        "depth": depth,
                    },
                ))

            # ----- R3: a diagram block carrying any cross-tree placeholder
            # must use the four-section group markers. No placeholder = no
            # need for the layout; some parents legitimately have only
            # local nodes and skip the markers.
            if placeholder_origins and not _has_four_section_grouping(block):
                out.append(AuditFinding(
                    check="dna_tree",
                    severity="info",
                    target=parent_path,
                    message=(
                        f"parent module {parent_path!r}'s class diagram has "
                        f"{len(placeholder_origins)} cross-tree placeholder(s) "
                        "but is missing the four-section `%% --- N. ... ---` "
                        "group markers"
                    ),
                    suggestion=(
                        "Annotate the diagram with the four group markers "
                        "(direct nodes / cross-tree placeholders / internal "
                        "edges / cross-tree edges) so reviewers can see the "
                        "subtree-vs-cross-tree split at a glance."
                    ),
                    code="TREE_DIAGRAM_R3_UNGROUPED",
                    metadata={
                        "placeholder_count": len(placeholder_origins),
                    },
                ))
    return out


def _is_descendant(path: str, ancestor: str) -> bool:
    """True when ``path`` is strictly below ``ancestor`` in the module tree."""
    if path == ancestor:
        return False
    if ancestor == ".":
        return path != "."
    return path.startswith(ancestor + "/")


def _depth_under_parent(path: str, parent: str) -> int | None:
    """Levels between ``parent`` and ``path``.

    e.g. parent=".",  path="a"     → 1
         parent=".",  path="a/b"   → 2
         parent="a",  path="a/b"   → 1
         parent="a",  path="a/b/c" → 2

    Returns None when path is not a descendant.
    """
    if not _is_descendant(path, parent):
        return None
    if parent == ".":
        return path.count("/") + 1
    rest = path[len(parent) + 1:]
    return rest.count("/") + 1
