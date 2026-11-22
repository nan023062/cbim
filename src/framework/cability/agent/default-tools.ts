/** Framework 中所有 Agent 共用的默认工具及操作类别，供运行时按任务权限和引擎支持筛选。 */
export const defaultTools = Object.freeze({
  read: 'read',
  grep: 'read',
  glob: 'read',
  find: 'read',
  ls: 'read',
  bash: 'command',
  write: 'business-write',
  edit: 'business-write'
} as const);
