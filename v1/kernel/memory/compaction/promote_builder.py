"""
compaction/promote_builder.py — `scan_for_promote_candidates()`.

Batch 7 (rule C). The contract (compaction/.dna/module.md, Key Decision #2):
- This module identifies entries worth promoting to the knowledge system
  (e.g. .dna/ writeable patterns).
- Detection only — never notifies architect/HR; never emits events.
- Hits land in CandidatesArea via `area.stage(entry)`, then sit idle until
  a knowledge-loop caller does `scan(filter='promote_candidate')` through
  the parent facade.

Behaviour:
- Feature-flag `promote.enabled` (memory config) defaults to False. While
  off, the function is a strict no-op: returns 0, does NOT create the
  candidates directory, does NOT touch the facade. Default config = zero
  regression.
- When enabled, scans medium tier for each tag in `promote.scan_tags`
  (default ["rule", "flow"]) and stages every fresh hit. Idempotent: an
  entry whose stage filename already exists is skipped (no mtime refresh).
- No try/except wrapping: facade.scan and CandidatesArea.stage are both
  OS-tolerant on their own, so an extra catch here would be a BLE001
  swallow with no recovery story.
"""

from __future__ import annotations

from pathlib import Path

from memory import _facade
from memory._config import load_config
from memory.compaction.candidates import CandidatesArea


def scan_for_promote_candidates(store_dir: Path) -> int:
    """Scan medium tier for promotion candidates by tag and stage them.

    Returns the number of newly-staged candidates (0 when feature flag is
    off, or when nothing matched, or when every match was already staged).
    """
    cfg = load_config()
    promote_cfg = cfg.get("promote", {}) or {}
    if not promote_cfg.get("enabled", False):
        return 0

    scan_tags = promote_cfg.get("scan_tags")
    if not isinstance(scan_tags, list) or not scan_tags:
        scan_tags = ["rule", "flow"]

    area = CandidatesArea(store_dir)
    staged = 0
    for tag in scan_tags:
        hits = _facade.scan({"tier": "medium", "tag": tag}, store_dir=store_dir)
        for entry in hits:
            if _is_already_staged(area, entry):
                continue
            area.stage(entry)
            staged += 1
    return staged


def _is_already_staged(area: CandidatesArea, entry: dict) -> bool:
    """Match the on-disk filename CandidatesArea.stage() will produce.

    Mirrors the path-safe key derivation in candidates.stage() so we can
    cheaply test for prior staging without re-reading every JSON.
    """
    key = entry.get("path") or entry.get("id") or ""
    if not key:
        return False
    safe = key.replace("/", "_").replace("\\", "_")
    return (area.path / f"{safe}.candidate.json").exists()
