"""graph_builder.py — DNA business knowledge graph (full + incremental).

Phase 3 of the v1 retrieval redesign. Builds a tiny adjacency-list graph
over .dna/ modules so retrieval can do seeded k-hop expansion ("recall the
neighbours of the BM25-/vector-ranked seed") without introducing a graph
database. Output is a single JSON file at
``<index_root>/dna/graph.json`` with the schema described below.

Edge semantics — only TWO kinds, locked by architect decision D1:

  * ``depends_on``  — directed edge A→B means A.module.md frontmatter
                      ``dependencies`` lists B's module path, OR A's
                      module.md body contains a Mermaid classDiagram
                      ``A ..> B`` arrow (parent modules only). Both
                      endpoints must already be members of the module set
                      (i.e. in ``read_index`` or scanned by
                      ``_scan_modules``).
  * ``contains``    — directed edge P→C means C's module path is a
                      direct child path of P (parent prefix +
                      no intermediate ``/``). Pure structural.

NOT modelled (yet):
  * extends / implements / references — we don't parse class headers.
  * keyword co-occurrence — kept out of D1 to avoid noisy edges.

Schema of graph.json (locked):

    {
      "schema_version": 1,
      "built_at": "<ISO8601 UTC>",
      "build_mode": "full" | "patch",
      "nodes": {
        "<module_path>": {
          "kind": "leaf" | "parent",
          "status": "<frontmatter status, default 'implemented'>",
          "name": "<module name from frontmatter>"
        },
        ...
      },
      "edges": [
        {"src": "<path>", "dst": "<path>", "kind": "depends_on" | "contains"},
        ...
      ],
      "adjacency_out": {"<path>": ["<dst>", ...], ...},
      "adjacency_in":  {"<path>": ["<src>", ...], ...}
    }

Two entry points:

  * ``build_graph(root)`` — full rebuild. Authoritative; overwrites
    graph.json atomically. Used by the dream loop's
    ``DnaGraphRebuild`` leaf and the session_start tripwire.
  * ``patch_graph(root, module_dir)`` — single-module incremental.
    Used by ``services/_reindex.reindex_dna``. Recomputes only that
    module's node + outgoing edges; does NOT re-cascade onto neighbours
    (D9: dependents will overwrite their own edges next time they're
    written, eventually-consistent).

Both functions hold the existing ``<index_root>/dna/.lock`` while
writing graph.json so concurrent retrieval / reindex callers see either
the old graph or the new graph, never a half-written one.

Imports from retrieval are deliberately deferred / minimal: this module
lives under ``cbi._primitives.modules`` (the architect's choice — see
arch decision D6) so the retrieval layer can depend on it, not vice
versa. We pull in ``IndexStore`` only for its ``_cross_process_lock`` /
``index_root`` resolution; nothing else.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from atomic_io import atomic_write_text  # kernel root leaf — see context.py

from .loader import _scan_modules
from .registry import read_index


# ---------------------------------------------------------------------------
# Mermaid classDiagram parsing
# ---------------------------------------------------------------------------
#
# We reuse the architect_governance/check.py block-extraction pattern
# (a 4-line state machine over the markdown body) but only inspect blocks
# whose first non-empty line declares ``classDiagram``. Inside those we
# match dependency arrows of the form
#
#   A ..> B
#   `A` ..> `B`
#   A ..> B : "comment"
#
# Both sides may be plain identifiers OR backtick-quoted. We tolerate but
# ignore trailing colons / labels. Any side that doesn't resolve to a
# known module name is dropped silently (no exception, no warning) per D7
# — the parent .md is the source of truth for its own diagram, not for
# arbitrary external classes.

_DEP_ARROW_RE = re.compile(
    r"`?([A-Za-z_][A-Za-z0-9_-]*)`?\s*\.\.>\s*`?([A-Za-z_][A-Za-z0-9_-]*)`?",
)


def _extract_mermaid_blocks(body: str) -> list[str]:
    """Return the inner text of every ```mermaid ... ``` fenced block.

    Mirrors the extraction in arch_governance/check.py
    (_detect_phantom_subnodes) so the two stay schema-consistent. Stays
    in this module instead of importing from arch_governance to avoid a
    cyclic dep through skills/.
    """
    blocks: list[str] = []
    in_block = False
    cur: list[str] = []
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("```mermaid"):
            in_block = True
            cur = []
            continue
        if in_block and stripped.startswith("```"):
            in_block = False
            blocks.append("\n".join(cur))
            cur = []
            continue
        if in_block:
            cur.append(line)
    return blocks


def _parse_class_diagram_deps(
    body: str,
    name_to_path: dict[str, str],
) -> list[tuple[str, str]]:
    """Return (src_path, dst_path) pairs from classDiagram ``..>`` arrows.

    ``name_to_path`` maps frontmatter module name → module path. An
    arrow whose either side doesn't match a known name is dropped; we
    don't attempt fuzzy matching (D7: only parent modules carry class
    diagrams, and parent diagrams reference siblings/children by their
    declared module name).
    """
    pairs: list[tuple[str, str]] = []
    for block in _extract_mermaid_blocks(body):
        # Only walk classDiagram blocks. Plain ``graph TD`` / ``flowchart``
        # blocks are out of scope per D1 — they describe runtime flow,
        # not module dependencies.
        first_nonempty = next(
            (ln.strip() for ln in block.splitlines() if ln.strip()),
            "",
        )
        if not first_nonempty.startswith("classDiagram"):
            continue
        for left, right in _DEP_ARROW_RE.findall(block):
            l_path = name_to_path.get(left)
            r_path = name_to_path.get(right)
            if l_path is None or r_path is None:
                continue
            if l_path == r_path:
                # Self-edge from a typo: drop.
                continue
            pairs.append((l_path, r_path))
    return pairs


# ---------------------------------------------------------------------------
# Node kind (leaf vs parent) — shared with arch_governance/check._is_leaf
# ---------------------------------------------------------------------------


def _is_leaf(path: str, all_paths: set[str]) -> bool:
    """A module is a leaf when no other module path begins with ``<path>/``.

    Same definition arch_governance/check.py uses; duplicated here to
    avoid the upward import (this module is in _primitives/, that one
    is in cbi/agents/architect/skills/).
    """
    prefix = (path + "/") if path != "." else ""
    return not any(p != path and p.startswith(prefix) for p in all_paths)


def _direct_parent(path: str, all_paths: set[str]) -> str | None:
    """Return the nearest ancestor path that itself is a registered module.

    Walks up the path components until either ``.`` (root module, if
    registered) or a component that resolves to a member of ``all_paths``
    is reached. Used to build the ``contains`` edge set: only emit an
    edge when the nearest registered ancestor is in fact a recorded
    module — prevents phantom contains edges through unregistered
    intermediate directories.
    """
    if path == ".":
        return None
    parts = path.split("/")
    # Drop the last component, then walk upward.
    for i in range(len(parts) - 1, 0, -1):
        candidate = "/".join(parts[:i])
        if candidate in all_paths:
            return candidate
    if "." in all_paths:
        return "."
    return None


# ---------------------------------------------------------------------------
# Build helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    """Return current UTC time in ISO8601 with seconds precision.

    Plain ``datetime.now(timezone.utc)``: this runs at retrieval-index
    build time, not in a deterministic-replay context, so injecting a
    clock is unnecessary.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _empty_graph(build_mode: str) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "built_at": _now_iso(),
        "build_mode": build_mode,
        "nodes": {},
        "edges": [],
        "adjacency_out": {},
        "adjacency_in": {},
    }


def _add_edge(
    graph: dict[str, Any],
    src: str,
    dst: str,
    kind: str,
    seen: set[tuple[str, str, str]],
) -> None:
    """Append an edge plus update the adjacency mirrors.

    Idempotent on (src, dst, kind) tuples — two callers pushing the
    same dependency don't duplicate.
    """
    key = (src, dst, kind)
    if key in seen:
        return
    seen.add(key)
    graph["edges"].append({"src": src, "dst": dst, "kind": kind})
    graph["adjacency_out"].setdefault(src, []).append(dst)
    graph["adjacency_in"].setdefault(dst, []).append(src)


def _module_node(m: dict, all_paths: set[str]) -> dict:
    return {
        "kind": "leaf" if _is_leaf(m["path"], all_paths) else "parent",
        "status": m.get("status", "implemented"),
        "name": m.get("name", m.get("path", "")),
    }


def _emit_edges_for_module(
    m: dict,
    all_paths: set[str],
    name_to_path: dict[str, str],
    graph: dict[str, Any],
    seen: set[tuple[str, str, str]],
    *,
    children_by_parent: dict[str, list[str]] | None = None,
    is_leaf_cache: dict[str, bool] | None = None,
) -> None:
    """Compute outgoing edges for a single module and append them.

    Side-effect on ``graph`` and ``seen``. Used by both full and patch
    paths so the edge-emission rule lives in one place.

    ``children_by_parent`` and ``is_leaf_cache`` are optional precomputed
    maps; the full-build path passes them in to avoid the O(N) per-module
    scans that would otherwise dominate. Patch path leaves them None and
    the slower per-call recomputation kicks in (acceptable: patch only
    runs for one module at a time).
    """
    src = m["path"]
    is_leaf = (is_leaf_cache.get(src) if is_leaf_cache is not None
               else _is_leaf(src, all_paths))

    # depends_on from frontmatter
    for dep in m.get("dependencies") or []:
        if not isinstance(dep, str):
            continue
        if dep == src:
            continue
        if dep in all_paths:
            _add_edge(graph, src, dep, "depends_on", seen)

    # depends_on from classDiagram body — parents only (D7)
    if not is_leaf:
        body = m.get("architecture") or ""
        if body:
            for left, right in _parse_class_diagram_deps(body, name_to_path):
                if left in all_paths and right in all_paths:
                    _add_edge(graph, left, right, "depends_on", seen)

    # contains: src's parent → src
    parent = _direct_parent(src, all_paths)
    if parent is not None:
        _add_edge(graph, parent, src, "contains", seen)

    # contains: src → registered children whose direct_parent is src.
    # Only relevant when src is a parent — leaves never have contained
    # children in the module set by definition of _is_leaf.
    if not is_leaf:
        if children_by_parent is not None:
            for child in children_by_parent.get(src, ()):
                _add_edge(graph, src, child, "contains", seen)
        else:
            for other in all_paths:
                if other == src:
                    continue
                if _direct_parent(other, all_paths) == src:
                    _add_edge(graph, src, other, "contains", seen)


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def _graph_path(root: Path) -> Path:
    """Return the canonical graph.json location.

    Co-located with the dna source's index dir so the existing
    cross-process .lock applies: ``<root>/.cbim/index/dna/graph.json``.
    """
    return root / ".cbim" / "index" / "dna" / "graph.json"


def _write_graph(root: Path, graph: dict[str, Any]) -> None:
    """Atomic write under the dna source's cross-process lock.

    Falls back to a plain atomic write if the IndexStore can't be
    constructed (e.g. retrieval module unavailable in extreme stripped
    test env): the lock is opportunistic correctness, not a pre-cond.
    """
    out = _graph_path(root)
    payload = json.dumps(graph, indent=2, ensure_ascii=False)

    try:
        from engine.retrieval.store import IndexStore
        store = IndexStore(root / ".cbim" / "index", "dna")
        with store._cross_process_lock():
            atomic_write_text(out, payload, fsync=True)
        return
    except Exception:  # noqa: BLE001 — lock acquisition is best-effort; persistence remains atomic via the .tmp/replace path below
        pass

    out.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_text(out, payload, fsync=True)


def load_graph(root: Path) -> dict | None:
    """Read graph.json. Returns None when missing or malformed.

    Public read entry; used by retrieval's GraphIndex.
    """
    p = _graph_path(root)
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    if data.get("schema_version") != 1:
        return None
    # Cheap shape guard — the rest is GraphIndex's problem.
    for key in ("nodes", "edges", "adjacency_out", "adjacency_in"):
        if key not in data:
            return None
    return data


# ---------------------------------------------------------------------------
# Public: full rebuild
# ---------------------------------------------------------------------------


def build_graph(root: Path) -> dict[str, Any]:
    """Walk every .dna/module.md under ``root`` and emit graph.json.

    Returns the in-memory graph dict (also written to disk). The dream
    loop's DnaGraphRebuild leaf calls this; tests can call it directly.
    """
    modules = _scan_modules(root)
    # Filter to the registered set when the registry exists, so the
    # graph stays in sync with what `cbim dna list` / retrieval shows.
    registered = set(read_index(root))
    if registered:
        modules = [m for m in modules if m["path"] in registered]

    all_paths = {m["path"] for m in modules}
    name_to_path = {m["name"]: m["path"] for m in modules if m.get("name")}

    # Precompute the leaf set + children-by-parent map once so the
    # per-module emit step stays O(deg(node)) rather than O(N).
    children_by_parent: dict[str, list[str]] = {}
    for p in all_paths:
        parent = _direct_parent(p, all_paths)
        if parent is not None:
            children_by_parent.setdefault(parent, []).append(p)
    is_leaf_cache = {
        p: not children_by_parent.get(p)
        for p in all_paths
    }

    graph = _empty_graph("full")
    seen: set[tuple[str, str, str]] = set()

    for m in modules:
        path = m["path"]
        graph["nodes"][path] = {
            "kind": "leaf" if is_leaf_cache[path] else "parent",
            "status": m.get("status", "implemented"),
            "name": m.get("name", path),
        }

    for m in modules:
        _emit_edges_for_module(
            m, all_paths, name_to_path, graph, seen,
            children_by_parent=children_by_parent,
            is_leaf_cache=is_leaf_cache,
        )

    # Sort adjacency lists for deterministic output across rebuilds.
    for d in (graph["adjacency_out"], graph["adjacency_in"]):
        for k, v in d.items():
            d[k] = sorted(set(v))
    graph["edges"].sort(key=lambda e: (e["src"], e["kind"], e["dst"]))

    _write_graph(root, graph)
    return graph


# ---------------------------------------------------------------------------
# Public: incremental patch (single module)
# ---------------------------------------------------------------------------


def patch_graph(root: Path, module_dir: Path) -> dict[str, Any] | None:
    """Refresh a single module's node + outgoing edges in graph.json.

    Strategy (D5/D9):
      1. If graph.json doesn't exist yet, fall back to a full build.
      2. Otherwise: re-scan only the requested module via load_module.
      3. Drop the module's existing outgoing edges from edges /
         adjacency_out / adjacency_in.
      4. Re-emit its node + outgoing edges using the current ``all_paths``
         / ``name_to_path`` derived from graph.nodes (so we don't re-walk
         the whole filesystem).
      5. Persist atomically under the same lock.

    Incoming edges (other modules' edges pointing AT this one) are NOT
    re-cascaded: those will refresh next time the corresponding source
    module is itself written, eventually-consistent per D9. The dream
    loop's full DnaGraphRebuild rebuilds the authoritative state.

    Returns the updated graph dict, or None when the module can't be
    loaded (deletion / unreadable file) — caller's responsibility to
    call build_graph() if a full rebuild is wanted instead.
    """
    from .loader import load_module

    graph = load_graph(root)
    if graph is None:
        return build_graph(root)

    m = load_module(module_dir, root)
    if m is None:
        # Module gone — drop its node and outgoing edges. Incoming edges
        # are intentionally retained until their source modules patch,
        # consistent with D9 (no cascade).
        path = _doc_id_for(root, module_dir)
        if path is not None:
            _drop_module_from_graph(graph, path)
            graph["build_mode"] = "patch"
            graph["built_at"] = _now_iso()
            _write_graph(root, graph)
        return graph

    path = m["path"]
    all_paths = set(graph["nodes"].keys())
    all_paths.add(path)
    name_to_path = {
        n: graph["nodes"][n].get("name") or n
        for n in graph["nodes"]
    }
    # Replace name_to_path with name → path direction.
    name_to_path = {
        info.get("name") or p: p
        for p, info in graph["nodes"].items()
    }
    # Override / add this module's name binding (frontmatter may have
    # changed since the last build).
    if m.get("name"):
        name_to_path[m["name"]] = path

    # Step 1: drop existing entries for this module.
    _drop_module_from_graph(graph, path)

    # Step 2: re-emit.
    graph["nodes"][path] = _module_node(m, all_paths)
    seen: set[tuple[str, str, str]] = {
        (e["src"], e["dst"], e["kind"]) for e in graph["edges"]
    }
    _emit_edges_for_module(m, all_paths, name_to_path, graph, seen)

    # Re-sort the adjacency lists touched.
    for d in (graph["adjacency_out"], graph["adjacency_in"]):
        for k, v in d.items():
            d[k] = sorted(set(v))
    graph["edges"].sort(key=lambda e: (e["src"], e["kind"], e["dst"]))
    graph["build_mode"] = "patch"
    graph["built_at"] = _now_iso()

    _write_graph(root, graph)
    return graph


def _doc_id_for(root: Path, module_dir: Path) -> str | None:
    """Compute the module path key used in graph.nodes from a module dir."""
    try:
        rel = module_dir.resolve().relative_to(root.resolve())
    except ValueError:
        return None
    s = rel.as_posix()
    return s or "."


def _drop_module_from_graph(graph: dict[str, Any], path: str) -> None:
    """Remove a module's node + outgoing edges in place.

    Incoming edges (where ``path`` is the dst) are kept on purpose — see
    D9. The next time the source module is patched, it will recompute
    its own outgoing set and the stale entry naturally drops.
    """
    graph["nodes"].pop(path, None)
    new_edges: list[dict] = []
    for e in graph["edges"]:
        if e["src"] == path:
            # Outgoing edge of this module → drop.
            dst = e["dst"]
            adj_in = graph["adjacency_in"].get(dst)
            if adj_in:
                graph["adjacency_in"][dst] = [x for x in adj_in if x != path]
                if not graph["adjacency_in"][dst]:
                    graph["adjacency_in"].pop(dst, None)
            continue
        new_edges.append(e)
    graph["edges"] = new_edges
    graph["adjacency_out"].pop(path, None)


__all__ = [
    "build_graph",
    "patch_graph",
    "load_graph",
    "_graph_path",
]
