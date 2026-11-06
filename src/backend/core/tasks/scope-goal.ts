/**
 * 作用定位：定义调度周期目标的原始输入、版本化计划、审阅证据和持久化转换规则。
 * 设计原因：计划与模型回合分离，原始需求不可改写；所有审阅引用真实运行而非模型自报结果，重放同样限制版本演进。
 * 职责边界：Schema 只校验形状，运行、知识和图证据由调度服务核实；complete 是请求，不是验收已通过。
 */
import {z} from 'zod';
import {fail} from '../foundation/errors';

const id=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
const text=z.string().trim().min(1).max(16000);
const message=z.string().max(1_000_000).refine(value=>value.trim().length>0,'周期输入正文不能为空');
const attachments=z.array(z.string().uuid()).max(12);
const revision=z.number().int().min(1).max(65);
const unique=(values:string[])=>new Set(values).size===values.length;
/** 本步最多接受 64 次计划/审阅决策；达到上限只能由可信协调器记录阻塞并结束。 */
export const scopeGoalDecisionLimit=64;
export interface DispatchScopeInput {message:string;attachmentIds?:string[]}
export const dispatchScopeInputSchema=z.object({message,attachmentIds:attachments.optional()}).strict();
const criterion=z.object({id,text,kind:z.enum(['evidence','human'])}).strict();
const assignment=z.object({agentId:id,moduleIds:z.array(id).max(50).refine(unique),criterionIds:z.array(id).min(1).max(50).refine(unique),reason:text}).strict();
/** 工具不能指定周期、运行身份或知识版本；这些字段由可信调用入口和知识服务注入。 */
export const goalPlanInputSchema=z.object({expectedRevision:revision,objective:text,constraints:z.array(text).max(50),criteria:z.array(criterion).min(1).max(50),assignments:z.array(assignment).min(1).max(100),reason:text}).strict();
const memberEvidence=z.object({kind:z.literal('member-result'),taskId:id,runId:id,resultId:id,planRevision:z.number().int().positive(),toolCallIds:z.array(id).min(1).max(100).refine(unique)}).strict();
const knowledgeEvidence=z.object({kind:z.literal('main-knowledge'),toolCallIds:z.array(id).min(1).max(100).refine(unique)}).strict();
const evidence=z.discriminatedUnion('kind',[memberEvidence,knowledgeEvidence]);
const check=z.object({criterionId:id,outcome:z.enum(['satisfied','unmet','needs_human']),reason:text,evidence:z.array(evidence).max(100)}).strict();
const superseded=z.object({taskId:id,replacementTaskIds:z.array(id).min(1).max(100).refine(unique),reason:text}).strict();
export const goalReviewInputSchema=z.object({expectedRevision:revision,decision:z.enum(['complete','replan','blocked','awaiting_user']),checks:z.array(check).max(50),superseded:z.array(superseded).max(100),gaps:z.array(text).max(100),reason:text}).strict();
export type GoalPlanInput=z.infer<typeof goalPlanInputSchema>;
export type GoalReviewInput=z.infer<typeof goalReviewInputSchema>;
export type GoalEvidence=z.infer<typeof evidence>;
const cursor=z.object({streamId:id,seq:z.number().int().nonnegative()}).strict();
const stamp={revision,runId:id,recordedAt:z.string().datetime(),knowledgeRevision:id,graphCursor:cursor};
/** 已解析真实角色及模块的知识基线；不复制 Skill 正文或密钥。 */
const resolvedAssignment=assignment.extend({agentName:text,teamId:id,moduleNames:z.array(text).max(50)}).strict();
const plan=goalPlanInputSchema.omit({expectedRevision:true,assignments:true}).extend({...stamp,assignments:z.array(resolvedAssignment).min(1).max(100)}).strict();
const review=goalReviewInputSchema.omit({expectedRevision:true}).extend({...stamp,planRevision:revision,observedSeq:z.number().int().nonnegative(),lastEffectSeq:z.number().int().nonnegative()}).strict();
/** 缺省整个 goal 只兼容旧周期；不能给已有旧记录猜测或补造原始输入。 */
export const dispatchScopeGoalSchema=z.object({revision,input:z.object({message,attachmentIds:attachments}).strict(),plan:plan.optional(),review:review.optional(),blocked:z.object({reason:text,at:z.string().datetime()}).strict().optional()}).strict().superRefine((goal,context)=>{
  const issue=(message:string)=>context.addIssue({code:z.ZodIssueCode.custom,message});
  if(goal.revision===1){if(goal.plan||goal.review)issue('初始目标不能包含决策');return}
  if(!goal.plan){issue('后续版本必须保留计划');return}
  const criteria=goal.plan.criteria.map(item=>item.id);
  if(!unique(criteria)||!goal.plan.assignments.every(item=>item.criterionIds.every(id=>criteria.includes(id)))||!criteria.every(id=>goal.plan!.assignments.some(item=>item.criterionIds.includes(id))))issue('计划验收项及责任映射无效');
  if(goal.plan.revision<2||goal.plan.revision>goal.revision)issue('计划版本超出目标版本');
  if(!goal.review){if(goal.plan.revision!==goal.revision)issue('未审阅时最新版本必须是计划');return}
  if(goal.review.revision!==goal.revision||goal.review.planRevision!==goal.plan.revision||goal.review.revision<=goal.plan.revision)issue('审阅与目标计划版本不一致');
  if(goal.review.lastEffectSeq>goal.review.observedSeq)issue('副作用序号不能超过已观察日志');
  if(!unique(goal.review.checks.map(item=>item.criterionId))||!goal.review.checks.every(item=>criteria.includes(item.criterionId)))issue('审阅项重复或不属于计划');
  if(goal.review.checks.some(item=>item.outcome==='satisfied'&&(!item.evidence.length||goal.plan!.criteria.find(value=>value.id===item.criterionId)?.kind==='human')))issue('满足项必须有证据，模型不能批准人工项');
  if(goal.review.decision==='complete'&&(goal.review.gaps.length||goal.review.checks.length!==criteria.length||goal.review.checks.some(item=>item.outcome!=='satisfied')))issue('完成申请仍有未满足验收项');
});
export type DispatchScopeGoal=z.infer<typeof dispatchScopeGoalSchema>;
export type ScopeGoalPlan=NonNullable<DispatchScopeGoal['plan']>;
export type ScopeGoalReview=NonNullable<DispatchScopeGoal['review']>;

function ordered(value:unknown):unknown{return Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,ordered(item)])):value}
export const sameGoalValue=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
function valid(condition:unknown,message:string):asserts condition{if(!condition)fail('GRAPH_INPUT_INVALID',message)}
/** 提交与磁盘重放共用：只允许追加一次决策版本或冻结阻塞，不允许删除输入、回退版本或改写已关闭快照。 */
export function validateScopeGoalTransition(previous:DispatchScopeGoal|undefined,next:DispatchScopeGoal|undefined,isNew:boolean):void{
  if(isNew){valid(!next||(next.revision===1&&!next.plan&&!next.review&&!next.blocked),'新目标必须从未规划的第 1 版开始');return}
  if(sameGoalValue(previous,next))return;
  valid(previous&&next,'周期输入创建后不能改写、移除或给旧记录补造');
  valid(sameGoalValue(previous.input,next.input),'原始用户输入不可改写');
  valid(!previous.blocked,'已冻结阻塞的目标不可继续改写');
  if(next.blocked){valid(next.revision===previous.revision&&sameGoalValue(previous.plan,next.plan)&&sameGoalValue(previous.review,next.review),'阻塞记录不能顺带修改计划或审阅');return}
  valid(next.revision===previous.revision+1&&next.revision<=scopeGoalDecisionLimit+1,'目标决策版本必须逐次增加且不超过上限');
  if(!sameGoalValue(previous.plan,next.plan)){
    valid(next.plan&&next.plan.revision===next.revision&&!next.review,'新计划必须绑定当前版本并清除旧审阅');
    valid((previous.plan?.criteria??[]).filter(item=>item.kind==='human').every(item=>next.plan!.criteria.some(candidate=>sameGoalValue(item,candidate))),'重新规划不能删除或降低既有人工验收项');
  }else valid(next.plan&&next.review&&next.review.revision===next.revision&&next.review.planRevision===next.plan.revision&&!sameGoalValue(previous.review,next.review),'审阅必须绑定现有计划和新的目标版本');
}
