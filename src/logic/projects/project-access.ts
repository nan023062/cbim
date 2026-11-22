/**
 * 作用定位：项目资源服务依赖已打开项目的数据，而不是列表的加载与装配过程。
 * 设计原因：缩小目录服务依赖，避免加载流程循环引用。
 */
import type { ProjectInstance, ProjectResources } from '../../framework/project';

import type { ProjectCache } from './project-cache';

import type { ProjectTrees } from './project-trees';

import type { WorkspaceEntry } from './contracts';

export interface ProjectAccess
{
  Open(id: string): Promise<{ cache: ProjectCache; entry: WorkspaceEntry; resources: ProjectResources; trees: ProjectTrees; runtime: ProjectInstance }>;
}
