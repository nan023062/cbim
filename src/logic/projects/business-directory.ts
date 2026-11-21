/**
 * 作用定位：业务架构实时编辑服务：原子保存定义、更新项目共享树，再向所有活动主 Agent 发布变化。
 * 设计原因：定义持久化、共享运行树与通知按提交顺序衔接，结构修改不以任务空闲为前提。
 */
import fs from 'node:fs/promises';

import path from 'node:path';

import { atomic } from '../../core/io/text-files';

import type { ProjectList } from './project';

import type { WorkspaceTree } from '../../framework/business';

import { businessSnapshotSchema, businessChangeSchema, type BusinessSnapshot, type BusinessChange } from './business-contract';

import { ArchitectureUpdate } from './architecture-update';

export class BusinessDirectory
{
  private readonly _writing = new Set<string>();

  private readonly _applied = new Map<string, number>();

  public constructor(private readonly _projects: ProjectList, private readonly _notify: (project: string, text: string) => void = () => { })
  {
  }

  public async Read(projectId: string): Promise<BusinessSnapshot>
  {
    await this._projects.Open(projectId);

    try
    {
      return businessSnapshotSchema.parse(JSON.parse(await fs.readFile(path.join(this._projects.paths.Project(projectId), 'business.json'), 'utf8')));
    }
    catch (error)
    {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error;
    }

    const tree = await this._projects.Business(projectId);

    return businessSnapshotSchema.parse({ revision: 0, nodes: tree.nodes.map(node => ({ id: node.id, parentId: tree.nodes.find(parent => parent.children.includes(node.id))?.id ?? null, name: node.name, summary: node.summary, sources: node.sources, virtual: node.virtual })) });
  }

  /** 保存前后身份固定；删除仅移除架构定义，既有工作树与任务实例继续保留。 */
  public async Change(projectId: string, input: BusinessChange): Promise<BusinessSnapshot>
  {
    const change = businessChangeSchema.parse(input);

    if (this._writing.has(projectId))
      throw Error('业务架构正在保存，请稍后重试');

    this._writing.add(projectId);

    try
    {
      const project = await this._projects.Open(projectId);

      const previous = await this.Read(projectId);

      if (change.revision !== previous.revision)
        throw Error('业务架构已更新，请刷新后重试');

      let nodes = structuredClone(previous.nodes);

      if (change.action === 'create')
        nodes.push({ ...change.definition, id: 'business:' + crypto.randomUUID() });
      else
      {
        const index = nodes.findIndex(node => node.id === change.id);

        if (index < 0)
          throw Error('业务节点不存在');

        if (change.action === 'delete')
        {
          if (nodes.some(node => node.parentId === change.id))
            throw Error('请先移除或调整下级节点');

          nodes = nodes.filter(node => node.id !== change.id);
        }
        else
          nodes[index] = { ...change.definition, id: change.id };
      }

      const result = businessSnapshotSchema.parse({ revision: previous.revision + 1, nodes });

      await atomic(path.join(this._projects.paths.Project(projectId), 'business.json'), JSON.stringify(result, null, 2));

      project.runtime.project!.UpdateTree(this.Tree(result));

      this._applied.set(projectId, result.revision);

      this._notify(projectId, ArchitectureUpdate.Describe('business', result.revision, previous.nodes, result.nodes));

      return result;
    }
    finally
    {
      this._writing.delete(projectId);
    }
  }

  /** 页面与执行共享相同的最新定义。 */
  public Tree(snapshot: BusinessSnapshot): WorkspaceTree
  {
    return { roots: snapshot.nodes.filter(node => node.parentId === null).map(node => node.id), nodes: Object.fromEntries(snapshot.nodes.map(node => [node.id, { id: node.id, kind: 'workspace', name: node.name, summary: node.summary, sources: node.sources, virtual: node.virtual, children: snapshot.nodes.filter(child => child.parentId === node.id).map(child => child.id) }])) };
  }

  public async Apply(projectId: string): Promise<void>
  {
    const project = await this._projects.Open(projectId);

    for (; ;)
    {
      const snapshot = await this.Read(projectId);

      if ((await this.Read(projectId)).revision !== snapshot.revision)
        continue;

      if ((this._applied.get(projectId) ?? -1) > snapshot.revision)
        continue;

      project.runtime.project!.UpdateTree(this.Tree(snapshot));

      this._applied.set(projectId, snapshot.revision);

      return;
    }
  }
}
