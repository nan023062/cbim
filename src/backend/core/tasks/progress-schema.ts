/**
 * 完整出口显式manifestId进入原交付证明，JSON验证保留同一集合身份；旧字段缺省保持兼容。
 * 作用定位：执行计划、Workflow 命中证明与进度查询的严格公开结构。
 * 设计原因：TaskProgress 自身没有运行身份；JSON 检查事实和精确出口为可选结构，旧流程不补空证明，也不将 rejected 的执行事实改成通过。
 * 职责边界：这里只核字段和局部状态，可信运行归属、当前证据及请求匹配由工具输出边界核对。
 */
import {z} from 'zod';
import {workflowContractSchema,workflowToolNameSchema} from '../workspace/workflow-contract';
import {toolReceiptSchema} from '../tools/receipt-schema';
import {artifactBaselineRefSchema,artifactLimits} from './artifact-baseline';
import {validationResultSchema,workflowValidationCheckSchema} from './validation';
import {jsonValidationLimits} from '../workspace/json-validation-schema';
import {outputManifestProofSchema} from './output-manifest';

const text=z.string().min(1).max(4000).refine(value=>!!value.trim()),planText=z.string().min(1).max(16000).refine(value=>!!value.trim()),id=z.string().min(1).max(512);
const unique=(values:string[])=>new Set(values).size===values.length;
const inputText=z.string().trim().min(1).max(4000),inputPlanText=z.string().trim().min(1).max(16000),version=z.number().int().nonnegative();
/** 输入仍按既有规则规范化；输出绝不复用输入默认值或把实际 wire 改写为另一份正文。 */
export const progressToolInputSchemas={
  cbim_task_inspect:z.object({}).strict(),
  cbim_task_plan:z.object({expectedVersion:version,goal:inputPlanText,reason:inputText,acceptance:z.array(inputPlanText).min(1).max(50),steps:z.array(z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),title:inputText,owner:inputText}).strict()).min(1).max(50)}).strict(),
  cbim_task_step:z.object({expectedVersion:version,id:inputText,state:z.enum(['pending','working','reported_done']),evidenceIds:z.array(inputText).max(30)}).strict(),
  cbim_delivery_prepare:z.object({expectedVersion:version,summary:inputText,limitations:z.array(inputText).max(30),manifestId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/).optional()}).strict(),
} as const;
export type ProgressPlanInput=z.infer<typeof progressToolInputSchemas.cbim_task_plan>;
export type ProgressStepInput=z.infer<typeof progressToolInputSchemas.cbim_task_step>;
export type ProgressDeliveryInput=z.infer<typeof progressToolInputSchemas.cbim_delivery_prepare>;
/** 命中仅指本轮真实指定工具回执，不能解释为专业验证或完整模块覆盖。 */
export const workflowEvidenceProofSchema=z.object({version:z.literal(1),bindingsHash:z.string().regex(/^[a-f0-9]{64}$/),checks:z.array(z.object({moduleId:id,workflowId:id,workflowVersion:id,requirementId:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),toolName:workflowToolNameSchema,toolCallIds:z.array(z.string().min(1).max(128)).min(1).max(1500).refine(unique)}).strict()).max(1600),validationChecks:z.array(workflowValidationCheckSchema).min(1).max(jsonValidationLimits.records).optional(),manifest:outputManifestProofSchema.optional()}).strict().refine(value=>unique([...value.checks,...value.validationChecks??[]].map(item=>JSON.stringify([item.moduleId,item.requirementId]))),'Workflow 条件不得重复');
export const workflowContractBindingSchema=z.object({moduleId:id,workflowId:id,workflowVersion:id,contract:workflowContractSchema}).strict();
const step=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),title:text,owner:text,state:z.enum(['pending','working','reported_done']),evidence:z.array(text).max(30)}).strict();
export const taskProgressSchema=z.object({version:z.number().int().positive().safe(),goal:planText,acceptance:z.array(planText).min(1).max(50),steps:z.array(step).min(1).max(50),state:z.enum(['executing','awaiting_review']),reason:text,delivery:z.object({summary:text,limitations:z.array(text).max(30),workflow:workflowEvidenceProofSchema.optional()}).strict().optional()}).strict().superRefine((value,context)=>{
  const issue=(message:string)=>context.addIssue({code:'custom',message});
  if(!unique(value.steps.map(item=>item.id)))issue('计划步骤身份不能重复');
  if(value.steps.some(item=>item.state==='reported_done'&&!item.evidence.length))issue('完成声明须有明确引用');
  if(value.state==='awaiting_review'?(!value.delivery||value.steps.some(item=>item.state!=='reported_done')):value.delivery!==undefined)issue('交付候选与执行状态不一致');
});
/** 没有计划时明确为 null；没有相应能力端口时可选事实仍缺省，不补空列表或空证明。 */
export const taskProgressInspectSchema=z.object({
  plan:taskProgressSchema.nullable(),evidence:z.array(toolReceiptSchema),
  artifacts:z.array(artifactBaselineRefSchema).max(artifactLimits.baselines).optional(),
  validations:z.array(validationResultSchema).max(jsonValidationLimits.records).refine(values=>unique(values.map(value=>value.validationId))&&unique(values.map(value=>value.toolCallId))).optional(),
  workflowContracts:z.array(workflowContractBindingSchema).min(1).max(100).refine(values=>unique(values.map(item=>item.moduleId))).optional(),
}).strict().superRefine((value,context)=>{
  if(!unique(value.evidence.map(item=>item.toolCallId))||value.artifacts&&!unique(value.artifacts.map(item=>item.baselineId)))context.addIssue({code:'custom',message:'进度查询的调用或基线身份重复'});
});
export type TaskProgressInspect=z.infer<typeof taskProgressInspectSchema>;
