"""Check explicit local references in core's abstraction directories.

This checks files, not natural-language semantics or runtime task context.
"""
import argparse
import json
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit

LAYERS = {'skills', 'task', 'business', 'capability', 'connector', 'memory'}
ALLOWED = {'memory': {'task'}, 'skills': {'task'}, 'task': {'business', 'capability'},
           'business': {'connector'}, 'capability': {'connector'}, 'connector': set()}


def references(path):
    text = path.read_text(encoding='utf-8-sig')
    if path.suffix == '.json':
        def walk(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    if key in {'$ref', '$dynamicRef'} and isinstance(item, str):
                        yield item
                    else:
                        yield from walk(item)
            elif isinstance(value, list):
                for item in value:
                    yield from walk(item)
        for ref in walk(json.loads(text)):
            yield 1, ref
        return
    for number, line in enumerate(text.splitlines(), 1):
        # Inline/image links, reference-link definitions, HTML links, and
        # explicit relative or project-root paths in inline code.
        patterns = [r'!?\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)',
                    r'^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)',
                    r'(?:href|src)=[\"\']([^\"\']+)[\"\']',
                    r'`((?:\.\.?/|\.cbim/core\.src/)[^`\s]+\.(?:md|json|py)(?:#[^`\s]*)?)`']
        for pattern in patterns:
            for target in re.findall(pattern, line):
                yield number, target.strip('<>')


def allowed(source, target):
    """Paths are relative to core; peer Skills may not depend on each other."""
    src, dst = source.parts[0], target.parts[0]
    if dst not in LAYERS:
        return False
    if src == dst:
        if src != 'skills':
            return True
        return len(source.parts) > 2 and len(target.parts) > 2 and source.parts[1] == target.parts[1]
    return dst in ALLOWED[src]


def check(core):
    core = Path(core).resolve()
    errors, edges = [], set()
    count = 0
    for layer in sorted(LAYERS):
        if not (core / layer).is_dir():
            errors.append(f'Missing layer: {layer}')
            continue
        for path in sorted((core / layer).rglob('*')):
            if path.suffix not in {'.md', '.json'} or not path.is_file():
                continue
            count += 1
            source = path.relative_to(core)
            try:
                refs = list(references(path))
            except (ValueError, OSError) as exc:
                errors.append(f'{source}: {exc}')
                continue
            for line, ref in refs:
                parts = urlsplit(ref.replace('\\', '/'))
                if parts.scheme or parts.netloc or not parts.path:
                    continue
                location = unquote(parts.path)
                if location.startswith('.cbim/core.src/'):
                    target_path = (core / location[len('.cbim/core.src/'):]).resolve()
                else:
                    target_path = (path.parent / location).resolve()
                try:
                    target = target_path.relative_to(core)
                except ValueError:
                    errors.append(f'{source}:{line}: reference outside core: {ref}')
                    continue
                if path.name.casefold() != 'readme.md' and (not target.parts or not allowed(source, target)):
                    errors.append(f'{source}:{line}: forbidden dependency: {ref}')
                if not target_path.is_file():
                    errors.append(f'{source}:{line}: missing target: {ref}')
                if path.name.casefold() != 'readme.md' and target.parts and source.parts[0] != target.parts[0]:
                    edges.add((source.parts[0], target.parts[0]))
    return errors, count, sorted(edges)


def check_readme(core, project=None):
    """Check README/docs dependency chains; human navigation is excluded.

    Covers core, entry, team and workspace Markdown/JSON when present. Plain-language
    loading instructions still require semantic review, not keyword rejection.
    """
    core = Path(core).resolve()
    project = Path(project).resolve() if project else core.parent.parent
    cbim = project / ".cbim"
    def human_document(path):
        path = path.resolve()
        return (path.name.casefold() == 'readme.md' or
                any(part.casefold() == 'docs' for part in path.relative_to(core).parts[:-1])
                if path.is_relative_to(core) else path.name.casefold() == 'readme.md')

    files = set(core.rglob('*.md')) | set(core.rglob('*.json'))
    entry = cbim / 'entry.md'
    if entry.is_file():
        files.add(entry)
    team = cbim / 'team'
    if team.is_dir():
        files.update(team.rglob('*.md'))
    workspace = cbim / 'workspace'
    if workspace.is_dir():
        files.update(workspace.rglob('*.md'))
        files.update(workspace.rglob('*.json'))
    if team.is_dir():
        files.update(team.rglob('*.json'))
    graph = {}
    for path in sorted(files):
        if human_document(path):
            continue
        refs = list(references(path))
        # Bare inline README paths are not included by the layer parser.
        for number, line in enumerate(path.read_text(encoding='utf-8-sig').splitlines(), 1):
            for ref in re.findall(r'`([^`\s]*readme\.md(?:#[^`\s]*)?)`', line, re.I):
                refs.append((number, ref))
        if path.suffix == '.json':
            def execution_paths(value, active=False):
                if isinstance(value, str) and active:
                    yield value
                elif isinstance(value, dict):
                    for key, item in value.items():
                        if key in {'sources'}:
                            continue  # Evidence/workspace inventory is not an instruction import.
                        yield from execution_paths(item, active or key in {
                            'overview', 'workflow', 'workflows', 'principles', 'skills',
                            'dna', '$ref', '$dynamicRef'})
                elif isinstance(value, list):
                    for item in value:
                        yield from execution_paths(item, active)
            refs.extend((1, value) for value in execution_paths(json.loads(path.read_text(encoding='utf-8-sig')))
                        if value.split('#')[0].lower().endswith(('.md', '.json')))
        links = []
        for number, ref in refs:
            parts = urlsplit(ref.replace('\\', '/'))
            if parts.scheme or parts.netloc or not parts.path:
                continue
            location = unquote(parts.path)
            target = ((project / location) if location.startswith('.cbim/')
                      else (path.parent / location)).resolve()
            if target.is_relative_to(project):
                links.append((number, target))
        graph[path.resolve()] = links

    def find_chain(path, visited):
        if path in visited:
            return None
        visited = visited | {path}
        for line, target in graph.get(path, []):
            edge = f'{path.relative_to(project)}:{line}'
            if human_document(target):
                return [edge, str(target.relative_to(project))]
            tail = find_chain(target, visited)
            if tail:
                return [edge] + tail
        return None

    errors = []
    for path in sorted(graph):
        chain = find_chain(path, set())
        if chain:
            prefix = 'README dependency: ' if Path(chain[-1]).name.casefold() == 'readme.md' else 'docs dependency: '
            errors.append(prefix + ' -> '.join(chain))
    return errors, len(graph)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--core', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--root', type=Path, help='项目根；独立安装 core 时显式指定')
    args = parser.parse_args()
    errors, count, edges = check(args.core)
    readme_errors, readme_count = check_readme(args.core, args.root)
    errors.extend(readme_errors)
    print(f'Human-document isolation: {readme_count} execution Markdown/JSON files; {len(readme_errors)} violations')
    for error in errors:
        print(error)
    print(('FAIL' if errors else 'PASS') + f': {count} files; {len(errors)} violations')
    for source, target in edges:
        print(f'{source} -> {target}')
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
