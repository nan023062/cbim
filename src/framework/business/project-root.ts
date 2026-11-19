/** 定义 Project 根节点的业务身份和说明，用于表达整项工程的业务范围及其直属工作区。 */
export const projectRootModuleId = 'cbim:project';

/** 根模块不对应可编辑文件；子模块仍以真实知识树维护，Workflow 不从根继承。 */
export const projectRootModule = { id: projectRootModuleId, name: '项目根模块', source: 'builtin' as const, summary: '当前项目的完整业务范围；可以直接开发，再按实际成果逐步沉淀业务模块。' };

/** 主 Agent 可只读取得根范围，不把静态说明当作执行或责任回执。 */
export const projectRootOverview = '这是始终存在的项目根模块，范围是当前工作区。尚未划分模块或任务跨越已定义模块时，自动模式的主 Agent 可在本轮权限内直接实现和验证。团队与业务架构由开发成果驱动逐步治理，不是开始工作的配置前提。根模块不自动创建负责人、维护人或 Workflow；已有模块及其责任、流程继续作为真实知识。';

/** 按已校验快照中的顺序暴露项目直属模块。调用方可独立裁剪返回结果。 */
export function projectRootWithChildren(roots: readonly string[])
{
  return { ...projectRootModule, children: [...roots] };
}
