import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ignore_rules import IgnoreRules
from maintain_registries import discover


class IgnoreRulesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'.cbim').mkdir()

    def rules(self, text):
        (self.root/'.cbim/.cbimignore').write_text(text, encoding='utf-8')
        return IgnoreRules(self.root)

    def test_comments_escaped_patterns_negation_and_globs(self):
        rules = self.rules('# comment\n\n*.meta\n!keep.meta\n\\#literal\n\\!literal\n/root.txt\ncache/\na/**/b?.tmp\nspace\\ \n')
        for path, directory in [('deep/A.META', False), ('#literal', False), ('!literal', False),
                                ('root.txt', False), ('x/cache', True), ('a/b1.tmp', False),
                                ('a/x/y/b2.tmp', False), ('space ', False)]:
            with self.subTest(path=path):
                self.assertIsNotNone(rules.match(path, is_directory=directory))
        for path in ('keep.meta', 'deep/keep.meta', 'deep/root.txt', 'a/b12.tmp', 'file.metadata'):
            with self.subTest(path=path):
                self.assertIsNone(rules.match(path))

    def test_report_keeps_original_line_numbers(self):
        rules = self.rules('# comment\n\n*.META\n')
        result = rules.match('x.meta')
        self.assertEqual(result['line'], 3)
        self.assertEqual(result['pattern'], '*.META')

    def test_registration_filter_does_not_filter_agents_or_explicit_audits(self):
        rules = self.rules('/.cbim/team/\n/.cbim/workspace/hidden/\n')
        agent = self.root/'.cbim/team/group/member/agent.json'
        module = self.root/'.cbim/workspace/hidden/module.json'
        for path in (agent, module):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('{}', encoding='utf-8')
        self.assertEqual(list(discover(self.root, '.cbim/team', 'agent.json', rules=rules)), [agent])
        self.assertEqual(list(discover(self.root, '.cbim/workspace', 'module.json', rules=rules)), [])
        self.assertEqual(list(discover(self.root, '.cbim/workspace', 'module.json', rules=rules, apply_ignore=False)), [module])

    def test_parent_exclusion_and_explicit_parent_reinclude(self):
        rules = self.rules('cache/\n!cache/keep.txt\n')
        self.assertIsNotNone(rules.match('cache/keep.txt'))
        rules = self.rules('cache/\n!cache/\ncache/*\n!cache/keep.txt\n')
        self.assertIsNone(rules.match('cache/keep.txt'))
        self.assertIsNotNone(rules.match('cache/other.txt'))

    def test_fixed_discovery_exclusions_cannot_be_overridden(self):
        rules = self.rules('!.cbim/workspace/archive/\n!.cbim/workspace/archive/module.json\n')
        for path in ('.cbim/workspace/archive/module.json', '.cbim/workspace/live/module.json'):
            file = self.root/path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('{}', encoding='utf-8')
        files = list(discover(self.root, '.cbim/workspace', 'module.json', rules=rules))
        self.assertEqual([p.parent.name for p in files], ['live'])

    @unittest.skipUnless(shutil.which('git'), 'git unavailable for parity check')
    def test_git_check_ignore_parity(self):
        patterns = '*.meta\n!keep.meta\ncache/\n!cache/keep.txt\n/root.txt\na/**/b?.tmp\n\\#literal\n'
        rules = self.rules(patterns)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True, capture_output=True)
        (self.root/'.gitignore').write_text(patterns, encoding='utf-8')
        for path in ('x.meta', 'a/x.meta', 'keep.meta', 'a/keep.meta', 'cache/',
                     'cache/keep.txt', 'cache/a.txt', 'root.txt', 'deep/root.txt',
                     'a/b1.tmp', 'a/x/y/b2.tmp', 'a/b12.tmp', '#literal', 'x.metadata'):
            with self.subTest(path=path):
                result = subprocess.run(['git', '-C', str(self.root), 'check-ignore', '--no-index', '-q', '--', path], capture_output=True)
                self.assertIn(result.returncode, (0, 1), result.stderr)
                self.assertEqual(bool(rules.match(path, is_directory=path.endswith('/'))), result.returncode == 0)


if __name__ == '__main__':
    unittest.main()
