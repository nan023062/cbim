"""Explicit-user-request-only wrapper around the authoritative core checker."""
import argparse
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts'))
from skill_runtime import project_root, record_dir, run_python, save_json, emit


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path)
    parser.add_argument('--user-requested', action='store_true', help='仅在用户明确要求 Core 检查时使用；参数本身不构成授权')
    args = parser.parse_args(argv)
    if not args.user_requested:
        emit({'error': '仅用户明确发起 Core 检查时可执行；需传 --user-requested'}); return 1
    try:
        root = project_root(args.root)
        record = record_dir(root, 'core-check')
        shared = Path(__file__).resolve().parents[3] / 'scripts'
        checks = [run_python(shared/'check_core_dependencies.py',
                             ['--core', shared.parent, '--root', root], root, record, 'core'),
                  run_python(shared/'team_skills.py', ['--root', root, '--check'],
                             root, record, 'team-skills')]
        result = {'record': str(record), 'checks': checks,
                  'exit_code': 0 if all(c['exit_code'] == 0 for c in checks) else 1,
                  'scope': '分层依赖、README/docs 隔离及 Team Skill 完整继承；自然语言加载与专业归属仍需人工复核'}
        save_json(record/'result.json', result)
        emit(result); return result['exit_code']
    except (OSError, ValueError, KeyError, TypeError) as exc:
        emit({'error': str(exc)}); return 1


if __name__ == '__main__':
    raise SystemExit(main())
