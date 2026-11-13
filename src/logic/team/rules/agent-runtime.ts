/**
 * 作用定位：主 Agent 执行配置的公开读写契约，供对话栏与团队配置入口共用。
 * 设计原因：主 Agent 是工作区内稳定角色，选型不能归属某个会话；复用自定义 Agent 的完整引擎/模型引用，revision 防止两个入口覆盖彼此的新设置。
 */
import {z} from 'zod';
import {agentModelSelectionSchema} from '../../models';

export const mainAgentIdentitySchema=z.object({workspaceId:z.string().regex(/^[a-f0-9]{64}$/),instanceId:z.string().uuid()}).strict();
/** selection=null 表示尚未指定，采用 Pi 与用户默认模型；不修改旧运行的冻结选型。 */
export const mainAgentSettingsSchema=mainAgentIdentitySchema.extend({agentId:z.literal('cbim:main'),revision:z.number().int().nonnegative().safe(),selection:agentModelSelectionSchema.nullable()}).strict();
export type MainAgentSettingsView=z.infer<typeof mainAgentSettingsSchema>;
