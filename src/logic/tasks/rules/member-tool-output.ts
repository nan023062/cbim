/**
 * 完整交付在唯一wire上重算冻结依据，并核请求manifestId；模型或保存回包不能换绑原集合。
 * 证据边界：普通问答、模块负责人查询与变更仅记录交互或控制面事实，不进入步骤、成员候选或交付证据；原工具日志保持可读。
 * 作用定位：执行进度四工具及正式成员三工具的严格输出、真实归属和公开恢复说明。
 * 设计原因：计划本身没有运行身份，而求助、文件基线和检查点已有完整绑定；分别校验，不能向旧状态补造身份或把暂存当成交付。
 * 职责边界：只校验唯一 JSON wire，并用冻结的产物验证记录重算交付证明；不读文件、回滚或重试，当前字节与 canonical 仍由运行时和结算核实。
 */
import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {safeId} from '../../execution/ports/identity';
import type {ToolCancellation,ToolRecovery} from '../../tools/rules/contracts';
import {toolReceiptSchema} from '../../tools/rules/receipt-schema';
import {questionToolName} from '../../tools/rules/questions';
import type {ToolReceipt} from '../../tools/rules/types';
import {taskProgressSchema,taskProgressInspectSchema,type ProgressPlanInput,type ProgressStepInput,type ProgressDeliveryInput} from '../../evidence/rules/progress-schema';
import type {TaskProgress} from '../../evidence/rules/progress';
import {memberHelpResultSchema,type MemberHelpStaged} from './member-help';
import {artifactCaptureResultSchema,type ArtifactCaptureInput} from '../../evidence/rules/artifact-baseline';
import {memberCheckpointResultSchema} from './member-checkpoint';
import {sameGoalValue} from './scope-goal';
import type {CodeCheckRecord} from '../../evidence/rules/code-check';
import {evaluateWorkflowDelivery,type WorkflowProgressContext} from '../../evidence/rules/workflow-evidence';
import type {OutputManifestProof} from '../../evidence/rules/output-manifest';
import type {ValidationRecord} from '../../evidence/rules/validation';

/** 所有普通、主和成员运行均有这三个真实身份；不把它们添加进 TaskProgress 正文。 */
export interface ProgressToolIdentity {workspaceId:string;taskId:string;runId:string}
// 所有运行均装配进度工具；沿用日志路径既有 safeId 域（1..100 位，允许 _/- 开头），不能在此收窄旧任务身份。
const runId=z.string().refine(value=>{try{safeId(value);return true}catch{return false}},'工作区、任务与运行须使用既有安全标识');
export const progressToolIdentitySchema=z.object({workspaceId:runId,taskId:runId,runId}).strict();
export type MemberToolOutputBinding=MemberHelpStaged['binding'];
export const memberToolOutputSchemas={
  cbim_task_inspect:taskProgressInspectSchema,
  cbim_task_plan:taskProgressSchema,
  cbim_task_step:taskProgressSchema,
  cbim_delivery_prepare:taskProgressSchema,
  cbim_task_help:memberHelpResultSchema,
  cbim_task_artifact_capture:artifactCaptureResultSchema,
  cbim_task_checkpoint:memberCheckpointResultSchema,
} as const;
export type MemberToolName=keyof typeof memberToolOutputSchemas;
export type MemberToolOutput<N extends MemberToolName>=z.infer<(typeof memberToolOutputSchemas)[N]>;
/** 保存前独立冻结；expected 不是 save 返回的同一可变对象，previous 和 evidence 用于重新核对请求语义。 */
export interface ProgressOutputBasis {codeChecks?:readonly CodeCheckRecord[];previous?:TaskProgress;expected:unknown;evidence:readonly ToolReceipt[];workflow?:WorkflowProgressContext;artifactsAvailable?:boolean;validations?:readonly ValidationRecord[];manifest?:OutputManifestProof}
export interface MemberToolOutputExpectation {
  binding:ProgressToolIdentity|MemberToolOutputBinding;
  /** 已通过对应输入 Schema，且在调用端口之前独立冻结。 */
  input:unknown;
  toolCallId?:string;
  knowledgeRevision?:string;
  expectedStaged?:unknown;
  progress?:ProgressOutputBasis;
}
/** 不持有历史或读取模型；作用域和本轮代次由可信调用方提供，排除治理、外部资料及内部记录工具。 */
export function isProgressEvidence(receipt:unknown,identity:ProgressToolIdentity):receipt is ToolReceipt {
  const checked=toolReceiptSchema.safeParse(receipt);if(!checked.success)return false;
  const value=checked.data;
  return value.workspaceId===identity.workspaceId&&value.taskId===identity.taskId&&value.runId===identity.runId&&value.scope.workspaceId===identity.workspaceId&&value.outcome==='succeeded'&&!!value.resultHash&&!!value.toolName.trim()&&value.scope.kind!=='repository'&&!['cbim_repository_','cbim_governance_','cbim_module_owner_','cbim_task_','cbim_dispatch_','cbim_goal_'].some(prefix=>value.toolName.startsWith(prefix))&&value.toolName!=='cbim_delivery_prepare'&&value.toolName!==questionToolName;
}

/** 公开的是实际协议和限制；求助、检查点的门闩不允许模型为了查询而继续调用工具。 */
export function memberToolContract(name:MemberToolName){
  const final=name==='cbim_task_help'||name==='cbim_task_checkpoint';
  const cancellation:ToolCancellation={mode:'preflight_only',description:'运行时在执行前核对当前调用与停止边界；开始保存后不承诺打断或回滚，失败仍可能已有记录。'};
  const recovery:ToolRecovery=name==='cbim_task_inspect'
    ?{mode:'read_again',description:'可显式重新读取当前执行事实，不启动任务、不补造旧计划或证明。'}
    :final?{mode:'inspect_before_retry',description:'暂存后必须结束当前轮，不能继续调用工具或自动重试。由主调度或本机界面核实原运行记录；真实安全交接仍待正常结束与结算。'}
    :{mode:'inspect_before_retry',queryTool:'cbim_task_inspect',description:'先显式核实本轮已保存的计划、版本和可引用事实。输出失败不代表保存回滚；不得自动重复提交或沿旧 expectedVersion 覆盖新状态。'};
  return {version:1,effects:['maintenance'] as const,outputSchema:zodToJsonSchema(memberToolOutputSchemas[name]) as Record<string,unknown>,cancellation,recovery};
}

/** 供 checkedJsonToolResult 在一次序列化后的原 wire 上检查，绝不采用解析器改写后的输出。 */
export function memberToolOutputSchema(name:MemberToolName,expected:MemberToolOutputExpectation):z.ZodTypeAny {
  const schema:z.ZodTypeAny=memberToolOutputSchemas[name];
  return schema.superRefine((value:unknown,context:z.RefinementCtx)=>{
    const issue=(message:string)=>context.addIssue({code:'custom',message});
    if(name==='cbim_task_help'||name==='cbim_task_artifact_capture'||name==='cbim_task_checkpoint'){
      const output=value as MemberToolOutput<'cbim_task_help'>|MemberToolOutput<'cbim_task_artifact_capture'>|MemberToolOutput<'cbim_task_checkpoint'>;
      const record='help' in output?output.help:'baseline' in output?output.baseline:output.checkpoint;
      if(!sameGoalValue(record.binding,expected.binding)||!expected.toolCallId||('captureToolCallId' in record?record.captureToolCallId:record.toolCallId)!==expected.toolCallId)issue('成员工具输出不属于本轮完整绑定或真实调用');
      if(expected.expectedStaged!==undefined&&!sameGoalValue(record,expected.expectedStaged))issue('返回暂存记录与保存前冻结记录不一致');
      if('sourceCalls' in record){
        const input=expected.input as ArtifactCaptureInput;
        if(record.progressVersion!==input.expectedTaskProgressVersion||record.sourceCalls.length!==input.sourceToolCallIds.length||!record.sourceCalls.every(call=>input.sourceToolCallIds.includes(call.toolCallId)))issue('文件基线与明确选择的来源或进度版本不一致');
      }else if(!sameGoalValue(record.input,expected.input))issue('暂存记录与原始授权请求不一致');
      if(expected.knowledgeRevision!==undefined&&'knowledgeRevision' in record&&record.knowledgeRevision!==expected.knowledgeRevision)issue('记录与冻结知识版本不一致');
      return;
    }
    const basis=expected.progress;if(!basis){issue('执行进度缺少保存前冻结依据');return}
    const compared=name==='cbim_task_inspect'?Object.fromEntries(Object.entries(value as object).filter(([key])=>key!=='artifacts')):value;
    if(!sameGoalValue(compared,basis.expected))issue('执行工具输出与本次独立冻结事实不一致');
    if(basis.evidence.some(receipt=>!isProgressEvidence(receipt,expected.binding))){issue('冻结证据包含异轮或非业务回执');return}
    if(name==='cbim_task_inspect'){
      const result=value as MemberToolOutput<'cbim_task_inspect'>;
      if(Object.hasOwn(result,'artifacts')!==!!basis.artifactsAvailable)issue('查询不能补造或省略实际基线读取能力');
      if(result.evidence.some(receipt=>!isProgressEvidence(receipt,expected.binding)))issue('查询回执不属于本轮业务证据');
      if(!sameGoalValue(result.workflowContracts,basis.workflow?.bindings.length?basis.workflow.bindings:undefined))issue('查询 Workflow 与本轮冻结约定不一致');
      return;
    }
    const progress=value as TaskProgress,args=expected.input as ProgressPlanInput|ProgressStepInput|ProgressDeliveryInput;
    if(progress.version!==args.expectedVersion+1||(basis.previous?.version??0)!==args.expectedVersion)issue('执行计划版本与请求不一致');
    if(name==='cbim_task_plan'){
      const input=args as ProgressPlanInput;
      const requested={version:input.expectedVersion+1,goal:input.goal,reason:input.reason,acceptance:input.acceptance,state:'executing',steps:input.steps.map(step=>({...step,state:'pending',evidence:[]}))};
      if(!sameGoalValue(progress,requested))issue('保存计划与原始请求不一致');return;
    }
    const previous=basis.previous;if(!previous){issue('步骤或交付缺少真实前态');return}
    const next=structuredClone(previous);next.version++;next.state='executing';delete next.delivery;
    if(name==='cbim_task_step'){
      const input=args as ProgressStepInput,step=next.steps.find(item=>item.id===input.id);
      if(!step){issue('更新了不存在的步骤');return}
      if(input.evidenceIds.some(id=>!basis.evidence.some(receipt=>receipt.toolCallId===id)))issue('步骤引用了当前代次之外的证据');
      Object.assign(step,{state:input.state,evidence:input.evidenceIds});
    }else{
      const input=args as ProgressDeliveryInput;next.state='awaiting_review';next.delivery={summary:input.summary,limitations:input.limitations};
      if(next.steps.some(step=>step.state!=='reported_done'||!step.evidence.length||step.evidence.some(id=>!basis.evidence.some(receipt=>receipt.toolCallId===id))))issue('交付缺少当前有效步骤证据');
      if(basis.workflow?.bindings.length){
        if(!sameGoalValue(basis.workflow.identity,expected.binding)||next.goal!==basis.workflow.task.goal||!sameGoalValue(next.acceptance,basis.workflow.task.acceptance))issue('Workflow 不属于本轮任务责任');
        if(input.manifestId!==basis.manifest?.manifestId)issue('交付完整清单与原明确选择不一致');
        try{const ids=new Set(next.steps.flatMap(step=>step.evidence));next.delivery.workflow=evaluateWorkflowDelivery(basis.workflow.bindings,basis.evidence.filter(receipt=>ids.has(receipt.toolCallId)),expected.binding,basis.validations,basis.manifest,basis.codeChecks)}catch{issue('Workflow 交付证明无法由本轮真实引用重算')}
      }
    }
    if(!sameGoalValue(progress,next))issue('步骤、交付或 Workflow 证明与前态和请求不一致');
  });
}
