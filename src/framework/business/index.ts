/**
 * 作用定位：Business 的公开入口，供上层使用项目、工作区描述与运行实例。
 * 设计原因：集中导出业务树契约与运行实例，调用方按需要区分静态描述和资源生命周期。
 */
export { Project } from './project';

export { projectRootModuleId, projectRootModule, projectRootOverview, projectRootWithChildren } from './project-root';

export type { Workspace, WorkspaceTree } from './workspace';

export { WorkspaceInstance, type WorkspaceOpenContext, type WorkspaceWorktree, type WorkspaceInstanceFactory } from './workspace-instance';

export { WorkflowScope } from './workflow';

export type { WorkflowDefinition } from '../skills';
