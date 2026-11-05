"""Snapshot and verify explicitly selected files; never restore or change inputs."""
import argparse
from datetime import datetime
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts'))
from skill_runtime import project_root, inside, digest, record_dir, save_json, emit
from maintain_registries import read_json


def snapshot(root, paths):
    if not paths:
        raise ValueError('至少提供一个 --path；不默认快照整个项目')
    selected = sorted({inside(root, path) for path in paths})
    if any(not path.is_file() for path in selected):
        raise ValueError('--path 仅接受明确的文件路径')
    record = record_dir(root, 'file-baseline')
    entries = []
    for path in selected:
        relative = path.relative_to(root)
        target = record / 'snapshot' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(path.read_bytes())
        entries.append({'path': relative.as_posix(), 'sha256': digest(target),
                        'snapshot': target.relative_to(record).as_posix()})
    manifest = {'version': 1, 'root': str(root), 'created': datetime.now().astimezone().isoformat(),
                'files': entries, 'scope': '仅检查显式选中的文件，不检测范围外新增文件'}
    save_json(record / 'manifest.json', manifest)
    return {'manifest': str(record / 'manifest.json'), 'files': len(entries)}


def verify(root, manifest_path):
    manifest_path = inside(root, manifest_path)
    manifest = read_json(manifest_path)
    if manifest.get('version') != 1 or manifest.get('root') != str(root) or not manifest.get('files'):
        raise ValueError('基线版本、项目根或文件清单无效')
    results = []
    for item in manifest['files']:
        old = inside(manifest_path.parent, item['snapshot'])
        if digest(old) != item['sha256']:
            raise ValueError(f'历史快照被修改：{item["snapshot"]}')
        current = inside(root, item['path'], must_exist=False)
        status = ('missing' if not current.is_file() else
                  'unchanged' if digest(current) == item['sha256'] else 'changed')
        results.append({'path': item['path'], 'status': status})
    return {'files': results, 'unchanged': all(r['status'] == 'unchanged' for r in results),
            'scope': manifest['scope']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path)
    sub = parser.add_subparsers(dest='operation', required=True)
    sub.add_parser('snapshot').add_argument('--path', action='append', required=True)
    sub.add_parser('verify').add_argument('--manifest', required=True, help='项目相对路径')
    args = parser.parse_args(argv)
    try:
        root = project_root(args.root)
        if args.operation == 'snapshot':
            emit(snapshot(root, args.path)); return 0
        result = verify(root, args.manifest)
        emit(result); return 0 if result['unchanged'] else 2
    except (OSError, ValueError, KeyError, TypeError) as exc:
        emit({'error': str(exc)}); return 1


if __name__ == '__main__':
    raise SystemExit(main())
