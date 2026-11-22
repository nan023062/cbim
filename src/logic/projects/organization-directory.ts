/**
 * 作用定位：项目组织的持久编辑服务：保留节点身份，以版本化单文件提交整棵树。
 * 设计原因：稳定身份与版本化提交保护实时编辑，保存更新共享目录并通知主 Agent，已运行角色仍保留快照。
 */
import { describeOrganization } from './project-trees';

import type { ProjectAccess } from './project-access';

import { ArchitectureUpdate } from './architecture-update';

import type { TeamDescription } from '../../framework/cability/team';

import { organizationChangeSchema, organizationSnapshotSchema, type OrganizationSnapshot, type OrganizationChange, type OrganizationNode } from './organization-contract';

export class OrganizationDirectory
{
  private readonly _writing = new Set<string>();

  public constructor(private readonly _projects: ProjectAccess, private readonly _prepare: (project: string, snapshot: OrganizationSnapshot) => Promise<() => void> = async () => () => { }, private readonly _notify: (project: string, text: string) => void = () => { }, private readonly _defaultModel: () => Promise<NonNullable<OrganizationNode['configuration']>['model']> = async () => undefined)
  {
  }

  public IsWriting(project: string): boolean
  {
    return this._writing.has(project);
  }

  public async Read(projectId: string): Promise<OrganizationSnapshot>
  {
    const project = await this._projects.Open(projectId);

    return project.trees.Organization();
  }

  public async Change(projectId: string, input: OrganizationChange): Promise<OrganizationSnapshot>
  {
    const change = organizationChangeSchema.parse(input);

    if (this._writing.has(projectId))
      throw Error('组织正在保存，请稍后重试');

    this._writing.add(projectId);

    try
    {
      const project = await this._projects.Open(projectId);

      const previous = await this.Read(projectId);

      if (previous.revision !== change.revision)
        throw Error('组织已被其他操作更新，请刷新后重试');

      let nodes = structuredClone(previous.nodes);

      if (change.action === 'create')
        nodes.push({ id: 'org:' + crypto.randomUUID(), kind: change.kind, ...(change.kind === 'agent' && { configuration: { model: await this._defaultModel(), skills: [], connectorIds: [] } }), parentId: change.parentId, name: change.name, position: change.position });
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

      await project.trees.SaveOrganization(result);

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
    return describeOrganization(snapshot);
  }
}
