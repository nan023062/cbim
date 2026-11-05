import json
import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_module_sources as checker


class ModuleSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def put(self, module, locations):
        p = self.root / '.cbim/workspace' / module / 'module.json'
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({'sources': [{'location': x, 'scope': 'test scope'} for x in locations]}), encoding='utf-8')
        return p

    def report(self):
        return checker.check(self.root)

    def test_review_export_keeps_scopes_indexes_and_definitions(self):
        a = self.put('outer', ['Client/Code'])
        b = self.put('inner', ['Client/Code/Sub'])
        before = {p: p.read_bytes() for p in (a, b)}
        report = self.report()
        exported = checker.write_review_report(self.root, report)
        text = Path(exported['markdown']).read_text(encoding='utf-8')
        self.assertIn('## 01. Client/Code/Sub', text)
        self.assertIn('sources[0]', text)
        self.assertIn('test scope', text)
        self.assertIn('.cbim/workspace/outer', text)
        self.assertIn('.cbim/workspace/inner', text)
        self.assertEqual(json.loads(Path(exported['json']).read_text(encoding='utf-8')), report)
        self.assertEqual(before, {p: p.read_bytes() for p in (a, b)})
        self.assertEqual(checker.exit_code(report), 2)

    def test_review_export_same_module_and_errors_are_not_hidden(self):
        self.put('a', ['Client/Code/Sub', 'Client/Code', 'Client/Code'])
        report = self.report()
        exported = checker.write_review_report(self.root, report)
        text = Path(exported['markdown']).read_text(encoding='utf-8')
        self.assertIn('同一模块', text)
        self.assertIn('duplicate_in_module', text)
        self.assertEqual(checker.exit_code(report), 1)

    def ignore(self, text):
        path = self.root/'.cbim/.cbimignore'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')

    def test_configured_meta_exclusion_and_normalization(self):
        self.ignore('*.meta\n')
        self.put('a', ['root.meta', 'Client/Code', 'Client/Code/x.META',
                       r'Client\Code\tmp\..\x.meta', 'Client/foo.metadata'])
        self.put('b', ['Client/Code/x.meta'])
        report = self.report()
        self.assertEqual(checker.exit_code(report), 0)
        self.assertEqual(report['sources'], 2)
        self.assertEqual(report['ignored_sources_count'], 4)
        self.assertTrue(all(item['pattern'] == '*.meta' for item in report['ignored_sources']))

    def test_no_configuration_does_not_ignore_meta(self):
        self.put('a', ['x.meta', 'x.meta'])
        self.assertEqual(self.report()['errors'][0]['code'], 'duplicate_in_module')
        self.assertFalse(self.report()['ignore_config']['configured'])

    def test_ignored_source_still_validated_and_read_only(self):
        self.ignore('*.meta\n')
        p = self.put('a', ['../outside.meta', '/absolute.meta', 'Client/*.meta', 'ok.meta'])
        data = json.loads(p.read_text(encoding='utf-8'))
        data['sources'][-1]['scope'] = ' '
        p.write_text(json.dumps(data), encoding='utf-8')
        before = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        report = self.report()
        self.assertEqual(len(report['errors']), 4)
        self.assertEqual(report['ignored_sources_count'], 0)
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_registration_ignore_cannot_hide_existing_source_conflicts(self):
        self.ignore('/.cbim/workspace/hidden/\n!/.cbim/workspace/hidden/child/module.json\n/.cbim/workspace/file/module.json\n')
        self.put('visible', ['Client/Visible'])
        self.put('hidden/child', ['Client/Visible'])
        self.put('file', ['Client/Visible'])
        report = self.report()
        self.assertEqual(report['modules'], 3)
        self.assertEqual(report['ignored_discovery'], [])
        self.assertEqual(len(report['errors']), 3)
        self.assertEqual(checker.exit_code(report), 1)

    def test_ignored_registration_root_still_audited(self):
        self.ignore('/.cbim/workspace/\n')
        self.put('a', ['Client/Code'])
        report = self.report()
        self.assertEqual(report['modules'], 1)
        self.assertEqual(checker.exit_code(report), 0)
        self.assertEqual(report['ignored_discovery'], [])

    def test_invalid_ignore_fails_closed(self):
        self.ignore('**/\n[invalid\n')
        # Git treats an unmatched [ as a literal. Invalid UTF-8 must still fail.
        (self.root/'.cbim/.cbimignore').write_bytes(b'\xff')
        self.put('a', ['Client/Code'])
        self.assertEqual(self.report()['errors'][0]['code'], 'scan_error')

    def test_unique_sources_and_empty_parent(self):
        self.put('a', [])
        self.put('a/b', ['Client/B'])
        self.put('c', ['Client/C'])
        self.assertEqual(checker.exit_code(self.report()), 0)

    def test_duplicates_with_path_aliases(self):
        self.put('a', ['Client/Code/', 'client\\Code/./'])
        self.assertEqual(self.report()['errors'][0]['code'], 'duplicate_in_module')

    def test_parent_and_deep_child(self):
        self.put('a', ['Client/Code'])
        self.put('a/b/c', ['Client/tmp/../Code'])
        self.assertEqual(self.report()['errors'][0]['code'], 'parent_child_duplicate')

    def test_unrelated_modules_duplicate(self):
        self.put('a', ['Client/Code'])
        self.put('ab', ['Client/Code'])
        self.assertEqual(self.report()['errors'][0]['code'], 'duplicate_across_modules')

    def test_scope_text_does_not_hide_duplicate(self):
        self.put('a', ['Client/Code'])
        p = self.put('b', ['Client/Code'])
        data = json.loads(p.read_text(encoding='utf-8'))
        data['sources'][0]['scope'] = 'Only unrelated files; claimed exclusion'
        p.write_text(json.dumps(data), encoding='utf-8')
        self.assertEqual(checker.exit_code(self.report()), 1)

    def test_json_cli_is_read_only_and_reports_exit_status(self):
        self.put('a', ['Client/Code'])
        self.put('a/b', ['Client/Code/Child'])
        before = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            status = checker.main(['--root', str(self.root), '--json'])
        self.assertEqual(status, 0)
        self.assertEqual(json.loads(stdout.getvalue())['modules'], 2)
        after = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_parent_and_ancestor_containment_is_normal(self):
        self.put('a', ['Client/Code'])
        self.put('a/b/c', ['Client/Code/Child'])
        report = self.report()
        self.assertEqual(report['errors'], [])
        self.assertEqual(report['overlaps'], [])
        self.assertEqual(report['containments'][0]['code'], 'parent_child_containment')
        self.assertEqual(checker.exit_code(report), 0)
        exported = checker.write_review_report(self.root, report)
        self.assertNotIn('## 01.', Path(exported['markdown']).read_text(encoding='utf-8'))

    def test_sibling_subtree_containment_remains_warning(self):
        self.put('a/left', ['Client/Code'])
        self.put('a/right/child', ['Client/Code/Child'])
        report = self.report()
        self.assertEqual(report['containments'], [])
        self.assertEqual(report['overlaps'][0]['severity'], 'warning')
        self.assertEqual(checker.exit_code(report), 2)

    def test_reversed_module_and_physical_hierarchy_is_not_normal(self):
        self.put('a', ['Client/Code/Child'])
        self.put('a/b', ['Client/Code'])
        report = self.report()
        self.assertEqual(report['containments'], [])
        self.assertEqual(checker.exit_code(report), 2)

    def test_same_module_containment_is_still_reviewed(self):
        self.put('a', ['Client/Code', 'Client/Code/Child'])
        report = self.report()
        self.assertEqual(report['containments'], [])
        self.assertEqual(checker.exit_code(report), 2)

    def test_component_boundary_not_string_prefix(self):
        self.put('a', ['Client/Code'])
        self.put('b', ['Client/CodeOther'])
        self.assertEqual(checker.exit_code(self.report()), 0)

    def test_invalid_paths_and_continue(self):
        self.put('a', ['../outside', 'C:\\outside', '/outside', 'https://example.com', 'Client/*', '', 'Client/Ok'])
        report = self.report()
        self.assertEqual(len(report['errors']), 6)
        self.assertEqual(report['sources'], 1)

    def test_bad_definition(self):
        p = self.put('a', [])
        p.write_text('{"sources": [], "sources": []}', encoding='utf-8')
        self.assertEqual(self.report()['errors'][0]['code'], 'invalid_definition')

    def test_excluded_history_and_local_files(self):
        self.put('a', ['Client/Code'])
        self.put('archive/old', ['Client/Code'])
        self.put('a/dna/old', ['Client/Code'])
        self.assertEqual(self.report()['modules'], 1)

    def test_missing_workspace_and_empty_scan(self):
        self.assertEqual(checker.exit_code(self.report()), 1)
        (self.root/'.cbim/workspace').mkdir(parents=True)
        self.assertEqual(self.report()['errors'][0]['code'], 'empty_scan')

    def test_symlink_alias_and_escape(self):
        target = self.root/'Client/Real'
        target.mkdir(parents=True)
        try:
            (self.root/'Client/Alias').symlink_to(target, target_is_directory=True)
            (self.root/'Client/Outside').symlink_to(self.root.parent, target_is_directory=True)
        except OSError:
            self.skipTest('当前环境没有创建符号链接权限')
        self.put('a', ['Client/Real'])
        self.put('b', ['Client/Alias', 'Client/Outside'])
        codes = {e['code'] for e in self.report()['errors']}
        self.assertEqual(codes, {'duplicate_across_modules', 'invalid_source'})


if __name__ == '__main__':
    unittest.main()
