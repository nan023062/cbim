/**
 * 作用定位：在存储屏障内检查未启动任务及启用依赖的完整撤销集合。
 * 设计原因：服务提交与持久重放共用同一规则，防止领取竞争、跨周期改写、漏掉下游或把已经执行的任务伪装为未执行。
 * 机制边界：对象递归排序由 utility 提供，本模块保留历史比较器、字段省略和业务指纹规则。
 */
import {orderJsonValue} from '../../../foundations/utility';
import {fail} from '../foundation/errors';
import type {DispatchState,DispatchMutation,DispatchCommand} from '../dispatch/dispatch-storage';
import type {GraphIdentity,TaskNode} from './graph-types';
import type {CancelQueuedTasksInput} from './queued-task-cancel';
import {queuedTaskCancellationSchema} from './queued-task-cancel';
function check(value:unknown,code:string,message:string):asserts value{if(!value)fail(code,message)}
const pending=(task:TaskNode)=>['planned','queued','waiting'].includes(task.status);
/** 只计算明确集合，不增删图；遗漏后继以 taskId 明确报错，调用者须重新提出完整请求。 */
export function queuedCancellationSelection(state:DispatchState,identity:GraphIdentity,scopeId:string,input:CancelQueuedTasksInput){
  check(state.workspaceId===identity.workspaceId,'GRAPH_IDENTITY_MISMATCH','撤销目标不属于当前工作区');
  const graph=state.graphs.find(item=>item.identity.workspaceId===identity.workspaceId&&item.identity.rootSessionId===identity.rootSessionId),scope=state.scopes?.find(item=>item.scopeId===scopeId&&item.workspaceId===identity.workspaceId&&item.rootSessionId===identity.rootSessionId);
  check(graph&&scope,'DISPATCH_SCOPE_IDENTITY','撤销周期不属于当前主会话');
  check(scope.status==='active',scope.status==='waiting'?'DISPATCH_SCOPE_WAITING':'DISPATCH_SCOPE_CLOSED','只能撤销当前活动周期的未启动任务');
  check(!scope.goal?.blocked,'GOAL_BLOCKED','当前目标已阻塞，不能继续修改排队任务');
  check(graph.cursor.streamId===input.expectedGraphCursor.streamId&&graph.cursor.seq===input.expectedGraphCursor.seq,'CANCEL_GRAPH_STALE','任务图已变化，请读取最新游标并重新核实撤销范围');
  const taskIds=new Set(input.targets.map(item=>item.taskId)),byNode=new Map(graph.tasks.map(item=>[item.nodeId,item]));
  const tasks=input.targets.map(target=>{
    const task=graph.tasks.find(item=>item.taskId===target.taskId);
    check(task?.scopeId===scopeId,'CANCEL_NOT_ALLOWED','撤销任务不属于本周期：'+target.taskId);
    check(task.revision===target.expectedRevision,'CANCEL_TASK_STALE','任务版本已变化：'+task.taskId);
    check(pending(task)&&!task.runIds.length&&!task.activeRunId&&!task.result&&!task.help&&!task.cancelledBeforeStart&&!task.awaitedChildren.length,'CANCEL_NOT_ALLOWED','任务已启动、结束或存在未决工作，不能作为排队任务撤销：'+task.taskId);
    check(!state.runs?.some(run=>run.binding.taskId===task.taskId),'CANCEL_NOT_ALLOWED','任务已经登记过运行，不能撤销为未启动：'+task.taskId);
    return task;
  });
  // 遍历全部启用依赖后继，包含已取消节点之后的新待办；不能把依赖边当成派发子树。
  const outgoing=new Map<string,string[]>();for(const edge of graph.edges)if(edge.enabled&&edge.kind==='dependency')outgoing.set(edge.fromNodeId,[...(outgoing.get(edge.fromNodeId)??[]),edge.toNodeId]);
  const seen=new Set(tasks.map(task=>task.nodeId)),queue=[...seen],missing:string[]=[];
  for(let index=0;index<queue.length;index++)for(const nodeId of outgoing.get(queue[index])??[]){
    if(seen.has(nodeId))continue;seen.add(nodeId);queue.push(nodeId);const task=byNode.get(nodeId);
    check(task&&task.scopeId===scopeId,'CANCEL_NOT_ALLOWED','启用依赖后继不属于本周期：'+(task?.taskId??nodeId));
    check(!task.runIds.length&&!task.activeRunId&&!task.result&&!task.help&&!state.runs?.some(run=>run.binding.taskId===task.taskId),'CANCEL_NOT_ALLOWED','依赖后继已经领取或执行，不能撤销其前置任务：'+task.taskId);
    if(task.status==='cancelled')continue;
    check(pending(task),'CANCEL_NOT_ALLOWED','依赖后继不是可撤销排队任务：'+task.taskId);
    if(!taskIds.has(task.taskId))missing.push(task.taskId);
  }
  check(!missing.length,'CANCEL_DEPENDENTS_REQUIRED','请明确包含以下尚未启动的依赖后继：'+missing.join('、'));
  const assignments=tasks.map(task=>{
    const messages=state.outbox.filter(item=>item.taskId===task.taskId&&item.kind==='assignment');
    check(messages.length===1&&messages[0].delivery==='pending'&&!messages[0].claim,'CANCEL_NOT_ALLOWED','任务已被领取或派发信封不完整：'+task.taskId);return messages[0];
  });
  const members=tasks.map(task=>{
    const member=state.members.find(item=>item.agentInstanceId===task.assignee.agentInstanceId);
    check(member&&member.executionScopeId===scopeId&&member.executionTaskId===task.taskId&&member.lifecycle==='active'&&['idle','waiting'].includes(member.activity)&&!member.activeRunId&&!member.activeTaskId&&!member.communicatingMessageIds.length&&member.waitingTaskIds.every(id=>id===task.taskId),'CANCEL_NOT_ALLOWED','执行实例已占用、正在通信或不属于本任务：'+task.taskId);return member;
  });
  check(new Set(members.map(member=>member.agentInstanceId)).size===members.length,'CANCEL_NOT_ALLOWED','撤销集合不是独立任务实例');
  return {graph,scope,tasks,assignments,members};
}

/** 保留本模块历史键排序与 undefined 规则；utility 只提供递归复制机制。 */
const ordered=(value:unknown):unknown=>orderJsonValue(value,{compareKeys:(a,b)=>a.localeCompare(b),omitUndefinedProperties:true});
const equal=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const valid=(value:unknown,message:string)=>check(value,'GRAPH_INPUT_INVALID',message);
/** 追加与重放都检查同一原子形状；不能用直接存储事务绕过闭包、领取状态或不可变历史。 */
export function validateQueuedTaskCancellation(previous:DispatchState,next:DispatchState,mutation:DispatchMutation,command:DispatchCommand):void{
  const added:TaskNode[]=[];
  for(const graph of next.graphs)for(const task of graph.tasks){
    const old=previous.graphs.find(item=>item.identity.rootSessionId===graph.identity.rootSessionId)?.tasks.find(item=>item.taskId===task.taskId);
    if(old?.cancelledBeforeStart)valid(equal(old,task),'已撤销的未启动任务不可改写、恢复或补造执行');
    if(!task.cancelledBeforeStart)continue;
    const record=task.cancelledBeforeStart;
    valid(queuedTaskCancellationSchema.safeParse(record).success&&record.scopeId===task.scopeId,'撤销记录缺少固定周期或可信身份');
    valid(!next.runs?.some(run=>run.binding.taskId===task.taskId||run.binding.runId===record.mainRunId),'未启动撤销不能关联成员运行或冒用成员身份');
    const messages=next.outbox.filter(message=>message.kind==='assignment'&&message.taskId===task.taskId);
    valid(messages.length===1&&messages[0].delivery==='processed'&&!messages[0].claim,'撤销任务必须保留唯一已消费且从未领取的派发信封');
    const member=next.members.find(item=>item.agentInstanceId===task.assignee.agentInstanceId);
    valid(member?.activity==='idle'&&!member.activeTaskId&&!member.activeRunId&&!member.waitingTaskIds.length&&!member.communicatingMessageIds.length,'撤销任务不能保留执行占用或待办');
    if(!old?.cancelledBeforeStart)added.push(task);
  }
  if(!added.length)return;
  const first=added[0],record=first.cancelledBeforeStart!,graph=previous.graphs.find(item=>item.identity.rootSessionId===first.identity.rootSessionId);
  valid(graph&&mutation.batch?.commandId===command.commandId&&mutation.batch.cause==='task.cancelled'&&record.commandId===command.commandId,'撤销记录必须由当前图取消命令原子产生');
  valid(!mutation.scopes?.length&&!mutation.runs?.length&&!mutation.sessions?.length,'撤销不能顺带改写目标周期、运行或原生通道');
  for(const task of added){const value=task.cancelledBeforeStart!;valid(equal(task.identity,first.identity)&&value.scopeId===record.scopeId&&value.mainRunId===record.mainRunId&&value.commandId===record.commandId&&value.reason===record.reason&&value.cancelledAt===record.cancelledAt&&equal(value.graphCursor,record.graphCursor),'一次撤销必须具有同一来源、时间、原因和图基线')}
  const selected=queuedCancellationSelection(previous,first.identity,record.scopeId,{expectedGraphCursor:record.graphCursor,targets:added.map(task=>({taskId:task.taskId,expectedRevision:task.cancelledBeforeStart!.previousRevision})),reason:record.reason});
  valid(added.length<=100&&mutation.batch!.changes.length===added.length*2&&mutation.members?.length===added.length&&mutation.messages?.length===added.length,'撤销事务只包含明确任务、对应实例和派发信封');
  for(const task of added){
    const old=selected.tasks.find(item=>item.taskId===task.taskId)!;
    valid(equal(task,{...old,revision:old.revision+1,status:'cancelled',updatedAt:record.cancelledAt,waitReason:record.reason,cancelledBeforeStart:task.cancelledBeforeStart})&&Date.parse(record.cancelledAt)>=Date.parse(old.updatedAt),'撤销不能改写原目标、范围、责任或计划');
    const oldMember=selected.members.find(item=>item.agentInstanceId===task.assignee.agentInstanceId)!,member=mutation.members!.find(item=>item.agentInstanceId===oldMember.agentInstanceId);
    valid(equal(member,{...oldMember,activity:'idle',waitingTaskIds:[],communicatingMessageIds:[]}),'撤销只清理本任务待办，不释放实例或改换租约');
    const oldView=selected.graph.agents.find(item=>item.agentInstanceId===oldMember.agentInstanceId)!,view=mutation.batch!.changes.find(change=>change.type==='agent.upserted'&&change.agent.agentInstanceId===oldMember.agentInstanceId);
    valid(view?.type==='agent.upserted'&&equal(view.agent,{...oldView,revision:oldView.revision+1,state:'idle',waitingTaskIds:[],runningTaskId:undefined}),'撤销必须同步本图空闲投影');
    valid(mutation.batch!.changes.some(change=>change.type==='task.upserted'&&equal(change.task,task)),'撤销节点缺少同批图事件');
    const assignment=selected.assignments.find(item=>item.taskId===task.taskId)!;
    valid(mutation.messages!.some(message=>equal(message,{...assignment,delivery:'processed'})),'撤销必须保留并消费原派发信封');
  }
}
