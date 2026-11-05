"""Build an offline module-tree preview from authoritative module definitions."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import sys
import webbrowser

from skill_runtime import digest, emit, modules, project_root, record_dir, save_json


def build_tree(catalog):
    parents = {}
    nodes = {}
    for key, (data, path) in catalog.items():
        children = data.get('children', [])
        if not isinstance(children, list):
            raise ValueError(f'children 必须是列表：{key}')
        for child in children:
            if child not in catalog:
                raise ValueError(f'子模块不存在：{key} -> {child}')
            if child in parents:
                raise ValueError(f'子模块重复或有多个父模块：{child}')
            parents[child] = key
        nodes[key] = dict(id=key, name=data['name'], summary=data.get('summary', ''),
                          sources=data.get('sources', []), children=children,
                          authors=data.get('authors', []), virtual=False)
    visiting, done = set(), set()

    def visit(key):
        if key in visiting:
            raise ValueError(f'模块树存在循环：{key}')
        if key in done:
            return
        visiting.add(key)
        for child in nodes[key]['children']:
            visit(child)
        visiting.remove(key)
        done.add(key)

    for key in nodes:
        visit(key)
    return dict(nodes=nodes, roots=sorted(set(nodes) - set(parents)))


def render(tree):
    # Escape script terminators even when untrusted module text contains HTML.
    payload = json.dumps(tree, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    template = Path(__file__).with_name('module_tree.html').read_text(encoding='utf-8')
    return template.replace('__MODULE_TREE_DATA__', payload)


def main():
    parser = argparse.ArgumentParser(description='生成离线模块树；--open 生成后打开浏览器。')
    parser.add_argument('--root')
    parser.add_argument('--open', action='store_true')
    args = parser.parse_args()
    try:
        root = project_root(args.root)
        catalog = modules(root)
        before = {key: digest(path) for key, (_, path) in catalog.items()}
        tree = build_tree(catalog)
        tree['generated'] = datetime.now().astimezone().isoformat(timespec='seconds')
        tree['project'] = root.name
        html = render(tree)
        if before != {key: digest(path) for key, (_, path) in modules(root).items()}:
            raise ValueError('生成期间模块定义发生变化，请重新运行')
        record = record_dir(root, 'module-tree')
        output = record / 'module-tree.html'
        output.write_text(html, encoding='utf-8')
        save_json(record / 'definitions.json', before)
        result = dict(modules=len(catalog), roots=len(tree['roots']), html=str(output), generated=tree['generated'])
        save_json(record / 'result.json', result)
        if args.open:
            result['browser_requested'] = webbrowser.open(output.as_uri())
            if not result['browser_requested']:
                result['notice'] = '预览已生成，浏览器未能自动打开，请手动打开 HTML。'
        emit(result)
        return 0
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print(f'模块树预览失败：{exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
