/**
 * 目录归属：backend/core/file-operations；受控文件与隔离协议。
 * 作用定位：受控单文件写入、原操作报告和本机补偿的公共纯协议，供运行时与 Bridge 共用。
 * 设计原因：只公开身份与字节摘要，真实备份和平台文件身份留在私有事件；applied 只证明操作事实，不是业务验收。ledger 纯契约供影响观察复用，查询时钟不进入处置依据。
 */
import {z} from 'zod';

export const controlledFileWriteToolName='cbim_file_write_controlled' as const;
export const controlledFileLimits={contentBytes:1024*1024,inputBytes:3*1024*1024,outputBytes:128*1024,pathCharacters:2048,writesPerRun:8,operationsPerRoot:64,operations:256,compensations:8,changesPerOperation:3,storedBytes:16*1024*1024,terminalReserveBytes:8192,blobBytes:64*1024*1024,reasonBytes:4096,issues:16} as const;
const id=z.string().min(1).max(512).refine(v=>v.trim()===v&&!/[\x00-\x1f\x7f]/.test(v),'标识含空白或控制字符');
const digest=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().uuid(),time=z.string().datetime(),positive=z.number().int().positive().safe(),count=z.number().int().nonnegative().safe();
/** 只检测 Unicode 完整性，不替换未配对代理字符或重新编码已读取的 before 字节。 */
export function controlledFileUtf8Bytes(value:string):number|undefined{for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const n=value.charCodeAt(++i);if(!(n>=0xdc00&&n<=0xdfff))return undefined}else if(c>=0xdc00&&c<=0xdfff)return undefined}return new TextEncoder().encode(value).length}
const boundedText=(max:number)=>z.string().refine(v=>{const length=controlledFileUtf8Bytes(v);return length!==undefined&&length<=max},'文本必须是有效且有界的 UTF-8');
export const controlledFilePathSchema=z.string().min(1).max(controlledFileLimits.pathCharacters).refine(v=>v.trim()===v&&!/[\\:\x00-\x1f\x7f]/.test(v)&&!v.startsWith('/')&&v.split('/').every(p=>p!==''&&p!=='.'&&p!=='..'),'必须是规范的工作区相对文件路径');
export const controlledFileContentFactSchema=z.object({byteLength:count.max(controlledFileLimits.contentBytes),sha256:digest}).strict();
export type ControlledFileContentFact=z.infer<typeof controlledFileContentFactSchema>;
/** 结构等同正式成员的十项绑定；通过 Schema 不等于获得新执行许可。 */
export const controlledFileBindingSchema=z.object({workspaceId:id,teamId:id,agentId:id,agentInstanceId:id,agentSessionId:id,rootSessionId:id,taskId:id,runId:id,leaseEpoch:count,planRevision:positive}).strict();
export type ControlledFileBinding=z.infer<typeof controlledFileBindingSchema>;
export const controlledFileIssueSchema=z.object({code:z.string().min(1).max(100).regex(/^[A-Z0-9_]+$/),message:z.string().min(1).max(512)}).strict();
export type ControlledFileIssue=z.infer<typeof controlledFileIssueSchema>;
const issues=z.array(controlledFileIssueSchema).max(controlledFileLimits.issues);
export const controlledFilePhaseSchema=z.enum(['prepared','executing','applied','not_applied','unknown']);
export type ControlledFilePhase=z.infer<typeof controlledFilePhaseSchema>;
export const controlledFileWriteInputSchema=z.object({path:controlledFilePathSchema,expectedBefore:controlledFileContentFactSchema,content:boundedText(controlledFileLimits.contentBytes)}).strict().superRefine((v,c)=>{if(new TextEncoder().encode(JSON.stringify(v)).length>controlledFileLimits.inputBytes)c.addIssue({code:'custom',message:'编码后的工具参数超过上限'})});
export type ControlledFileWriteInput=z.infer<typeof controlledFileWriteInputSchema>;
export const controlledFileWriteAppliedSchema=z.object({version:z.literal(1),state:z.literal('applied'),operationId:digest,revision:z.literal(3),scopeId:id,binding:controlledFileBindingSchema,toolCallId:id,inputHash:digest,relativePath:controlledFilePathSchema,before:controlledFileContentFactSchema,after:controlledFileContentFactSchema,appliedAt:time,coverage:z.literal('single_file_default_stream'),acceptance:z.literal('not_evaluated')}).strict();
export type ControlledFileWriteApplied=z.infer<typeof controlledFileWriteAppliedSchema>;
export const controlledFileWriteOutputSchema=z.object({state:z.literal('applied'),operation:controlledFileWriteAppliedSchema}).strict();
export type ControlledFileWriteOutput=z.infer<typeof controlledFileWriteOutputSchema>;
export const controlledFileReportInputSchema=z.object({workspaceId:id,rootSessionId:id,taskId:id,runId:id,toolCallId:id}).strict();
export type ControlledFileReportInput=z.infer<typeof controlledFileReportInputSchema>;
const phaseRevision=(v:{phase:ControlledFilePhase;revision:number})=>v.phase==='prepared'?v.revision===1:v.phase==='executing'?v.revision===2:v.phase==='not_applied'?[2,3].includes(v.revision):v.revision===3;
export const controlledFileOperationSummarySchema=z.object({operationId:digest,scopeId:id,binding:controlledFileBindingSchema,toolCallId:id,revision:positive.max(3),phase:controlledFilePhaseSchema,relativePath:controlledFilePathSchema,before:controlledFileContentFactSchema,intendedAfter:controlledFileContentFactSchema,preparedAt:time,updatedAt:time,issue:controlledFileIssueSchema.optional()}).strict().refine(phaseRevision,'操作阶段与版本不一致');
export type ControlledFileOperationSummary=z.infer<typeof controlledFileOperationSummarySchema>;
export const fileCompensationSummarySchema=z.object({compensationId:digest,commandId:uuid,revision:positive.max(3),phase:controlledFilePhaseSchema,preparedAt:time,updatedAt:time,issue:controlledFileIssueSchema.optional()}).strict().refine(phaseRevision,'补偿阶段与版本不一致');
export type FileCompensationSummary=z.infer<typeof fileCompensationSummarySchema>;
/** 原阶段及补偿序列是稳定事实；不含查询时钟或新的补偿资格。 */
export const controlledFileLedgerSchema=z.union([
  z.object({state:z.enum(['absent','unverifiable']),issues}).strict(),
  z.object({state:z.literal('recorded'),operation:controlledFileOperationSummarySchema,originalExecution:z.enum(['in_flight','settled','unavailable']),compensationRevision:count.max(controlledFileLimits.compensations),compensations:z.array(fileCompensationSummarySchema).max(controlledFileLimits.compensations)}).strict(),
]);
export const controlledFileReportSchema=z.object({version:z.literal(1),identity:controlledFileReportInputSchema,checkedAt:time,ledger:controlledFileLedgerSchema,readOnly:z.literal(true),acceptance:z.literal('not_evaluated')}).strict().superRefine((v,c)=>{if(v.ledger.state!=='recorded')return;const {binding,toolCallId}=v.ledger.operation;if(['workspaceId','rootSessionId','taskId','runId'].some(k=>binding[k as keyof ControlledFileBinding]!==v.identity[k as keyof ControlledFileReportInput])||toolCallId!==v.identity.toolCallId||v.ledger.compensationRevision!==v.ledger.compensations.length||new Set(v.ledger.compensations.map(x=>x.compensationId)).size!==v.ledger.compensations.length)c.addIssue({code:'custom',message:'报告与原调用身份或补偿序列不一致'})});
export type ControlledFileReport=z.infer<typeof controlledFileReportSchema>;
export const fileCompensationPreviewInputSchema=z.object({workspaceId:id,instanceId:uuid,rootSessionId:id,operationId:digest}).strict();
export type FileCompensationPreviewInput=z.infer<typeof fileCompensationPreviewInputSchema>;
export const fileCompensationPreviewSchema=z.object({version:z.literal(1),identity:fileCompensationPreviewInputSchema,checkedAt:time,eligible:z.boolean(),basis:digest.optional(),operationRevision:positive.max(3),compensationRevision:count.max(controlledFileLimits.compensations),source:controlledFileOperationSummarySchema,observed:z.object({state:z.enum(['matches','changed','missing','unverifiable']),fact:controlledFileContentFactSchema.optional()}).strict(),restore:controlledFileContentFactSchema,issues,limitations:z.array(z.string().min(1).max(512)).max(16),readOnly:z.literal(true),acceptance:z.literal('not_evaluated')}).strict().superRefine((v,c)=>{if(v.identity.operationId!==v.source.operationId||v.identity.workspaceId!==v.source.binding.workspaceId||v.identity.rootSessionId!==v.source.binding.rootSessionId||v.operationRevision!==v.source.revision||v.restore.sha256!==v.source.before.sha256||v.restore.byteLength!==v.source.before.byteLength||v.eligible&&(!v.basis||v.source.phase!=='applied'||v.observed.state!=='matches'||v.observed.fact?.sha256!==v.source.intendedAfter.sha256||v.observed.fact?.byteLength!==v.source.intendedAfter.byteLength)||!v.eligible&&v.basis!==undefined)c.addIssue({code:'custom',message:'预览来源、恢复摘要或资格依据不一致'})});
export type FileCompensationPreview=z.infer<typeof fileCompensationPreviewSchema>;
export const fileCompensationInputSchema=z.object({workspaceId:id,instanceId:uuid,rootSessionId:id,commandId:uuid,operationId:digest,expectedOperationRevision:z.literal(3),expectedCompensationRevision:count.max(controlledFileLimits.compensations),expectedBasis:digest,reason:boundedText(controlledFileLimits.reasonBytes).refine(v=>v.trim().length>0,'必须说明补偿理由')}).strict();
export type FileCompensationInput=z.infer<typeof fileCompensationInputSchema>;
export const fileCompensationLookupSchema=z.object({workspaceId:id,rootSessionId:id,commandId:uuid}).strict();
export type FileCompensationLookup=z.infer<typeof fileCompensationLookupSchema>;
export const fileCompensationActorSchema=z.object({kind:z.literal('local_desktop'),interaction:z.literal('explicit_submit'),instanceId:uuid}).strict();
export type FileCompensationActor=z.infer<typeof fileCompensationActorSchema>;
export const fileCompensationReceiptSchema=z.object({version:z.literal(1),workspaceId:id,rootSessionId:id,commandId:uuid,compensationId:digest,operationId:digest,request:fileCompensationInputSchema,actor:fileCompensationActorSchema,revision:positive.max(3),phase:controlledFilePhaseSchema,preparedAt:time,updatedAt:time,relativePath:controlledFilePathSchema,before:controlledFileContentFactSchema,after:controlledFileContentFactSchema,issue:controlledFileIssueSchema.optional(),acceptance:z.literal('not_evaluated')}).strict().superRefine((v,c)=>{if(!phaseRevision(v)||v.workspaceId!==v.request.workspaceId||v.rootSessionId!==v.request.rootSessionId||v.commandId!==v.request.commandId||v.operationId!==v.request.operationId||v.actor.instanceId!==v.request.instanceId)c.addIssue({code:'custom',message:'补偿回执与原请求、来源或阶段不一致'})});
export type FileCompensationReceipt=z.infer<typeof fileCompensationReceiptSchema>;
