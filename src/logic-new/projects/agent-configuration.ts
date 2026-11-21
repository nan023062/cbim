/** 配置边界只接受能力选择，不接受账号凭据或权限覆盖。 */
import { z } from 'zod';

export type { AgentConfiguration } from '../../framework/cability/team';

export const agentConfigurationSchema = z.object({ model: z.object({ engine: z.string().trim().min(1).max(48), profileId: z.string().trim().min(1).max(160), modelId: z.string().trim().min(1).max(160) }).strict().optional(), skills: z.array(z.object({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(100), content: z.string().trim().min(1).max(32000) }).strict()).max(32).default([]), connectorIds: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,47}$/)).max(32).default([]), }).strict().superRefine((value, ctx) => { if (new Set(value.skills.map(skill => skill.id)).size !== value.skills.length || new Set(value.connectorIds).size !== value.connectorIds.length) ctx.addIssue({ code: 'custom', message: 'Skill 或连接器身份重复' }); });

/** 成员与主会话的独立保存目标。 */
export const agentSettingsTargetSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('member'), id: z.string().min(1).max(2048) }).strict(), z.object({ kind: z.literal('main'), id: z.string().uuid() }).strict()]);

export type AgentSettingsTarget = z.infer<typeof agentSettingsTargetSchema>;
