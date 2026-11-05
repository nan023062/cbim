import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('layers', Path(__file__).parents[1] / 'check_core_dependencies.py')
layers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(layers)


class CoreDependencyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.core = Path(self.temp.name)
        for name in layers.LAYERS:
            (self.core/name).mkdir()

    def put(self, name, text='content'):
        path = self.core/name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')

    def errors(self):
        return layers.check(self.core)[0]

    def test_forward_chain_and_local_references(self):
        self.put('skills/a/SKILL.md', '[task](../../task/spec.md)\n[local](notes.md)')
        self.put('skills/a/notes.md')
        self.put('task/spec.md', '[agent](../capability/spec.md)\n[module](../business/spec.md)')
        self.put('capability/spec.md')
        self.put('business/spec.md')
        self.assertEqual(self.errors(), [])

    def test_memory_forward_dependency_and_missing_target(self):
        self.put('memory/spec.md', '[baseline](../task/spec.md)')
        self.put('task/spec.md')
        errors, count, edges = layers.check(self.core)
        self.assertEqual(errors, [])
        self.assertEqual(count, 2)
        self.assertIn(('memory', 'task'), edges)
        self.put('memory/spec.md', '[missing](missing.md)')
        self.assertTrue(any('missing target' in e for e in self.errors()))

    def test_memory_forbidden_directions(self):
        self.put('memory/spec.md')
        for layer in ('skills', 'task', 'business', 'capability', 'connector'):
            with self.subTest(source=layer):
                self.put(layer+'/spec.md', '[memory](../memory/spec.md)')
                self.assertTrue(any('forbidden' in e for e in self.errors()))
                self.put(layer+'/spec.md')
        for layer in ('skills', 'business', 'capability', 'connector'):
            with self.subTest(target=layer):
                self.put('memory/spec.md', '[bad](../'+layer+'/spec.md)')
                self.assertTrue(any('forbidden' in e for e in self.errors()))

    def test_connector_is_leaf(self):
        self.put('capability/spec.md', '[connector](../connector/spec.md)')
        self.put('business/spec.md', '[connector](../connector/spec.md)')
        self.put('connector/spec.md')
        self.assertEqual(self.errors(), [])
        self.put('connector/spec.md', '[bad](../capability/spec.md)')
        self.assertTrue(any('forbidden' in e for e in self.errors()))

    def test_task_cannot_reference_skills(self):
        self.put('task/spec.md', '[bad](../skills/a/SKILL.md)')
        self.put('skills/a/SKILL.md')
        self.assertTrue(any('forbidden' in e for e in self.errors()))

    def test_skill_cannot_skip_task(self):
        self.put('skills/a/SKILL.md', '[bad](../../capability/spec.md)')
        self.put('capability/spec.md')
        self.assertTrue(any('forbidden' in e for e in self.errors()))

    def test_peer_skills_and_lower_layer_cross_reference(self):
        self.put('skills/a/SKILL.md', '[bad](../b/SKILL.md)')
        self.put('skills/b/SKILL.md')
        self.put('business/spec.md', '[bad](../capability/spec.md)')
        self.put('capability/spec.md')
        self.assertEqual(sum('forbidden' in e for e in self.errors()), 2)

    def test_reference_style_html_and_explicit_paths(self):
        self.put('task/spec.md', '[bad]: ../skills/a/SKILL.md\n<a href="../skills/a/SKILL.md">bad</a>\n`.cbim/core.src/skills/a/SKILL.md`')
        self.put('skills/a/SKILL.md')
        self.assertEqual(sum('forbidden' in e for e in self.errors()), 3)

    def test_json_ref_and_internal_fragment(self):
        self.put('capability/schema.json', '{"$ref":"../task/data.json","$defs":{"x":{"$ref":"#/$defs/y"}}}')
        self.put('task/data.json', '{}')
        self.assertEqual(len(self.errors()), 1)

    def test_tools_outside_root_missing_and_remote_links(self):
        self.put('scripts/spec.md')
        self.put('task/spec.md', '[connector](../scripts/spec.md)\n[escape](../../entry.md)\n[missing](missing.md)\n[web](https://example.com)')
        errors = self.errors()
        self.assertTrue(any('forbidden' in e for e in errors))
        self.assertTrue(any('outside core' in e for e in errors))
        self.assertTrue(any('missing target' in e for e in errors))
        self.assertEqual(len(errors), 3)

    def test_readme_direct_case_and_inline(self):
        for text in ['[rules](README.md)', '[rules](ReAdMe.Md)', '`README.md`',
                     '[rules]: README.md', '<a href="README.md">rules</a>']:
            self.put('skills/a/SKILL.md', text)
            self.put('skills/a/README.md')
            errors, _ = layers.check_readme(self.core)
            self.assertTrue(any('README dependency' in e for e in errors), text)

    def test_readme_indirect_and_cycle(self):
        self.put('skills/a/SKILL.md', '[local](rules.md)')
        self.put('skills/a/rules.md', '[cycle](SKILL.md)\n[rules](README.md)')
        self.put('skills/a/README.md')
        errors, _ = layers.check_readme(self.core)
        self.assertEqual(len(errors), 2)
        self.assertTrue(any('SKILL.md:1' in e and 'rules.md:2' in e for e in errors))

    def test_human_readme_navigation_is_allowed(self):
        self.put('capability/README.md', '[task](../task/spec.md)\n[guide](../skills/a/README.md)')
        self.put('task/spec.md')
        self.put('skills/a/README.md')
        self.assertEqual(self.errors(), [])
        self.assertEqual(layers.check_readme(self.core)[0], [])

    def test_readme_mentions_and_external_links_are_allowed(self):
        self.put('task/spec.md', 'README 不作为执行输入。\n[external](https://example.com/README.md)')
        self.assertEqual(layers.check_readme(self.core)[0], [])

    def test_docs_direct_indirect_and_human_navigation(self):
        self.put('docs/theory.md', '[human](README.md)')
        self.put('docs/README.md')
        self.put('task/spec.md', '[helper](helper.md)')
        self.put('task/helper.md', '[theory](../docs/theory.md)')
        errors, _ = layers.check_readme(self.core)
        self.assertEqual(len(errors), 2)
        self.assertTrue(all('docs dependency' in e for e in errors))
        self.put('task/helper.md', 'docs are human-only')
        self.assertEqual(layers.check_readme(self.core)[0], [])

    def test_docs_case_and_explicit_path(self):
        self.put('task/spec.md', '`../DoCs/theory.md`')
        errors, _ = layers.check_readme(self.core)
        self.assertTrue(any('docs dependency' in e for e in errors))

    def test_workspace_json_cannot_load_docs(self):
        with tempfile.TemporaryDirectory() as temp:
            cbim = Path(temp)/'.cbim'
            core = cbim/'core.src'
            (core/'docs').mkdir(parents=True)
            (core/'docs/theory.md').write_text('human', encoding='utf-8')
            module = cbim/'workspace/game'
            module.mkdir(parents=True)
            (module/'module.json').write_text('{"overview": "../../core.src/docs/theory.md"}', encoding='utf-8')
            errors, _ = layers.check_readme(core)
            self.assertTrue(any('docs dependency' in e for e in errors))

    def test_source_inventory_is_not_instruction_loading(self):
        self.put('business/module.json', '{"sources": [{"location": "README.md"}]}')
        self.assertEqual(layers.check_readme(self.core)[0], [])

    def test_entry_and_team_readme_dependencies(self):
        with tempfile.TemporaryDirectory() as temp:
            cbim = Path(temp)/'.cbim'
            core = cbim/'core.src'
            core.mkdir(parents=True)
            (cbim/'entry.md').write_text('[rules](core/README.md)', encoding='utf-8')
            (core/'README.md').write_text('human', encoding='utf-8')
            team = cbim/'team/dev'
            team.mkdir(parents=True)
            (team/'principles.md').write_text('`.cbim/core.src/README.md`', encoding='utf-8')
            errors, _ = layers.check_readme(core)
            self.assertEqual(len(errors), 2)


if __name__ == '__main__':
    unittest.main()
