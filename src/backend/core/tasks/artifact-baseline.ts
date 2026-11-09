/**
 * cbim_scoped_read与原单文件来源分别保留真实工具名，不把范围读取伪装成native read。
 * 作用定位：显式文件基线、工具输入及独立只读核实报告的序列化契约。
 * 设计原因：模型只选择真实工具调用，文件字节与日志身份由可信端口采集；基线只覆盖所列文件，不签发业务验收或成员恢复。
 * 职责边界：保持叶子依赖，不引用引擎摘要、图或报告服务；路径为工作区相对标识，不能携带正文、凭据或原生会话路径。
 */
import {z} from 'zod';
const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),logical=z.string().trim().min(1).max(512);
const callId=z.string().min(1).max(128).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
const seq=z.number().int().nonnegative().safe(),positive=seq.min(1),digest=z.string().regex(/^[a-f0-9]{64}$/),time=z.string().datetime();
export const artifactLimits={sources:16,files:16,fileBytes:8*1024*1024,totalBytes:32*1024*1024,baselines:8} as const;
const unique=(values:string[])=>new Set(values).size===values.length;
/** 模型不能填写路径、哈希、运行身份或范围声明。 */
export const artifactCaptureInputSchema=z.object({expectedTaskProgressVersion:positive,sourceToolCallIds:z.array(callId).min(1).max(artifactLimits.sources).refine(unique)}).strict();
export type ArtifactCaptureInput=z.infer<typeof artifactCaptureInputSchema>;
const binding=z.object({workspaceId:id,teamId:logical,agentId:logical,agentInstanceId:id,agentSessionId:id,rootSessionId:id,taskId:id,runId:id,leaseEpoch:seq,planRevision:positive}).strict();
/** Schema 只检查可公开相对格式；真实路径、链接和读取竞争仍由平台端口核实。 */
export const artifactRelativePathSchema=z.string().min(1).max(2048).refine(value=>!/[\\:\x00-\x1f]/.test(value)&&!value.startsWith('/')&&value.split('/').every(part=>!!part&&part!=='.'&&part!=='..'&&part.toLowerCase()!=='.cbim'),'必须是工作区内业务文件的相对路径');
export const artifactFileFactSchema=z.object({relativePath:artifactRelativePathSchema,byteLength:seq.max(artifactLimits.fileBytes),sha256:digest}).strict();
/** 文件端口返回顺序与请求路径一一对应；调用关联由运行时补齐，不能来自文件内容。 */
export type ArtifactFileFact=z.infer<typeof artifactFileFactSchema>;
export const artifactCapturedFileSchema=artifactFileFactSchema.extend({sourceToolCallIds:z.array(callId).min(1).max(artifactLimits.sources).refine(unique)}).strict();
export type ArtifactCapturedFile=z.infer<typeof artifactCapturedFileSchema>;
export const artifactSourceCallSchema=z.object({toolCallId:callId,toolName:z.enum(['read','write','edit','cbim_scoped_read']),allowedSeq:positive,finishedSeq:positive,inputHash:digest,resultHash:digest}).strict().refine(value=>value.allowedSeq<value.finishedSeq);
export type ArtifactSourceCall=z.infer<typeof artifactSourceCallSchema>;
/** 暂存事件不预造自己的日志序号；只有真实成功结束回执匹配后才成为可引用记录。 */
export const artifactBaselineStagedSchema=z.object({version:z.literal(1),baselineId:id,captureToolCallId:callId,binding,knowledgeRevision:logical,progressVersion:positive,capturedAt:time,lastEffectSeq:seq,sourceCalls:z.array(artifactSourceCallSchema).min(1).max(artifactLimits.sources),files:z.array(artifactCapturedFileSchema).min(1).max(artifactLimits.files)}).strict().superRefine((value,context)=>{
  const issue=(message:string)=>context.addIssue({code:z.ZodIssueCode.custom,message});
  const calls=value.sourceCalls.map(call=>call.toolCallId),covered=value.files.flatMap(file=>file.sourceToolCallIds);
  if(!unique(calls)||!unique(covered)||!unique(value.files.map(file=>file.relativePath))||calls.includes(value.captureToolCallId))issue('基线来源、文件及采集调用不能重复或自引用');
  if(calls.length!==covered.length||!calls.every(call=>covered.includes(call)))issue('来源与文件关联必须完整对应');
  if(value.files.reduce((sum,file)=>sum+file.byteLength,0)>artifactLimits.totalBytes)issue('采集文件总字节超限');
});
export type ArtifactBaselineStaged=z.infer<typeof artifactBaselineStagedSchema>;
export const artifactCaptureResultSchema=z.object({state:z.literal('captured'),baseline:artifactBaselineStagedSchema}).strict();
export const artifactBaselineRecordSchema=z.object({baseline:artifactBaselineStagedSchema,capturedSeq:positive,finishedSeq:positive}).strict().refine(value=>value.baseline.lastEffectSeq<value.capturedSeq&&value.capturedSeq<value.finishedSeq&&value.baseline.sourceCalls.every(call=>call.finishedSeq<value.capturedSeq));
export type ArtifactBaselineRecord=z.infer<typeof artifactBaselineRecordSchema>;
/** invalidated 只说明采集后出现了写入/命令或计划修订；历史字节记录仍保留，不修改原任务状态。 */
export const artifactBaselineRefSchema=z.object({baselineId:id,captureToolCallId:callId,knowledgeRevision:logical,progressVersion:positive,capturedAt:time,capturedSeq:positive,finishedSeq:positive,fileCount:positive.max(artifactLimits.files),invalidated:z.boolean()}).strict();
export type ArtifactBaselineRef=z.infer<typeof artifactBaselineRefSchema>;
export const artifactReportInputSchema=z.object({workspaceId:id,rootSessionId:id,taskId:id,runId:id,baselineId:id.optional()}).strict();
export type ArtifactReportInput=z.infer<typeof artifactReportInputSchema>;
const issue=z.object({code:id,message:z.string().min(1).max(512)}).strict();
export const artifactFileCheckSchema=z.object({relativePath:artifactRelativePathSchema,state:z.enum(['matches','changed','missing','unverifiable']),expected:artifactFileFactSchema.omit({relativePath:true}),observed:artifactFileFactSchema.omit({relativePath:true}).optional(),reason:z.string().max(512).optional()}).strict();
export type ArtifactFileCheck=z.infer<typeof artifactFileCheckSchema>;
/** 列表读取不采集文件；明确 baselineId 后才复核，独立 basis 不进入执行报告或恢复证明。 */
export const artifactReportSchema=z.object({identity:artifactReportInputSchema.omit({baselineId:true}),checkedAt:time,basis:digest,consistency:z.enum(['stable','changed_during_read']),log:z.object({state:z.enum(['verified','missing','incomplete','invalid','identity_mismatch','unavailable']),lastSeq:seq.optional()}).strict(),coverage:z.literal('selected_files_only'),impact:z.enum(['selected_files_only','unknown']),baselines:z.array(artifactBaselineRefSchema).max(artifactLimits.baselines),verification:z.object({baselineId:id,state:z.enum(['matches','changed','unverifiable']),files:z.array(artifactFileCheckSchema).max(artifactLimits.files)}).strict().optional(),issues:z.array(issue).max(32)}).strict();
export type ArtifactReport=z.infer<typeof artifactReportSchema>;
