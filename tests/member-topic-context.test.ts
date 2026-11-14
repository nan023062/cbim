import {expect,it} from 'vitest';
import {createMemberTopicContext,resolveMemberTopicContext} from '../src/logic/tasks/rules/member-topic-context-rules';
import type {DispatchScope,TaskNode} from '../src/bridge/contracts/dispatch';
import {officeIdentity,officeTime,officeGraph,officeTask,officeSession} from './team-conversation-fixture';

const scope:DispatchScope={...officeIdentity,scopeId:'topic',status:'active',createdAt:officeTime,goal:{revision:1,input:{message:'CURRENT_TOPIC_USER',attachmentIds:[]}}};
function candidate(id:string,scopeId='topic'):TaskNode{return {...officeTask(id,scopeId),status:'result_ready',result:{resultId:'result-'+id,runId:'run-'+id,planRevision:1,summary:id,evidenceRefs:['tool'],limitations:[],acceptance:'not_evaluated'}}}
it('子 Agent 只得到当前话题用户输入与本人历史候选，其他话题和角色不进入模型资料',()=>{
  const task=officeTask('current'),previous=candidate('SAME_TOPIC_RESULT'),foreign=candidate('OTHER_TOPIC_SECRET','other'),otherAgent={...candidate('OTHER_AGENT_SECRET'),assignee:{...task.assignee,agentId:'another'}};
  const graph=officeGraph([previous,foreign,otherAgent,task]),reference=createMemberTopicContext(task,scope,graph,officeSession());
  const prompt=resolveMemberTopicContext(reference,task,scope,graph);
  expect(reference.priorTasks).toEqual([{taskId:previous.taskId,planRevision:1,resultId:previous.result!.resultId}]);
  expect(prompt).toContain('CURRENT_TOPIC_USER');expect(prompt).toContain('SAME_TOPIC_RESULT');expect(prompt).not.toContain('OTHER_TOPIC_SECRET');expect(prompt).not.toContain('OTHER_AGENT_SECRET');
  expect(JSON.stringify(reference)).not.toContain('CURRENT_TOPIC_USER');
});
it('引用身份或原候选变化拒绝解析，不退回其他办公室或最新话题',()=>{
  const task=officeTask('current'),prior=candidate('prior'),graph=officeGraph([prior,task]),reference=createMemberTopicContext(task,scope,graph,officeSession());
  expect(()=>resolveMemberTopicContext({...reference,rootSessionId:'foreign'},task,scope,graph)).toThrow();
  expect(()=>resolveMemberTopicContext(reference,task,{...scope,goal:{...scope.goal!,inputRevision:2}},graph)).toThrow();
  expect(()=>resolveMemberTopicContext(reference,task,scope,officeGraph([{...prior,scopeId:'foreign'},task]))).toThrow();
  expect(()=>createMemberTopicContext(task,scope,graph,{...officeSession(),agentId:'another'})).toThrow();
});
it('同话题补充按输入版本进入资料，其他原生上下文没有读取入口',()=>{
  const task=officeTask('current'),graph=officeGraph([task]);
  const updated:DispatchScope={...scope,goal:{...scope.goal!,revision:2,inputRevision:2},continuations:[{continuationId:'00000000-0000-4000-8000-000000000001',acceptedAt:officeTime,inputRevision:2,input:{message:'ACCEPTED_SUPPLEMENT'},runId:'main-two',options:{provider:'p',model:'m',profileId:'00000000-0000-4000-8000-000000000002',permission:'read'},wait:{waitId:'wait',reason:'等待补充',createdAt:officeTime,runId:'main-one',goalRevision:1,graphCursor:{streamId:'graph',seq:1},knowledgeRevision:'knowledge',mainRunIds:['main-one']}}]};
  const output=JSON.parse(resolveMemberTopicContext(createMemberTopicContext(task,updated,graph,officeSession()),task,updated,graph));
  expect(output.inputs.map((input:{message:string})=>input.message)).toEqual(['CURRENT_TOPIC_USER','ACCEPTED_SUPPLEMENT']);expect(output.inputRevision).toBe(2);
  const large={...updated,goal:{...updated.goal!,input:{message:'x'.repeat(65_000),attachmentIds:[]}}};
  expect(resolveMemberTopicContext(createMemberTopicContext(task,large,graph,officeSession()),task,large,graph)).toContain('ACCEPTED_SUPPLEMENT');
});
it('模型输入有界且明确记录省略范围，完整原话题记录不被修改',()=>{
  const task=officeTask('current'),graph=officeGraph([...Array.from({length:21},(_,index)=>candidate('prior-'+index)),task]);
  const large={...scope,goal:{...scope.goal!,input:{message:'x'.repeat(65_000),attachmentIds:[]}}};
  const reference=createMemberTopicContext(task,large,graph,officeSession());expect(reference.priorTasks).toHaveLength(20);expect(reference.omittedTasks).toBe(1);
  const output=JSON.parse(resolveMemberTopicContext(reference,task,large,graph));expect(output.coverage.omittedCharacters).toBeGreaterThanOrEqual(1000);expect(large.goal.input.message).toHaveLength(65000);expect(graph.tasks).toHaveLength(22);
});
