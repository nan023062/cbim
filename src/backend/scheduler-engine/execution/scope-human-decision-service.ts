/**
 * 作用定位：核实安全等待中的人工验收项和明确选定文件，保存本机显式决定及不可变依据。
 * 设计原因：历史候选真实性与当前接受许可分开；提交在事务外重建文件及日志依据，再按知识快照→任务短事务核版本，避免知识来源写入与验收形成逆向等待。
 * 职责边界：这里只保存决定，不修改 goal、wait、图或运行许可；共享文件端口供另一专用接续服务重新核实，保存本身不启动模型。哈希只描述有界观察。
 */
import {z} from 'zod';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import type {KnowledgeWorkspace,SourceSnapshotReader} from '../../core/knowledge/ports';
import type {DispatchState,DispatchStore} from '../../core/tasks/dispatch-storage';
import type {DispatchScope} from '../../core/tasks/dispatch-scope';
import {goalInputRevision,sameGoalValue} from '../../core/tasks/scope-goal';
import {artifactLimits,artifactFileCheckSchema,type ArtifactFileFact,type ArtifactFileCheck} from '../../core/tasks/artifact-baseline';
import {verifyArtifactBaselines} from '../../core/tasks/artifact-evidence';
import {humanDecisionPreviewInputSchema,humanDecisionRequestSchema,humanDecisionLookupSchema,humanDecisionHistoryInputSchema,humanDecisionActorSchema,humanDecisionPreviewSchema,humanDecisionRecordSchema,humanDecisionCoverageLimitation,humanDecisionLimit,type HumanDecisionPreviewInput,type HumanDecisionRequest,type HumanDecisionLookup,type HumanDecisionHistoryInput,type HumanDecisionPreview,type HumanDecisionReceipt,type HumanDecisionHistory,type HumanDecisionActor,type HumanDecisionCandidate,type HumanDecisionKind} from '../../core/tasks/human-decisions';
import {humanDecisionBasis,humanDecisionProof} from '../../core/tasks/human-decision-proof';
import {ScopeGoalService,type ScopeGoalPorts} from './scope-goal-service';
import type {HumanDecisionPorts} from './human-decision-evidence';
import {humanEvidenceStateStamp} from './human-evidence-state';
export type {HumanDecisionPorts} from './human-decision-evidence';

type Owner=Pick<KnowledgeWorkspace,'entry'|'assert'|'read'>&Partial<SourceSnapshotReader>;
function check(condition:unknown,code:string,message:string):asserts condition{if(!condition)fail(code,message)}
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;

export class ScopeHumanDecisionService {
  constructor(private readonly owner:Owner,private readonly store:DispatchStore,private readonly goals:ScopeGoalService,private readonly logs?:ScopeGoalPorts,private readonly ports?:HumanDecisionPorts,private readonly assertCurrent:()=>void=()=>{}){}
  private parse<S extends z.ZodTypeAny>(schema:S,raw:unknown):z.output<S>{const parsed=schema.safeParse(raw);if(!parsed.success)fail('HUMAN_INPUT_INVALID','人工决定参数无效；请重新选择验收项、文件基线与明确意见');return parsed.data}
  private current(){this.owner.assert();this.assertCurrent();this.ports?.assertCurrent?.()}
  private scope(state:DispatchState,input:HumanDecisionHistoryInput){
    this.current();check(input.workspaceId===this.owner.entry.id&&state.workspaceId===input.workspaceId,'HUMAN_IDENTITY','人工决定不属于当前工作区');
    const scope=state.scopes?.find(item=>item.scopeId===input.scopeId&&item.workspaceId===input.workspaceId&&item.rootSessionId===input.rootSessionId);
    check(scope&&state.graphs.some(graph=>graph.identity.workspaceId===input.workspaceId&&graph.identity.rootSessionId===input.rootSessionId&&graph.root.agent.agentId==='cbim:main'),'HUMAN_IDENTITY','人工决定缺少对应主会话或目标周期');return scope;
  }
  private receipt(scope:DispatchScope,commandId:string):HumanDecisionReceipt|undefined{
    const record=scope.humanDecisions?.records.find(item=>item.decisionId===commandId);
    return record?{workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,scopeStatus:scope.status,decisionRevision:scope.humanDecisions!.revision,record:structuredClone(record)}:undefined;
  }
  /** 原命令的只读回执不重新核实文件，也不隐式继续等待周期。 */
  async inspect(raw:HumanDecisionLookup):Promise<HumanDecisionReceipt|undefined>{const input=this.parse(humanDecisionLookupSchema,raw);return this.receipt(this.scope(await this.store.read(),input),input.commandId)}
  /** 有界历史通过同一持久存储读取，关闭后仍保留；不把过去的接受当作当前执行许可。 */
  async history(raw:HumanDecisionHistoryInput):Promise<HumanDecisionHistory>{const input=this.parse(humanDecisionHistoryInputSchema,raw),scope=this.scope(await this.store.read(),input);return {...input,scopeStatus:scope.status,decisionRevision:scope.humanDecisions?.revision??0,records:structuredClone(scope.humanDecisions?.records??[])}}
  private stateStamp(state:DispatchState,input:HumanDecisionHistoryInput){
    this.scope(state,input);return humanEvidenceStateStamp(state,input);
  }
  /** 单次收集使用原状态快照且不占任务事务；所有候选共享一份文件读取预算。 */
  private async collect(state:DispatchState,input:HumanDecisionPreviewInput):Promise<HumanDecisionPreview>{
    const scope=this.scope(state,input);check(this.logs&&this.ports,'HUMAN_UNAVAILABLE','尚未接入人工决定所需的可信日志与文件核实入口');
    const value=await this.goals.validateHumanCandidates(state,scope,input.criterionId);this.current();
    const goal=scope.goal!,review=goal.review!,ports=this.ports,candidates:HumanDecisionCandidate[]=[],limitations=[humanDecisionCoverageLimitation],issues:Array<{code:string;message:string}>=[];
    const addLimitation=(message:string)=>{if(!limitations.includes(message)&&limitations.length<32)limitations.push(message)};
    const addIssue=(code:string,message:string)=>{if(issues.length<32&&!issues.some(item=>item.code===code&&item.message===message))issues.push({code,message})};
    check(input.baselines.every(selection=>value.candidates.some(candidate=>candidate.task.taskId===selection.taskId&&candidate.run.binding.runId===selection.runId)),'HUMAN_SOURCE_INVALID','所选文件基线不属于此验收项的当前成员候选');
    const expectedFiles=new Map<string,ArtifactFileFact>();
    for(const candidate of value.candidates){
      const {task,run,summary,evidenceToolCallIds}=candidate,result=task.result!,selection=input.baselines.find(item=>item.taskId===task.taskId);
      const artifacts=verifyArtifactBaselines(summary.events,run.binding,value.knowledgeRevision,ports.normalizePath,selection?.baselineId);
      const record=selection?artifacts.records.find(item=>item.baseline.baselineId===selection.baselineId):undefined,ref=selection?artifacts.refs.find(item=>item.baselineId===selection.baselineId):undefined;
      check(!selection||record&&ref,'HUMAN_SOURCE_INVALID','所选文件基线缺少同轮完整采集事件和成功回执');
      if(artifacts.issues.length){addIssue('HUMAN_ARTIFACT_LIMITATION','部分文件基线记录不可核实；只有完整匹配的所选记录参与本次观察');addLimitation('部分采集记录不可核实，本次只引用有完整来源与成功回执的所选文件基线。')}
      if(artifacts.impact==='unknown')addLimitation('已登记操作的影响范围不能由所选文件完整枚举；本次决定不核实未列出的文件、命令外部影响或其它副作用。');
      const projected:HumanDecisionCandidate={taskId:task.taskId,taskRevision:task.revision,runId:result.runId,resultId:result.resultId,planRevision:task.planRevision,logHash:hash(json(summary.events)),evidenceToolCallIds:[...evidenceToolCallIds].sort(compare),agentName:task.assignee.name.slice(0,240),summary:result.summary.slice(0,240),baselines:artifacts.refs.map(item=>({baselineId:item.baselineId,capturedAt:item.capturedAt,fileCount:item.fileCount}))};
      if(record&&ref){
        const baseline=record.baseline;
        projected.selected={baselineId:baseline.baselineId,captureToolCallId:baseline.captureToolCallId,capturedSeq:record.capturedSeq,finishedSeq:record.finishedSeq,knowledgeRevision:baseline.knowledgeRevision,progressVersion:baseline.progressVersion,invalidated:ref.invalidated,files:baseline.files.map(file=>({relativePath:file.relativePath,state:'unverifiable',expected:{byteLength:file.byteLength,sha256:file.sha256}}))};
        for(const file of baseline.files){const previous=expectedFiles.get(file.relativePath);if(!previous||previous.byteLength<file.byteLength)expectedFiles.set(file.relativePath,{relativePath:file.relativePath,byteLength:file.byteLength,sha256:file.sha256})}
      }
      candidates.push(projected);
    }
    const inBudget=(files:Map<string,ArtifactFileFact>)=>files.size<=artifactLimits.files&&[...files.values()].reduce((total,file)=>total+file.byteLength,0)<=artifactLimits.totalBytes;
    check(inBudget(expectedFiles),'HUMAN_LIMIT','本次人工决定的文件超过 16 个或总计 32 MiB 上限');
    const workflowFiles=value.candidates.flatMap(candidate=>candidate.workflowFiles),selectedComplete=candidates.every(candidate=>candidate.selected&&!candidate.selected.invalidated&&candidate.selected.knowledgeRevision===value.knowledgeRevision&&candidate.selected.files.length);
    let workflowCurrent=workflowFiles.length===0,checkWorkflow=false;
    // 没有完整显式选择时仍仅列历史，不隐式读文件。可能接受时，所有程序验证文件也进入同一有界读取。
    if(selectedComplete&&workflowFiles.length){
      const combined=new Map(expectedFiles);
      for(const file of workflowFiles){const old=combined.get(file.relativePath);if(!old||old.byteLength<file.byteLength)combined.set(file.relativePath,file)}
      if(inBudget(combined)){for(const [key,file] of combined)expectedFiles.set(key,file);checkWorkflow=true}
      else addIssue('HUMAN_WORKFLOW_UNAVAILABLE','全部程序验证文件与所选基线超过本次核实上限；仍可拒绝或要求补证，不能接受');
    }
    if(expectedFiles.size){
      const expected=[...expectedFiles.values()].sort((a,b)=>compare(a.relativePath,b.relativePath)),signal=AbortSignal.timeout(15000),observations=await ports.checkFiles(expected,signal);this.current();signal.throwIfAborted();
      check(observations.length===expected.length,'HUMAN_EVIDENCE_INVALID','文件核实结果与请求范围不一致');
      for(let index=0;index<expected.length;index++){const parsed=artifactFileCheckSchema.safeParse(observations[index]),file=expected[index];check(parsed.success&&parsed.data.relativePath===file.relativePath&&sameGoalValue(parsed.data.expected,{byteLength:file.byteLength,sha256:file.sha256}),'HUMAN_EVIDENCE_INVALID','文件端口返回了错误路径或期望指纹')}
      if(checkWorkflow){
        workflowCurrent=workflowFiles.every(file=>{const observation=observations.find(item=>item.relativePath===file.relativePath);return observation&&['matches','changed'].includes(observation.state)&&sameGoalValue(observation.observed,{byteLength:file.byteLength,sha256:file.sha256})});
        if(!workflowCurrent)addIssue('HUMAN_WORKFLOW_UNAVAILABLE','程序验证的文件已变化、缺失或无法核实；原验证历史仍保留，当前不能接受');
      }
      for(const candidate of candidates)if(candidate.selected)candidate.selected.files=candidate.selected.files.map(file=>{
        const observation=observations.find(item=>item.relativePath===file.relativePath)!;
        if(!observation.observed)return {...observation,expected:file.expected};
        const state=observation.state==='matches'||observation.state==='changed'?(sameGoalValue(observation.observed,file.expected)?'matches':'changed'):observation.state;
        return {...observation,state,expected:file.expected};
      });
    }
    // 业务读占用不能锁住知识事务或外部进程；复读同一 canonical 集合与知识，拒绝拼接跨版本观察。
    for(const candidate of value.candidates){const again=await this.logs.inspectMember(candidate.run);this.current();check(sameGoalValue(again,candidate.summary),'HUMAN_STALE','成员日志在人工核实期间变化，请重新核实')}
    const main=await this.logs.inspectMain(scope.rootSessionId,review.runId);this.current();check(sameGoalValue(main,value.main),'HUMAN_STALE','主审阅日志在人工核实期间变化，请重新核实');
    check((await this.owner.read()).revision===value.knowledgeRevision,'HUMAN_KNOWLEDGE_CHANGED','知识在人工核实期间变化，请重新安排核实');this.current();
    const complete=workflowCurrent&&candidates.every(candidate=>candidate.selected&&!candidate.selected.invalidated&&candidate.selected.knowledgeRevision===value.knowledgeRevision&&candidate.selected.files.length&&candidate.selected.files.every(file=>file.state==='matches'));
    if(!complete)addIssue('HUMAN_ACCEPT_UNAVAILABLE','接受需要为全部候选明确选择当前有效基线，并且所选文件全部匹配');
    const allowedDecisions:HumanDecisionKind[]=complete?['accept','reject','request_evidence']:['reject','request_evidence'];
    const preview:HumanDecisionPreview={identity:{workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,criterionId:input.criterionId},checkedAt:new Date().toISOString(),decisionRevision:scope.humanDecisions?.revision??0,source:{waitId:scope.wait!.waitId,goalRevision:goal.revision,inputRevision:goalInputRevision(goal),planRevision:goal.plan!.revision,reviewRevision:review.revision,reviewRunId:review.runId,reviewLogHash:hash(json(value.main.events)),knowledgeRevision:value.knowledgeRevision,graphCursor:{streamId:value.graph.cursor.streamId,seq:value.graph.cursor.seq},criterion:value.criterion},candidates,allowedDecisions,limitations,issues};
    preview.basis=humanDecisionBasis(humanDecisionProof(preview));
    const latest=scope.humanDecisions?.records.filter(record=>record.criterionId===input.criterionId&&record.basis===preview.basis).at(-1);if(latest)preview.latestDecisionId=latest.decisionId;
    return humanDecisionPreviewSchema.parse(preview);
  }
  private async reading<T>(selected:boolean,work:()=>Promise<T>):Promise<T>{
    this.current();let release:(()=>void)|undefined;
    if(selected)try{release=this.ports?.acquireRead()}catch(error){const code=(error as {code?:string})?.code;if(code==='WORKSPACE_EXECUTION_BUSY'||code==='MEMBER_BUSY')fail('HUMAN_UNAVAILABLE','工作区当前有写入执行，未受理人工决定；请等待结束后重新核实');throw error}
    try{return await work()}finally{release?.()}
  }
  private unavailable(input:HumanDecisionPreviewInput,scope:DispatchScope,error:unknown):HumanDecisionPreview{
    const code=(error as {code?:string})?.code;
    return {identity:{workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,scopeId:input.scopeId,criterionId:input.criterionId},checkedAt:new Date().toISOString(),decisionRevision:scope.humanDecisions?.revision??0,candidates:[],allowedDecisions:[],limitations:[humanDecisionCoverageLimitation],issues:[{code:code&&/^(HUMAN_|GOAL_|ARTIFACT_)/.test(code)?code:'HUMAN_EVIDENCE_INVALID',message:'当前等待、成员记录、知识版本或所选文件无法核实；请检查依据后重新读取。'}]};
  }
  /** 无基线选择时只列可信候选及基线菜单；显式选择才读取文件，预览不会留下决定。 */
  async preview(raw:HumanDecisionPreviewInput):Promise<HumanDecisionPreview>{
    const input=this.parse(humanDecisionPreviewInputSchema,raw),before=await this.store.read(),scope=this.scope(before,input),stamp=this.stateStamp(before,input);
    try{return await this.reading(!!input.baselines.length,async()=>{const value=await this.collect(before,input),after=await this.store.read();check(stamp===this.stateStamp(after,input),'HUMAN_STALE','人工核实期间调度状态发生变化');const latest=this.scope(after,input);value.decisionRevision=latest.humanDecisions?.revision??0;value.latestDecisionId=latest.humanDecisions?.records.filter(record=>record.criterionId===input.criterionId&&record.basis===value.basis).at(-1)?.decisionId;return value})}
    catch(error){return this.unavailable(input,scope,error)}
  }
  /**
   * 只有可信桌面闭包传入 actor。重复命令返回旧回执；新命令先核证，提交在知识快照下核原状态与决定版本，先可靠落盘再返回。
   * 文件/知识并非同一存储，不能承诺外部原子快照；保存只追加记录，不消费 wait 或触发任何模型调用。
   */
  async decide(raw:HumanDecisionRequest,trustedActor:HumanDecisionActor):Promise<HumanDecisionReceipt>{
    const input=this.parse(humanDecisionRequestSchema,raw),actor=this.parse(humanDecisionActorSchema,trustedActor);
    const command={commandId:'human-decision-'+input.commandId,fingerprint:hash(json({operation:'human.decision',input,actor}))};
    const old=await this.store.commandReceipt(command.commandId);
    if(old){check(old.fingerprint===command.fingerprint,'COMMAND_ID_CONFLICT','相同命令 ID 已用于不同请求');return old.receipt as HumanDecisionReceipt}
    this.current();const before=await this.store.read(),stamp=this.stateStamp(before,input);
    check(this.owner.withSourceSnapshot,'HUMAN_UNAVAILABLE','人工决定缺少可信知识快照提交入口');
    try{return await this.reading(!!input.baselines.length,async()=>{
      let preview:HumanDecisionPreview;try{preview=await this.collect(before,{workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,scopeId:input.scopeId,criterionId:input.criterionId,baselines:input.baselines})}catch(error){const code=(error as {code?:string})?.code;if(code?.startsWith('HUMAN_'))throw error;fail('HUMAN_EVIDENCE_INVALID','当前日志、知识或文件依据无法核实，未保存人工决定')}
      return this.owner.withSourceSnapshot!(snapshot=>this.store.transact(command,async state=>{
      const scope=this.scope(state,input),revision=scope.humanDecisions?.revision??0;
      check(revision===input.expectedDecisionRevision,'HUMAN_REVISION_CONFLICT','人工决定记录已更新，请重新核实后提交');
      check(revision<humanDecisionLimit,'HUMAN_LIMIT','本周期人工决定已达到 64 条上限');
      check(stamp===this.stateStamp(state,input),'HUMAN_STALE','人工核实期间调度状态发生变化，请重新核实');
      check(snapshot.revision===preview.source?.knowledgeRevision,'HUMAN_KNOWLEDGE_CHANGED','知识在人工核实期间变化，请重新安排核实');
      check(preview.basis===input.expectedBasis,'HUMAN_STALE','人工决定依据已经变化，请重新核实后提交');
      check(preview.allowedDecisions.includes(input.decision),'HUMAN_DECISION_UNAVAILABLE','所选决定尚不满足当前候选与文件核实要求');this.current();
      const records=scope.humanDecisions?.records??[],supersedes=records.filter(record=>record.criterionId===input.criterionId&&record.basis===input.expectedBasis).at(-1);
      const record=humanDecisionRecordSchema.parse({decisionId:input.commandId,revision:revision+1,recordedAt:new Date().toISOString(),actor,criterionId:input.criterionId,decision:input.decision,comment:input.comment,basis:input.expectedBasis,baselines:input.baselines,proof:humanDecisionProof(preview),...(supersedes?{supersedesDecisionId:supersedes.decisionId}:{})}),next={...scope,humanDecisions:{revision:revision+1,records:[...records,record]}};
      return {scopes:[next],receipt:this.receipt(next,input.commandId)!};
      }));
    })}catch(error){
      // 并发同命令可能已由另一个请求保存；只查其原回执，不重建证明或换命令再提交。
      const settled=await this.store.commandReceipt(command.commandId);if(settled){check(settled.fingerprint===command.fingerprint,'COMMAND_ID_CONFLICT','相同命令 ID 已用于不同请求');return settled.receipt as HumanDecisionReceipt}throw error;
    }
  }
}
