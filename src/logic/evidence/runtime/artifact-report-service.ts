/**
 * 目录归属：logic/evidence/runtime；目标状态与核证恢复服务。
 * 作用定位：按指定成员运行列出可信文件基线，并在明确选定后对实际文件作独立只读复核。
 * 设计原因：文件观察与执行回执分页使用不同基线；旧日志不补造，查询不创建模型、恢复任务或改写历史。
 * 职责边界：结果仅覆盖所选文件；未知命令、未覆盖写入和后续副作用保留为限制，哈希相同不签发验收或续跑许可。
 */
import {fail} from '../../../core/errors';
import {isDeepStrictEqual} from 'node:util';
import {hash,json} from '../../../core/platform/node/serialization';
import {artifactReportInputSchema,artifactReportSchema,artifactFileCheckSchema,type ArtifactReport,type ArtifactFileFact,type ArtifactFileCheck} from '../rules/artifact-baseline';
import {verifyArtifactBaselines} from '../rules/artifact-evidence';
import type {DispatchStore,DispatchState} from '../../dispatch/rules/dispatch-storage';
import type {DispatchRun} from '../../tasks/rules/dispatch-execution';
import type {KnowledgeWorkspace} from '../../knowledge/rules/ports';
import type {RunSummary} from '../../execution/rules/types';
import {memberPublicTask} from '../../runtime/monitoring/member-events';

/** 可信平台能力；文件查询不领模型名额，临时读占用仅阻止本应用的业务写入竞争。 */
export interface ArtifactReportPorts {
  inspect(run:DispatchRun):Promise<RunSummary>;
  normalizePath(raw:string):string;
  checkFiles(files:readonly ArtifactFileFact[],signal:AbortSignal):Promise<ArtifactFileCheck[]>;
  acquireRead():()=>void;
}
export class ArtifactReportService {
  constructor(private readonly owner:Pick<KnowledgeWorkspace,'entry'|'assert'|'read'>,private readonly store:Pick<DispatchStore,'read'>,private readonly ports:ArtifactReportPorts){}
  /** baselineId 缺省只列举日志引用；存在时才读所选文件，失败保留未知而不改变任务或日志。 */
  async read(raw:unknown):Promise<ArtifactReport>{
    const parsed=artifactReportInputSchema.safeParse(raw);if(!parsed.success)fail('ARTIFACT_INPUT_INVALID','文件基线核实参数无效');
    const input=parsed.data;this.owner.assert();if(input.workspaceId!==this.owner.entry.id)fail('GRAPH_IDENTITY_MISMATCH','文件基线不属于当前工作区');
    const before=await this.store.read(),facts=this.facts(before,input.rootSessionId,input.taskId,input.runId),{task,run}=facts;
    const report:ArtifactReport={identity:{workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,taskId:input.taskId,runId:input.runId},checkedAt:new Date().toISOString(),basis:'0'.repeat(64),consistency:'stable',log:{state:'unavailable'},coverage:'selected_files_only',impact:'unknown',baselines:[],issues:[]};
    const issue=(code:string,message:string)=>{if(report.issues.length<32)report.issues.push({code,message})};
    const markUnavailable=()=>{if(input.baselineId)report.verification={baselineId:input.baselineId,state:'unverifiable',files:[]}};
    let summary:RunSummary|undefined,logStamp:unknown;
    if(!run||!task.runIds.includes(input.runId)){report.log.state='missing';issue('ARTIFACT_RUN_MISSING','此运行没有完整派发登记，不能从其它轮次猜测基线');markUnavailable()}
    else{
      try{summary=await this.ports.inspect(run)}catch(error){
        const code=(error as {code?:string})?.code;report.log.state=code==='ENOENT'?'missing':code==='RUN_LOG_EMPTY'?'incomplete':code==='RUN_LOG_INVALID'?'invalid':code==='MEMBER_LOG_IDENTITY'?'identity_mismatch':'unavailable';
        issue('ARTIFACT_LOG_UNAVAILABLE','所选运行日志不可核实；缺失或损坏不表示没有副作用');markUnavailable();
      }
      if(summary){
        try{
          report.log.lastSeq=summary.events.at(-1)?.seq??0;
          const binding=run.binding,first=summary.events[0],bounds=summary.events.filter(event=>event.type==='session.bound');
          // 有采集事实就必须具备可核对的原生通道；不能同时删掉登记与日志绑定后仍留下有效文件证明。
          if(summary.events.some(event=>event.type==='artifact.baseline_captured')&&(!run.session.sessionFile||!bounds.length))throw Error('采集日志缺少原生绑定');
          if(binding.workspaceId!==input.workspaceId||binding.rootSessionId!==input.rootSessionId||binding.taskId!==input.taskId||binding.agentId!==task.assignee.agentId||binding.agentInstanceId!==task.assignee.agentInstanceId||binding.agentSessionId!==task.assignee.agentSessionId||binding.planRevision!==task.planRevision||summary.runId!==binding.runId||!isDeepStrictEqual(summary.memberBinding,binding)||summary.conversationBinding||!isDeepStrictEqual(summary.task,memberPublicTask(task,this.owner.entry.path))||first?.type!=='run.started'||!isDeepStrictEqual(first.data.memberBinding,binding)||!isDeepStrictEqual(first.data.task,summary.task)||summary.sessionFile!==run.session.sessionFile||!summary.events.every((event,index)=>event.seq===index+1&&event.workspaceId===input.workspaceId&&event.taskId===input.taskId&&event.runId===input.runId)||bounds.some(event=>event.data.sessionId!==run.session.nativeSessionId||event.data.sessionFile!==run.session.sessionFile)||run.session.sessionFile&&!bounds.length){
            report.log.state='identity_mismatch';issue('ARTIFACT_LOG_IDENTITY','日志身份、原生通道或连续事件与所选任务不一致');markUnavailable();
          }else if(summary.logIntegrity?.partialTail!==false){
            report.log.state='incomplete';issue('ARTIFACT_LOG_INCOMPLETE','日志完整性尚未得到确认，不能从可读前缀签发有效基线');markUnavailable();
          }else{
            report.log.state='verified';
            const verified=verifyArtifactBaselines(summary.events,binding,run.prepared.knowledgeRevision,this.ports.normalizePath,input.baselineId);
            report.baselines=verified.refs;report.impact=verified.impact;for(const item of verified.issues)issue(item.code,item.message);
            if(summary.unresolvedTools.length){report.impact='unknown';issue('ARTIFACT_UNKNOWN_EFFECT','本轮仍有未确认工具结果，文件指纹不能替代副作用核实')}
            logStamp=hash(json(summary.events));
            if(!verified.refs.length)issue('ARTIFACT_BASELINE_MISSING','本轮没有已确认的文件基线；旧记录不会自动补采');
            if(input.baselineId){
              const record=verified.records.find(value=>value.baseline.baselineId===input.baselineId);
              if(!record){issue('ARTIFACT_BASELINE_UNVERIFIED','所选基线不存在或没有匹配的成功采集回执');markUnavailable()}
              else if(run.status==='starting'||run.status==='running'){
                issue('ARTIFACT_RUN_ACTIVE','本轮仍在运行，请结束后再复核文件；列表不触发采集');markUnavailable();
              }else{
                const terminal=summary.events.at(-1);
                if(summary.status!==run.status||!terminal||!['run.settled','run.interrupted'].includes(terminal.type)){
                  issue('ARTIFACT_RUN_UNSETTLED','派发状态与日志终态尚未一致，请稍后重新核实');markUnavailable();
                }else{
                  const current=await this.owner.read();
                  if(current.revision!==record.baseline.knowledgeRevision)issue('ARTIFACT_KNOWLEDGE_CHANGED','当前知识版本与采集时不同；文件相同不代表任务基线仍有效');
                  const verification:NonNullable<ArtifactReport['verification']>={baselineId:input.baselineId,state:'matches',files:[]};
                  let release:(()=>void)|undefined;
                  try{
                    release=this.ports.acquireRead();const signal=AbortSignal.timeout(15_000);
                    const expected=record.baseline.files.map(({sourceToolCallIds:_ids,...file})=>file);
                    verification.files=(await this.ports.checkFiles(expected,signal)).map(value=>artifactFileCheckSchema.parse(value));
                    if(verification.files.length!==expected.length||verification.files.some((file,index)=>this.ports.normalizePath(file.relativePath)!==this.ports.normalizePath(expected[index].relativePath)||file.expected.byteLength!==expected[index].byteLength||file.expected.sha256!==expected[index].sha256))throw Error('文件端口返回值不匹配');
                    if(verification.files.some(file=>file.state==='matches'&&(!file.observed||file.observed.byteLength!==file.expected.byteLength||file.observed.sha256!==file.expected.sha256)||file.state==='changed'&&(!file.observed||file.observed.byteLength===file.expected.byteLength&&file.observed.sha256===file.expected.sha256)))throw Error('文件端口比较结论不一致');
                    verification.state=verification.files.some(file=>file.state==='unverifiable')?'unverifiable':verification.files.some(file=>file.state!=='matches')?'changed':'matches';
                  }catch{verification.state='unverifiable';issue('ARTIFACT_READ_BUSY','当前工作区正被写入或读取服务不可用，请稍后显式复核')}
                  finally{release?.()}
                  report.verification=verification;
                  const latest=await this.owner.read();if(latest.revision!==current.revision){report.consistency='changed_during_read';report.verification.state='unverifiable';issue('ARTIFACT_KNOWLEDGE_CHANGED_DURING_READ','复核期间知识版本变化，本次观察不可合并为稳定结果')}
                }
              }
            }
          }
        }catch{report.log.state='invalid';report.baselines=[];report.impact='unknown';markUnavailable();issue('ARTIFACT_LOG_INVALID','文件基线记录或关联日志结构异常，不能作为有效观察')}
      }
    }
    const after=await this.store.read();this.owner.assert();
    if(this.stamp(facts)!==this.stamp(this.facts(after,input.rootSessionId,input.taskId,input.runId))){report.consistency='changed_during_read';report.impact='unknown';if(report.verification)report.verification.state='unverifiable';issue('ARTIFACT_STATE_CHANGED','读取期间任务或运行事实变化，请重新核实')}
    if(input.baselineId&&run&&logStamp){
      try{const afterLog=await this.ports.inspect(run);if(afterLog.logIntegrity?.partialTail!==false||hash(json(afterLog.events))!==logStamp)throw Error('日志在文件读取期间变化')}
      catch{report.consistency='changed_during_read';report.impact='unknown';if(report.verification)report.verification.state='unverifiable';issue('ARTIFACT_LOG_CHANGED','文件复核期间运行日志发生变化或无法再核实，本次观察无效')}
    }
    report.basis=hash(json({state:this.stamp(facts),log:logStamp??report.log,baselines:report.baselines,verification:report.verification,issues:report.issues,consistency:report.consistency}));
    return artifactReportSchema.parse(report);
  }
  private facts(state:DispatchState,root:string,taskId:string,runId:string){
    const graph=state.graphs.find(value=>value.identity.workspaceId===this.owner.entry.id&&value.identity.rootSessionId===root),task=graph?.tasks.find(value=>value.taskId===taskId);
    if(state.workspaceId!==this.owner.entry.id||!graph||!task)fail('TASK_NOT_FOUND','当前主会话没有此任务');
    const run=state.runs?.find(value=>value.binding.workspaceId===this.owner.entry.id&&value.binding.rootSessionId===root&&value.binding.taskId===taskId&&value.binding.runId===runId),scope=state.scopes?.find(value=>value.rootSessionId===root&&value.scopeId===task.scopeId);
    return {graph,task,run,scope};
  }
  private stamp(facts:ReturnType<ArtifactReportService['facts']>){return hash(json({graph: facts.graph.cursor,task:facts.task,run:facts.run,scope:facts.scope}))}
}
