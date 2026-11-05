import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('registry', Path(__file__).parents[1] / 'maintain_registries.py')
registry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(registry)
SUMMARY = ('管理客户端资源加载、卸载与缓存，提供 AssetLoader 和 Prefab 实例生命周期接口。'
           '包含异步请求取消、对象池复用、回调有效性检查与过期资源清理，支持定位资源加载失败、实例释放和重复请求问题。'
           '底层资源传输由相关资源系统提供，本模块负责运行期调用与生命周期管理。')


class RegistryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        (self.root/'.cbim/connectors').mkdir(parents=True)
        self.save(self.root/'.cbim/connectors/registry.json', {'connectors': []})
        self.create('.cbim/team/programmers/dev/principles.md', '# 工作原则\n')
        self.create('.cbim/workspace/game/dna/module.md', '# 知识\n## Positioning\n资源管理。\n')
        self.agent = self.root / '.cbim/team/programmers/dev/agent.json'
        self.module = self.root / '.cbim/workspace/game/module.json'
        self.agent_data = dict(authors=[], name='开发', summary=SUMMARY, capabilities=['资源开发'],
                               limitations=[], work_principles='principles.md', skills=[], connectors=[])
        self.module_data = dict(name='资源', summary=SUMMARY, authors=[],
                                boundaries='dna/module.md#positioning', dna=[dict(name='知识', reference='dna/module.md')],
                                sources=[dict(location='src', scope='资源代码')],
                                workflows=[], connectors=[])
        self.save(self.agent, self.agent_data)
        self.save(self.module, self.module_data)
        self.save(self.root/'.cbim/team/people.json', {'people': [
            {'id': 'linan1', 'name': '李南', 'team': '.cbim/team/programmers'}]})

    def create(self, path, text):
        p = self.root / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding='utf-8')
        return p

    def save(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')

    def connector(self):
        data = {'connectors': [dict(id='.cbim/connectors/test', name='Test', summary='Test plugin',
                plugin=dict(ghost_id='test-plugin', namespace=None))]}
        self.save(self.root/'.cbim/connectors/registry.json', data)
        return data

    def test_plugin_reference_and_no_registry_rewrite(self):
        self.connector()
        path = self.root/'.cbim/connectors/registry.json'
        before = path.read_bytes()
        for definition, data in [(self.agent, self.agent_data), (self.module, self.module_data)]:
            self.save(definition, dict(data, connectors=['.cbim/connectors/test']))
        self.assertEqual(registry.maintain(self.root, True, allow_legacy=True)['connectors'], 1)
        self.assertEqual(before, path.read_bytes())

    def test_missing_plugin_reference(self):
        self.save(self.agent, dict(self.agent_data, connectors=['.cbim/connectors/missing']))
        with self.assertRaises(registry.RegistryError):
            registry.maintain(self.root, True, allow_legacy=True)

    def test_duplicate_plugin_and_identity(self):
        for duplicate_id in [True, False]:
            data = self.connector()
            entry = dict(data['connectors'][0])
            if not duplicate_id:
                entry['id'] = '.cbim/connectors/other'
            data['connectors'].append(entry)
            self.save(self.root/'.cbim/connectors/registry.json', data)
            with self.assertRaises(registry.RegistryError):
                registry.maintain(self.root, True, allow_legacy=True)

    def test_no_transport_or_usage_in_declaration(self):
        for field in ['binding', 'kind', 'usage']:
            data = self.connector()
            data['connectors'][0][field] = 'legacy'
            self.save(self.root/'.cbim/connectors/registry.json', data)
            with self.assertRaises(registry.RegistryError):
                registry.maintain(self.root, True, allow_legacy=True)

    def test_people_remain_separate_and_unchanged(self):
        path = self.root/'.cbim/team/people.json'
        before = path.read_bytes()
        registry.maintain(self.root, True, allow_legacy=True)
        self.assertEqual(before, path.read_bytes())
        team = registry.read_json(self.root/'.cbim/team/registry.json')
        self.assertEqual(set(team), {'groups'})
        self.assertEqual(set(team['groups'][0]), {'id', 'agents'})

    def test_companion_registry_rejected(self):
        registry.maintain(self.root, True, allow_legacy=True)
        self.save(self.root/'.cbim/team/registry.json', {'groups': [
            {'id': '.cbim/team/programmers', 'companions': []}]})
        with self.assertRaises(registry.RegistryError):
            registry.maintain(self.root, allow_legacy=True)

    def test_missing_people_blocks_write(self):
        registry.maintain(self.root, True, allow_legacy=True)
        index = self.root/'.cbim/team/registry.json'
        before = index.read_bytes()
        (self.root/'.cbim/team/people.json').unlink()
        with self.assertRaises(registry.RegistryError):
            registry.maintain(self.root, True, allow_legacy=True)
        self.assertEqual(before, index.read_bytes())

    def test_json_sync_and_idempotency(self):
        self.assertEqual(registry.maintain(self.root, True, allow_legacy=True), dict(agents=1, modules=1, connectors=0, legacy_modules=1,
                                                                                     ignore_config={'path': '.cbim/.cbimignore', 'configured': False, 'rules': 0},
                                                                                     ignored_discovery=[]))
        before = self.module.read_bytes()
        registry.maintain(self.root, True, allow_legacy=True)
        self.assertEqual(before, self.module.read_bytes())
        registry.maintain(self.root, allow_legacy=True)
        self.assertEqual(registry.read_json(self.root / '.cbim/workspace/registry.json'),
                         {'modules': [{'id': '.cbim/workspace/game', 'summary': SUMMARY}]})

    def test_work_cycle_rejected_without_changing_indexes(self):
        registry.maintain(self.root, True, allow_legacy=True)
        indexes = [self.root/'.cbim/team/registry.json', self.root/'.cbim/workspace/registry.json']
        before = [p.read_bytes() for p in indexes]
        self.save(self.agent, dict(self.agent_data, work_cycle='legacy.md'))
        with self.assertRaises(registry.RegistryError):
            registry.maintain(self.root, True, allow_legacy=True)
        self.assertEqual(before, [p.read_bytes() for p in indexes])

    def test_removed_fields_rejected(self):
        registry.maintain(self.root, True, allow_legacy=True)
        for path, original in [(self.agent, self.agent_data), (self.module, self.module_data)]:
            for field in ('domain', 'domains'):
                self.save(path, dict(original, **{field: ['legacy']}))
                with self.subTest(field=field, path=path), self.assertRaises(registry.RegistryError):
                    registry.maintain(self.root, True, allow_legacy=True)
            self.save(path, original)
        for folder in ('team', 'workspace'):
            path = self.root/'.cbim'/folder/'registry.json'
            original = registry.read_json(path)
            for field in ('domain', 'domains'):
                data = json.loads(json.dumps(original))
                entries = data['groups'][0]['agents'] if folder == 'team' else data['modules']
                entries[0][field] = ['legacy']
                self.save(path, data)
                with self.assertRaises(registry.RegistryError): registry.maintain(self.root, allow_legacy=True)
            self.save(path, original)

    def test_authors_contract(self):
        for path, original in [(self.agent, self.agent_data), (self.module, self.module_data)]:
            for value in [[], ['linan1']]:
                data = dict(original, authors=value)
                self.save(path, data)
                registry.maintain(self.root, True, allow_legacy=True)
            for value in [None, 'linan1', [''], ['invalid id'], ['linan1', 'linan1'], [123], 123]:
                self.save(path, dict(original, authors=value))
                with self.subTest(value=value), self.assertRaises(registry.RegistryError):
                    registry.maintain(self.root, True, allow_legacy=True)
            data = dict(original)
            data.pop('authors')
            self.save(path, data)
            with self.assertRaises(registry.RegistryError):
                registry.maintain(self.root, True, allow_legacy=True)
            self.save(path, dict(original, owner='legacy'))
            with self.assertRaises(registry.RegistryError):
                registry.maintain(self.root, True, allow_legacy=True)
            self.save(path, original)

    def test_grouped_registry_and_empty_group(self):
        (self.root/'.cbim/team/artists').mkdir()
        registry.maintain(self.root, True, allow_legacy=True)
        path = self.root/'.cbim/team/registry.json'
        data = registry.read_json(path)
        self.assertEqual(data['groups'][0], {'id': '.cbim/team/artists', 'agents': []})
        self.assertEqual(data['groups'][1]['agents'][0]['id'], '.cbim/team/programmers/dev')
        original = json.loads(json.dumps(data))
        for change in ('duplicate', 'wrong_group', 'missing', 'flat'):
            data = json.loads(json.dumps(original))
            if change == 'duplicate': data['groups'].append(data['groups'][0])
            elif change == 'wrong_group':
                data['groups'][0]['agents'] = data['groups'][1]['agents']
                data['groups'][1]['agents'] = []
            elif change == 'missing': data['groups'].pop(0)
            else: data = {'agents': data['groups'][1]['agents']}
            self.save(path, data)
            with self.subTest(change=change), self.assertRaises(registry.RegistryError):
                registry.maintain(self.root, allow_legacy=True)

    def test_authors_membership_and_team_consistency(self):
        (self.root/'.cbim/team/artists').mkdir()
        roster = {'people': [
            {'id': 'linan1', 'name': None, 'team': '.cbim/team/programmers'},
            {'id': 'dev2', 'name': None, 'team': '.cbim/team/programmers'},
            {'id': 'artist', 'name': None, 'team': '.cbim/team/artists'},
            {'id': 'unknown_team', 'name': None, 'team': None}]}
        people_path = self.root/'.cbim/team/people.json'
        self.save(people_path, roster)
        for path, original in [(self.agent, self.agent_data), (self.module, self.module_data)]:
            self.save(path, dict(original, authors=['linan1', 'dev2']))
            registry.maintain(self.root, True, allow_legacy=True)
            snapshots = {p: p.read_bytes() for p in [self.root/'.cbim/team/registry.json',
                                                    self.root/'.cbim/workspace/registry.json']}
            for authors in [['missing'], ['LINAN1'], ['unknown_team'], ['linan1', 'artist']]:
                self.save(path, dict(original, authors=authors))
                with self.subTest(authors=authors), self.assertRaises(registry.RegistryError):
                    registry.maintain(self.root, True, allow_legacy=True)
                for p, content in snapshots.items(): self.assertEqual(p.read_bytes(), content)
            self.save(path, dict(original, author=None))
            with self.assertRaises(registry.RegistryError): registry.maintain(self.root, True, allow_legacy=True)
            self.save(path, dict(original, authors=['linan1', 'dev2']))
            roster['people'][1]['team'] = '.cbim/team/artists'
            self.save(people_path, roster)
            with self.assertRaises(registry.RegistryError): registry.maintain(self.root, allow_legacy=True)
            roster['people'][1]['team'] = '.cbim/team/programmers'
            self.save(people_path, roster)
            self.save(path, original)

    def test_people_team_validation(self):
        registry.maintain(self.root, True, allow_legacy=True)
        path = self.root/'.cbim/team/people.json'
        before = (self.root/'.cbim/team/registry.json').read_bytes()
        person = {'id': 'linan1', 'name': '李南', 'team': None}
        for data in ({}, {'people': {}}, {'people': [{'id': 'linan1', 'name': None}]},
                     {'people': [person, person]},
                     *({'people': [dict(person, team=value)]}
                       for value in ('.cbim/team/absent', ['.cbim/team/programmers'], 123)),
                     {'people': [dict(person, identity_status='unverified')]},
                     {'people': [dict(person, name=123)]}):
            self.save(path, data)
            with self.subTest(data=data), self.assertRaises(registry.RegistryError):
                registry.maintain(self.root, True, allow_legacy=True)
            self.assertEqual(before, (self.root/'.cbim/team/registry.json').read_bytes())
        self.save(path, {'people': [person]})
        registry.maintain(self.root, True, allow_legacy=True)

    def test_new_definition_requires_sync(self):
        registry.maintain(self.root, True, allow_legacy=True)
        self.create('.cbim/team/programmers/other/principles.md', '# 原则\n')
        self.save(self.root/'.cbim/team/programmers/other/agent.json', self.agent_data)
        with self.assertRaises(registry.RegistryError): registry.maintain(self.root, allow_legacy=True)
        self.assertEqual(registry.maintain(self.root, True, allow_legacy=True)['agents'], 2)

    def test_missing_summary_never_extracted_from_markdown(self):
        self.agent_data.pop('summary')
        self.save(self.agent, self.agent_data)
        self.create('.cbim/team/programmers/dev/principles.md', '- summary：' + SUMMARY)
        with self.assertRaises(registry.RegistryError): registry.maintain(self.root, True, allow_legacy=True)

    def test_invalid_schema_blocks_both_writes(self):
        registry.maintain(self.root, True, allow_legacy=True)
        before = (self.root/'.cbim/team/registry.json').read_bytes()
        self.module_data['authors'] = 'linan1'
        self.save(self.module, self.module_data)
        with self.assertRaises(registry.RegistryError): registry.maintain(self.root, True, allow_legacy=True)
        self.assertEqual(before, (self.root/'.cbim/team/registry.json').read_bytes())

    def test_unknown_and_duplicate_fields(self):
        self.module_data['keywords'] = []
        self.save(self.module, self.module_data)
        with self.assertRaises(registry.RegistryError): registry.maintain(self.root, True, allow_legacy=True)
        self.agent.write_text('{"name":"A", "name":"B"}', encoding='utf-8')
        with self.assertRaises(registry.RegistryError): registry.read_json(self.agent)

    def test_missing_and_outside_references(self):
        for reference in ('absent.md', '../../../../outside.md'):
            self.agent_data['work_principles'] = reference
            self.save(self.agent, self.agent_data)
            with self.subTest(reference=reference), self.assertRaises(registry.RegistryError):
                registry.maintain(self.root, True, allow_legacy=True)

    def test_knowledge_inventory(self):
        self.create('.cbim/workspace/game/dna/topic.md', '# 专题\n')
        with self.assertRaises(registry.RegistryError): registry.maintain(self.root, True, allow_legacy=True)
        self.module_data['dna'].append(dict(name='专题', reference='dna/topic.md'))
        self.save(self.module, self.module_data)
        registry.maintain(self.root, True, allow_legacy=True)

    def test_workflow_and_skill_inventory(self):
        self.create('.cbim/team/programmers/dev/skills/check/SKILL.md', '# 方法\n')
        self.create('.cbim/workspace/game/workflows/check.md', '# 流程\n')
        with self.assertRaises(registry.RegistryError): registry.maintain(self.root, True, allow_legacy=True)
        self.agent_data['skills'] = [dict(name='方法', purpose='核查', reference='skills/check/SKILL.md')]
        self.module_data['workflows'] = [dict(name='流程', purpose='核查', trigger='修改后', reference='workflows/check.md')]
        self.save(self.agent, self.agent_data)
        self.save(self.module, self.module_data)
        registry.maintain(self.root, True, allow_legacy=True)

    def test_legacy_definition(self):
        self.create('.cbim/team/programmers/dev/agent.md', '# 旧定义\n')
        with self.assertRaises(registry.RegistryError): registry.maintain(self.root, True, allow_legacy=True)

    def test_archives_and_mirrors_not_scanned(self):
        for folder in ('archive', '_unassigned', 'Client_debug', 'clinet-debug'):
            self.create('.cbim/workspace/' + folder + '/module.json', '{}')
        self.assertEqual(registry.maintain(self.root, True, allow_legacy=True)['modules'], 1)

    def test_removed_metadata_fields_are_rejected(self):
        for key, value in [('version', '1'), ('validation', {}), ('provenance', []), ('dependencies', {})]:
            data = dict(self.module_data, **{key: value})
            self.save(self.module, data)
            with self.subTest(field=key), self.assertRaises(registry.RegistryError):
                registry.maintain(self.root, True, allow_legacy=True)

    def test_length_boundaries(self):
        for length in (100, 250):
            text = '字' * (length - 5) + ' Unity'
            self.assertEqual(registry.validate_summary(text, 'test'), text)
        for text in ('字' * 99, '字' * 251, '字 ' * 50 + '字', '', 'TODO'):
            with self.subTest(length=len(text)), self.assertRaises(registry.RegistryError):
                registry.validate_summary(text, 'test')

    def test_stale_index_duplicate_and_path_base(self):
        registry.maintain(self.root, True, allow_legacy=True)
        p = self.root/'.cbim/workspace/registry.json'
        original = p.read_text(encoding='utf-8')
        for change in ('summary', 'duplicate', 'path_base', 'path'):
            data = json.loads(original)
            if change == 'summary': data['modules'][0]['summary'] = SUMMARY.replace('客户端', '服务端')
            elif change == 'duplicate': data['modules'].append(data['modules'][0].copy())
            elif change == 'path_base': data['path_base'] = 'project_root'
            else: data['modules'][0]['id'] = '../outside'
            self.save(p, data)
            with self.subTest(change=change), self.assertRaises(registry.RegistryError):
                registry.maintain(self.root, allow_legacy=True)


if __name__ == '__main__':
    unittest.main()
