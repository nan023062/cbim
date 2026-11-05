"""Migrate explicitly reviewed file-source groups into directory sources.

The plan supplies ownership and scope; this tool never infers either.
Default is a dry run. Existing directory sources and design diagrams are preserved.
"""
import argparse
import copy
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts'))
from skill_runtime import project_root, modules, record_dir, save_json, digest, emit


def prepare(root, catalog, plan):
    original = {key: data for key, (data, path) in catalog.items()}
    updated = copy.deepcopy(original)
    affected, seen, inserted = set(), set(), set()
    descriptions = {}
    moved = []
    for group in plan['groups']:
        directory, owner = group['directory'], group['owner']
        target = (root / directory).resolve(strict=True)
        if not target.is_relative_to(root) or not target.is_dir() or owner not in catalog:
            raise ValueError(f'目录或 owner 无效：{directory}, {owner}')
        if directory in inserted:
            raise ValueError(f'目录重复计划：{directory}')
        inserted.add(directory)
        if any(s['location'] == directory for d in original.values() for s in d['sources']):
            raise ValueError(f'目录已有声明，须先人工合并计划：{directory}')
        if not group['scope'].strip() or not 0 < len(group['description']) <= 250:
            raise ValueError('scope 不能为空，source 正文须为 1–250 字')
        for entry in group['files']:
            key, location = entry['module'], entry['location']
            pair = (key, location)
            if pair in seen:
                raise ValueError(f'重复文件计划：{pair}')
            seen.add(pair)
            file = (root / location).resolve(strict=True)
            if not file.is_file() or file.parent != target:
                raise ValueError(f'不是该目录直属文件：{location}')
            matches = [s for s in updated[key]['sources'] if s['location'] == location]
            if len(matches) != 1 or matches[0]['scope'] != entry['scope']:
                raise ValueError(f'原声明已变化：{pair}')
            updated[key]['sources'].remove(matches[0])
            affected.add(key)
            moved.append({'old_module': key, 'path': location, 'new_module': owner,
                          'directory': directory, 'sha256': digest(file)})
        updated[owner]['sources'].append({'location': directory, 'scope': group['scope']})
        descriptions[directory] = group['description']
        affected.add(owner)
    current = {(k, s['location']) for k, d in original.items() for s in d['sources']
               if (root / s['location']).is_file()}
    if current != seen:
        raise ValueError(f'计划未精确覆盖文件级 source：缺少 {current-seen}，多出 {seen-current}')
    outputs = {}
    for key in sorted(affected):
        definition = catalog[key][1]
        path = definition.parent / 'module.md'
        text = path.read_text(encoding='utf-8')
        start = text.index('## 子模块和 source 节点')
        end = text.index('## 结构关系图与抽象设计决策', start)
        section = text[start:end]
        old_locations = {s['location'] for s in original[key]['sources']}
        headings = [m for m in re.finditer(r'^#{3,4} ([^\r\n]+)$', section, re.M)
                    if m[1].strip().strip('`') in old_locations]
        blocks = {}
        for n, heading in enumerate(headings):
            stop = headings[n+1].start() if n+1 < len(headings) else len(section)
            blocks[heading[1].strip().strip('`')] = section[heading.start():stop].rstrip()
        if set(blocks) != old_locations:
            raise ValueError(f'{key} source 正文不能唯一匹配清单')
        intro = section[:headings[0].start()] if headings else section
        newblocks = []
        for source in updated[key]['sources']:
            location = source['location']
            if location in descriptions:
                newblocks.append(f'#### `{location}`\n\n{descriptions[location]}')
            else:
                newblocks.append(blocks[location])
        notice = plan.get('notices', {}).get(key, '')
        if notice:
            intro = intro.replace('### Source 路径与维护说明', notice + '\n\n### Source 路径与维护说明')
        newtext = text[:start] + intro.rstrip() + '\n\n' + '\n\n'.join(newblocks) + '\n\n' + text[end:]
        outputs[path] = newtext
        outputs[definition] = json.dumps(updated[key], ensure_ascii=False, indent=2) + '\n'
    return outputs, moved


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    try:
        root = project_root(args.root)
        plan = json.loads(args.plan.read_text(encoding='utf-8'))
        catalog = modules(root)
        outputs, moved = prepare(root, catalog, plan)
        record = record_dir(root, 'file-source-migration')
        before = {p: p.read_bytes() for p in outputs}
        save_json(record/'baseline.json', {p.relative_to(root).as_posix(): b.decode('utf-8') for p, b in before.items()})
        save_json(record/'plan.json', plan)
        save_json(record/'files.json', moved)
        if args.write:
            if any(p.read_bytes() != b for p, b in before.items()):
                raise ValueError('写入前基线发生变化')
            for p, content in outputs.items():
                p.write_text(content, encoding='utf-8')
        result = {'file_sources': len(moved), 'directory_sources': len(plan['groups']),
                  'modules': len(outputs)//2, 'write': args.write, 'record': str(record)}
        save_json(record/'result.json', result)
        emit(result)
        return 0
    except (OSError, ValueError, KeyError) as error:
        emit({'error': str(error)})
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
