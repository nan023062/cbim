"""Phase-5 promote-candidate consumer hookup.

Verifies the rule-C consumer side wires through:
  1. CandidatesArea.stage(...) populated upstream (or by MemPromoteScan
     when feature flag is on) ends up on bb.mem_promote_candidates after
     MemPromoteScan ticks.
  2. architect_governance.compose_prompt(bb) renders a section containing
     the staged candidate paths and the human-confirm-only language.

These tests do NOT toggle the promote.enabled feature flag; they
pre-stage candidates in the work area so the test is hermetic to the
config layer.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from engine.core.node import Status
from engine.dream.actions.mem_steps import MemPromoteScan
from engine.dream.core.blackboard import DreamBlackboard
from engine.dream.loops import architect_governance
from memory.compaction.candidates import CandidatesArea


@pytest.fixture
def bb() -> DreamBlackboard:
    b = DreamBlackboard()
    b.run_id = "test-run"
    return b


def test_mem_promote_scan_surfaces_pre_staged_candidates(bb, tmp_path: Path):
    area = CandidatesArea(tmp_path)
    area.stage({
        "path": "medium/2026-06-15-decision-x.md",
        "tier": "medium",
        "slug": "decision-x",
        "tags": ["rule"],
        "summary": "重复决策：promote 永远只产建议，绝不写 .dna",
    })
    area.stage({
        "path": "medium/2026-06-15-rule-y.md",
        "tier": "medium",
        "slug": "rule-y",
        "tags": ["rule", "flow"],
        "summary": "硬规则：incoming 文件失败时不归档。",
    })

    node = MemPromoteScan(store_dir=tmp_path)
    assert node.tick(bb) is Status.SUCCESS
    assert isinstance(bb.mem_promote_candidates, list)
    paths = {c.get("path") for c in bb.mem_promote_candidates}
    assert "medium/2026-06-15-decision-x.md" in paths
    assert "medium/2026-06-15-rule-y.md" in paths
    assert bb.mem_promote_result["pending_count"] == 2


def test_architect_prompt_renders_promote_candidates_section(bb, tmp_path: Path):
    area = CandidatesArea(tmp_path)
    area.stage({
        "path": "medium/2026-06-15-decision-x.md",
        "tier": "medium",
        "slug": "decision-x",
        "tags": ["rule"],
        "summary": "promote 永远人工确认门",
    })

    MemPromoteScan(store_dir=tmp_path).tick(bb)
    assert bb.mem_promote_candidates  # sanity

    prompt = architect_governance.compose_prompt(bb)
    assert "promote candidates" in prompt or "记忆提升候选" in prompt
    assert "medium/2026-06-15-decision-x.md" in prompt
    assert "人工确认门" in prompt
    # Confirm the human-confirm-only language is asserted in the prompt.
    assert "PROMOTE" in prompt
    assert "REJECT" in prompt
    # The advice must NOT direct the architect to auto-write .dna.
    assert "绝不进 `safe_actions_applied` 写 .dna" in prompt


def test_architect_prompt_truncates_candidates_beyond_limit(bb, tmp_path: Path):
    area = CandidatesArea(tmp_path)
    for i in range(35):
        area.stage({
            "path": f"medium/2026-06-15-c{i:02d}.md",
            "tier": "medium",
            "slug": f"c{i:02d}",
            "tags": ["rule"],
            "summary": f"candidate {i}",
        })

    MemPromoteScan(store_dir=tmp_path).tick(bb)
    assert len(bb.mem_promote_candidates) == 35

    prompt = architect_governance.compose_prompt(bb)
    # Only the first 30 are rendered as numbered list items.
    assert "还有 5 条候选未渲染" in prompt
