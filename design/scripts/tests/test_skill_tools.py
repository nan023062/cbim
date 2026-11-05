"""Regression tests for deterministic Skill entry points and safety boundaries."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

CORE = Path(__file__).resolve().parents[2]


def load(skill, script):
    path = CORE/'skills'/skill/'scripts'/script
    spec = importlib.util.spec_from_file_location(skill.replace('-', '_')+'_'+path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


query = load('knowledge-query', 'query_modules.py')
baseline = load('business-execution', 'file_baseline.py')
knowledge = load('knowledge-governance', 'check_knowledge.py')
core_check = load('core-check', 'check_core.py')


class SkillToolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        (self.root/'.cbim/workspace').mkdir(parents=True)

    def module(self, suffix, summary='资源 lifecycle'):
        key = '.cbim/workspace/'+suffix
        folder = self.root/key
        folder.mkdir(parents=True, exist_ok=True)
        data = {'id': key, 'name': folder.name, 'summary': summary, 'overview': 'module.md',
                'sources': []}
        (folder/'module.json').write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        (folder/'module.md').write_text('# module\n资源 lifecycle\n', encoding='utf-8')
        return key

    def file(self, name, content='before'):
        path = self.root/name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')
        return path

    def test_query_returns_evidence_not_mutations(self):
        key = self.module('game')
        before = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        result = query.query(self.root, '资源')
        self.assertEqual(result['results'][0]['id'], key)
        self.assertEqual(result['results'][0]['excerpts'][0]['line'], 2)
        self.assertEqual(len(result['results'][0]['overview_sha256']), 64)
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()})
        self.assertEqual(query.query(self.root, 'absent')['results'], [])
        with self.assertRaises(ValueError): query.query(self.root, 'x', limit=0)

    def test_query_exact_id_and_truncation(self):
        a = self.module('a'); self.module('b')
        self.assertTrue(query.query(self.root, '资源', limit=1)['truncated'])
        self.assertEqual(query.query(self.root, module_id=a)['results'][0]['id'], a)
        with self.assertRaises(ValueError): query.query(self.root, module_id='missing')

    def test_snapshot_detects_changes_and_deletions_without_restoring(self):
        p = self.file('src/a.txt'); q = self.file('src/b.txt')
        receipt = baseline.snapshot(self.root, ['src/a.txt', 'src/b.txt'])
        manifest = Path(receipt['manifest']).relative_to(self.root)
        self.assertTrue(baseline.verify(self.root, manifest)['unchanged'])
        p.write_text('after', encoding='utf-8'); q.unlink()
        result = baseline.verify(self.root, manifest)
        self.assertEqual({r['status'] for r in result['files']}, {'changed', 'missing'})
        self.assertEqual(p.read_text(), 'after')
        self.assertFalse(q.exists())

    def test_snapshot_rejects_escape_and_tampered_evidence(self):
        self.file('a.txt')
        with self.assertRaises(ValueError): baseline.snapshot(self.root, ['../outside'])
        with self.assertRaises(ValueError): baseline.snapshot(self.root, ['.cbim'])
        receipt = baseline.snapshot(self.root, ['a.txt'])
        path = Path(receipt['manifest'])
        (path.parent/'snapshot/a.txt').write_text('tampered', encoding='utf-8')
        with self.assertRaises(ValueError): baseline.verify(self.root, path.relative_to(self.root))

    def test_knowledge_checks_preserve_findings_and_do_not_run_core_or_coverage_by_default(self):
        calls = []
        def fake(script, args, root, record, name):
            calls.append((name, args))
            return {'check': name, 'exit_code': 2 if name == 'sources' else 0}
        with patch.object(knowledge, 'run_python', side_effect=fake):
            result = knowledge.run(self.root)
        self.assertEqual([c[0] for c in calls], ['team-skills', 'registry', 'sources'])
        self.assertIn('--check', calls[1][1])
        self.assertEqual(result['exit_code'], 2)

    def test_knowledge_write_rechecks_and_registry_exit_two_is_an_error(self):
        calls = []
        def fake(script, args, root, record, name):
            calls.append(name)
            return {'check': name, 'exit_code': 0}
        with patch.object(knowledge, 'run_python', side_effect=fake):
            self.assertEqual(knowledge.run(self.root, write=True, coverage=True)['exit_code'], 0)
        self.assertEqual(calls, ['team-skills', 'registry', 'registry-recheck', 'sources', 'coverage'])
        with patch.object(knowledge, 'run_python', side_effect=lambda script,args,root,record,name: {'check':name,'exit_code':2}):
            self.assertEqual(knowledge.run(self.root)['exit_code'], 1)

    def test_core_requires_explicit_flag_and_preserves_child_failure(self):
        with patch.object(core_check, 'run_python') as runner, patch.object(core_check, 'emit'):
            self.assertEqual(core_check.main(['--root', str(self.root)]), 1)
            runner.assert_not_called()
        with patch.object(core_check, 'run_python', return_value={'exit_code':1}) as runner, patch.object(core_check, 'emit'):
            self.assertEqual(core_check.main(['--root', str(self.root), '--user-requested']), 1)
            self.assertEqual(runner.call_count, 2)

    def test_team_failure_blocks_both_checks_and_retains_other_receipts(self):
        def fake(script, args, root, record, name):
            return {'check': name, 'exit_code': 1 if name == 'team-skills' else 0}
        with patch.object(knowledge, 'run_python', side_effect=fake):
            result = knowledge.run(self.root)
            self.assertEqual(result['exit_code'], 1)
            self.assertEqual(len(result['checks']), 3)
        with patch.object(core_check, 'run_python', side_effect=fake), patch.object(core_check, 'emit') as output:
            self.assertEqual(core_check.main(['--root', str(self.root), '--user-requested']), 1)
            self.assertEqual(len(output.call_args.args[0]['checks']), 2)

    def test_core_success_requires_both_checks(self):
        with patch.object(core_check, 'run_python', return_value={'exit_code': 0}), patch.object(core_check, 'emit'):
            self.assertEqual(core_check.main(['--root', str(self.root), '--user-requested']), 0)


if __name__ == '__main__':
    unittest.main()
