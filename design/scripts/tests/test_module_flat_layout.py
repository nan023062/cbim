"""Target-format checks; legacy support is always explicitly requested."""
import copy
import unittest
import test_maintain_registries as fixtures
registry = fixtures.registry

OVERVIEW = """## 定位
资源生命周期。
## 子模块和 source 节点
无
## 结构关系图与抽象设计决策
```mermaid
classDiagram
class Resource
```
理由：统一生命周期。
## 雷区与排障
重复释放时检查所有权。
## 观察模式-待抽象
尚待验证缓存策略。
"""


class FlatModuleTests(unittest.TestCase):
    def setUp(self):
        fixture = fixtures.RegistryTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.root, self.module = fixture.root, fixture.module
        self.save, self.create = fixture.save, fixture.create
        self.legacy = copy.deepcopy(fixture.module_data)
        self.data = {k: v for k, v in fixture.module_data.items() if k not in ('boundaries', 'dna', 'workflows')}
        self.data.update(id='.cbim/workspace/game', children=[], overview='module.md', workflows=[])
        (self.module.parent/'dna/module.md').unlink()
        (self.module.parent/'dna').rmdir()
        self.overview = self.create('.cbim/workspace/game/module.md', OVERVIEW)
        self.save(self.module, self.data)

    def read(self):
        return registry.read_definition(self.root, self.module, 'modules')

    def test_registry_rejects_ignored_source_without_writing(self):
        self.create('.cbim/.cbimignore', '*.meta\n')
        for location in ('asset.meta', 'Client/Asset.META', r'Client\tmp\..\Asset.meta'):
            self.save(self.module, dict(self.data, sources=[{'location': location, 'scope': 'test scope'}]))
            before = self.module.read_bytes()
            with self.subTest(location=location), self.assertRaisesRegex(registry.RegistryError, 'cbimignore'):
                self.read()
            self.assertEqual(before, self.module.read_bytes())
        self.save(self.module, dict(self.data, sources=[{'location': 'asset.metadata', 'scope': 'test scope'}]))
        self.read()

    def test_ignore_does_not_bypass_reference_or_empty_scan(self):
        self.create('.cbim/.cbimignore', 'module.md\n')
        self.overview.unlink()
        with self.assertRaisesRegex(registry.RegistryError, '引用不存在'):
            self.read()
        self.create('.cbim/workspace/game/module.md', OVERVIEW)
        self.create('.cbim/.cbimignore', '/.cbim/workspace/\n')
        with self.assertRaisesRegex(registry.RegistryError, '没有找到定义'):
            registry.maintain(self.root, True)

    def test_removed_metadata_fields_are_rejected(self):
        for key, value in [('version', '1'), ('validation', {}), ('provenance', []), ('dependencies', {})]:
            self.save(self.module, dict(self.data, **{key: value}))
            with self.subTest(field=key), self.assertRaises(registry.RegistryError):
                self.read()

    def test_module_markdown_without_json_is_rejected(self):
        self.module.unlink()
        with self.assertRaises(registry.RegistryError):
            registry.maintain(self.root, True)

    def test_flat_success_and_counts(self):
        self.assertEqual(self.read()['overview'], 'module.md')
        counts = registry.maintain(self.root, True)
        self.assertEqual(counts['legacy_modules'], 0)

    def test_ignore_does_not_hide_agents_or_explicit_module_read(self):
        self.create('.cbim/.cbimignore', '/.cbim/team/\n')
        counts = registry.maintain(self.root, True)
        self.assertGreater(counts['agents'], 0)
        self.create('.cbim/.cbimignore', '/.cbim/workspace/game/\n')
        self.assertEqual(self.read()['id'], self.data['id'])

    def test_ignored_child_remains_valid_explicit_knowledge(self):
        child = dict(self.data, id='.cbim/workspace/game/child')
        self.save(self.module.parent/'child/module.json', child)
        self.create('.cbim/workspace/game/child/module.md', OVERVIEW)
        self.save(self.module, dict(self.data, children=[child['id']]))
        self.create('.cbim/.cbimignore', '/.cbim/workspace/game/child/\n')
        self.read()
        registry.maintain(self.root, True)

    def test_required_and_removed_fields(self):
        for key in ('id', 'children', 'overview', 'workflows'):
            data = dict(self.data)
            del data[key]
            self.save(self.module, data)
            with self.subTest(key=key), self.assertRaises(registry.RegistryError): self.read()
        for key in ('boundaries', 'dna', 'workflow'):
            self.save(self.module, dict(self.data, **{key:self.legacy.get(key)}))
            with self.subTest(key=key), self.assertRaises(registry.RegistryError): self.read()

    def test_id_and_child_completeness(self):
        self.save(self.module, dict(self.data, id='.cbim/workspace/other'))
        with self.assertRaises(registry.RegistryError): self.read()
        child = dict(self.data, id='.cbim/workspace/game/child')
        self.save(self.module.parent/'child/module.json', child)
        self.create('.cbim/workspace/game/child/module.md', OVERVIEW)
        for children in ([], ['.cbim/workspace/other'], [child['id'], child['id']]):
            self.save(self.module, dict(self.data, children=children))
            with self.subTest(children=children), self.assertRaises(registry.RegistryError): self.read()
        self.save(self.module, dict(self.data, children=[child['id']]))
        self.read()
        registry.maintain(self.root, True)

    def test_five_sections_and_one_class_diagram(self):
        invalid = [OVERVIEW.replace('## 定位', '## 其他'), OVERVIEW+'## 定位\n重复',
                   OVERVIEW.replace('classDiagram', 'flowchart LR'),
                   OVERVIEW.replace('class Resource', ''),
                   OVERVIEW.replace('```mermaid', '```text'),
                   OVERVIEW+'\n```mermaid\nclassDiagram\nclass Other\n```',
                   OVERVIEW.replace('## 结构关系图与抽象设计决策', '## 雷区与排障'),
                   OVERVIEW+'\n```unclosed',
                   OVERVIEW.replace('资源生命周期。', ''),
                   OVERVIEW.replace('理由：统一生命周期。', ''),
                   OVERVIEW.replace('重复释放时检查所有权。', ''),
                   OVERVIEW.replace('尚待验证缓存策略。', ''),
                   OVERVIEW.replace('资源生命周期。', '```text\n资源生命周期。\n```')]
        for text in invalid:
            self.overview.write_text(text, encoding='utf-8')
            with self.subTest(text=text), self.assertRaises(registry.RegistryError): self.read()

    def test_index_fields_not_repeated(self):
        for suffix in ('\nid: other', '\nsources: src', '\nchildren: []', '\nsummary: 内容', '\n# .cbim/workspace/game'):
            self.overview.write_text(OVERVIEW+suffix, encoding='utf-8')
            with self.subTest(suffix=suffix), self.assertRaises(registry.RegistryError): self.read()

    def test_strict_sections_reject_extra_and_legacy_headings(self):
        invalid = [
            OVERVIEW + '\n# 额外章节\n内容。',
            OVERVIEW + '\n## 注意事项与待验证项\n重复分类。',
            OVERVIEW + '\n### 注意事项与待验证项\n重复分类。',
            OVERVIEW.replace('## 子模块和 source 节点\n无\n', ''),
            OVERVIEW.replace('## 结构关系图与抽象设计决策', '## 正式抽象与设计决策'),
            OVERVIEW.replace('## 观察模式-待抽象', '## 观察模式'),
            OVERVIEW.replace('## 子模块和 source 节点\n无', '## 子模块和 source 节点\n### 其他\n内容'),
        ]
        for text in invalid:
            self.overview.write_text(text, encoding='utf-8')
            with self.subTest(text=text), self.assertRaises(registry.RegistryError):
                self.read()

    def test_source_headings_and_code_examples_are_not_extra_sections(self):
        self.save(self.module, dict(self.data, sources=[{'location': 'src', 'scope': '资源代码。'}]))
        text = OVERVIEW.replace('## 子模块和 source 节点\n无',
                                '## 子模块和 source 节点\n### Source 路径与维护说明\n#### `src`\n资源代码。')
        text += '\n```text\n## 示例章节\n### 示例小节\n```\n'
        self.overview.write_text(text, encoding='utf-8')
        self.read()

    def test_knowledge_links_and_extended_root(self):
        self.overview.write_text(OVERVIEW+'\n[子模块](.cbim/workspace/game/child/module.md)\n', encoding='utf-8')
        self.read()
        extra = self.root/'custom/modules/feature/module.json'
        self.save(extra, dict(self.data, id='custom/modules/feature'))
        self.create('custom/modules/feature/module.md', OVERVIEW)
        registry.read_definition(self.root, extra, 'modules')

    def test_workflow_inventory_and_support_files(self):
        self.read()
        items = [{'name': '导出', 'reference': 'workflows/export_code/workflow.md'},
                 {'name': '检查', 'reference': 'workflows/check_code/workflow.md'}]
        self.save(self.module, dict(self.data, workflows=items))
        with self.assertRaises(registry.RegistryError): self.read()
        for item in items:
            self.create('.cbim/workspace/game/' + item['reference'], '# 流程')
        self.create('.cbim/workspace/game/workflows/export_code/scripts/run.py', '# helper')
        self.read()
        registry.maintain(self.root, True)
        for bad in ([], items[:1], items + [items[0]],
                    [items[0], dict(items[1], name=items[0]['name'])]):
            self.save(self.module, dict(self.data, workflows=bad))
            with self.assertRaises(registry.RegistryError): self.read()
        self.save(self.module, dict(self.data, workflows=items))
        self.create('.cbim/workspace/game/workflows/export_code/workflow.md', '   ')
        with self.assertRaises(registry.RegistryError): self.read()

    def test_workflow_layout_and_reference_rejection(self):
        for reference in ('workflow.md', '../workflow.md', 'workflows/Bad/workflow.md',
                          'workflows/a/b/workflow.md', 'workflows/a/other.md',
                          'workflows/a/workflow.md#step'):
            self.save(self.module, dict(self.data, workflows=[{'name': '流程', 'reference': reference}]))
            with self.subTest(reference=reference), self.assertRaises(registry.RegistryError): self.read()
        self.save(self.module, self.data)
        old = self.create('.cbim/workspace/game/workflow.md', '# 旧流程')
        with self.assertRaises(registry.RegistryError): self.read()
        old.unlink()
        flat = self.create('.cbim/workspace/game/workflows/flat.md', '# 旧流程')
        with self.assertRaises(registry.RegistryError): self.read()
        flat.unlink()
        folder = self.module.parent/'workflows/empty'
        folder.mkdir()
        with self.assertRaises(registry.RegistryError): self.read()

    def test_reject_old_folders(self):
        for name in ('dna',):
            folder = self.module.parent/name
            folder.mkdir()
            with self.subTest(name=name), self.assertRaises(registry.RegistryError): self.read()
            folder.rmdir()

    def test_legacy_explicit_opt_in_and_full_validation(self):
        self.save(self.module, self.legacy)
        self.create('.cbim/workspace/game/dna/module.md', '# 历史知识')
        with self.assertRaisesRegex(registry.RegistryError, '--allow-legacy'): self.read()
        registry.read_definition(self.root, self.module, 'modules', allow_legacy=True)
        counts = registry.maintain(self.root, True, allow_legacy=True)
        self.assertEqual(counts['legacy_modules'], 1)
        self.create('.cbim/workspace/game/dna/unlisted.md', '# 漏登记')
        with self.assertRaises(registry.RegistryError):
            registry.maintain(self.root, True, allow_legacy=True)

    def test_mixed_format_never_falls_back(self):
        self.save(self.module, dict(self.legacy, id=self.data['id']))
        with self.assertRaises(registry.RegistryError):
            registry.read_definition(self.root, self.module, 'modules', allow_legacy=True)


if __name__ == '__main__':
    unittest.main()
