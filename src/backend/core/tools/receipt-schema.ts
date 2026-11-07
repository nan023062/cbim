/**
 * 作用定位：执行报告与任务工具共用的真实工具回执字段协议。
 * 设计原因：回执由运行时生成，公开输出不应各自定义成功、失败或未知；抽取既有报告结构而不改变历史字段。
 * 职责边界：结构通过不证明回执真实，调用者仍核对运行身份、代次和 canonical；可选 resultHash 不补造。
 */
import {z} from 'zod';
import {toolScopeSchema} from './scope-schema';

const id=z.string().min(1).max(128),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const toolReceiptEffectSchema=z.enum(['read','preview','maintenance','business-write','knowledge-write','command']);
/** 保留旧日志允许的空 effects 与缺省 resultHash；业务证据入口另行要求本轮明确成功。 */
export const toolReceiptSchema=z.object({
  version:z.literal(1),toolCallId:id,toolName:z.string().max(512),workspaceId:id,taskId:id,runId:id,
  outcome:z.enum(['succeeded','failed','denied','unknown']),inputHash:digest,resultHash:digest.optional(),
  effects:z.array(toolReceiptEffectSchema),scope:toolScopeSchema,recordedAt:z.string().datetime(),
}).strict();
