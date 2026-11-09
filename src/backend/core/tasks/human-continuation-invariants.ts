/**
 * 作用定位：在提交和重放中保护人工意见的一次等待消费、主体冻结及完成/返工引用。
 * 设计原因：有 accept 历史不等于当前输入已获批准；普通补充不能伪造人工接续，返工必须创建受理后新任务。
 * 职责边界：这里只核实持久关系；canonical、知识与文件时效仍由调度服务在审阅和结束时分别核实。
 */
import {fail} from '../foundation/errors';
import type {DispatchState,DispatchMutation,DispatchCommand} from './dispatch-storage';
import {isHumanContinuation} from './scope-continuation-record';
import {humanContinuationSubject} from './human-continue';
import {waitingHumanDecisions,currentHumanContinuation,referencedHumanDecision,humanContinuationSubjectMatches} from './human-continuation-rules';
import {sameGoalValue,goalInputRevision} from './scope-goal';

function valid(value:unknown,message:string):asserts value{if(!value)fail('GRAPH_INPUT_INVALID',message)}
const sameSet=(a:string[],b:string[])=>a.length===b.length&&new Set(a).size===a.length&&a.every(id=>b.includes(id));
/** 与周期联合事务共用；历史只校验消费时冻结的决定序列，不用后来的决定改写旧意图。 */
export function validateHumanContinuations(previous:DispatchState,next:DispatchState,mutation:DispatchMutation):void{
  for(const scope of next.scopes??[]){
    const old=previous.scopes?.find(item=>item.scopeId===scope.scopeId),history=scope.continuations??[],prior=old?.continuations??[];
    for(const [index,intent] of history.entries())if(isHumanContinuation(intent)){
      valid(scope.humanDecisions&&intent.decisionRevision<=scope.humanDecisions.revision,'人工接续必须引用已保存的决定序列');
      const selected=waitingHumanDecisions(scope,intent.wait.waitId,intent.decisionRevision);
      valid(selected.length>0&&sameSet(selected.map(record=>record.decisionId),intent.decisionIds),'人工接续必须包含本等待每项跨依据的最新决定全集');
      for(const record of selected)valid(record.proof.identity.scopeId===scope.scopeId&&record.proof.identity.rootSessionId===scope.rootSessionId&&record.proof.identity.workspaceId===scope.workspaceId&&record.proof.source.goalRevision===intent.wait.goalRevision&&record.proof.source.inputRevision===intent.inputRevision-1&&record.proof.source.reviewRunId===intent.wait.runId&&record.proof.source.knowledgeRevision===intent.wait.knowledgeRevision&&sameGoalValue(record.proof.source.graphCursor,intent.wait.graphCursor)&&Date.parse(record.recordedAt)<=Date.parse(intent.acceptedAt),'人工接续不能消费其他等待、输入或尚未保存的决定');
      if(index>=prior.length){
        valid(index===history.length-1&&old?.status==='waiting'&&old.goal?.plan&&old.wait&&scope.status==='active'&&sameGoalValue(old.wait,intent.wait),'人工意图只能显式消费原安全等待');
        valid(intent.decisionRevision===old.humanDecisions?.revision&&sameGoalValue(old.humanDecisions,scope.humanDecisions),'消费人工意见不能顺带签署、替换或遗漏最新决定');
        valid(sameGoalValue(intent.subject,humanContinuationSubject(old.goal.plan)),'人工接续须冻结原等待的完整业务主体');
        const graph=previous.graphs.find(item=>item.identity.workspaceId===scope.workspaceId&&item.identity.rootSessionId===scope.rootSessionId);
        valid(graph&&sameGoalValue(intent.priorTaskIds,graph.tasks.filter(task=>task.scopeId===scope.scopeId).map(task=>task.taskId)),'人工接续必须固定受理前已有任务全集，不能伪造返工新节点');
        valid(mutation.scopes?.length===1&&!mutation.batch&&!mutation.members?.length&&!mutation.sessions?.length&&!mutation.runs?.length&&!mutation.messages?.length,'人工接续仅消费等待并登记主运行，不能夹带执行或图变化');
      }
    }
    // 只校验本次新审阅；后续 waiting 可保存新意见，不能因此把原审阅历史当成新完成许可。
    const review=scope.goal?.review;
    if(!review||sameGoalValue(review,old?.goal?.review))continue;
    const intent=currentHumanContinuation(scope),graph=next.graphs.find(item=>item.identity.rootSessionId===scope.rootSessionId);
    for(const check of review.checks)for(const ref of check.evidence)if(ref.kind==='human-decision'){
      const record=referencedHumanDecision(scope,ref),criterion=scope.goal!.plan?.criteria.find(item=>item.id===check.criterionId);
      valid(intent&&record?.decision==='accept'&&record.criterionId===check.criterionId&&criterion?.kind==='human'&&check.outcome==='satisfied'&&humanContinuationSubjectMatches(scope)&&goalInputRevision(review)===intent.inputRevision,'人工满足申请必须引用当前输入实际消费且主体未变的接受');
      valid(record.proof.source.knowledgeRevision===review.knowledgeRevision,'人工接受不能跨知识版本使用');
      for(const candidate of record.proof.candidates){const task=graph?.tasks.find(item=>item.taskId===candidate.taskId),result=task?.result;valid(task?.scopeId===scope.scopeId&&task.status==='result_ready'&&!task.activeRunId&&task.revision===candidate.taskRevision&&task.planRevision===candidate.planRevision&&result?.runId===candidate.runId&&result.resultId===candidate.resultId&&candidate.evidenceToolCallIds.every(id=>result.evidenceRefs.includes(id)),'人工接受不能借用已变化的候选或其他任务')}
      // 人工引用可以独立使用；额外列出的成员证据也必须在用户实际查看的同一候选集合内。
      for(const attached of check.evidence)if(attached.kind==='member-result')valid(record.proof.candidates.some(candidate=>candidate.taskId===attached.taskId&&candidate.runId===attached.runId&&candidate.resultId===attached.resultId&&candidate.planRevision===attached.planRevision&&attached.toolCallIds.every(id=>candidate.evidenceToolCallIds.includes(id))),'人工接受不能为未包含在决定依据中的附加候选或证据背书');
    }
    for(const replacement of review.superseded){
      const sourceTask=graph?.tasks.find(item=>item.taskId===replacement.taskId),sourceRun=next.runs?.find(item=>item.binding.runId===sourceTask?.result?.runId);
      if(sourceTask?.status==='result_ready'&&sourceRun?.prepared.knowledgeRevision===review.knowledgeRevision)valid(replacement.humanDecision,'当前知识下的成功候选只能凭显式消费的拒绝/补证安排替代');
      if(!replacement.humanDecision)continue;
      const record=referencedHumanDecision(scope,replacement.humanDecision),source=graph?.tasks.find(item=>item.taskId===replacement.taskId),candidate=record?.proof.candidates.find(item=>item.taskId===source?.taskId);
      valid(intent&&record&&record.decision!=='accept'&&source?.scopeId===scope.scopeId&&source.status==='result_ready'&&candidate&&source.revision===candidate.taskRevision&&source.result?.runId===candidate.runId&&source.result.resultId===candidate.resultId&&source.planRevision===candidate.planRevision&&candidate.evidenceToolCallIds.every(id=>source.result!.evidenceRefs.includes(id)),'人工返工替代必须引用本输入已消费的拒绝/补证及其精确原候选');
      const modules=new Set<string>();
      for(const id of replacement.replacementTaskIds){const task=graph!.tasks.find(item=>item.taskId===id);valid(task&&task.scopeId===scope.scopeId&&!intent.priorTaskIds.includes(id)&&task.status==='result_ready'&&task.result&&!task.activeRunId,'人工返工只能引用受理后新任务的真实结果');task.modules.forEach(module=>modules.add(module.moduleId))}
      valid(source.modules.every(module=>modules.has(module.moduleId)),'人工返工新结果必须覆盖被拒候选的完整模块');
    }
  }
}
/** 独立命令前缀保证普通文本入口不能夹带人工来源；幂等仍由同一存储命令完成。 */
export function validateHumanContinuationCommand(previous:DispatchState,mutation:DispatchMutation,command:DispatchCommand):void{
  for(const scope of mutation.scopes??[]){const prior=previous.scopes?.find(item=>item.scopeId===scope.scopeId)?.continuations?.length??0;for(const item of scope.continuations?.slice(prior)??[])if(isHumanContinuation(item))valid(command.commandId==='scope-human-continue-'+item.continuationId,'人工接续必须通过本次独立显式命令受理')}
}
