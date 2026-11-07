/**
 * 问答边界：当前与历史候选共用真实业务回执校验，普通回答及取消不能替代目标完成或人工验收依据。
 * 作用定位：在派发事务中保存本轮目标计划与结构化审阅，并为目标门禁、依赖修订和本机人工决定核验真实候选、角色及模块基线。
 * 设计原因：目标与图查询使用同一存储快照；模型只能申请完成或等待，必须等主运行结算后核实证据、任务压力与副作用。计划与候选逐模块匹配显式 Workflow 或原缺省模式，再沿冻结知识从 canonical 重算；明确返工只保留旧候选历史，不把旧文件再次放行。
 * 职责边界：人工项仅引用当前实际消费的接受；审阅和完成均复核原业务主体、精确候选与选定字节，负面意见只能明确安排新任务返工。不关闭周期或签署，外部文件核实不构成原子快照。
 * 证据边界：治理观察、提案和查询仅是私有待办事实，不能被主知识引用或成员候选包装成业务完成证据。
 * 输入边界：运行中补充按真实接收提升输入版本；未决记录阻止推进，审阅、完成和安全等待还双向核对可信插入日志，不能沿旧审阅遗漏新增要求。
 */
import {z} from 'zod';
import {questionToolName} from '../../core/tools/questions';
import {scopeHasUnresolvedActiveInput} from '../../core/tasks/scope-active-input';
import {validateScopeActiveInputLog} from './scope-active-input-evidence';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {RunSummary,StoredEvent} from '../../core/brain/types';
import type {ToolReceipt} from '../../core/tools/types';
import type {DispatchState,DispatchStore} from '../../core/tasks/dispatch-storage';
import type {DispatchRun} from '../../core/tasks/dispatch-execution';
import type {DispatchTaskInput} from '../../core/tasks/dispatch-commands';
import {dispatchScopeWaitSchema,type DispatchScope} from '../../core/tasks/dispatch-scope';
import type {GraphIdentity,GraphSnapshot,TaskNode} from '../../core/tasks/graph-types';
import {goalPlanInputSchema,goalReviewInputSchema,sameGoalValue,scopeGoalDecisionLimit,goalInputRevision,goalNeedsReplan,type DispatchScopeGoal,type GoalPlanInput,type GoalReviewInput,type ScopeGoalReview} from '../../core/tasks/scope-goal';
import {resolveConversationAgent,resolveDispatchAgent,resolveDispatchModules} from '../context/dispatch-context';
import {executionToolFacts} from './execution-report-facts';
import {memberHelpCandidate} from './member-help-state';
import {memberPublicTask} from './member-events';
import {consumedHumanDecision,assertHumanSubject,validateHumanAcceptances,type HumanDecisionPorts} from './human-decision-evidence';
import type {HumanDecisionRecord} from '../../core/tasks/human-decisions';
import {currentHumanContinuation} from '../../core/tasks/human-continuation-rules';
import {validateMemberWorkflow,memberWorkflowFiles} from './member-workflow';
import type {ArtifactFileFact,ArtifactFileCheck} from '../../core/tasks/artifact-baseline';
import {sameWorkflowSelectionsForModules,validateWorkflowSelections} from '../../core/tasks/workflow-selection';

/** 端口只按可信已登记身份读取 canonical 日志；不能接受模型提供路径或摘要。 */
export interface ScopeGoalPorts {
  inspectMember(run:DispatchRun):Promise<RunSummary>;
  inspectMain(rootSessionId:string,runId:string):Promise<RunSummary>;
  /** 与执行端同一纯路径规则及只读文件能力；不得通过报告服务重入当前派发事务。 */
  normalizeValidationPath?(raw:string):string;
  checkValidationFiles?(files:readonly ArtifactFileFact[],signal:AbortSignal):Promise<ArtifactFileCheck[]>;
}
type Owner=Pick<KnowledgeWorkspace,'entry'|'instanceId'|'assert'|'snapshot'|'read'>;
const effects=new Set(['business-write','knowledge-write','command']);
const sameSet=(a:string[],b:string[])=>a.length===b.length&&new Set(a).size===a.length&&a.every(item=>b.includes(item));
const cursor=(graph:GraphSnapshot)=>({streamId:graph.cursor.streamId,seq:graph.cursor.seq});
const identitySchema=z.object({workspaceId:z.string().min(1).max(512),rootSessionId:z.string().min(1).max(512),scopeId:z.string().min(1).max(512)}).strict();
function check(condition:unknown,code:string,message:string):asserts condition{if(!condition)fail(code,message)}
function lastEffect(summary:RunSummary){return summary.events.reduce((latest,event)=>event.type==='tool.allowed'&&(Array.isArray(event.data.effects)&&event.data.effects.some(effect=>effects.has(String(effect)))||['write','edit','bash'].includes(String(event.data.name)))?Math.max(latest,event.seq):latest,0)}

export class ScopeGoalService {
  constructor(private readonly owner:Owner,private readonly store:DispatchStore,private readonly ports?:ScopeGoalPorts,private readonly humanPorts?:HumanDecisionPorts){}
  private parse<S extends z.ZodTypeAny>(schema:S,value:unknown):z.output<S>{const result=schema.safeParse(value);if(!result.success)fail('GOAL_INPUT_INVALID',result.error.issues.map(issue=>issue.message).join('；'));return result.data}
  private scope(state:DispatchState,identity:GraphIdentity,scopeId:string){
    this.parse(identitySchema,{...identity,scopeId});this.owner.assert();
    check(identity.workspaceId===this.owner.entry.id&&state.workspaceId===identity.workspaceId,'GOAL_IDENTITY','目标不属于当前工作区');
    const scope=state.scopes?.find(value=>value.scopeId===scopeId&&value.rootSessionId===identity.rootSessionId&&value.workspaceId===identity.workspaceId);
    check(scope,'GOAL_IDENTITY','目标周期不属于当前主会话');return scope;
  }
  private graph(state:DispatchState,scope:DispatchScope){const graph=state.graphs.find(value=>value.identity.rootSessionId===scope.rootSessionId&&value.identity.workspaceId===scope.workspaceId);check(graph,'GOAL_IDENTITY','目标缺少主会话任务图');return graph}
  private editable(scope:DispatchScope,expectedRevision:number){
    check(!scopeHasUnresolvedActiveInput(scope),'GOAL_ACTIVE_INPUT_UNRESOLVED','运行中补充尚未核实，不能沿旧目标继续决策');
    check(scope.status!=='waiting','GOAL_WAITING','目标已安全等待，请由用户显式补充并继续或停止');
    check(scope.status==='active','GOAL_CLOSED','目标周期已经结束');
    check(scope.goal,'GOAL_LEGACY','旧周期没有可信原始输入，不能补造目标');
    check(!scope.goal.blocked,'GOAL_BLOCKED','目标已记录阻塞，不再接受决策');
    check(scope.goal.revision===expectedRevision,'GOAL_REVISION_CONFLICT','目标版本已变化，请重新读取');
    check(scope.goal.revision<=scopeGoalDecisionLimit,'GOAL_DECISION_LIMIT','本轮目标决策已达到上限');return scope.goal;
  }
  private command(operation:string,identity:GraphIdentity,scopeId:string,runId:string,commandId:string,draft:unknown){
    check(typeof runId==='string'&&runId.trim().length>0&&typeof commandId==='string'&&commandId.trim().length>0,'GOAL_IDENTITY','目标决策缺少可信运行或命令身份');
    return {commandId,fingerprint:hash(json({operation,identity,scopeId,runId,draft}))};
  }
  /** 只读固定身份的周期快照；不创建计划、不读取完整运行日志。 */
  async inspect(identity:GraphIdentity,scopeId:string):Promise<DispatchScope>{return this.scope(await this.store.read(),identity,scopeId)}

  /** 主工具的一次权威读取；scope 与 graph 来自同一快照，公开字段由调用方投影，不拼接两次读取的版本。 */
  async inspectWithGraph(identity:GraphIdentity,scopeId:string):Promise<{scope:DispatchScope;graph:GraphSnapshot}>{
    const state=await this.store.read(),scope=this.scope(state,identity,scopeId);
    return {scope,graph:this.graph(state,scope)};
  }

  /** 核实角色、维护模块和知识后追加计划；主角色可定位治理模块，但业务 Workflow 选择只属于执行角色。 */
  async plan(identity:GraphIdentity,scopeId:string,runId:string,commandId:string,raw:GoalPlanInput):Promise<DispatchScope>{
    const draft=this.parse(goalPlanInputSchema,raw),command=this.command('goal.plan',identity,scopeId,runId,commandId,draft);
    return this.store.transact(command,async state=>{
      const scope=this.scope(state,identity,scopeId),goal=this.editable(scope,draft.expectedRevision),graph=this.graph(state,scope),snapshot=await this.owner.snapshot();
      check(snapshot.workspaceId===scope.workspaceId,'GOAL_IDENTITY','知识快照不属于目标工作区');
      const criterionIds=draft.criteria.map(item=>item.id);
      check((goal.plan?.criteria??[]).filter(item=>item.kind==='human').every(item=>draft.criteria.some(candidate=>sameGoalValue(item,candidate))),'GOAL_HUMAN_REQUIRED','重新规划不能删除或降低既有人工验收项');
      if(scope.replan){
        const proof=scope.replan.source.proof,modules=proof.requiredModules.map(item=>item.moduleId),planned=draft.assignments.flatMap(item=>item.moduleIds);
        check(proof.inheritedHuman.every(({id,text,kind})=>draft.criteria.some(item=>sameGoalValue(item,{id,text,kind}))),'GOAL_HUMAN_REQUIRED','新业务计划必须保留来源业务的人工验收项');
        check(planned.every(id=>modules.includes(id))&&modules.every(id=>planned.includes(id)),'GOAL_MODULE_SCOPE','新业务计划必须完整覆盖且不能超出已核实模块');
      }
      check(new Set(criterionIds).size===criterionIds.length,'GOAL_PLAN_INVALID','验收项 ID 不能重复');
      check(draft.assignments.every(item=>item.criterionIds.every(id=>criterionIds.includes(id)))&&criterionIds.every(id=>draft.assignments.some(item=>item.criterionIds.includes(id))),'GOAL_PLAN_INVALID','每个验收项必须有负责角色，分配不能引用不存在的验收项');
      const assignments=[];
      for(const assignment of draft.assignments){
        check(assignment.agentId!=='cbim:main'||assignment.workflowSelections===undefined,'GOAL_PLAN_INVALID','主 Agent 只治理知识或调度，不能声明业务 Workflow 执行选择');
        validateWorkflowSelections(assignment.moduleIds,assignment.workflowSelections);
        const agent=assignment.agentId==='cbim:main'?resolveConversationAgent(snapshot):await resolveDispatchAgent(snapshot,assignment.agentId);
        check(assignment.agentId==='cbim:main'||assignment.moduleIds.length,'GOAL_PLAN_INVALID','业务执行角色必须明确目标模块');
        const modules=assignment.moduleIds.length?await resolveDispatchModules(snapshot,assignment.moduleIds,assignment.workflowSelections):[];
        assignments.push({...assignment,agentName:agent.name,teamId:agent.teamId,moduleNames:modules.map(module=>module.name)});
      }
      check((await this.owner.read()).revision===snapshot.revision,'GOAL_KNOWLEDGE_CHANGED','规划期间知识已变化，请重新读取');
      const {expectedRevision:_,...body}=draft,newGoal:DispatchScopeGoal={revision:goal.revision+1,...(goal.inputRevision===undefined?{}:{inputRevision:goal.inputRevision}),input:goal.input,plan:{...body,assignments,revision:goal.revision+1,inputRevision:goalInputRevision(goal),runId,recordedAt:new Date().toISOString(),knowledgeRevision:snapshot.revision,graphCursor:cursor(graph)}};
      const next={...scope,goal:newGoal};return {scopes:[next],receipt:next};
    });
  }

  /** 正式派发必须匹配当前计划的角色、模块集合及选择模式；缺省不是任意 Workflow，完成申请后须先重规划。 */
  validateDispatch(state:DispatchState,scope:DispatchScope,input:DispatchTaskInput['task'],knowledgeRevision:string):void{
    check(!scopeHasUnresolvedActiveInput(scope),'GOAL_ACTIVE_INPUT_UNRESOLVED','运行中补充尚未核实，不能派发新任务');
    this.scope(state,{workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId},scope.scopeId);
    // 旧无 goal 周期保持读取/运行兼容，不给历史记录补造计划。
    if(!scope.goal)return;
    check(scope.status==='active'&&!scope.goal.blocked,'GOAL_BLOCKED','周期已经关闭或阻塞');
    const plan=scope.goal.plan;
    check(plan,'GOAL_PLAN_REQUIRED','正式派发前请先保存本轮目标计划');
    check(!goalNeedsReplan(scope.goal),'GOAL_REPLAN_REQUIRED','用户已补充目标，必须按最新输入重新规划再派发');
    check(!scope.goal.review,'GOAL_REPLAN_REQUIRED','已有目标审阅，请显式重规划后再派发');
    check(plan.knowledgeRevision===knowledgeRevision,'GOAL_KNOWLEDGE_CHANGED','计划知识基线已变化，请重新规划');
    check(plan.assignments.some(item=>item.agentId===input.assigneeAgentId&&sameSet(item.moduleIds,input.moduleIds)&&sameWorkflowSelectionsForModules(item.workflowSelections,input.workflowSelections,input.moduleIds)),'GOAL_ASSIGNMENT_MISMATCH','派发角色、模块集合或 Workflow 选择不在当前目标计划中');
  }

  /** 普通聊天与业务完成共用；只读原日志，不重入派发 store，也不补造缺失接收记录。 */
  async validateActiveInputs(scope:DispatchScope,main?:RunSummary):Promise<void>{
    check(!scopeHasUnresolvedActiveInput(scope),'GOAL_ACTIVE_INPUT_UNRESOLVED','运行中补充仍在接收或结果未知，不能沿旧目标完成或安全等待');
    if(main)validateScopeActiveInputLog(scope,main);
    const runs=new Set((scope.activeInputs??[]).filter(item=>item.status==='accepted').map(item=>item.runId));
    for(const runId of runs)if(runId!==main?.runId)validateScopeActiveInputLog(scope,await this.logs().inspectMain(scope.rootSessionId,runId));
  }

  private logs(){check(this.ports,'GOAL_EVIDENCE_UNAVAILABLE','尚未接入可信运行日志，不能审阅或完成目标');return this.ports}
  private main(state:DispatchState,summary:RunSummary,scope:DispatchScope,graph:GraphSnapshot,runId:string){
    const binding=summary.conversationBinding,root=graph.root.agent;
    const channel=state.sessions.find(session=>session.agentSessionId===binding?.agentSessionId&&session.purpose==='conversation');
    check(summary.runId===runId&&summary.task.workspaceId===scope.workspaceId&&summary.task.taskId===scope.rootSessionId&&summary.task.agentId==='cbim:main'&&summary.task.mode==='chat'&&binding?.workspaceId===scope.workspaceId&&binding.rootSessionId===scope.rootSessionId&&binding.agentId==='cbim:main'&&binding.agentInstanceId===root.agentInstanceId&&channel?.workspaceId===scope.workspaceId&&channel.rootSessionId===scope.rootSessionId&&channel.agentInstanceId===root.agentInstanceId&&channel.agentId==='cbim:main'&&channel.teamId===binding.teamId,'GOAL_EVIDENCE_IDENTITY','主运行日志与当前主会话实例或对话通道不一致');
  }
  private receipt(summary:RunSummary,toolCallId:string):{receipt:ToolReceipt;event:StoredEvent}{
    const receipts=(summary.toolReceipts??[]).filter(item=>item.toolCallId===toolCallId),events=summary.events.filter(event=>event.type==='tool.finished'&&event.data.id===toolCallId);
    check(receipts.length===1&&events.length===1,'GOAL_EVIDENCE_INVALID','工具证据缺失或身份重复');
    const receipt=receipts[0],event=events[0],allowed=summary.events.find(item=>item.type==='tool.allowed'&&item.data.id===toolCallId);
    check(receipt.toolName!==questionToolName,'GOAL_EVIDENCE_INVALID','问题回答与取消不是业务完成证据或人工验收决定');
    check(receipt.outcome==='succeeded'&&receipt.workspaceId===summary.task.workspaceId&&receipt.taskId===summary.task.taskId&&receipt.runId===summary.runId&&event.workspaceId===receipt.workspaceId&&event.taskId===receipt.taskId&&event.runId===receipt.runId&&event.data.isError!==true&&sameGoalValue(event.data.receipt,receipt)&&receipt.resultHash===hash(JSON.stringify(event.data.result)),'GOAL_EVIDENCE_INVALID','工具回执或结果正文不匹配');
    check(allowed&&allowed.seq<event.seq&&allowed.data.name===receipt.toolName&&receipt.inputHash===hash(JSON.stringify(allowed.data.input))&&allowed.seq>=lastEffect(summary),'GOAL_EVIDENCE_STALE','证据不属于最后一次副作用之后的有效执行');
    check(!receipt.toolName.startsWith('cbim_task_')&&!receipt.toolName.startsWith('cbim_dispatch_')&&!receipt.toolName.startsWith('cbim_goal_')&&!receipt.toolName.startsWith('cbim_governance_')&&receipt.toolName!=='cbim_delivery_prepare','GOAL_EVIDENCE_INVALID','调度、计划、审阅或治理待办回执不能作为业务完成证据');
    return {receipt,event};
  }
  private async member(state:DispatchState,scope:DispatchScope,graph:GraphSnapshot,task:TaskNode,knowledgeRevision:string,historical=false){
    const result=task.result;
    check(task.scopeId===scope.scopeId&&task.identity.workspaceId===scope.workspaceId&&task.identity.rootSessionId===scope.rootSessionId&&task.status==='result_ready'&&!task.activeRunId&&result&&result.planRevision===task.planRevision&&task.runIds.includes(result.runId),'GOAL_EVIDENCE_INVALID','成员任务没有当前周期的有效交付候选');
    const run=state.runs?.find(item=>item.binding.runId===result.runId&&item.binding.taskId===task.taskId);
    check(run&&run.status==='completed'&&run.binding.workspaceId===scope.workspaceId&&run.binding.rootSessionId===scope.rootSessionId&&run.binding.agentId===task.assignee.agentId&&run.binding.agentInstanceId===task.assignee.agentInstanceId&&run.binding.agentSessionId===task.assignee.agentSessionId&&run.binding.planRevision===task.planRevision,'GOAL_EVIDENCE_IDENTITY','成员运行与任务候选身份不一致');
    check(run.prepared.knowledgeRevision===knowledgeRevision&&task.modules.every(module=>module.knowledgeRevision===knowledgeRevision),'GOAL_EVIDENCE_STALE','成员候选属于旧知识基线，需要重新执行验证');
    const summary=await this.logs().inspectMember(run);
    check(summary.runId===run.binding.runId&&summary.task.taskId===task.taskId&&summary.task.workspaceId===scope.workspaceId&&summary.task.agentId===task.assignee.agentId&&sameGoalValue(summary.memberBinding,run.binding)&&summary.status==='completed'&&!summary.logIntegrity?.partialTail&&!summary.unresolvedTools.length,'GOAL_EVIDENCE_INVALID','成员日志尚未完整结束或绑定不一致');
    const progress=summary.taskProgress;
    check(progress?.state==='awaiting_review'&&progress.delivery&&progress.goal===task.goal&&sameGoalValue(progress.acceptance,task.acceptance.map(item=>item.text))&&progress.delivery.summary===result.summary&&sameGoalValue(progress.delivery.limitations,result.limitations)&&progress.steps.length&&progress.steps.every(step=>step.state==='reported_done'&&step.evidence.length)&&sameSet([...new Set(progress.steps.flatMap(step=>step.evidence))],result.evidenceRefs),'GOAL_EVIDENCE_INVALID','候选内容与运行的真实交付记录不一致');
    for(const id of result.evidenceRefs)this.receipt(summary,id);
    try{
      if(historical)memberWorkflowFiles(task,run,summary,this.owner.entry.path,this.ports?.normalizeValidationPath);
      else await validateMemberWorkflow(task,run,summary,this.owner.entry.path,this.ports?.checkValidationFiles&&this.ports.normalizeValidationPath?{normalizePath:this.ports.normalizeValidationPath,checkFiles:this.ports.checkValidationFiles}:undefined);
    }catch(error){fail('GOAL_WORKFLOW_UNMET',error instanceof Error?error.message:'成员 Workflow 程序条件无法核实')}
    return summary;
  }
  /** 调度修订复用交付证据规则，并要求 canonical 头、连续事件及实际终态完整；不把候选视为验收。 */
  async validateMemberCandidate(state:DispatchState,scope:DispatchScope,graph:GraphSnapshot,task:TaskNode,knowledgeRevision:string):Promise<RunSummary>{
    const summary=await this.member(state,scope,graph,task,knowledgeRevision),run=state.runs!.find(item=>item.binding.runId===task.result!.runId&&item.binding.taskId===task.taskId)!;
    this.memberTerminal(scope,task,run,summary);return summary;
  }
  /** 仅核历史真实交付；人工负面可据此记录，接受调用方必须另合并核全部当前验证及基线文件。 */
  async validateHistoricalMemberCandidate(state:DispatchState,scope:DispatchScope,graph:GraphSnapshot,task:TaskNode,knowledgeRevision:string):Promise<RunSummary>{
    const summary=await this.member(state,scope,graph,task,knowledgeRevision,true),run=state.runs!.find(item=>item.binding.runId===task.result!.runId&&item.binding.taskId===task.taskId)!;
    this.memberTerminal(scope,task,run,summary);return summary;
  }
  /**
   * 人工决定只读取当前安全等待中的一个 human 项及其全部真实历史候选；文件变化不能阻止拒绝或补证。
   * 返回 canonical 摘要及冻结验证文件供同批当前字节校验。接受另须核全部验证文件，不能只选未变化的基线子集。
   */
  async validateHumanCandidates(state:DispatchState,scope:DispatchScope,criterionId:string){
    const graph=this.graph(state,scope),goal=scope.goal,review=goal?.review,wait=scope.wait,plan=goal?.plan;
    check(scope.status==='waiting'&&goal&&!goal.blocked&&plan&&review?.decision==='awaiting_user'&&wait&&wait.runId===review.runId&&wait.goalRevision===goal.revision&&review.revision===goal.revision&&review.planRevision===plan.revision&&!goalNeedsReplan(goal)&&goalInputRevision(review)===goalInputRevision(goal),'HUMAN_NOT_WAITING','人工决定只接受当前安全等待的目标及审阅');
    const criterion=plan.criteria.find(item=>item.id===criterionId),item=review.checks.find(item=>item.criterionId===criterionId);
    check(criterion?.kind==='human'&&item&&item.evidence.length&&item.evidence.every(reference=>reference.kind==='member-result'),'HUMAN_SOURCE_INVALID','请选择含真实成员候选的人工验收项；本步不接主知识治理证据');
    check(!graph.tasks.some(task=>task.scopeId===scope.scopeId&&(task.activeRunId||['planned','queued','running','waiting','checkpointed'].includes(task.status)))&&!state.runs?.some(run=>run.binding.rootSessionId===scope.rootSessionId&&['starting','running'].includes(run.status))&&!state.members.some(member=>member.executionScopeId===scope.scopeId&&(member.activeRunId||member.activeTaskId||member.activity!=='idle'||member.waitingTaskIds.length||member.communicatingMessageIds.length)),'HUMAN_NOT_WAITING','当前周期仍有活动或待执行工作，不能保存人工决定');
    const snapshot=await this.owner.read();
    check(snapshot.revision===review.knowledgeRevision&&snapshot.revision===wait.knowledgeRevision&&snapshot.revision===plan.knowledgeRevision,'HUMAN_KNOWLEDGE_CHANGED','人工验收依据的知识版本已变化，需要重新安排核实');
    const main=await this.logs().inspectMain(scope.rootSessionId,review.runId);this.main(state,main,scope,graph,review.runId);
    const head=main.events[0],tail=main.events.at(-1),bounds=main.events.filter(event=>event.type==='session.bound'),facts=executionToolFacts(main,{binding:{workspaceId:scope.workspaceId,taskId:scope.rootSessionId,runId:review.runId}});
    check(main.status==='completed'&&main.logIntegrity?.partialTail===false&&!main.unresolvedTools.length&&head?.type==='run.started'&&sameGoalValue(head.data.task,main.task)&&sameGoalValue(head.data.conversationBinding,main.conversationBinding)&&!head.data.memberBinding&&tail?.type==='run.settled'&&tail.data.status==='completed'&&main.events.every((event,index)=>event.seq===index+1&&event.workspaceId===scope.workspaceId&&event.taskId===scope.rootSessionId&&event.runId===review.runId)&&!!main.sessionFile&&bounds.length&&bounds.every(event=>event.data.sessionFile===main.sessionFile&&typeof event.data.sessionId==='string'&&!!event.data.sessionId&&event.data.sessionId===bounds[0].data.sessionId)&&!facts.invalid&&!facts.counts.unknown&&!facts.counts.not_authorized,'HUMAN_EVIDENCE_INVALID','主审阅日志或原生通道登记不完整，不能据此保存人工决定');
    check(sameGoalValue(wait.graphCursor,review.graphCursor)&&sameGoalValue(review.graphCursor,cursor(graph))&&lastEffect(main)===review.lastEffectSeq&&review.observedSeq<tail.seq,'HUMAN_STALE','等待后的任务图、主审阅或副作用依据发生变化');
    const selected=new Map<string,{task:TaskNode;run:DispatchRun;summary:RunSummary;evidenceToolCallIds:string[];workflowFiles:ArtifactFileFact[]}>();
    for(const reference of item.evidence){
      check(reference.kind==='member-result','HUMAN_SOURCE_INVALID','人工验收只支持成员结果');
      const task=graph.tasks.find(task=>task.taskId===reference.taskId),result=task?.result;
      check(task&&result&&result.runId===reference.runId&&result.resultId===reference.resultId&&result.planRevision===reference.planRevision&&reference.toolCallIds.length&&reference.toolCallIds.every(id=>result.evidenceRefs.includes(id))&&plan.assignments.some(assignment=>assignment.agentId===task.assignee.agentId&&sameSet(assignment.moduleIds,task.modules.map(module=>module.moduleId))&&sameWorkflowSelectionsForModules(assignment.workflowSelections,task.workflowSelections,task.modules.map(module=>module.moduleId))&&assignment.criterionIds.includes(criterionId)),'HUMAN_SOURCE_INVALID','候选、证据、模块或 Workflow 分工不属于此人工验收项');
      let candidate=selected.get(task.taskId);
      if(!candidate){
        const summary=await this.validateHistoricalMemberCandidate(state,scope,graph,task,snapshot.revision),run=state.runs!.find(run=>run.binding.runId===result.runId&&run.binding.taskId===task.taskId)!;
        const workflowFiles=memberWorkflowFiles(task,run,summary,this.owner.entry.path,this.ports?.normalizeValidationPath);
        candidate={task,run,summary,evidenceToolCallIds:[],workflowFiles};selected.set(task.taskId,candidate);
      }
      for(const id of reference.toolCallIds){this.receipt(candidate.summary,id);if(!candidate.evidenceToolCallIds.includes(id))candidate.evidenceToolCallIds.push(id)}
    }
    check(selected.size<=16,'HUMAN_LIMIT','单项人工决定最多核实 16 个成员候选');
    check((await this.owner.read()).revision===snapshot.revision,'HUMAN_KNOWLEDGE_CHANGED','人工验收依据读取期间知识版本发生变化');
    return {graph,criterion:{...criterion,kind:'human' as const},main,knowledgeRevision:snapshot.revision,candidates:[...selected.values()].sort((a,b)=>a.task.taskId<b.task.taskId?-1:1)};
  }
  /** 换边前核验完整执行来源；只有无通道且无工具事实的明确启动失败可省略原生绑定。 */
  private memberTerminal(scope:DispatchScope,task:TaskNode,run:DispatchRun,summary:RunSummary){
    const binding=run.binding;
    check(binding.workspaceId===scope.workspaceId&&binding.rootSessionId===scope.rootSessionId&&binding.taskId===task.taskId&&binding.agentId===task.assignee.agentId&&binding.agentInstanceId===task.assignee.agentInstanceId&&binding.agentSessionId===task.assignee.agentSessionId&&binding.planRevision===task.planRevision&&summary.runId===binding.runId&&sameGoalValue(summary.task,memberPublicTask(task,this.owner.entry.path))&&!summary.conversationBinding&&sameGoalValue(summary.memberBinding,binding),'GOAL_EVIDENCE_IDENTITY','成员日志与原任务身份、模块、目标或验收不一致');
    check(['completed','failed'].includes(run.status)&&summary.status===run.status&&summary.logIntegrity?.partialTail===false&&!summary.unresolvedTools.length&&!summary.toolReceipts?.some(receipt=>receipt.outcome==='unknown'),'GOAL_EVIDENCE_INVALID','成员执行记录尚未可靠结束或有未知结果');
    const first=summary.events[0],last=summary.events.at(-1);
    check(first?.type==='run.started'&&sameGoalValue(first.data.task,summary.task)&&sameGoalValue(first.data.memberBinding,binding)&&!first.data.conversationBinding&&last?.type==='run.settled'&&last.data.status===summary.status&&summary.events.every((event,index)=>event.seq===index+1&&event.workspaceId===scope.workspaceId&&event.taskId===task.taskId&&event.runId===binding.runId&&event.data&&typeof event.data==='object'&&!Array.isArray(event.data)),'GOAL_EVIDENCE_INVALID','成员日志头、连续顺序或终态不完整');
    const bindings=summary.events.filter(event=>event.type==='session.bound');
    // 启动前明确失败可没有原生通道，但不能携带任何工具事实；已有通道不能靠空绑定事件列表蒙混通过。
    check(summary.sessionFile===run.session.sessionFile&&(bindings.length?!!run.session.sessionFile&&bindings.every(event=>event.data.sessionId===run.session.nativeSessionId&&event.data.sessionFile===run.session.sessionFile):summary.status==='failed'&&!summary.sessionFile&&!summary.toolReceipts?.length&&!summary.events.some(event=>event.type.startsWith('tool.'))),'GOAL_EVIDENCE_IDENTITY','成员原生会话绑定与已登记运行不一致');
    const facts=executionToolFacts(summary,run);check(!facts.invalid&&!facts.counts.unknown&&!facts.counts.not_authorized,'GOAL_EVIDENCE_INVALID','成员工具仍有未知副作用或缺失授权链');
  }
  /** 只接受可靠求助或明确失败来源；重读全部已登记运行，不能以换边隐藏未决操作或把失败当未执行。 */
  async validateDependencySource(state:DispatchState,scope:DispatchScope,task:TaskNode):Promise<void>{
    check(task.scopeId===scope.scopeId&&!task.activeRunId&&!task.result&&(task.status==='failed'||task.status==='blocked'&&task.help),'GOAL_EVIDENCE_INVALID','原前置没有可安全替换的失败或求助记录');
    const runs=(state.runs??[]).filter(run=>run.binding.taskId===task.taskId&&run.binding.rootSessionId===scope.rootSessionId);
    check(runs.length>0&&sameSet(runs.map(run=>run.binding.runId),task.runIds),'GOAL_EVIDENCE_IDENTITY','原前置运行登记不完整');
    for(const run of runs){
      const summary=await this.logs().inspectMember(run);this.memberTerminal(scope,task,run,summary);
      if(task.help&&run.binding.runId===task.help.binding.runId)check(sameGoalValue(memberHelpCandidate(task,run,summary),task.help),'GOAL_EVIDENCE_INVALID','原前置求助与真实安全交接记录不一致');
      else check(run.status==='failed','GOAL_EVIDENCE_INVALID','原前置不是明确失败，不能绕过已有结果');
    }
  }
  private async evidence(state:DispatchState,scope:DispatchScope,graph:GraphSnapshot,draft:GoalReviewInput,main:RunSummary,knowledgeRevision:string){
    const plan=scope.goal!.plan!,criteria=plan.criteria,checks=draft.checks;
    check(new Set(checks.map(item=>item.criterionId)).size===checks.length&&checks.every(item=>criteria.some(criterion=>criterion.id===item.criterionId)),'GOAL_REVIEW_INVALID','审阅项重复或不属于当前计划');
    if(checks.some(item=>item.evidence.some(ref=>ref.kind==='human-decision'))||draft.superseded.some(item=>item.humanDecision)){
      const intent=currentHumanContinuation(scope);check(intent,'GOAL_HUMAN_SOURCE','人工引用没有当前输入实际消费的意图');
      const origin=intent.runId===main.runId?main:await this.logs().inspectMain(scope.rootSessionId,intent.runId);this.main(state,origin,scope,graph,intent.runId);
      const header=origin.events[0],source=header?.data.source as Record<string,unknown>|undefined;
      check(origin.logIntegrity?.partialTail===false&&header?.type==='run.started'&&sameGoalValue(header.data.task,origin.task)&&sameGoalValue(header.data.conversationBinding,origin.conversationBinding)&&header.data.resumeFrom===intent.wait.runId&&source?.kind==='human_decisions'&&source.continuationId===intent.continuationId&&source.scopeId===scope.scopeId&&source.waitId===intent.wait.waitId&&source.inputRevision===intent.inputRevision&&source.decisionRevision===intent.decisionRevision&&Array.isArray(source.decisionIds)&&sameSet(source.decisionIds as string[],intent.decisionIds),'GOAL_HUMAN_SOURCE','人工接续原始日志没有对应可信来源或已被改写');
      const bindings=origin.events.filter(event=>event.type==='session.bound');
      check(origin.events.every((event,index)=>event.seq===index+1&&event.workspaceId===scope.workspaceId&&event.taskId===scope.rootSessionId&&event.runId===intent.runId)&&!!origin.sessionFile&&bindings.length>0&&bindings.every(event=>typeof event.data.sessionId==='string'&&!!event.data.sessionId&&event.data.sessionId===bindings[0].data.sessionId&&event.data.sessionFile===origin.sessionFile),'GOAL_HUMAN_SOURCE','人工接续来源的连续事件或原生绑定不完整');
      if(origin.runId!==main.runId){
        const terminal=origin.events.at(-1),facts=executionToolFacts(origin,{binding:{workspaceId:scope.workspaceId,taskId:scope.rootSessionId,runId:origin.runId}});
        check(origin.status==='completed'&&terminal?.type==='run.settled'&&terminal.data.status==='completed'&&!origin.unresolvedTools.length&&!facts.invalid&&!facts.counts.unknown,'GOAL_HUMAN_SOURCE','前一人工接续运行未安全结束或存在未知工具，不能沿用其决定');
      }
    }
    const members=new Map<string,Promise<RunSummary>>(),acceptedHumans=new Map<string,HumanDecisionRecord>();
    for(const item of checks){
      const criterion=criteria.find(value=>value.id===item.criterionId)!;
      check(criterion.kind!=='human'||item.outcome!=='satisfied'||item.evidence.some(reference=>reference.kind==='human-decision'),'GOAL_HUMAN_REQUIRED','人工项满足必须引用本输入版本实际消费的接受决定');
      if(item.outcome==='satisfied')check(item.evidence.length,'GOAL_EVIDENCE_REQUIRED','已满足的验收项必须有真实证据');
      for(const reference of item.evidence){
        if(reference.kind==='member-result'){
          const task=graph.tasks.find(value=>value.taskId===reference.taskId),result=task?.result;
          check(task&&result&&result.runId===reference.runId&&result.resultId===reference.resultId&&result.planRevision===reference.planRevision&&reference.toolCallIds.every(id=>result.evidenceRefs.includes(id)),'GOAL_EVIDENCE_INVALID','成员证据不是当前结果候选');
          check(plan.assignments.some(assignment=>assignment.agentId===task.assignee.agentId&&sameSet(assignment.moduleIds,task.modules.map(module=>module.moduleId))&&sameWorkflowSelectionsForModules(assignment.workflowSelections,task.workflowSelections,task.modules.map(module=>module.moduleId))&&assignment.criterionIds.includes(item.criterionId)),'GOAL_EVIDENCE_IDENTITY','成员结果不属于此验收项的角色、模块或 Workflow 分配');
          if(!members.has(task.taskId))members.set(task.taskId,this.member(state,scope,graph,task,knowledgeRevision));
          const summary=await members.get(task.taskId)!;for(const id of reference.toolCallIds)this.receipt(summary,id);
        }else if(reference.kind==='human-decision'){
          check(criterion.kind==='human','GOAL_HUMAN_SOURCE','人工决定不能替代普通证据项');
          const {continuation,record}=consumedHumanDecision(scope,reference,item.criterionId);
          check(item.outcome==='satisfied'&&record.decision==='accept','GOAL_HUMAN_REQUIRED','人工证据只用于引用已接受的满足项；拒绝或补证应通过替代关系引用');assertHumanSubject(scope,continuation);acceptedHumans.set(record.decisionId,record);
        }else{
          check(plan.assignments.some(assignment=>assignment.agentId==='cbim:main'&&assignment.criterionIds.includes(item.criterionId)),'GOAL_EVIDENCE_IDENTITY','此验收项未分配给主角色治理');
          for(const id of reference.toolCallIds){
            const {receipt,event}=this.receipt(main,id);
            check(['cbim_knowledge_commit','cbim_object_commit'].includes(receipt.toolName)&&receipt.effects.includes('knowledge-write')&&receipt.scope.kind==='knowledge','GOAL_EVIDENCE_INVALID','主角色证据只接受知识服务的真实提交');
            const result=event.data.result as {content?:Array<{type?:string;text?:string}>};let body:Record<string,unknown>|undefined;
            try{const texts=result.content?.filter(value=>value.type==='text');if(texts?.length===1)body=JSON.parse(texts[0].text!)}catch{/* 下方统一拒绝无效正文，不回显私密内容。 */}
            check(body?.state==='committed'&&body.workspaceId===scope.workspaceId&&body.instanceId===this.owner.instanceId&&body.revision===knowledgeRevision&&typeof body.requestId==='string'&&Array.isArray(body.changed)&&body.changed.length>0&&body.changed.every(value=>typeof value==='string'&&value.startsWith('.cbim/')),'GOAL_EVIDENCE_INVALID','知识提交正文没有证明当前版本的真实变更');
          }
        }
      }
      if(criterion.kind==='human'&&item.outcome==='satisfied'){
        const ref=item.evidence.find(reference=>reference.kind==='human-decision');check(ref?.kind==='human-decision','GOAL_HUMAN_REQUIRED','人工满足缺少已消费接受');const {record}=consumedHumanDecision(scope,ref,item.criterionId);
        check(item.evidence.every(reference=>reference.kind==='human-decision'||reference.kind==='member-result'&&record.proof.candidates.some(candidate=>candidate.taskId===reference.taskId&&candidate.runId===reference.runId&&candidate.resultId===reference.resultId&&candidate.planRevision===reference.planRevision&&reference.toolCallIds.every(id=>candidate.evidenceToolCallIds.includes(id)))),'GOAL_HUMAN_CANDIDATE','人工满足不能混入此次接受以外的新候选或证据');
      }
    }
    try{await validateHumanAcceptances(this.owner,state,scope,[...acceptedHumans.values()],this.ports,this.humanPorts,this.validateHistoricalMemberCandidate.bind(this))}catch(error){
      // 完成门禁保留 GOAL 命名空间，让协调器记录阻塞并收束；接受依据失效不能留下悬挂的活动周期。
      fail('GOAL_HUMAN_STALE',error instanceof Error?error.message:'人工接受的当前依据无法核实');
    }
    if(draft.decision==='complete')check(!draft.gaps.length&&checks.length===criteria.length&&checks.every(item=>item.outcome==='satisfied'),'GOAL_CRITERIA_UNMET','仍有未满足或需要人工确认的验收项');
    await this.supersessions(state,scope,graph,draft,members,knowledgeRevision);
  }
  private async supersessions(state:DispatchState,scope:DispatchScope,graph:GraphSnapshot,draft:GoalReviewInput,cache:Map<string,Promise<RunSummary>>,knowledgeRevision:string){
    const entries=draft.superseded,ids=entries.map(item=>item.taskId);
    check(new Set(ids).size===ids.length,'GOAL_REVIEW_INVALID','同一失败任务不能重复指定替代关系');
    const edges=new Map(entries.map(item=>[item.taskId,item.replacementTaskIds])),colors=new Map<string,'visiting'|'done'>();
    // 共享子路径只遍历一次，防止模型构造稠密无环关系导致指数递归。
    const visit=(id:string)=>{check(colors.get(id)!=='visiting','GOAL_SUPERSESSION_CYCLE','任务替代关系不能成环');if(colors.get(id)==='done')return;colors.set(id,'visiting');for(const next of edges.get(id)??[])visit(next);colors.set(id,'done')};
    for(const id of ids)visit(id);
    for(const item of entries){
      const source=graph.tasks.find(task=>task.taskId===item.taskId);
      const stale=source?.status==='result_ready'&&state.runs?.some(run=>run.binding.runId===source.result?.runId&&run.prepared.knowledgeRevision!==knowledgeRevision);
      const human=item.humanDecision?consumedHumanDecision(scope,item.humanDecision):undefined;
      if(human){
        const candidate=human.record.proof.candidates.find(candidate=>candidate.taskId===source?.taskId);
        check(human.record.decision!=='accept'&&source?.status==='result_ready'&&candidate&&candidate.taskRevision===source.revision&&candidate.planRevision===source.planRevision&&candidate.resultId===source.result?.resultId&&candidate.runId===source.result?.runId,'GOAL_SUPERSESSION_INVALID','返工引用必须是本次消费的拒绝或补证及其精确旧候选');
        // 返工允许文件变化，但不能把旧运行损坏或未知结果藏在 superseded 后跳过完成核实。
        const summary=await this.member(state,scope,graph,source,human.record.proof.source.knowledgeRevision,true),historicalRun=state.runs!.find(run=>run.binding.runId===source.result!.runId&&run.binding.taskId===source.taskId)!;
        this.memberTerminal(scope,source,historicalRun,summary);
        check(hash(json(summary.events))===candidate.logHash&&candidate.evidenceToolCallIds.every(id=>source.result!.evidenceRefs.includes(id)),'GOAL_SUPERSESSION_INVALID','被拒候选的原始日志或证据已经变化，不能用旧决定替代');
      }
      check(source&&source.scopeId===scope.scopeId&&(['failed','blocked','cancelled','interrupted'].includes(source.status)||stale||human),'GOAL_SUPERSESSION_INVALID','只能替代失败、基线过期或本次人工决定明确要求返工的候选');
      const covered=new Set<string>();
      for(const id of item.replacementTaskIds){
        const replacement=graph.tasks.find(task=>task.taskId===id);
        check(replacement&&replacement.scopeId===scope.scopeId&&graph.tasks.indexOf(replacement)>graph.tasks.indexOf(source),'GOAL_SUPERSESSION_INVALID','替代任务必须是本周期后续创建的任务');
        if(human)check(!human.continuation.priorTaskIds.includes(replacement.taskId),'GOAL_SUPERSESSION_INVALID','人工返工必须创建接续之后的新任务，不能借用先前已有候选');
        for(const module of replacement.modules)covered.add(module.moduleId);
        if(!cache.has(id))cache.set(id,this.member(state,scope,graph,replacement,knowledgeRevision));await cache.get(id);
      }
      check(source.modules.every(module=>covered.has(module.moduleId)),'GOAL_SUPERSESSION_INVALID','替代任务集合没有覆盖原目标模块');
    }
    if(draft.decision==='complete'){
      const tasks=graph.tasks.filter(task=>task.scopeId===scope.scopeId);
      check(!tasks.some(task=>task.activeRunId||['planned','queued','running','waiting','checkpointed'].includes(task.status))&&!state.runs?.some(run=>tasks.some(task=>task.taskId===run.binding.taskId)&&['starting','running'].includes(run.status)),'GOAL_WORK_PENDING','本周期还有未结束的任务、检查点或运行');
      for(const task of tasks)if(task.status==='result_ready'&&!ids.includes(task.taskId)){
        if(!cache.has(task.taskId))cache.set(task.taskId,this.member(state,scope,graph,task,knowledgeRevision));await cache.get(task.taskId);
      }else check(ids.includes(task.taskId),'GOAL_WORK_FAILED','本周期失败任务尚未被真实成功任务替代');
    }
  }

  /** 工具阶段仅登记审阅请求；当前 review 工具尚未结束，完整运行终态留到 validateCompletion 核验。 */
  async review(identity:GraphIdentity,scopeId:string,runId:string,commandId:string,raw:GoalReviewInput):Promise<DispatchScope>{
    const draft=this.parse(goalReviewInputSchema,raw),command=this.command('goal.review',identity,scopeId,runId,commandId,draft);
    return this.store.transact(command,async state=>{
      const scope=this.scope(state,identity,scopeId),goal=this.editable(scope,draft.expectedRevision),graph=this.graph(state,scope);
      check(goal.plan,'GOAL_PLAN_REQUIRED','审阅前必须建立本轮目标计划');
      check(!goalNeedsReplan(goal),'GOAL_REPLAN_REQUIRED','用户已补充目标，必须按最新输入重新规划再审阅');
      const main=await this.logs().inspectMain(scope.rootSessionId,runId);this.main(state,main,scope,graph,runId);
      check(!main.logIntegrity?.partialTail,'GOAL_EVIDENCE_INVALID','主运行日志尾行不完整，不能据此前缀审阅');
      await this.validateActiveInputs(scope,main);
      const snapshot=await this.owner.read();await this.evidence(state,scope,graph,draft,main,snapshot.revision);
      check((await this.owner.read()).revision===snapshot.revision,'GOAL_KNOWLEDGE_CHANGED','审阅期间知识版本发生变化');
      const {expectedRevision:_,...body}=draft,review:ScopeGoalReview={...body,revision:goal.revision+1,inputRevision:goalInputRevision(goal),planRevision:goal.plan.revision,runId,recordedAt:new Date().toISOString(),knowledgeRevision:snapshot.revision,graphCursor:cursor(graph),observedSeq:main.events.at(-1)?.seq??0,lastEffectSeq:lastEffect(main)};
      const next={...scope,goal:{...goal,revision:goal.revision+1,review}};return {scopes:[next],receipt:next};
    });
  }
  /** 在父级关闭事务中调用，不重入 store；复核同一主运行真实终态及完成申请之后的图/知识/副作用变化。 */
  async validateCompletion(state:DispatchState,scope:DispatchScope,summary:RunSummary):Promise<void>{
    await this.validateActiveInputs(scope,summary);
    this.logs();const graph=this.graph(state,scope),goal=scope.goal,review=goal?.review;
    check(scope.status==='active'&&goal&&!goal.blocked&&goal.plan&&review?.decision==='complete'&&review.revision===goal.revision&&review.planRevision===goal.plan.revision,'GOAL_REVIEW_REQUIRED','目标尚未有当前版本的完成审阅');
    check(!goalNeedsReplan(goal)&&goalInputRevision(review)===goalInputRevision(goal),'GOAL_REPLAN_REQUIRED','完成审阅没有覆盖最新用户补充');
    this.main(state,summary,scope,graph,review.runId);
    check(summary.status==='completed'&&!summary.logIntegrity?.partialTail&&!summary.unresolvedTools.length,'GOAL_MAIN_UNSETTLED','主运行尚未完整结束');
    check(sameGoalValue(review.graphCursor,cursor(graph)),'GOAL_GRAPH_CHANGED','完成申请后任务图已变化，请重新审阅');
    check(lastEffect(summary)===review.lastEffectSeq&&!summary.events.some(event=>event.seq>review.observedSeq&&event.type==='tool.allowed'&&Array.isArray(event.data.effects)&&event.data.effects.some(effect=>effects.has(String(effect)))),'GOAL_EFFECT_CHANGED','完成申请后又发生可能改变产物的操作');
    const snapshot=await this.owner.read();check(snapshot.revision===review.knowledgeRevision,'GOAL_KNOWLEDGE_CHANGED','完成申请后知识版本已变化');
    await this.evidence(state,scope,graph,{...review,expectedRevision:goal.revision},summary,snapshot.revision);
    check((await this.owner.read()).revision===snapshot.revision,'GOAL_KNOWLEDGE_CHANGED','完成核验期间知识版本已变化');
  }
  /**
   * 为显式业务新周期重新核实已封存的只读核实周期，不假装重开 scope，也不要求关闭释放后的图游标等于旧审阅游标。
   * 全部主链与成员运行均读取 canonical 记录；旧业务的未知事实不在此更正。返回哈希只是这批记录的版本证明，不是业务产物指纹。
   */
  async validateCompletedInspection(state:DispatchState,scope:DispatchScope):Promise<{knowledgeRevision:string;evidenceDigest:string;coveredModuleIds:string[]}>{
    const logs=this.logs(),graph=this.graph(state,scope),goal=scope.goal,review=goal?.review,recovery=scope.recovery;
    check(scope.status==='closed'&&scope.outcome==='completed'&&recovery&&goal&&!goal.blocked&&goal.plan&&review?.decision==='complete'&&review.revision===goal.revision&&review.planRevision===goal.plan.revision,'REPLAN_SOURCE_INVALID','只能从已完成并通过目标审阅的只读核实周期创建业务新周期');
    check(!goalNeedsReplan(goal)&&goalInputRevision(review)===goalInputRevision(goal)&&goal.plan.knowledgeRevision===review.knowledgeRevision,'REPLAN_PROOF_INVALID','核实计划、输入和审阅版本不一致');
    const knowledge=await this.owner.read();check(knowledge.revision===review.knowledgeRevision,'REPLAN_KNOWLEDGE_CHANGED','核实完成后知识已经变化，需要重新核实');
    const recorded:Array<{summary:RunSummary;run?:DispatchRun}>=[],mainIds=new Set<string>();
    const audit=(summary:RunSummary)=>{
      check(!summary.logIntegrity?.partialTail&&!summary.unresolvedTools.length&&['run.settled','run.interrupted'].includes(summary.events.at(-1)?.type??''),'REPLAN_PROOF_INVALID','核实日志不完整或仍有未决操作');
      const facts=executionToolFacts(summary,{binding:{workspaceId:scope.workspaceId,taskId:summary.task.taskId,runId:summary.runId}});
      check(!facts.invalid&&!facts.counts.unknown,'REPLAN_PROOF_INVALID','核实日志有未知或矛盾工具回执');
      check(!facts.items.some(item=>item.allowedSeq!==undefined&&(item.effects.some(effect=>effects.has(effect))||['write','edit','bash'].includes(item.toolName))),'REPLAN_PROOF_INVALID','只读核实期间存在写入或命令授权，不能作为业务重规划依据');
    };
    let runId=review.runId,main:RunSummary|undefined,nativeFile:string|undefined;
    for(;;){
      check(!mainIds.has(runId)&&mainIds.size<32&&!recovery.context.excludedRunIds.includes(runId),'REPLAN_PROOF_INVALID','核实主运行链循环、超限或混入旧上下文');mainIds.add(runId);
      const summary=await logs.inspectMain(scope.rootSessionId,runId);this.main(state,summary,scope,graph,runId);
      check(summary.status==='completed','REPLAN_PROOF_INVALID','核实主链含未完整完成的运行');audit(summary);recorded.push({summary});if(!main)main=summary;
      const header=summary.events.find(event=>event.type==='run.started')?.data;
      check(header&&recovery.options.permission==='read'&&(scope.continuations??[]).every(item=>item.options.permission==='read'),'REPLAN_PROOF_INVALID','核实主运行缺少只读启动事实');
      const bindings=summary.events.filter(event=>event.type==='session.bound');
      check(bindings.length>0&&typeof summary.sessionFile==='string'&&!!summary.sessionFile&&bindings.every(event=>event.data.sessionId===recovery.context.nativeSessionId&&event.data.sessionFile===summary.sessionFile)&&(!nativeFile||nativeFile===summary.sessionFile),'REPLAN_PROOF_INVALID','核实主运行的原生会话绑定缺失、变化或属于其它上下文');
      nativeFile=summary.sessionFile;
      if(runId===recovery.context.initialRunId){
        const fresh=header.freshMain as {nativeSessionId?:unknown;excludedRunIds?:unknown}|undefined;
        check(!header.resumeFrom&&fresh?.nativeSessionId===recovery.context.nativeSessionId&&sameGoalValue(fresh.excludedRunIds,recovery.context.excludedRunIds),'REPLAN_PROOF_INVALID','核实主链没有对应持久化新上下文边界');break;
      }
      check(!header.freshMain&&typeof header.resumeFrom==='string'&&!!header.resumeFrom,'REPLAN_PROOF_INVALID','核实主链缺少可信上游运行或意外开启另一上下文');runId=header.resumeFrom;
    }
    check(mainIds.has(goal.plan.runId)&&(scope.continuations??[]).every(item=>mainIds.has(item.runId)&&item.wait.mainRunIds.every(id=>mainIds.has(id))),'REPLAN_PROOF_INVALID','核实主链遗漏计划或补充运行');
    check(lastEffect(main!)===review.lastEffectSeq&&review.observedSeq<=(main!.events.at(-1)?.seq??0),'REPLAN_PROOF_INVALID','主审阅的副作用或日志版本不一致');
    const tasks=graph.tasks.filter(task=>task.scopeId===scope.scopeId),taskIds=new Set(tasks.map(task=>task.taskId)),runs=(state.runs??[]).filter(run=>taskIds.has(run.binding.taskId));
    check(!tasks.some(task=>task.activeRunId)&&!state.members.some(member=>member.executionScopeId===scope.scopeId&&(member.lifecycle!=='released'||member.activeRunId||member.activeTaskId||member.waitingTaskIds.length||member.communicatingMessageIds.length)),'REPLAN_BUSY','核实周期仍有活动成员');
    for(const run of runs){
      const task=tasks.find(task=>task.taskId===run.binding.taskId)!;
      check(['completed','failed','cancelled'].includes(run.status)&&run.permission==='read'&&run.binding.workspaceId===scope.workspaceId&&run.binding.rootSessionId===scope.rootSessionId&&run.binding.agentInstanceId===task.assignee.agentInstanceId,'REPLAN_PROOF_INVALID','核实成员运行状态、权限或绑定无效');
      const summary=await logs.inspectMember(run);
      check(summary.runId===run.binding.runId&&summary.task.taskId===task.taskId&&summary.task.workspaceId===scope.workspaceId&&summary.task.agentId===task.assignee.agentId&&summary.status===run.status&&sameGoalValue(summary.memberBinding,run.binding),'REPLAN_PROOF_INVALID','核实成员日志身份不一致');audit(summary);recorded.push({summary,run});
    }
    check(tasks.every(task=>task.runIds.every(id=>runs.some(run=>run.binding.runId===id))),'REPLAN_PROOF_INVALID','核实任务存在未登记的运行记录');
    await this.evidence(state,scope,graph,{...review,expectedRevision:goal.revision},main!,knowledge.revision);
    const replaced=new Set(review.superseded.map(item=>item.taskId)),coveredModuleIds=[...new Set(tasks.filter(task=>task.status==='result_ready'&&!replaced.has(task.taskId)).flatMap(task=>task.modules.map(module=>module.moduleId)))].sort();
    // 读取不持有日志文件锁；再读同一批 canonical 摘要，发现中途变更则拒绝，不把多时点拼成一份证明。
    for(const item of recorded){const again=item.run?await logs.inspectMember(item.run):await logs.inspectMain(scope.rootSessionId,item.summary.runId);check(sameGoalValue(again,item.summary),'REPLAN_STALE','核实日志读取期间发生变化')}
    check((await this.owner.read()).revision===knowledge.revision,'REPLAN_KNOWLEDGE_CHANGED','核实证据读取期间知识版本变化');
    return {knowledgeRevision:knowledge.revision,coveredModuleIds,evidenceDigest:hash(json({goal,tasks,runs,logs:recorded.map(item=>item.summary)}))};
  }
  /**
   * 在 parkScope 的事务内核实无活动执行的等待边界，不重入存储、不启动模型。
   * 等待只接受当前 awaiting_user 审阅；已失败但明确结束的成员可保留，未知工具、在途租约和未开始任务均拒绝。
   */
  async validateWaiting(state:DispatchState,scope:DispatchScope,summary:RunSummary,mainRunIds:string[]):Promise<void>{
    await this.validateActiveInputs(scope,summary);
    const logs=this.logs(),graph=this.graph(state,scope),goal=scope.goal,review=goal?.review;
    check(scope.status==='active'&&goal&&!goal.blocked&&goal.plan&&review?.decision==='awaiting_user'&&review.revision===goal.revision&&review.planRevision===goal.plan.revision,'GOAL_WAIT_REQUIRED','只有当前版本的等待用户审阅可以建立安全检查点');
    check(!goalNeedsReplan(goal)&&goalInputRevision(review)===goalInputRevision(goal),'GOAL_REPLAN_REQUIRED','等待审阅没有覆盖最新用户补充');
    const proof=dispatchScopeWaitSchema.safeParse({waitId:'validation',reason:review.reason,createdAt:new Date().toISOString(),runId:summary.runId,goalRevision:goal.revision,graphCursor:review.graphCursor,knowledgeRevision:review.knowledgeRevision,mainRunIds});
    check(proof.success,'GOAL_WAIT_RUNS','等待检查点必须包含当前主运行，以及不重复且最多 32 个真实主运行 ID');
    this.main(state,summary,scope,graph,review.runId);
    check(summary.status==='completed'&&!summary.logIntegrity?.partialTail&&!summary.unresolvedTools.length&&!summary.toolReceipts?.some(receipt=>receipt.outcome==='unknown'),'GOAL_MAIN_UNSETTLED','主运行尚未安全结束，不能建立等待检查点');
    const main=await logs.inspectMain(scope.rootSessionId,review.runId);this.main(state,main,scope,graph,review.runId);
    check(main.status==='completed'&&!main.logIntegrity?.partialTail&&!main.unresolvedTools.length&&!main.toolReceipts?.some(receipt=>receipt.outcome==='unknown'),'GOAL_MAIN_UNSETTLED','主运行的持久化记录仍有未决操作');
    check(sameGoalValue(review.graphCursor,cursor(graph)),'GOAL_GRAPH_CHANGED','等待申请后任务图已变化，请重新审阅');
    check(lastEffect(main)===review.lastEffectSeq&&!main.events.some(event=>event.seq>review.observedSeq&&event.type==='tool.allowed'&&Array.isArray(event.data.effects)&&event.data.effects.some(effect=>effects.has(String(effect)))),'GOAL_EFFECT_CHANGED','等待申请后又发生可能改变产物的操作');
    const tasks=graph.tasks.filter(task=>task.scopeId===scope.scopeId),ids=new Set(tasks.map(task=>task.taskId));
    check(!tasks.some(task=>task.activeRunId||['planned','queued','running','waiting','checkpointed'].includes(task.status))&&!state.runs?.some(run=>run.binding.rootSessionId===scope.rootSessionId&&['starting','running'].includes(run.status)),'GOAL_WORK_PENDING','本周期仍有待执行任务、检查点或活动运行，不能进入等待');
    check(!state.members.some(member=>member.executionScopeId===scope.scopeId&&(member.activeRunId||member.activeTaskId||member.activity!=='idle'||member.waitingTaskIds.length||member.communicatingMessageIds.length)),'GOAL_WORK_PENDING','执行成员仍有活动占用或待通信操作');
    for(const run of state.runs??[])if(ids.has(run.binding.taskId)){
      const task=tasks.find(item=>item.taskId===run.binding.taskId)!;
      check(['completed','failed','cancelled'].includes(run.status),'GOAL_WAIT_UNCERTAIN','成员执行尚未得到明确终态，不能安全等待');
      const member=await logs.inspectMember(run);
      check(member.runId===run.binding.runId&&member.task.workspaceId===scope.workspaceId&&member.task.taskId===task.taskId&&member.task.agentId===task.assignee.agentId&&sameGoalValue(member.memberBinding,run.binding)&&member.status===run.status&&!member.logIntegrity?.partialTail&&!member.unresolvedTools.length&&!member.toolReceipts?.some(receipt=>receipt.outcome==='unknown'),'GOAL_WAIT_UNCERTAIN','成员日志存在未知工具结果或运行身份不一致');
    }
    const snapshot=await this.owner.read();check(snapshot.revision===review.knowledgeRevision,'GOAL_KNOWLEDGE_CHANGED','等待申请后知识版本已变化');
    await this.evidence(state,scope,graph,{...review,expectedRevision:goal.revision},main,snapshot.revision);
    check((await this.owner.read()).revision===snapshot.revision,'GOAL_KNOWLEDGE_CHANGED','等待核验期间知识版本已变化');
  }
  /** 只有可信协调器调用；失败原因持久化但不伪造目标输入、运行结果或图事件。 */
  async block(identity:GraphIdentity,scopeId:string,reason:string):Promise<DispatchScope>{
    const text=this.parse(z.string().trim().min(1).max(16000),reason),command={commandId:'goal-block-'+hash(json({...identity,scopeId})),fingerprint:hash(json({...identity,scopeId,reason:text}))};
    return this.store.transact(command,async state=>{
      const scope=this.scope(state,identity,scopeId);check(scope.status==='active','GOAL_CLOSED','目标周期已经结束');
      if(!scope.goal||scope.goal.blocked)return {receipt:scope};
      const next={...scope,goal:{...scope.goal,blocked:{reason:text,at:new Date().toISOString()}}};return {scopes:[next],receipt:next};
    });
  }
}
