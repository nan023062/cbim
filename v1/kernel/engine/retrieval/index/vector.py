"""VectorIndex — cosine similarity over a VectorBlob.

Pure stdlib (math.fsum + sqrt). numpy is optional; if present we use it
for batch scoring but we never depend on it.
"""
from __future__ import annotations

import math
from typing import List, Optional, Tuple

from engine.retrieval.store import VectorBlob

# Header-band cosine fusion weights (PR-2 retrieval-Y design):
# combined_sim = HEADER_WEIGHT * cos(q, header) + BODY_WEIGHT * cos(q, body)
# When a doc has no header vector, fall back to body-only (full body
# weight) so the legacy / pre-PR-2 case still ranks meaningfully.
_HEADER_WEIGHT = 0.7
_BODY_WEIGHT = 0.3


class VectorIndex:
    def __init__(
        self,
        blob: VectorBlob,
        header_blob: VectorBlob | None = None,
    ) -> None:
        self.blob = blob
        # Optional companion blob holding per-doc header-band vectors.
        # When None, search() ranks on body-only similarity (PR-1
        # behaviour). When non-None, search() blends per-doc cosines.
        self.header_blob = header_blob

    def upsert(self, doc_id: str, vec: list) -> None:
        self.blob.upsert(doc_id, vec)

    def delete(self, doc_id: str) -> None:
        self.blob.delete(doc_id)

    def search(
        self,
        query_vec: list,
        top_k: int,
        allowed_ids: Optional[set] = None,
    ) -> List[Tuple[str, float]]:
        if not self.blob.doc_ids:
            return []
        q_norm = _l2_norm(query_vec)
        if q_norm == 0.0:
            return []

        # Pre-build a header lookup so we don't index-scan once per doc.
        header_lookup: dict[str, tuple[list[float], float]] = {}
        if self.header_blob is not None and self.header_blob.doc_ids:
            for h_id, h_vec in zip(
                self.header_blob.doc_ids, self.header_blob.vectors,
            ):
                h_norm = _l2_norm(h_vec)
                if h_norm == 0.0:
                    continue
                header_lookup[h_id] = (h_vec, h_norm)

        scored: List[Tuple[str, float]] = []
        for doc_id, vec in zip(self.blob.doc_ids, self.blob.vectors):
            if allowed_ids is not None and doc_id not in allowed_ids:
                continue
            d_norm = _l2_norm(vec)
            if d_norm == 0.0:
                continue
            body_sim = (
                math.fsum(a * b for a, b in zip(query_vec, vec))
                / (q_norm * d_norm)
            )
            header_entry = header_lookup.get(doc_id)
            if header_entry is None:
                # Header vector missing for this doc — full body weight.
                # This is the common case for sources other than dna and
                # the upgrade path for dna docs written before PR-2.
                sim = body_sim
            else:
                h_vec, h_norm = header_entry
                header_sim = (
                    math.fsum(a * b for a, b in zip(query_vec, h_vec))
                    / (q_norm * h_norm)
                )
                sim = _HEADER_WEIGHT * header_sim + _BODY_WEIGHT * body_sim
            scored.append((doc_id, sim))
        scored.sort(key=lambda kv: kv[1], reverse=True)
        return scored[:top_k]


def _l2_norm(vec) -> float:
    return math.sqrt(math.fsum(x * x for x in vec))


def rrf_fuse(
    ranked_lists: List[List[Tuple[str, float]]],
    top_k: int,
    k: int = 60,
) -> List[Tuple[str, float]]:
    """Reciprocal Rank Fusion. k=60 per the original Cormack et al. 2009 paper.

    Returns combined ranking [(doc_id, rrf_score)] desc.
    """
    agg: dict = {}
    for ranked in ranked_lists:
        for rank, (doc_id, _) in enumerate(ranked, start=1):
            agg[doc_id] = agg.get(doc_id, 0.0) + 1.0 / (k + rank)
    out = sorted(agg.items(), key=lambda kv: kv[1], reverse=True)
    return out[:top_k]
