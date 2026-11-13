/**
 * 作用定位：按主 Session → 原话题 → 内容引用读取现有调度及公开对话日志。
 * 设计原因：沿持久 mainRunIds、task.scopeId 和信封原身份归档，不按时间归属；不复制正文或创建第二份执行状态。主上下文可按需追溯，成员没有本入口。
 */
import {fail} from '../../../core/errors';
import {hash,json} from '../../../core/platform/node/serialization';
import type {DispatchStore,DispatchState} from '../../dispatch/rules/dispatch-storage';
import type {GraphIdentity} from '../rules/graph-types';
import type {RunSummary} from '../../execution/rules/types';
import type {DispatchRun} from '../rules/dispatch-execution';
import {projectRunEvent} from '../../runtime/monitoring/public-run-events';
import {projectMainScope} from '../rules/scope-public';
import {officeHistoryQuerySchema,type OfficeHistoryEntry,type OfficeHistoryQuery,type OfficeHistoryResult} from '../rules/office-history';

/** 只接受已登记运行，不接受模型给出的磁盘路径；不包含启动、恢复或写入端口。 */
export interface OfficeHistoryPorts {inspectMain(rootSessionId:string,runId:string):Promise<RunSummary>;inspectMember(run:DispatchRun):Promise<RunSummary>}
interface Entry {reference:OfficeHistoryEntry;read:()=>Promise<unknown>}

/** 保存的是原 canonical；此服务只生成可重建目录并读取明确选择的一份内容。 */
export class OfficeHistoryService {
  constructor(private readonly workspaceId:string,private readonly store:DispatchStore,private readonly ports?:OfficeHistoryPorts){}
  private index(state:DispatchState,identity:GraphIdentity,scopeId:string):Entry[]{
    const scope=state.scopes?.find(value=>value.scopeId===scopeId&&value.rootSessionId===identity.rootSessionId&&value.workspaceId===identity.workspaceId);
    if(!scope)fail('OFFICE_HISTORY_IDENTITY','话题不属于当前办公室');
    const tasks=state.graphs.find(value=>value.identity.rootSessionId===identity.rootSessionId)?.tasks.filter(task=>task.scopeId===scopeId)??[];
    const entries:Entry[]=[{reference:{refId:'goal',kind:'goal',actorId:'cbim:main',inputRevision:scope.goal?.inputRevision??1},read:async()=>projectMainScope(scope)}];
    for(const runId of scope.runTracking?.mainRunIds??[])entries.push({reference:{refId:'main:'+runId,kind:'main-run',actorId:'cbim:main',taskId:identity.rootSessionId,runId},read:async()=>{
      if(!this.ports)fail('OFFICE_HISTORY_UNAVAILABLE','原对话日志读取尚未装配');
      return this.publicRun(await this.ports.inspectMain(identity.rootSessionId,runId),identity,identity.rootSessionId,runId);
    }});
    for(const task of tasks){
      entries.push({reference:{refId:'assignment:'+task.taskId,kind:'assignment',actorId:task.requester.agentId,taskId:task.taskId},read:async()=>task});
      for(const runId of task.runIds){
        const run=state.runs?.find(value=>value.binding.runId===runId&&value.binding.taskId===task.taskId&&value.binding.workspaceId===identity.workspaceId&&value.binding.rootSessionId===identity.rootSessionId);
        if(!run)continue; // 旧缺失归属不按最新任务推造。
        entries.push({reference:{refId:'member:'+task.taskId+':'+runId,kind:'member-run',actorId:task.assignee.agentId,taskId:task.taskId,runId,...(run.topicContext?{inputRevision:run.topicContext.inputRevision}:{})},read:async()=>{
          if(!this.ports)fail('OFFICE_HISTORY_UNAVAILABLE','原成员日志读取尚未装配');
          return this.publicRun(await this.ports.inspectMember(run),identity,task.taskId,runId);
        }});
      }
    }
    for(const message of state.outbox.filter(value=>value.kind!=='assignment'&&value.identity.rootSessionId===identity.rootSessionId&&value.identity.workspaceId===identity.workspaceId&&tasks.some(task=>task.taskId===value.taskId))){
      entries.push({reference:{refId:'feedback:'+message.messageId,kind:'feedback',actorId:message.from.agentId,taskId:message.taskId,...('runId' in message?{runId:message.runId}:{})},read:async()=>({message,task:tasks.find(task=>task.taskId===message.taskId)})});
    }
    return entries;
  }
  private publicRun(run:RunSummary,identity:GraphIdentity,taskId:string,runId:string){
    if(run.task.workspaceId!==identity.workspaceId||run.task.taskId!==taskId||run.runId!==runId||run.events.some(event=>event.workspaceId!==identity.workspaceId||event.taskId!==taskId||event.runId!==runId))fail('OFFICE_HISTORY_IDENTITY','原日志身份与话题引用不一致');
    const task={taskId,workspaceId:identity.workspaceId,root:run.task.root,goal:run.task.goal,mode:run.task.mode,moduleIds:run.task.moduleIds,agentId:run.task.agentId,acceptance:run.task.acceptance};
    return {taskId,runId,source:run.source,status:run.status,logIntegrity:run.logIntegrity,events:run.events.map(event=>{
      const projected=projectRunEvent(event,{workspaceId:identity.workspaceId,taskId,runId},task);
      // 正文按外层内容版本分块，不截断公开 user/assistant 文本；其它内部/推理/工具字段沿白名单。
      if(event.type==='run.started'&&run.task.mode==='chat'&&!['member-results','human_decisions','goal-repair'].includes(run.source?.kind??'')&&typeof event.data.message==='string')projected.data.message=event.data.message;
      if(event.type==='message'&&['user','assistant'].includes(String(event.data.role))&&typeof event.data.text==='string')projected.data.text=event.data.text;
      return projected;
    })};
  }
  /** offset>0 必须携带上页版本；变更时拒绝混读，查询与翻页从不恢复任何运行。 */
  async read(identity:GraphIdentity,raw:unknown,signal:AbortSignal):Promise<OfficeHistoryResult>{
    signal.throwIfAborted();if(identity.workspaceId!==this.workspaceId)fail('OFFICE_HISTORY_IDENTITY','归档不属于当前工作区');
    const query:OfficeHistoryQuery=officeHistoryQuerySchema.parse(raw),state=await this.store.read();signal.throwIfAborted();
    if(state.workspaceId!==identity.workspaceId||!state.graphs.some(graph=>graph.identity.workspaceId===identity.workspaceId&&graph.identity.rootSessionId===identity.rootSessionId))fail('OFFICE_HISTORY_IDENTITY','办公室归档不存在');
    let payload:unknown;
    if(query.action==='topics')payload=(state.scopes??[]).filter(scope=>scope.rootSessionId===identity.rootSessionId&&scope.workspaceId===identity.workspaceId).map(scope=>({scopeId:scope.scopeId,status:scope.status,title:(scope.goal?.plan?.objective??scope.goal?.input.message??'历史话题').slice(0,240),...(scope.followupOf?{followupOf:scope.followupOf}:{})}));
    else{
      const index=this.index(state,identity,query.scopeId);
      if(query.action==='topic')payload=index.map(entry=>entry.reference);
      else {const entry=index.find(value=>value.reference.refId===query.refId);if(!entry)fail('OFFICE_HISTORY_REFERENCE','内容引用不属于原话题');payload=json(await entry.read())}
    }
    signal.throwIfAborted();const version=hash(json(payload));
    if(query.offset>0&&!query.version||query.version!==undefined&&query.version!==version)fail('OFFICE_HISTORY_CHANGED','归档内容版本已变化，请从第一页重新读取');
    const size=query.action==='content'?query.maxChars:query.limit,length=(payload as unknown[]|string).length;
    if(query.offset>length)fail('OFFICE_HISTORY_OFFSET','归档读取位置超出内容');
    const end=Math.min(length,query.offset+size),common={...identity,version,offset:query.offset,...(end<length?{nextOffset:end}:{})};
    if(query.action==='content')return {...common,action:'content',scopeId:query.scopeId,refId:query.refId,totalChars:length,text:(payload as string).slice(query.offset,end)};
    if(query.action==='topic')return {...common,action:'topic',scopeId:query.scopeId,items:(payload as OfficeHistoryEntry[]).slice(query.offset,end)};
    return {...common,action:'topics',items:(payload as Extract<OfficeHistoryResult,{action:'topics'}>['items']).slice(query.offset,end)};
  }
}
