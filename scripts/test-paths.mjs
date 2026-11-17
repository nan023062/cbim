// 测试身份不由所在产品层决定；同一规则供归属检查、依赖检查和生产构建使用。
export const testFilePattern = /^(?:tests\/|(?:src|scripts)\/(?:.*\/)?unittest\/).*\.test\.(?:ts|mjs)$/;

export const isUnitTestPath = file => file.replaceAll('\\', '/').split('/').includes('unittest');

export const isTestSupport = file => file.replaceAll('\\', '/').startsWith('tests/') || isUnitTestPath(file);

/** 一个责任模块可以拥有多个精确入口，单元目录归于其主入口所在封装。 */
export function unitTestDirectory(definition)
{
  if (definition.directory) return definition.directory + '/unittest';
  const first = definition.roots[0];
  return first ? first.replace(/\/$/, '').replace(first.endsWith('/') ? /$/ : /\/[^/]+$/, '') + '/unittest' : undefined;
}
