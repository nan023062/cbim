"""Shared deterministic I/O for Skill tools; no workflow routing or decisions."""
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

from maintain_registries import discover, read_json


def project_root(value=None):
    root = Path(value).resolve(strict=True) if value else Path.cwd().resolve(strict=True)
    if not (root / '.cbim/workspace').is_dir():
        raise ValueError('项目根下缺少 .cbim/workspace')
    return root


def inside(root, relative, must_exist=True):
    root = Path(root).resolve()
    value = Path(relative)
    if value.is_absolute() or '..' in value.parts:
        raise ValueError(f'路径必须相对项目且不能越界：{relative}')
    target = (root / value).resolve(strict=must_exist)
    if not target.is_relative_to(root):
        raise ValueError(f'链接目标越界：{relative}')
    return target


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def modules(root):
    result = {}
    for path in discover(root, '.cbim/workspace', 'module.json', apply_ignore=False):
        data = read_json(path)
        key = path.parent.relative_to(root).as_posix()
        if data.get('id') != key or key in result:
            raise ValueError(f'模块 id 与路径不一致或重复：{key}')
        result[key] = (data, path)
    if not result:
        raise ValueError('没有有效模块，不能视为检查通过')
    return result


def record_dir(root, label):
    directory = root / '.cbim.local/task-records'
    directory.mkdir(parents=True, exist_ok=True)
    stem = datetime.now().strftime('%Y-%m-%d_%H-%M-%S_%f') + '_' + label
    suffix = 0
    while True:
        target = directory / (stem + (f'_{suffix}' if suffix else ''))
        try:
            target.mkdir(exist_ok=False)
            return target
        except FileExistsError:
            suffix += 1


def save_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def emit(value):
    print(json.dumps(value, ensure_ascii=False, indent=2))


def run_python(script, args, root, record, name):
    script = Path(script).resolve(strict=True)
    command = [sys.executable, '-B', str(script), *map(str, args)]
    result = subprocess.run(command, cwd=root, capture_output=True,
                            env=dict(os.environ, PYTHONIOENCODING='utf-8'))
    (record / (name + '.stdout.txt')).write_bytes(result.stdout)
    (record / (name + '.stderr.txt')).write_bytes(result.stderr)
    return {'check': name, 'command': command, 'exit_code': result.returncode,
            'stdout': str(record / (name + '.stdout.txt')),
            'stderr': str(record / (name + '.stderr.txt'))}
