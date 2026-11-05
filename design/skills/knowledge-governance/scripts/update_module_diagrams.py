"""Group direct sources into one virtual node; preserve existing design relations.

Read-only by default. --write requires explicit migration authorization.
Ambiguous roots or child mappings fail before any document is written.
"""
import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts'))
from skill_runtime import project_root, modules, record_dir, save_json, digest

GRAPH = re.compile(r'```mermaid\s*\n(.*?)```', re.S)
DIRECT = 'CbimDirectContent'
DIRECT_LABEL = '直属内容（虚拟子模块）'
ROOT = 'CbimModule'
NOTICE = '直属文件与直属文件夹统一归入“直属内容（虚拟子模块）”；范围以本节 source 及维护边界为准。'


def transform(text, data, child_names):
    graphs = list(GRAPH.finditer(text))
    if len(graphs) != 1 or not graphs[0][1].lstrip().startswith('classDiagram'):
        raise ValueError('需要唯一 classDiagram，不能自动合并多图')
    match = graphs[0]
    graph = match[1]
    virtual_ids = re.findall(r'^\s*<<virtual>>\s+(\w+)\s*$', graph, re.M)
    if '<<virtual>>' in graph:
        if virtual_ids != [DIRECT] or graph.count('<<virtual>>') != 1:
            raise ValueError('虚拟子模块必须唯一使用 <<virtual>> CbimDirectContent')
    direct_declarations = re.findall(r'^\s*class\s+' + DIRECT + r'\b([^\n]*)', graph, re.M)
    if direct_declarations:
        if direct_declarations != [f'["{DIRECT_LABEL}"]'] or virtual_ids != [DIRECT]:
            raise ValueError('虚拟子模块的名称、标识或类型标记不符合固定命名规则')
    declarations = dict(re.findall(r'^\s*class\s+(\w+)\["([^"]+)"\]', graph, re.M))
    ids = set(re.findall(r'^\s*class\s+(\w+)', graph, re.M))
    source_ids = set(re.findall(r'^\s*<<source>>\s+(\w+)\s*$', graph, re.M))
    if '<<source>>' in graph and not source_ids:
        raise ValueError('不支持的 source 标注，须人工确认')
    children = []
    for name in child_names:
        candidates = [i for i, label in declarations.items()
                      if label == name or label.startswith(name + ' ') or label.startswith(name + '·')]
        if name in ids and name not in candidates:
            candidates.append(name)
        if not candidates and name.startswith('core_libraries_'):
            short = name.removeprefix('core_libraries_')
            if short in ids:
                candidates = [short]
        if len(candidates) != 1:
            raise ValueError(f'正式子模块节点无法唯一定位：{name}: {candidates}')
        children.append(candidates[0])
    ownership = re.findall(r'^\s*(\w+)\s+\*--\s+(\w+)\s*$', graph, re.M)
    roots = {a for a, b in ownership if b in source_ids or b in children or b == DIRECT}
    if len(roots) > 1:
        raise ValueError(f'结构根节点不唯一：{roots}')
    root = next(iter(roots), None)
    if root is None:
        if ids == {'ModuleScope'}:
            root = 'ModuleScope'
        elif ROOT in ids:
            root = ROOT
        else:
            root = ROOT
            if ROOT in graph:
                raise ValueError('结构根标识冲突')
    lines = []
    for line in graph.splitlines():
        if re.match(r'^\s*<<source>>\s+\w+\s*$', line):
            continue
        declaration = re.match(r'^\s*class\s+(\w+)', line)
        if declaration and declaration[1] in source_ids:
            if not re.fullmatch(r'\s*class\s+\w+(?:\["[^"]*"\])?\s*', line):
                raise ValueError('source 节点含成员，不能丢弃')
            continue
        # Replace only relationship identifiers, never prose/labels or class members.
        if re.match(r'^\s*\w+\s+[^\w\s]', line):
            for identifier in source_ids:
                line = re.sub(r'\b' + re.escape(identifier) + r'\b', DIRECT, line)
        if line.strip() and line.strip() in {x.strip() for x in lines} and re.match(r'^\s*\w+\s+\*--', line):
            continue
        lines.append(line)
    prefix = []
    if root not in ids:
        prefix.append(f'    class {root}["{data["name"]}"]')
    if data['sources']:
        if DIRECT not in ids:
            prefix += [f'    class {DIRECT}["{DIRECT_LABEL}"]', f'    <<virtual>> {DIRECT}']
        elif f'<<virtual>> {DIRECT}' not in graph:
            raise ValueError('虚拟节点标识被其他类型占用')
        if not any(re.fullmatch(r'\s*' + re.escape(root) + r'\s+\*--\s+' + DIRECT + r'\s*', line) for line in lines):
            prefix.append(f'    {root} *-- {DIRECT}')
        if not source_ids and DIRECT not in ids and len(ids - {root, DIRECT} - set(children)) > 0:
            note = f'    note for {DIRECT} "图中保留的内部类型及关系描述直属内容设计；不新增正式子模块。"'
            if note.strip() not in {x.strip() for x in lines}:
                prefix.append(note)
    elif source_ids or DIRECT in ids:
        raise ValueError('无 sources 的模块却含直属内容节点')
    for child in children:
        if not re.search(r'<<module>>\s+' + re.escape(child) + r'\b', graph) and not re.search(r'class\s+' + re.escape(child) + r'\s*\{\s*<<module>>', graph):
            prefix.append(f'    <<module>> {child}')
        if (root, child) not in ownership:
            prefix.append(f'    {root} *-- {child}')
    lines[1:1] = prefix
    result = text[:match.start(1)] + '\n'.join(lines).rstrip() + '\n' + text[match.end(1):]
    if data['sources'] and NOTICE not in result:
        heading = '## 子模块和 source 节点'
        if heading not in result:
            raise ValueError('缺少节点章节')
        result = result.replace(heading, heading + '\n\n' + NOTICE, 1)
    return result


def run(root, write=False):
    catalog = modules(root)
    plans = []
    for key, (data, definition) in catalog.items():
        path = definition.parent / 'module.md'
        old = path.read_text(encoding='utf-8')
        names = [catalog[c][0]['name'] for c in data['children']]
        try:
            new = transform(old, data, names)
            if transform(new, data, names) != new:
                raise ValueError('转换不是幂等的')
        except ValueError as error:
            raise ValueError(f'{key}: {error}') from error
        plans.append((path, old, new, digest(definition)))
    record = record_dir(root, 'module-virtual-diagrams')
    save_json(record / 'baseline.json', {p.relative_to(root).as_posix(): old for p, old, new, h in plans})
    changed = [p.relative_to(root).as_posix() for p, old, new, h in plans if old != new]
    if write:
        for p, old, new, h in plans:
            if p.read_text(encoding='utf-8') != old or digest(p.parent / 'module.json') != h:
                raise ValueError(f'基线已变化：{p}')
        for p, old, new, h in plans:
            if old != new:
                p.write_text(new, encoding='utf-8')
    result = {'modules': len(plans), 'changed' if write else 'pending': changed,
              'record': str(record), 'write': write}
    save_json(record / 'result.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    from skill_runtime import emit
    try:
        result = run(project_root(args.root), args.write)
        emit(result)
        return 2 if result.get('pending') else 0
    except (OSError, ValueError, KeyError) as error:
        emit({'error': str(error)})
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
