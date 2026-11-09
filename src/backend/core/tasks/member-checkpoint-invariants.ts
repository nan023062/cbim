/**
 * 自动兜底绑定属于检查点固定任务身份，续段不得换成新岗位或另一次兜底。
 * 持久等待仅允许原 wait 明确列出的未预约检查点；原证明不变，实际消费仍限原活动周期的唯一预约。
 * 作用定位：检查成员逐段检查点、不可变预约历史和每段唯一消费在图/运行/邮箱联合事务中的一致性。
 * 设计原因：不能只在工具入口防重；存储重放和普通事务须保留原负责人及流程选择，活动周期取消检查点只接受完整交接放弃校验产生的窄许可。
 */
import {fail} from '../foundation/errors';
import type {DispatchState,DispatchMutation,DispatchCommand} from './dispatch-storage';
import type {TaskNode} from './graph-types';
import {memberCheckpointProofSchema,memberCheckpointRecordSchema} from './member-checkpoint';
import {memberResumeRequestSchema} from './queued-member-resume';
import {memberResumeSelection} from './queued-member-resume-rules';
import {goalNeedsReplan} from './scope-goal';
import {memberResumeRequests,currentMemberResumeRequest,validMemberCheckpointChain} from './member-checkpoint-chain';
import {sameWorkflowSelectionsForModules} from './workflow-selection';
function ordered(value:unknown):unknown{return Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,ordered(v)])):value}
const equal=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
function valid(value:unknown,message:string):asserts value{if(!value)fail('GRAPH_INPUT_INVALID',message)}
const fixed=(task:TaskNode)=>({goal:task.goal,acceptance:task.acceptance,modules:task.modules,workflowSelections:task.workflowSelections,ownerBinding:task.ownerBinding,fallbackBinding:task.fallbackBinding,assignee:task.assignee,requester:task.requester,scopeId:task.scopeId,planRevision:task.planRevision});
/** 验证真实联合状态，不访问磁盘；abandoned 只接完整放弃校验按 [rootSessionId,taskId] 编码的许可。恢复仍需当前文件/原生证明，终止不授予恢复资格。 */
export function validateMemberCheckpoints(previous:DispatchState,next:DispatchState,mutation:DispatchMutation,command:DispatchCommand,abandoned:ReadonlySet<string>=new Set()):void{
  const checkpointIds=new Set<string>(),consumed=new Set<string>();
  for(const run of mutation.runs??[])if(!previous.runs?.some(prior=>prior.binding.runId===run.binding.runId)){
    const oldTask=previous.graphs.find(graph=>graph.identity.rootSessionId===run.binding.rootSessionId)?.tasks.find(task=>task.taskId===run.binding.taskId);
    valid(!oldTask?.runIds.length||!!run.resumeFrom,'已经运行的任务只能经明确检查点续执行，不能从失败、求助或旧终态追加运行');
  }
  for(const graph of next.graphs)for(const task of graph.tasks){
    const old=previous.graphs.find(graph=>graph.identity.rootSessionId===task.identity.rootSessionId)?.tasks.find(item=>item.taskId===task.taskId),records=task.checkpoints??[],requests=memberResumeRequests(task),oldRecords=old?.checkpoints??[],oldRequests=old?memberResumeRequests(old):[];
    valid(validMemberCheckpointChain(task),'检查点和预约必须形成有界且不重复的连续原运行链');
    if(old?.checkpoints)valid(equal(fixed(old),fixed(task)),'检查点历史不能改变原目标、岗位或流程');
    valid(records.length>=oldRecords.length&&records.length<=oldRecords.length+1&&oldRecords.every((record,i)=>equal(record,records[i])),'检查点只能逐段追加并保留完整历史');
    valid(requests.length>=oldRequests.length&&requests.length<=oldRequests.length+1&&oldRequests.every((request,i)=>equal(request,requests[i])),'预约只能逐段追加，原请求不能删改');
    if(!records.length)continue;
    const scope=next.scopes?.find(scope=>scope.scopeId===task.scopeId),member=next.members.find(member=>member.agentInstanceId===task.assignee.agentInstanceId),session=next.sessions.find(session=>session.agentSessionId===task.assignee.agentSessionId);
    valid(scope&&member&&session,'检查点缺少原周期、实例或通道');
    for(let index=0;index<records.length;index++){
      const record=records[index],request=requests[index],source=next.runs?.find(run=>run.binding.runId===record.binding.runId),followingId=task.runIds[index+1],following=followingId?next.runs?.find(run=>run.binding.runId===followingId):undefined;
      valid(memberCheckpointRecordSchema.safeParse(record).success&&!checkpointIds.has(record.checkpointId),'检查点身份无效或跨任务重复');checkpointIds.add(record.checkpointId);
      valid(source&&source.status==='completed'&&memberCheckpointProofSchema.safeParse(source.checkpointProof).success&&equal(source.checkpointProof!.checkpoint,record)&&equal(source.binding,record.binding)&&source.binding.taskId===task.taskId&&source.binding.rootSessionId===task.identity.rootSessionId,'检查点缺少原运行正常结算和私有证明');
      const originalAssignment=next.outbox.find(message=>message.messageId===source.assignmentMessageId);
      valid(originalAssignment?.kind==='assignment'&&originalAssignment.taskId===task.taskId&&originalAssignment.identity.rootSessionId===task.identity.rootSessionId&&originalAssignment.delivery==='processed'&&originalAssignment.claim?.runId===source.binding.runId&&originalAssignment.claim.leaseEpoch===source.binding.leaseEpoch,'每段检查点必须保留已处理的原领取信封，不得遗漏早期来源');
      valid(task.runIds[index]===source.binding.runId&&task.planRevision===source.binding.planRevision&&equal(task.modules,source.prepared.modules.map(module=>module.binding)),'检查点不能改变任务计划或知识范围');
      if(index===0)valid(!source.resumeFrom,'首段不能凭空引用续执行来源');
      const messages=next.outbox.filter(message=>message.kind==='checkpoint'&&message.checkpointId===record.checkpointId);
      valid(messages.length===1&&messages[0].kind==='checkpoint'&&messages[0].taskId===task.taskId&&messages[0].identity.rootSessionId===task.identity.rootSessionId&&messages[0].runId===source.binding.runId&&messages[0].replyTo===source.assignmentMessageId,'每段检查点必须保留唯一交接信封');
      if(index>=oldRecords.length){
        const original=previous.runs?.find(run=>run.binding.runId===source.binding.runId);
        valid(old&&old.status==='running'&&old.activeRunId===source.binding.runId&&old.runIds.at(-1)===source.binding.runId&&old.runIds.length===index+1&&!old.result&&!old.help&&equal(fixed(old),fixed(task))&&original?.status==='running'&&!original.checkpointProof,'只能由原链末段活动运行结算新检查点');
        valid(task.status==='checkpointed'&&!task.activeRunId&&!task.result&&!task.help&&scope.status==='active'&&mutation.runs?.some(run=>equal(run,source))&&mutation.batch?.cause==='task.checkpointed','检查点须与正常终态及释放占用原子提交');
        valid(mutation.messages?.filter(message=>message.kind==='checkpoint'&&message.checkpointId===record.checkpointId&&!previous.outbox.some(prior=>prior.messageId===message.messageId)).length===1,'新检查点缺少同批可靠交接');
      }
      const assignments=next.outbox.filter(message=>message.kind==='assignment'&&message.taskId===task.taskId&&message.identity.rootSessionId===task.identity.rootSessionId&&message.resumeFrom?.checkpointId===record.checkpointId),assignment=assignments[0];
      if(request){
        valid(memberResumeRequestSchema.safeParse(request).success&&request.scopeId===task.scopeId&&request.checkpointId===record.checkpointId&&request.runId===source.binding.runId&&scope.runTracking?.mainRunIds.includes(request.mainRunId),'预约审计必须引用真实主运行和本段检查点');
        valid(assignments.length===1&&assignment.kind==='assignment'&&assignment.messageId===request.requestId&&assignment.commandId===request.commandId&&equal(assignment.resumeFrom,{checkpointId:record.checkpointId,runId:source.binding.runId}),'每段预约必须保留唯一续执行信封');
        if(index>=oldRequests.length){
          const selected=memberResumeSelection(previous,task.identity,scope.scopeId,request.mainRunId,{expectedGraphCursor:request.graphCursor,expectedGoalRevision:request.goalRevision,taskId:task.taskId,expectedRevision:request.previousTaskRevision,checkpointId:request.checkpointId,reason:request.reason});
          valid(request.commandId===command.commandId&&mutation.batch?.cause==='task.resume_requested'&&equal(request.trackedTaskIds,selected.trackedTaskIds),'预约必须记录真实主命令及完整待办闭包');
          valid(equal(task,{...selected.task,status:'queued',revision:selected.task.revision+1,updatedAt:request.requestedAt,waitReason:request.reason,...(oldRequests.length?{resumeHistory:[...oldRequests]}:{}),resumeRequest:request}),'预约只能追加新意图并原样保存此前预约');
          valid(!mutation.runs?.length&&!mutation.scopes?.length&&!mutation.sessions?.length&&!mutation.members?.length&&mutation.batch.changes.length===1&&mutation.messages?.length===1&&assignment.delivery==='pending'&&!assignment.claim,'预约不能消费检查点、启动或占用实例');
        }
      }else valid(!assignments.length,'没有预约的检查点不能补造续执行信封');
      if(followingId){
        valid(following&&request&&!consumed.has(record.checkpointId),'检查点缺少唯一有预约的后续运行');consumed.add(record.checkpointId);
        valid(following.assignmentMessageId===request.requestId&&equal(following.resumeFrom,{checkpointId:record.checkpointId,runId:source.binding.runId}),'续执行没有本段一次性预约来源');
        valid(equal({...following.binding,runId:source.binding.runId,leaseEpoch:source.binding.leaseEpoch},source.binding)&&following.binding.leaseEpoch===source.binding.leaseEpoch+1,'续执行必须保留原任务/实例/通道并提升一次租约');
        valid(equal(following.prepared,source.prepared)&&equal(following.model,source.model)&&following.permission===source.permission&&following.turnTimeoutMs===source.turnTimeoutMs&&equal(following.prerequisites??[],source.prerequisites??[])&&equal(following.session,source.session),'续执行不能改换知识、模型、权限、前置或原生通道');
        if(!previous.runs?.some(prior=>prior.binding.runId===following.binding.runId)){
          valid(old&&currentMemberResumeRequest(old)?.requestId===request.requestId&&old.runIds.length===index+1&&old.status==='queued'&&scope.status==='active'&&previous.outbox.some(message=>message.messageId===request.requestId&&message.delivery==='pending'&&!message.claim),'只有最新待领取预约可原子消费本段检查点');
          valid(scope.goal?.plan&&scope.goal.revision===request.goalRevision&&!scope.goal.blocked&&!scope.goal.review&&!goalNeedsReplan(scope.goal)&&scope.goal.plan.knowledgeRevision===source.prepared.knowledgeRevision&&scope.goal.plan.assignments.some(assignment=>assignment.agentId===task.assignee.agentId&&task.modules.every(module=>assignment.moduleIds.includes(module.moduleId))&&sameWorkflowSelectionsForModules(assignment.workflowSelections,task.workflowSelections,task.modules.map(module=>module.moduleId))),'领取时目标计划、知识或流程已变化');
        }
      }else{
        valid(index===records.length-1&&!task.activeRunId&&!task.result&&!task.help,'未消费的检查点只能是尚无交付和占用的末段');
        const parked=scope.status==='waiting'&&scope.wait?.memberPause?.tasks.some(ref=>ref.kind==='checkpoint'&&ref.taskId===task.taskId&&ref.checkpointId===record.checkpointId);
        valid(abandoned.has(JSON.stringify([task.identity.rootSessionId,task.taskId]))?task.status==='cancelled':scope.status==='active'?task.status==='checkpointed'&&!request||task.status==='queued'&&!!request:parked?task.status==='checkpointed'&&!request:scope.status==='closed'&&['cancelled','interrupted'].includes(task.status),'未消费末段只能显式等待、交接放弃或随关闭封存');
        valid(member.activity==='idle'&&!member.activeRunId&&!member.activeTaskId&&!member.waitingTaskIds.length&&!member.communicatingMessageIds.length,'未消费末段不能占用成员或保留通信工作');
      }
    }
  }
  for(const run of next.runs??[]){
    const task=next.graphs.find(graph=>graph.identity.rootSessionId===run.binding.rootSessionId)?.tasks.find(task=>task.taskId===run.binding.taskId);
    if(run.resumeFrom)valid(task?.checkpoints?.some(record=>record.checkpointId===run.resumeFrom!.checkpointId&&record.binding.runId===run.resumeFrom!.runId),'续执行不能引用其他任务或凭空来源');
    if(run.checkpointProof)valid(task?.checkpoints?.some(record=>record.binding.runId===run.binding.runId&&equal(run.checkpointProof!.checkpoint,record)),'私有证明不能脱离本段图记录');
  }
  for(const message of next.outbox)if(message.kind==='assignment'&&message.resumeFrom){
    const task=next.graphs.find(graph=>graph.identity.rootSessionId===message.identity.rootSessionId)?.tasks.find(task=>task.taskId===message.taskId);
    valid(task&&memberResumeRequests(task).some(request=>request.requestId===message.messageId&&request.checkpointId===message.resumeFrom!.checkpointId&&request.runId===message.resumeFrom!.runId),'续执行信封必须与原预约历史一致');
  }
}
