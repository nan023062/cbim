/**
 * 目录归属：backend/scheduler-engine/evidence；目标状态与核证恢复服务。
 * 作用定位：对指定成员运行列出原完整清单，并在用户明确选定后重新观察全部冻结范围。
 * 设计原因：完整日志、任务/原生身份及冻结约定须先一致，读取后复核知识、Store 和日志，不能把跨版本结果合为有效观察。
 * 职责边界：查询不创建运行、补采旧清单、写文件或签署验收；短读占用只约束本应用，外部进程仍可能随后改变文件。
 */
import {isDeepStrictEqual as equal} from 'node:util';
import {fail} from '../../../core/errors';
import {hash,json} from '../../../core/platform/node/serialization';
import {outputManifestQuerySchema,outputManifestReportSchema,outputManifestCheckSchema,type OutputManifestReport,type OutputManifestSnapshot,type OutputManifestCheck} from '../../../logic/evidence/rules/output-manifest';
import {verifyOutputManifests,outputManifestHash} from '../../../logic/evidence/rules/output-manifest-evidence';
import {preparedWorkflowContracts} from '../../../logic/tasks/rules/execution-context';
import {preparedArtifactScopes,artifactScopeLimits} from '../../../logic/workspace/rules/artifact-scope';
import type {DispatchStore,DispatchState} from '../../../logic/dispatch/rules/dispatch-storage';
import type {DispatchRun} from '../../../logic/tasks/rules/dispatch-execution';
import type {KnowledgeWorkspace} from '../../../logic/knowledge/rules/ports';
import type {RunSummary} from '../../../logic/execution/rules/types';
import {memberPublicTask} from '../runtime/member-events';

/** 平台必须重新枚举全部原范围；check 的结论与摘要在服务再次核对，不接受只验旧文件列表。 */
export interface OutputManifestReportPorts {
  inspect(run:DispatchRun):Promise<RunSummary>;
  check(expected:OutputManifestSnapshot,signal:AbortSignal):Promise<OutputManifestCheck>;
  acquireRead():()=>void;
}
export class OutputManifestReportService {
  constructor(private readonly owner:Pick<KnowledgeWorkspace,'entry'|'assert'|'read'>,private readonly store:Pick<DispatchStore,'read'>,private readonly ports:OutputManifestReportPorts){}
  /** 缺 manifestId 只读历史引用；明确选择后才读取当前目录，失败不会自动选其它清单或重试。 */
  async read(raw:unknown):Promise<OutputManifestReport>{
    const parsed=outputManifestQuerySchema.safeParse(raw);if(!parsed.success)fail('MANIFEST_INPUT_INVALID','完整产物清单查询参数无效');
    const {manifestId,...identity}=parsed.data;this.owner.assert();if(identity.workspaceId!==this.owner.entry.id)fail('GRAPH_IDENTITY_MISMATCH','完整产物清单不属于当前工作区');
    const before=await this.store.read(),facts=this.facts(before,identity.rootSessionId,identity.taskId,identity.runId),{task,run}=facts;
    const report:OutputManifestReport={identity,checkedAt:new Date().toISOString(),basis:'0'.repeat(64),consistency:'stable',log:'unavailable',coverage:'declared_scope_complete',manifests:[],issues:[]};
    const issue=(code:string,message:string)=>{if(report.issues.length<32)report.issues.push({code,message})};
    const unavailable=(reason:string)=>{if(manifestId)report.verification={manifestId,state:'unverifiable',expectedHash:report.manifests.find(item=>item.manifestId===manifestId)?.manifestHash??'0'.repeat(64),reason}};
    let summary:RunSummary|undefined,logStamp:string|undefined;
    if(!run||!task.runIds.includes(identity.runId)){issue('MANIFEST_RUN_MISSING','此运行没有完整派发登记，不能借用其它轮次的清单');unavailable('原运行登记不完整')}
    else{
      try{summary=await this.ports.inspect(run)}catch{issue('MANIFEST_LOG_UNAVAILABLE','所选运行日志不可核实，缺失或损坏不表示产物未变化');unavailable('原日志不可核实')}
      if(summary){
        try{
          const binding=run.binding,first=summary.events[0],bounds=summary.events.filter(event=>event.type==='session.bound'),contracts=preparedWorkflowContracts(run.prepared);
          if(binding.workspaceId!==identity.workspaceId||binding.rootSessionId!==identity.rootSessionId||binding.taskId!==identity.taskId||binding.agentId!==task.assignee.agentId||binding.agentInstanceId!==task.assignee.agentInstanceId||binding.agentSessionId!==task.assignee.agentSessionId||binding.planRevision!==task.planRevision||summary.runId!==binding.runId||!equal(summary.memberBinding,binding)||summary.conversationBinding||!equal(summary.task,memberPublicTask(task,this.owner.entry.path))||first?.type!=='run.started'||!equal(first.data.memberBinding,binding)||!equal(first.data.task,summary.task)||!equal(first.data.workflowContracts??[],contracts)||summary.sessionFile!==run.session.sessionFile||!summary.events.every((event,index)=>event.seq===index+1&&event.workspaceId===identity.workspaceId&&event.taskId===identity.taskId&&event.runId===identity.runId)||bounds.some(event=>event.data.sessionId!==run.session.nativeSessionId||event.data.sessionFile!==run.session.sessionFile)||run.session.sessionFile&&!bounds.length||summary.events.some(event=>event.type==='artifact.manifest_captured')&&(!run.session.sessionFile||!bounds.length))throw Error('日志身份、连续性或冻结范围不符');
          if(summary.logIntegrity?.partialTail!==false)throw Error('原日志完整性未确认');
          const scopes=preparedArtifactScopes(contracts),verified=verifyOutputManifests(summary.events,binding,run.prepared.knowledgeRevision,scopes);
          report.log='verified';if(scopes.length)report.scopes=scopes;report.manifests=verified.refs;for(const item of verified.issues)issue(item.code,item.message);logStamp=hash(json(summary.events));
          if(!scopes.length)issue('MANIFEST_SCOPE_MISSING','此运行没有冻结的完整产物范围，旧选定文件记录不能转换为完整清单');
          else if(!verified.refs.length)issue('MANIFEST_MISSING','此运行没有已确认的完整采集记录，不会自动补采');
          if(summary.unresolvedTools.length)issue('MANIFEST_UNKNOWN_EFFECT','本轮仍有未确认工具；当前文件观察不能替代原副作用核实');
          if(manifestId){
            const record=verified.records.find(item=>item.manifest.manifestId===manifestId),terminal=summary.events.at(-1);
            if(!record)unavailable('所选清单不存在或缺少原成功采集回执');
            else if(run.status==='starting'||run.status==='running')unavailable('本轮仍在运行，请结束后再明确复核');
            else if(summary.status!==run.status||!terminal||!['run.settled','run.interrupted'].includes(terminal.type))unavailable('派发状态与日志终态尚未一致');
            else{
              const current=await this.owner.read();let release:(()=>void)|undefined;
              try{
                release=this.ports.acquireRead();const expected=record.manifest.snapshot,signal=AbortSignal.timeout(artifactScopeLimits.readMs),check=outputManifestCheckSchema.parse(await this.ports.check(structuredClone(expected),signal));signal.throwIfAborted();this.owner.assert();
                if(check.expectedHash!==record.manifest.manifestHash)throw Error('复核换绑原清单');
                if(check.state==='unverifiable'){if(check.observed||check.observedHash)throw Error('未知复核不得返回部分观察作为完整结果')}
                else if(!check.observed||!equal(check.observed.scopes,expected.scopes)||check.observedHash!==outputManifestHash(check.observed)||(check.state==='matches')!==(check.observedHash===record.manifest.manifestHash))throw Error('平台返回的完整范围或结论不一致');
                report.verification={...check,manifestId,expected:structuredClone(expected)};
              }catch{unavailable('当前读取不可核实或工作区正被写入，请稍后显式复核');issue('MANIFEST_READ_UNAVAILABLE','完整读取未得到可靠结果，不返回部分目录作为成功')}
              finally{release?.()}
              const latest=await this.owner.read();if(latest.revision!==current.revision){report.consistency='changed_during_read';unavailable('复核期间知识版本变化');issue('MANIFEST_KNOWLEDGE_CHANGED_DURING_READ','复核期间知识版本变化，本次观察不可合并为稳定结果')}
              else if(current.revision!==record.manifest.knowledgeRevision)issue('MANIFEST_KNOWLEDGE_CHANGED','当前知识版本与采集时不同；集合相同不表示原任务依据仍有效');
            }
          }
        }catch{report.log='unavailable';report.manifests=[];delete report.scopes;unavailable('原日志身份、完整性或冻结约定无法核实');issue('MANIFEST_LOG_INVALID','原日志或关联记录不完整、身份不符或结构异常，不能作为完整清单依据')}
      }
    }
    const after=await this.store.read();this.owner.assert();
    if(this.stamp(facts)!==this.stamp(this.facts(after,identity.rootSessionId,identity.taskId,identity.runId))){report.consistency='changed_during_read';unavailable('读取期间任务或运行事实变化');issue('MANIFEST_STATE_CHANGED','任务或运行事实已变化，请重新核实')}
    if(manifestId&&run&&logStamp){try{const afterLog=await this.ports.inspect(run);if(afterLog.logIntegrity?.partialTail!==false||hash(json(afterLog.events))!==logStamp)throw Error('日志变化')}catch{report.consistency='changed_during_read';unavailable('复核期间原日志变化或不可读');issue('MANIFEST_LOG_CHANGED','复核期间原日志变化，本次观察无效')}}
    report.basis=hash(json({state:this.stamp(facts),log:logStamp??report.log,scopes:report.scopes,manifests:report.manifests,verification:report.verification,issues:report.issues,consistency:report.consistency}));return outputManifestReportSchema.parse(report);
  }
  private facts(state:DispatchState,root:string,taskId:string,runId:string){
    const graph=state.graphs.find(item=>item.identity.workspaceId===this.owner.entry.id&&item.identity.rootSessionId===root),task=graph?.tasks.find(item=>item.taskId===taskId);
    if(state.workspaceId!==this.owner.entry.id||!graph||!task)fail('TASK_NOT_FOUND','当前主会话没有此任务');
    const run=state.runs?.find(item=>item.binding.workspaceId===this.owner.entry.id&&item.binding.rootSessionId===root&&item.binding.taskId===taskId&&item.binding.runId===runId),scope=state.scopes?.find(item=>item.rootSessionId===root&&item.scopeId===task.scopeId);return {graph,task,run,scope};
  }
  private stamp(facts:ReturnType<OutputManifestReportService['facts']>){return hash(json({graph:facts.graph.cursor,task:facts.task,run:facts.run,scope:facts.scope}))}
}
