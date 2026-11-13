/**
 * 成员停泊计数按最新段是否消费确定，旧已消费预约不把正在运行的后段计入停泊。
 * 作用定位：将负责人控制面接到同一派发事务，重算关联任务影响并核实真实主运行来源。
 * 设计原因：单条审计仅可附预先核验的对应来源捕获，不能夹带执行变化；重放使用当时前缀，旧任务不猜岗位身份。
 */
import {fail} from '../../../core/errors';
import {isMemberCheckpointPending} from './member-checkpoint';
import {hash} from '../../../core/platform/node/serialization';
import {applyModuleOwnershipChange,moduleOwnershipCanonical,moduleOwnershipCommand,moduleOwnershipReceipt} from '../../workspace/rules/module-ownership-rules';
import {moduleOwnershipActorSchema,type ModuleOwnership,type ModuleOwnershipActor,type ModuleOwnershipChange,type ModuleOwnershipCursor,type ModuleOwnershipImpact} from '../../workspace/rules/module-ownership';
import type {DispatchState,DispatchMutation,DispatchCommand} from '../../dispatch/rules/dispatch-storage';
import type {KnowledgeSourceCapturePermit} from './knowledge-source-invariants';

/** 本地 actor 由 IPC 注入；主 actor 还须属于当前活动周期最后登记的主运行与原 conversation 通道。 */
export function checkModuleOwnershipActor(state:DispatchState,actor:ModuleOwnershipActor):void{
  const check=(condition:unknown,message:string)=>{if(!condition)fail('OWNERSHIP_ACTOR',message)};
  check(moduleOwnershipActorSchema.safeParse(actor).success,'责任来源格式无效');
  if(actor.kind==='local_desktop')return;
  const scope=state.scopes?.find(item=>item.scopeId===actor.scopeId),graph=state.graphs.find(item=>item.identity.rootSessionId===actor.rootSessionId);
  const member=state.members.find(item=>item.agentInstanceId===actor.agentInstanceId),session=state.sessions.find(item=>item.agentSessionId===actor.agentSessionId);
  check(scope&&scope.workspaceId===state.workspaceId&&scope.rootSessionId===actor.rootSessionId&&scope.status==='active'&&scope.runTracking?.mainRunIds.at(-1)===actor.runId,'主责任操作缺少当前周期运行');
  check(graph?.identity.workspaceId===state.workspaceId&&graph.root.agent.agentId==='cbim:main'&&graph.root.agent.agentInstanceId===actor.agentInstanceId&&member?.workspaceId===state.workspaceId&&member.agentId==='cbim:main'&&member.lifecycle!=='released'&&(member.mainRootSessionId===undefined||member.mainRootSessionId===actor.rootSessionId),'主责任操作不属于真实主实例');
  check(session?.workspaceId===state.workspaceId&&session.agentId==='cbim:main'&&session.agentInstanceId===actor.agentInstanceId&&session.rootSessionId===actor.rootSessionId&&session.purpose==='conversation'&&member?.agentSessionIds.includes(actor.agentSessionId),'主责任操作缺少真实对话通道');
}

/** 完整相关事实进入 digest，只输出计数；领取/结算/检查点变化会失效预览，不披露任务正文或原生路径。 */
export function moduleOwnershipImpact(state:DispatchState,moduleId:string):ModuleOwnershipImpact{
  const counts={unclaimed:0,inFlight:0,checkpointed:0,terminal:0,other:0};
  const rows=state.graphs.flatMap(graph=>graph.tasks.filter(task=>task.modules.some(module=>module.moduleId===moduleId)).map(task=>{
    const runs=(state.runs??[]).filter(run=>run.binding.rootSessionId===graph.identity.rootSessionId&&run.binding.taskId===task.taskId).map(run=>({binding:run.binding,status:run.status,assignmentMessageId:run.assignmentMessageId,createdAt:run.createdAt,startedAt:run.startedAt,settledAt:run.settledAt}));
    const assignments=state.outbox.filter(message=>message.kind==='assignment'&&message.identity.rootSessionId===graph.identity.rootSessionId&&message.taskId===task.taskId).map(message=>({messageId:message.messageId,delivery:message.delivery,claim:message.claim}));
    if(task.activeRunId||runs.some(run=>run.status==='starting'||run.status==='running'))counts.inFlight++;
    else if(isMemberCheckpointPending(task))counts.checkpointed++;
    else if(['planned','queued','waiting'].includes(task.status)&&!task.runIds.length&&!assignments.some(item=>item.claim))counts.unclaimed++;
    else if(['result_ready','failed','cancelled','interrupted'].includes(task.status))counts.terminal++;
    else counts.other++;
    return {identity:graph.identity,task,runs:runs.sort((a,b)=>a.binding.runId.localeCompare(b.binding.runId)),assignments:assignments.sort((a,b)=>a.messageId.localeCompare(b.messageId))};
  })).sort((a,b)=>a.identity.rootSessionId.localeCompare(b.identity.rootSessionId)||a.task.taskId.localeCompare(b.task.taskId));
  return {coverage:'dispatch_graph_tasks_with_module',total:rows.length,counts,digest:hash(moduleOwnershipCanonical({workspaceId:state.workspaceId,moduleId,rows}))};
}

/** 责任 mutation 只许一条审计及其回执；最终投影由原事件重算，不能直接 upsert 头或混入任务。 */
export function projectModuleOwnershipMutation(previous:DispatchState,mutation:DispatchMutation,command:DispatchCommand,sourcePermit?:KnowledgeSourceCapturePermit):{moduleOwnerships:ModuleOwnership[];ownershipChanges:ModuleOwnershipChange[];ownershipCursor:ModuleOwnershipCursor|null}{
  const check=(condition:unknown,message:string)=>{if(!condition)fail('OWNERSHIP_AUDIT',message)};
  check(!Object.hasOwn(mutation,'moduleOwnerships')&&!Object.hasOwn(mutation,'ownershipCursor'),'不能直接修改责任头或游标');
  if(mutation.ownershipChanges===undefined){
    check(!command.commandId.startsWith('module-ownership-'),'责任命令缺少不可变审计');
    return {moduleOwnerships:previous.moduleOwnerships??[],ownershipChanges:previous.ownershipChanges??[],ownershipCursor:previous.ownershipCursor??null};
  }
  check(Array.isArray(mutation.ownershipChanges)&&mutation.ownershipChanges.length===1,'责任事务必须恰好追加一条审计');
  const captureAllowed=sourcePermit?.kind==='module_ownership'&&sourcePermit.changeId===mutation.ownershipChanges[0]?.changeId&&sourcePermit.captureChangeId===mutation.knowledgeSourceChanges?.[0]?.changeId;
  check(Object.keys(mutation).every(key=>key==='ownershipChanges'||key==='receipt'||key==='knowledgeSourceChanges'&&captureAllowed),'责任事务不能夹带岗位、图或执行变化');
  const event=mutation.ownershipChanges[0];
  const next=applyModuleOwnershipChange(previous,event,moduleOwnershipImpact(previous,event?.request?.change?.moduleId));
  checkModuleOwnershipActor(previous,event.actor);
  const expected=moduleOwnershipCommand(event.request,event.actor);
  check(command.commandId===expected.commandId&&command.fingerprint===expected.fingerprint,'责任审计与原命令不一致');
  check(moduleOwnershipCanonical(mutation.receipt)===moduleOwnershipCanonical(moduleOwnershipReceipt(event)),'责任回执与审计不一致');
  return next;
}
