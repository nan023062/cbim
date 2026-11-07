/**
 * 作用定位：成员执行异常核实的只读报告协议，供调度服务与界面共享。
 * 设计原因：派发状态、运行日志与工具回执分别表达不同事实；检查点只表示可供主调度核实的交接，报告不将失败解释为无副作用，也不签发验收或续执行授权。
 */
import {z} from 'zod';
import {memberTaskInput} from './member-commands';
import {graphIdentityInput} from './dispatch-commands';

const id=z.string().min(1).max(128);
const short=z.string().max(512);
const seq=z.number().int().nonnegative();
const cursor=z.object({basis:z.string().regex(/^[a-f0-9]{64}$/),offset:seq}).strict();
const effect=z.enum(['read','preview','maintenance','business-write','knowledge-write','command']);
const scope=z.object({kind:z.enum(['workspace','knowledge','unknown']),workspaceId:id}).strict();
const runStatus=z.enum(['running','completed','cancelled','failed','interrupted']);
const receipt=z.object({version:z.literal(1),toolCallId:id,toolName:short,workspaceId:id,taskId:id,runId:id,outcome:z.enum(['succeeded','failed','denied','unknown']),inputHash:z.string().regex(/^[a-f0-9]{64}$/),resultHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),effects:z.array(effect),scope,recordedAt:z.string().datetime()}).strict();

/** 未指定 runId 时只核实任务领取记录，不猜选最新运行；分页游标仅定位同一报告基线。 */
export const executionReportInputSchema=memberTaskInput.extend({runId:id.regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/).optional(),cursor:cursor.optional(),limit:z.number().int().min(1).max(100).default(50)}).strict();
/** 只公开有界身份、状态和回执摘要；不包含原始工具参数、输出、知识正文或原生会话路径。 */
export const executionReportSchema=z.object({
  identity:memberTaskInput.extend({runId:id.optional()}).strict(),checkedAt:z.string().datetime(),
  basis:z.object({key:z.string().regex(/^[a-f0-9]{64}$/),graphCursor:graphIdentityInput.extend({streamId:id,seq}).strict(),taskRevision:seq,planRevision:seq,taskStatus:z.enum(['planned','queued','running','waiting','result_ready','blocked','failed','cancelled','interrupted','checkpointed']),scopeId:id.optional(),scopeStatus:z.enum(['active','waiting','closed']).optional(),goalRevision:seq.optional(),runStatus:z.enum(['starting','running','completed','failed','cancelled','interrupted']).optional(),logSeq:seq.optional()}).strict(),
  consistency:z.enum(['stable','changed_during_read']),execution:z.enum(['not_started','in_flight','settled','unknown']),
  log:z.object({state:z.enum(['not_expected','not_selected','verified','missing','incomplete','invalid','identity_mismatch','unavailable']),hasTerminal:z.boolean().optional(),summaryStatus:runStatus.optional()}).strict(),
  tools:z.object({available:z.boolean(),total:seq,counts:z.object({succeeded:seq,failed:seq,denied:seq,unknown:seq,not_authorized:seq}).strict(),items:z.array(z.object({toolCallId:id,toolName:short,status:z.enum(['succeeded','failed','denied','unknown','not_authorized']),effects:z.array(effect),scope,proposedSeq:seq.optional(),allowedSeq:seq.optional(),finishedSeq:seq.optional(),receipt:receipt.optional()}).strict()).max(100),nextCursor:cursor.optional(),paginationReset:z.boolean()}).strict(),
  candidate:z.object({resultId:id,runId:id,planRevision:seq,acceptance:z.literal('not_evaluated')}).strict().optional(),
  issues:z.array(z.object({code:id,severity:z.enum(['info','warning','danger']),message:short}).strict()).max(32),
  next:z.object({kind:z.enum(['observe','inspect_effects','new_cycle_only']),reason:short}).strict(),
}).strict();
export type ExecutionReportInput=z.input<typeof executionReportInputSchema>;
/** settled 只说明本次日志终态已核实；candidate 始终未验收，下一步建议不具有执行权限。 */
export type ExecutionReport=z.infer<typeof executionReportSchema>;
