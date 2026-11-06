/**
 * 作用定位：定义用户显式新建只读核实周期的请求、冻结启动意图及公开回执。
 * 设计原因：异常周期保持封存，新主原生上下文与执行实例只通过一次性意图创建；用户观察是陈述，不改写旧回执，也不代表人工业务验收或可写重试许可。
 */
import {z} from 'zod';
import {graphIdentityInput} from './dispatch-commands';
import {scopeContinuationOptionsSchema} from './scope-continuation';
import {executionReportSchema} from './execution-report';

const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const text=z.string().max(64_000).refine(value=>value.trim().length>0,'核实说明不能为空');
const source=z.object({scopeId:id,taskId:id,runId:id.optional(),reportBasis:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const observation=z.object({text}).strict();
const input=z.object({message:text}).strict();
const options=scopeContinuationOptionsSchema.extend({permission:z.literal('read')}).strict();
/** 首版只接纯文本与只读核实，不接附件、任意原生路径、结果更正或人工批准。 */
export const recoveryRequestSchema=graphIdentityInput.extend({commandId:z.string().uuid(),source,operation:z.literal('inspect_effects'),observation,input,options}).strict();
export type RecoveryRequest=z.infer<typeof recoveryRequestSchema>;
/** 同一命令先查询持久回执；undefined 不代表可换 ID 自动重发。 */
export const recoveryLookupSchema=recoveryRequestSchema.pick({workspaceId:true,rootSessionId:true,commandId:true}).strict();
export type RecoveryLookup=z.infer<typeof recoveryLookupSchema>;
/** 旧运行集合在取得租约后由可信存储枚举，最多 4096 项；只隔离已登记旧链，不能忽略新链的未知日志。 */
export const recoveryContextSchema=z.object({initialRunId:id,nativeSessionId:z.string().uuid(),excludedRunIds:z.array(id).max(4096).refine(ids=>new Set(ids).size===ids.length,'旧运行身份不能重复')}).strict().refine(value=>!value.excludedRunIds.includes(value.initialRunId),'新运行不能被排除');
export type RecoveryContext=z.infer<typeof recoveryContextSchema>;
/** 新 scope 中不可变的核实来源与启动边界；不向已关闭来源周期追加字段。 */
export const scopeRecoverySchema=z.object({recoveryId:z.string().uuid(),acceptedAt:z.string().datetime(),source:source.extend({taskRevision:z.number().int().positive().safe(),planRevision:z.number().int().positive().safe(),scopeOutcome:z.enum(['completed','failed','cancelled','interrupted']),reportExecution:executionReportSchema.shape.execution,logState:executionReportSchema.shape.log.shape.state,unknownToolCount:z.number().int().nonnegative().safe()}).strict(),operation:z.literal('inspect_effects'),observation,input,options,context:recoveryContextSchema}).strict();
export type ScopeRecovery=z.infer<typeof scopeRecoverySchema>;
/** 公开回执不返回整个旧运行排除集合；runId 只证明受理意图，不保证模型已启动。 */
export const recoveryReceiptSchema=graphIdentityInput.extend({scopeId:id,scopeStatus:z.enum(['active','waiting','closed']),recovery:scopeRecoverySchema.omit({context:true}).extend({runId:id}).strict()}).strict();
export type RecoveryReceipt=z.infer<typeof recoveryReceiptSchema>;
