/**
 * 目录归属：backend/scheduler-engine/budget；预算准入与统计服务。
 * 作用定位：按指定目标周期的持久主运行清单与成员绑定，读取 canonical 日志并生成只读消耗报告。
 * 设计原因：同一主会话可跨多个目标，不能按时间或最近日志猜归属；缺失记录与未知价格保留不完整，不参与执行许可。
 * 职责边界：公开查询只读有界来源并前后核实基线；collect 为预算事务复用相同 canonical 校验但不重入存储，不扫描其它主会话、不修复或启动模型。
 */
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {RunSummary} from '../../core/execution/types';
import {emptyScopeRunUsage,measureScopeRunUsage,summarizeScopeUsage} from '../../core/execution/scope-usage';
import type {DispatchStore,DispatchState} from '../../core/dispatch/dispatch-storage';
import type {DispatchRun} from '../../core/tasks/dispatch-execution';
import type {TaskNode} from '../../core/tasks/graph-types';
import {scopeUsageInputSchema,scopeUsageReportSchema,type ScopeUsageInput,type ScopeUsageReport,type ScopeUsageRun} from '../../core/budget/scope-usage';
import type {ScopeGoalPorts} from '../goals/scope-goal-service';

type Owner=Pick<KnowledgeWorkspace,'entry'|'assert'>;
type Source={kind:'main'|'member';taskId:string;runId:string;task?:TaskNode;run?:DispatchRun;invalid?:boolean};
function matches(value:unknown,expected:unknown){return json(value)===json(expected)}

/** 共享已有的可信日志端口，但查询独立于目标审阅；不能通过本报告批准目标或触发恢复。 */
export class ScopeUsageService {
  constructor(private readonly owner:Owner,private readonly store:Pick<DispatchStore,'read'>,private readonly logs?:ScopeGoalPorts){}
  private facts(state:DispatchState,input:ScopeUsageInput){
    const scope=state.scopes?.find(value=>value.scopeId===input.scopeId&&value.rootSessionId===input.rootSessionId&&value.workspaceId===input.workspaceId);
    const graph=state.graphs.find(value=>value.identity.rootSessionId===input.rootSessionId&&value.identity.workspaceId===input.workspaceId);
    const tasks=graph?.tasks.filter(task=>task.scopeId===input.scopeId)??[],ids=new Set(tasks.map(task=>task.taskId));
    const runs=(state.runs??[]).filter(run=>run.binding.rootSessionId===input.rootSessionId&&ids.has(run.binding.taskId));
    const sessions=state.sessions.filter(session=>session.rootSessionId===input.rootSessionId);
    return {scope,root:graph?.root,tasks,runs,sessions};
  }
  private sources(facts:ReturnType<ScopeUsageService['facts']>,input:ScopeUsageInput):Source[]{
    const output:Source[]=(facts.scope?.runTracking?.mainRunIds??[]).map(runId=>({kind:'main',taskId:input.rootSessionId,runId}));
    for(const task of facts.tasks){
      const saved=facts.runs.filter(run=>run.binding.taskId===task.taskId);
      for(const runId of new Set([...task.runIds,...saved.map(run=>run.binding.runId)])){
        const found=saved.filter(run=>run.binding.runId===runId),run=found[0];
        const bound=run&&run.binding.workspaceId===input.workspaceId&&run.binding.rootSessionId===input.rootSessionId&&run.binding.agentId===task.assignee.agentId&&run.binding.agentInstanceId===task.assignee.agentInstanceId&&run.binding.agentSessionId===task.assignee.agentSessionId&&run.binding.planRevision===task.planRevision;
        output.push({kind:'member',taskId:task.taskId,runId,task,run,invalid:found.length!==1||!bound||!task.runIds.includes(runId)});
      }
    }
    if(output.length>532)fail('SCOPE_USAGE_LIMIT','本周期运行来源超过单次核实上限，未截断或显示不完整总数');
    // 即使存储端口返回矛盾来源，也不能把同一运行重复计入总数。
    const counts=new Map<string,number>();for(const source of output)counts.set(source.runId,(counts.get(source.runId)??0)+1);
    return output.filter((source,index)=>output.findIndex(value=>value.runId===source.runId)===index).map(source=>({...source,invalid:source.invalid||(counts.get(source.runId)??0)>1}));
  }
  private bound(summary:RunSummary,source:Source,facts:ReturnType<ScopeUsageService['facts']>,input:ScopeUsageInput){
    if(summary.runId!==source.runId||summary.task.workspaceId!==input.workspaceId||summary.task.root!==this.owner.entry.path||summary.task.taskId!==source.taskId)return false;
    if(!Array.isArray(summary.events)||!summary.events.length||summary.events[0].type!=='run.started'||summary.events.some((event,index)=>event.seq!==index+1||event.workspaceId!==input.workspaceId||event.taskId!==source.taskId||event.runId!==source.runId))return false;
    const started=summary.events[0].data;
    if(!matches(started.task,summary.task)||!matches(started.conversationBinding,summary.conversationBinding)||!matches(started.memberBinding,summary.memberBinding))return false;
    if(source.kind==='member')return summary.task.agentId===source.task?.assignee.agentId&&!summary.conversationBinding&&matches(summary.memberBinding,source.run?.binding);
    const binding=summary.conversationBinding,root=facts.root?.agent,session=facts.sessions.find(item=>item.agentSessionId===binding?.agentSessionId&&item.purpose==='conversation');
    return summary.task.mode==='chat'&&summary.task.agentId==='cbim:main'&&!summary.memberBinding&&binding?.workspaceId===input.workspaceId&&binding.rootSessionId===input.rootSessionId&&binding.agentId==='cbim:main'&&binding.agentInstanceId===root?.agentInstanceId&&session?.workspaceId===input.workspaceId&&session.rootSessionId===input.rootSessionId&&session.agentId==='cbim:main'&&session.agentInstanceId===root?.agentInstanceId&&session.teamId===binding.teamId;
  }
  /** 使用调用方已持有的事务快照核实日志；不重入 store.read，也不把公开报告缓存当作启动许可。 */
  async collect(state:DispatchState,raw:unknown){
    const parsed=scopeUsageInputSchema.safeParse(raw);if(!parsed.success)fail('SCOPE_USAGE_INPUT','周期消耗查询身份无效');const input=parsed.data;
    this.owner.assert();if(input.workspaceId!==this.owner.entry.id)fail('SCOPE_USAGE_IDENTITY','周期消耗不属于当前工作区');
    const facts=this.facts(state,input);
    if(state.workspaceId!==input.workspaceId||!facts.scope||!facts.root)fail('SCOPE_USAGE_IDENTITY','目标周期不属于当前主会话或缺少可信图根');
    const sources=this.sources(facts,input),runs:ScopeUsageRun[]=[],logStamps:unknown[]=[];
    for(const source of sources){
      const result:ScopeUsageRun={kind:source.kind,taskId:source.taskId,runId:source.runId,status:source.run?.status??'unknown',logState:'invalid',usage:emptyScopeRunUsage()};
      if(source.invalid){result.logState='identity_mismatch';result.usage.issues.push({code:'SCOPE_USAGE_IDENTITY',message:'运行来源与持久任务身份不一致，未计入消耗。'})}
      else if(!this.logs){result.usage.issues.push({code:'SCOPE_USAGE_UNAVAILABLE',message:'当前未装配可信运行日志读取，消耗未知。'})}
      else try{
        const summary=source.kind==='main'?await this.logs.inspectMain(input.rootSessionId,source.runId):await this.logs.inspectMember(structuredClone(source.run!));
        if(!this.bound(summary,source,facts,input)){result.logState='identity_mismatch';result.usage.issues.push({code:'SCOPE_USAGE_IDENTITY',message:'日志身份、顺序或会话绑定不一致，未计入消耗。'})}
        else{
          result.status=source.run?.status??summary.status;
          result.logState=summary.logIntegrity?.partialTail===false?'verified':'incomplete';result.usage=measureScopeRunUsage(summary);
          if(!summary.logIntegrity)result.usage.issues.push({code:'SCOPE_USAGE_INTEGRITY_UNKNOWN',message:'日志读取端未报告完整性，当前统计不能视为完整用量。'});
          logStamps.push({runId:source.runId,seq:summary.events.at(-1)?.seq,status:summary.status,integrity:summary.logIntegrity,usage:result.usage});
        }
      }catch(error){
        const code=(error as {code?:string})?.code;
        result.logState=code==='ENOENT'?'missing':code==='RUN_LOG_EMPTY'?'incomplete':code==='MEMBER_LOG_IDENTITY'?'identity_mismatch':'invalid';
        result.usage=emptyScopeRunUsage();result.usage.issues.push({code:'SCOPE_USAGE_LOG_UNAVAILABLE',message:'该运行日志缺失、不完整或无法核实；不代表没有执行或没有消耗。'});
      }
      runs.push(result);
    }
    return {input,facts,runs,logStamps};
  }
  /** 查询无自动重试；不同步的来源与日志只降低完整性，不按错误结果估算零消耗。 */
  async read(raw:unknown):Promise<ScopeUsageReport>{
    const {input,facts,runs,logStamps}=await this.collect(await this.store.read(),raw);
    const after=await this.store.read();this.owner.assert();
    const consistency=after.workspaceId===input.workspaceId&&matches(facts,this.facts(after,input))?'stable':'changed_during_read';
    const coverage=facts.scope!.runTracking?'tracked':'legacy';
    const issues=[...(coverage==='legacy'?[{code:'SCOPE_USAGE_LEGACY',message:'旧周期没有从创建起登记完整主运行清单；只展示可核实成员来源，不推断完整总数。'}]:[]),...(consistency==='changed_during_read'?[{code:'SCOPE_USAGE_CHANGED',message:'读取期间周期或运行归属发生变化，本次仅为部分观察，请重新读取。'}]:[])];
    return scopeUsageReportSchema.parse({identity:input,checkedAt:new Date().toISOString(),basis:hash(json({facts,logStamps,consistency})),consistency,coverage,scopeStatus:facts.scope!.status,scopeOutcome:facts.scope!.outcome,totals:summarizeScopeUsage(runs,coverage,consistency),runs,issues});
  }
}
