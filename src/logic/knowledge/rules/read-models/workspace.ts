/**
 * 目录归属：logic/knowledge/rules/knowledge/read-models；知识快照与领域读模型。
 * 作用定位：业务工作区：领域工程与模块注册表、模块知识和仅本模块 Workflow的核心封装。
 * 设计原因：在同一校验快照上提供领域语义；内置项目根范围始终可查询，与真实文件注册表分开，不依赖桌面页面或写入伪造模块。
 * 读取边界：本类属于 knowledge-read-models 的私有实现，跨模块经 knowledge/read-models 入口访问；模块责任与知识提交仍归各自服务。
 */
import path from 'node:path';

import { context, data, content } from './snapshot';

import { parseJson } from '../../../io-errors/json';

import type { Snapshot } from '../types';

import { Project, projectRootModuleId, projectRootWithChildren, projectRootOverview } from '../../../workspace/rules/project-root';

/** 实例固定绑定一个快照；刷新知识后由调用方创建新的领域视图。 */
export class BusinessWorkspace
{
  private get project(): Project
  {
    return new Project(this.snapshot.validation?.tree ?? { roots: [], nodes: {} });
  }

  constructor(private snapshot: Snapshot)
  {
  }

  async Modules(query = '')
  {
    const s = this.snapshot,
      index = parseJson(s.validation!.indexes['.cbim/workspace/registry.json']);

    return { ...context(s), workspaceRootId: '.cbim/workspace', projectRoot: projectRootWithChildren(this.project.children), modules: index.modules.filter((m: any) => !query || `${m.id} ${m.summary}`.toLowerCase().includes(query.toLowerCase())), roots: s.validation!.tree.roots, indexSource: 'current-definitions', persistedIndexMatches: s.files.find(f => f.path === '.cbim/workspace/registry.json')?.text === s.validation!.indexes['.cbim/workspace/registry.json'] };
  }

  async Module(id: string)
  {
    const s = this.snapshot;

    if (id === projectRootModuleId)
      return { ...context(s), id, source: 'builtin' as const, definition: { ...projectRootWithChildren(this.project.children), workflows: [] }, overview: { available: true as const, text: projectRootOverview }, workflows: [], workflowScope: 'own-only' as const };

    const workspace = this.project.FindWorkspace(id);

    if (!workspace)
      throw new Error('Module 不存在或定义未通过校验，请先查询模块注册表与问题清单');

    const definition = data(s, workspace.id + '/module.json');

    const workflows = this.project.ResolveWorkflows(id, owner => (owner === id ? definition : data(s, owner + '/module.json')).workflows);
    return { ...context(s), id, definition, definitionFile: s.files.find(f => f.path === id + '/module.json'), overview: content(s, id, definition.overview), workflows: workflows.map(({ workflow, owner, inherited }) => ({ ...workflow, id: path.posix.dirname(path.posix.join(owner, workflow.reference)), owner, inherited, content: content(s, owner, workflow.reference) })), workflowScope: 'own-and-ancestors' as const };
  }
}
