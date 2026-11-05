import unittest
from update_module_diagrams import transform


def document(graph):
    return '## 子模块和 source 节点\n\n范围说明。\n\n## 结构关系图与抽象设计决策\n\n```mermaid\n' + graph + '\n```\n'


class DiagramTests(unittest.TestCase):
    def test_collapse_sources_preserves_design_and_is_idempotent(self):
        data = {'name': 'parent', 'sources': [{}, {}]}
        old = document('''classDiagram
    class Root["parent"]
    class A["path/a"]
    <<source>> A
    class B["path/b"]
    <<source>> B
    class Child["child"]
    Root *-- A
    Root *-- B
    Root *-- Child
    A *-- Implementation
    Implementation ..> Contract : preserved
''')
        new = transform(old, data, ['child'])
        self.assertEqual(new.count('<<virtual>>'), 1)
        self.assertEqual(new.count('Root *-- CbimDirectContent'), 1)
        self.assertIn('CbimDirectContent *-- Implementation', new)
        self.assertIn('Implementation ..> Contract : preserved', new)
        self.assertIn('Root *-- Child', new)
        self.assertNotIn('<<source>>', new)
        self.assertEqual(transform(new, data, ['child']), new)

    def test_internal_type_diagram_keeps_all_original_relations(self):
        data = {'name': 'leaf', 'sources': [{}]}
        graph = 'classDiagram\n    class Actor\n    Actor *-- Component : owns\n    Component ..> API : calls'
        new = transform(document(graph), data, [])
        self.assertIn('Actor *-- Component : owns', new)
        self.assertIn('Component ..> API : calls', new)
        self.assertIn('CbimModule *-- CbimDirectContent', new)
        self.assertEqual(transform(new, data, []), new)

    def test_organization_without_sources_has_no_virtual_node(self):
        data = {'name': 'team', 'sources': []}
        new = transform(document('classDiagram\n    class child { <<module>> }'), data, ['child'])
        self.assertNotIn('<<virtual>>', new)
        self.assertIn('CbimModule *-- child', new)
        self.assertEqual(transform(new, data, ['child']), new)

    def test_dependency_constraints_preserved(self):
        data = {'name': 'client', 'sources': [{}]}
        old = document('classDiagram\n    class Low["low"]\n    class High["high"]\n    High ..> Low : architecture')
        new = transform(old, data, ['low', 'high'])
        self.assertIn('High ..> Low : architecture', new)
        self.assertIn('CbimModule *-- Low', new)

    def test_unknown_child_and_multiple_diagrams_fail_closed(self):
        with self.assertRaises(ValueError):
            transform(document('classDiagram\n    class unrelated'), {'name': 'x', 'sources': []}, ['child'])
        with self.assertRaises(ValueError):
            transform(document('classDiagram\n    class A') * 2, {'name': 'x', 'sources': []}, [])

    def test_virtual_naming_drift_is_rejected(self):
        valid = transform(document('classDiagram\n    class Internal'), {'name': 'leaf', 'sources': [{}]}, [])
        variants = [
            valid.replace('直属内容（虚拟子模块）', '其他内容'),
            valid.replace('CbimDirectContent', 'LocalFiles'),
            valid.replace('<<virtual>>', '<<module>>'),
            valid.replace('<<virtual>> CbimDirectContent', '<<virtual>> CbimDirectContent\n    <<virtual>> Extra'),
            valid.replace('class CbimDirectContent["直属内容（虚拟子模块）"]', 'class CbimDirectContent["直属内容（虚拟子模块）"]\n    class CbimDirectContent["直属内容（虚拟子模块）"]'),
        ]
        for text in variants:
            with self.subTest(text=text), self.assertRaises(ValueError):
                transform(text, {'name': 'leaf', 'sources': [{}]}, [])


if __name__ == '__main__':
    unittest.main()
