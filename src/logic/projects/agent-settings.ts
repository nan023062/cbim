/**
 * 作用定位：本机岗位与会话配置的保存入口；原子写入并用版本号防止覆盖其他窗口编辑。
 * 设计原因：仅组织岗位持久化配置，保存影响后续采纳，已启动角色保留冻结快照。
 */
import path from 'node:path';

import fs from 'node:fs/promises';

import { z } from 'zod';

import { atomic } from '../../core/io/text-files';

import { hash } from '../../core/io/serialization';

import type { ProjectAccess } from './project-access';

import { agentConfigurationSchema, agentSettingsTargetSchema, type AgentConfiguration, type AgentSettingsTarget } from './agent-configuration';

import type { TeamDescription } from '../../framework/cability/team';

import { OrganizationDirectory } from './organization-directory';

import type { OrganizationSnapshot } from './organization-contract';

import { ArchitectureUpdate } from './architecture-update';

const savedSchema = z.object({ revision: z.number().int().nonnegative(), configuration: agentConfigurationSchema }).strict();

export class AgentSettings
{
  public readonly organization: OrganizationDirectory;

  private readonly _writing = new Set<string>();

  private readonly _changingProjects = new Set<string>();

  private readonly _epochs = new Map<string, number>();

  private readonly _applied = new Map<string, number>();

  public constructor(private readonly _projects: ProjectAccess, private readonly _notify: (project: string, text: string) => void = () => { }, private readonly _defaultModel: () => Promise<AgentConfiguration['model']> = async () => undefined)
  {
    this.organization = new OrganizationDirectory(_projects, (project, snapshot) => { if (this._changingProjects.has(project)) throw Error('能力配置正在保存，请稍后重试结构编辑'); return this.Prepare(project, snapshot); }, _notify, _defaultModel);
  }

  private async Location(projectId: string, target: AgentSettingsTarget)
  {
    target = agentSettingsTargetSchema.parse(target);

    const project = await this._projects.Open(projectId);

    const member = target.kind === 'member' ? (await this.organization.Read(projectId)).nodes.find(node => node.kind === 'agent' && node.id === target.id) : undefined;

    if (target.kind === 'member' && !member)
      throw Error('成员不属于该项目');

    if (target.kind === 'main')
      await fs.access(project.cache.Session(target.id));

    return { file: target.kind === 'member' ? await project.trees.MemberFile(target.id) : '', member };
  }

  public async Read(projectId: string, target: AgentSettingsTarget)
  {
    const { file, member } = await this.Location(projectId, target);

    if (target.kind === 'main')
    {
      const { entry } = await this._projects.Open(projectId);

      const root = await fs.realpath(entry.path);

      const directory = path.join(root, '.agents', 'skills');

      const skills = [];

      try
      {
        if (await fs.realpath(directory) === directory)
        {
          for (const child of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name)))
          {
            if (!child.isDirectory() || child.name.length > 100 || skills.length >= 32)
              continue;

            const source = path.join(directory, child.name, 'SKILL.md');

            const stat = await fs.lstat(source).catch(() => undefined);

            if (!stat?.isFile() || stat.size > 128000 || await fs.realpath(source) !== source)
              continue;

            const content = (await fs.readFile(source, 'utf8')).trim();

            if (content && content.length <= 32000)
              skills.push({ id: child.name, name: child.name, content });
          }
        }
      }
      catch (error)
      {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw error;
      }

      return { revision: 0, configuration: agentConfigurationSchema.parse({ skills }) };
    }

    if(member?.market)return {revision:member.market.configurationRevision??0,configuration:agentConfigurationSchema.parse(member.configuration??{})};
    try
    {
      const saved = savedSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));

      return { ...saved, configuration: { ...saved.configuration, model: saved.configuration.model ?? await this._defaultModel() } };
    }
    catch (error)
    {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error;

      return { revision: 0, configuration: agentConfigurationSchema.parse({ ...member?.configuration, model: member?.configuration?.model ?? await this._defaultModel() }) };
    }
  }

  public async Save(projectId: string, target: AgentSettingsTarget, revision: number, input: AgentConfiguration)
  {
    if (target.kind === 'main')
      throw Error('主 Agent 的配置仅在当前对话窗生效');

    const configuration = agentConfigurationSchema.parse(input);

    const { file,member } = await this.Location(projectId, target);
    if(member?.market){
      const snapshot=await this.organization.Read(projectId);
      await this.organization.EditMarketNodes(projectId,snapshot.revision,nodes=>{
        const node=nodes.find(item=>item.id===target.id);
        if(!node?.market||(node.market.configurationRevision??0)!==revision)throw Error('配置已更新，请重新打开');
        node.configuration=configuration;node.market.configurationRevision=revision+1;
      });
      return {revision:revision+1,configuration};
    }

    if (this._writing.has(file) || this._changingProjects.has(projectId) || this.organization.IsWriting(projectId))
      throw Error('配置正在保存，请重试');

    this._writing.add(file);

    this._changingProjects.add(projectId);

    try
    {
      const previous = await this.Read(projectId, target);

      if (previous.revision !== revision)
        throw Error('配置已更新，请重新打开设置后再保存');

      const result = { revision: revision + 1, configuration };

      await atomic(file, JSON.stringify(result, null, 2));

      this._epochs.set(projectId, (this._epochs.get(projectId) ?? 0) + 1);

      if (target.kind === 'member')
      {
        await this.Apply(projectId);

        const snapshot = await this.organization.Read(projectId);

        const node = snapshot.nodes.find(node => node.id === target.id);

        if (node)
          this._notify(projectId, ArchitectureUpdate.Describe('organization', snapshot.revision, snapshot.nodes, snapshot.nodes.map(item => item.id === target.id ? { ...item, configuration, configurationRevision: result.revision } : item)));
      }

      return result;
    }
    finally
    {
      this._writing.delete(file);

      this._changingProjects.delete(projectId);
    }
  }

  public async Members(projectId: string)
  {
    const members = (await this.organization.Read(projectId)).nodes.filter(node => node.kind === 'agent');

    return Promise.all(members.map(async member => ({ id: member.id, name: member.name, position: member.position, ...(await this.Read(projectId, { kind: 'member', id: member.id })) })));
  }

  /** 在落盘前准备完整目录；提交后同步替换，活动实例保留自身冻结角色。 */
  private async Prepare(projectId: string, snapshot: OrganizationSnapshot): Promise<() => void>
  {
    const project = await this._projects.Open(projectId);

    const settings = new Map(await Promise.all(snapshot.nodes.filter(node => node.kind === 'agent').map(async node => { const file = await project.trees.MemberFile(node.id); try { return [node.id, savedSchema.parse(JSON.parse(await fs.readFile(file, 'utf8'))).configuration] as const; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return [node.id, agentConfigurationSchema.parse(node.configuration ?? {})] as const; } })));

    const defaultModel = [...settings.values()].some(config => !config.model) ? await this._defaultModel() : undefined;

    const replace = (nodes: TeamDescription['children']): TeamDescription['children'] => nodes.map(node => { if (node.kind === 'team') return { ...node, children: replace(node.children) }; const configured = settings.get(node.id)!; const configuration = { ...configured, model: configured.model ?? defaultModel }; return { ...node, ...configuration, model: configuration.model ?? { engine: '', profileId: '', modelId: '' }, available: !!configuration.model, reason: configuration.model ? undefined : '岗位尚未绑定执行配置' }; });

    const children = replace(this.organization.Describe(snapshot));

    return () => { if ((this._applied.get(projectId) ?? -1) > snapshot.revision) return; project.runtime.organization!.ReplaceChildren(children); this._applied.set(projectId, snapshot.revision); };
  }

  /** 启动时核对版本，防止异步读取将较新的运行目录覆盖成旧快照。 */
  public async Apply(projectId: string)
  {
    for (; ;)
    {
      const epoch = this._epochs.get(projectId);

      const snapshot = await this.organization.Read(projectId);

      const apply = await this.Prepare(projectId, snapshot);

      if ((await this.organization.Read(projectId)).revision !== snapshot.revision || this._epochs.get(projectId) !== epoch)
        continue;

      apply();

      return;
    }
  }
}
