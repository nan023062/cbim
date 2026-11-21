/**
 * 作用定位：Office 待执行指令的纯契约；提交时固定能力和权限，排序不改变配置。
 * 设计原因：每项指令保存提交时配置，拖动顺序只改变排程，不重新解释用户当时的能力选择。
 */
import { z } from 'zod';

import { agentConfigurationSchema } from './agent-configuration';

export const officeQueueItemSchema = z.object({ id: z.string().uuid(), text: z.string().trim().min(1).max(32000), created: z.number().nonnegative(), started: z.number().nonnegative().optional(), permission: z.enum(['read', 'ask', 'execute']), configuration: agentConfigurationSchema, status: z.enum(['queued', 'running', 'inserting', 'inserted', 'failed', 'uncertain']), cancelSource: z.enum(['user-stop', 'app-shutdown', 'unknown']).optional(), inputId: z.string().uuid().optional(), error: z.string().optional() }).strict();

const stageSchema = z.enum(['准备会话','检查引擎更新','加载本地引擎','解析模型配置','连接工具','启动引擎','已交给引擎，等待响应','已发起模型请求','收到供应商响应头','收到首个回复','执行工具','等待引擎继续','保存回复']);
export type OfficeStage = z.infer<typeof stageSchema>;
export type ReportStage = (stage: OfficeStage) => Promise<void>;
const attemptSchema = z.object({ id: z.string().uuid(), itemId: z.string().uuid(), started: z.number(), ended: z.number().optional(), outcome: z.enum(['running','completed','failed','interrupted']), errorClass: z.string().optional(), timeoutMs: z.number().optional(), events: z.array(z.object({ stage: stageSchema, at: z.number() })).max(48) });

export const officeQueueStateSchema = z.object({ revision: z.number().int().nonnegative(), paused: z.boolean(), attempts: z.array(attemptSchema).max(100).optional(), items: z.array(officeQueueItemSchema).max(100), accepted: z.array(z.string().uuid()).max(1000) }).strict();

export const officeQueueActionSchema = z.discriminatedUnion('action', [z.object({ action: z.literal('enqueue'), id: z.string().uuid(), text: z.string().trim().min(1).max(32000), permission: z.enum(['read', 'ask', 'execute']), connectorIds: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,47}$/)).max(32).optional(), selection: z.object({ engine: z.string().min(1).max(48), profileId: z.string().min(1).max(160), modelId: z.string().min(1).max(160) }).strict() }).strict(), z.object({ action: z.literal('move'), revision: z.number().int().nonnegative(), id: z.string().uuid(), beforeId: z.string().uuid().optional() }).strict(), z.object({ action: z.literal('edit'), revision: z.number().int().nonnegative(), id: z.string().uuid(), text: z.string().trim().min(1).max(32000) }).strict(), z.object({ action: z.literal('remove'), revision: z.number().int().nonnegative(), id: z.string().uuid() }).strict(), z.object({ action: z.literal('insert'), revision: z.number().int().nonnegative(), id: z.string().uuid() }).strict(), z.object({ action: z.literal('start'), revision: z.number().int().nonnegative(), id: z.string().uuid() }).strict(), z.object({ action: z.literal('retry'), revision: z.number().int().nonnegative(), id: z.string().uuid() }).strict(), z.object({ action: z.literal('resume') }).strict(), z.object({ action: z.literal('pause') }).strict(), z.object({ action: z.literal('stop') }).strict()]);

export type OfficeQueueState = z.infer<typeof officeQueueStateSchema>;

export type OfficeQueueItem = z.infer<typeof officeQueueItemSchema>;

export type OfficeQueueAction = z.infer<typeof officeQueueActionSchema>;

export type OfficeQueueSnapshot = OfficeQueueState &
{
  running: boolean
};
