// 测试身份不由所在产品层决定；同一规则供归属检查、依赖检查和生产构建使用。
export const testFilePattern = /^(?:unittest\/|(?:src|scripts)\/(?:.*\/)?unittest\/).*\.test\.(?:ts|mjs)$/;

export const isUnitTestPath = file => file.replaceAll('\\', '/').split('/').includes('unittest');

export const isTestSupport = file => file.replaceAll('\\', '/').startsWith('tests/') || isUnitTestPath(file);

/** 测试类型不改变责任归属；工程根模块拥有整体测试，业务/工具模块拥有本层验证。 */
export function unitTestDirectory(definition)
{
  if (definition.directory === '.') return 'unittest';
  if (definition.directory) return definition.directory + '/unittest';
  const first = definition.roots[0];
  return first ? first.replace(/\/$/, '').replace(first.endsWith('/') ? /$/ : /\/[^/]+$/, '') + '/unittest' : undefined;
}
