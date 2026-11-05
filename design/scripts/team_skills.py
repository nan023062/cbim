"""Validate the Team directory tree and resolve inherited Skill catalogs."""
import argparse
import hashlib
import json
from pathlib import Path

from jsonschema import Draft202012Validator

RESERVED = {'skills', 'references', 'assets', 'scripts', 'archive', '_unassigned', '__pycache__'}


def checked(path, root):
    path = Path(path).absolute()
    if path.resolve() != path or not path.is_relative_to(root):
        raise ValueError(f'路径越界或通过链接重定向：{path}')
    return path


def team_tree(root):
    """Directories are Teams; agent.json marks a leaf, never a Team."""
    root = Path(root).resolve()
    base = checked(root / '.cbim/team', root)
    teams, agents = [], []

    def walk(folder):
        checked(folder, base)
        if (folder / 'agent.json').exists():
            if folder == base:
                raise ValueError('team 根不能定义为 Agent')
            agents.append(folder)
            for child in folder.rglob('agent.json'):
                if child.parent != folder:
                    raise ValueError(f'Agent 不能包含其他 Agent：{child}')
            return
        teams.append(folder)
        for child in sorted(folder.iterdir()):
            if child.name.startswith('.') or child.name.casefold() in RESERVED:
                continue
            if child.is_symlink() or (child.exists() and child.resolve() != child.absolute()):
                raise ValueError(f'Team 树不允许链接：{child}')
            if child.is_dir():
                walk(child)
    walk(base)
    return teams, agents


def inventory(root, owner, agent=False):
    from maintain_registries import read_json
    owner = checked(owner, root / '.cbim/team')
    definition = owner / ('agent.json' if agent else 'skills.json')
    if definition.exists():
        checked(definition, owner)
        data = read_json(definition)
        if agent:
            data = {'skills': data['skills']}
    else:
        if agent:
            raise ValueError(f'缺少 Agent 定义：{definition}')
        data = {'skills': []}
    schema = json.loads((Path(__file__).resolve().parents[1] / 'capability/team-skills.schema.json').read_text(encoding='utf-8'))
    errors = list(Draft202012Validator(schema).iter_errors(data))
    if errors:
        raise ValueError(f'{definition}: {errors[0].message}')
    folder = checked(owner / 'skills', owner)
    result, paths, names = [], set(), set()
    for item in data['skills']:
        ref = item['reference']
        path = checked(owner / ref, folder)
        if not path.is_file() or path.name != 'SKILL.md':
            raise ValueError(f'无效 Skill 入口：{path}')
        key = item['name'].casefold()
        if key in names or path in paths:
            raise ValueError(f'重复 Skill：{definition}: {item["name"]}')
        names.add(key)
        paths.add(path)
        result.append({**item, 'reference': path.relative_to(root).as_posix(),
                       'owner': owner.relative_to(root).as_posix(),
                       'scope': 'agent' if agent else 'team',
                       'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    actual = set()
    if folder.exists():
        for path in folder.rglob('*'):
            checked(path, folder)
            if path.name == 'SKILL.md' and path.is_file():
                actual.add(path)
    if actual != paths:
        raise ValueError(f'{definition}: skills 清单与实际入口不一致：{sorted(str(p) for p in actual ^ paths)}')
    return result


def resolve(root, agent):
    root = Path(root).resolve()
    base = root / '.cbim/team'
    owner = checked(root / agent, base)
    teams, agents = team_tree(root)
    if owner not in agents:
        raise ValueError(f'不是树中的 Agent：{owner}')
    chain = [owner]
    parent = owner.parent
    while True:
        if parent not in teams:
            raise ValueError(f'非法 Team 祖先：{parent}')
        chain.append(parent)
        if parent == base:
            break
        parent = parent.parent
    skills, seen = [], {}
    for i, folder in enumerate(chain):
        for item in inventory(root, folder, agent=i == 0):
            key = item['name'].casefold()
            slug = Path(item['reference']).parent.name.casefold()
            for identity in ('name:' + key, 'slug:' + slug):
                if identity in seen:
                    raise ValueError(f'Skill 继承冲突：{item["reference"]} 与 {seen[identity]}')
                seen[identity] = item['reference']
            skills.append(item)
    return {'agent': owner.relative_to(root).as_posix(),
            'chain': [p.relative_to(root).as_posix() for p in chain], 'skills': skills}


def validate_tree(root):
    root = Path(root).resolve()
    teams, agents = team_tree(root)
    for team in teams:
        inventory(root, team)
    for agent in agents:
        resolve(root, agent)
    return teams, agents


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--agent')
    mode.add_argument('--check', action='store_true', help='只读校验完整 Team 树并输出所有 Agent 的继承清单')
    args = parser.parse_args()
    try:
        if args.check:
            root = args.root.resolve()
            teams, agents = validate_tree(root)
            result = {'teams': [p.relative_to(root).as_posix() for p in teams],
                      'catalogs': [resolve(root, p) for p in agents],
                      'scope': 'Team 树、各层 Skill 清单、完整继承链和冲突；不证明专业方法归属或实际运行正确'}
        else:
            result = resolve(args.root, args.agent)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, OSError, KeyError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
