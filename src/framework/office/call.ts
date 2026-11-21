/**
 * 作用定位：Office 查询、派发和回传工具的名称、校验及约束错误契约。
 * 设计原因：父运行与工具调用标识限定派发关联，严格输入契约不允许调用者注入任意运行身份。
 */
import { z } from 'zod';

export const agentCallToolName = 'cbim_agent_call';

export const agentListToolName = 'cbim_agent_list';

export const agentReplyToolName = 'cbim_agent_reply';

export interface AgentCallReference
{
  version: 1;

  workspaceId: string;

  callerTaskId: string;

  callerRunId: string;

  toolCallId: string;

  taskId: string;

  runId: string
}

/** 父子日志共用严格引用格式；不接受任意路径、额外身份或自己调用自己的引用。 */
export const agentCallReferenceSchema = z.object({ version: z.literal(1), workspaceId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/), callerTaskId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/), callerRunId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/), toolCallId: z.string().min(1).max(512), taskId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/), runId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/) }).strict();

/** 仅核验引用本身与当前子运行身份；父日志授权和周期归属仍由读取者校验。 */
export function checkedAgentCallReference(value: unknown, task: { workspaceId: string; taskId: string }, runId: string): AgentCallReference
{
  const ref = agentCallReferenceSchema.parse(value);

  if (ref.workspaceId !== task.workspaceId || ref.taskId !== task.taskId || ref.runId !== runId || ref.callerTaskId === ref.taskId || ref.callerRunId === ref.runId)
    throw Error('Agent 调用引用与子运行身份不一致');

  return ref;
}

export class AgentConstraintError extends Error
{
  public constructor(public readonly code: string, message: string, public readonly constraint: { current: number; requested: number; limit: number; unit: string })
  {
    super(message)
  }
}
