/**
 * 作用定位：声明原主命令只读核实的严格请求、有界报告及写工具支持矩阵，含多边前置修订摘要。
 * 设计原因：原工具失败、领域已提交和业务未验收可以同时成立；叶子协议不导入日志、Store 或命令算法，不把查询变成恢复授权。
 */
import {z} from 'zod';

export const commandReportToolName='cbim_dispatch_command_report';
export const commandVerificationToolNames=['cbim_goal_plan','cbim_goal_review','cbim_dispatch_task','cbim_dispatch_cancel','cbim_dispatch_replace_dependency','cbim_dispatch_add_dependency','cbim_dispatch_revise_dependencies','cbim_dispatch_resume','cbim_dispatch_abandon_checkpoint'] as const;
export type VerifiableMainToolName=typeof commandVerificationToolNames[number];
export const commandVerificationLimits={summaryItems:20,issues:20,outputBytes:128*1024} as const;
const id=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f\x7f]/.test(value),'标识包含空白边界或控制字符');
const pathId=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const seq=z.number().int().nonnegative().safe(),revision=z.number().int().positive().safe();
const graphCursor=z.object({streamId:id,seq}).strict();
const fullCursor=graphCursor.extend({workspaceId:id,rootSessionId:id}).strict();
/** 只选择原调用；scope、工具名、命令键和指纹必须由可信资料推导。 */
export const commandVerificationInputSchema=z.object({workspaceId:pathId,rootSessionId:pathId,runId:pathId,toolCallId:id}).strict();
export type CommandVerificationInput=z.infer<typeof commandVerificationInputSchema>;
/** 模型侧 workspace/root 由主实例闭包固定。 */
export const commandReportToolInputSchema=commandVerificationInputSchema.pick({runId:true,toolCallId:true}).strict();
export type CommandReportToolInput=z.infer<typeof commandReportToolInputSchema>;
const taskList=z.object({total:seq,taskIds:z.array(id).max(commandVerificationLimits.summaryItems),truncated:z.boolean()}).strict().superRefine((value,ctx)=>{
  if(value.taskIds.length!==Math.min(value.total,commandVerificationLimits.summaryItems)||value.truncated!==(value.total>value.taskIds.length)||new Set(value.taskIds).size!==value.taskIds.length)ctx.addIssue({code:'custom',message:'任务摘要数量或截取标记不一致'});
});
const goal={goalRevision:revision,inputRevision:revision,planRevision:revision,recordedAt:z.string().datetime()};
/** 每支只公开原控制面结果的有限身份和版本，不包括原始参数、知识正文或运行准备数据。 */
export const commandResultSummarySchema=z.discriminatedUnion('toolName',[
  z.object({toolName:z.literal('cbim_goal_plan'),...goal,criterionCount:seq,assignmentCount:seq}).strict(),
  z.object({toolName:z.literal('cbim_goal_review'),...goal,reviewRevision:revision,decision:z.enum(['complete','replan','blocked','awaiting_user']),checkCount:seq}).strict(),
  z.object({toolName:z.literal('cbim_dispatch_task'),taskId:id,messageId:id,cursor:fullCursor,disposition:z.enum(['queued','waiting'])}).strict(),
  z.object({toolName:z.literal('cbim_dispatch_cancel'),cancelled:taskList,graphCursor}).strict(),
  z.object({toolName:z.literal('cbim_dispatch_replace_dependency'),taskId:id,status:z.enum(['queued','waiting']),retiredEdgeId:id,replacementEdgeId:id,sourceTaskId:id,sourceRunId:id,sourceResultId:id,tracked:taskList,graphCursor}).strict(),
  z.object({toolName:z.literal('cbim_dispatch_add_dependency'),taskId:id,status:z.literal('waiting'),edgeId:id,sourceTaskId:id,tracked:taskList,graphCursor}).strict(),
  z.object({toolName:z.literal('cbim_dispatch_revise_dependencies'),taskId:id,status:z.enum(['queued','waiting']),removedCount:seq.max(32),addedCount:seq.max(32),tracked:taskList,graphCursor}).strict(),
  z.object({toolName:z.literal('cbim_dispatch_resume'),taskId:id,checkpointId:id,requestId:id,tracked:taskList,cursor:fullCursor}).strict(),
  z.object({toolName:z.literal('cbim_dispatch_abandon_checkpoint'),taskId:id,status:z.literal('cancelled'),checkpointId:id,sourceRunId:id,resumeRequestId:id.nullable(),previousLeaseEpoch:seq,nextLeaseEpoch:seq,abandonedAt:z.string().datetime(),graphCursor}).strict(),
]);
export type CommandResultSummary=z.infer<typeof commandResultSummarySchema>;
export const commandRecordSchema=z.discriminatedUnion('state',[
  z.object({state:z.literal('committed'),commandId:id,requestFingerprint:hash,receiptHash:hash,commit:z.object({transactionSeq:revision,checksum:hash,executionProtocol:z.enum(['legacy','module_owner_v1'])}).strict(),result:commandResultSummarySchema}).strict(),
  z.object({state:z.literal('absent'),commandId:id}).strict(),
  z.object({state:z.literal('unverifiable'),reason:z.enum(['source_unverified','scope_unverified','unsupported_input','missing_prestate','fingerprint_mismatch','receipt_invalid','store_unavailable','changed_during_read'])}).strict(),
  z.object({state:z.literal('not_applicable'),reason:z.enum(['readonly_tool','unsupported_family'])}).strict(),
]);
export type CommandRecord=z.infer<typeof commandRecordSchema>;
/** absent 只表示本次原键下查无已确认记录；不含未执行、可重试或已回滚的判断。 */
export const commandVerificationReportSchema=z.object({
  version:z.literal(1),identity:commandVerificationInputSchema,checkedAt:z.string().datetime(),
  basis:z.object({key:hash,adapterVersion:z.literal(1),logPrefixHash:hash.optional(),throughSeq:seq.optional()}).strict(),
  consistency:z.enum(['stable','changed_during_read']),
  source:z.object({state:z.enum(['verified','missing','invalid','incomplete','legacy_unverified','unavailable']),toolName:id.optional(),runStatus:z.enum(['running','completed','cancelled','failed','interrupted']).optional(),proposedSeq:revision.optional(),allowedSeq:revision.optional(),finishedSeq:revision.optional(),inputHash:hash.optional(),outcome:z.enum(['succeeded','failed','denied','unknown','not_authorized']).optional()}).strict(),
  command:commandRecordSchema,
  scope:z.object({scopeId:id,status:z.enum(['active','waiting','closed']),goalRevision:revision.optional(),inputRevision:revision.optional(),planRevision:revision.optional(),outcome:z.enum(['completed','cancelled','failed','interrupted']).optional()}).strict().optional(),
  issues:z.array(z.object({code:id,severity:z.enum(['info','warning','danger']),message:z.string().min(1).max(512)}).strict()).max(commandVerificationLimits.issues),
  readOnly:z.literal(true),acceptance:z.literal('not_evaluated'),
}).strict().superRefine((value,ctx)=>{
  const issue=(message:string)=>ctx.addIssue({code:'custom',message});
  const source=value.source;
  if((value.basis.logPrefixHash===undefined)!==(value.basis.throughSeq===undefined))issue('日志基线必须同时包含前缀摘要和序号');
  if(source.state==='verified'&&(!source.toolName||!source.proposedSeq||!source.inputHash||!source.outcome||!value.basis.logPrefixHash))issue('已核实调用缺少原提议、输入摘要或结果事实');
  if(value.basis.throughSeq!==undefined&&[source.proposedSeq,source.allowedSeq,source.finishedSeq].some(item=>item!==undefined&&item>value.basis.throughSeq!))issue('工具事实超出报告日志基线');
  if(source.allowedSeq!==undefined&&(!source.proposedSeq||source.allowedSeq<=source.proposedSeq)||source.finishedSeq!==undefined&&(!source.proposedSeq||source.finishedSeq<=source.proposedSeq||source.allowedSeq!==undefined&&source.finishedSeq<=source.allowedSeq))issue('工具事实序号不一致');
  if(value.command.state==='committed'){
    if(source.state!=='verified'||value.consistency!=='stable'||!value.scope||!source.allowedSeq||!source.inputHash||!value.basis.logPrefixHash||source.toolName!==value.command.result.toolName)issue('已提交结论缺少稳定原调用、授权和周期依据');
    const result=value.command.result;
    if('cursor' in result&&(result.cursor.workspaceId!==value.identity.workspaceId||result.cursor.rootSessionId!==value.identity.rootSessionId))issue('原回执游标不属于报告主会话');
    if(result.toolName==='cbim_dispatch_abandon_checkpoint'&&result.nextLeaseEpoch!==result.previousLeaseEpoch+1)issue('原交接租约变化无效');
    if(result.toolName==='cbim_dispatch_revise_dependencies'&&result.removedCount+result.addedCount===0)issue('原前置修订不能是空变更');
  }
  if(value.command.state==='absent'&&(source.state!=='verified'||!source.allowedSeq||!source.toolName||!isVerifiableMainToolName(source.toolName)||!value.scope||value.consistency!=='stable'))issue('查无回执仍须有稳定原调用、授权和周期依据');
  if(value.command.state==='not_applicable'){
    const read=source.toolName!==undefined&&['cbim_goal_inspect','cbim_dispatch_inspect',commandReportToolName].includes(source.toolName);
    if(source.state!=='verified'||!source.toolName||isVerifiableMainToolName(source.toolName)||(value.command.reason==='readonly_tool')!==read)issue('未接入说明与原工具支持矩阵不一致');
  }
});
export type CommandVerificationReport=z.infer<typeof commandVerificationReportSchema>;
/** 唯一 wire 边界另核完整原选择，不能让合法报告串到另一工作区、根、运行或调用。 */
export function commandVerificationReportForInput(input:CommandVerificationInput){
  const expected=commandVerificationInputSchema.parse(input);
  return commandVerificationReportSchema.superRefine((value,context)=>{
    if((Object.keys(expected) as (keyof CommandVerificationInput)[]).some(key=>value.identity[key]!==expected[key]))context.addIssue({code:'custom',message:'原命令报告不属于本次明确选择'});
  });
}
/** 只认显式支持矩阵，原型属性或近似名称不属于已支持命令。 */
export function isVerifiableMainToolName(name:string):name is VerifiableMainToolName{return (commandVerificationToolNames as readonly string[]).includes(name)}
