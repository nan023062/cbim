/**
 * 目录归属：logic/file-operations/rules/file-operations；受控文件与隔离协议。
 * 作用定位：保存受控文件操作的私有来源、备份引用及不可变阶段事件。
 * 设计原因：实际字节与 Win32 句柄由 Main 持有；唯一 Store 只验证可信事实和阶段链，不将备份路径或正文公开。
 */
import {z} from 'zod';
import {controlledFileBindingSchema,controlledFileContentFactSchema,controlledFilePathSchema,controlledFileWriteToolName,fileCompensationActorSchema,fileCompensationInputSchema} from './controlled-file-operation';
const id=z.string().min(1).max(512).refine(v=>v.trim()===v&&!/[\x00-\x1f\x7f]/.test(v)),digest=z.string().regex(/^[a-f0-9]{64}$/),time=z.string().datetime(),positive=z.number().int().positive().safe();
/** allowedSeq 只来自 Runtime 自身可靠保存的授权事件，不接受引擎 emit 或模型输入。 */
export const controlledFileOriginSchema=z.object({kind:z.literal('member_tool'),workspaceInstanceId:z.string().uuid(),scopeId:id,binding:controlledFileBindingSchema,ownerBindingHash:digest,knowledgeRevision:id,toolName:z.literal(controlledFileWriteToolName),toolCallId:id,inputHash:digest,allowedSeq:positive,permission:z.enum(['ask','execute'])}).strict();
export type ControlledFileOrigin=z.infer<typeof controlledFileOriginSchema>;
export const controlledFileIdentitySchema=z.object({kind:z.literal('windows_file'),volumeId:id,fileId:id,links:z.literal(1)}).strict();
export type ControlledFileIdentity=z.infer<typeof controlledFileIdentitySchema>;
/** 补偿引用原两个 blob，不改 createdForOperationId 或 role，也不提供任意私有路径。 */
export const controlledFileBlobRefSchema=controlledFileContentFactSchema.extend({version:z.literal(1),blobId:z.string().uuid(),createdForOperationId:digest,role:z.enum(['before','intended_after'])}).strict();
export type ControlledFileBlobRef=z.infer<typeof controlledFileBlobRefSchema>;
export const controlledWriteRequestSchema=z.object({relativePath:controlledFilePathSchema,expectedBefore:controlledFileContentFactSchema,after:controlledFileContentFactSchema}).strict();
export type ControlledWriteRequest=z.infer<typeof controlledWriteRequestSchema>;
export const controlledWritePreparedSchema=z.object({version:z.literal(1),kind:z.literal('member_write'),operationId:digest,origin:controlledFileOriginSchema,request:controlledWriteRequestSchema,requestFingerprint:digest,fileIdentity:controlledFileIdentitySchema,before:controlledFileBlobRefSchema,intendedAfter:controlledFileBlobRefSchema,preparedAt:time}).strict();
export type ControlledWritePrepared=z.infer<typeof controlledWritePreparedSchema>;
export const fileCompensationPreparedSchema=z.object({version:z.literal(1),kind:z.literal('desktop_compensation'),operationId:digest,request:fileCompensationInputSchema,actor:fileCompensationActorSchema,requestFingerprint:digest,original:z.object({operationId:digest,intentHash:digest,appliedRevision:z.literal(3),appliedEventHash:digest}).strict(),compensationRevision:positive,previewBasis:digest,relativePath:controlledFilePathSchema,fileIdentity:controlledFileIdentitySchema,observedBefore:controlledFileContentFactSchema,before:controlledFileBlobRefSchema,intendedAfter:controlledFileBlobRefSchema,preparedAt:time}).strict();
export type FileCompensationPrepared=z.infer<typeof fileCompensationPreparedSchema>;
export const controlledFileIntentSchema=z.discriminatedUnion('kind',[controlledWritePreparedSchema,fileCompensationPreparedSchema]);
export type ControlledFileIntent=z.infer<typeof controlledFileIntentSchema>;
const base={version:z.literal(1),operationId:digest,recordedAt:time},reasonCode=z.string().min(1).max(100).regex(/^[A-Z0-9_]+$/);
export const controlledFileChangeSchema=z.discriminatedUnion('phase',[
  z.object({...base,phase:z.literal('prepared'),revision:z.literal(1),previousRevision:z.literal(0),intent:controlledFileIntentSchema}).strict(),
  z.object({...base,phase:z.literal('executing'),revision:z.literal(2),previousRevision:z.literal(1),intentHash:digest}).strict(),
  z.object({...base,phase:z.literal('applied'),revision:z.literal(3),previousRevision:z.literal(2),intentHash:digest,observedAfter:controlledFileContentFactSchema,fileIdentity:controlledFileIdentitySchema}).strict(),
  z.object({...base,phase:z.literal('not_applied'),revision:z.union([z.literal(2),z.literal(3)]),previousRevision:z.union([z.literal(1),z.literal(2)]),intentHash:digest,reasonCode,confirmation:z.literal('write_not_issued')}).strict(),
  z.object({...base,phase:z.literal('unknown'),revision:z.literal(3),previousRevision:z.literal(2),intentHash:digest,reasonCode}).strict(),
]);
export type ControlledFileChange=z.infer<typeof controlledFileChangeSchema>;
/** 短事务回执只证明该阶段可靠保存；prepared/executing 不授予界面业务成功语义。 */
export const controlledFilePhaseReceiptSchema=z.object({version:z.literal(1),operationId:digest,phase:z.enum(['prepared','executing','applied','not_applied','unknown']),revision:positive.max(3),intentHash:digest,recordedAt:time}).strict();
export type ControlledFilePhaseReceipt=z.infer<typeof controlledFilePhaseReceiptSchema>;
/** 从不可变附录派生的后端 head，不另写 current 文件，不包含文件字节。 */
export interface ControlledFileOperation {intent:ControlledFileIntent;phase:ControlledFileChange['phase'];revision:number;updatedAt:string;change:ControlledFileChange}
