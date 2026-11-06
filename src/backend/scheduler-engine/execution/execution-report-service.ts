/**
 * 作用定位：以持久派发状态和指定成员运行日志生成异常核实报告。
 * 设计原因：观察流程独立于执行恢复，不创建模型、不确认信封、不改写记录；前后读取屏障和分页基线避免把不同时间的证据拼成一次完成结论。
 */
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import {executionReportInputSchema,executionReportSchema,type ExecutionReport} from '../../core/tasks/execution-report';
import type {DispatchStore,DispatchState} from '../../core/tasks/dispatch-storage';
import type {DispatchRun} from '../../core/tasks/dispatch-execution';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {RunSummary} from '../../core/brain/types';
import {executionToolFacts} from './execution-report-facts';

const active=(run?:DispatchRun)=>run?.status==='starting'||run?.status==='running';
const emptyTools=():ExecutionReport['tools']=>({available:false,total:0,counts:{succeeded:0,failed:0,denied:0,unknown:0,not_authorized:0},items:[],paginationReset:false});
/** inspect 必须读取指定 run 的权威日志，不能从 UI 缓存或最近一次运行替代。 */
export class ExecutionReportService {
  constructor(private owner:Pick<KnowledgeWorkspace,'entry'|'assert'>,private store:Pick<DispatchStore,'read'>,private inspect:(run:DispatchRun)=>Promise<RunSummary>){}
  /** 只读核实；缺失、损坏、截断及身份不符返回保守报告，非法请求或跨主会话访问仍拒绝。 */
  async read(raw:unknown):Promise<ExecutionReport>{
    const parsed=executionReportInputSchema.safeParse(raw);
    if(!parsed.success)fail('MEMBER_INPUT_INVALID','执行核实参数无效');
    const input=parsed.data;this.owner.assert();
    if(input.workspaceId!==this.owner.entry.id)fail('GRAPH_IDENTITY_MISMATCH','执行核实不属于当前工作区');
    const before=await this.store.read(),facts=this.facts(before,input.rootSessionId,input.taskId,input.runId);
    const {task,run,scope,graph}=facts;
    const result:ExecutionReport={identity:{workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,taskId:input.taskId,...(input.runId?{runId:input.runId}:{})},checkedAt:new Date().toISOString(),basis:{key:'0'.repeat(64),graphCursor:graph.cursor,taskRevision:task.revision,planRevision:task.planRevision,taskStatus:task.status,...(task.scopeId?{scopeId:task.scopeId}:{}),...(scope?{scopeStatus:scope.status,goalRevision:scope.goal?.revision}:{}),...(run?{runStatus:run.status}:{})},consistency:'stable',execution:'unknown',log:{state:'not_selected'},tools:emptyTools(),issues:[],next:{kind:'inspect_effects',reason:'先核实已有产物与操作结果；本报告不会自动重放工具。'}};
    const issue=(code:string,severity:ExecutionReport['issues'][number]['severity'],message:string)=>result.issues.push({code,severity,message});
    let summary:RunSummary|undefined,logToken:unknown;
    if(!input.runId){
      // 没有 run 意图也必须没有领取/执行事实，才可说当前任务尚未启动。
      const claimed=before.outbox.some(m=>m.taskId===task.taskId&&m.identity.rootSessionId===input.rootSessionId&&!!m.claim);
      const registered=(before.runs??[]).some(r=>r.binding.taskId===task.taskId&&r.binding.rootSessionId===input.rootSessionId);
      if(!task.runIds.length&&!task.activeRunId&&!registered&&!claimed&&!task.result&&['planned','queued','waiting'].includes(task.status)){
        result.execution='not_started';result.log.state='not_expected';issue('TASK_NOT_STARTED','info','当前任务没有已提交的运行或领取记录；这不表示工作区从未被其它任务修改。');
      }else issue('RUN_NOT_SELECTED','info','请选择需要核实的运行轮次；未选择时不自动读取最新日志。');
    }else if(!task.runIds.includes(input.runId)||!run||!this.bound(run,task,input.workspaceId,input.rootSessionId)){
      result.log.state=run?'identity_mismatch':'missing';issue('DISPATCH_RUN_UNVERIFIED','danger','所选运行没有与当前任务匹配的持久领取记录，启动结果未知。');
    }else{
      try{summary=await this.inspect(structuredClone(run))}catch(error){
        const code=(error as {code?:string})?.code;
        result.log.state=code==='ENOENT'?'missing':code==='RUN_LOG_EMPTY'?'incomplete':code==='RUN_LOG_INVALID'?'invalid':code==='MEMBER_LOG_IDENTITY'?'identity_mismatch':'unavailable';
        issue('RUN_LOG_'+result.log.state.toUpperCase(),'danger','无法核实所选运行日志；缺失或损坏不代表没有执行或没有副作用。');
      }
      if(summary){
        try{
        result.basis.logSeq=summary.events.at(-1)?.seq??0;
        if(!this.matches(summary,run)){
          result.log.state='identity_mismatch';issue('RUN_LOG_IDENTITY','danger','日志身份、事件顺序或成员绑定与所选运行不一致，不能用作执行证据。');
        }else{
          const terminal=summary.events.at(-1),hasTerminal=terminal?.type==='run.settled'||terminal?.type==='run.interrupted';
          const toolFacts=executionToolFacts(summary,run);
          result.log={state:summary.logIntegrity?.partialTail?'incomplete':'verified',hasTerminal,summaryStatus:summary.status};
          result.tools={available:true,total:toolFacts.items.length,counts:toolFacts.counts,items:[],paginationReset:false};
          logToken={lastSeq:result.basis.logSeq,status:summary.status,partialTail:!!summary.logIntegrity?.partialTail,hasTerminal,tools:toolFacts.items,invalid:toolFacts.invalid};
          // 仍在运行的正常授权工具可以在途；已结束、失去活动归属或收到 unknown 回执则必须核实。
          const pending=toolFacts.counts.unknown>0||summary.unresolvedTools.length>0;
          const uncertain=!!summary.logIntegrity?.partialTail||toolFacts.invalid||toolFacts.explicitUnknown||(!active(run)&&pending);
          if(summary.logIntegrity?.partialTail)issue('RUN_LOG_INCOMPLETE','danger','日志尾行尚未完整写入；可读前缀不能证明本次执行已完整结束。');
          if(toolFacts.invalid)issue('TOOL_EVIDENCE_INVALID','danger','部分工具缺少匹配的授权链或可信回执，结果未知。');
          if(pending)issue(active(run)&&!uncertain?'TOOLS_IN_FLIGHT':'TOOLS_UNCONFIRMED',active(run)&&!uncertain?'info':'warning',active(run)&&!uncertain?'存在正在执行、尚未返回回执的工具。':'存在未确认结果的工具；请核实产物和外部操作，不要自动重放。');
          if(!uncertain){
            if(active(run)&&!hasTerminal)result.execution='in_flight';
            else if(!active(run)&&hasTerminal&&summary.status===run.status)result.execution='settled';
            else issue('RUN_STATE_UNCONFIRMED','warning','派发状态与日志终态尚未一致，等待状态稳定后重新核实。');
          }
          if(toolFacts.counts.failed)issue('TOOLS_FAILED_WITH_POSSIBLE_EFFECTS','warning','收到工具失败回执；工具失败前仍可能已经写入文件或改变外部状态。');
          if(['failed','cancelled','interrupted'].includes(run.status))issue('RUN_ENDED_ABNORMALLY','warning','运行已异常结束或停止；这不表示已撤销执行产生的改动。');
          if(result.execution==='settled'&&task.result?.runId===input.runId&&task.result.planRevision===run.binding.planRevision)result.candidate={resultId:task.result.resultId,runId:task.result.runId,planRevision:task.result.planRevision,acceptance:'not_evaluated'};
          // 先保留完整有界字段用于 hash/count；分页只在读后屏障通过后返回。
          result.tools.items=toolFacts.items;
        }
        }catch{
          // 旧日志可能 JSON 可解析但事件正文不符合协议；核实入口不回显原文或中断整张任务视图。
          result.execution='unknown';result.log={state:'invalid'};result.tools=emptyTools();delete result.candidate;delete result.basis.logSeq;logToken=undefined;
          issue('RUN_LOG_INVALID','danger','运行日志包含无法核实的事件结构；请先检查原有产物，本报告不会修复或重放。');
        }
      }
    }
    const after=await this.store.read();this.owner.assert();
    const afterFacts=this.facts(after,input.rootSessionId,input.taskId,input.runId);
    if(this.stamp(facts)!==this.stamp(afterFacts)){
      result.consistency='changed_during_read';result.execution='unknown';result.tools=emptyTools();delete result.candidate;
      issue('REPORT_CHANGED_DURING_READ','warning','读取期间任务或运行状态发生变化；请重新核实，不能合并本次与旧报告。');
    }
    result.basis.key=hash(json({state:this.stamp(facts),log:logToken??result.log,consistency:result.consistency}));
    const reset=!!input.cursor&&input.cursor.basis!==result.basis.key;
    const offset=reset?0:input.cursor?.offset??0;
    result.tools.paginationReset=reset;
    if(offset>result.tools.total){result.tools.paginationReset=true}
    const start=offset>result.tools.total?0:offset;
    result.tools.items=result.tools.items.slice(start,start+input.limit);
    if(result.tools.available&&start+input.limit<result.tools.total)result.tools.nextCursor={basis:result.basis.key,offset:start+input.limit};
    if(scope?.status==='closed')result.next={kind:'new_cycle_only',reason:'本调度周期已关闭，只能先核实遗留影响，再在新周期创建新的执行任务；本报告不执行重试。'};
    else if(result.execution==='in_flight'||result.execution==='not_started')result.next={kind:'observe',reason:'继续观察任务状态；读取报告不会启动、停止或确认任何操作。'};
    else if(result.execution==='settled'&&!result.tools.counts.failed)result.next={kind:'inspect_effects',reason:'已核实运行回执；产物是否满足业务目标仍需独立验证与验收。'};
    return executionReportSchema.parse(result);
  }
  private facts(state:DispatchState,rootSessionId:string,taskId:string,runId?:string){
    const graph=state.graphs.find(g=>g.identity.workspaceId===this.owner.entry.id&&g.identity.rootSessionId===rootSessionId),task=graph?.tasks.find(t=>t.taskId===taskId);
    if(state.workspaceId!==this.owner.entry.id||!graph||!task)fail('TASK_NOT_FOUND','当前主会话没有此派发任务');
    const run=runId?state.runs?.find(r=>r.binding.runId===runId&&r.binding.taskId===taskId&&r.binding.rootSessionId===rootSessionId&&r.binding.workspaceId===this.owner.entry.id):undefined;
    const scope=task.scopeId?state.scopes?.find(s=>s.scopeId===task.scopeId&&s.rootSessionId===rootSessionId&&s.workspaceId===this.owner.entry.id):undefined;
    return {graph,task,run,scope};
  }
  private stamp(value:ReturnType<ExecutionReportService['facts']>){return hash(json({cursor:value.graph.cursor,task:value.task,run:value.run?{binding:value.run.binding,status:value.run.status,startedAt:value.run.startedAt,settledAt:value.run.settledAt,session:value.run.session}:undefined,scope:value.scope?{id:value.scope.scopeId,status:value.scope.status,goalRevision:value.scope.goal?.revision}:undefined}))}
  private bound(run:DispatchRun,task:ReturnType<ExecutionReportService['facts']>['task'],workspaceId:string,rootSessionId:string){const b=run.binding;return b.workspaceId===workspaceId&&b.rootSessionId===rootSessionId&&b.taskId===task.taskId&&b.agentId===task.assignee.agentId&&b.agentInstanceId===task.assignee.agentInstanceId&&b.agentSessionId===task.assignee.agentSessionId}
  private matches(summary:RunSummary,run:DispatchRun){
    const b=run.binding;
    return ['running','completed','cancelled','failed','interrupted'].includes(summary.status)&&summary.runId===b.runId&&summary.task.workspaceId===b.workspaceId&&summary.task.taskId===b.taskId&&summary.task.agentId===b.agentId&&summary.task.root===this.owner.entry.path&&json(summary.memberBinding)===json(b)&&summary.events.length>0&&summary.events[0].type==='run.started'&&summary.events.every((event,index)=>event.seq===index+1&&event.runId===b.runId&&event.taskId===b.taskId&&event.workspaceId===b.workspaceId)&&(!run.session.sessionFile||summary.sessionFile===run.session.sessionFile);
  }
}
