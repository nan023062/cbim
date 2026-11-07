/**
 * 作用定位：JSON 产物验证工具、不可变检查事实及 Workflow 精确出口的叶子契约。
 * 设计原因：工具成功不代表结构通过；身份、要求和文件指纹来自可信冻结上下文，不接受模型传入 Schema、路径或结论。
 */
import {z} from 'zod';
import {artifactFileFactSchema,artifactBaselineStagedSchema} from './artifact-baseline';
import {toolReceiptSchema} from '../tools/receipt-schema';
import {jsonValidationLimits} from '../workspace/json-validation-schema';
const id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),logical=z.string().min(1).max(512),seq=z.number().int().nonnegative().safe(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const binding=artifactBaselineStagedSchema.innerType().shape.binding;
export const validationToolName='cbim_validation_run';
export const validationInputSchema=z.object({moduleId:logical,requirementId:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),baselineId:id,expectedTaskProgressVersion:seq.min(1)}).strict();
export type ValidationInput=z.infer<typeof validationInputSchema>;
export const validationRequirementIdentitySchema=z.object({moduleId:logical,workflowId:logical,workflowVersion:logical,requirementId:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),schemaHash:hash}).strict();
export const validationIssueSchema=z.object({code:z.enum(['json_invalid','schema_mismatch']),instancePath:z.string().max(2048),schemaPath:z.string().max(2048).optional(),keyword:z.string().min(1).max(64).optional()}).strict();
/** taskProgressVersion 是检查当时版本，不等于派发 planRevision；后续步骤更新可以保留同代次证据，重规划或副作用不能沿用。 */
export const validationResultSchema=z.object({version:z.literal(1),validationId:id,toolCallId:z.string().min(1).max(128),binding,validator:z.literal('json-schema-v1'),requirement:validationRequirementIdentitySchema,knowledgeRevision:logical,taskProgressVersion:seq.min(1),baselineId:id,artifact:artifactFileFactSchema.extend({byteLength:seq.max(jsonValidationLimits.fileBytes)}).strict(),lastEffectSeq:seq,checkedAt:z.string().datetime(),outcome:z.enum(['passed','rejected']),issues:z.array(validationIssueSchema).max(jsonValidationLimits.issues)}).strict().refine(value=>value.outcome==='passed'?value.issues.length===0:value.issues.length>0,'结构结论与诊断不一致');
export type ValidationResult=z.infer<typeof validationResultSchema>;
export type ValidationBinding=ValidationResult['binding'];
export const validationOutputSchema=z.object({state:z.literal('checked'),validation:validationResultSchema}).strict();
/** 序号和 receipt 从真实已完成调用派生；记录不保证文件在检查之后持续未变。 */
export const validationRecordSchema=z.object({result:validationResultSchema,checkedSeq:seq.min(1),finishedSeq:seq.min(1),receipt:toolReceiptSchema}).strict().refine(value=>value.result.lastEffectSeq<value.checkedSeq&&value.checkedSeq<value.finishedSeq);
export type ValidationRecord=z.infer<typeof validationRecordSchema>;
export const workflowValidationCheckSchema=validationRequirementIdentitySchema.extend({validator:z.literal('json-schema-v1'),validationId:id,toolCallId:z.string().min(1).max(128),baselineId:id,artifact:artifactFileFactSchema}).strict();
export type WorkflowValidationCheck=z.infer<typeof workflowValidationCheckSchema>;
/** records 包含本轮当前代次的已核实调用；被拒结论保留事实，verifyCurrent 只核实际被选作出口的 passed 文件。 */
export interface ProgressValidationPort {records():readonly ValidationRecord[];verifyCurrent(records:readonly ValidationRecord[]):Promise<void>}
