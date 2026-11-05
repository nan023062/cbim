import json
from pathlib import Path
import unittest

from preview_module_tree import build_tree, render


def catalog(edges):
    return {k: (dict(name=k, children=v, sources=[]), Path(k)) for k, v in edges.items()}


class ModuleTreeTests(unittest.TestCase):
    def test_multiple_roots_and_child_order(self):
        tree = build_tree(catalog({'b': [], 'a': ['d', 'c'], 'c': [], 'd': []}))
        self.assertEqual(tree['roots'], ['a', 'b'])
        self.assertEqual(tree['nodes']['a']['children'], ['d', 'c'])

    def test_missing_duplicate_and_cycle_rejected(self):
        for edges in ({'a': ['x']}, {'a': ['b', 'b'], 'b': []},
                      {'a': ['c'], 'b': ['c'], 'c': []}, {'a': ['b'], 'b': ['a']}):
            with self.subTest(edges=edges), self.assertRaises(ValueError):
                build_tree(catalog(edges))

    def test_untrusted_text_cannot_close_script(self):
        tree = build_tree(catalog({'a': []}))
        value = '</script><script>alert(1)</script>'
        tree['nodes']['a']['summary'] = value
        html = render(tree)
        payload = html.split('type="application/json">')[1].split('</script>')[0]
        self.assertNotIn('<', payload)
        self.assertEqual(json.loads(payload)['nodes']['a']['summary'], value)


if __name__ == '__main__':
    unittest.main()
