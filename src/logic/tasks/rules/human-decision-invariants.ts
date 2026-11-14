/**
 * 新决定必须保持原运行完整/选定文件模式及冻结范围；跨等待关联只能引用同项最近意见，旧记录不可换绑，真实日志由服务重读。
 * 作用定位：保护人工决定在周期联合事务及重放中的追加历史、当前依据和无执行副作用边界。
 * 设计原因：不能只依赖桌面按钮；普通事务不得补造批准、跨流程借候选、修改目标或借提交决定启动模型。
 * 职责边界：校验持久关系及证明内容指纹，真实日志与文件须由可信服务复核；actor 只表示本机提交来源。
 */
import {fail} from '../../../core/errors';
import type {DispatchState,DispatchMutation,DispatchCommand} from '../../dispatch/rules/dispatch-storage';
import {scopeHumanDecisionsSchema,type HumanDecisionRecord} from './human-decisions';
import {humanDecisionBasis} from './human-decision-proof';
import {goalInputRevision,sameGoalValue,goalNeedsReplan} from './scope-goal';
import {sameWorkflowSelectionsForModules} from './workflow-selection';
import {completeOutputRequired} from '../../evidence/rules/complete-output-evidence';
import {preparedWorkflowContracts} from './execution-context';
import {preparedArtifactScopes} from '../../workspace/rules/artifact-scope';
import {outputManifestScopeHash} from '../../evidence/rules/output-manifest-evidence';

function valid(value:unknown,message:string):asserts value{if(!value)fail('GRAPH_INPUT_INVALID',message)}
const equal=sameGoalValue;
/** 提交/重放使用同一规则；仅有界历史追加可作为 waiting 的精确变化例外。 */
export function validateHumanDecisions(previous:DispatchState,next:DispatchState,mutation:DispatchMutation):void{
  const ids=new Set<string>();
  for(const scope of next.scopes??[]){
    const old=previous.scopes?.find(item=>item.scopeId===scope.scopeId),history=scope.humanDecisions,prior=old?.humanDecisions;
    if(history){
      valid(scopeHumanDecisionsSchema.safeParse(history).success,'人工决定历史结构、顺序、同依据替代或跨等待关联无效');
      for(const record of history.records){
        valid(!ids.has(record.decisionId),'人工决定命令不能跨周期重用');ids.add(record.decisionId);
        valid(equal(record.proof.identity,{workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId}),'人工决定证明必须属于保存它的工作区、主会话与周期');
        valid(record.basis===humanDecisionBasis(record.proof),'人工决定依据指纹与固定内容不一致');
      }
    }
    if(equal(history,prior))continue;
    valid(old&&history&&history.revision===(prior?.revision??0)+1&&history.records.length===(prior?.records.length??0)+1&&(prior?.records??[]).every((record,index)=>equal(record,history.records[index])),'人工决定只能一次追加一条且旧记录不能移除或改写');
    valid(old.status==='waiting'&&scope.status==='waiting'&&equal({...old,humanDecisions:history},scope),'人工决定只能在原安全等待上追加，不能同时修改目标、等待、权限或周期');
    valid(mutation.scopes?.length===1&&mutation.scopes[0].scopeId===scope.scopeId&&!mutation.batch&&!mutation.runs?.length&&!mutation.members?.length&&!mutation.sessions?.length&&!mutation.messages?.length,'人工决定只能修改本周期历史，不能夹带图、实例、信封或运行变化');
    const record=history.records.at(-1)!,source=record.proof.source,goal=scope.goal,wait=scope.wait,review=goal?.review,plan=goal?.plan;
    valid(goal&&plan&&review?.decision==='awaiting_user'&&wait&&!goal.blocked&&!goalNeedsReplan(goal),'人工决定必须基于可信的当前等待计划与审阅');
    valid(source.waitId===wait.waitId&&source.goalRevision===goal.revision&&source.inputRevision===goalInputRevision(goal)&&source.planRevision===plan.revision&&source.reviewRevision===review.revision&&source.reviewRunId===review.runId&&source.reviewRunId===wait.runId&&source.knowledgeRevision===wait.knowledgeRevision&&source.knowledgeRevision===review.knowledgeRevision&&equal(source.graphCursor,wait.graphCursor),'人工决定不能引用其他等待、目标或知识版本');
    valid(equal(source.criterion,plan.criteria.find(item=>item.id===record.criterionId))&&source.criterion.kind==='human','人工决定必须引用当前计划的原始人工验收项');
    valid(Date.parse(record.recordedAt)>=Date.parse(wait.createdAt),'人工决定不能早于当前等待');
    const graph=next.graphs.find(item=>item.identity.workspaceId===scope.workspaceId&&item.identity.rootSessionId===scope.rootSessionId);
    valid(graph&&equal(source.graphCursor,{streamId:graph.cursor.streamId,seq:graph.cursor.seq}),'人工决定不能引用过期任务图');
    const check=review.checks.find(item=>item.criterionId===record.criterionId);
    valid(check&&check.evidence.length&&check.evidence.every(item=>item.kind==='member-result'),'本片人工决定只支持当前审阅中的完整成员候选');
    const expected=new Map<string,{runId:string;resultId:string;planRevision:number;toolCallIds:Set<string>}>();
    for(const ref of check.evidence){
      valid(ref.kind==='member-result','人工决定不能借用主知识提交或其他类型证据');
      const known=expected.get(ref.taskId);valid(!known||known.runId===ref.runId&&known.resultId===ref.resultId&&known.planRevision===ref.planRevision,'同一验收项候选引用互相矛盾');
      const value=known??{runId:ref.runId,resultId:ref.resultId,planRevision:ref.planRevision,toolCallIds:new Set<string>()};ref.toolCallIds.forEach(id=>value.toolCallIds.add(id));expected.set(ref.taskId,value);
    }
    valid(record.proof.candidates.length===expected.size,'人工决定不能漏掉或增加当前审阅的成员候选');
    for(const candidate of record.proof.candidates){
      const reference=expected.get(candidate.taskId),task=graph.tasks.find(item=>item.taskId===candidate.taskId),result=task?.result,run=next.runs?.find(item=>item.binding.runId===candidate.runId);
      valid(reference&&candidate.runId===reference.runId&&candidate.resultId===reference.resultId&&candidate.planRevision===reference.planRevision&&candidate.evidenceToolCallIds.length===reference.toolCallIds.size&&candidate.evidenceToolCallIds.every(id=>reference.toolCallIds.has(id)),'人工决定候选或工具引用不属于当前验收项');
      valid(task&&task.scopeId===scope.scopeId&&task.status==='result_ready'&&!task.activeRunId&&task.revision===candidate.taskRevision&&task.planRevision===candidate.planRevision&&result?.resultId===candidate.resultId&&result.runId===candidate.runId&&result.planRevision===candidate.planRevision&&candidate.evidenceToolCallIds.every(id=>result.evidenceRefs.includes(id)),'人工决定必须绑定本周期当前真实候选');
      valid(run?.status==='completed'&&run.binding.workspaceId===scope.workspaceId&&run.binding.rootSessionId===scope.rootSessionId&&run.binding.taskId===task.taskId&&run.binding.agentId===task.assignee.agentId&&run.binding.agentInstanceId===task.assignee.agentInstanceId&&run.binding.agentSessionId===task.assignee.agentSessionId&&run.binding.planRevision===task.planRevision&&task.runIds.includes(run.binding.runId)&&run.prepared.knowledgeRevision===source.knowledgeRevision,'人工决定候选运行或知识绑定无效');
      const bindings=preparedWorkflowContracts(run.prepared),complete=completeOutputRequired(bindings);
      valid(complete?!candidate.selected:!candidate.selectedManifest,'人工决定不能更换原运行的完整或选定文件模式');
      if(candidate.selectedManifest){const proof=candidate.selectedManifest.manifest;valid(equal(proof.scopes,preparedArtifactScopes(bindings))&&proof.scopeHash===outputManifestScopeHash(proof.scopes)&&proof.knowledgeRevision===source.knowledgeRevision,'人工决定完整范围必须属于原运行的冻结约定')}
      valid(plan.assignments.some(item=>item.agentId===task.assignee.agentId&&item.moduleIds.length===task.modules.length&&task.modules.every(module=>item.moduleIds.includes(module.moduleId)&&module.knowledgeRevision===source.knowledgeRevision)&&sameWorkflowSelectionsForModules(item.workflowSelections,task.workflowSelections,task.modules.map(module=>module.moduleId))&&item.criterionIds.includes(record.criterionId)),'人工决定不能跨责任、模块或 Workflow 选择引用候选');
    }
  }
  const otherIds=(next.scopes??[]).flatMap(scope=>[...(scope.continuations??[]).map(item=>item.continuationId),...(scope.recovery?[scope.recovery.recoveryId]:[]),...(scope.replan?[scope.replan.replanId]:[])]);
  valid(!otherIds.some(id=>ids.has(id)),'人工决定不能重用已存在的周期启动或补充命令');
}
/** 真实命令由可信服务命名；模型派发或其它事务不能夹带独立的人工决定记录。 */
export function validateHumanDecisionCommand(previous:DispatchState,mutation:DispatchMutation,command:DispatchCommand):void{
  const appended:HumanDecisionRecord[]=[];
  for(const scope of mutation.scopes??[]){const count=previous.scopes?.find(item=>item.scopeId===scope.scopeId)?.humanDecisions?.records.length??0;if((scope.humanDecisions?.records.length??0)>count)appended.push(...scope.humanDecisions!.records.slice(count))}
  if(appended.length)valid(appended.length===1&&command.commandId==='human-decision-'+appended[0].decisionId,'人工决定必须使用本次可信提交的唯一命令');
}
