// 测试身份不由所在产品层决定；同一规则供归属检查、依赖检查和生产构建使用。
export const testFilePattern = /^tests\/.*\.test\.(?:ts|mjs)$/;

// 正式测试集中在 tests；保留旧目录识别，生产依赖不能借历史路径绕过隔离。
export const isUnitTestPath = file => file.replaceAll('\\', '/').startsWith('tests/') || file.replaceAll('\\', '/').split('/').includes('unittest');

export const isTestSupport = file => file.replaceAll('\\', '/').startsWith('tests/') || isUnitTestPath(file);

/** 责任目录映射到根 tests 中的同路径；整体测试归根，测试类型不改变模块归属。 */
export function unitTestDirectory(definition)
{
  if (definition.directory === '.') return 'tests';
  if (definition.directory) return 'tests/' + definition.directory;
  const first = definition.roots[0];
  return first ? 'tests/' + first.replace(/\/$/, '').replace(first.endsWith('/') ? /$/ : /\/[^/]+$/, '') : undefined;
}
