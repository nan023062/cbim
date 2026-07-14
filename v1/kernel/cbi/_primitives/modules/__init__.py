"""cbi._primitives.modules — package re-exports.

Internal package; sub-modules implement single-responsibility slices of the
former monolithic modules.py. External code MUST import via this package
(or, preferably, via cbi.resources). See _primitives/__init__.py for the
public layering rule.

Re-exports use the explicit ``import X as X`` form so ruff/F401 doesn't
flag the underscore-prefixed white-box names that consumers (audit checks,
governance skill, body resource, tests) import directly from this package.
"""

from ._telemetry import _log_import as _log_import
from ._telemetry import _rel_for_log as _rel_for_log
from .doc_writer import _BODY_EDITED_AT_KEY as _BODY_EDITED_AT_KEY
from .doc_writer import _WRITE_DOC_ALLOWED as _WRITE_DOC_ALLOWED
from .doc_writer import _now_body_edited_at as _now_body_edited_at
from .doc_writer import stamp_module_md_content as stamp_module_md_content
from .doc_writer import write_module_doc as write_module_doc
from .frontmatter_schema import _MODULE_FM_LIST_FIELDS as _MODULE_FM_LIST_FIELDS
from .frontmatter_schema import _MODULE_FM_REQUIRED as _MODULE_FM_REQUIRED
from .frontmatter_schema import _MODULE_FM_SCHEMA as _MODULE_FM_SCHEMA
from .frontmatter_schema import _MODULE_FM_STATUS_VALUES as _MODULE_FM_STATUS_VALUES
from .frontmatter_schema import _build_module_md as _build_module_md
from .note_crud import _NOTE_SLUG_RE as _NOTE_SLUG_RE
from .note_crud import _validate_note_slug as _validate_note_slug
from .note_crud import create_note as create_note
from .note_crud import delete_note as delete_note
from .note_crud import list_notes as list_notes
from .note_crud import note_exists as note_exists
from .note_crud import read_note as read_note
from .note_crud import update_note as update_note
from .notes_frontmatter_schema import _NOTE_FM_INTENT_VALUES as _NOTE_FM_INTENT_VALUES
from .notes_frontmatter_schema import _NOTE_FM_LIST_FIELDS as _NOTE_FM_LIST_FIELDS
from .notes_frontmatter_schema import _NOTE_FM_REQUIRED as _NOTE_FM_REQUIRED
from .notes_frontmatter_schema import _NOTE_FM_SCHEMA as _NOTE_FM_SCHEMA
from .notes_frontmatter_schema import _NOTE_FM_STATUS_VALUES as _NOTE_FM_STATUS_VALUES
from .notes_frontmatter_schema import _build_note_md as _build_note_md
from .notes_frontmatter_schema import _validate_note_frontmatter as _validate_note_frontmatter
from .loader import _SCAN_SKIP_DIRS as _SCAN_SKIP_DIRS
from .loader import _is_skipped as _is_skipped
from .loader import _load_legacy_format as _load_legacy_format
from .loader import _load_new_format as _load_new_format
from .loader import _scan_modules as _scan_modules
from .loader import load_module as load_module
from .registry import _append_to_index as _append_to_index
from .registry import _index_path as _index_path
from .registry import _write_index as _write_index
from .registry import ensure_registry as ensure_registry
from .registry import index_path as index_path
from .registry import list_modules as list_modules
from .registry import read_index as read_index
from .registry import update_index as update_index
from .scaffold import _LEAF_BODY as _LEAF_BODY
from .scaffold import _PARENT_BODY as _PARENT_BODY
from .scaffold import _VALID_TYPES as _VALID_TYPES
from .scaffold import init_module as init_module
from .scaffold import update_module_meta as update_module_meta
from .section_parser import _FENCE_RE as _FENCE_RE
from .section_parser import _HEADING_RE as _HEADING_RE
from .section_parser import _normalize_content_lines as _normalize_content_lines
from .section_parser import _Section as _Section
from .section_parser import _split_frontmatter_block as _split_frontmatter_block
from .section_parser import _split_sections as _split_sections
from .section_writer import _WRITE_SECTION_ALLOWED as _WRITE_SECTION_ALLOWED
from .section_writer import _WRITE_SECTION_MODES as _WRITE_SECTION_MODES
from .section_writer import write_module_section as write_module_section
from .splitter import _rm_rf as _rm_rf
from .splitter import _rollback_index_entries as _rollback_index_entries
from .splitter import _scan_dependency_refs as _scan_dependency_refs
from .splitter import split_module as split_module

__all__ = [
    # Public surface (the documentation-worthy names)
    "load_module",
    "list_modules",
    "init_module",
    "update_index",
    "update_module_meta",
    "write_module_doc",
    "write_module_section",
    "split_module",
    "index_path",
    "read_index",
    "ensure_registry",
    # Notes primitives (Task 0 — .dna/notes/ single-file supplement layer)
    "create_note",
    "update_note",
    "delete_note",
    "list_notes",
    "read_note",
    "note_exists",
    "_validate_note_slug",
    "_validate_note_frontmatter",
    "_build_note_md",
    "_NOTE_FM_SCHEMA",
    "_NOTE_FM_LIST_FIELDS",
    "_NOTE_FM_REQUIRED",
    "_NOTE_FM_STATUS_VALUES",
    "_NOTE_FM_INTENT_VALUES",
    "_NOTE_SLUG_RE",
    # White-box contract names consumed by audit, governance, body resource, tests
    "_MODULE_FM_LIST_FIELDS",
    "_MODULE_FM_REQUIRED",
    "_MODULE_FM_STATUS_VALUES",
    "_SCAN_SKIP_DIRS",
    "_scan_modules",
    "_HEADING_RE",
    "_FENCE_RE",
    "_split_sections",
    "_normalize_content_lines",
    "_build_module_md",
]
