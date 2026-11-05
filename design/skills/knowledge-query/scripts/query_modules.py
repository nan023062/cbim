"""Read-only lexical module lookup, with source paths and content fingerprints."""
import argparse
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts'))
from skill_runtime import project_root, modules, inside, digest, emit


def query(root, text='', module_id=None, limit=10):
    if limit < 1 or (not text.strip() and not module_id):
        raise ValueError('须提供非空 query 或 module，limit 必须大于零')
    tokens = sorted(set(text.casefold().split()))
    found = []
    definitions = modules(root)
    if module_id and module_id not in definitions:
        raise ValueError(f'模块不存在：{module_id}')
    for key, (data, definition) in definitions.items():
        if module_id and key != module_id:
            continue
        haystack = ' '.join((key, data.get('name', ''), data.get('summary', ''))).casefold()
        matched = [token for token in tokens if token in haystack]
        if not module_id and not matched:
            continue
        overview = inside(root, definition.parent.relative_to(root) / data['overview'])
        content = overview.read_text(encoding='utf-8-sig')
        excerpts = [{'line': i, 'text': line} for i, line in enumerate(content.splitlines(), 1)
                    if tokens and any(t in line.casefold() for t in tokens)][:5]
        found.append({'id': key, 'name': data['name'], 'summary': data['summary'],
                      'matched_terms': matched, 'definition': str(definition),
                      'definition_sha256': digest(definition), 'overview': str(overview),
                      'overview_sha256': digest(overview), 'excerpts': excerpts})
    found.sort(key=lambda item: (-len(item['matched_terms']), item['id']))
    return {'query': text, 'scanned_modules': len(definitions), 'matched_modules': len(found),
            'results': found[:limit], 'truncated': len(found) > limit,
            'method': '按 id、name、summary 字面词项匹配；不代表语义检索或全项目不存在结论'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path)
    parser.add_argument('--query', default='')
    parser.add_argument('--module')
    parser.add_argument('--limit', type=int, default=10)
    args = parser.parse_args(argv)
    try:
        result = query(project_root(args.root), args.query, args.module, args.limit)
        emit(result)
        return 0 if result['results'] else 2
    except (OSError, ValueError, KeyError, TypeError) as exc:
        emit({'error': str(exc)}); return 1


if __name__ == '__main__':
    raise SystemExit(main())
