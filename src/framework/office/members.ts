/** 单个办公室的团队快照与岗位实例绑定。 */
import { Organization, type Agent, type AgentEngineFactory } from '../cability/organization';

import type { AgentRole } from '../cability/agent';

import { Worker } from './worker';

import type { TeamDescription } from '../cability/team';

export class OfficeMembers
{
  private readonly _bindings = new Map<string, Worker>();

  public constructor(public readonly organization: Organization) {}

  public SetMembers(children: TeamDescription['children']): void
  {
    this.organization.ReplaceChildren(children);
    for (const [id, worker] of this._bindings)
      if (this.organization.FindMember(id)?.agentId !== worker.agentId) this._bindings.delete(id);
  }

  /** 仅从本办公室的组织树解析岗位，同一岗位复用同一实例身份。 */
  private GetWorker(memberId: string): Worker
  {
    const member = this.organization.FindMember(memberId);

    if (!member || !member.available)
      throw new Error(member?.reason ?? '当前办公室没有可用的目标岗位');

    let binding = this._bindings.get(memberId);

    if (!binding || binding.agentId !== member.agentId)
    {
      binding = new Worker(memberId, member.agentId, this.organization.Allocate());
      this._bindings.set(memberId, binding);
    }

    return binding;
  }

  public ListAgents() { return this.organization.ListAgents(); }

  /** 返回工作人员持有的 Agent 实例，供任务执行使用。 */
  public GetMember(memberId: string)
  {
    return this.GetWorker(memberId).agent;
  }

  public ForTask(child: { workspaceId: string; taskId: string; memberId: string })
  {
    let pending: Promise<Agent<unknown>> | undefined;
    let closed = false;
    let closing: Promise<void> | undefined;
    let binding: ReturnType<OfficeMembers['GetMember']>;

    const activate = <Parameters, Engine>(role: AgentRole, factory: AgentEngineFactory<Parameters, Engine>) => {
      if (closed || pending)
        throw new Error('子任务已关闭或已绑定 Agent');
      if (role.definition.id !== child.memberId || role.conversation.workspaceId !== child.workspaceId || role.conversation.taskId !== child.taskId)
        throw new Error('岗位与办公室子任务不匹配');
      binding = this.GetMember(child.memberId);
      const opened = binding.Open(role, factory);
      pending = opened.then(result => result.agent);
      void pending.catch(() => {});
      return opened;
    };

    return {
      Acquire: async <Parameters, Engine>(role: AgentRole, factory: AgentEngineFactory<Parameters, Engine>) => (await activate(role, factory)).agent,
      OpenEngine: async <Parameters, Engine>(role: AgentRole, factory: AgentEngineFactory<Parameters, Engine>) => (await activate(role, factory)).engine,
      Close: () => {
        closed = true;
        return closing ??= Promise.resolve(pending).then(agent => agent && binding.Close(), () => {}).catch(error => { closing = undefined; throw error; });
      }
    };
  }
}
