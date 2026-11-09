/**
 * 作用定位：维护整个应用的成员、派发任务、目标周期与实际 Loop 消耗索引，接收 main 的可靠提交；周期结算独立于模型轮次，成员运行不重复生成任务。
 * 设计原因：主会话活动按可信实例绑定投影；安全停泊计等待压力而非活动运行，周期释放后保留历史但退出当前压力。运行身份和事件序号避免重复计费，观察不代替生命周期管理。
 * 职责边界：不读取文件、不启动引擎、不调度跨工作区任务；待消费负载只计 pending 信封，任何快照都不包含消息、知识或工具正文。
 */
import {randomUUID} from 'node:crypto';
import type {RunSummary,StoredEvent,TaskSpec} from '../../core/brain/types';
import {checkedMemberRunBinding} from '../../core/brain/member-run';
import {checkedConversationAgentBinding} from '../../core/brain/conversation-binding';
import {runUsage} from '../../core/brain/usage';
import {projectRuntimeScope} from '../../core/runtime/runtime-scope';
import type {DispatchMutation,DispatchState} from '../../core/tasks/dispatch-storage';
import type {TaskNode} from '../../core/tasks/graph-types';
import type {AgentInstance} from '../../core/team/agent-types';
import type {RuntimeCursor,RuntimeDispatchTask,RuntimeLoopTask,RuntimeMember,RuntimePressure,RuntimeQueueCounts,RuntimeRead,RuntimeRun,RuntimeScope,RuntimeSnapshot,RuntimeUsage,RuntimeWorkspace} from '../../core/runtime/types';

interface ObservedRun {
  view:RuntimeRun;moduleIds:string[];measurements:StoredEvent[];
  /** 本接入代际实际观察过 run.started，区别于只有历史日志的恢复记录。 */
  liveEstablished:boolean;
  /** 忽略 UI 不关心的流式片段时也推进接收序号，保证后续事实仍能检查顺序。 */
  receivedSeq:number;
}
interface WorkspaceIndex {
  view:RuntimeWorkspace;members:Map<string,RuntimeMember>;tasks:Map<string,RuntimeDispatchTask>;
  /** 按持久插入顺序保存周期白名单；覆盖既有项不改次序，不按时间或最近运行猜归属。 */
  scopes:Map<string,RuntimeScope>;
  runs:Map<string,ObservedRun>;outbox:Set<string>;graphSequences:Map<string,{streamId:string;seq:number}>;
}
const clone=<T>(value:T):T=>structuredClone(value);
const key=(...parts:string[])=>JSON.stringify(parts);
const count=(value:number)=>Number.isSafeInteger(value)&&value>=0;
const record=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const statuses=new Set(['running','completed','cancelled','failed','interrupted']);

/** 只保留数值和计价依据，不把供应商自定义字段、文本或密钥复制到全局缓存。 */
function measurement(event:StoredEvent):StoredEvent|undefined {
  const data=event.data??{},next:Record<string,unknown>={};
  if(event.type==='message'){
    const usage=record(data.usage),safe:Record<string,unknown>={};
    if(usage){
      for(const field of ['input','output','cacheRead','cacheWrite','reasoning'])if(finite(usage[field]))safe[field]=usage[field];
      const price=record(usage.cost);
      if(price){const cost:Record<string,unknown>={};if(finite(price.total))cost.total=price.total;if(price.totalFromProvider===true)cost.totalFromProvider=true;safe.cost=cost}
      next.usage=safe;
    }
    if(typeof data.pricingKnown==='boolean')next.pricingKnown=data.pricingKnown;
  }else if(event.type==='engine.status'&&data.metric==='run-usage'){
    const tokens=record(data.tokens),safe:Record<string,unknown>={};
    if(tokens)for(const field of ['input','output','cacheRead','cacheWrite','reasoning'])if(finite(tokens[field]))safe[field]=tokens[field];
    next.metric='run-usage';next.tokens=safe;
    if(finite(data.cost))next.cost=data.cost;
    if(typeof data.pricingKnown==='boolean')next.pricingKnown=data.pricingKnown;
    if(data.totalFromProvider===true)next.totalFromProvider=true;
  }else return;
  return {version:1,workspaceId:event.workspaceId,taskId:event.taskId,runId:event.runId,seq:event.seq,time:event.time,type:event.type,data:next};
}

/** 单个应用实例持有一个管理器；所有写入均为同步投影，不等待 I/O，也不代替权威日志。 */
export class GlobalRuntimeManager {
  private readonly streamId=randomUUID();
  private revision=0;
  private nextEpoch=0;
  private readonly workspaces=new Map<string,WorkspaceIndex>();
  private changed(){this.revision++}
  private current(id:string,epoch:number){const state=this.workspaces.get(id);return state?.view.epoch===epoch&&state.view.availability!=='closed'?state:undefined}
  private cursor():RuntimeCursor{return {streamId:this.streamId,revision:this.revision}}

  /** 开始接管工作区投影；旧代际即刻失效，恢复期间的数据完整性明确标为 loading。 */
  begin(workspaceId:string,name:string):number {
    const epoch=++this.nextEpoch;
    this.workspaces.set(workspaceId,{view:{workspaceId,name,epoch,availability:'loading',issues:[],queue:{pending:0,paused:0,inserting:0}},members:new Map(),tasks:new Map(),scopes:new Map(),runs:new Map(),outbox:new Set(),graphSequences:new Map()});
    this.changed();return epoch;
  }
  /** 仅装配方在派发、历史运行和排队恢复完成后调用；有 issues 时快照仍标记不完整。 */
  ready(id:string,epoch:number){const state=this.current(id,epoch);if(state&&state.view.availability!=='ready'){state.view.availability='ready';this.changed()}}
  /** 项目重命名仅更新显示名，不改变工作区身份、接入代际或执行归属。 */
  rename(id:string,name:string){const state=this.workspaces.get(id);if(state&&state.view.name!==name){state.view.name=name;this.changed()}}
  unavailable(id:string,epoch:number,error:string){const state=this.current(id,epoch);if(!state)return;this.issue(id,epoch,'workspace',error);if(state.view.availability!=='unavailable'){state.view.availability='unavailable';this.interrupt(state);this.changed()}}
  /** 关闭后保留已知消费及任务记录，但不能再把历史运行或成员计为活跃。 */
  detach(id:string,epoch:number){const state=this.current(id,epoch);if(!state)return;state.view.availability='closed';this.interrupt(state);this.changed()}
  forget(id:string){if(this.workspaces.delete(id))this.changed()}
  private interrupt(state:WorkspaceIndex){for(const run of state.runs.values())if(run.view.status==='running'){run.view.status='interrupted';run.view.phase='settled'}}

  /** 诊断为可信装配层的简短说明；调用方不得传原始异常堆栈、绝对路径或工具正文。 */
  issue(id:string,epoch:number,source:string,message:string){
    const state=this.current(id,epoch);if(!state||state.view.issues.some(i=>i.source===source&&i.message===message))return;
    state.view.issues.push({source,message});if(state.view.issues.length>100)state.view.issues.shift();this.changed();
  }
  /** 首次恢复基线，不用于定时回读；旧记录没有周期时保持空集，恢复等待也不代表重新启动模型。 */
  restoreDispatch(id:string,epoch:number,baseline:DispatchState){
    const state=this.current(id,epoch);if(!state)return;
    if(baseline.workspaceId!==id)throw Error('全局监管收到其他工作区的派发记录');
    const members=new Map<string,RuntimeMember>(),tasks=new Map<string,RuntimeDispatchTask>(),sequences=new Map<string,{streamId:string;seq:number}>();
    for(const member of baseline.members){if(member.workspaceId!==id)throw Error('成员身份与工作区不一致');members.set(member.agentInstanceId,this.member(member,false))}
    for(const graph of baseline.graphs){
      if(graph.identity.workspaceId!==id)throw Error('派发图身份与工作区不一致');
      sequences.set(graph.identity.rootSessionId,{streamId:graph.cursor.streamId,seq:graph.cursor.seq});
      for(const task of graph.tasks)tasks.set(key(task.identity.rootSessionId,task.taskId),this.task(task));
    }
    const scopes=this.projectScopes(id,sequences,new Map(),baseline.scopes??[]);
    state.members=members;state.tasks=tasks;state.scopes=scopes;state.graphSequences=sequences;state.outbox=new Set(baseline.outbox.filter(m=>m.delivery==='pending').map(m=>m.messageId));this.changed();
  }
  /** 同工作区提交由 store 同步串行通知；scope-only 也更新全局版本，不借用图序号或目标版本，不读取日志。 */
  dispatchCommitted(id:string,epoch:number,mutation:DispatchMutation){
    const state=this.current(id,epoch);if(!state)return;
    const batch=mutation.batch;
    if((mutation.members??[]).some(m=>m.workspaceId!==id)||batch&&batch.identity.workspaceId!==id)throw Error('提交身份与监管工作区不一致');
    if((mutation.messages??[]).some(m=>m.identity.workspaceId!==id))throw Error('信封身份与监管工作区不一致');
    if(batch?.changes.some(change=>change.type==='task.upserted'&&(change.task.identity.workspaceId!==id||change.task.identity.rootSessionId!==batch.identity.rootSessionId)))throw Error('任务身份与提交不一致');
    if(batch){const previous=state.graphSequences.get(batch.identity.rootSessionId);if(previous?.streamId===batch.streamId&&batch.seq<=previous.seq)return;if(previous&&(previous.streamId!==batch.streamId||batch.seq!==previous.seq+1)){this.issue(id,epoch,'dispatch','派发事件游标不连续，需要重新载入');return}}
    // 先准备整批周期候选；身份错误不能留下半次成员/任务/周期投影。新图与周期允许在同次提交建立。
    let scopes=state.scopes;
    if(mutation.scopes?.length){const roots=new Map(state.graphSequences);if(batch)roots.set(batch.identity.rootSessionId,{streamId:batch.streamId,seq:batch.seq});scopes=this.projectScopes(id,roots,state.scopes,mutation.scopes)}
    let changed=false;
    for(const member of mutation.members??[]){const view=this.member(member,true),old=state.members.get(member.agentInstanceId);if(JSON.stringify(old)!==JSON.stringify(view)){state.members.set(member.agentInstanceId,view);changed=true}}
    if(batch){
      for(const change of batch.changes)if(change.type==='task.upserted'){
        state.tasks.set(key(change.task.identity.rootSessionId,change.task.taskId),this.task(change.task));changed=true;
      }
      state.graphSequences.set(batch.identity.rootSessionId,{streamId:batch.streamId,seq:batch.seq});
    }
    // 邮箱保留已领取/处理信封作为审计，但这些记录不再占待消费负载。
    for(const message of mutation.messages??[]){
      if(message.delivery==='pending'){if(!state.outbox.has(message.messageId)){state.outbox.add(message.messageId);changed=true}}
      else if(state.outbox.delete(message.messageId))changed=true;
    }
    for(const scope of mutation.scopes??[]){const next=scopes.get(scope.scopeId)!;if(JSON.stringify(state.scopes.get(scope.scopeId))!==JSON.stringify(next)){state.scopes.set(scope.scopeId,next);changed=true}}
    if(changed)this.changed();
  }
  /** 只接受明确属于现有/同事务新建根的周期；不能用同 scope ID 改写主会话归属。 */
  private projectScopes(id:string,roots:ReadonlyMap<string,unknown>,previous:ReadonlyMap<string,RuntimeScope>,updates:NonNullable<DispatchState['scopes']>):Map<string,RuntimeScope>{
    if(!Array.isArray(updates)||new Set(updates.map(scope=>scope?.scopeId)).size!==updates.length)throw Error('周期提交集合无效或身份重复');
    const next=new Map(previous);
    for(const scope of updates){
      const value=projectRuntimeScope(scope),old=previous.get(value.scopeId);
      if(value.workspaceId!==id||!roots.has(value.rootSessionId)||old&&old.rootSessionId!==value.rootSessionId)throw Error('周期身份与监管工作区或主会话不一致');
      next.set(value.scopeId,value);
    }
    const open=new Set<string>();
    for(const scope of next.values())if(scope.status!=='closed'){if(open.has(scope.rootSessionId))throw Error('同一主会话不能有多个未关闭周期');open.add(scope.rootSessionId)}
    return next;
  }
  private member(value:AgentInstance,current:boolean):RuntimeMember {
    return {workspaceId:value.workspaceId,teamId:value.teamId,agentId:value.agentId,agentInstanceId:value.agentInstanceId,leaseEpoch:value.leaseEpoch,...(value.mainRootSessionId?{mainRootSessionId:value.mainRootSessionId}:{}),...(value.executionScopeId?{executionScopeId:value.executionScopeId,executionTaskId:value.executionTaskId}:{}),...(value.lifecycle?{lifecycle:value.lifecycle,releasedAt:value.releasedAt}:{}),activity:value.activity,activityCurrent:current&&value.lifecycle!=='released',availability:'loading',sessionCount:value.agentSessionIds.length,activeTaskId:value.activeTaskId,activeRunId:value.activeRunId,waitingTaskIds:[...value.waitingTaskIds],communicatingMessageIds:[...value.communicatingMessageIds]};
  }
  private task(value:TaskNode):RuntimeDispatchTask {
    return {source:'dispatch',binding:'instance',workspaceId:value.identity.workspaceId,rootSessionId:value.identity.rootSessionId,taskId:value.taskId,...(value.scopeId?{scopeId:value.scopeId}:{}),agentId:value.assignee.agentId,agentInstanceId:value.assignee.agentInstanceId,moduleIds:value.modules.map(m=>m.moduleId),status:value.status,revision:value.revision,planRevision:value.planRevision,runIds:[...value.runIds],updatedAt:value.updatedAt};
  }

  /** 恢复可信 RunSummary；重复恢复相同轮次不累计消费，历史 running 强制降为 interrupted。 */
  restoreRun(id:string,epoch:number,summary:RunSummary){
    const state=this.current(id,epoch);if(!state)return;
    if(summary.task.workspaceId!==id)throw Error('运行身份与监管工作区不一致');
    if(!statuses.has(summary.status)||!Array.isArray(summary.events))throw Error('恢复运行的状态或事件列表无效');
    const runKey=key(summary.task.taskId,summary.runId),existing=state.runs.get(runKey);
    const last=summary.events.at(-1)?.seq??0;
    // 已接收的实时事实优先，延迟恢复不能把活跃 run 覆盖成历史状态。
    if(existing&&existing.receivedSeq>=last)return;
    const started=summary.events.find(event=>event.type==='run.started')?.data,recorded=started?.memberBinding,conversation=started?.conversationBinding;
    const value=this.newRun(summary.task,summary.runId,summary.events[0]?.time??'',summary.memberBinding??recorded,summary.conversationBinding??conversation);
    if(recorded!==undefined){
      const checked=checkedMemberRunBinding(recorded,summary.task,summary.runId);
      if(!value.view.memberBinding||Object.entries(checked).some(([field,data])=>value.view.memberBinding![field as keyof typeof checked]!==data))throw Error('恢复摘要与运行起始成员身份不一致');
    }
    if(conversation!==undefined){
      const checked=checkedConversationAgentBinding(conversation,summary.task);
      if(!value.view.conversationBinding||Object.entries(checked).some(([field,data])=>value.view.conversationBinding![field as keyof typeof checked]!==data))throw Error('恢复摘要与运行起始主会话身份不一致');
    }
    for(const event of summary.events){
      if(event.workspaceId!==id||event.taskId!==summary.task.taskId||event.runId!==summary.runId||event.seq!==value.receivedSeq+1)throw Error('恢复运行的身份或事件顺序无效');
      value.receivedSeq=event.seq;const item=measurement(event);if(item)value.measurements.push(item);
    }
    value.view.lastSeq=value.receivedSeq;value.view.updatedAt=summary.events.at(-1)?.time??value.view.updatedAt;
    value.view.status=summary.status==='running'?'interrupted':summary.status;value.view.phase='settled';value.view.usage=runUsage(value.measurements);
    value.liveEstablished=existing?.liveEstablished??false;
    // 日志读取可能与已接入的实时回调交错；无终态日志的默认 interrupted 不能抹掉本代际的运行事实。
    if(value.liveEstablished&&!summary.events.some(e=>e.type==='run.settled'||e.type==='run.interrupted')){
      value.view.status=existing!.view.status;value.view.phase=existing!.view.phase;
      for(const event of summary.events)this.phase(value,event);
    }
    state.runs.set(runKey,value);this.changed();
  }
  /** 已落盘事件按 workspace/task/run/seq 去重；只接收有明确 run.started 身份的运行。 */
  runEvent(id:string,epoch:number,event:StoredEvent){
    const state=this.current(id,epoch);if(!state)return;
    if(event.workspaceId!==id)throw Error('运行事件属于其他工作区');
    if(!Number.isSafeInteger(event.seq)||event.seq<1)throw Error('运行事件序号无效');
    const runKey=key(event.taskId,event.runId);let run=state.runs.get(runKey);
    if(!run){
      const task=event.data?.task as TaskSpec|undefined;
      if(event.type!=='run.started'||event.seq!==1||task?.workspaceId!==id||task.taskId!==event.taskId){this.issue(id,epoch,'run','运行缺少起始身份事件，需要重新载入');return}
      run=this.newRun(task,event.runId,event.time,event.data?.memberBinding,event.data?.conversationBinding);state.runs.set(runKey,run);
      run.liveEstablished=true;
    }
    if(event.seq<=run.receivedSeq)return;
    if(event.seq!==run.receivedSeq+1)this.issue(id,epoch,'run','运行事件序号有缺口，当前统计可能不完整');
    run.receivedSeq=event.seq;
    const item=measurement(event);let changed=event.type==='run.started';
    if(item){run.measurements.push(item);run.view.usage=runUsage(run.measurements);changed=true}
    const phase=run.view.phase,status=run.view.status;this.phase(run,event);
    changed||=phase!==run.view.phase||status!==run.view.status;
    if(changed){run.view.lastSeq=event.seq;run.view.updatedAt=event.time;this.changed()}
  }
  private phase(run:ObservedRun,event:StoredEvent){
    if(event.type==='run.settled'){run.view.status=statuses.has(String(event.data.status))&&event.data.status!=='running'?event.data.status as RuntimeRun['status']:'interrupted';run.view.phase='settled'}
    else if(event.type==='run.interrupted'){run.view.status='interrupted';run.view.phase='settled'}
    else if(run.view.status==='running'){
      if(event.type==='run.stop_requested')run.view.phase='stopping';
      else if(event.type==='tool.proposed')run.view.phase='waiting';
      else if(event.type==='tool.started'||event.type==='tool.allowed')run.view.phase='tool';
      else if(event.type==='tool.finished'||event.type==='tool.denied'||event.type==='message')run.view.phase='working';
    }
  }
  /** 两种运行绑定互斥；主会话与正式成员任务共享实例但保留各自通道，旧对话不猜映射。 */
  private newRun(task:TaskSpec,runId:string,time:string,memberBinding?:unknown,conversationBinding?:unknown):ObservedRun {
    if(!task||typeof task!=='object'||typeof task.workspaceId!=='string'||!task.workspaceId||typeof task.taskId!=='string'||!task.taskId||typeof runId!=='string'||!runId||!Array.isArray(task.moduleIds)||task.moduleIds.some(id=>typeof id!=='string')||task.agentId!==undefined&&typeof task.agentId!=='string')throw Error('运行任务概要无效');
    if(memberBinding!==undefined&&conversationBinding!==undefined)throw Error('运行不能同时绑定主会话和派发成员任务');
    const binding=memberBinding===undefined?undefined:checkedMemberRunBinding(memberBinding,task,runId),conversation=conversationBinding===undefined?undefined:checkedConversationAgentBinding(conversationBinding,task);
    return {view:{workspaceId:task.workspaceId,taskId:task.taskId,runId,agentId:task.agentId,...(binding?{memberBinding:binding}:{}),...(conversation?{conversationBinding:conversation}:{}),status:'running',phase:'working',lastSeq:0,startedAt:time,updatedAt:time,usage:runUsage([])},moduleIds:[...task.moduleIds],measurements:[],receivedSeq:0,liveEstablished:false};
  }
  /** 队列变化后由唯一队列实例报告，重复计数不推进全局版本。 */
  queue(id:string,epoch:number,counts:RuntimeQueueCounts){
    const state=this.current(id,epoch);if(!state)return;
    if(!count(counts.pending)||!count(counts.paused)||!count(counts.inserting))throw Error('队列统计必须是非负整数');
    if(JSON.stringify(state.view.queue)!==JSON.stringify(counts)){state.view.queue={pending:counts.pending,paused:counts.paused,inserting:counts.inserting};this.changed()}
  }
  /** 无变化时只返回游标；不扫描磁盘，也不重建完整快照。 */
  read(cursor?:RuntimeCursor):RuntimeRead {
    const current=this.cursor();if(cursor?.streamId===current.streamId&&cursor.revision===current.revision)return {mode:'noop',cursor:current};
    return {mode:'snapshot',cursor:current,snapshot:this.snapshot()};
  }
  /** 汇总只读副本；多个工作区使用相同任务/运行字符串也不会相互覆盖。 */
  snapshot():RuntimeSnapshot {
    const workspaces:RuntimeWorkspace[]=[],members:RuntimeMember[]=[],tasks:Array<RuntimeDispatchTask|RuntimeLoopTask>=[],runs:RuntimeRun[]=[],scopes:RuntimeScope[]=[];
    const pressure:RuntimePressure={taskInstances:0,memberInstances:0,openWorkspaces:0,unavailableWorkspaces:0,activeMembers:0,workingMembers:0,waitingMembers:0,communicatingMembers:0,activeRuns:0,queuedDispatchTasks:0,waitingDispatchTasks:0,blockedDispatchTasks:0,pendingOutbox:0,queuedConversationMessages:0,pausedConversationMessages:0,insertingConversationMessages:0};
    for(const state of this.workspaces.values()){
      const availability=state.view.availability;workspaces.push(clone(state.view));scopes.push(...state.scopes.values());
      if(availability==='ready')pressure.openWorkspaces++;if(availability==='unavailable')pressure.unavailableWorkspaces++;
      // 仅真实起始事件能证明当前活动；历史恢复、同名角色和已关闭工作区不能制造活跃实例。
      const conversations=new Map<string,RuntimeRun>();
      if(availability==='ready')for(const run of state.runs.values())if(run.liveEstablished&&run.view.status==='running'&&run.view.conversationBinding){
        const binding=run.view.conversationBinding,member=state.members.get(binding.agentInstanceId);
        if(member?.lifecycle!=='released'&&member?.agentId===binding.agentId&&member.teamId===binding.teamId&&(!member.mainRootSessionId||member.mainRootSessionId===binding.rootSessionId))conversations.set(binding.agentInstanceId,run.view);
      }
      for(const member of state.members.values()){
        const view:RuntimeMember={...member,availability,activityCurrent:member.activityCurrent&&availability==='ready'},conversation=conversations.get(member.agentInstanceId);
        if(conversation){const binding=conversation.conversationBinding!;view.activity=conversation.phase==='waiting'?'waiting':'working';view.activityCurrent=true;view.activeConversation={rootSessionId:binding.rootSessionId,agentSessionId:binding.agentSessionId,runId:conversation.runId}}
        members.push(view);
        if(view.lifecycle!=='released')pressure.memberInstances++;
        if(view.activityCurrent&&view.activity!=='idle'){pressure.activeMembers++;if(view.activity==='working')pressure.workingMembers++;if(view.activity==='waiting')pressure.waitingMembers++;if(view.activity==='communicating')pressure.communicatingMembers++}
      }
      for(const task of state.tasks.values()){
        // 安全停泊仍是未完任务，但没有活动运行或执行槽；将其计入等待压力，避免监管视图漏掉待主调度安排的工作。
        tasks.push(task);if(state.members.get(task.agentInstanceId)?.lifecycle!=='released'){if(task.status==='queued')pressure.queuedDispatchTasks++;if(task.status==='waiting'||task.status==='checkpointed')pressure.waitingDispatchTasks++;if(task.status==='blocked')pressure.blockedDispatchTasks++}
      }
      const groups=new Map<string,ObservedRun[]>();
      for(const run of state.runs.values()){
        runs.push(run.view);
        // 成员轮次已经归属上方派发业务节点，只累计实际运行/消耗，不合成第二份 Loop 任务。
        if(!run.view.memberBinding){const group=groups.get(run.view.taskId)??[];group.push(run);groups.set(run.view.taskId,group)}
        const instanceId=run.view.memberBinding?.agentInstanceId??run.view.conversationBinding?.agentInstanceId;
        if(run.view.status==='running'&&availability==='ready'&&(!instanceId||state.members.get(instanceId)?.lifecycle!=='released'))pressure.activeRuns++;
      }
      for(const group of groups.values()){
        group.sort((a,b)=>(a.view.startedAt??'').localeCompare(b.view.startedAt??'')||a.view.runId.localeCompare(b.view.runId));
        const latest=group.at(-1)!,active=group.filter(r=>r.view.status==='running');
        const binding=latest.view.conversationBinding;
        tasks.push({source:'loop',...(binding?{binding:'instance' as const,agentInstanceId:binding.agentInstanceId,agentSessionId:binding.agentSessionId,rootSessionId:binding.rootSessionId}:{binding:'role-only' as const}),workspaceId:state.view.workspaceId,taskId:latest.view.taskId,agentId:latest.view.agentId,moduleIds:latest.moduleIds,status:active.length?'running':latest.view.status,runIds:group.map(r=>r.view.runId),activeRunIds:active.map(r=>r.view.runId),lastRunId:latest.view.runId,updatedAt:latest.view.updatedAt});
      }
      pressure.pendingOutbox+=state.outbox.size;pressure.queuedConversationMessages+=state.view.queue.pending;pressure.pausedConversationMessages+=state.view.queue.paused;pressure.insertingConversationMessages+=state.view.queue.inserting;
    }
    pressure.taskInstances=tasks.length;
    const usage:RuntimeUsage={input:0,output:0,cacheRead:0,cacheWrite:0,reasoning:0,total:0,costPartial:false,usageReported:false,runCount:runs.length,reportedRuns:0,unreportedRuns:0,unpricedRuns:0};
    for(const run of runs){
      const value=run.usage;for(const field of ['input','output','cacheRead','cacheWrite','reasoning','total'] as const)usage[field]+=value[field];
      if(value.usageReported){usage.reportedRuns++;usage.usageReported=true;if(value.cost===undefined||value.costPartial)usage.unpricedRuns++}else usage.unreportedRuns++;
      if(value.cost!==undefined)usage.cost=(usage.cost??0)+value.cost;
      usage.costPartial||=value.costPartial||!value.usageReported;
    }
    return clone({cursor:this.cursor(),workspaces,members,tasks,runs,scopes,pressure,usage,complete:workspaces.every(w=>(w.availability==='ready'||w.availability==='closed')&&!w.issues.length)});
  }
}
