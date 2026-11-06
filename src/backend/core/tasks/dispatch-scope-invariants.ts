/**
 * 作用定位：校验用户任务周期与执行实例、图任务及运行的跨对象生命周期。
 * 设计原因：提交和重放共同保护周期真实输入及不可逆释放；不能用迟到回调改绑目标、删除输入或重新激活已关闭实例，释放与关闭必须同一事务可见。
 * 职责边界：不决定整轮任务是否完成、不停止模型；主调度在结算全部运行后提交关闭，旧无周期历史保持原身份。
 */
import {z} from 'zod';
import {fail} from '../foundation/errors';
import type {DispatchMutation,DispatchState} from './dispatch-storage';
import {dispatchScopeGoalSchema} from './dispatch-scope';
import {validateScopeGoalTransition} from './scope-goal';

const id=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
const shape=z.object({scopeId:id,workspaceId:id,rootSessionId:id,status:z.enum(['active','closed']),createdAt:z.string().datetime(),goal:dispatchScopeGoalSchema.optional(),closedAt:z.string().datetime().optional(),outcome:z.enum(['completed','failed','cancelled','interrupted']).optional()}).strict();
function valid(condition:unknown,message:string):asserts condition {if(!condition)fail('GRAPH_INPUT_INVALID',message)}
function ordered(value:unknown):unknown {return Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,ordered(item)])):value}
const equal=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));

/** 全量检查周期引用、冻结输入及不可逆关闭；旧无 goal/scope 的记录保持缺省，不伪造迁移。 */
export function validateDispatchScopes(previous:DispatchState,next:DispatchState,mutation:DispatchMutation):void{
  const scopes=next.scopes??[],activeRoots=new Set<string>();
  for(const scope of scopes){
    valid(shape.safeParse(scope).success&&scope.workspaceId===next.workspaceId,'调度周期结构或工作区身份无效');
    const graph=next.graphs.find(item=>item.identity.rootSessionId===scope.rootSessionId);
    valid(graph,'调度周期缺少对应主会话根');
    valid(graph.tasks.filter(task=>task.scopeId===scope.scopeId).length<=500,'调度周期超过原子关闭可容纳的 500 个任务');
    const old=previous.scopes?.find(item=>item.scopeId===scope.scopeId);
    if(old){
      valid(old.workspaceId===scope.workspaceId&&old.rootSessionId===scope.rootSessionId&&old.createdAt===scope.createdAt,'不能改绑周期或创建时间');
      validateScopeGoalTransition(old.goal,scope.goal,false);
      if(old.status==='closed')valid(equal(old,scope),'已关闭调度周期不能重开或改写结果');
    }else {valid(scope.status==='active','新周期必须从 active 开始');validateScopeGoalTransition(undefined,scope.goal,true)}
    if(scope.status==='active'){
      valid(!scope.closedAt&&!scope.outcome&&!activeRoots.has(scope.rootSessionId),'同一主会话只能有一个活动周期，活动周期不能含关闭信息');activeRoots.add(scope.rootSessionId);
    }else valid(scope.closedAt&&scope.outcome&&Date.parse(scope.closedAt)>=Date.parse(scope.createdAt),'已关闭周期缺少有效结束信息');
  }
  for(const member of next.members){
    const scoped=member.executionScopeId!==undefined||member.executionTaskId!==undefined;
    if(!scoped){valid(member.lifecycle===undefined&&member.releasedAt===undefined,'持久主实例和旧角色实例不属于可释放周期');continue}
    valid(member.agentId!=='cbim:main'&&id.safeParse(member.executionScopeId).success&&id.safeParse(member.executionTaskId).success,'执行实例必须绑定非主角色、明确周期和任务');
    const scope=scopes.find(item=>item.scopeId===member.executionScopeId);
    const task=next.graphs.find(graph=>graph.identity.rootSessionId===scope?.rootSessionId)?.tasks.find(item=>item.taskId===member.executionTaskId);
    valid(scope&&task&&task.scopeId===scope.scopeId&&task.assignee.agentInstanceId===member.agentInstanceId,'执行实例缺少对应周期任务');
    valid(member.agentSessionIds.length===1&&next.sessions.some(session=>session.agentSessionId===member.agentSessionIds[0]&&session.rootSessionId===scope.rootSessionId&&(session.purpose??'task')==='task'),'周期执行实例必须具有唯一的本任务通道');
    if(scope.status==='active')valid(member.lifecycle==='active'&&!member.releasedAt,'活动周期成员不能提前释放');
    else valid(member.lifecycle==='released'&&member.releasedAt===scope.closedAt&&!member.activeRunId&&!member.activeTaskId&&member.activity==='idle'&&!member.waitingTaskIds.length&&!member.communicatingMessageIds.length,'关闭周期必须原子释放全部执行实例');
    const old=previous.members.find(item=>item.agentInstanceId===member.agentInstanceId);
    if(old?.lifecycle==='released')valid(equal(old,member),'已释放实例不能被迟到回调修改或复活');
    if(old?.lifecycle==='active'&&member.lifecycle==='released')valid(member.leaseEpoch===old.leaseEpoch+1,'释放实例必须提升租约代际使旧回调失效');
  }
  for(const graph of next.graphs)for(const task of graph.tasks){
    if(task.scopeId===undefined)continue;
    const scope=scopes.find(item=>item.scopeId===task.scopeId),member=next.members.find(item=>item.agentInstanceId===task.assignee.agentInstanceId);
    valid(scope&&scope.rootSessionId===graph.identity.rootSessionId&&member&&task.assignee.agentId!=='cbim:main'&&member.executionScopeId===scope.scopeId&&member.executionTaskId===task.taskId&&!task.parentTaskId,'周期任务必须由主根派发并属于自己的执行实例和主会话');
    const old=previous.graphs.find(item=>item.identity.rootSessionId===graph.identity.rootSessionId)?.tasks.find(item=>item.taskId===task.taskId);
    if(!old)valid(scope.status==='active','已关闭周期不能新增任务');
    else if(previous.scopes?.find(item=>item.scopeId===scope.scopeId)?.status==='closed')valid(equal(old,task),'已关闭周期任务不能重新执行或改写历史');
    if(scope.status==='closed'){
      valid(!task.activeRunId&&!['planned','queued','waiting','running'].includes(task.status),'关闭周期不能保留尚待执行或运行中的任务');
      valid(!next.outbox.some(message=>message.kind==='assignment'&&message.taskId===task.taskId&&message.delivery!=='processed'),'关闭周期不能保留待领取或活动派发信封');
    }
  }
  for(const run of next.runs??[])if(['starting','running'].includes(run.status)){
    const member=next.members.find(item=>item.agentInstanceId===run.binding.agentInstanceId);
    if(member?.executionScopeId)valid(scopes.some(scope=>scope.scopeId===member.executionScopeId&&scope.status==='active')&&member.lifecycle==='active','已关闭周期或已释放成员不能承载活动运行');
  }
  for(const session of mutation.sessions??[]){const member=previous.members.find(item=>item.agentInstanceId===session.agentInstanceId);if(member?.lifecycle==='released')valid(equal(previous.sessions.find(item=>item.agentSessionId===session.agentSessionId),session),'已释放实例的原生通道不能被迟到回调改写')}
  // 结果信封可以在关闭后被主会话确认；除此之外，已释放实例与冻结任务不再接受运行侧变更。
  for(const run of mutation.runs??[]){const member=next.members.find(item=>item.agentInstanceId===run.binding.agentInstanceId);if(member?.lifecycle==='released')valid(equal(previous.runs?.find(item=>item.binding.runId===run.binding.runId),run),'已释放实例不能新增或改写运行')}
}
