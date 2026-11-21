/** Office 待执行指令的纯契约；提交时固定能力和权限，排序不改变配置。 */
import { z } from 'zod';

import { agentConfigurationSchema } from './agent-configuration';

export const officeQueueItemSchema = z.object({ id: z.string().uuid(), text: z.string().trim().min(1).max(32000), created: z.number().nonnegative(), started: z.number().nonnegative().optional(), permission: z.enum(['read', 'ask', 'execute']), configuration: agentConfigurationSchema, status: z.enum(['queued', 'running', 'inserting', 'inserted', 'failed', 'uncertain']), inputId: z.string().uuid().optional(), error: z.string().optional() }).strict();

export const officeQueueStateSchema = z.object({ revision: z.number().int().nonnegative(), paused: z.boolean(), items: z.array(officeQueueItemSchema).max(100), accepted: z.array(z.string().uuid()).max(1000) }).strict();

export const officeQueueActionSchema = z.discriminatedUnion('action', [z.object({ action: z.literal('enqueue'), id: z.string().uuid(), text: z.string().trim().min(1).max(32000), permission: z.enum(['read', 'ask', 'execute']), selection: z.object({ engine: z.string().min(1).max(48), profileId: z.string().min(1).max(160), modelId: z.string().min(1).max(160) }).strict() }).strict(), z.object({ action: z.literal('move'), revision: z.number().int().nonnegative(), id: z.string().uuid(), beforeId: z.string().uuid().optional() }).strict(), z.object({ action: z.literal('edit'), revision: z.number().int().nonnegative(), id: z.string().uuid(), text: z.string().trim().min(1).max(32000) }).strict(), z.object({ action: z.literal('remove'), revision: z.number().int().nonnegative(), id: z.string().uuid() }).strict(), z.object({ action: z.literal('insert'), revision: z.number().int().nonnegative(), id: z.string().uuid() }).strict(), z.object({ action: z.literal('retry'), revision: z.number().int().nonnegative(), id: z.string().uuid() }).strict(), z.object({ action: z.literal('resume') }).strict(), z.object({ action: z.literal('pause') }).strict(), z.object({ action: z.literal('stop') }).strict()]);

export type OfficeQueueState = z.infer<typeof officeQueueStateSchema>;

export type OfficeQueueItem = z.infer<typeof officeQueueItemSchema>;

export type OfficeQueueAction = z.infer<typeof officeQueueActionSchema>;

export type OfficeQueueSnapshot = OfficeQueueState &
{
  running: boolean
};
