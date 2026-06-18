"""checks/dna_fission.py — DNA module body & workflow oversize detection.

Findings:
  DNA_BODY_OVERSIZE             info/warn/error  module.md body exceeds size band
  DNA_WORKFLOW_OVERLOAD         info/warn/error  module has too many workflows
  DNA_PARENT_DIAGRAM_OVERLOAD   warn/error       parent module class diagram has
                                                 too many cross-tree placeholders
"""

from __future__ import annotations

from pathlib import Path

from cbi._primitives.modules.graph_builder import _parse_placeholder_origins
from services import list_modules as _service_list_modules

from ..config import resolve_bands, resolve_explicit_bands
from ..result import AuditFinding


def _is_parent(path: str, all_paths: set[str]) -> bool:
    """Mirror of graph_builder._is_leaf, inverted.

    Considered a parent when at least one other registered module path lives
    beneath it. Root path ``.`` always reads as parent. Duplicated here (and
    not imported) to avoid a runtime dep on graph_builder's leaf logic for
    a check that only needs the boolean.
    """
    if path == ".":
        return True
    prefix = path + "/"
    return any(p != path and p.startswith(prefix) for p in all_paths)


def check(project_root: Path, config: dict) -> list[AuditFinding]:
    findings: list[AuditFinding] = []
    cfg = config.get("dna_fission", {})
    max_body = cfg.get("max_body_lines", 350)
    max_wf = cfg.get("max_workflow_count", 8)
    max_placeholders = cfg.get("max_cross_tree_placeholders", 10)

    modules = list(_service_list_modules(cwd=str(project_root)))
    all_paths = {(m.get("path") or m.get("id") or "?") for m in modules}

    for m in modules:
        path = m.get("path") or m.get("id") or "?"
        body_lines = (m.get("architecture") or "").count("\n") + 1 \
            if (m.get("architecture") or "") else 0
        sev = resolve_bands(body_lines, max_body)
        if sev:
            findings.append(AuditFinding(
                check="dna_fission",
                severity=sev,
                target=path,
                message=(
                    f"module {path!r} body has {body_lines} lines "
                    f"(threshold {max_body})"
                ),
                suggestion=(
                    "Consider splitting via `cbim dna split` once the module covers "
                    "more than one cohesive concept."
                ),
                code="DNA_BODY_OVERSIZE",
                metadata={"lines": body_lines, "threshold": max_body},
            ))

        wf_count = len(m.get("workflows") or [])
        sev = resolve_bands(wf_count, max_wf)
        if sev:
            findings.append(AuditFinding(
                check="dna_fission",
                severity=sev,
                target=path,
                message=(
                    f"module {path!r} owns {wf_count} workflows "
                    f"(threshold {max_wf})"
                ),
                suggestion=(
                    "Workflow sprawl usually signals the module has acquired a "
                    "second responsibility; consider `cbim dna split`."
                ),
                code="DNA_WORKFLOW_OVERLOAD",
                metadata={"count": wf_count, "threshold": max_wf},
            ))

        # Cross-tree placeholder overload — parent modules only. Leaves can't
        # carry common-ancestor diagrams in the first place. Counts the
        # `class <id> : .from(<path>)` annotations parsed out of every
        # classDiagram block in the body, dedup'd by placeholder id (so a
        # placeholder declared once is one count, even if its arrow shows
        # in multiple places). Reuses graph_builder's parser so the
        # detection rule never drifts from edge resolution.
        if not _is_parent(path, all_paths):
            continue
        body = m.get("architecture") or ""
        if not body:
            continue
        placeholders = _parse_placeholder_origins(body)
        ph_count = len(placeholders)
        if ph_count == 0:
            continue
        sev = resolve_explicit_bands(ph_count, warn_max=max_placeholders)
        if sev:
            findings.append(AuditFinding(
                check="dna_fission",
                severity=sev,
                target=path,
                message=(
                    f"parent module {path!r} class diagram references "
                    f"{ph_count} cross-tree placeholders "
                    f"(warn ≥{(max_placeholders // 2) + 1}, "
                    f"error ≥{int(max_placeholders) + 1})"
                ),
                suggestion=(
                    "Evaluate extracting an intermediate aggregator module or "
                    "lowering some cross-tree edges to a narrower common ancestor."
                ),
                code="DNA_PARENT_DIAGRAM_OVERLOAD",
                metadata={
                    "placeholder_count": ph_count,
                    "threshold": max_placeholders,
                },
            ))
    return findings
