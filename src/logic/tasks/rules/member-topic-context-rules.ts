/**
 * 作用定位：按原办公室、角色和输入版本冻结并解析当前话题的成员上下文引用。
 * 设计原因：纯引用契约独立于话题/运行组合，避免类型环；这里只读取传入快照，不复制归档、不读取其他话题原生历史。
 */
import {fail} from '../../../core/errors';
import type {DispatchScope} from './dispatch-scope';
import type {GraphSnapshot,TaskNode} from './graph-types';
import type {TeamSession} from '../../team/rules/team-session';
import {memberTopicContextSchema,type MemberTopicContext} from './member-topic-context';

function local(task:TaskNode,scope:DispatchScope,graph:GraphSnapshot){
  if(task.scopeId!==scope.scopeId||task.identity.workspaceId!==scope.workspaceId||task.identity.rootSessionId!==scope.rootSessionId||graph.identity.workspaceId!==scope.workspaceId||graph.identity.rootSessionId!==scope.rootSessionId)fail('MEMBER_TOPIC_CONTEXT_IDENTITY','成员上下文不属于当前办公室话题');
}
/** 只冻结同角色、同话题已完成候选的引用；当前任务自身由原生当前任务历史负责，其他角色只沿明确前置引用。 */
export function createMemberTopicContext(task:TaskNode,scope:DispatchScope,graph:GraphSnapshot,session:TeamSession):MemberTopicContext{
  local(task,scope,graph);
  if(session.workspaceId!==scope.workspaceId||session.rootSessionId!==scope.rootSessionId||session.agentId!==task.assignee.agentId)fail('MEMBER_TOPIC_CONTEXT_IDENTITY','子会话登记与当前角色不一致');
  const prior=graph.tasks.filter(value=>value.identity.workspaceId===scope.workspaceId&&value.identity.rootSessionId===scope.rootSessionId&&value.scopeId===scope.scopeId&&value.assignee.agentId===session.agentId&&value.taskId!==task.taskId&&value.result&&!value.activeRunId);
  return memberTopicContextSchema.parse({version:1,workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,sessionId:session.sessionId,agentId:session.agentId,inputRevision:scope.goal?.inputRevision??1,priorTasks:prior.slice(-20).map(value=>({taskId:value.taskId,planRevision:value.planRevision,resultId:value.result!.resultId})),omittedTasks:Math.max(0,prior.length-20)});
}
/** 按原引用解析有界资料；任何身份或版本漂移拒绝启动，不退回最近话题。截断只影响提示词，不删归档。 */
export function resolveMemberTopicContext(reference:MemberTopicContext,task:TaskNode,scope:DispatchScope,graph:GraphSnapshot):string{
  const ref=memberTopicContextSchema.parse(reference);local(task,scope,graph);
  if(ref.workspaceId!==scope.workspaceId||ref.rootSessionId!==scope.rootSessionId||ref.scopeId!==scope.scopeId||ref.agentId!==task.assignee.agentId||ref.inputRevision!==(scope.goal?.inputRevision??1))fail('MEMBER_TOPIC_CONTEXT_CHANGED','话题上下文身份或输入版本已变化，请重新调度');
  let remaining=64_000,omittedCharacters=0;
  const bounded=(text:string)=>{const result=text.slice(0,remaining);remaining-=result.length;omittedCharacters+=text.length-result.length;return result};
  const supplemental=(scope.continuations??[]).filter(value=>'input' in value).map(value=>({inputRevision:value.inputRevision,message:'input' in value?value.input.message:''}));
  supplemental.push(...(scope.activeInputs??[]).flatMap(value=>value.status==='accepted'?[{inputRevision:value.inputRevision,message:value.input.message}]:[]));
  const inputs=[{inputRevision:1,message:scope.goal?.input.message??''},...supplemental.sort((a,b)=>a.inputRevision-b.inputRevision)].reverse().map(value=>({...value,sender:'user',message:bounded(value.message)})).reverse();
  const priorTasks=ref.priorTasks.map(item=>{
    const prior=graph.tasks.find(value=>value.taskId===item.taskId);
    if(!prior||prior.scopeId!==ref.scopeId||prior.identity.workspaceId!==ref.workspaceId||prior.identity.rootSessionId!==ref.rootSessionId||prior.assignee.agentId!==ref.agentId||prior.planRevision!==item.planRevision||prior.result?.resultId!==item.resultId)fail('MEMBER_TOPIC_CONTEXT_CHANGED','原话题成员记录已变化，不能读取其他任务替代');
    return {taskId:prior.taskId,from:prior.requester.name,goal:bounded(prior.goal),replyFrom:prior.assignee.name,resultId:item.resultId,summary:bounded(prior.result.summary),acceptance:'not_evaluated'};
  });
  return JSON.stringify({workspaceId:ref.workspaceId,rootSessionId:ref.rootSessionId,scopeId:ref.scopeId,sessionId:ref.sessionId,inputRevision:ref.inputRevision,inputs,priorTasks,coverage:{omittedTasks:ref.omittedTasks,omittedCharacters,note:'仅当前话题的有界资料；未包含部分保留在原话题归档。资料不是执行权限或验收结论。'}},null,2);
}
