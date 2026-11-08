/**
 * 作用定位：受控产物删除/移动的严格输入、原操作阶段和可公开证明协议，供运行、清单及界面共用。
 * 设计原因：先前缺失观察不能补造操作；原清单、独占句柄字节、可靠执行顺序和两端结果须分别保留。
 * 职责边界：不访问文件，不授予权限；prepared/executing 或平台返回自身均不代表可验收成功。
 */
import {z} from 'zod';
import {artifactTransitionDefinitionSchema,artifactScopeLimits} from '../workspace/artifact-scope';
import {artifactBaselineStagedSchema} from './artifact-baseline';

const id=z.string().min(1).max(128).refine(v=>v.trim()===v&&!/[\x00-\x1f]/.test(v)),logical=z.string().min(1).max(512),digest=z.string().regex(/^[a-f0-9]{64}$/),seq=z.number().int().positive().safe();
export const artifactTransitionToolName='cbim_artifact_transition';
/** 引擎只发现已装配的工具并透传原调用身份；接口不引用运行实现，也不给保存阶段或签发许可的能力。 */
export interface ArtifactTransitionToolPort {
  list():Promise<Array<{name:string;description:string;inputSchema:Record<string,unknown>}>>;
  call(name:string,input:unknown,toolCallId?:string,signal?:AbortSignal):Promise<{content:{type:'text';text:string}[]}>;
}
export const artifactTransitionInputSchema=z.object({moduleId:logical,operationIndex:z.number().int().min(0).max(artifactScopeLimits.transitions-1),beforeManifestId:id,expectedTaskProgressVersion:seq}).strict();
export type ArtifactTransitionInput=z.infer<typeof artifactTransitionInputSchema>;
export const artifactTransitionFactSchema=z.object({byteLength:z.number().int().nonnegative().max(1024*1024),sha256:digest}).strict();
export const artifactTransitionFileIdentitySchema=z.object({kind:z.literal('windows_file'),volumeId:id,fileId:id,links:z.literal(1)}).strict();
const common={operationId:digest,toolCallId:id,moduleId:logical,operationIndex:z.number().int().min(0).max(artifactScopeLimits.transitions-1),operation:artifactTransitionDefinitionSchema,knowledgeRevision:logical,scopeHash:digest,beforeManifestId:id,beforeManifestHash:digest,before:artifactTransitionFactSchema};
/** 只有可靠 allowed 后的真实句柄观察可保存此阶段；正文不进入 canonical，before 不代表可恢复备份。 */
export const artifactTransitionPreparedSchema=z.object({...common,version:z.literal(1),binding:artifactBaselineStagedSchema.innerType().shape.binding,inputHash:digest,progressVersion:seq,allowedSeq:seq,fileIdentity:artifactTransitionFileIdentitySchema,preparedAt:z.string().datetime()}).strict();
export type ArtifactTransitionPrepared=z.infer<typeof artifactTransitionPreparedSchema>;
export const artifactTransitionExecutingSchema=z.object({operationId:digest,preparedSeq:seq}).strict();
/** applied 的日志序号来自实际 append 回执，不能在保存前预造。 */
export const artifactTransitionAppliedSchema=z.object({...common,allowedSeq:seq,preparedSeq:seq,executingSeq:seq,appliedSeq:seq,afterManifestHash:digest,appliedAt:z.string().datetime()}).strict();
export type ArtifactTransitionApplied=z.infer<typeof artifactTransitionAppliedSchema>;
export const artifactTransitionOutputSchema=z.object({state:z.literal('applied'),operation:artifactTransitionAppliedSchema}).strict();
/** 公开清单只携带已成功结束的顺序证明；实际完整前后集合继续从原 canonical 重建。 */
export const artifactTransitionProofSchema=artifactTransitionAppliedSchema.extend({finishedSeq:seq}).strict().refine(v=>v.allowedSeq<v.preparedSeq&&v.preparedSeq<v.executingSeq&&v.executingSeq<v.appliedSeq&&v.appliedSeq<v.finishedSeq,'删除/移动必须先可靠准备、执行、观察，再成功结束');
export type ArtifactTransitionProof=z.infer<typeof artifactTransitionProofSchema>;
