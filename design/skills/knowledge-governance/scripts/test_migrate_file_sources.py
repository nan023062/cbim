import tempfile
import unittest
from pathlib import Path
from migrate_file_sources import prepare


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        (self.root/'Code').mkdir()
        for name in ['a.txt', 'b.sh']:
            (self.root/'Code'/name).write_text('unchanged', encoding='utf-8')
        self.catalog = {}
        for key, file in [('one', 'a.txt'), ('two', 'b.sh')]:
            p = self.root/key/'module.json'; p.parent.mkdir()
            d = {'sources': [{'location': 'Code/'+file, 'scope': 'original'}]}
            p.write_text('{}', encoding='utf-8')
            (p.parent/'module.md').write_text('## 子模块和 source 节点\n\n### Source 路径与维护说明\n\n#### Code/'+file+'\n\nOriginal.\n\n## 结构关系图与抽象设计决策\n\nKeep this design.\n', encoding='utf-8')
            self.catalog[key] = (d, p)
        self.plan = {'groups': [{'directory': 'Code', 'owner': 'one', 'scope': 'root files only',
                      'description': 'Direct files; subdirectories excluded.',
                      'files': [{'module': k, **d['sources'][0]} for k, (d, p) in self.catalog.items()]}]}

    def test_shared_parent_explicit_owner_and_no_source_mutation(self):
        outputs, moved = prepare(self.root, self.catalog, self.plan)
        import json
        self.assertEqual(json.loads(outputs[self.root/'one/module.json'])['sources'], [{'location': 'Code', 'scope': 'root files only'}])
        self.assertEqual(json.loads(outputs[self.root/'two/module.json'])['sources'], [])
        self.assertEqual(len(moved), 2)
        self.assertIn('Keep this design.', outputs[self.root/'one/module.md'])
        self.assertEqual((self.root/'Code/b.sh').read_text(), 'unchanged')
        self.assertIn('Code/a.txt', (self.root/'one/module.md').read_text())

    def test_incomplete_plan_rejected(self):
        self.plan['groups'][0]['files'].pop()
        with self.assertRaisesRegex(ValueError, '未精确覆盖'):
            prepare(self.root, self.catalog, self.plan)

    def test_changed_scope_rejected(self):
        self.plan['groups'][0]['files'][0]['scope'] = 'outdated'
        with self.assertRaisesRegex(ValueError, '原声明已变化'):
            prepare(self.root, self.catalog, self.plan)


if __name__ == '__main__':
    unittest.main()
