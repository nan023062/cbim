/**
 * 作用定位：提供所有项目共有的内置根模块身份和只读说明，供知识查询与视图共用。
 * 设计原因：项目可以先直接开发再沉淀业务模块；根范围不能因已创建子模块而消失，也不应伪造正式文件、维护人或负责人。
 * 职责边界：这是当前工作区的内置范围，不写 .cbim，不授予权限；正式 Team 派发仍校验真实模块与负责人。
 */
export const projectRootModuleId='cbim:project';
/** 根模块不对应可编辑文件；子模块仍以真实知识树维护，Workflow 不从根继承。 */
export const projectRootModule={id:projectRootModuleId,name:'项目根模块',source:'builtin' as const,summary:'当前项目的完整业务范围；可以直接开发，再按实际成果逐步沉淀业务模块。'};
/** 主 Agent 可只读取得根范围，不把静态说明当作执行或责任回执。 */
export const projectRootOverview='这是始终存在的项目根模块，范围是当前工作区。尚未划分模块或任务跨越已定义模块时，自动模式的主 Agent 可在本轮权限内直接实现和验证。团队与业务架构由开发成果驱动逐步治理，不是开始工作的配置前提。根模块不自动创建负责人、维护人或 Workflow；已有模块及其责任、流程继续作为真实知识。';
