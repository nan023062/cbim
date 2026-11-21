/** Office 对外工具操作契约；目录、模型与权限身份均由宿主装配。 */
import { z } from 'zod';

export type { AgentPermission } from '../../framework/cability/organization';

/** 派发只引用已登记岗位和工作区，不接受权限或任意模型身份。 */
export const officeDispatchSchema = z.object({ memberId: z.string().min(1).max(2048), workspaceId: z.string().min(1).max(2048), directory: z.string().min(1).max(2048).default('.'), goal: z.string().trim().min(1).max(32000) }).strict();

/** 本次派发的业务目标及工位选择。 */
export type OfficeDispatchInput = z.infer<typeof officeDispatchSchema>;

/** 宿主提供的 Office 操作；模型不持有 Office 对象。 */
export interface OfficeOperations
{
  /** 返回当前办公室的岗位、业务节点和真实任务状态。 */
  Inspect(): unknown;

  /** 等待真实子运行，返回结果及实际工作树目录，不自动合并到项目。 */
  Dispatch(input: OfficeDispatchInput, signal: AbortSignal): Promise<unknown>;
}

/** 受管引擎提供的单次工具调用身份及原始参数。 */
export interface OfficeToolCall
{
  /** 本轮内不可重复的调用身份。 */
  id: string;

  /** 实际注册的工具名。 */
  name: string;

  /** 模型请求参数；不能包含可信权限。 */
  input: Record<string, unknown>;
}

/** 桌面确认显示原始操作和目录，缺少审批时 ask 不允许副作用。 */
export type OfficeApproval = (call: OfficeToolCall, root: string, signal: AbortSignal) => Promise<boolean>;
