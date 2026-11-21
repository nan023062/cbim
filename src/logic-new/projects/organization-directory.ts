/** 项目组织的持久编辑服务：保留节点身份，以版本化单文件提交整棵树。 */
import fs from 'node:fs/promises';

import path from 'node:path';

import { atomic } from '../../core/io/text-files';

import type { ProjectList } from './project';

import { ArchitectureUpdate } from './architecture-update';

import type { TeamDescription } from '../../framework/cability/team';

import { organizationChangeSchema, organizationSnapshotSchema, type OrganizationSnapshot, type OrganizationChange, type OrganizationNode } from './organization-contract';

export class OrganizationDirectory
{
  private readonly _writing = new Set<string>();

  public constructor(private readonly _projects: ProjectList, private readonly _prepare: (project: string, snapshot: OrganizationSnapshot) => Promise<() => void> = async () => () => { }, private readonly _notify: (project: string, text: string) => void = () => { })
  {
  }

  public IsWriting(project: string): boolean
  {
    return this._writing.has(project);
  }

  public async Read(projectId: string): Promise<OrganizationSnapshot>
  {
    const project = await this._projects.Open(projectId);

    try
    {
      return organizationSnapshotSchema.parse(JSON.parse(await fs.readFile(path.join(this._projects.paths.Project(projectId), 'organization.json'), 'utf8')));
    }
    catch (error)
    {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error;
    }

    const nodes: OrganizationNode[] = [];

    const visit = (children: TeamDescription['children'], parentId: string | null) => { for (const node of children) { nodes.push(node.kind === 'team' ? { id: node.id, kind: 'team', parentId, name: node.name ?? node.id.split('/').at(-1)!, position: node.position ?? '' } : { id: node.id, kind: 'agent', parentId, name: node.name, position: node.position, configuration: { ...(node.model.engine && { model: node.model }), skills: [...(node.skills ?? [])], connectorIds: [...(node.connectorIds ?? [])] } }); if (node.kind === 'team') visit(node.children, node.id); } };

    visit(project.resources.organization, null);

    return organizationSnapshotSchema.parse({ revision: 0, nodes });
  }

  public async Change(projectId: string, input: OrganizationChange): Promise<OrganizationSnapshot>
  {
    const change = organizationChangeSchema.parse(input);

    if (this._writing.has(projectId))
      throw Error('组织正在保存，请稍后重试');

    this._writing.add(projectId);

    try
    {
      await this._projects.Open(projectId);

      const previous = await this.Read(projectId);

      if (previous.revision !== change.revision)
        throw Error('组织已被其他操作更新，请刷新后重试');

      let nodes = structuredClone(previous.nodes);

      if (change.action === 'create')
        nodes.push({ id: 'org:' + crypto.randomUUID(), kind: change.kind, parentId: change.parentId, name: change.name, position: change.position });
      else
      {
        const node = nodes.find(node => node.id === change.id);

        if (!node)
          throw Error('组织节点不存在');

        if (change.action === 'delete')
        {
          if (nodes.some(child => child.parentId === node.id))
            throw Error('不能删除非空团队，请先移除或调整下级节点');

          nodes = nodes.filter(item => item.id !== node.id);
        }
        else
        {
          node.name = change.name;

          node.position = change.position;

          node.parentId = change.parentId;
        }
      }

      if (change.action !== 'delete' && nodes.filter(node => node.parentId === change.parentId && node.name.toLocaleLowerCase() === change.name.toLocaleLowerCase()).length > 1)
        throw Error('同一团队下已存在同名节点');

      const result = organizationSnapshotSchema.parse({ revision: previous.revision + 1, nodes });

      const apply = await this._prepare(projectId, result);

      await atomic(path.join(this._projects.paths.Project(projectId), 'organization.json'), JSON.stringify(result, null, 2));

      apply();

      this._notify(projectId, ArchitectureUpdate.Describe('organization', result.revision, previous.nodes.map(({ configuration, ...node }) => node), result.nodes.map(({ configuration, ...node }) => node)));

      return result;
    }
    finally
    {
      this._writing.delete(projectId);
    }
  }

  /** 转换只改变组织视图；能力配置随后由 AgentSettings 装配。 */
  public Describe(snapshot: OrganizationSnapshot): TeamDescription['children']
  {
    const children = (parentId: string | null): TeamDescription['children'] => snapshot.nodes.filter(node => node.parentId === parentId).map(node => node.kind === 'team' ? { id: node.id, kind: 'team', name: node.name, position: node.position, children: children(node.id) } : { id: node.id, agentId: node.id, kind: 'agent', name: node.name, position: node.position, ...node.configuration, model: node.configuration?.model ?? { engine: '', profileId: '', modelId: '' }, available: !!node.configuration?.model, reason: node.configuration?.model ? undefined : '岗位尚未绑定执行配置' });

    return children(null);
  }
}
