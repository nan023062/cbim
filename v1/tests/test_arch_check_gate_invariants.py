"""INV-CHECK-GATE-1 structural enforcement (T7).

The ArchCheckGate is contractually deterministic, synchronous, and
LLM-free. The contract lives in two places:

    1. `v1/kernel/engine/execution/actions/arch_check_gate/.dna/module.md`
       Key Decisions ("100% deterministic, zero LLM involvement").
    2. The leaf docstring in `gate.py` which enumerates four iron rules.

This test module is the physical enforcement layer. It scans every `.py`
file under the `arch_check_gate/` package with `ast` and asserts:

  * No LLM SDK import (anthropic, openai, anthropic_bedrock, ...).
  * No `DispatchRequest` identifier reference.
  * No `yield` / `yield from` expression.
  * No `Status.RUNNING` attribute access.
  * `ArchCheckGate.__init__` signature ⊆ {self, name} (no LLM seam).

Plus two dynamic assertions:

  * `ArchCheckGate` instances expose no `on_resume` attribute (the leaf
    never yields, so a resume callback would be dead code that invites
    future "just plug an LLM in" temptations).
  * `ConvergeJudge` reads `bb.arch_check_report` byte-for-byte unchanged
    (single-writer invariant — the report dict must be deep-equal before
    and after `ConvergeJudge.tick`).

Anti-noop guard: every AST predicate is also exercised on a synthetic
file that DELIBERATELY violates the rule, and we assert the predicate
fires. If the scan helpers ever regress into vacuous-true, this guard
turns red.
"""
from __future__ import annotations

import ast
import copy
import inspect
import textwrap
from pathlib import Path

import pytest

# Resolve the gate package on disk (file-level scan target).
_GATE_DIR = (
    Path(__file__).resolve().parent.parent
    / "kernel"
    / "engine"
    / "execution"
    / "actions"
    / "arch_check_gate"
)


# ---------------------------------------------------------------------------
# Reusable AST predicates — applied to BOTH the real gate package
# (positive scan: must pass) AND synthetic violating snippets
# (negative scan: must fail). Sharing one implementation is what makes
# the anti-noop guard meaningful.
# ---------------------------------------------------------------------------

_LLM_SDK_MODULES = {
    "anthropic",
    "openai",
    "anthropic_bedrock",
    "anthropic_vertex",
    "litellm",
    "langchain",
    "langchain_anthropic",
    "langchain_openai",
}


def _iter_py_files(pkg_dir: Path):
    """Every .py under the gate package (recursive, sorted for determinism)."""
    return sorted(p for p in pkg_dir.rglob("*.py"))


def _parse(path: Path) -> ast.AST:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def find_llm_imports(tree: ast.AST) -> list[str]:
    """Return offending import strings (empty list = clean)."""
    hits: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = (alias.name or "").split(".")[0]
                if root in _LLM_SDK_MODULES:
                    hits.append(f"import {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            mod = (node.module or "").split(".")[0]
            if mod in _LLM_SDK_MODULES:
                names = ", ".join(a.name for a in node.names)
                hits.append(f"from {node.module} import {names}")
    return hits


def find_dispatch_request_refs(tree: ast.AST) -> list[str]:
    """Any mention of `DispatchRequest` as Name, Attribute, or import alias."""
    hits: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id == "DispatchRequest":
            hits.append("Name:DispatchRequest")
        elif isinstance(node, ast.Attribute) and node.attr == "DispatchRequest":
            hits.append("Attribute:.DispatchRequest")
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name == "DispatchRequest" or alias.asname == "DispatchRequest":
                    hits.append(f"ImportFrom:{node.module}.DispatchRequest")
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if (alias.asname or alias.name) == "DispatchRequest":
                    hits.append(f"Import:{alias.name}")
    return hits


def find_yield_expressions(tree: ast.AST) -> list[str]:
    """Any `yield` or `yield from` — banned because gate never RUNNINGs."""
    hits: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Yield):
            hits.append(f"Yield@line{node.lineno}")
        elif isinstance(node, ast.YieldFrom):
            hits.append(f"YieldFrom@line{node.lineno}")
    return hits


def find_status_running_refs(tree: ast.AST) -> list[str]:
    """`Status.RUNNING` attribute access — the gate's tick only ever
    returns SUCCESS, so RUNNING references would either be dead code or
    a regression toward async yielding."""
    hits: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and node.attr == "RUNNING":
            value = node.value
            # Match `Status.RUNNING` specifically (not `Foo.RUNNING` in
            # unrelated namespaces — but in this small package any
            # RUNNING reference is suspicious anyway).
            if isinstance(value, ast.Name) and value.id == "Status":
                hits.append(f"Status.RUNNING@line{node.lineno}")
    return hits


# ---------------------------------------------------------------------------
# Positive scan: every .py under arch_check_gate/ must pass all four rules
# ---------------------------------------------------------------------------

def test_gate_package_dir_exists():
    assert _GATE_DIR.is_dir(), f"gate package not found at {_GATE_DIR}"
    pys = list(_iter_py_files(_GATE_DIR))
    assert pys, f"no .py files under {_GATE_DIR}"


@pytest.mark.parametrize("py_file", _iter_py_files(_GATE_DIR), ids=lambda p: p.name)
def test_gate_file_no_llm_sdk_import(py_file: Path):
    tree = _parse(py_file)
    offenders = find_llm_imports(tree)
    assert offenders == [], (
        f"{py_file.name}: LLM SDK import forbidden by INV-CHECK-GATE-1: {offenders}"
    )


@pytest.mark.parametrize("py_file", _iter_py_files(_GATE_DIR), ids=lambda p: p.name)
def test_gate_file_no_dispatch_request(py_file: Path):
    tree = _parse(py_file)
    offenders = find_dispatch_request_refs(tree)
    assert offenders == [], (
        f"{py_file.name}: DispatchRequest reference forbidden by INV-CHECK-GATE-1: {offenders}"
    )


@pytest.mark.parametrize("py_file", _iter_py_files(_GATE_DIR), ids=lambda p: p.name)
def test_gate_file_no_yield(py_file: Path):
    tree = _parse(py_file)
    offenders = find_yield_expressions(tree)
    assert offenders == [], (
        f"{py_file.name}: yield expression forbidden by INV-CHECK-GATE-1 "
        f"(gate must be synchronous): {offenders}"
    )


@pytest.mark.parametrize("py_file", _iter_py_files(_GATE_DIR), ids=lambda p: p.name)
def test_gate_file_no_status_running(py_file: Path):
    tree = _parse(py_file)
    offenders = find_status_running_refs(tree)
    assert offenders == [], (
        f"{py_file.name}: Status.RUNNING reference forbidden by INV-CHECK-GATE-1 "
        f"(gate.tick only ever returns SUCCESS): {offenders}"
    )


# ---------------------------------------------------------------------------
# Signature check — ArchCheckGate.__init__ must expose no LLM seam
# ---------------------------------------------------------------------------

def test_arch_check_gate_init_signature():
    """`__init__` parameter set must be a subset of {self, name}.

    Forbidding `llm_client`, `dispatcher`, `callback`, etc. as constructor
    parameters is what physically prevents a future contributor from
    plumbing an LLM into the gate."""
    from engine.execution.actions.arch_check_gate.gate import ArchCheckGate

    sig = inspect.signature(ArchCheckGate.__init__)
    actual = set(sig.parameters.keys())
    allowed = {"self", "name"}
    extra = actual - allowed
    assert extra == set(), (
        f"ArchCheckGate.__init__ has forbidden parameter(s) {extra}; "
        f"only {allowed} are allowed by INV-CHECK-GATE-1."
    )


# ---------------------------------------------------------------------------
# Dynamic invariants
# ---------------------------------------------------------------------------

def test_arch_check_gate_does_not_override_on_resume():
    """The gate never yields, so it must not override the base no-op resume.

    Note: `Node` (the ABC) ships a no-op `on_resume` default, so a raw
    `hasattr` check is uselessly always True. The meaningful invariant
    is that `ArchCheckGate` does NOT add its own override — having one
    would imply (a) the leaf intends to RUNNING-yield, contradicting
    INV-CHECK-GATE-1, or (b) the override is dead code that future
    contributors will be tempted to wire to an LLM dispatcher.
    """
    from engine.core.node import Node
    from engine.execution.actions.arch_check_gate.gate import ArchCheckGate

    gate = ArchCheckGate()
    # Required: the attribute exists (inherited from Node), but is the
    # inherited base method, not a subclass override.
    assert hasattr(gate, "on_resume"), "Node ABC contract changed unexpectedly"
    assert "on_resume" not in ArchCheckGate.__dict__, (
        "ArchCheckGate overrides on_resume; the gate is synchronous (never "
        "returns RUNNING) so a custom resume callback is dead code and a "
        "future invitation to plug LLM yields back in."
    )
    # Belt-and-braces: the bound method must resolve to Node's, not a subclass'.
    assert ArchCheckGate.on_resume is Node.on_resume, (
        "ArchCheckGate.on_resume does not resolve to Node.on_resume — "
        "a subclass override has been introduced somewhere on the MRO."
    )


def test_converge_judge_does_not_mutate_arch_check_report():
    """Single-writer invariant: ConvergeJudge reads `bb.arch_check_report`,
    never mutates it. Asserted via deep-equal AND object-identity (the
    dict itself must remain the same Python object — no `dict(...)`
    rebind, no key reordering, no field deletion)."""
    from engine.core.blackboard import Blackboard
    from engine.execution.actions.converge_judge import ConvergeJudge

    bb = Blackboard()
    bb.arch_plan = [{"task_id": "t1", "params": {"touched_modules": ["x"]}}]
    bb.work_results = {
        "t1": {"status": "ok", "agent": "noop", "summary": "done"},
    }
    bb.work_loop_iter = 1

    # Craft a passing verdict so ConvergeJudge takes the read path
    # (not the gate-fail mutation-shaped escape). The dict structure
    # mirrors Verdict.to_dict() so the read helpers find what they expect.
    bb.arch_check_report = {
        "touched_modules": ["x"],
        "verdict": {
            "pass": True,
            "error_count": 0,
            "warn_count": 0,
            "info_count": 0,
            "new_error_count": 0,
            "new_warn_count": 0,
            "findings": [],
            "unresolved": [],
            "summary": "pass (0 in-scope findings; new error/warn = 0)",
            "ratchet_mode": "lenient",
        },
        "scoped_findings": [],
        "baseline_meta": {"mode": "lenient", "by_origin": {}},
        "ran_at": "2026-06-03T00:00:00+00:00",
        "checks_ran": ["dna_tree", "dna_fission"],
    }

    snapshot = copy.deepcopy(bb.arch_check_report)
    original_id = id(bb.arch_check_report)

    judge = ConvergeJudge()
    judge.tick(bb)

    after = bb.arch_check_report
    assert id(after) == original_id, (
        "ConvergeJudge replaced bb.arch_check_report with a different object; "
        "single-writer invariant violated."
    )
    assert after == snapshot, (
        "ConvergeJudge mutated bb.arch_check_report contents; "
        "single-writer invariant violated.\n"
        f"before: {snapshot!r}\nafter:  {after!r}"
    )


def test_converge_judge_does_not_mutate_arch_check_report_on_fail_path(tmp_path):
    """Even when the verdict fails (mutation-shaped code path runs), the
    report dict itself must remain byte-identical. ConvergeJudge is
    documented to shallow-copy findings before stashing them precisely
    so the architect's redo prompt can't alias-mutate the report."""
    from engine.core.blackboard import Blackboard
    from engine.execution.actions.converge_judge import ConvergeJudge

    bb = Blackboard()
    bb.arch_plan = [{"task_id": "t1", "params": {"touched_modules": ["x"]}}]
    bb.work_results = {
        "t1": {"status": "ok", "agent": "noop", "summary": "done"},
    }
    bb.work_loop_iter = 1
    bb.arch_check_report = {
        "touched_modules": ["x"],
        "verdict": {
            "pass": False,
            "error_count": 1,
            "warn_count": 0,
            "info_count": 0,
            "new_error_count": 1,
            "new_warn_count": 0,
            "findings": [],
            "unresolved": [
                {
                    "check": "dna_tree",
                    "severity": "error",
                    "target": "x",
                    "message": "bad dep",
                    "code": "TREE_X",
                    "suggestion": "fix it",
                    "origin": "new",
                },
            ],
            "summary": "fail (1 new-origin error)",
            "ratchet_mode": "lenient",
        },
        "scoped_findings": [],
        "baseline_meta": {"mode": "lenient", "by_origin": {"new": 1, "baseline": 0}},
        "ran_at": "2026-06-03T00:00:00+00:00",
        "checks_ran": ["dna_tree", "dna_fission"],
    }

    snapshot = copy.deepcopy(bb.arch_check_report)
    original_id = id(bb.arch_check_report)

    judge = ConvergeJudge()
    judge.tick(bb)

    after = bb.arch_check_report
    assert id(after) == original_id
    assert after == snapshot, (
        "ConvergeJudge mutated bb.arch_check_report on fail path; "
        "single-writer invariant violated.\n"
        f"diff before/after:\n{snapshot!r}\n{after!r}"
    )
    # And: the architect redo context should have been seeded — confirms
    # the gate-fail branch actually ran (so the no-mutation assertion is
    # not vacuously true).
    assert getattr(bb, "arch_redo_context", None) is not None


# ---------------------------------------------------------------------------
# Anti-noop guard — synthetic violating snippets must trip every predicate
# ---------------------------------------------------------------------------

def _parse_src(src: str, filename: str = "<synthetic>") -> ast.AST:
    return ast.parse(textwrap.dedent(src), filename=filename)


def test_anti_noop_detects_llm_sdk_import():
    """If the AST scan can't catch a literal `from anthropic import Client`,
    every passing positive test above is a lie."""
    tree = _parse_src(
        """
        from anthropic import Client

        def f():
            return Client()
        """
    )
    offenders = find_llm_imports(tree)
    assert offenders, "find_llm_imports failed to detect `from anthropic import Client`"
    assert any("anthropic" in s for s in offenders)


def test_anti_noop_detects_llm_sdk_plain_import():
    tree = _parse_src(
        """
        import openai

        client = openai.Client()
        """
    )
    offenders = find_llm_imports(tree)
    assert offenders, "find_llm_imports failed to detect `import openai`"


def test_anti_noop_detects_dispatch_request():
    tree = _parse_src(
        """
        from engine.core.dispatch import DispatchRequest

        def f():
            return DispatchRequest(agent_type="work", prompt="x")
        """
    )
    offenders = find_dispatch_request_refs(tree)
    assert offenders, "find_dispatch_request_refs failed to detect DispatchRequest"


def test_anti_noop_detects_yield():
    tree = _parse_src(
        """
        def gen():
            yield 1
        """
    )
    offenders = find_yield_expressions(tree)
    assert offenders, "find_yield_expressions failed to detect `yield 1`"


def test_anti_noop_detects_yield_from():
    tree = _parse_src(
        """
        def gen():
            yield from [1, 2, 3]
        """
    )
    offenders = find_yield_expressions(tree)
    assert offenders, "find_yield_expressions failed to detect `yield from`"


def test_anti_noop_detects_status_running():
    tree = _parse_src(
        """
        from engine.core.node import Status

        def tick(bb):
            return Status.RUNNING
        """
    )
    offenders = find_status_running_refs(tree)
    assert offenders, "find_status_running_refs failed to detect Status.RUNNING"


def test_anti_noop_clean_snippet_has_no_offenders():
    """Sanity counter-direction: a benign snippet must NOT trip any predicate.
    Guards against the false-positive failure mode where the helpers
    flag everything (which would also make the package scan vacuously
    'pass' until something legitimate triggered the bug)."""
    tree = _parse_src(
        """
        from pathlib import Path

        def tick(bb):
            return 0
        """
    )
    assert find_llm_imports(tree) == []
    assert find_dispatch_request_refs(tree) == []
    assert find_yield_expressions(tree) == []
    assert find_status_running_refs(tree) == []
