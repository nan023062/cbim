/**
 * 作用定位：定义执行成员向主调度单向提交的结构化求助，以及安全结算后的不可变交接记录。
 * 设计原因：求助不是用户授权、成功候选或可恢复停泊；模型只表达问题，运行身份来自可信绑定，日志序号由结算读取 canonical 事件后确定。
 */
import {z} from 'zod';
const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),logical=z.string().min(1).max(512),seq=z.number().int().nonnegative().safe();
/** 不接受接收人、scope、模块或权限参数；由当前正式执行任务决定求助归属。 */
export const memberHelpInputSchema=z.object({kind:z.enum(['missing_input','dependency','permission','capability','scope']),reason:z.string().trim().min(1).max(4000),question:z.string().trim().min(1).max(4000),attemptedToolCallIds:z.array(id).max(30).refine(ids=>new Set(ids).size===ids.length,'尝试的调用不能重复')}).strict();
export type MemberHelpInput=z.infer<typeof memberHelpInputSchema>;
const binding=z.object({workspaceId:id,teamId:logical,agentId:logical,agentInstanceId:id,agentSessionId:id,rootSessionId:id,taskId:id,runId:id,leaseEpoch:seq,planRevision:seq.min(1)}).strict();
/** staged 只证明本轮记录了请求；正常结束和安全证据检查前不能投递主调度或显示为已交接。 */
export const memberHelpStagedSchema=z.object({helpId:id,toolCallId:id,binding,input:memberHelpInputSchema,requestedAt:z.string().datetime()}).strict();
export type MemberHelpStaged=z.infer<typeof memberHelpStagedSchema>;
/** 工具正文固定结构；真正的 ToolReceipt 仍由运行时统一签发，不在这里另造执行回执。 */
export const memberHelpResultSchema=z.object({state:z.literal('staged'),help:memberHelpStagedSchema}).strict();
/** 唯有结算端可追加这些 canonical 序号；求助记录不带可变“已解决”或“批准”状态。 */
export const memberHelpRecordSchema=memberHelpStagedSchema.extend({requestedSeq:seq.min(1),finishedSeq:seq.min(1),lastEffectSeq:seq}).strict().refine(value=>value.requestedSeq<value.finishedSeq&&value.lastEffectSeq<value.requestedSeq,'求助交接日志顺序无效');
export type MemberHelpRecord=z.infer<typeof memberHelpRecordSchema>;
