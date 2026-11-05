"""Create one owned Workflow or Agent Skill; never infer method content."""
import argparse
import json
import os
from pathlib import Path
import re
import tempfile

from maintain_registries import read_definition
from skill_runtime import project_root, inside, emit


def create(root, owner, slug, name, content, kind, purpose=None, write=False):
    root = Path(root).resolve()
    if kind not in ('workflow', 'skill'):
        raise ValueError('未知方法类型')
    pattern = r'[a-z][a-z0-9]*(?:_[a-z0-9]+)*' if kind == 'workflow' else r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*'
    if not re.fullmatch(pattern, slug) or len(slug) > 64:
        raise ValueError('目录名称格式无效')
    if not name.strip() or not content.strip() or (kind == 'skill' and not (purpose or '').strip()):
        raise ValueError('名称、正文与 Skill 用途不得为空')
    if kind == 'skill':
        lines = content.splitlines()
        if not lines or lines[0] != '---' or '---' not in lines[1:]:
            raise ValueError('SKILL.md 缺少 YAML frontmatter')
        header = lines[1:lines[1:].index('---') + 1]
        fields = dict(line.split(':', 1) for line in header if ':' in line)
        if fields.get('name', '').strip().strip('\"\'') != slug or not fields.get('description', '').strip():
            raise ValueError('Skill frontmatter 须包含与目录一致的 name 和非空 description')
        if not '\n'.join(lines[len(header)+2:]).strip():
            raise ValueError('Skill 方法正文不能为空')
    folder = inside(root, owner)
    shared = kind == 'skill' and not (folder / 'agent.json').exists()
    definition = folder / ('module.json' if kind == 'workflow' else 'skills.json' if shared else 'agent.json')
    if definition.is_symlink() or definition.resolve() != definition:
        raise ValueError('定义不得通过链接重定向')
    object_kind = 'modules' if kind == 'workflow' else 'agents'
    if shared:
        from team_skills import team_tree, inventory
        teams, _ = team_tree(root)
        if folder not in teams:
            raise ValueError('共享 Skill 的 owner 必须是 Team 树中的已有节点')
        inventory(root, folder)
        data = json.loads(definition.read_text(encoding='utf-8-sig')) if definition.exists() else {'skills': []}
    else:
        data = read_definition(root, definition, object_kind)
    before = definition.read_bytes() if definition.exists() else None
    field, entry_name = ('workflows', 'workflow.md') if kind == 'workflow' else ('skills', 'SKILL.md')
    destination = folder / field / slug
    if destination.resolve() != destination or destination.exists():
        raise ValueError('目标目录已存在或通过链接重定向；不覆盖')
    reference = f'{field}/{slug}/{entry_name}'
    if any(item['name'] == name or item['reference'] == reference for item in data[field]):
        raise ValueError('名称或入口已登记；不重复创建')
    item = dict(name=name, reference=reference)
    if kind == 'skill':
        item['purpose'] = purpose
    data[field].append(item)
    result = dict(mode='write' if write else 'preview', owner=owner, entry=reference, item=item)
    if not write:
        return result
    if (definition.read_bytes() if definition.exists() else None) != before:
        raise ValueError('定义已变化，请重新读取后创建')
    container_existed = destination.parent.exists()
    destination.parent.mkdir(exist_ok=True)
    destination.mkdir(exist_ok=False)
    entry = destination / entry_name
    temporary = None
    installed = False
    after = (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    try:
        with entry.open('x', encoding='utf-8') as stream:
            stream.write(content)
        with tempfile.NamedTemporaryFile(dir=folder, prefix='.method-', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(after)
        if (definition.read_bytes() if definition.exists() else None) != before:
            raise ValueError('定义已变化，取消登记')
        os.replace(temporary, definition)
        installed = True
        if kind == 'skill':
            from team_skills import validate_tree
            validate_tree(root)
        if not shared:
            read_definition(root, definition, object_kind)
    except Exception:
        if installed:
            if definition.read_bytes() != after:
                raise ValueError('失败后检测到并发修改，保留当前文件供核对，不覆盖他人变更')
            if before is None:
                definition.unlink()
            else:
                definition.write_bytes(before)
        if entry.exists():
            entry.unlink()
        destination.rmdir()
        if not container_existed:
            destination.parent.rmdir()
        raise
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    return result


def main(kind, argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path)
    parser.add_argument('--owner', required=True)
    parser.add_argument('--slug', required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--content', required=True, type=Path)
    if kind == 'skill':
        parser.add_argument('--purpose', required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args(argv)
    try:
        result = create(project_root(args.root), args.owner, args.slug, args.name,
                        args.content.read_text(encoding='utf-8-sig'), kind,
                        getattr(args, 'purpose', None), args.write)
        emit(result)
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        emit({'error': str(error)})
        return 1
