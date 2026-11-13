/**
 * 目录归属：logic/evidence/runtime；目标状态与核证恢复服务。
 * 完整接受去重原运行清单，在同一15秒与16根/512条目/32MiB预算内重核；变化拒绝继续/完成而保留历史意见。
 * 作用定位：复核已消费人工接受的精确候选和选定文件，供显式接续、目标审阅及最终完成共用。
 * 设计原因：人的历史意见不等于当前产物未变；独立端口避免目标服务与人工服务相互引用，全部接受项的选定基线及冻结产物验证文件共享一次有界读取。
 * 职责边界：只读可信 canonical 与业务字节，不消费等待、不复制签署身份，也不恢复未知操作。
 */
import {fail} from '../../../core/errors';
import {hash,json} from '../../../core/platform/node/serialization';
import type {KnowledgeWorkspace} from '../../knowledge/rules/ports';
import type {RunSummary} from '../../execution/rules/types';
import type {DispatchState} from '../../dispatch/rules/dispatch-storage';
import type {DispatchScope} from '../../tasks/rules/dispatch-scope';
import type {DispatchRun} from '../../tasks/rules/dispatch-execution';
import type {GraphSnapshot,TaskNode} from '../../tasks/rules/graph-types';
import type {HumanDecisionRecord} from '../../tasks/rules/human-decisions';
import {type ScopeHumanContinuation,humanContinuationSubject} from '../../tasks/rules/human-continue';
import {currentHumanContinuation,referencedHumanDecision} from '../../tasks/rules/human-continuation-rules';
import {sameGoalValue} from '../../tasks/rules/scope-goal';
import {artifactLimits,artifactFileCheckSchema,type ArtifactFileFact,type ArtifactFileCheck} from '../rules/artifact-baseline';
import {verifyArtifactBaselines} from '../rules/artifact-evidence';
import {memberWorkflowEvidence} from '../../team/runtime/member-workflow';
import type {OutputManifestSnapshot,OutputManifestCheck,OutputManifestRecord} from '../rules/output-manifest';
import {completeOutputProof,assertCompleteOutputCurrent,assertCompleteOutputBudget} from '../rules/complete-output-evidence';

/** 固定工作区文件端口；只读占用不领取模型名额，关闭/退役检查覆盖异步读取。 */
export interface HumanDecisionPorts {
  normalizePath(raw:string):string;
  checkFiles(files:readonly ArtifactFileFact[],signal:AbortSignal):Promise<ArtifactFileCheck[]>;
  checkManifest?(expected:OutputManifestSnapshot,signal:AbortSignal):Promise<OutputManifestCheck>;
  acquireRead():()=>void;
  /** 可信主运行内核证：复用指定主会话的占用；桌面预览及预检必须仍走独立 acquireRead。 */
  acquireMainRead?(rootSessionId:string):()=>void;
  assertCurrent?():void;
}
/** 只接已登记的运行身份；平台自行解析 canonical 路径，模型或客户端不能指定日志文件。 */
export interface HumanEvidenceLogs {inspectMember(run:DispatchRun):Promise<RunSummary>;inspectMain(rootSessionId:string,runId:string):Promise<RunSummary>}
/** 注入目标服务的完整历史候选校验；当前文件在本模块合并复核，不用简化摘要绕过真实回执。 */
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
 * validateCandidate 只验证历史完整任务/原生绑定/交付证据；本模块复核全部当前 必验文件，不能只选未变的基线绕过。
 * withinMainRun 只能由已核实主运行身份的内部调用方提供，不从客户端请求或模型参数读取。
 */
export async function validateHumanAcceptances(owner:Pick<KnowledgeWorkspace,'entry'|'assert'|'read'>,state:DispatchState,scope:DispatchScope,records:readonly HumanDecisionRecord[],logs:HumanEvidenceLogs|undefined,ports:HumanDecisionPorts|undefined,validateCandidate:HumanCandidateValidator,withinMainRun=false):Promise<void>{
  if(!records.length)return;check(logs&&ports,'HUMAN_CONTINUATION_UNAVAILABLE','尚未接入人工接受所需的可信日志及文件核实');
  const current=()=>{owner.assert();ports.assertCurrent?.()},graph=state.graphs.find(item=>item.identity.workspaceId===scope.workspaceId&&item.identity.rootSessionId===scope.rootSessionId);check(graph,'HUMAN_CONTINUATION_IDENTITY','人工接受缺少对应主会话图');current();
  const release=withinMainRun&&ports.acquireMainRead?ports.acquireMainRead(scope.rootSessionId):ports.acquireRead();
  try{
    const knowledge=await owner.read();current();const observed=new Map<string,{run:DispatchRun;summary:RunSummary;manifest?:OutputManifestRecord}>(),mains=new Map<string,RunSummary>(),files=new Map<string,ArtifactFileFact>();
    for(const record of records){
      check(record.decision==='accept'&&record.proof.identity.workspaceId===scope.workspaceId&&record.proof.identity.rootSessionId===scope.rootSessionId&&record.proof.identity.scopeId===scope.scopeId&&record.proof.source.knowledgeRevision===knowledge.revision,'HUMAN_CONTINUATION_STALE','接受的身份或知识基线已变化，请重新核实');
      if(!mains.has(record.proof.source.reviewRunId)){const main=await logs.inspectMain(scope.rootSessionId,record.proof.source.reviewRunId);current();mains.set(record.proof.source.reviewRunId,main)}
      const main=mains.get(record.proof.source.reviewRunId)!;check(main.logIntegrity?.partialTail===false&&main.status==='completed'&&!main.unresolvedTools.length&&hash(json(main.events))===record.proof.source.reviewLogHash,'HUMAN_CONTINUATION_STALE','原人工审阅日志已变化或无法完整核实');
      for(const candidate of record.proof.candidates){
        const task=graph.tasks.find(item=>item.taskId===candidate.taskId),selected=candidate.selected;
        check(task&&task.scopeId===scope.scopeId&&task.revision===candidate.taskRevision&&task.planRevision===candidate.planRevision&&task.result?.resultId===candidate.resultId&&task.result.runId===candidate.runId,'HUMAN_CONTINUATION_STALE','接受的成员候选已经变化');
        let log=observed.get(candidate.runId);
        if(!log){
          const summary=await validateCandidate(state,scope,graph,task,knowledge.revision);current();const run=state.runs?.find(item=>item.binding.taskId===task.taskId&&item.binding.runId===candidate.runId);check(run,'HUMAN_CONTINUATION_STALE','接受的运行登记已经变化');
          const evidence=memberWorkflowEvidence(task,run,summary,owner.entry.path,ports.normalizePath);log={run,summary,manifest:evidence.manifest};observed.set(candidate.runId,log);
          if(!evidence.manifest)for(const file of evidence.files){const existing=files.get(file.relativePath);check(!existing||sameGoalValue(existing,file),'HUMAN_CONTINUATION_STALE','人工接受之间的程序验证文件指纹不一致');files.set(file.relativePath,file)}
        }
        check(hash(json(log.summary.events))===candidate.logHash&&candidate.evidenceToolCallIds.every(id=>task.result!.evidenceRefs.includes(id)),'HUMAN_CONTINUATION_STALE','接受的日志或证据引用已经变化');
        if(log.manifest){
          check(!selected&&candidate.selectedManifest?.state==='matches'&&sameGoalValue(candidate.selectedManifest.manifest,completeOutputProof(log.manifest))&&candidate.selectedManifest.observedHash===log.manifest.manifest.manifestHash,'HUMAN_CONTINUATION_STALE','人工接受与原交付完整清单身份不一致');continue;
        }
        check(!candidate.selectedManifest&&selected&&!selected.invalidated&&selected.files.length&&selected.files.every(file=>file.state==='matches'),'HUMAN_CONTINUATION_STALE','接受的选定文件基线已经变化');
        const artifacts=verifyArtifactBaselines(log.summary.events,log.run.binding,knowledge.revision,ports.normalizePath,selected.baselineId),baseline=artifacts.records.find(item=>item.baseline.baselineId===selected.baselineId),ref=artifacts.refs.find(item=>item.baselineId===selected.baselineId);
        check(baseline&&ref&&!ref.invalidated&&baseline.capturedSeq===selected.capturedSeq&&baseline.finishedSeq===selected.finishedSeq&&baseline.baseline.captureToolCallId===selected.captureToolCallId&&baseline.baseline.knowledgeRevision===selected.knowledgeRevision&&baseline.baseline.progressVersion===selected.progressVersion&&baseline.baseline.files.length===selected.files.length,'HUMAN_CONTINUATION_STALE','接受的采集事件、成功回执或基线版本不再有效');
        for(const captured of baseline.baseline.files){
          const expected={relativePath:captured.relativePath,byteLength:captured.byteLength,sha256:captured.sha256},old=selected.files.find(file=>file.relativePath===expected.relativePath),existing=files.get(expected.relativePath);
          check(old&&sameGoalValue(old.expected,{byteLength:expected.byteLength,sha256:expected.sha256})&&(!existing||sameGoalValue(existing,expected)),'HUMAN_CONTINUATION_STALE','人工接受之间的文件期望或真实采集字节不一致');files.set(expected.relativePath,expected);
        }
      }
    }
    const manifests=[...observed.values()].flatMap(log=>log.manifest?[log.manifest]:[]);
    check((files.size>0||manifests.length>0)&&files.size<=artifactLimits.files&&[...files.values()].reduce((total,file)=>total+file.byteLength,0)<=artifactLimits.totalBytes,'HUMAN_CONTINUATION_LIMIT','本次人工接受的选定文件复核超过 16 文件或 32 MiB 上限');
    assertCompleteOutputBudget(manifests,[...files.values()]);
    const expected=[...files.values()].sort((a,b)=>a.relativePath<b.relativePath?-1:1),signal=AbortSignal.timeout(15000),checked=expected.length?await ports.checkFiles(expected,signal):[];current();signal.throwIfAborted();
    check(checked.length===expected.length&&checked.every((file,index)=>artifactFileCheckSchema.safeParse(file).success&&file.relativePath===expected[index].relativePath&&file.state==='matches'&&sameGoalValue(file.expected,{byteLength:expected[index].byteLength,sha256:expected[index].sha256})&&sameGoalValue(file.observed,file.expected)),'HUMAN_CONTINUATION_STALE','接受依据的文件已经变化、缺失或无法核实');
    for(const manifest of manifests){check(ports.checkManifest,'HUMAN_CONTINUATION_UNAVAILABLE','完整接受缺少真实全集合复核端口');const checked=await ports.checkManifest(manifest.manifest.snapshot,signal);current();signal.throwIfAborted();try{assertCompleteOutputCurrent(manifest.manifest.snapshot,checked)}catch{fail('HUMAN_CONTINUATION_STALE','已接受的完整产物集合已变化或无法核实；原意见保留，请重新安排验证')}}
    for(const {run,summary} of observed.values()){const again=await logs.inspectMember(run);current();check(sameGoalValue(summary,again),'HUMAN_CONTINUATION_STALE','人工接受复核期间成员日志变化')}
    for(const [runId,summary] of mains){const again=await logs.inspectMain(scope.rootSessionId,runId);current();check(sameGoalValue(summary,again),'HUMAN_CONTINUATION_STALE','人工接受复核期间主审阅日志变化')}
    check((await owner.read()).revision===knowledge.revision,'HUMAN_CONTINUATION_STALE','人工接受复核期间知识变化');current();
  }finally{release()}
}
