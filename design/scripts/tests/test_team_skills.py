import json
from pathlib import Path
import tempfile
import unittest

from team_skills import resolve, validate_tree
from create_method import create


class TeamSkillTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.agent = '.cbim/team/engineering/game/client/developer'
        self.save(self.agent + '/agent.json', {'skills': []})

    def save(self, name, data):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data), encoding='utf-8')

    def add(self, owner, slug, agent=False):
        folder = self.root / owner / 'skills' / slug
        folder.mkdir(parents=True)
        (folder / 'SKILL.md').write_text('# Method\n', encoding='utf-8')
        self.save(owner + ('/agent.json' if agent else '/skills.json'), {'skills': [
            {'name': slug, 'purpose': 'test', 'reference': f'skills/{slug}/SKILL.md'}]})

    def test_recursive_catalog_root_and_sibling_isolation(self):
        self.add(self.agent, 'own', True)
        self.add('.cbim/team/engineering/game/client', 'client')
        self.add('.cbim/team/engineering', 'engineering')
        self.add('.cbim/team', 'global')
        self.add('.cbim/team/engineering/game/server', 'sibling')
        result = resolve(self.root, self.agent)
        self.assertEqual([s['name'] for s in result['skills']], ['own', 'client', 'engineering', 'global'])
        self.assertEqual(result['chain'], [self.agent, '.cbim/team/engineering/game/client',
                         '.cbim/team/engineering/game', '.cbim/team/engineering', '.cbim/team'])
        self.assertTrue(all(len(s['sha256']) == 64 for s in result['skills']))

    def test_collision_is_not_shadowed(self):
        self.add(self.agent, 'same', True)
        self.add('.cbim/team', 'same')
        with self.assertRaisesRegex(ValueError, '冲突'):
            resolve(self.root, self.agent)

    def test_slug_collision_with_different_display_name(self):
        self.add(self.agent, 'same', True)
        self.add('.cbim/team', 'same')
        p = self.root / '.cbim/team/skills.json'
        data = json.loads(p.read_text())
        data['skills'][0]['name'] = 'another display name'
        self.save('.cbim/team/skills.json', data)
        with self.assertRaisesRegex(ValueError, '冲突'):
            resolve(self.root, self.agent)

    def test_unregistered_shared_method_even_without_agents(self):
        p = self.root / '.cbim/team/empty/skills/orphan/SKILL.md'
        p.parent.mkdir(parents=True)
        p.write_text('# Method')
        with self.assertRaisesRegex(ValueError, '清单'):
            validate_tree(self.root)

    def test_missing_shared_entry(self):
        self.add('.cbim/team', 'global')
        (self.root / '.cbim/team/skills/global/SKILL.md').unlink()
        with self.assertRaisesRegex(ValueError, '入口'):
            resolve(self.root, self.agent)

    def test_references_are_not_teams(self):
        (self.root / '.cbim/team/references/docs').mkdir(parents=True)
        teams, _ = validate_tree(self.root)
        self.assertFalse(any('references' in p.parts for p in teams))

    def test_agent_cannot_contain_agent(self):
        self.save(self.agent + '/nested/agent.json', {'skills': []})
        with self.assertRaisesRegex(ValueError, '不能包含'):
            validate_tree(self.root)

    def test_owner_outside_tree(self):
        with self.assertRaises(ValueError):
            resolve(self.root, '.cbim/other')

    def test_direct_root_agent_inherits_root(self):
        self.save('.cbim/team/direct/agent.json', {'skills': []})
        self.add('.cbim/team', 'global')
        result = resolve(self.root, '.cbim/team/direct')
        self.assertEqual(result['chain'], ['.cbim/team/direct', '.cbim/team'])
        self.assertEqual(len(result['skills']), 1)

    def test_symlink_cannot_supply_shared_method(self):
        outside = self.root / 'outside'
        outside.mkdir()
        (outside / 'SKILL.md').write_text('# Method')
        link = self.root / '.cbim/team/skills/linked'
        link.parent.mkdir()
        try:
            link.symlink_to(outside, target_is_directory=True)
        except OSError:
            self.skipTest('Symlink creation unavailable')
        self.save('.cbim/team/skills.json', {'skills': [{'name': 'linked', 'purpose': 'test',
                  'reference': 'skills/linked/SKILL.md'}]})
        with self.assertRaisesRegex(ValueError, '链接'):
            resolve(self.root, self.agent)

    def test_shared_cannot_reference_private_skill(self):
        self.add(self.agent, 'own', True)
        self.save('.cbim/team/skills.json', {'skills': [{'name': 'own', 'purpose': 'test',
                  'reference': 'engineering/game/client/developer/skills/own/SKILL.md'}]})
        with self.assertRaises(ValueError):
            resolve(self.root, self.agent)

    def test_create_shared_preview_write_and_rollback_conflict(self):
        owner = '.cbim/team/engineering'
        content = '---\nname: shared\ndescription: test\n---\n# Method\n'
        create(self.root, owner, 'shared', 'shared', content, 'skill', 'test')
        self.assertFalse((self.root / owner / 'skills.json').exists())
        create(self.root, owner, 'shared', 'shared', content, 'skill', 'test', True)
        self.assertEqual(resolve(self.root, self.agent)['skills'][0]['name'], 'shared')
        with self.assertRaisesRegex(ValueError, '冲突'):
            create(self.root, '.cbim/team', 'shared', 'shared', content, 'skill', 'test', True)
        self.assertFalse((self.root / '.cbim/team/skills.json').exists())
        self.assertFalse((self.root / '.cbim/team/skills').exists())

    def test_registry_indexes_nested_teams(self):
        from test_maintain_registries import RegistryTests
        from maintain_registries import build_plan
        fixture = RegistryTests()
        fixture.setUp()
        try:
            nested = fixture.root / '.cbim/team/programmers/backend/services/dev'
            nested.mkdir(parents=True)
            fixture.save(nested / 'agent.json', fixture.agent_data)
            (nested / 'principles.md').write_text('# Principles')
            groups = build_plan(fixture.root, allow_legacy=True)[fixture.root / '.cbim/team/registry.json']['groups']
            index = {g['id']: g['agents'] for g in groups}
            self.assertEqual(index['.cbim/team/programmers/backend'], [])
            self.assertEqual(index['.cbim/team/programmers/backend/services'][0]['id'],
                             '.cbim/team/programmers/backend/services/dev')
            self.assertEqual(len(index['.cbim/team/programmers']), 1)
        finally:
            fixture.doCleanups()


if __name__ == '__main__':
    unittest.main()
