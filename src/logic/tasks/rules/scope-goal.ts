/**
 * 解析后的业务分配可以持有独立 fallbackBinding；输入不能直接提供兜底证明，且与 ownerSelection/ownerBinding 互斥。
 * 成员等待仅在 awaiting_user 明确保留完整清单；普通审阅、完成和人工决定不授予成员恢复许可。
 * 作用定位：定义目标输入、版本化计划、审阅证据及转换规则；业务拒绝精确绑定旧候选，新候选仍须独立验收。
 * 设计原因：计划与模型回合分离，原始需求不可改写；业务分配保留负责人选择及可信绑定、可选 Workflow，显式补充使旧计划过期，历史缺省不伪造新身份。
 * 职责边界：主角色可直接执行并引用本轮业务工具证据，成员专属 Workflow 仍只绑定成员任务；人工满足项须引用真实决定及显式接续，complete 仅是申请。
 * 机制边界：对象递归排序由 utility 提供，本模块保留历史比较器、字段省略和业务指纹规则。
 */
import {orderJsonValue} from '../../../core/utility';
import {automaticExecutionBindingSchema,automaticExecutionBindingMatches} from '../../team/rules/automatic-execution';
import {z} from 'zod';
import {workflowSelectionsSchema,validateWorkflowSelections,type WorkflowSelection} from './workflow-selection';
import {fail} from '../../../core/errors';
import {ownerExecutionSelectionSchema,ownerExecutionBindingSchema,ownerExecutionSelectionMatches} from '../../team/rules/member-execution-binding';
import {memberPauseSchema} from './member-pause';

const id=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
const text=z.string().trim().min(1).max(16000);
const message=z.string().max(1_000_000).refine(value=>value.trim().length>0,'周期输入正文不能为空');
const attachments=z.array(z.string().uuid()).max(12);
const revision=z.number().int().min(1).max(65);
const unique=(values:string[])=>new Set(values).size===values.length;
/** 同一目标最多 64 次计划、审阅或显式补充版本变更；跨等待不重置，耗尽只能记录阻塞或结束。 */
export const scopeGoalDecisionLimit=64;
export interface DispatchScopeInput {message:string;attachmentIds?:string[]}
export const dispatchScopeInputSchema=z.object({message,attachmentIds:attachments.optional()}).strict();
const criterion=z.object({id,text,kind:z.enum(['evidence','human'])}).strict();
const assignmentFields=z.object({agentId:id,moduleIds:z.array(id).max(50).refine(unique),workflowSelections:workflowSelectionsSchema.optional(),ownerSelection:ownerExecutionSelectionSchema.optional(),criterionIds:z.array(id).min(1).max(50).refine(unique),reason:text}).strict();
const assignmentSelection=(value:{agentId:string;moduleIds:string[];workflowSelections?:WorkflowSelection[]},context:z.RefinementCtx)=>{try{validateWorkflowSelections(value.moduleIds,value.workflowSelections)}catch{context.addIssue({code:'custom',message:'Workflow 选择不属于目标分配的模块'})}if(value.agentId==='cbim:main'&&value.workflowSelections!==undefined)context.addIssue({code:'custom',message:'主会话直接工作不绑定成员专属 Workflow 执行契约'})};
// 旧原命令仍可按相同输入查回执；新业务计划的必需选择由工具、服务和 Store 新协议共同限制。
const assignment=assignmentFields.superRefine((value,context)=>{assignmentSelection(value,context);if(value.agentId==='cbim:main'?value.ownerSelection!==undefined:value.ownerSelection&&(value.ownerSelection.expectedOwners.length!==value.moduleIds.length||!value.moduleIds.every(id=>value.ownerSelection!.expectedOwners.some(owner=>owner.moduleId===id))))context.addIssue({code:'custom',message:'业务分配的负责人选择必须精确覆盖模块，主治理不得携带业务选择'})});
/** 工具不能指定周期、运行身份或知识版本；这些字段由可信调用入口和知识服务注入。 */
export const goalPlanInputSchema=z.object({expectedRevision:revision,objective:text,constraints:z.array(text).max(50),criteria:z.array(criterion).min(1).max(50),assignments:z.array(assignment).min(1).max(100),reason:text}).strict();
const memberEvidence=z.object({kind:z.literal('member-result'),taskId:id,runId:id,resultId:id,planRevision:z.number().int().positive(),toolCallIds:z.array(id).min(1).max(100).refine(unique)}).strict();
const knowledgeEvidence=z.object({kind:z.literal('main-knowledge'),toolCallIds:z.array(id).min(1).max(100).refine(unique)}).strict();
/** 主会话业务证据与知识提交分开；只引用本轮真实原生工具，不能冒充成员候选或人工接受。 */
const mainExecutionEvidence=z.object({kind:z.literal('main-execution'),toolCallIds:z.array(id).min(1).max(100).refine(unique)}).strict();
const humanDecisionReference=z.object({decisionId:z.string().uuid(),continuationId:z.string().uuid()}).strict();
/** 仅引用真实记录和已受理接续；Schema 不把 ID 当作批准，可信服务仍须重核当前主体及成果。 */
const humanEvidence=humanDecisionReference.extend({kind:z.literal('human-decision')}).strict();
const evidence=z.discriminatedUnion('kind',[memberEvidence,knowledgeEvidence,mainExecutionEvidence,humanEvidence]);
const check=z.object({criterionId:id,outcome:z.enum(['satisfied','unmet','needs_human']),reason:text,evidence:z.array(evidence).max(100)}).strict();
/** 业务返工明确指向原有效候选；只是拒绝旧成果，不签发新成果或人工验收。 */
const superseded=z.object({taskId:id,replacementTaskIds:z.array(id).min(1).max(100).refine(unique),reason:text,humanDecision:humanDecisionReference.optional(),rejectedCandidate:z.object({runId:id,resultId:id,planRevision:revision}).strict().optional()}).strict();
/** memberPause 仅用于 awaiting_user：明确保留可靠检查点和未领取后继，不授权恢复或签署验收。 */
export const goalReviewInputSchema=z.object({expectedRevision:revision,decision:z.enum(['complete','replan','blocked','awaiting_user']),checks:z.array(check).max(50),superseded:z.array(superseded).max(100),gaps:z.array(text).max(100),reason:text,memberPause:memberPauseSchema.optional()}).strict();
export type GoalPlanInput=z.infer<typeof goalPlanInputSchema>;
export type GoalReviewInput=z.infer<typeof goalReviewInputSchema>;
export type GoalEvidence=z.infer<typeof evidence>;
const cursor=z.object({streamId:id,seq:z.number().int().nonnegative()}).strict();
const inputRevision=z.number().int().min(1).max(32);
const stamp={revision,inputRevision:inputRevision.optional(),runId:id,recordedAt:z.string().datetime(),knowledgeRevision:id,graphCursor:cursor};
/** 已解析角色及模块的知识基线；显式流程选择保留输入，缺省不补值，不复制 Skill 正文或密钥。 */
const resolvedAssignment=assignmentFields.extend({agentName:text,teamId:id,moduleNames:z.array(text).max(50),ownerBinding:ownerExecutionBindingSchema.optional(),fallbackBinding:automaticExecutionBindingSchema.optional()}).strict().superRefine((value,context)=>{
  assignmentSelection(value,context);
  if(value.fallbackBinding&&(value.ownerSelection||value.ownerBinding||!automaticExecutionBindingMatches(value.fallbackBinding,value.fallbackBinding.workspaceId,value.fallbackBinding.scopeId,value.agentId,value.moduleIds)||value.teamId!==value.fallbackBinding.teamId))context.addIssue({code:'custom',message:'自动兜底不得混入登记岗位，身份和模块必须一致'});
  if(value.agentId==='cbim:main'?(value.ownerSelection!==undefined||value.ownerBinding!==undefined):value.ownerSelection!==undefined||value.ownerBinding!==undefined){
    if(value.agentId==='cbim:main'||!value.ownerSelection||!value.ownerBinding||!ownerExecutionSelectionMatches(value.ownerSelection,value.ownerBinding)||value.ownerBinding.capability.agentId!==value.agentId||value.ownerBinding.capability.teamId!==value.teamId||value.ownerBinding.owners.length!==value.moduleIds.length||!value.moduleIds.every(id=>value.ownerBinding!.owners.some(owner=>owner.moduleId===id)))context.addIssue({code:'custom',message:'目标分配的可信负责人绑定与原选择不一致'});
  }
});
const plan=goalPlanInputSchema.omit({expectedRevision:true,assignments:true}).extend({...stamp,assignments:z.array(resolvedAssignment).min(1).max(100)}).strict();
const review=goalReviewInputSchema.omit({expectedRevision:true}).extend({...stamp,planRevision:revision,observedSeq:z.number().int().nonnegative(),lastEffectSeq:z.number().int().nonnegative()}).strict();
/** 缺省整个 goal 只兼容旧周期；不能给已有旧记录猜测或补造原始输入。 */
export const dispatchScopeGoalSchema=z.object({revision,inputRevision:inputRevision.optional(),input:z.object({message,attachmentIds:attachments}).strict(),plan:plan.optional(),review:review.optional(),blocked:z.object({reason:text,at:z.string().datetime()}).strict().optional()}).strict().superRefine((goal,context)=>{
  const issue=(message:string)=>context.addIssue({code:z.ZodIssueCode.custom,message});
  if(goal.revision===1){if(goal.plan||goal.review||(goal.inputRevision??1)!==1)issue('初始目标不能包含决策或补充');return}
  // 普通对话可在同轮接收补充而尚未规划；输入增版不强迫创建业务计划。
  if(!goal.plan){if(goal.review||goal.revision!==(goal.inputRevision??1))issue('无计划目标只能随真实补充增加输入版本');return}
  const criteria=goal.plan.criteria.map(item=>item.id);
  if(!unique(criteria)||!goal.plan.assignments.every(item=>item.criterionIds.every(id=>criteria.includes(id)))||!criteria.every(id=>goal.plan!.assignments.some(item=>item.criterionIds.includes(id))))issue('计划验收项及责任映射无效');
  if(goal.plan.revision<2||goal.plan.revision>goal.revision)issue('计划版本超出目标版本');
  const currentInput=goal.inputRevision??1,plannedInput=goal.plan.inputRevision??1;
  if(plannedInput>currentInput)issue('计划输入版本超前');
  if(!goal.review){if(plannedInput===currentInput&&goal.plan.revision!==goal.revision)issue('未审阅时最新版本必须是计划');if(plannedInput<currentInput&&goal.plan.revision>=goal.revision)issue('过期计划不能占据补充后的最新版本');return}
  if(goal.review.memberPause&&goal.review.decision!=='awaiting_user')issue('成员持久等待清单只能用于等待用户审阅');
  if(plannedInput!==currentInput||(goal.review.inputRevision??1)!==currentInput)issue('审阅必须对应最新输入版本的计划');
  if(goal.review.revision!==goal.revision||goal.review.planRevision!==goal.plan.revision||goal.review.revision<=goal.plan.revision)issue('审阅与目标计划版本不一致');
  if(goal.review.lastEffectSeq>goal.review.observedSeq)issue('副作用序号不能超过已观察日志');
  if(!unique(goal.review.checks.map(item=>item.criterionId))||!goal.review.checks.every(item=>criteria.includes(item.criterionId)))issue('审阅项重复或不属于计划');
  for(const item of goal.review.checks){
    const human=goal.plan.criteria.find(value=>value.id===item.criterionId)?.kind==='human',refs=item.evidence.filter(value=>value.kind==='human-decision');
    if(item.outcome==='satisfied'&&(!item.evidence.length||human&&refs.length!==1))issue('满足项必须有证据，人工项须引用一次明确人工接续');
    if(refs.length&&(!human||item.outcome!=='satisfied'||item.evidence.some(value=>value.kind==='main-knowledge'||value.kind==='main-execution')))issue('人工决定仅可用于对应人工项的满足申请，不能代替业务工具或未满足项证据');
  }
  if(goal.review.decision==='complete'&&(goal.review.gaps.length||goal.review.checks.length!==criteria.length||goal.review.checks.some(item=>item.outcome!=='satisfied')))issue('完成申请仍有未满足验收项');
});
export type DispatchScopeGoal=z.infer<typeof dispatchScopeGoalSchema>;
export type ScopeGoalPlan=NonNullable<DispatchScopeGoal['plan']>;
export type ScopeGoalReview=NonNullable<DispatchScopeGoal['review']>;
/** 历史字段缺省解释为第 1 版，仅用于比较，不在读取时补写历史。 */
export function goalInputRevision(value:{inputRevision?:number}):number{return value.inputRevision??1}
/** 真实用户补充之后保留旧计划供回顾和 human 约束，但不可沿该计划派工或完成。 */
export function goalNeedsReplan(goal:DispatchScopeGoal):boolean{return !!goal.plan&&goalInputRevision(goal.plan)!==goalInputRevision(goal)}

/** 保留本模块历史键排序与 undefined 规则；utility 只提供递归复制机制。 */
const ordered=(value:unknown):unknown=>orderJsonValue(value,{compareKeys:(a,b)=>a<b?-1:a>b?1:0,omitUndefinedProperties:true});
export const sameGoalValue=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
function valid(condition:unknown,message:string):asserts condition{if(!condition)fail('GRAPH_INPUT_INVALID',message)}
/** 提交与重放共用；supplement 来自已核实等待消费，activeSupplement 仅在 validateScopeActiveInputs 匹配真实 pending→accepted 时传入，二者互斥，不能作为普通决策提升输入版本的豁免。 */
export function validateScopeGoalTransition(previous:DispatchScopeGoal|undefined,next:DispatchScopeGoal|undefined,isNew:boolean,supplement=false,activeSupplement=false):void{
  if(isNew){valid(!next||(next.revision===1&&!next.plan&&!next.review&&!next.blocked),'新目标必须从未规划的第 1 版开始');return}
  if(sameGoalValue(previous,next))return;
  valid(previous&&next,'周期输入创建后不能改写、移除或给旧记录补造');
  valid(sameGoalValue(previous.input,next.input),'原始用户输入不可改写');
  valid(!previous.blocked,'已冻结阻塞的目标不可继续改写');
  if(supplement||activeSupplement){
    valid(!(supplement&&activeSupplement)&&(activeSupplement||previous.review?.decision==='awaiting_user')&&!next.blocked&&next.revision===previous.revision+1&&goalInputRevision(next)===goalInputRevision(previous)+1&&sameGoalValue(previous.plan,next.plan)&&!next.review,'补充必须提升输入及目标版本、保留旧计划并清除审阅');return;
  }
  valid(sameGoalValue(previous.inputRevision,next.inputRevision),'只有已核实的等待接续或运行中接受可以提升输入版本');
  if(next.blocked){valid(next.revision===previous.revision&&sameGoalValue(previous.plan,next.plan)&&sameGoalValue(previous.review,next.review),'阻塞记录不能顺带修改计划或审阅');return}
  valid(next.revision===previous.revision+1&&next.revision<=scopeGoalDecisionLimit+1,'目标决策版本必须逐次增加且不超过上限');
  if(!sameGoalValue(previous.plan,next.plan)){
    valid(next.plan&&next.plan.revision===next.revision&&goalInputRevision(next.plan)===goalInputRevision(next)&&!next.review,'新计划必须绑定当前输入与目标版本并清除旧审阅');
    valid((previous.plan?.criteria??[]).filter(item=>item.kind==='human').every(item=>next.plan!.criteria.some(candidate=>sameGoalValue(item,candidate))),'重新规划不能删除或降低既有人工验收项');
  }else valid(next.plan&&next.review&&next.review.revision===next.revision&&next.review.planRevision===next.plan.revision&&!sameGoalValue(previous.review,next.review),'审阅必须绑定现有计划和新的目标版本');
}
