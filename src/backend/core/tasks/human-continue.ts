/**
 * 人工接受主体包含自动兜底原模型、原因与模块，不能换执行依据后沿用旧决定。
 * 作用定位：定义按本机已保存人工决定显式继续原目标的严格协议与业务主体快照。
 * 设计原因：用户点击继续与保存决定分开；业务主体包含原负责人和流程选择，不能换岗位或方法后借用旧接受，也不把系统转交意见伪造成用户新目标。
 * 职责边界：仅表达身份和不可变启动意图；主知识治理不能声明执行业务 Workflow，真实候选、文件、权限与运行准入由可信服务核实。
 */
import {automaticExecutionBindingSchema,automaticExecutionBindingMatches} from '../team/automatic-execution';
import {z} from 'zod';
import {dispatchScopeWaitSchema,scopeContinuationOptionsSchema} from './scope-continuation';
import {humanDecisionIdentitySchema} from './human-decisions';
import {workflowSelectionsSchema,validateWorkflowSelections} from './workflow-selection';
import {ownerExecutionBindingSchema} from '../team/member-execution-binding';

const id=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
const text=z.string().trim().min(1).max(16000),revision=z.number().int().min(1).max(65);
const unique=(values:string[])=>new Set(values).size===values.length;
const decisionIds=z.array(z.string().uuid()).min(1).max(50).refine(unique,'同一决定不能重复消费');
const criterion=z.object({id,text,kind:z.enum(['evidence','human'])}).strict();
const assignment=z.object({agentId:id,moduleIds:z.array(id).max(50).refine(unique),workflowSelections:workflowSelectionsSchema.optional(),ownerBinding:ownerExecutionBindingSchema.optional(),fallbackBinding:automaticExecutionBindingSchema.optional(),criterionIds:z.array(id).min(1).max(50).refine(unique)}).strict().superRefine((value,context)=>{if(value.fallbackBinding&&(value.ownerBinding||!automaticExecutionBindingMatches(value.fallbackBinding,value.fallbackBinding.workspaceId,value.fallbackBinding.scopeId,value.agentId,value.moduleIds)))context.addIssue({code:'custom',message:'人工主体的自动兜底身份不一致'});try{validateWorkflowSelections(value.moduleIds,value.workflowSelections)}catch{context.addIssue({code:'custom',message:'人工主体的 Workflow 选择不属于分配模块'})}if(value.agentId==='cbim:main'&&(value.workflowSelections!==undefined||value.ownerBinding!==undefined))context.addIssue({code:'custom',message:'主调度知识治理不能声明执行业务 Workflow 或岗位'});if(value.ownerBinding&&(value.ownerBinding.capability.agentId!==value.agentId||value.ownerBinding.owners.length!==value.moduleIds.length||!value.moduleIds.every(id=>value.ownerBinding!.owners.some(owner=>owner.moduleId===id))))context.addIssue({code:'custom',message:'人工主体的负责岗位不属于分配模块'})});
/** 排除轮次/时钟/解释 reason，固定原目标、约束、验收及角色模块流程；旧缺省选择不补写。 */
export const humanContinuationSubjectSchema=z.object({objective:text,constraints:z.array(text).max(50),criteria:z.array(criterion).min(1).max(50),assignments:z.array(assignment).min(1).max(100)}).strict().superRefine((value,context)=>{
  const ids=value.criteria.map(item=>item.id);
  if(!unique(ids)||!value.assignments.every(item=>item.criterionIds.every(id=>ids.includes(id)))||!ids.every(id=>value.assignments.some(item=>item.criterionIds.includes(id))))context.addIssue({code:'custom',message:'人工接续业务主体的验收项与责任映射不完整'});
});
export type HumanContinuationSubject=z.infer<typeof humanContinuationSubjectSchema>;
/** 不接受 message/actor/subject/proof；所选集合必须是本等待每人工项跨 basis 的最新决定全集。 */
export const humanContinuationRequestSchema=humanDecisionIdentitySchema.extend({waitId:id,expectedGoalRevision:revision,expectedInputRevision:z.number().int().min(1).max(32),expectedDecisionRevision:z.number().int().min(1).max(64),commandId:z.string().uuid(),decisionIds,options:scopeContinuationOptionsSchema}).strict();
export type HumanContinuationRequest=z.infer<typeof humanContinuationRequestSchema>;
export const humanContinuationLookupSchema=humanDecisionIdentitySchema.extend({commandId:z.string().uuid()}).strict();
export type HumanContinuationLookup=z.infer<typeof humanContinuationLookupSchema>;
/** 等待被实际消费后才存在；每条按当前输入版生效，不跨之后的文本补充或另一等待继承接受。 */
export const scopeHumanContinuationSchema=z.object({kind:z.literal('human_decisions'),continuationId:z.string().uuid(),acceptedAt:z.string().datetime(),wait:dispatchScopeWaitSchema,inputRevision:z.number().int().min(2).max(32),runId:id,options:scopeContinuationOptionsSchema,decisionRevision:z.number().int().min(1).max(64),decisionIds,subject:humanContinuationSubjectSchema,priorTaskIds:z.array(id).max(500).refine(unique)}).strict();
export type ScopeHumanContinuation=z.infer<typeof scopeHumanContinuationSchema>;
export const humanContinuationReceiptSchema=humanDecisionIdentitySchema.extend({scopeStatus:z.enum(['active','waiting','closed']),continuation:scopeHumanContinuationSchema}).strict();
export type HumanContinuationReceipt=z.infer<typeof humanContinuationReceiptSchema>;

/** 可信服务从当前计划提取；稳定排序消除列表重排，不去重或降低原验收条件。 */
export function humanContinuationSubject(plan:HumanContinuationSubject):HumanContinuationSubject{
  const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
  return humanContinuationSubjectSchema.parse({objective:plan.objective,constraints:[...plan.constraints],criteria:plan.criteria.map(({id,text,kind})=>({id,text,kind})).sort((a,b)=>compare(a.id,b.id)),assignments:plan.assignments.map(({agentId,moduleIds,criterionIds,workflowSelections,ownerBinding,fallbackBinding})=>({agentId,moduleIds:[...moduleIds].sort(compare),criterionIds:[...criterionIds].sort(compare),...(workflowSelections===undefined?{}:{workflowSelections:workflowSelections.map(selection=>({...selection})).sort((a,b)=>compare(a.moduleId,b.moduleId))}),...(fallbackBinding===undefined?{}:{fallbackBinding:{...structuredClone(fallbackBinding),moduleIds:[...fallbackBinding.moduleIds].sort(compare)}}),...(ownerBinding===undefined?{}:{ownerBinding:{...structuredClone(ownerBinding),owners:[...ownerBinding.owners].sort((a,b)=>compare(a.moduleId,b.moduleId))}})})).sort((a,b)=>compare(JSON.stringify(a),JSON.stringify(b)))});
}
