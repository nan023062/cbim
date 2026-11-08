/**
 * 作用定位：在同一派发快照中选择可持久等待的原检查点与未领取后继，供服务和 Store 重放独立裁决。
 * 设计原因：完整清单、原信封、成员代际和任务版本共同防止遗漏待办或复活旧终态；跨重启读取本规则不启动执行或刷新证明。
 */
import {fail} from '../foundation/errors';
import type {DispatchState} from './dispatch-storage';
import type {DispatchScope} from './dispatch-scope';
import type {DispatchRun} from './dispatch-execution';
import {memberPauseSchema,type MemberPause} from './member-pause';
import {currentMemberResumeRequest} from './member-checkpoint-chain';
import {completedCheckpointLedger} from './member-checkpoint-ledger';
import {sameGoalValue,goalNeedsReplan} from './scope-goal';
import {scopeHasUnresolvedActiveInput} from './scope-active-input';
function check(value:unknown,message:string):asserts value{if(!value)fail('GOAL_MEMBER_PAUSE_INVALID',message)}
/** 原成员仍沿原权限；本次用户选择不能比原权限更低后又被恢复过程隐式扩大。 */
export function assertMemberPausePermission(checkpoints:readonly {run:Pick<DispatchRun,'permission'>}[],permission:DispatchRun['permission']):void{
  const ranks={read:0,ask:1,execute:2};
  if(checkpoints.some(({run})=>ranks[run.permission]>ranks[permission]))fail('GOAL_MEMBER_PAUSE_PERMISSION','保留检查点的原权限高于本次选择；请明确选择允许原任务的权限，或停止等待后重新安排任务');
}

/** 只接受当前完整快照；文件、canonical 和 native 的真实性由调度端再次核实，不由模型清单证明。 */
export function memberPauseSelection(state:DispatchState,scope:DispatchScope,pause:MemberPause){
  check(memberPauseSchema.safeParse(pause).success,'成员等待清单无效');
  const graph=state.graphs.find(g=>g.identity.workspaceId===scope.workspaceId&&g.identity.rootSessionId===scope.rootSessionId),goal=scope.goal,plan=goal?.plan;
  check(state.workspaceId===scope.workspaceId&&graph&&['active','waiting'].includes(scope.status)&&goal&&plan&&!goal.blocked&&!goalNeedsReplan(goal)&&!scopeHasUnresolvedActiveInput(scope),'成员等待没有有效的原周期和当前计划');
  check(sameGoalValue(pause.expectedGraphCursor,{streamId:graph.cursor.streamId,seq:graph.cursor.seq}),'成员等待的任务图已变化');
  const scoped=graph.tasks.filter(t=>t.scopeId===scope.scopeId),tasks=scoped.filter(t=>['planned','queued','running','waiting','checkpointed'].includes(t.status)||!t.runIds.length&&t.status==='blocked');
  check(tasks.length===pause.tasks.length&&tasks.every(t=>pause.tasks.some(ref=>ref.taskId===t.taskId)),'成员等待必须精确列出全部未完成任务');
  check(!state.runs?.some(r=>r.binding.rootSessionId===scope.rootSessionId&&['starting','running'].includes(r.status)),'存在活动成员运行，不能持久等待');
  const checkpoints:Array<{task:(typeof tasks)[number];run:DispatchRun}>=[];
  for(const task of tasks){
    const ref=pause.tasks.find(r=>r.taskId===task.taskId)!,member=state.members.find(m=>m.agentInstanceId===task.assignee.agentInstanceId),session=state.sessions.find(s=>s.agentSessionId===task.assignee.agentSessionId);
    check(task.revision===ref.expectedRevision&&task.planRevision===ref.expectedPlanRevision&&!task.activeRunId&&!task.result&&!task.help&&!task.cancelledBeforeStart&&!task.checkpointAbandonment&&!currentMemberResumeRequest(task)&&!task.awaitedChildren.length,'等待任务已领取、预约、结束或版本变化');
    check(task.modules.every(m=>m.knowledgeRevision===plan.knowledgeRevision)&&task.ownerBinding,'等待任务没有当前知识及原岗位绑定');
    check(member&&session&&member.lifecycle==='active'&&!member.releasedAt&&member.executionScopeId===scope.scopeId&&member.executionTaskId===task.taskId&&member.workspaceId===scope.workspaceId&&member.agentId===task.assignee.agentId&&member.configurationRevision===plan.knowledgeRevision&&!member.activeRunId&&!member.activeTaskId&&!member.communicatingMessageIds.length&&['idle','waiting'].includes(member.activity)&&member.waitingTaskIds.every(id=>id===task.taskId),'等待成员被占用、释放或配置过期');
    check(session.workspaceId===scope.workspaceId&&session.rootSessionId===scope.rootSessionId&&session.agentInstanceId===member.agentInstanceId&&session.agentId===member.agentId&&member.agentSessionIds.length===1&&member.agentSessionIds[0]===session.agentSessionId,'等待成员通道身份不一致');
    const runs=(state.runs??[]).filter(r=>r.binding.rootSessionId===scope.rootSessionId&&r.binding.taskId===task.taskId),assignments=state.outbox.filter(m=>m.kind==='assignment'&&m.identity.rootSessionId===scope.rootSessionId&&m.taskId===task.taskId),assignment=assignments[0];
    if(ref.kind==='unstarted'){
      check(assignments.length===1&&assignment.kind==='assignment'&&!assignment.resumeFrom&&assignment.identity.workspaceId===scope.workspaceId&&assignment.to.agentInstanceId===member.agentInstanceId&&assignment.to.agentSessionId===session.agentSessionId,'未启动后继必须保留唯一的原派发信封');
      check(['queued','waiting'].includes(task.status)&&!task.runIds.length&&!runs.length&&!task.checkpoints&&assignment.delivery==='pending'&&!assignment.claim&&!session.lastRunId&&!session.lastTaskId,'后继必须从未领取或执行');
    }else{
      // 历史预约已经消费不妨碍再次等待；必须逐段核原运行及信封，再选择最新尚未消费段。
      const {checkpoint,run}=completedCheckpointLedger(state,task,'GOAL_MEMBER_PAUSE_INVALID');
      check(task.status==='checkpointed'&&checkpoint.checkpointId===ref.checkpointId,'等待只能保留最新尚未消费的可靠检查点');
      check(run.binding.workspaceId===scope.workspaceId&&run.binding.planRevision===task.planRevision&&run.binding.agentId===member.agentId&&run.binding.teamId===member.teamId&&run.binding.agentInstanceId===member.agentInstanceId&&run.binding.agentSessionId===session.agentSessionId&&run.binding.leaseEpoch===member.leaseEpoch&&run.prepared.knowledgeRevision===plan.knowledgeRevision&&checkpoint.knowledgeRevision===plan.knowledgeRevision,'检查点身份、租约或知识基线不一致');
      check(member.activity==='idle'&&!member.waitingTaskIds.length&&session.lastRunId===run.binding.runId&&session.lastTaskId===task.taskId&&session.nativeSessionId===run.session.nativeSessionId&&!!run.session.sessionFile,'检查点原通道或领取记录不一致');
      checkpoints.push({task,run});
    }
  }
  const nodes=new Set(checkpoints.map(({task})=>task.nodeId)),queue=[...nodes];
  for(let i=0;i<queue.length;i++)for(const edge of graph.edges)if(edge.kind==='dependency'&&edge.enabled&&edge.fromNodeId===queue[i]&&!nodes.has(edge.toNodeId)){nodes.add(edge.toNodeId);queue.push(edge.toNodeId)}
  check(tasks.every(t=>nodes.has(t.nodeId)),'未启动任务必须属于保留检查点的真实依赖后继');
  return {graph,tasks,checkpoints};
}
