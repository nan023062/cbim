"""checks/dna_frontmatter.py — DNA module.md frontmatter v1→v2 residue.

Findings:
  DNA_FM_OBSOLETE_FIELD   warn   module.md still carries a v1-only frontmatter
                                 field (``dependencies`` / ``includeDirs``);
                                 v2 deleted both — the loader silently drops
                                 the value but the on-disk YAML key remains
                                 until ``tools/migrate_2_x.py --apply`` strips
                                 it. The offending field name is recorded in
                                 ``metadata["field"]`` so a single check code
                                 covers both keys.

This check exists as a safety net for the v2 migration. The loader's
strict-required-field gate (PR-2 Subtask A) only reacts to *missing*
schema fields; *extra* keys are silently ignored at load time so legacy
files keep loading. Without this audit there'd be no way to see how much
v1 residue is still on disk after Step 5 of the migration. Once
``cbim audit`` reports zero of these, the architect can run
``tools/migrate_2_x.py --apply`` to clear them at source.

Walks every ``.dna/module.md`` under ``project_root``; uses
``parse_frontmatter`` from the same primitive layer the loader uses, so
detection rules can never drift from what the loader actually sees.
"""

from __future__ import annotations

from pathlib import Path

from cbi._primitives.modules.loader import _is_skipped, _walk_dna_dirs
from services._fm import parse_frontmatter

from ..result import AuditFinding

# v1-only frontmatter keys removed by the v2 schema. We don't import this
# from frontmatter_schema.py because it's intentionally an audit-private
# definition — the schema module describes what v2 *has*; this check
# describes what v2 *forbids*. Keeping the two side-by-side avoids a
# silent contract leak.
_OBSOLETE_FIELDS = ("dependencies", "includeDirs")


def check(project_root: Path, config: dict) -> list[AuditFinding]:
    findings: list[AuditFinding] = []

    # Use the loader's raw walker (not the load-and-validate path) — we
    # need to inspect the on-disk YAML directly, including for files that
    # don't yet pass the v2 schema gate. The walker honours the same
    # vendor / build skip set as ``cbim dna list`` so we never report
    # false positives on copied trees under node_modules / .venv / etc.
    md_dirs, _legacy_json_dirs = _walk_dna_dirs(project_root)
    for mod_dir in md_dirs:
        if _is_skipped(mod_dir, project_root):
            continue
        rel = mod_dir.relative_to(project_root).as_posix() or "."
        module_md = mod_dir / ".dna" / "module.md"
        try:
            raw = module_md.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        fm = parse_frontmatter(raw)
        for field in _OBSOLETE_FIELDS:
            if field not in fm:
                continue
            findings.append(AuditFinding(
                check="dna_frontmatter",
                severity="warn",
                target=rel,
                message=(
                    f"module {rel!r} frontmatter still carries the v1-only "
                    f"field {field!r}; loader silently drops the value but "
                    "the YAML key persists on disk until migration."
                ),
                suggestion=(
                    "Run `python tools/migrate_2_x.py --apply` to strip the "
                    "obsolete field; the body is preserved byte-for-byte."
                ),
                code="DNA_FM_OBSOLETE_FIELD",
                metadata={"field": field},
            ))

    return findings
