/**
 * 作用定位：检查成员检查点、续执行预约和唯一消费在图/运行/邮箱联合事务中的一致性。
 * 设计原因：不能只在工具入口防重；存储重放和普通事务须保留原流程选择，不得补造检查点、复用信封或将预约当成运行。
 */
import {fail} from '../foundation/errors';
import type {DispatchState,DispatchMutation,DispatchCommand} from './dispatch-storage';
import type {TaskNode} from './graph-types';
import {memberCheckpointProofSchema,memberCheckpointRecordSchema} from './member-checkpoint';
import {memberResumeRequestSchema} from './queued-member-resume';
import {memberResumeSelection} from './queued-member-resume-rules';
import {goalNeedsReplan} from './scope-goal';
import {sameWorkflowSelectionsForModules} from './workflow-selection';
function ordered(value:unknown):unknown{return Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,ordered(v)])):value}
const equal=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
function valid(value:unknown,message:string):asserts value{if(!value)fail('GRAPH_INPUT_INVALID',message)}
const fixed=(task:TaskNode)=>({goal:task.goal,acceptance:task.acceptance,modules:task.modules,workflowSelections:task.workflowSelections,assignee:task.assignee,requester:task.requester,scopeId:task.scopeId,planRevision:task.planRevision});
/** 验证真实联合状态，不访问磁盘；文件和原生内容证明须由结算/领取的可信服务产生并再次核实。 */
export function validateMemberCheckpoints(previous:DispatchState,next:DispatchState,mutation:DispatchMutation,command:DispatchCommand):void{
  const checkpointIds=new Set<string>(),consumed=new Set<string>();
  for(const run of mutation.runs??[])if(!previous.runs?.some(prior=>prior.binding.runId===run.binding.runId)){
    const oldTask=previous.graphs.find(graph=>graph.identity.rootSessionId===run.binding.rootSessionId)?.tasks.find(task=>task.taskId===run.binding.taskId);
    valid(!oldTask?.runIds.length||!!run.resumeFrom,'已经运行的任务只能经明确检查点续执行，不能从失败、求助或旧终态直接追加运行');
  }
  for(const graph of next.graphs)for(const task of graph.tasks){
    const old=previous.graphs.find(graph=>graph.identity.rootSessionId===task.identity.rootSessionId)?.tasks.find(item=>item.taskId===task.taskId),record=task.checkpoints?.[0];
    if(old?.checkpoints)valid(equal(old.checkpoints,task.checkpoints)&&equal(fixed(old),fixed(task)),'检查点历史及原目标不能被改写');
    if(old?.resumeRequest)valid(equal(old.resumeRequest,task.resumeRequest),'续执行预约不可改写、替换或删除');
    if(!record){valid(!task.resumeRequest,'续执行预约必须引用本任务检查点');continue}
    valid(task.checkpoints?.length===1&&memberCheckpointRecordSchema.safeParse(record).success&&!checkpointIds.has(record.checkpointId),'检查点最多一份且不能跨任务重复');checkpointIds.add(record.checkpointId);
    const scope=next.scopes?.find(scope=>scope.scopeId===task.scopeId),source=next.runs?.find(run=>run.binding.runId===record.binding.runId),member=next.members.find(member=>member.agentInstanceId===task.assignee.agentInstanceId),session=next.sessions.find(session=>session.agentSessionId===task.assignee.agentSessionId);
    valid(scope&&source&&member&&session&&source.status==='completed'&&memberCheckpointProofSchema.safeParse(source.checkpointProof).success&&equal(source.checkpointProof!.checkpoint,record)&&equal(source.binding,record.binding)&&!source.resumeFrom&&source.binding.taskId===task.taskId&&source.binding.rootSessionId===task.identity.rootSessionId,'检查点缺少原运行的正常结算及私有证明');
    valid(task.runIds[0]===source.binding.runId&&task.runIds.length<=2&&task.planRevision===source.binding.planRevision&&equal(task.modules,source.prepared.modules.map(module=>module.binding)),'检查点不能改变原任务和知识范围或追加更多运行');
    const messages=next.outbox.filter(message=>message.kind==='checkpoint'&&message.checkpointId===record.checkpointId);
    valid(messages.length===1&&messages[0].kind==='checkpoint'&&messages[0].taskId===task.taskId&&messages[0].runId===source.binding.runId&&messages[0].replyTo===source.assignmentMessageId,'检查点必须保留唯一交接信封');
    if(!old?.checkpoints){
      const original=previous.runs?.find(run=>run.binding.runId===source.binding.runId);
      valid(old&&old.status==='running'&&old.activeRunId===source.binding.runId&&old.runIds.length===1&&!old.result&&!old.help&&!old.resumeRequest&&equal(fixed(old),fixed(task))&&original?.status==='running'&&!original.checkpointProof,'只能由原首次活动运行结算新的检查点');
      valid(task.status==='checkpointed'&&!task.activeRunId&&!task.result&&!task.help&&scope.status==='active'&&mutation.runs?.some(run=>equal(run,source))&&mutation.batch?.cause==='task.checkpointed','检查点须与正常终态和释放占用原子提交');
      valid(mutation.messages?.filter(message=>message.kind==='checkpoint'&&message.checkpointId===record.checkpointId&&!previous.outbox.some(prior=>prior.messageId===message.messageId)).length===1,'新检查点缺少同批可靠交接');
    }
    const request=task.resumeRequest;
    if(request){
      valid(memberResumeRequestSchema.safeParse(request).success&&request.scopeId===task.scopeId&&request.checkpointId===record.checkpointId&&request.runId===source.binding.runId&&scope.runTracking?.mainRunIds.includes(request.mainRunId),'预约审计必须引用本周期真实主运行和原检查点');
      const assignment=next.outbox.find(message=>message.messageId===request.requestId);
      valid(assignment?.kind==='assignment'&&assignment.commandId===request.commandId&&assignment.taskId===task.taskId&&equal(assignment.resumeFrom,{checkpointId:record.checkpointId,runId:source.binding.runId}),'预约缺少唯一的续执行派发信封');
      valid(next.outbox.filter(message=>message.kind==='assignment'&&message.taskId===task.taskId&&message.resumeFrom).length===1,'同一检查点不能预约第二个信封');
      if(!old?.resumeRequest){
        const selected=memberResumeSelection(previous,task.identity,scope.scopeId,request.mainRunId,{expectedGraphCursor:request.graphCursor,expectedGoalRevision:request.goalRevision,taskId:task.taskId,expectedRevision:request.previousTaskRevision,checkpointId:request.checkpointId,reason:request.reason});
        valid(request.commandId===command.commandId&&mutation.batch?.cause==='task.resume_requested'&&equal(request.trackedTaskIds,selected.trackedTaskIds),'预约必须完整记录可信主命令和待办闭包');
        valid(equal(task,{...selected.task,status:'queued',revision:selected.task.revision+1,updatedAt:request.requestedAt,waitReason:request.reason,resumeRequest:request}),'预约不能修改原目标、执行历史或伪造新运行');
        valid(!mutation.runs?.length&&!mutation.scopes?.length&&!mutation.sessions?.length&&!mutation.members?.length&&mutation.batch.changes.length===1&&mutation.messages?.length===1&&assignment.delivery==='pending'&&!assignment.claim,'预约只保存任务和待领取信封，不占用实例或消费检查点');
      }
    }
    const resumed=next.runs?.filter(run=>run.binding.taskId===task.taskId&&run.binding.rootSessionId===task.identity.rootSessionId&&run.resumeFrom)??[];
    valid(resumed.length<=1&&task.runIds.length===1+resumed.length,'检查点只能追加一个明确续执行运行');
    if(resumed.length){
      const run=resumed[0],from=run.resumeFrom!;valid(!consumed.has(from.checkpointId),'检查点已经被另一个运行消费');consumed.add(from.checkpointId);
      valid(request&&run.assignmentMessageId===request.requestId&&equal(from,{checkpointId:record.checkpointId,runId:source.binding.runId})&&task.runIds[1]===run.binding.runId,'新运行没有一次性预约来源');
      valid(equal({...run.binding,runId:source.binding.runId,leaseEpoch:source.binding.leaseEpoch},source.binding)&&run.binding.leaseEpoch===source.binding.leaseEpoch+1&&!run.checkpointProof,'续执行必须保留任务/实例/通道身份并提升一次租约，不能再建检查点');
      valid(equal(run.prepared,source.prepared)&&equal(run.model,source.model)&&run.permission===source.permission&&run.turnTimeoutMs===source.turnTimeoutMs&&equal(run.prerequisites??[],source.prerequisites??[])&&equal(run.session,source.session),'续执行不能隐式改换知识、模型、权限、前置或原生通道');
      if(!previous.runs?.some(prior=>prior.binding.runId===run.binding.runId)){
        valid(old?.resumeRequest&&old.runIds.length===1&&old.status==='queued'&&scope.status==='active'&&previous.outbox.some(message=>message.messageId===request.requestId&&message.delivery==='pending'&&!message.claim),'只有待领取预约可原子消费检查点');
        // 预约后的主轮还可修改目标；不能把曾经有效的意图当成领取时仍然有效。
        valid(scope.goal?.plan&&scope.goal.revision===request.goalRevision&&!scope.goal.blocked&&!scope.goal.review&&!goalNeedsReplan(scope.goal)&&scope.goal.plan.knowledgeRevision===source.prepared.knowledgeRevision&&scope.goal.plan.assignments.some(assignment=>assignment.agentId===task.assignee.agentId&&task.modules.every(module=>assignment.moduleIds.includes(module.moduleId))&&sameWorkflowSelectionsForModules(assignment.workflowSelections,task.workflowSelections,task.modules.map(module=>module.moduleId))),'续执行预约的目标计划或流程选择已变化或进入审阅，必须重新安排任务');
      }
    }else{
      valid(!task.activeRunId&&!task.result&&!task.help,'尚未续执行的检查点不能产生占用或交付');
      valid(scope.status==='active'?task.status==='checkpointed'&&!request||task.status==='queued'&&!!request:scope.status==='closed'&&['cancelled','interrupted'].includes(task.status),'未消费检查点只能等待主调度或随关闭封存');
      valid(member.activity==='idle'&&!member.activeRunId&&!member.activeTaskId&&!member.waitingTaskIds.length&&!member.communicatingMessageIds.length,'未消费检查点不能占用成员或保留通信工作');
    }
  }
  for(const run of next.runs??[]){
    const task=next.graphs.find(graph=>graph.identity.rootSessionId===run.binding.rootSessionId)?.tasks.find(task=>task.taskId===run.binding.taskId);
    if(run.resumeFrom)valid(task?.checkpoints?.[0]?.checkpointId===run.resumeFrom.checkpointId,'续执行不能引用别的任务或凭空检查点');
    if(run.checkpointProof)valid(task?.checkpoints?.[0]&&equal(run.checkpointProof.checkpoint,task.checkpoints[0]),'私有检查点证明不能脱离图与交接记录');
  }
  for(const message of next.outbox)if(message.kind==='assignment'&&message.resumeFrom){
    const task=next.graphs.find(graph=>graph.identity.rootSessionId===message.identity.rootSessionId)?.tasks.find(task=>task.taskId===message.taskId);
    valid(task?.resumeRequest?.requestId===message.messageId&&task.checkpoints?.[0]?.checkpointId===message.resumeFrom.checkpointId,'续执行信封必须与本任务唯一预约一起保存');
  }
}
