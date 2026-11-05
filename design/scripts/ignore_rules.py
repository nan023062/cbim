"""Shared .cbimignore matching; excludes indexes, never authorizes access."""
import posixpath
import re
from pathlib import Path, PureWindowsPath
try:
    from pathspec import GitIgnoreSpec
except ImportError:
    raise SystemExit('缺少 pathspec；请运行 python -m pip install -r core.src/scripts/requirements.txt')


class IgnoreRules:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.path = self.root / '.cbim/.cbimignore'
        self.configured = self.path.exists()
        self.lines = self.path.read_text(encoding='utf-8-sig').splitlines() if self.configured else []
        # pathspec drops empty lines; retain the original source line mapping.
        self.pattern_lines = [(number, line) for number, line in enumerate(self.lines, 1) if line]
        try:
            self.spec = GitIgnoreSpec.from_lines(line.casefold() for _, line in self.pattern_lines)
        except (ValueError, TypeError) as exc:
            raise ValueError(f'{self.path}: ignore 规则无效：{exc}') from exc

    def match(self, location, *, is_directory=False):
        # Callers must validate source safety before matching. Walk ancestors as
        # Git does: an excluded parent prevents ! from re-including a child.
        value = posixpath.normpath(location.replace('\\', '/')).casefold()
        parts = value.split('/')
        candidates = ['/'.join(parts[:i])+'/' for i in range(1, len(parts))]
        candidates.append(value+'/' if is_directory else value)
        for candidate in candidates:
            result = self.spec.check_file(candidate)
            if result.include:
                number, pattern = self.pattern_lines[result.index]
                return {'pattern': pattern, 'line': number, 'matched_path': candidate}
        return None

    def status(self):
        return {'path': '.cbim/.cbimignore', 'configured': self.configured,
                'rules': sum(p.include is not None for p in self.spec.patterns)}


def source_key(root, location):
    if not isinstance(location, str) or not location.strip():
        raise ValueError('location 必须为非空路径')
    path = location.replace('\\', '/')
    if path != path.strip() or path.startswith('/') or PureWindowsPath(path).drive:
        raise ValueError('location 须相对项目根，不能有首尾空白')
    if re.search(r'[:*?\[\]\x00]', path):
        raise ValueError('location 须为具体文件或目录，不支持 URI 或通配符')
    path = posixpath.normpath(path)
    if path in ('.', '..') or path.startswith('../'):
        raise ValueError('location 不能为空范围或越出项目根')
    resolved = (root / path).resolve()
    if not resolved.is_relative_to(root):
        raise ValueError('location 经链接解析后越出项目根')
    # Portable case-insensitive identity matches CBIM directory IDs and Windows.
    return resolved.relative_to(root).as_posix().casefold()

