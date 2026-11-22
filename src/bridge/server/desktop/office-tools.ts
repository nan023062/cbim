/**
 * 作用定位：Office 工具目录与逐次授权。复用原生工具策略，派发调用绑定本轮身份和审批后的原参数。
 * 设计原因：工具目录可见不等于已获授权；每次执行核对 Office 当前权限和原始参数，避免提示词绕过门禁。
 */
import fs from 'node:fs/promises';

import path from 'node:path';

import { nativeToolDescriptor } from '../../../logic/tools/rules/native-tools';

import { authorizeRunTool, type RunToolDescriptor } from '../../../logic/tools/rules/policy/tool-policy';

import { guard } from '../../../logic/execution/platform/tool-guard';

import type { ToolCall, ToolDecision } from '../../../logic/tools/rules/types';

import { zodToJsonSchema } from 'zod-to-json-schema';

import { projectReads, projectWrites, officePlanSchema, officeDispatchSchema, type AgentPermission, type OfficeOperations, type OfficeApproval } from '../../../logic/projects/office-operations';

import type { TaskPermission } from '../../../logic/projects/office-operations';

/** 宿主按实例选择取得的连接器会话。 */
export interface OfficeConnectors
{
  List(): { name: string; description?: string; inputSchema: Record<string, unknown> }[];

  Has(name: string): boolean;

  Describe(name: string, input: unknown): RunToolDescriptor;

  Call(name: string, input: unknown, signal: AbortSignal): Promise<unknown>;
}

/** 单轮工具门禁；运行结束后不复用审批。 */
export class OfficeTools
{
  /** 内部派发的单次授权，不把工具结果或模型消息当作授权。 */
  private readonly _grants = new Map<string,
    {
      name: string;

      input: string;

      permission: AgentPermission
    }>();

  /** 已消费的派发身份，防止同一调用被重复执行。 */
  private readonly _consumed = new Set<string>();

  /** 固定所属工作区及动态权限来源。 */
  public constructor(private readonly _root: string, private readonly _workspaceId: string, private readonly _readPermission: () => AgentPermission, private readonly _operations: OfficeOperations, private readonly _signal: AbortSignal, private readonly _approve?: OfficeApproval, private readonly _connectors?: OfficeConnectors, private readonly _scope?: TaskPermission['snapshot'])
  {
  }

  /** 目录描述可见能力；是否可调用仍由当前权限决定。 */
  public async List()
  {
    this._signal.throwIfAborted();

    return [
      ...(this._operations.ProjectRead ? [
        { name: 'cbim_project_read', description: '读取当前项目的组织、业务、岗位能力、共享资源引用、配置或定时任务及 revision。项目知识只通过本工具访问。', inputSchema: zodToJsonSchema(projectReads) },
      ] : []),
      ...(this._operations.ProjectWrite ? [
        { name: 'cbim_project_write', description: '项目资源只通过此工具增删改，须传入最近读取的 revision。member 保存已登记岗位的能力；references 只增删改项目对共享制品的引用。组织岗位和业务节点立即登记。settings 为项目工作约定；timers 的 at 是带时区时间，value 是到期投递到本对话的指令。', inputSchema: zodToJsonSchema(projectWrites) },
      ] : []),
      ...(this._connectors?.List() ?? []).map(tool => ({ ...tool, description: tool.description ?? tool.name })),
      ...(this._operations.PublishPlan ? [{ name: 'cbim_office_plan', description: '在对话中向团队公布协作计划。按执行顺序列出任务，用前置任务名标明依赖，无依赖填空数组。', inputSchema: zodToJsonSchema(officePlanSchema) }] : []),
      { name: 'cbim_office_inspect', description: '读取当前 Office 的岗位、工作区和任务状态。workspaces.selectable 列出可派发工作区的名称和 ID；派发时使用其中的 id。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'cbim_office_dispatch', description: '向已配置岗位派发任务并等待真实结果。成员继承 Office 权限，在 Office Git 工作树中执行；回执包含实际目录，修改不会自动合并回项目。禁止派给自身或祖先。', inputSchema: { type: 'object', properties: { memberId: { type: 'string' }, workspaceId: { type: 'string', description: '从 cbim_office_inspect 的 workspaces.selectable 选择物理工作区 id。' }, directory: { type: 'string', description: '工作树中的业务相对目录，默认 .' }, goal: { type: 'string' } }, required: ['memberId', 'workspaceId', 'goal'], additionalProperties: false } },
    ];
  }

  /** 核实文件工具真实目标；新文件按最近存在的父目录检查符号链接。 */
  private async Guard(call: ToolCall): Promise<ToolDecision>
  {
    // 宿主终端由本轮授权开放，实际执行仍经过当前权限和审批策略。
    if ((this._scope || this._operations.ProjectRead) && call.name === 'bash')
      return this._scope?.commands === 'host' ? { allow: true } : { allow: false, reason: '本轮任务未获本机终端权限' };

    const reason = guard({ name: call.name === 'find' ? 'Glob' : call.name, input: call.input }, this._root);

    if (reason)
      return { allow: false, reason };

    if (['read', 'write', 'edit', 'ls', 'find', 'glob', 'grep'].includes(call.name))
    {
      const raw = call.input.path ?? this._root;

      if (typeof raw !== 'string' || !raw || raw.includes('\0'))
        return { allow: false, reason: '文件路径无效' };

      const root = await fs.realpath(this._root);

      const allowed = call.name === 'write' || call.name === 'edit' ? this._scope?.writeDirectories : this._scope?.readDirectories;

      if (allowed && !allowed.includes(this._root))
        return { allow: false, reason: '目录不在本次任务授权范围' };

      let target = path.resolve(root, raw);

      const within = (value: string) => { const relative = path.relative(root, value); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };

      if (!within(target))
        return { allow: false, reason: '文件目标必须位于当前工作区' };

      while (true)
      {
        try
        {
          target = await fs.realpath(target);

          break;
        }
        catch (error)
        {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(target) === target)
            throw error;

          // realpath 对悬空链接也返回 ENOENT；不可把链接误当作待创建的文件。
          if ((await fs.lstat(target).catch(e => { if (e.code !== 'ENOENT') throw e; }))?.isSymbolicLink())
            return { allow: false, reason: '目标链接不可解析' };

          target = path.dirname(target);
        }
      }

      if (!within(target) || path.relative(root, target).split(path.sep).some(part => part.toLowerCase() === '.cbim'))
        return { allow: false, reason: '路径链接超出工作区或进入受保护知识目录' };
    }

    return { allow: true };
  }

  /** 原生读写、命令与派发共用 read / ask / execute 策略，未知名称一律拒绝。 */
  public async Authorize(call: ToolCall): Promise<ToolDecision>
  {
    this._signal.throwIfAborted();

    if (!call.id || !call.input || typeof call.input !== 'object' || Array.isArray(call.input))
      return { allow: false, reason: '工具调用身份或参数无效' };

    const manage = call.name === 'cbim_project_read' || call.name === 'cbim_project_write';

    if (manage && (!(call.name === 'cbim_project_read' ? this._operations.ProjectRead : this._operations.ProjectWrite) || !(call.name === 'cbim_project_read' ? projectReads : projectWrites).safeParse(call.input).success))
      return { allow: false, reason: '操作未授权或参数无效；项目知识仅助理可修改' };

    if (manage && this._scope && !(call.name === 'cbim_project_read' ? this._scope.readResources : this._scope.writeResources).includes(String(call.input.resource)))
      return { allow: false, reason: '项目资源操作不在本次任务授权范围' };

    const connector = !manage && !!this._connectors?.Has(call.name);

    const plan = call.name === 'cbim_office_plan';
    if (plan && (!this._operations.PublishPlan || !officePlanSchema.safeParse(call.input).success))
      return { allow: false, reason: '仅助理可公布完整的协作计划' };

    const internal = plan || manage || call.name === 'cbim_office_inspect' || call.name === 'cbim_office_dispatch' || connector;

    const descriptor = connector ? this._connectors!.Describe(call.name, call.input) : internal ? { native: false, effects: [(plan || call.name === 'cbim_project_read' || call.name === 'cbim_office_inspect') ? 'read' as const : 'business-write' as const] } : nativeToolDescriptor(call.name);

    if (!descriptor || this._consumed.has(call.id))
      return { allow: false, reason: '未注册工具或已执行的调用身份' };

    if (call.name === 'cbim_office_dispatch' && !officeDispatchSchema.safeParse(call.input).success)
      return { allow: false, reason: '派发参数无效' };

    let decision: ToolDecision;

    if (connector)
    {
      if ((this._scope?.commands === 'denied' && descriptor.effects.includes('command')) || descriptor.native || !descriptor.effects.length || descriptor.effects.some(effect => !['read', 'business-write', 'external-write', 'command'].includes(effect)))
        return { allow: false, reason: '连接器副作用声明无效' };

      const writes = descriptor.effects.some(effect => effect !== 'read');

      const permission = this._readPermission();

      decision = { allow: !writes || permission === 'execute' || permission === 'ask' && !!this._approve && await this._approve(call, this._root, this._signal) };

      if (writes && (this._readPermission() === 'read' || this._readPermission() !== permission))
        decision = { allow: false, reason: 'Office 权限已变化，请重新请求' };
    }
    else
      decision = await authorizeRunTool(call, descriptor, { workspaceId: this._workspaceId, permission: this._readPermission(), ReadPermission: this._readPermission, Guard: value => this.Guard(value), Approve: this._approve ? async value => ({ allow: await this._approve!(value, this._root, this._signal), reason: '用户对本次操作的审批结果' }) : undefined });

    this._signal.throwIfAborted();

    if (decision.allow && internal)
      this._grants.set(call.id, { name: call.name, input: JSON.stringify(call.input), permission: this._readPermission() });

    return decision;
  }

  /** 消费精确授权后路由 Office 工具；工具失败返回错误而不伪造完成回执。 */
  public async Call(name: string, input: Record<string, unknown>, signal: AbortSignal, id?: string)
  {
    const grant = id ? this._grants.get(id) : undefined;

    if (id)
      this._grants.delete(id);

    try
    {
      this._signal.throwIfAborted();

      signal.throwIfAborted();

      if (!id || !grant || grant.name !== name || grant.input !== JSON.stringify(input) || this._consumed.has(id))
        throw Error('工具调用缺少本次参数的真实授权');

      this._consumed.add(id);

      if ((name === 'cbim_project_write' || name === 'cbim_office_dispatch' || this._connectors?.Has(name)) && this._readPermission() !== grant.permission)
        throw Error('Office 权限已变更，请重新请求操作');

      if (name === 'cbim_office_plan')
      {
        this._operations.PublishPlan!(officePlanSchema.parse(input));
        return { content: [{ type: 'text' as const, text: '计划已在对话中展示' }] };
      }

      if (name === 'cbim_project_read' || name === 'cbim_project_write')
      {
        const result = name === 'cbim_project_read' ? await this._operations.ProjectRead!(projectReads.parse(input)) : await this._operations.ProjectWrite!(projectWrites.parse(input));

        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }

      if (this._connectors?.Has(name))
        return await this._connectors.Call(name, input, AbortSignal.any([signal, this._signal]));

      const result = name === 'cbim_office_inspect' ? this._operations.Inspect() : await this._operations.Dispatch(officeDispatchSchema.parse(input), AbortSignal.any([signal, this._signal]));

      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }
    catch (error)
    {
      return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
    }
  }
}
