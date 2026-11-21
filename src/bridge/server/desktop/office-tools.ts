/** Office 工具目录与逐次授权。复用原生工具策略，派发调用绑定本轮身份和审批后的原参数。 */
import fs from 'node:fs/promises';

import path from 'node:path';

import { nativeToolDescriptor } from '../../../logic/tools/rules/native-tools';

import { authorizeRunTool, type RunToolDescriptor } from '../../../logic/tools/rules/policy/tool-policy';

import { guard } from '../../../logic/execution/platform/tool-guard';

import type { ToolCall, ToolDecision } from '../../../logic/tools/rules/types';

import { officeDispatchSchema, type AgentPermission, type OfficeOperations, type OfficeApproval } from '../../../logic-new/projects/office-operations';

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
  public constructor(private readonly _root: string, private readonly _workspaceId: string, private readonly _readPermission: () => AgentPermission, private readonly _operations: OfficeOperations, private readonly _signal: AbortSignal, private readonly _approve?: OfficeApproval, private readonly _connectors?: OfficeConnectors)
  {
  }

  /** 目录描述可见能力；是否可调用仍由当前权限决定。 */
  public async List()
  {
    return [
      ...(this._connectors?.List() ?? []).map(tool => ({ ...tool, description: tool.description ?? tool.name })),
      { name: 'cbim_office_inspect', description: '读取当前 Office 的已登记岗位、工作区和任务状态；先核对 available 与模型配置再派发。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'cbim_office_dispatch', description: '向已配置岗位派发任务并等待真实结果。成员继承 Office 权限，在 Office Git 工作树中执行；回执包含实际目录，修改不会自动合并回项目。禁止派给自身或祖先。', inputSchema: { type: 'object', properties: { memberId: { type: 'string' }, workspaceId: { type: 'string' }, directory: { type: 'string', description: '工作树中的业务相对目录，默认 .' }, goal: { type: 'string' } }, required: ['memberId', 'workspaceId', 'goal'], additionalProperties: false } },
    ];
  }

  /** 核实文件工具真实目标；新文件按最近存在的父目录检查符号链接。 */
  private async Guard(call: ToolCall): Promise<ToolDecision>
  {
    const reason = guard({ name: call.name === 'find' ? 'Glob' : call.name, input: call.input }, this._root);

    if (reason)
      return { allow: false, reason };

    if (['read', 'write', 'edit', 'ls', 'find', 'grep'].includes(call.name))
    {
      const raw = call.input.path ?? this._root;

      if (typeof raw !== 'string' || !raw || raw.includes('\0'))
        return { allow: false, reason: '文件路径无效' };

      const root = await fs.realpath(this._root);

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

    const connector = !!this._connectors?.Has(call.name);

    const internal = call.name === 'cbim_office_inspect' || call.name === 'cbim_office_dispatch' || connector;

    const descriptor = connector ? this._connectors!.Describe(call.name, call.input) : internal ? { native: false, effects: [call.name === 'cbim_office_inspect' ? 'read' as const : 'business-write' as const] } : nativeToolDescriptor(call.name);

    if (!descriptor || this._consumed.has(call.id))
      return { allow: false, reason: '未注册工具或已执行的调用身份' };

    if (call.name === 'cbim_office_dispatch' && !officeDispatchSchema.safeParse(call.input).success)
      return { allow: false, reason: '派发参数无效' };

    let decision: ToolDecision;

    if (connector)
    {
      if (descriptor.native || !descriptor.effects.length || descriptor.effects.some(effect => !['read', 'business-write', 'external-write', 'command'].includes(effect)))
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

      if ((name === 'cbim_office_dispatch' || this._connectors?.Has(name)) && this._readPermission() !== grant.permission)
        throw Error('Office 权限已变更，请重新请求操作');

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
