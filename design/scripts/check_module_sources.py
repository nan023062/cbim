"""Read-only source ownership checks, independent of generated registries.

Exact path aliases are errors. Aligned ancestor containment is normal.
Cross-branch and redundant same-module containment remain warnings.
"""
import argparse
import json
from pathlib import Path

from maintain_registries import RegistryError, discover, read_json
from ignore_rules import IgnoreRules, source_key




def descendant(child, parent):
    return child.startswith(parent.rstrip('/') + '/')


def check(root):
    root = Path(root).resolve()
    errors, overlaps, entries, containments = [], [], [], []
    ignored_sources, ignored_discovery = [], []
    rules = None
    count = 0
    try:
        rules = IgnoreRules(root)
        definitions = list(discover(root, '.cbim/workspace', 'module.json', rules=rules, ignored=ignored_discovery, apply_ignore=False))
    except (OSError, ValueError) as exc:
        return {'modules': 0, 'sources': 0, 'errors': [{'code': 'scan_error', 'message': str(exc)}], 'overlaps': [], 'containments': [], 'ignored_sources': [], 'ignored_sources_count': 0, 'ignored_discovery': ignored_discovery, 'ignore_config': rules.status() if rules else None}
    if not definitions:
        errors.append({'code': 'empty_scan', 'message': '未找到模块定义，不能视为检查通过'})
    for file in definitions:
        count += 1
        module = file.parent.relative_to(root).as_posix()
        try:
            data = read_json(file)
            if not isinstance(data, dict) or not isinstance(data.get('sources'), list):
                raise ValueError('sources 必须为数组')
        except (OSError, ValueError) as exc:
            errors.append({'code': 'invalid_definition', 'module': module, 'message': str(exc)})
            continue
        for index, source in enumerate(data['sources']):
            try:
                if not isinstance(source, dict):
                    raise ValueError('source 必须为对象')
                key = source_key(root, source.get('location'))
                if not isinstance(source.get('scope'), str) or not source['scope'].strip():
                    raise ValueError('scope 必须为非空字符串')
                entry = {'module': module, 'index': index, 'location': source['location'],
                         'scope': source['scope'], 'key': key}
                pattern = rules.match(source['location'], is_directory=(root / source['location'].replace('\\', '/')).is_dir() or source['location'].endswith(('/', '\\')))
                if pattern:
                    ignored_sources.append(dict(entry, **pattern))
                else:
                    entries.append(entry)
            except (ValueError, OSError, RuntimeError) as exc:
                errors.append({'code': 'invalid_source', 'module': module, 'index': index, 'message': str(exc)})
    for i, left in enumerate(entries):
        for right in entries[i + 1:]:
            a, b = left['module'].casefold(), right['module'].casefold()
            related = descendant(a, b) or descendant(b, a)
            if left['key'] == right['key']:
                code = 'duplicate_in_module' if a == b else ('parent_child_duplicate' if related else 'duplicate_across_modules')
                errors.append({'code': code, 'left': left, 'right': right})
            elif descendant(left['key'], right['key']) or descendant(right['key'], left['key']):
                aligned = ((descendant(b, a) and descendant(right['key'], left['key']))
                           or (descendant(a, b) and descendant(left['key'], right['key'])))
                if aligned:
                    containments.append({'code': 'parent_child_containment', 'left': left, 'right': right})
                else:
                    overlaps.append({'code': 'source_overlap', 'severity': 'warning',
                                     'left': left, 'right': right})
    return {'modules': count, 'sources': len(entries), 'errors': errors, 'overlaps': overlaps, 'containments': containments,
            'ignored_sources': ignored_sources, 'ignored_sources_count': len(ignored_sources),
            'ignored_discovery': ignored_discovery, 'ignore_config': rules.status()}


def exit_code(report):
    return 1 if report['errors'] else (2 if report['overlaps'] else 0)


def write_review_report(root, report):
    """Export exact findings for review; never infer scope exclusions or mutate definitions."""
    from collections import Counter
    from skill_runtime import record_dir, save_json
    root = Path(root).resolve()
    folder = record_dir(root, 'source-scope-review')
    save_json(folder / 'sources.json', report)
    lines = ['# Source 工程结构警告清单', '',
             f"检查 {report['modules']} 个模块、{report['sources']} 条 source；"
             f"{len(report['errors'])} 项错误，{len(report['overlaps'])} 项工程结构警告。", '',
             '所有模块和 source 路径均相对项目根；sources 下标从 0 开始。',
             '本清单逐项保留双方声明，不将物理包含关系判定为已确认的职责冲突。'
             '父子或祖先模块的同向目录包含属于正常关系，记录在 JSON containments 中，不计警告；跨分支包含保留为工程结构存量警告，不自动要求迁移源码。', '',
             '## 涉及模块组合', '']
    counts = Counter((x['left']['module'], x['right']['module']) for x in report['overlaps'])
    for (a, b), count in counts.items():
        lines.append(f'- `{a}` ↔ `{b}`：{count} 项')
    for number, item in enumerate(report['overlaps'], 1):
        a, b = item['left'], item['right']
        outer, inner = (a, b) if descendant(b['key'], a['key']) else (b, a)
        lines += ['', f'## {number:02d}. {inner["location"]}', '', f'检测类型：`{item["code"]}`', '']
        for label, entry in [('外层声明', outer), ('内层声明', inner)]:
            definition = root / entry['module'] / 'module.json'
            lines += [f'**{label}**', '',
                      f'- 模块：`{entry["module"]}`',
                      f'- 定义：[module.json](<{definition.as_posix()}>)，`sources[{entry["index"]}]`',
                      f'- source：`{entry["location"]}`',
                      f'- scope：{entry["scope"]}', '']
        question = ('同一模块同时声明父范围与子范围；核实子项是否只作说明、是否应合并声明，以及外层 scope 是否排除了内层。'
                    if a['module'] == b['module'] else
                    '跨分支或层级方向不一致的目录包含属于工程结构警告；保留双方实际维护边界，不自动移动源码或改变模块树。')
        lines += ['警告说明：' + question]
    if report['errors']:
        lines += ['', '## 另行处理的错误', '', '```json',
                  json.dumps(report['errors'], ensure_ascii=False, indent=2), '```']
    path = folder / 'source-review.md'
    path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return {'markdown': str(path), 'json': str(folder / 'sources.json')}


def main(argv=None):
    parser = argparse.ArgumentParser(description='只读检查模块 source 重复声明与包含范围')
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--json', action='store_true', help='输出完整结构化检查结果')
    parser.add_argument('--report', action='store_true', help='同时在本地任务记录导出逐项 Markdown 清单和 JSON，不修改模块')
    args = parser.parse_args(argv)
    result = check(args.root)
    if args.report:
        result['report'] = write_review_report(args.root, result)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"检查 {result['modules']} 个模块、{result['sources']} 条源：{len(result['errors'])} 项错误，{len(result['overlaps'])} 项工程结构警告。")
        print(f"ignore 配置：{result['ignore_config']}；忽略 {result['ignored_sources_count']} 条源，跳过 {len(result['ignored_discovery'])} 处扫描路径。")
        for item in result['ignored_sources'] + result['ignored_discovery']:
            print(f"[ignored] {item.get('module', '')} {item['location']} ({item['pattern']})")
        for item in result['errors'] + result['overlaps']:
            if 'left' in item:
                a, b = item['left'], item['right']
                print(f"[{item['code']}] {a['module']} sources[{a['index']}] {a['location']} <-> {b['module']} sources[{b['index']}] {b['location']}")
            else:
                print(f"[{item['code']}] {item.get('module', '')}: {item['message']}")
        if result['overlaps']:
            print('跨分支及同模块包含保留为工程结构警告；正常父子包含不报警，不据警告自动迁移源码。')
        if args.report:
            print('逐项清单：' + result['report']['markdown'])
    return exit_code(result)


if __name__ == '__main__':
    raise SystemExit(main())
