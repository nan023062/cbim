"""Observable creation, no-clobber and recovery checks in isolated projects."""
import json
import unittest
from unittest.mock import patch
from create_method import create
import create_method
import test_module_flat_layout as fixtures


class CreateMethodTests(unittest.TestCase):
    def setUp(self):
        fixture = fixtures.FlatModuleTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.root = fixture.root
        self.owner = '.cbim/workspace/game'
        self.agent = '.cbim/team/programmers/dev'
        self.body = '---\nname: export-code\ndescription: Export code\n---\n# Export\nRun exporter and verify output.'

    def snapshot(self):
        return {p.relative_to(self.root).as_posix(): p.read_bytes()
                for p in self.root.rglob('*') if p.is_file()}

    def test_preview_then_workflow_creation_and_duplicate(self):
        before = self.snapshot()
        result = create(self.root, self.owner, 'export_code', 'Export', '# Export', 'workflow')
        self.assertEqual(result['mode'], 'preview')
        self.assertEqual(before, self.snapshot())
        create(self.root, self.owner, 'export_code', 'Export', '# Export', 'workflow', write=True)
        folder = self.root/self.owner
        data = json.loads((folder/'module.json').read_text(encoding='utf-8'))
        self.assertEqual(data['workflows'][0]['reference'], 'workflows/export_code/workflow.md')
        self.assertEqual((folder/data['workflows'][0]['reference']).read_text(), '# Export')
        after = self.snapshot()
        with self.assertRaises(ValueError):
            create(self.root, self.owner, 'export_code', 'Export', 'replacement', 'workflow', write=True)
        self.assertEqual(after, self.snapshot())

    def test_agent_skill_creation_and_validation(self):
        create(self.root, self.agent, 'export-code', 'Export', self.body, 'skill', 'Export code', True)
        folder = self.root/self.agent
        data = json.loads((folder/'agent.json').read_text(encoding='utf-8'))
        self.assertEqual(data['skills'][0]['purpose'], 'Export code')
        self.assertEqual((folder/data['skills'][0]['reference']).read_text(), self.body)

    def test_invalid_inputs_never_write(self):
        before = self.snapshot()
        for owner, slug, body in [('../escape', 'export_code', '# Export'),
                                  (self.owner, '../escape', '# Export'),
                                  (self.owner, 'export_code', ' '),
                                  (self.agent, 'export_code', '# Export')]:
            with self.subTest(owner=owner, slug=slug), self.assertRaises((ValueError, OSError)):
                create(self.root, owner, slug, 'Export', body, 'workflow', write=True)
        for body in ('# Missing header', self.body.replace('export-code', 'wrong'),
                     '---\nname: export-code\ndescription: Export\n---\n'):
            with self.assertRaises(ValueError):
                create(self.root, self.agent, 'export-code', 'Export', body, 'skill', 'Export', True)
        self.assertEqual(before, self.snapshot())

    def test_failed_post_validation_restores_owner_and_removes_new_entry(self):
        before = self.snapshot()
        real = create_method.read_definition
        count = 0
        def fail_after_write(*args):
            nonlocal count
            count += 1
            if count == 2:
                raise ValueError('injected validation failure')
            return real(*args)
        with patch.object(create_method, 'read_definition', side_effect=fail_after_write):
            with self.assertRaises(ValueError):
                create(self.root, self.owner, 'export_code', 'Export', '# Export', 'workflow', write=True)
        self.assertEqual(before, self.snapshot())
        self.assertFalse((self.root/self.owner/'workflows').exists())


if __name__ == '__main__':
    unittest.main()
