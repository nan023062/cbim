/**
 * 作用定位：定义成员有界文件任务的合作式检查点请求、可信交接记录和后端原生历史证明。
 * 设计原因：模型请求不等于安全停泊；仅正常关闭并核实全部来源后交接，同任务最多一个检查点及一次续执行，不复活异常或求助记录。
 */
import {z} from 'zod';
const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),logical=z.string().min(1).max(512),seq=z.number().int().nonnegative().safe(),digest=z.string().regex(/^[a-f0-9]{64}$/);
/** 模型只能引用本轮已确认的文件基线，不能指定路径、原生会话或恢复权限。 */
export const memberCheckpointInputSchema=z.object({expectedTaskProgressVersion:seq.min(1),baselineId:id,reason:z.string().trim().min(1).max(4000)}).strict();
export type MemberCheckpointInput=z.infer<typeof memberCheckpointInputSchema>;
const binding=z.object({workspaceId:id,teamId:logical,agentId:logical,agentInstanceId:id,agentSessionId:id,rootSessionId:id,taskId:id,runId:id,leaseEpoch:seq,planRevision:seq.min(1)}).strict();
/** 暂存事件仍需成功工具回执及真实正常终态；时间与运行身份仅由运行时生成。 */
export const memberCheckpointStagedSchema=z.object({version:z.literal(1),checkpointId:id,toolCallId:id,binding,input:memberCheckpointInputSchema,knowledgeRevision:logical,requestedAt:z.string().datetime(),lastEffectSeq:seq}).strict();
export type MemberCheckpointStaged=z.infer<typeof memberCheckpointStagedSchema>;
export const memberCheckpointResultSchema=z.object({state:z.literal('staged'),checkpoint:memberCheckpointStagedSchema}).strict();
/** 公开交接记录只带真实序号；日志和原生历史指纹留在后端 proof 中。 */
export const memberCheckpointRecordSchema=memberCheckpointStagedSchema.extend({requestedSeq:seq.min(1),finishedSeq:seq.min(1),terminalSeq:seq.min(1)}).strict().refine(value=>value.lastEffectSeq<value.requestedSeq&&value.requestedSeq<value.finishedSeq&&value.finishedSeq<value.terminalSeq,'检查点日志顺序无效');
export type MemberCheckpointRecord=z.infer<typeof memberCheckpointRecordSchema>;
/** 私有原生记录指纹；路径和原生 ID 沿用 DispatchRun.session，不能由公开请求提供。 */
export const memberCheckpointProofSchema=z.object({checkpoint:memberCheckpointRecordSchema,logHash:digest,native:z.object({byteLength:seq.min(1).max(64*1024*1024),sha256:digest}).strict()}).strict();
export type MemberCheckpointProof=z.infer<typeof memberCheckpointProofSchema>;
/** 新信封是预约；同值写入新的 DispatchRun 才表示该检查点被一次消费。 */
export const memberResumeFromSchema=z.object({checkpointId:id,runId:id}).strict();
export type MemberResumeFrom=z.infer<typeof memberResumeFromSchema>;
/** 共享生命周期门禁：不能让新增状态从旧枚举检查中漏过。 */
export function isMemberCheckpointPending(task:{status:string;checkpoints?:readonly MemberCheckpointRecord[];runIds:readonly string[];activeRunId?:string}):boolean{return task.status==='checkpointed'||!!task.checkpoints?.length&&task.runIds.length===1&&['queued','waiting'].includes(task.status)}
