import {expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {TaskNode} from '../src/bridge/contracts/dispatch';
import {MemberTaskDetail} from '../src/frontend/tasks/MemberTaskDetail';
import {MemberActivityCard} from '../src/frontend/tasks/MemberActivity';
import {CandidateReviewTools} from '../src/backend/scheduler-engine/tools/candidate-review-tools';

const identity={workspaceId:'workspace',rootSessionId:'root'},time='2026-11-13T00:00:00.000Z';
const binding={...identity,scopeId:'scope',runId:'main-run'};
function candidate():TaskNode{
  const main={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主 Agent'},member={agentId:'member',agentInstanceId:'member-instance',agentSessionId:'member-session',name:'执行成员'};
  return {kind:'task',nodeId:'task:task',taskId:'task',identity,scopeId:'scope',requester:main,assignee:member,modules:[{moduleId:'module',name:'模块',knowledgeRevision:'knowledge',maintenanceBindingId:'owner',maintainerPersonIds:['person'],workflow:{kind:'general',id:'general',version:'1',reason:'默认'}}],goal:'核实产物',acceptance:[{id:'criterion',text:'真实证据'}],revision:4,planRevision:1,status:'result_ready',runIds:['member-run'],awaitedChildren:[],createdAt:time,updatedAt:time,result:{resultId:'result',runId:'member-run',planRevision:1,summary:'已交付候选',evidenceRefs:['read'],limitations:[],acceptance:'not_evaluated'}};
}
const request={taskId:'task',expectedRevision:4,resultId:'result',decision:'accept' as const,reason:'核对工具证据'};
function approved():TaskNode{return {...candidate(),revision:5,candidateReview:{resultId:'result',runId:'member-run',planRevision:1,mainRunId:binding.runId,decision:'accept',reason:request.reason,recordedAt:time}}}

it.each(['pending','accept','reject'] as const)('任务详情与内联卡展示真实审阅阶段：%s',decision=>{
  const task=decision==='pending'?candidate():approved();if(decision==='reject')task.candidateReview!.decision='reject';
  const detail=renderToStaticMarkup(createElement(MemberTaskDetail,{...identity,task}));
  const inline=renderToStaticMarkup(createElement(MemberActivityCard,{...identity,task,active:false,inline:true,onSelectTask:()=>{}}));
  const label=decision==='pending'?'交付待主 Agent 审阅':decision==='accept'?'主 Agent 已审阅通过':'主 Agent 审阅未通过';
  for(const html of [detail,inline]){expect(html).toContain(label);expect(html).not.toContain('主 Agent 正在审阅');}
  expect(detail).toContain('交付审阅阶段');
  if(decision==='pending'){expect(detail).toContain('整体集成审阅');expect(detail).toContain('用户验收');}
  else expect(detail).toContain(request.reason);
});

it('审阅工具要求可信调用，输出绑定当前主运行；坏回包不重放',async()=>{
  const save=vi.fn(async()=>approved()),tools=new CandidateReviewTools(binding,save),signal=new AbortController().signal;
  expect(tools.has('cbim_dispatch_review')).toBe(true);expect(tools.list()[0].outputSchema).toBeDefined();
  await expect(tools.call('cbim_dispatch_review',request,signal)).rejects.toMatchObject({code:'DISPATCH_CALL_ID_REQUIRED'});expect(save).not.toHaveBeenCalled();
  await tools.call('cbim_dispatch_review',request,signal,'call');expect(save).toHaveBeenCalledTimes(1);
  for(const mutate of [(t:TaskNode)=>{t.identity.workspaceId='other'},(t:TaskNode)=>{t.candidateReview!.mainRunId='old'},(t:TaskNode)=>{t.candidateReview!.decision='reject'},(t:TaskNode)=>{t.result!.resultId='old'}]){
    const bad=approved();mutate(bad);save.mockResolvedValueOnce(bad);
    await expect(tools.call('cbim_dispatch_review',request,signal,'bad')).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});
  }
  expect(save).toHaveBeenCalledTimes(5);
});
