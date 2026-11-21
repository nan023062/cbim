/**
 * 作用定位：将本轮模型派发连接到 Office 队列；成员复用岗位身份、动态权限及独立工作树。
 * 设计原因：通过成员自己的能力配置执行并共享 Office 权限，限制递归派发并在父任务结束时排空子运行。
 */
import path from 'node:path';

import { Office, type MainTaskCommands } from '../../framework/office';

import { AgentRole } from '../../framework/cability/agent';

import type { AgentPermission } from '../../framework/cability/organization';

import type { OfficeDispatchInput, OfficeOperations } from './office-operations';

/** 成员引擎由应用注入；子运行使用自己的岗位模型而非模型参数指定的账号。 */
export type OfficeMemberRunner = (role: AgentRole, goal: string, root: string, taskId: string, signal: AbortSignal, readPermission: () => AgentPermission, report: (seq: number, kind: 'message' | 'summary', count: number) => void, operations: OfficeOperations, agentInstanceId: string) => Promise<{ text: string }>;

/** 单次主消息的调度桥，限制循环委派并排空取消中的子运行。 */
export class OfficeDispatch
{
  /** 本轮派发总量，阻止模型无界递归。 */
  private _count = 0;

  /** 等待结束的本轮子运行。 */
  private readonly _pending = new Set<Promise<unknown>>();

  /** 运行身份、目录和任务命令来自宿主，不接受模型替换。 */
  public constructor(private readonly _office: Office, private readonly _root: string, private readonly _commands: MainTaskCommands, private readonly _run: OfficeMemberRunner, private readonly _signal: AbortSignal)
  {
  }

  /** 为当前成员绑定祖先链；递归派发仍属于同一个 Office。 */
  public Operations(ancestors: readonly string[] = [], parentTaskId?: string): OfficeOperations
  {
    return { Inspect: () => ({ permission: this._office.permission, organization: this._office.organization.children, workspaces: this._office.project.DescribeWorkspaces(), tasks: this._office.ListTasks() }), Dispatch: (input, signal) => { const pending = this.Dispatch(input, AbortSignal.any([signal, this._signal]), ancestors, parentTaskId); this._pending.add(pending); void pending.finally(() => this._pending.delete(pending)).catch(() => { }); return pending; } };
  }

  /** 关闭前等待已受理的子运行完成清理，不把取消当作交付成功。 */
  public async Drain(): Promise<void>
  {
    await Promise.allSettled([...this._pending]);
  }

  /** 派发只接受已配置且可用岗位，工作目录由 Office 的工作树解析。 */
  private async Dispatch(input: OfficeDispatchInput, signal: AbortSignal, ancestors: readonly string[], parentTaskId?: string): Promise<unknown>
  {
    signal.throwIfAborted();

    const readPermission = () => this._office.permission;

    const permission = readPermission();

    if (readPermission() === 'read')
      throw Error('只读权限不能派发执行任务');

    if (ancestors.includes(input.memberId) || ancestors.length >= 8 || this._count >= 32)
      throw Error('拒绝循环派发或超过本轮派发上限');

    const member = this._office.organization.FindMember(input.memberId);

    if (!member?.available || !member.model.engine || !member.model.profileId || !member.model.modelId)
      throw Error(member?.reason ?? '岗位未配置可用引擎和模型；主 Agent 可以在当前工作区直接执行');

    if (path.isAbsolute(input.directory) || input.directory.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.cbim'))
      throw Error('派发目录必须是工作树中的业务相对路径');

    this._count++;

    const workspace = await this._office.OpenWorkspace(input.workspaceId, this._root, input.directory);

    let handle: ReturnType<MainTaskCommands['DispatchTask']> | undefined;

    let detach: (() => void) | undefined;

    let running: Promise<unknown> | undefined;

    const cancel = () => { if (handle && this._office.ListTasks().some(task => task.id === handle!.id && !['completed', 'cancelled', 'blocked'].includes(task.state))) this._commands.Cancel(handle.id); };

    try
    {
      signal.throwIfAborted();

      if (readPermission() !== permission || readPermission() === 'read')
        throw Error('Office 权限已变更，请重新请求派发');

      if (!this._office.project.FindWorkspace(input.workspaceId) || JSON.stringify(this._office.organization.FindMember(member.id)) !== JSON.stringify(member))
        throw Error('业务或岗位定义已变化，请重新 inspect 后派发');

      const target = this._office.members.GetMember(member.id);

      if (ancestors.length && this._office.ListTasks().some(task => task.agentId === target.id && ['waiting', 'queued', 'running'].includes(task.state)))
        throw Error('目标岗位正在执行其他任务，拒绝嵌套等待以避免成员互相阻塞');

      handle = this._commands.DispatchTask({ memberId: member.id, workspaceInstanceId: workspace.instanceId, goal: input.goal, parentTaskId }, async (task, agent, desk, taskSignal) => { const childSignal = AbortSignal.any([signal, taskSignal]); const role = new AgentRole({ id: member.id, name: member.name, position: member.position, instructions: member.position, model: member.model, skills: member.skills, connectorIds: member.connectorIds }, { workspaceId: this._office.workspaceId, taskId: task.id }); const work = (async () => { try { const { engine } = await agent.Open(role, { parameters: childSignal, CreateEngine: async (stop, id, childRole, report, ReadPermission) => ({ session: () => this._run(childRole, input.goal, desk.directory, task.id, stop, ReadPermission, report, this.Operations([...ancestors, member.id], task.id), id), Close: async () => { } }) }); const result = await engine(); childSignal.throwIfAborted(); return { taskId: task.id, agentId: agent.id, memberId: member.id, directory: desk.directory, status: 'completed', summary: result.text, merged: false }; } finally { await agent.Close(); } })(); running = work; return work; });

      const failed = new Promise<never>((_resolve, reject) => { detach = this._office.Subscribe(event => { if (event.type === 'task' && event.task.id === handle?.id && event.task.state === 'suspended') reject(Error(event.task.error ?? '成员执行失败')); }); });

      signal.addEventListener('abort', cancel, { once: true });

      if (signal.aborted)
        cancel();

      return await Promise.race([handle.done, failed]);
    }
    finally
    {
      detach?.();

      signal.removeEventListener('abort', cancel);

      cancel();

      await running?.catch(() => { });

      await workspace.Close();
    }
  }
}
