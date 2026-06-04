"""actions/arch_check_gate/ — programmatic check gate (T3 / T5).

Single public leaf: ``ArchCheckGate``. Sits in WorkLoop between
DispatchWork and ConvergeJudge. Runs the read-only ``dna_tree`` +
``dna_fission`` audit checks scoped to the modules the architect declared
as touched, classifies findings against ``BaselineStore`` (lenient
ratchet), and writes the verdict to ``bb.arch_check_report``.

INV-CHECK-GATE-1 (.dna/module.md Key Decisions):
    100% deterministic, zero LLM involvement. The package-level invariant
    is statically auditable — no module under this directory may import
    any LLM SDK, reference DispatchRequest, use the ``yield`` keyword,
    or reference ``Status.RUNNING``. T7 AST tests enforce this.
"""

from .gate import ArchCheckGate

__all__ = ["ArchCheckGate"]
