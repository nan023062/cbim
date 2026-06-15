"""Retrieval configuration loader.

Reads .cbim/index/config.json per contract.md §EmbeddingProvider Configuration.
Missing config -> default to provider="null" (BM25 fallback). Zero-config
install must work.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from atomic_io import atomic_write_text

SCHEMA_VERSION = 1


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

    @classmethod
    def from_dict(cls, data: dict) -> RetrievalConfig:
        return cls(
            provider=data.get("provider", "null"),
            openai_api_key_env=data.get("openai_api_key_env", "OPENAI_API_KEY"),
            openai_model=data.get("openai_model", "text-embedding-3-small"),
            local_model_path=data.get("local_model_path", ""),
            hybrid_search=bool(data.get("hybrid_search", False)),
            schema_version=int(data.get("schema_version", SCHEMA_VERSION)),
            atomic_persist=bool(data.get("atomic_persist", True)),
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
