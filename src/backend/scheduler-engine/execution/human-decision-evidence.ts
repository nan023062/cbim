/**
 * 作用定位：复核已消费人工接受的精确候选和选定文件，供显式接续、目标审阅及最终完成共用。
 * 设计原因：人的历史意见不等于当前产物未变；独立端口避免目标服务与人工服务相互引用，所有接受项共享有界文件预算。
 * 职责边界：只读可信 canonical 与业务字节，不消费等待、不复制签署身份，也不恢复未知操作。
 */
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {RunSummary} from '../../core/brain/types';
import type {DispatchState} from '../../core/tasks/dispatch-storage';
import type {DispatchScope} from '../../core/tasks/dispatch-scope';
import type {DispatchRun} from '../../core/tasks/dispatch-execution';
import type {GraphSnapshot,TaskNode} from '../../core/tasks/graph-types';
import type {HumanDecisionRecord} from '../../core/tasks/human-decisions';
import {type ScopeHumanContinuation,humanContinuationSubject} from '../../core/tasks/human-continue';
import {currentHumanContinuation,referencedHumanDecision} from '../../core/tasks/human-continuation-rules';
import {sameGoalValue} from '../../core/tasks/scope-goal';
import {artifactLimits,artifactFileCheckSchema,type ArtifactFileFact,type ArtifactFileCheck} from '../../core/tasks/artifact-baseline';
import {verifyArtifactBaselines} from '../../core/tasks/artifact-evidence';

/** 固定工作区文件端口；只读占用不领取模型名额，关闭/退役检查覆盖异步读取。 */
export interface HumanDecisionPorts {
  normalizePath(raw:string):string;
  checkFiles(files:readonly ArtifactFileFact[],signal:AbortSignal):Promise<ArtifactFileCheck[]>;
  acquireRead():()=>void;
  assertCurrent?():void;
}
/** 只接已登记的运行身份；平台自行解析 canonical 路径，模型或客户端不能指定日志文件。 */
export interface HumanEvidenceLogs {inspectMember(run:DispatchRun):Promise<RunSummary>;inspectMain(rootSessionId:string,runId:string):Promise<RunSummary>}
/** 注入目标服务的完整候选校验，不用简化摘要绕过原生绑定与真实回执。 */
export type HumanCandidateValidator=(state:DispatchState,scope:DispatchScope,graph:GraphSnapshot,task:TaskNode,knowledgeRevision:string)=>Promise<RunSummary>;
function check(value:unknown,code:string,message:string):asserts value{if(!value)fail(code,message)}

/** 仅当前输入版本已实际消费的人工意图生效；不能任选历史接受或穿越后续文本补充。 */
export function consumedHumanDecision(scope:DispatchScope,reference:{decisionId:string;continuationId:string},criterionId?:string):{continuation:ScopeHumanContinuation;record:HumanDecisionRecord}{
  const continuation=currentHumanContinuation(scope),record=referencedHumanDecision(scope,reference);
  check(continuation&&record&&(!criterionId||record.criterionId===criterionId),'GOAL_HUMAN_SOURCE','人工决定不是当前输入版本已消费的验收项最新意见');
  return {continuation,record};
}
/** 计划可更新解释和运行版本，但已接受的业务主体不能被模型改写后继续借用旧接受。 */
export function assertHumanSubject(scope:DispatchScope,continuation:ScopeHumanContinuation){
  check(scope.goal?.plan&&sameGoalValue(humanContinuationSubject(scope.goal.plan),continuation.subject),'GOAL_HUMAN_SUBJECT_CHANGED','目标、约束、验收或责任模块已变化，不能沿用此前人工接受');
}
/**
 * 所有接受项合并文件后一次核实；前后读取 canonical 和知识，外部文件变化不承诺跨存储原子隔离。
 * validateCandidate 由目标服务注入，保留其完整任务/原生绑定/交付证据门禁，不能传模型摘要替代。
 */
export async function validateHumanAcceptances(owner:Pick<KnowledgeWorkspace,'entry'|'assert'|'read'>,state:DispatchState,scope:DispatchScope,records:readonly HumanDecisionRecord[],logs:HumanEvidenceLogs|undefined,ports:HumanDecisionPorts|undefined,validateCandidate:HumanCandidateValidator):Promise<void>{
  if(!records.length)return;check(logs&&ports,'HUMAN_CONTINUATION_UNAVAILABLE','尚未接入人工接受所需的可信日志及文件核实');
  const current=()=>{owner.assert();ports.assertCurrent?.()},graph=state.graphs.find(item=>item.identity.workspaceId===scope.workspaceId&&item.identity.rootSessionId===scope.rootSessionId);check(graph,'HUMAN_CONTINUATION_IDENTITY','人工接受缺少对应主会话图');current();
  const release=ports.acquireRead();
  try{
    const knowledge=await owner.read();current();const observed=new Map<string,{run:DispatchRun;summary:RunSummary}>(),mains=new Map<string,RunSummary>(),files=new Map<string,ArtifactFileFact>();
    for(const record of records){
      check(record.decision==='accept'&&record.proof.identity.workspaceId===scope.workspaceId&&record.proof.identity.rootSessionId===scope.rootSessionId&&record.proof.identity.scopeId===scope.scopeId&&record.proof.source.knowledgeRevision===knowledge.revision,'HUMAN_CONTINUATION_STALE','接受的身份或知识基线已变化，请重新核实');
      if(!mains.has(record.proof.source.reviewRunId)){const main=await logs.inspectMain(scope.rootSessionId,record.proof.source.reviewRunId);current();mains.set(record.proof.source.reviewRunId,main)}
      const main=mains.get(record.proof.source.reviewRunId)!;check(main.logIntegrity?.partialTail===false&&main.status==='completed'&&!main.unresolvedTools.length&&hash(json(main.events))===record.proof.source.reviewLogHash,'HUMAN_CONTINUATION_STALE','原人工审阅日志已变化或无法完整核实');
      for(const candidate of record.proof.candidates){
        const task=graph.tasks.find(item=>item.taskId===candidate.taskId),selected=candidate.selected;
        check(task&&task.scopeId===scope.scopeId&&task.revision===candidate.taskRevision&&task.planRevision===candidate.planRevision&&task.result?.resultId===candidate.resultId&&task.result.runId===candidate.runId&&selected&&!selected.invalidated&&selected.files.length&&selected.files.every(file=>file.state==='matches'),'HUMAN_CONTINUATION_STALE','接受的成员候选或选定文件基线已经变化');
        let log=observed.get(candidate.runId);
        if(!log){const summary=await validateCandidate(state,scope,graph,task,knowledge.revision);current();const run=state.runs?.find(item=>item.binding.taskId===task.taskId&&item.binding.runId===candidate.runId);check(run,'HUMAN_CONTINUATION_STALE','接受的运行登记已经变化');log={run,summary};observed.set(candidate.runId,log)}
        check(hash(json(log.summary.events))===candidate.logHash&&candidate.evidenceToolCallIds.every(id=>task.result!.evidenceRefs.includes(id)),'HUMAN_CONTINUATION_STALE','接受的日志或证据引用已经变化');
        const artifacts=verifyArtifactBaselines(log.summary.events,log.run.binding,knowledge.revision,ports.normalizePath,selected.baselineId),baseline=artifacts.records.find(item=>item.baseline.baselineId===selected.baselineId),ref=artifacts.refs.find(item=>item.baselineId===selected.baselineId);
        check(baseline&&ref&&!ref.invalidated&&baseline.capturedSeq===selected.capturedSeq&&baseline.finishedSeq===selected.finishedSeq&&baseline.baseline.captureToolCallId===selected.captureToolCallId&&baseline.baseline.knowledgeRevision===selected.knowledgeRevision&&baseline.baseline.progressVersion===selected.progressVersion&&baseline.baseline.files.length===selected.files.length,'HUMAN_CONTINUATION_STALE','接受的采集事件、成功回执或基线版本不再有效');
        for(const captured of baseline.baseline.files){
          const expected={relativePath:captured.relativePath,byteLength:captured.byteLength,sha256:captured.sha256},old=selected.files.find(file=>file.relativePath===expected.relativePath),existing=files.get(expected.relativePath);
          check(old&&sameGoalValue(old.expected,{byteLength:expected.byteLength,sha256:expected.sha256})&&(!existing||sameGoalValue(existing,expected)),'HUMAN_CONTINUATION_STALE','人工接受之间的文件期望或真实采集字节不一致');files.set(expected.relativePath,expected);
        }
      }
    }
    check(files.size>0&&files.size<=artifactLimits.files&&[...files.values()].reduce((total,file)=>total+file.byteLength,0)<=artifactLimits.totalBytes,'HUMAN_CONTINUATION_LIMIT','本次人工接受复核超过 16 文件或 32 MiB 上限');
    const expected=[...files.values()].sort((a,b)=>a.relativePath<b.relativePath?-1:1),signal=AbortSignal.timeout(15000),checked=await ports.checkFiles(expected,signal);current();signal.throwIfAborted();
    check(checked.length===expected.length&&checked.every((file,index)=>artifactFileCheckSchema.safeParse(file).success&&file.relativePath===expected[index].relativePath&&file.state==='matches'&&sameGoalValue(file.expected,{byteLength:expected[index].byteLength,sha256:expected[index].sha256})&&sameGoalValue(file.observed,file.expected)),'HUMAN_CONTINUATION_STALE','接受依据的文件已经变化、缺失或无法核实');
    for(const {run,summary} of observed.values()){const again=await logs.inspectMember(run);current();check(sameGoalValue(summary,again),'HUMAN_CONTINUATION_STALE','人工接受复核期间成员日志变化')}
    for(const [runId,summary] of mains){const again=await logs.inspectMain(scope.rootSessionId,runId);current();check(sameGoalValue(summary,again),'HUMAN_CONTINUATION_STALE','人工接受复核期间主审阅日志变化')}
    check((await owner.read()).revision===knowledge.revision,'HUMAN_CONTINUATION_STALE','人工接受复核期间知识变化');current();
  }finally{release()}
}
