"""Retrieval configuration loader.

Reads .cbim/index/config.json per contract.md §EmbeddingProvider Configuration.
Missing config -> default to provider="null" (BM25 fallback). Zero-config
install must work.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from atomic_io import atomic_write_text

SCHEMA_VERSION = 1


# Default recency half-life per retrieval source, in days. Sources
# absent from this map get multiplier=1.0 (no recency decay) — e.g.
# ``dna`` and ``agents`` are versioned artefacts whose age does not
# imply staleness, so they deliberately opt out.
_DEFAULT_RECENCY_HALF_LIFE_DAYS: dict[str, float] = {
    "memory_medium": 60.0,
    "transcript": 30.0,
}


@dataclass(frozen=True)
class RetrievalConfig:
    provider: str = "null"
    openai_api_key_env: str = "OPENAI_API_KEY"
    openai_model: str = "text-embedding-3-small"
    local_model_path: str = ""
    hybrid_search: bool = False
    schema_version: int = SCHEMA_VERSION
    # Feature flag: when True (default) IndexStore.persist_atomic is used
    # for the three-file (meta/bm25/vectors) write to keep them
    # consistent across crashes. Set to False to fall back to the legacy
    # serial-write path if the atomic path causes regression.
    atomic_persist: bool = True
    # Per-source exponential recency decay. Keys are retrieval source
    # names (see store.VALID_SOURCES); values are half-life in days. A
    # source that is absent from the dict — or the whole dict set to
    # None — disables the recency multiplier for that source and
    # preserves the raw score. Defaults live in
    # ``_DEFAULT_RECENCY_HALF_LIFE_DAYS`` (memory_medium=60d,
    # transcript=30d; dna / agents deliberately opt out).
    recency_half_life_days: dict[str, float] | None = field(
        default_factory=lambda: dict(_DEFAULT_RECENCY_HALF_LIFE_DAYS)
    )

    @classmethod
    def from_dict(cls, data: dict) -> RetrievalConfig:
        raw_recency = data.get("recency_half_life_days", "__missing__")
        if raw_recency == "__missing__":
            recency: dict[str, float] | None = dict(_DEFAULT_RECENCY_HALF_LIFE_DAYS)
        elif raw_recency is None:
            recency = None
        elif isinstance(raw_recency, dict):
            recency = {}
            for k, v in raw_recency.items():
                try:
                    recency[str(k)] = float(v)
                except (TypeError, ValueError):
                    # Ignore malformed entries rather than reject the
                    # whole config; a bad value just disables decay for
                    # that source.
                    continue
        else:
            recency = dict(_DEFAULT_RECENCY_HALF_LIFE_DAYS)
        return cls(
            provider=data.get("provider", "null"),
            openai_api_key_env=data.get("openai_api_key_env", "OPENAI_API_KEY"),
            openai_model=data.get("openai_model", "text-embedding-3-small"),
            local_model_path=data.get("local_model_path", ""),
            hybrid_search=bool(data.get("hybrid_search", False)),
            schema_version=int(data.get("schema_version", SCHEMA_VERSION)),
            atomic_persist=bool(data.get("atomic_persist", True)),
            recency_half_life_days=recency,
        )

    def to_dict(self) -> dict:
        return {
            "provider": self.provider,
            "openai_api_key_env": self.openai_api_key_env,
            "openai_model": self.openai_model,
            "local_model_path": self.local_model_path,
            "hybrid_search": self.hybrid_search,
            "schema_version": self.schema_version,
            "atomic_persist": self.atomic_persist,
            "recency_half_life_days": (
                dict(self.recency_half_life_days)
                if self.recency_half_life_days is not None
                else None
            ),
        }


def load_config(index_root: Path) -> RetrievalConfig:
    """Load .cbim/index/config.json. Missing file -> defaults."""
    path = index_root / "config.json"
    if not path.exists():
        return RetrievalConfig()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        # Corrupted config: fall back to defaults rather than crash.
        return RetrievalConfig()
    return RetrievalConfig.from_dict(raw)


def save_config(index_root: Path, config: RetrievalConfig) -> None:
    index_root.mkdir(parents=True, exist_ok=True)
    path = index_root / "config.json"
    atomic_write_text(
        path,
        json.dumps(config.to_dict(), indent=2, ensure_ascii=False),
        fsync=True,
    )
