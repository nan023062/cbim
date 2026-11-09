"""Build definition indexes from definitions; no network/model calls or inferred expertise.

summary: 100-250 non-whitespace Unicode characters describing responsibilities,
scope, mechanisms and useful search terms. An Agent must author the summary after
semantic analysis; this script only validates and indexes it, never extracts prose.

Every id is a POSIX-style directory path relative to the project root (the
directory containing .cbim/), never to the registry location or current directory.
The root defaults to the current working directory; --root overrides it.
"""
import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from ignore_rules import IgnoreRules, source_key
try:
    from jsonschema import Draft202012Validator
except ImportError:
    raise SystemExit('缺少 jsonschema；请运行 python -m pip install -r core.src/scripts/requirements.txt')

SPECS = (
    ('agents', '.cbim/team', 'agent.json', '.cbim/team/registry.json'),
    ('modules', '.cbim/workspace', 'module.json', '.cbim/workspace/registry.json'),
)
EXCLUDED = {'archive', '_unassigned', 'dna', 'workflows', 'skills',
            'client_debug', 'clinet-debug', '__pycache__', '.git'}
MIN_SUMMARY_LENGTH = 100
MAX_SUMMARY_LENGTH = 250


class RegistryError(ValueError):
    pass


def validate_summary(summary, source):
    if not isinstance(summary, str) or not summary.strip():
        raise RegistryError(f'{source}: summary 不能为空')
    if summary != summary.strip() or '\n' in summary or '\r' in summary:
        raise RegistryError(f'{source}: summary 必须是无首尾空白的单行文本')
    length = len(re.sub(r'\s', '', summary))
    if not MIN_SUMMARY_LENGTH <= length <= MAX_SUMMARY_LENGTH:
        raise RegistryError(f'{source}: summary 为 {length} 字，须为 {MIN_SUMMARY_LENGTH}～{MAX_SUMMARY_LENGTH} 字（不计空白）；请依据正文补充或提炼检索信息')
    if summary.casefold() in {'todo', 'tbd', '待补充', '待填写', '暂无', '...'}:
        raise RegistryError(f'{source}: summary 不能使用占位内容')
    return summary


def unique_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RegistryError(f'JSON 字段重复：{key}')
        result[key] = value
    return result


def read_json(path):
    try:
        return json.loads(path.read_text(encoding='utf-8-sig'), object_pairs_hook=unique_fields)
    except (ValueError, RegistryError) as error:
        raise RegistryError(f'{path}: {error}') from error


def local_reference(root, base, reference):
    """Resolve knowledge references relative to the owning JSON, within project."""
    location = reference.split('#', 1)[0]
    if not location or Path(location).is_absolute() or re.match(r'^[A-Za-z]+:', location):
        raise RegistryError(f'{base}: 引用须为项目内相对路径：{reference}')
    target = (base / location).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise RegistryError(f'{base}: 引用不存在或越界：{reference}')
    return target


def is_legacy_module(data):
    # Mixed old/new definitions must fail the new schema, never fall back.
    return isinstance(data, dict) and not any(k in data for k in ('id', 'children', 'overview', 'workflow'))


def validate_flat_module(root, path, data):
    expected_id = path.parent.relative_to(root).as_posix()
    if data['id'] != expected_id:
        raise RegistryError(f'{path}: id 必须与模块目录一致：{expected_id}')
    children = {p.parent.relative_to(root).as_posix() for p in discover(root, expected_id, 'module.json', apply_ignore=False)
                if p.parent.parent == path.parent}
    if set(data['children']) != children:
        raise RegistryError(f'{path}: children 必须完整列出直属子模块；预期 {sorted(children)}')
    for old in ('dna',):
        if (path.parent / old).exists():
            raise RegistryError(f'{path}: 新格式不能保留旧 {old}/ 目录')
    overview = local_reference(root, path.parent, data['overview'])
    text = overview.read_text(encoding='utf-8-sig')
    # Parse fenced blocks before headings, so example headings do not satisfy sections.
    sections, diagrams, current = [], [], None
    bodies = {}
    fence, block, block_section = None, [], None
    title_seen = False
    for line in text.splitlines():
        if fence:
            if re.fullmatch(r'\s*' + re.escape(fence[0]) + '{' + str(len(fence)) + r',}\s*', line):
                if block and block[0].strip().casefold() == 'mermaid':
                    diagrams.append((block_section, '\n'.join(block[1:])))
                fence, block = None, []
            else:
                block.append(line)
            continue
        opening = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', line)
        if opening:
            fence, block, block_section = opening[1], [opening[2].strip()], current
            continue
        if re.match(r'^ {0,3}#[ \t]+', line):
            if title_seen or current is not None:
                raise RegistryError(f'{overview}: 一级标题仅允许在正文前出现一次')
            title_seen = True
            continue
        heading = re.match(r'^ {0,3}##[ \t]+(.+?)\s*#*\s*$', line)
        if heading:
            current = heading[1]
            sections.append(current)
            bodies.setdefault(current, [])
        elif re.match(r'^ {0,3}#{3,6}[ \t]+', line):
            if current != '子模块和 source 节点':
                raise RegistryError(f'{overview}: 不允许额外章节；三级及更深标题仅用于节点说明')
            label = re.sub(r'^\s*#{3,6}\s+', '', line).strip().strip('`')
            allowed = {'子模块', 'Source 路径与维护说明'} | {s['location'] for s in data['sources']}
            if label not in allowed:
                raise RegistryError(f'{overview}: 节点章节不允许额外标题：{label}')
        elif current and line.strip():
            bodies[current].append(line.strip())
    if fence:
        raise RegistryError(f'{overview}: 存在未闭合代码块')
    current_sections = ['定位', '子模块和 source 节点', '结构关系图与抽象设计决策', '雷区与排障', '观察模式-待抽象']
    if sections != current_sections:
        raise RegistryError(f'{overview}: 章节必须严格按序为 {current_sections}；不允许额外章节或旧格式')
    if any(not bodies.get(name) for name in sections):
        raise RegistryError(f'{overview}: 知识正文不得留空；没有实际内容时写“无”')
    diagram_section = current_sections[2]
    if (len(diagrams) != 1 or diagrams[0][0] != diagram_section
            or not re.match(r'^\s*classDiagram(?:\s|$)', diagrams[0][1])
            or not diagrams[0][1].strip().removeprefix('classDiagram').strip()):
        raise RegistryError(f'{overview}: {diagram_section}章节须有且仅有一张非空 mermaid classDiagram')
    displays_id = any(re.match(r'^#{1,6}\s+', line) and
                      re.search(r'(?<![\w/])' + re.escape(expected_id) + r'(?![\w/-])', line)
                      for line in text.splitlines())
    if displays_id or re.search(r'(?im)^\s*(?:#{1,6}\s+|[-*]\s+)?(?:id|sources|children|summary)\s*[:：=]', text):
        raise RegistryError(f'{overview}: 不得重复显示模块 id 或索引字段')
    if (path.parent / 'workflow.md').exists():
        raise RegistryError(f'{path}: 工作流须迁入 workflows/<名称>/workflow.md')
    folder = path.parent / 'workflows'
    referenced = []
    names = []
    for item in data['workflows']:
        target = local_reference(root, path.parent, item['reference'])
        expected = path.parent.resolve() / item['reference']
        if target != expected or not item['name'].strip():
            raise RegistryError(f'{path}: 工作流名称不能为空，引用不得通过链接重定向')
        if not target.read_text(encoding='utf-8-sig').strip():
            raise RegistryError(f'{target}: 工作流正文不能为空')
        referenced.append(target)
        names.append(item['name'])
    actual = set()
    if folder.exists():
        if not folder.is_dir():
            raise RegistryError(f'{folder}: 必须为工作流目录')
        for child in folder.iterdir():
            if not child.is_dir() or not re.fullmatch(r'[a-z][a-z0-9]*(?:_[a-z0-9]+)*', child.name):
                raise RegistryError(f'{child}: 每个工作流必须使用独立的小写 snake_case 目录')
            entry = child / 'workflow.md'
            if not entry.is_file():
                raise RegistryError(f'{child}: 缺少 workflow.md 入口')
            actual.add(entry.resolve())
    if (len(names) != len(set(names)) or len(referenced) != len(set(referenced))
            or set(referenced) != actual):
        raise RegistryError(f'{path}: workflows 清单存在重复、遗漏或非入口文件')


def read_definition(root, path, kind, allow_legacy=False):
    data = read_json(path)
    legacy = kind == 'modules' and is_legacy_module(data)
    if legacy and not allow_legacy:
        raise RegistryError(f'{path}: 旧 Module 格式待迁移；临时兼容校验须显式使用 --allow-legacy')
    schema_path = Path(__file__).resolve().parents[1] / (
        {'agents': 'capability/agent.schema.json', 'modules': 'business/module.schema.json'}[kind])
    if legacy:
        schema_path = schema_path.with_name('module.legacy.schema.json')
    errors = sorted(Draft202012Validator(read_json(schema_path)).iter_errors(data), key=lambda e: str(e.path))
    if errors:
        error = errors[0]
        raise RegistryError(f'{path}: JSON 结构不符合规范，字段 {list(error.path)}：{error.message}')
    validate_summary(data['summary'], path)
    if kind == 'agents':
        local_reference(root, path.parent, data['work_principles'])
        inventories = [('skills', 'SKILL.md')]
    else:
        if legacy:
            local_reference(root, path.parent, data['boundaries'])
            inventories = [('dna', '*.md'), ('workflows', '*.md')]
        else:
            validate_flat_module(root, path, data)
            inventories = []
        rules = IgnoreRules(root)
        for source in data['sources']:
            try:
                source_key(root, source['location'])
                if not source['scope'].strip():
                    raise ValueError('scope 必须为非空字符串')
            except (ValueError, OSError, RuntimeError) as exc:
                raise RegistryError(f'{path}: 无效物理工作区源：{exc}') from exc
            location = source['location']
            ignored = rules.match(location, is_directory=(root / location.replace('\\', '/')).is_dir() or location.endswith(('/', '\\')))
            if ignored:
                raise RegistryError(f"{path}: sources 不得单独登记 .cbimignore 忽略路径 {location}；请移除声明（规则第 {ignored['line']} 行：{ignored['pattern']}），不删除实体文件")
    for field, pattern in inventories:
        folder = (path.parent / field).resolve()
        referenced = []
        for item in data[field]:
            target = local_reference(root, path.parent, item['reference'])
            if not target.is_relative_to(folder):
                raise RegistryError(f'{path}: {field} 只能引用自身目录下的内容')
            referenced.append(target)
        actual = {p.resolve() for p in folder.rglob(pattern)} if folder.exists() else set()
        if len(referenced) != len(set(referenced)) or set(referenced) != actual:
            raise RegistryError(f'{path}: {field} 列表存在重复、遗漏或非入口文件')
    return data


def discover(root, folder, filename, *, rules=None, ignored=None, apply_ignore=None):
    # .cbimignore limits automatic module indexing, not all CBIM access.
    if apply_ignore is None:
        apply_ignore = filename == 'module.json'
    rules = rules if rules is not None else IgnoreRules(root)
    base = root / folder
    if not base.is_dir():
        raise RegistryError(f'{folder}: 定义目录不存在')
    initial = rules.match(base.relative_to(root).as_posix(), is_directory=True) if apply_ignore else None
    if initial:
        if ignored is not None:
            ignored.append(dict(location=base.relative_to(root).as_posix(), **initial))
        return
    for current, directories, files in os.walk(base, followlinks=False):
        directories[:] = sorted(d for d in directories
                                if d.casefold() not in EXCLUDED
                                and not d.startswith('.')
                                and not (Path(current) / d).is_symlink()
                                and not os.path.islink(Path(current) / d))
        for directory in directories[:]:
            relative = (Path(current) / directory).relative_to(root).as_posix()
            match = rules.match(relative, is_directory=True) if apply_ignore else None
            if match:
                directories.remove(directory)
                if ignored is not None:
                    ignored.append(dict(location=relative, **match))
        relative_file = (Path(current) / filename).relative_to(root).as_posix()
        match = rules.match(relative_file) if apply_ignore else None
        if filename in files and match:
            if ignored is not None:
                ignored.append(dict(location=relative_file, **match))
            continue
        legacy = Path(filename).with_suffix('.md').name
        if legacy in files and not (filename == 'module.json' and filename in files):
            raise RegistryError(f'{current}: 仍存在旧定义 {legacy}，请迁移到 {filename}，Markdown 只保留正文')
        if filename in files:
            path = Path(current) / filename
            if path.is_symlink() or not path.resolve().is_relative_to(base.resolve()):
                raise RegistryError(f'{path}: 定义不能指向扫描范围之外')
            yield path


def read_connector_registry(root):
    path = root / '.cbim/connectors/registry.json'
    data = read_json(path)
    schema = read_json(Path(__file__).resolve().parents[1] / 'connector/registry.schema.json')
    errors = list(Draft202012Validator(schema).iter_errors(data))
    if errors:
        raise RegistryError(f'{path}: {errors[0].message}')
    ids, plugins = set(), set()
    for item in data['connectors']:
        key = item['id'].casefold()
        plugin = (item['plugin']['ghost_id'], item['plugin']['namespace'])
        if key in ids or plugin in plugins:
            raise RegistryError(f'{path}: duplicate connector id or plugin identity')
        ids.add(key)
        plugins.add(plugin)
    return data


def build_plan(root, allow_legacy=False, migration_counts=None, discovery_ignored=None):
    from team_skills import validate_tree
    try:
        teams, tree_agents = validate_tree(root)
    except ValueError as error:
        raise RegistryError(str(error)) from error
    rules = IgnoreRules(root)
    registries = {}
    definitions = []
    for kind, folder, filename, output in SPECS:
        entries = []
        for path in discover(root, folder, filename, rules=rules, ignored=discovery_ignored):
            data = read_definition(root, path, kind, allow_legacy=allow_legacy)
            if kind == 'modules' and migration_counts is not None and is_legacy_module(data):
                migration_counts['legacy_modules'] += 1
            definitions.append((path, data))
            entries.append({'id': path.parent.relative_to(root).as_posix(), 'summary': data['summary']})
        if not entries and kind != 'connectors':
            raise RegistryError(f'{folder}: 没有找到定义，拒绝生成空注册表')
        ids = [entry['id'].casefold() for entry in entries]
        if len(ids) != len(set(ids)):
            raise RegistryError(f'{folder}: 目录标识重复（不区分大小写）')
        if kind == 'agents':
            base = root / folder
            groups = {p.relative_to(root).as_posix(): [] for p in teams if p != base}
            for entry in entries:
                parent = (root / entry['id']).parent
                if parent == base:
                    groups.setdefault(folder, [])
                group = parent.relative_to(root).as_posix()
                if group not in groups:
                    raise RegistryError(f'{entry["id"]}: Agent 必须直属 Team')
                groups[group].append(entry)
            registries[root / output] = {'groups': [
                {'id': group, 'agents': sorted(agents, key=lambda e: e['id'])}
                for group, agents in sorted(groups.items())]}
        else:
            registries[root / output] = {kind: sorted(entries, key=lambda e: e['id'])}
    registries[root / '.cbim/connectors/registry.json'] = read_connector_registry(root)
    # 旧 people.json 是历史文件；不读取、重建或用于作者与执行资格校验。
    connector_ids = {item['id'] for item in registries[root / '.cbim/connectors/registry.json']['connectors']}
    for path, data in definitions:
        for connector_id in data.get('connectors', []):
            if connector_id not in connector_ids:
                raise RegistryError(f'{path}: connectors 引用不存在的连接器 id：{connector_id}')
    return registries


def check_registry(path, expected):
    actual = read_json(path)
    if path.parent.name == 'connectors':
        if actual != expected:
            raise RegistryError(f'{path}: plugin declarations changed during validation')
        return
    if path.parent.name == 'team':
        schema = read_json(Path(__file__).resolve().parents[1] / 'capability/registry.schema.json')
        errors = list(Draft202012Validator(schema).iter_errors(actual))
        if errors:
            raise RegistryError(f'{path}: {errors[0].message}')
    kind = next(iter(expected))
    if not isinstance(actual, dict) or set(actual) != {kind}:
        raise RegistryError(f'{path}: 顶层只能包含 {kind}，路径固定相对项目根目录')
    entries = actual[kind]
    if kind == 'groups':
        if not isinstance(entries, list) or any(not isinstance(g, dict) or set(g) != {'id', 'agents'}
                                               or not isinstance(g['id'], str)
                                               or not isinstance(g['agents'], list) for g in entries):
            raise RegistryError(f'{path}: 组记录只能包含 id 和 agents 数组')
        normalized = []
        for group in entries:
            agents = group['agents']
            if any(not isinstance(a, dict) or not isinstance(a.get('id'), str) for a in agents):
                raise RegistryError(f'{path}: Agent 必须包含目录 id')
            normalized.append({'id': group['id'], 'agents': sorted(agents, key=lambda a: a['id'])})
        if sorted(normalized, key=lambda g: g['id']) != expected[kind]:
            raise RegistryError(f'{path}: 组或 Agent 条目与定义不一致，请运行 --write')
        return
    if not isinstance(entries, list) or any(not isinstance(e, dict) or set(e) != {'id', 'summary'} for e in entries):
        raise RegistryError(f'{path}: 每条记录只能包含 id 和 summary')
    for entry in entries:
        if not isinstance(entry['id'], str):
            raise RegistryError(f'{path}: id 必须为目录路径字符串')
        validate_summary(entry['summary'], path)
    if sorted(entries, key=lambda e: e['id']) != expected[kind]:
        raise RegistryError(f'{path}: 存在遗漏、重复、过期条目或摘要不一致，请运行 --write')


def atomic_write(path, text):
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as stream:
            stream.write(text)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def maintain(root, write=False, allow_legacy=False):
    root = Path(root).resolve()
    migration_counts = {'legacy_modules': 0}
    discovery_ignored = []
    registries = build_plan(root, allow_legacy=allow_legacy, migration_counts=migration_counts, discovery_ignored=discovery_ignored)  # Validate before any writes.
    if write:
        for path, data in registries.items():
            if path == root / '.cbim/connectors/registry.json':
                continue  # Authoritative host plugin declarations, not a generated index.
            atomic_write(path, json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    for path, data in registries.items():
        check_registry(path, data)
    return {**migration_counts, 'ignore_config': IgnoreRules(root).status(), 'ignored_discovery': discovery_ignored, 'agents': sum(len(g['agents']) for g in registries[root / '.cbim/team/registry.json']['groups']),
            'modules': len(registries[root / '.cbim/workspace/registry.json']['modules']),
            'connectors': len(registries[root / '.cbim/connectors/registry.json']['connectors'])}


def main():
    parser = argparse.ArgumentParser(description='生成并校验 Agent、Module 与 Connector 的 id/summary 注册表')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--write', action='store_true', help='发现新增定义、校验 Agent 编写的摘要并同步 Agent 与 Module 两个索引；插件声明只校验不重写')
    mode.add_argument('--check', action='store_true', help='只读校验（默认）')
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--allow-legacy', action='store_true', help='显式兼容旧 Module；报告待迁移数量，不代表新版规范通过')
    args = parser.parse_args()
    try:
        counts = maintain(args.root, args.write, allow_legacy=args.allow_legacy)
    except (RegistryError, OSError, ValueError) as error:
        print(f'注册表维护失败：{error}', file=sys.stderr)
        return 1
    print(f"ignore 配置：{counts['ignore_config']}；跳过 {len(counts['ignored_discovery'])} 处扫描路径。")
    for item in counts['ignored_discovery']:
        print(f"[ignored] {item['location']} ({item['pattern']})")
    if counts['legacy_modules']:
        print(f'兼容校验通过；{counts["legacy_modules"]} 个旧 Module 待迁移，不代表新版规范通过。')
    print(f'索引校验通过：{counts["agents"]} 个 Agent，{counts["modules"]} 个模块，{counts["connectors"]} 个连接器。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
