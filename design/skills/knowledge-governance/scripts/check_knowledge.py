"""Run existing knowledge checks, preserving receipts and nonzero outcomes."""
import argparse
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts'))
from skill_runtime import project_root, record_dir, run_python, save_json, emit


def run(root, write=False, coverage=False):
    record = record_dir(root, 'knowledge-check')
    shared = Path(__file__).resolve().parents[3] / 'scripts'
    results = []
    results.append(run_python(shared/'team_skills.py', ['--root', root, '--check'], root, record, 'team-skills'))
    result = run_python(shared/'maintain_registries.py',
                        ['--root', root, '--write' if write else '--check'], root, record, 'registry')
    results.append(result)
    if write and result['exit_code'] == 0:
        results.append(run_python(shared/'maintain_registries.py', ['--root', root, '--check'], root, record, 'registry-recheck'))
    results.append(run_python(shared/'check_module_sources.py', ['--root', root, '--json', '--report'], root, record, 'sources'))
    if coverage:
        results.append(run_python(Path(__file__).with_name('scan_orphan_files.py'), ['--root', root], root, record, 'coverage'))
    errors = any(r['exit_code'] not in ((0, 2) if r['check'] in ('sources', 'coverage') else (0,)) for r in results)
    code = 1 if errors else 2 if any(r['exit_code'] == 2 for r in results) else 0
    report = {'record': str(record), 'checks': results, 'exit_code': code,
              'coverage_requested': coverage, 'registry_write_requested': write,
              'scope': '包含完整 Team 树与 Skill 继承检查；未启用 coverage 时不包含文件覆盖结论；机器检查不替代语义复核；不运行 Core Check'}
    save_json(record/'result.json', report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path)
    parser.add_argument('--write', action='store_true', help='已有维护授权时显式重建索引，默认只读')
    parser.add_argument('--include-file-coverage', action='store_true', help='同时执行全项目文件遍历；模块治理需启用或引用同版本覆盖回执')
    args = parser.parse_args(argv)
    try:
        result = run(project_root(args.root), args.write, args.include_file_coverage)
        emit(result); return result['exit_code']
    except (OSError, ValueError, KeyError, TypeError) as exc:
        emit({'error': str(exc)}); return 1


if __name__ == '__main__':
    raise SystemExit(main())
