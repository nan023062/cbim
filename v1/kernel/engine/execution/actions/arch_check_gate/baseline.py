"""actions/arch_check_gate/baseline.py — thin re-export of audit.BaselineStore.

INV-CHECK-GATE-1 / .dna Key Decisions: the gate must not duplicate any
baseline logic. ``engine.audit.BaselineStore`` is the single source of
truth for fingerprinting, classification, and ratchet folding. This
module exists only so importers within the gate package can write::

    from .baseline import BaselineStore

without reaching across the engine into the audit package directly,
keeping the gate's dependency surface visible at the package boundary.
"""

from __future__ import annotations

from engine.audit import BaselineStore

__all__ = ["BaselineStore"]
