/**
 * 作用定位：按工作区静态角色归档 Session 与运行摘要，向团队节点提供分页历史和受限事件详情。
 * 设计原因：实例释放不删除履历，索引与正文分离；只接收已落盘日志/派发意图，列表不回读日志，详情按需恢复后消费增量。
 * 生命周期：装配方先 initialize，再接入观察；关闭前排空执行并撤销订阅，close 等待索引写完。索引错误可见但不改变已发生的执行。
 */
import {fail} from '../../core/foundation/errors';
import type {RunSummary,StoredEvent,TaskSpec} from '../../core/brain/types';
import {checkedConversationAgentBinding} from '../../core/brain/conversation-binding';
import {checkedMemberRunBinding} from '../../core/brain/member-run';
import type {DispatchState,DispatchMutation} from '../../core/tasks/dispatch-storage';
import type {DispatchRun} from '../../core/tasks/dispatch-execution';
import type {TaskNode} from '../../core/tasks/graph-types';
import type {MemberRunView} from '../../core/tasks/member-events';
import {agentHistoryRolesInput,agentHistorySessionsInput,agentHistoryRunsInput,agentHistoryEventsInput,type AgentHistoryRole,type AgentHistorySession,type AgentHistoryRun,type AgentHistoryRoles,type AgentHistoryPage,type AgentHistoryEventsRead} from '../../core/team/session-history';
import {checkedAgentHistoryRecord,type AgentHistoryRecord,type AgentHistoryStore} from '../../core/team/session-history-storage';
import {projectRunEvent} from '../execution/public-run-events';

type Source=AgentHistoryRecord['journal'];
interface EventStream {events:StoredEvent[];pending:Map<number,StoredEvent>;unresolved:Set<string>;progress?:MemberRunView['taskProgress'];loading?:Promise<void>;loaded:boolean;failure?:Error}
/** read 只接收已核验的索引定位；main 再从固定运行根解析，不允许请求方传磁盘路径。 */
export interface AgentHistoryPorts {
  store:AgentHistoryStore;
  read(record:AgentHistoryRecord):Promise<RunSummary>;
  diagnostic?(message:string):void;
}
const clone=<T>(value:T):T=>structuredClone(value);
const runKey=(taskId:string,runId:string)=>JSON.stringify([taskId,runId]);
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const terminal=(status:string)=>!['starting','running'].includes(status);
const named=(value:unknown,fallback:string)=>typeof value==='string'&&value.trim()?value.slice(0,512):fallback;
const date=(value:string)=>{if(!Number.isFinite(Date.parse(value)))throw Error('历史时间无效');return value};
/** 不复制冻结知识、原生配置或模型来源；只保留公开任务字段。 */
function publicTask(task:TaskSpec):TaskSpec {
  return {taskId:task.taskId,workspaceId:task.workspaceId,root:task.root,goal:task.goal,moduleIds:[...task.moduleIds],agentId:task.agentId,acceptance:[...task.acceptance],...(task.mode?{mode:task.mode}:{}),...(task.responsiblePerson?{responsiblePerson:task.responsiblePerson}:{})};
}

/** 独立查询服务；不持有模型、审批或派发执行入口，查询无法唤醒成员。 */
export class AgentHistoryService {
  private records=new Map<string,AgentHistoryRecord>();
  private tasks=new Map<string,TaskNode>();
  private streams=new Map<string,EventStream>();
  /** 已观察到的重复序号/身份冲突不能靠 LRU 淘汰或重复查询清除；重新打开后核实 canonical。 */
  private brokenStreams=new Set<string>();
  private diagnostics=new Map<string,string>();
  private pending:Promise<void>=Promise.resolve();
  private initialized?:Promise<void>;
  private closed=false;
  /** 记录本进程真实 run.started；读取旧 running 时不能把它恢复为当前活跃。 */
  private live=new Set<string>();
  constructor(readonly workspaceId:string,private readonly root:string,private readonly ports:AgentHistoryPorts){}

  /** 仅加载派生索引一次；失败保持诊断，随后 canonical 恢复仍可回补。 */
  initialize(){return this.initialized??=(async()=>{
    try{
      const loaded=await this.ports.store.load();
      for(const message of loaded.diagnostics)this.issue('load:'+message,message);
      for(const raw of loaded.records)try{
        const record=checkedAgentHistoryRecord(raw,this.workspaceId,this.root);
        if(!terminal(record.view.status)){record.view.status='interrupted';if(record.dispatchStatus)record.dispatchStatus='interrupted'}
        const key=runKey(record.view.taskId,record.view.runId);
        if(this.records.has(key))throw Error('历史索引重复');
        this.records.set(key,record);
      }catch{this.issue('index-record','部分 Agent 历史索引身份无效，已跳过并等待运行日志回补')}
    }catch{this.issue('load','Agent 历史索引无法读取，列表可能不完整；运行日志仍保留，重新打开工作区时回补')}
  })()}
  /** 外层恢复遇到不可读日志时登记简短诊断，不将路径/工具正文或原始堆栈透传。 */
  issue(key:string,message:string){
    if(this.diagnostics.get(key)===message)return;
    this.diagnostics.set(key,message);if(this.diagnostics.size>100)this.diagnostics.delete(this.diagnostics.keys().next().value!);
    try{this.ports.diagnostic?.(message)}catch{/* 诊断接收失败不改变 canonical 事实；本地查询仍显示诊断。 */}
  }
  private check(id:string){if(id!==this.workspaceId)fail('AGENT_HISTORY_IDENTITY','历史查询属于其他工作区');if(this.closed)fail('AGENT_HISTORY_CLOSED','工作区历史服务已关闭')}
  private notices(){return [...this.diagnostics.values()]}
  private persist(record:AgentHistoryRecord){
    const snapshot=clone(record),key=runKey(record.view.taskId,record.view.runId);
    this.pending=this.pending.then(async()=>{try{await this.ports.store.put(snapshot)}catch{this.issue('write:'+key,'部分 Agent 历史索引未能保存；运行日志仍保留，重新打开工作区时回补')}});
  }
  private put(record:AgentHistoryRecord,persist=true){
    const checked=checkedAgentHistoryRecord(record,this.workspaceId,this.root),key=runKey(checked.view.taskId,checked.view.runId),old=this.records.get(key);
    if(old&&(old.journal!==checked.journal||old.view.agentId!==checked.view.agentId||old.view.sessionId!==checked.view.sessionId||old.view.agentInstanceId!==checked.view.agentInstanceId))throw Error('运行历史归属发生冲突');
    this.records.set(key,checked);
    if(persist&&JSON.stringify(old)!==JSON.stringify(checked))this.persist(checked);
  }
  private fromStart(event:StoredEvent,source:Source):AgentHistoryRecord|undefined{
    const task=event.data.task as TaskSpec;
    if(event.type!=='run.started'||event.seq!==1||!task||task.workspaceId!==this.workspaceId||task.root!==this.root||task.taskId!==event.taskId||event.workspaceId!==this.workspaceId)throw Error('运行起始身份无效');
    if(typeof task.agentId!=='string'||!task.agentId.trim()){this.issue('unassigned:'+runKey(event.taskId,event.runId),'部分旧运行未记录静态 Agent 身份，未猜测归属；原运行日志仍保留');return}
    const member=event.data.memberBinding===undefined?undefined:checkedMemberRunBinding(event.data.memberBinding,task,event.runId);
    const main=event.data.conversationBinding===undefined?undefined:checkedConversationAgentBinding(event.data.conversationBinding,task);
    if(member&&main||(source==='member')!==!!member)throw Error('运行绑定与日志来源不一致');
    const binding=member??main,stamp=date(event.time),legacy=task.workflowContext?.agent as {definition?:{name?:unknown};name?:unknown}|undefined;
    const fallback=task.agentId==='cbim:main'?'主 Agent':task.agentId==='cbim:executor'?'默认执行 Agent':task.agentId;
    return {version:1,kind:main?'conversation':member?'task':'legacy',journal:source,task:publicTask(task),lastSeq:1,journalSeen:true,view:{workspaceId:this.workspaceId,agentId:task.agentId,sessionId:binding?.agentSessionId??`legacy:${task.taskId}`,taskId:task.taskId,runId:event.runId,source:main?'main':member?'member':'legacy',binding:binding?'registered':'legacy',agentName:named(legacy?.definition?.name??legacy?.name,fallback),goal:task.goal,moduleIds:[...task.moduleIds],status:'running',startedAt:stamp,updatedAt:stamp,...(binding?{agentSessionId:binding.agentSessionId,agentInstanceId:binding.agentInstanceId,rootSessionId:binding.rootSessionId}:{}),...(task.workflowContext?.revision?{configurationRevision:task.workflowContext.revision}:{})}};
  }
  /** 一次启动恢复沿用监管已有扫描；重复恢复不重复归档，也不改写原日志。 */
  restoreRun(summary:RunSummary,source:Source){
    if(this.closed)return;
    try{
      const first=summary.events[0],record=first&&this.fromStart(first,source);if(!record)return;
      if(summary.runId!==record.view.runId)throw Error('恢复运行身份无效');
      for(let i=0;i<summary.events.length;i++){const e=summary.events[i];if(e.seq!==i+1||e.taskId!==record.view.taskId||e.runId!==record.view.runId||e.workspaceId!==this.workspaceId)throw Error('历史日志序号或身份无效')}
      const key=runKey(record.view.taskId,record.view.runId),existing=this.records.get(key),last=summary.events.at(-1)!;
      if(existing?.lastSeq&&existing.lastSeq>last.seq)return;
      record.lastSeq=last.seq;record.view.updatedAt=date(last.time);
      record.view.status=this.live.has(key)&&!summary.events.some(e=>e.type==='run.settled'||e.type==='run.interrupted')?'running':summary.status==='running'?'interrupted':summary.status;
      if(existing?.dispatchStatus){record.dispatchStatus=existing.dispatchStatus;record.view.status=existing.dispatchStatus;record.view.agentName=existing.view.agentName;record.view.configurationRevision=existing.view.configurationRevision;record.view.startedAt=existing.view.startedAt;record.view.updatedAt=record.view.updatedAt>existing.view.updatedAt?record.view.updatedAt:existing.view.updatedAt}
      this.put(record);
    }catch{this.issue('restore:'+runKey(summary.task?.taskId??'unknown',summary.runId),'部分运行日志无法核实归属，未归档；历史列表可能不完整')}
  }
  /** 只接收已持久化事件；流式片段推进内存游标，只有开始/终态更新持久化摘要。 */
  observeRun(event:StoredEvent,source:Source){
    if(this.closed)return;
    const key=runKey(event.taskId,event.runId);
    try{
      if(event.workspaceId!==this.workspaceId||!Number.isSafeInteger(event.seq)||event.seq<1)throw Error('事件身份无效');
      let record=this.records.get(key);
      if(event.type==='run.started'){
        const next=this.fromStart(event,source);if(!next)return;
        if(record?.journalSeen){
          if(record.journal!==source||record.view.agentId!==next.view.agentId||record.view.sessionId!==next.view.sessionId||record.view.agentInstanceId!==next.view.agentInstanceId||JSON.stringify(record.task)!==JSON.stringify(next.task))throw Error('重复运行起始身份冲突');
        }else{
          if(record?.dispatchStatus){next.dispatchStatus=record.dispatchStatus;next.view.status=record.dispatchStatus;next.view.agentName=record.view.agentName;next.view.configurationRevision=record.view.configurationRevision;next.view.startedAt=record.view.startedAt}
          this.put(next);this.live.add(key);record=this.records.get(key)!;
        }
      }else if(!record){this.issue('missing:'+key,'运行事件缺少可核验起始身份，历史索引等待重开回补');return}
      if(record.journal!==source)throw Error('事件来源不一致');
      if(event.seq>record.lastSeq){
        if(event.type==='run.settled'||event.type==='run.interrupted'){
          const next=clone(record);next.lastSeq=event.seq;next.journalSeen=true;
          next.view.status=event.type==='run.interrupted'?'interrupted':['completed','cancelled','failed'].includes(String(event.data.status))?event.data.status as 'completed'|'cancelled'|'failed':'interrupted';
          if(next.dispatchStatus&&terminal(next.dispatchStatus))next.view.status=next.dispatchStatus;
          next.view.updatedAt=date(event.time);this.put(next);this.live.delete(key);
        }else {record.lastSeq=event.seq;record.journalSeen=true}
      }
      const stream=this.streams.get(key);if(stream)this.accept(stream,event,record);
    }catch{this.brokenStreams.add(key);const stream=this.streams.get(key);if(stream)stream.failure=Error('运行事件身份或序号冲突');this.issue('event:'+key,'运行增量无法归档，历史索引可能不完整；原日志仍保留')}
  }
  /** 派发基线含模型启动前已保存的领取意图，不能仅依赖 run.started 才留下失败履历。 */
  restoreDispatch(state:DispatchState){
    if(this.closed)return;
    if(state.workspaceId!==this.workspaceId){this.issue('dispatch','派发历史工作区身份不一致');return}
    for(const graph of state.graphs)for(const task of graph.tasks)this.tasks.set(task.taskId,clone(task));
    for(const run of state.runs??[])this.recordIntent(run);
  }
  /** 任务更新先于同批运行处理；只消费提交事实，不启动任务或确认信封。 */
  dispatchCommitted(mutation:DispatchMutation){
    if(this.closed)return;
    for(const change of mutation.batch?.changes??[])if(change.type==='task.upserted')this.tasks.set(change.task.taskId,clone(change.task));
    for(const run of mutation.runs??[])this.recordIntent(run);
  }
  private recordIntent(run:DispatchRun){
    const b=run.binding,key=runKey(b.taskId,b.runId);
    try{
      const task=this.tasks.get(b.taskId);if(!task||task.identity.workspaceId!==this.workspaceId||task.identity.rootSessionId!==b.rootSessionId||task.assignee.agentId!==b.agentId||task.assignee.agentInstanceId!==b.agentInstanceId||task.assignee.agentSessionId!==b.agentSessionId||run.prepared.agent.agentId!==b.agentId)throw Error('派发运行归属无效');
      const spec:TaskSpec={taskId:task.taskId,workspaceId:this.workspaceId,root:this.root,goal:task.goal,moduleIds:task.modules.map(m=>m.moduleId),agentId:b.agentId,acceptance:task.acceptance.map(a=>a.text)};
      checkedMemberRunBinding(b,spec,b.runId);
      const old=this.records.get(key),record:AgentHistoryRecord={version:1,kind:'task',journal:'member',task:spec,lastSeq:old?.lastSeq??0,journalSeen:old?.journalSeen??false,dispatchStatus:run.status,view:{workspaceId:this.workspaceId,agentId:b.agentId,sessionId:b.agentSessionId,taskId:b.taskId,runId:b.runId,source:'member',binding:'registered',agentName:named(run.prepared.agent.name,b.agentId),goal:spec.goal,moduleIds:[...spec.moduleIds],status:run.status,startedAt:date(run.createdAt),updatedAt:date(run.settledAt??run.startedAt??run.createdAt),agentSessionId:b.agentSessionId,agentInstanceId:b.agentInstanceId,rootSessionId:b.rootSessionId,configurationRevision:run.prepared.agent.knowledgeRevision}};
      this.put(record);
    }catch{this.issue('intent:'+key,'部分成员执行意图无法归档，历史列表可能不完整')}
  }

  async roles(raw:unknown):Promise<AgentHistoryRoles>{
    const input=agentHistoryRolesInput.parse(raw);this.check(input.workspaceId);await this.initialize();
    const result=new Map<string,AgentHistoryRole>(),sessions=new Map<string,Set<string>>();
    for(const {view:v} of this.records.values()){
      let role=result.get(v.agentId);if(!role){role={workspaceId:this.workspaceId,agentId:v.agentId,name:v.agentName,sessionCount:0,runCount:0,updatedAt:v.updatedAt};result.set(v.agentId,role);sessions.set(v.agentId,new Set())}
      role.runCount++;sessions.get(v.agentId)!.add(v.sessionId);if(v.updatedAt>role.updatedAt){role.updatedAt=v.updatedAt;role.name=v.agentName}
    }
    for(const role of result.values())role.sessionCount=sessions.get(role.agentId)!.size;
    return {roles:clone([...result.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.agentId.localeCompare(b.agentId))),diagnostics:this.notices()};
  }
  private page<T>(items:T[],scope:string,cursor:string|undefined,limit:number,key:(value:T)=>string,stamp:(value:T)=>string):AgentHistoryPage<T>{
    let after:{time:string;id:string}|undefined;
    if(cursor)try{const parsed=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));if(parsed.v!==1||parsed.scope!==scope||typeof parsed.time!=='string'||typeof parsed.id!=='string')throw Error();after=parsed}catch{fail('AGENT_HISTORY_CURSOR','分页游标不属于当前 Agent 会话查询')}
    const sorted=items.sort((a,b)=>compare(stamp(b),stamp(a))||compare(key(a),key(b))),available=after?sorted.filter(item=>compare(stamp(item),after!.time)<0||stamp(item)===after!.time&&compare(key(item),after!.id)>0):sorted;
    const selected=available.slice(0,limit),last=selected.at(-1);
    return {items:clone(selected),...(available.length>limit&&last?{nextCursor:Buffer.from(JSON.stringify({v:1,scope,time:stamp(last),id:key(last)})).toString('base64url')}:{ }),diagnostics:this.notices()};
  }
  async sessions(raw:unknown):Promise<AgentHistoryPage<AgentHistorySession>>{
    const input=agentHistorySessionsInput.parse(raw);this.check(input.workspaceId);await this.initialize();
    const found=new Map<string,AgentHistorySession>();
    for(const {view:v,kind} of this.records.values())if(v.agentId===input.agentId){
      let session=found.get(v.sessionId);
      if(!session){session={workspaceId:this.workspaceId,agentId:v.agentId,sessionId:v.sessionId,kind,title:v.goal.slice(0,200),agentName:v.agentName,runCount:0,status:v.status,startedAt:v.startedAt,updatedAt:v.updatedAt,...(v.agentSessionId?{agentSessionId:v.agentSessionId,agentInstanceId:v.agentInstanceId,rootSessionId:v.rootSessionId}:{})};found.set(v.sessionId,session)}
      session.runCount++;if(v.startedAt<session.startedAt){session.startedAt=v.startedAt;session.title=v.goal.slice(0,200)}
      if(v.updatedAt>=session.updatedAt){session.updatedAt=v.updatedAt;session.status=v.status;session.agentName=v.agentName}
    }
    return this.page([...found.values()],JSON.stringify(['sessions',this.workspaceId,input.agentId]),input.cursor,input.limit,s=>s.sessionId,s=>s.startedAt);
  }
  async runs(raw:unknown):Promise<AgentHistoryPage<AgentHistoryRun>>{
    const input=agentHistoryRunsInput.parse(raw);this.check(input.workspaceId);await this.initialize();
    const matches=[...this.records.values()].map(r=>r.view).filter(v=>v.agentId===input.agentId&&v.sessionId===input.sessionId);
    if(!matches.length)fail('AGENT_HISTORY_NOT_FOUND','当前 Agent 没有此历史会话');
    return this.page(matches,JSON.stringify(['runs',this.workspaceId,input.agentId,input.sessionId]),input.cursor,input.limit,r=>runKey(r.taskId,r.runId),r=>r.startedAt);
  }
  private accept(stream:EventStream,event:StoredEvent,record:AgentHistoryRecord){
    if(stream.failure)throw stream.failure;
    if(event.workspaceId!==this.workspaceId||event.taskId!==record.view.taskId||event.runId!==record.view.runId||!Number.isSafeInteger(event.seq)||event.seq<1)throw Error('历史事件归属无效');
    const projected=projectRunEvent(event,record.view,record.task),existing=stream.events[event.seq-1]??stream.pending.get(event.seq);
    if(existing){if(JSON.stringify(existing)!==JSON.stringify(projected))throw Error('历史事件序号冲突');return}
    stream.pending.set(event.seq,projected);
    while(stream.pending.has(stream.events.length+1)){
      const next=stream.pending.get(stream.events.length+1)!;stream.pending.delete(next.seq);stream.events.push(next);
      if(next.type==='tool.allowed')stream.unresolved.add(String(next.data.id));
      if(next.type==='tool.finished'||next.type==='tool.denied')stream.unresolved.delete(String(next.data.id));
      if(next.type==='task.updated'&&next.data.progress)stream.progress=next.data.progress as MemberRunView['taskProgress'];
    }
  }
  private async loadStream(stream:EventStream,record:AgentHistoryRecord){
    try{
      const summary=await this.ports.read(clone(record)),classified=this.fromStart(summary.events[0],record.journal);
      if(!classified||classified.view.agentId!==record.view.agentId||classified.view.sessionId!==record.view.sessionId||classified.view.agentInstanceId!==record.view.agentInstanceId||summary.runId!==record.view.runId)throw Error('运行详情归属不一致');
      for(const event of summary.events)this.accept(stream,event,record);
      if(stream.pending.size)throw Error('运行详情存在事件缺口');
      stream.loaded=true;
    }catch(error){
      if((error as {code?:string}).code==='ENOENT'&&!record.journalSeen&&record.journal==='member'){stream.loaded=true;return}
      this.issue('details:'+runKey(record.view.taskId,record.view.runId),'部分运行详情无法读取或身份不一致，原记录需要核实');
      fail('AGENT_HISTORY_UNREADABLE','运行详情无法读取或身份不一致，请核实本机运行记录');
    }
  }
  /** 只恢复用户打开的运行；分页只读增量，LRU 淘汰已加载的非活动详情，加载中/活动流暂时保留避免丢增量。 */
  async events(raw:unknown):Promise<AgentHistoryEventsRead>{
    const input=agentHistoryEventsInput.parse(raw);this.check(input.workspaceId);await this.initialize();
    if(input.cursor&&input.cursor.runId!==input.runId)fail('AGENT_HISTORY_CURSOR','事件游标属于其他运行');
    const key=runKey(input.taskId,input.runId),record=this.records.get(key);
    if(!record||record.view.agentId!==input.agentId||record.view.sessionId!==input.sessionId)fail('AGENT_HISTORY_NOT_FOUND','当前 Agent 会话没有此运行');
    if(this.brokenStreams.has(key))fail('AGENT_HISTORY_UNREADABLE','运行事件存在身份或序号冲突，请重新打开工作区核实原始记录');
    let stream=this.streams.get(key);if(!stream){stream={events:[],pending:new Map(),unresolved:new Set(),loaded:false};this.streams.set(key,stream)}
    else {this.streams.delete(key);this.streams.set(key,stream)}
    for(const [oldest,value] of this.streams){if(this.streams.size<=24)break;if(oldest!==key&&value.loaded&&!this.live.has(oldest))this.streams.delete(oldest)}
    const loading=stream.loading??=this.loadStream(stream,record);
    try{await loading}catch(error){if(stream.loading===loading)stream.loading=undefined;throw error}
    if(stream.failure||stream.pending.size)fail('AGENT_HISTORY_UNREADABLE','运行事件不连续，请核实历史记录');
    this.check(input.workspaceId);
    const current=this.records.get(key)!;
    const run:MemberRunView={task:clone(current.task),runId:current.view.runId,status:current.view.status==='starting'?'running':current.view.status,acceptance:'not_evaluated',unresolvedTools:[...stream.unresolved],...(stream.progress?{taskProgress:stream.progress}:{} )};
    const reset=!input.cursor||input.cursor.seq>stream.events.length,from=reset?0:input.cursor!.seq,events=stream.events.slice(from,from+input.limit),cursor={runId:input.runId,seq:from+events.length};
    return clone(!reset&&!events.length?{mode:'noop',run,cursor}:{mode:reset?'reset':'delta',run,cursor,events,hasMore:cursor.seq<stream.events.length});
  }
  /** 已停止观察后等待全部派生索引写入；写失败保留诊断，不向执行链回抛。 */
  async close(){this.closed=true;await this.pending;this.streams.clear()}
  /** 打开流程结束时排空恢复索引；列表查询本身不触发 canonical 扫描。 */
  async flush(){await this.pending}
}
