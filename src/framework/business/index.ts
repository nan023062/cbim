/** Business 的公开入口，供上层使用项目、工作区描述与运行实例。 */
export { Project } from './project';

export { projectRootModuleId, projectRootModule, projectRootOverview, projectRootWithChildren } from './project-root';

export type { Workspace, WorkspaceTree } from './workspace';

export { WorkspaceInstance, type WorkspaceOpenContext, type WorkspaceWorktree, type WorkspaceInstanceFactory } from './workspace-instance';

export { WorkflowScope } from './workflow';

export type { WorkflowDefinition } from '../skills';
