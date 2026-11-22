/**
 * 作用定位：Office 对外工具操作契约；目录、模型与权限身份均由宿主装配。
 * 设计原因：将可调用操作与宿主身份绑定分开，模型参数不能替换执行目录、引擎或权限。
 */
import { z } from 'zod';

import { organizationChangeSchema } from './organization-contract';

import { businessChangeSchema } from './business-contract';

import { agentConfigurationSchema } from './agent-configuration';

import { referenceChange } from './project-references';

import { settingsChange, timerChange } from './project-work';

export { issueTaskPermission, type TaskPermission } from './task-permission';

export const projectReads = z.union([z.object({ resource: z.enum(['organization', 'business', 'settings', 'timers', 'references']) }).strict(), z.object({ resource: z.literal('member'), id: z.string().min(1).max(2048) }).strict()]);

export const projectWrites = z.discriminatedUnion('resource', [z.object({ resource: z.literal('organization'), change: organizationChangeSchema }).strict(), z.object({ resource: z.literal('business'), change: businessChangeSchema }).strict(), z.object({ resource: z.literal('member'), id: z.string().min(1).max(2048), revision: z.number().int().nonnegative(), configuration: agentConfigurationSchema }).strict(), z.object({ resource: z.literal('references'), change: referenceChange }).strict(), z.object({ resource: z.literal('settings'), change: settingsChange }).strict(), z.object({ resource: z.literal('timers'), change: timerChange }).strict(),]);

export type { AgentPermission } from '../../framework/cability/organization';

/** 助理发给团队的公开计划；任务数组按执行顺序排列。 */
export const officePlanSchema = z.object({ goal: z.string().trim().min(1), business: z.string().trim().min(1), organization: z.string().trim().min(1), tasks: z.array(z.object({ title: z.string().trim().min(1), owner: z.string().trim().min(1), workspace: z.string().trim().min(1), purpose: z.string().trim().min(1), dependencies: z.array(z.string().min(1)) }).strict()).min(1) }).strict();

/** 派发只引用已登记岗位和工作区，不接受权限或任意模型身份。 */
export const officeDispatchSchema = z.object({ memberId: z.string().min(1).max(2048), workspaceId: z.string().min(1).max(2048), directory: z.string().min(1).max(2048).default('.'), goal: z.string().trim().min(1).max(32000) }).strict();

/** 本次派发的业务目标及工位选择。 */
export type OfficeDispatchInput = z.infer<typeof officeDispatchSchema>;

/** 宿主提供的 Office 操作；模型不持有 Office 对象。 */
export interface OfficeOperations
{
  /** 返回当前办公室的岗位、业务节点和真实任务状态。 */
  Inspect(): unknown;

  PublishPlan?(plan: z.infer<typeof officePlanSchema>): void;

  ProjectRead?(input: z.infer<typeof projectReads>): Promise<unknown>;

  ProjectWrite?(input: z.infer<typeof projectWrites>): Promise<unknown>;

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
