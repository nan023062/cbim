"""GraphIndex — DNA business knowledge-graph adjacency reader.

Phase 3 retrieval companion. Loads the JSON written by
``cbi._primitives.modules.graph_builder.build_graph`` and exposes the
two operations retrieval actually needs:

  * ``load(graph_root)`` — read graph.json (None when missing/malformed)
  * ``bfs(seeds, hops, edge_kinds)`` — k-hop neighbourhood expansion

Pure stdlib, no graph database. Sits next to BM25Index / VectorIndex so
the facade can hold a third per-source index handle (only populated for
source="dna"). All other operations live in the builder module — this
class is a read-only frontend.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path
from typing import Iterable


class GraphIndex:
    """Read-only adjacency view of graph.json."""

    DEFAULT_KINDS = ("depends_on", "contains")

    def __init__(self, graph: dict | None) -> None:
        # ``graph is None`` means "no graph available, every query is empty".
        self._graph = graph or {}
        self._nodes: dict[str, dict] = self._graph.get("nodes") or {}
        # Pre-split adjacency by edge kind so bfs can filter cheaply
        # without walking the full edges list every step. Key = (src, kind).
        self._adj: dict[tuple[str, str], list[str]] = {}
        self._adj_in: dict[tuple[str, str], list[str]] = {}
        for e in self._graph.get("edges") or []:
            src = e.get("src")
            dst = e.get("dst")
            kind = e.get("kind")
            if not (src and dst and kind):
                continue
            self._adj.setdefault((src, kind), []).append(dst)
            self._adj_in.setdefault((dst, kind), []).append(src)

    # --------------------------------------------------------------- factory

    @classmethod
    def load(cls, project_root: Path) -> "GraphIndex":
        """Load graph.json under ``project_root/.cbim/index/dna/graph.json``.

        Lazy import of graph_builder so retrieval can still load when the
        cbi package isn't on the path (extreme stripped test envs).
        """
        try:
            from cbi._primitives.modules.graph_builder import load_graph
        except Exception:  # noqa: BLE001 — graph index falls back to empty when builder isn't importable in stripped envs
            return cls(None)
        try:
            data = load_graph(Path(project_root))
        except Exception:  # noqa: BLE001 — graph load is opportunistic; corrupt file silently degrades to empty
            return cls(None)
        return cls(data)

    # --------------------------------------------------------------- accessors

    @property
    def is_empty(self) -> bool:
        return not self._nodes

    def has_node(self, doc_id: str) -> bool:
        return doc_id in self._nodes

    def node(self, doc_id: str) -> dict | None:
        return self._nodes.get(doc_id)

    # --------------------------------------------------------------- BFS

    def bfs(
        self,
        seeds: Iterable[str],
        hops: int,
        *,
        edge_kinds: Iterable[str] | None = None,
        bidirectional: bool = True,
    ) -> dict[str, tuple[int, str]]:
        """Return ``{neighbour_doc_id: (hop_distance, via_seed_doc_id)}``.

        Seeds themselves are NOT included in the output — the caller
        already has them as primary hits and merges seeds-first.

        ``bidirectional=True`` walks both adjacency_out and adjacency_in
        so a "depends_on" expansion picks up *both* the dependencies of
        the seed AND the modules that depend on it. This matches the
        recall intent: when the user mentions module X, we want X's
        dependencies AND X's dependents, plus its parent and direct
        children via "contains".

        BFS is iterative, hop-bounded, and capped at ~5000 visits to
        prevent runaway expansion on monstrous graphs.
        """
        if hops <= 0:
            return {}
        kinds = tuple(edge_kinds) if edge_kinds is not None else self.DEFAULT_KINDS

        seen: set[str] = set(seeds)
        out: dict[str, tuple[int, str]] = {}
        # Each queue entry: (node, current_hop, originating_seed)
        queue: deque[tuple[str, int, str]] = deque(
            (s, 0, s) for s in seen if s in self._nodes
        )
        max_visits = 5000
        visits = 0

        while queue and visits < max_visits:
            node, depth, origin = queue.popleft()
            if depth >= hops:
                continue
            next_depth = depth + 1
            neighbours: list[str] = []
            for kind in kinds:
                neighbours.extend(self._adj.get((node, kind), ()))
                if bidirectional:
                    neighbours.extend(self._adj_in.get((node, kind), ()))
            for nb in neighbours:
                visits += 1
                if visits >= max_visits:
                    break
                if nb in seen:
                    continue
                seen.add(nb)
                # Record the FIRST time we see this neighbour — closest
                # hop wins. Subsequent enqueues for the same node are
                # skipped via ``seen``.
                out[nb] = (next_depth, origin)
                if next_depth < hops:
                    queue.append((nb, next_depth, origin))
        return out


__all__ = ["GraphIndex"]
