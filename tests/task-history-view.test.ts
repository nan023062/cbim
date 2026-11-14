import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {GraphSnapshot,ScopeSummary,TaskNode} from '../src/bridge/contracts/dispatch';
import {taskHistoryView} from '../src/view/tasks/task-history-state';
import {SessionTaskView,sessionRoot} from '../src/view/tasks/SessionTaskView';
import {scopeGoalView,type ScopeGoalState} from '../src/view/tasks/scope-state';

const identity={workspaceId:'workspace',rootSessionId:'root'},time='2026-11-13T07:00:00.000Z';
const agent={agentId:'dev',agentInstanceId:'dev-instance',agentSessionId:'dev-channel',name:'开发成员'};
const done:ScopeSummary={scopeId:'done',status:'closed',outcome:'completed',hasGoal:true,hasPlan:true,reviewDecision:'complete',createdAt:time,closedAt:time,stamp:{scopeId:'done',streamId:'scopes:graph',seq:1}};
function task(id:string,status:TaskNode['status']):TaskNode {
  return {kind:'task',nodeId:'task:'+id,taskId:id,identity,scopeId:'done',requester:agent,assignee:agent,modules:[],goal:'目标 '+id,acceptance:[],revision:1,planRevision:1,status,awaitedChildren:[],runIds:[],createdAt:time,updatedAt:time,
    ...(status==='result_ready'?{result:{resultId:'result-'+id,runId:'run-'+id,planRevision:1,summary:'成果 '+id,evidenceRefs:[],limitations:[],acceptance:'not_evaluated' as const}}:{})};
}
function graph(tasks:TaskNode[]):GraphSnapshot {
  return {version:1,identity,cursor:{...identity,streamId:'graph',seq:1},root:{kind:'session-root',nodeId:'session:root',identity,agent,revision:1,createdAt:time},tasks,agents:[],edges:tasks.map(item=>({edgeId:'dispatch-'+item.taskId,identity,fromNodeId:'session:root',toNodeId:item.nodeId,kind:'dispatch',enabled:true,revision:1}))};
}
function scopeState(scopes:ScopeSummary[]):ScopeGoalState {
  const selected=scopes.at(-1);
  return {scopes,selectedScopeId:selected?.scopeId,selectedGoalView:scopeGoalView(selected),currentGoalView:scopeGoalView(selected),loading:false,detailLoading:false,error:'',selectScope:()=>{}};
}
function render(input:GraphSnapshot,scopes:ScopeSummary[]=[done],selectedTaskId?:string) {
  return renderToStaticMarkup(createElement(SessionTaskView,{...identity,taskId:identity.rootSessionId,runs:[],queued:[],now:0,busy:false,graph:input,scopeState:scopeState(scopes),selectedTaskId,onSelectTask:()=>{},onQueueChange:()=>{},onQueueContinue:()=>{},onChat:()=>{},onStop:()=>{}}));
}

it('只折叠可靠完成周期的交付及撤销，失败/检查点/待审阅和在途事实保留',()=>{
  const input=graph([task('complete','result_ready'),task('cancel','cancelled'),...(['failed','interrupted','blocked','checkpointed','waiting','queued','running'] as const).map(status=>task(status,status)),{...task('pending','result_ready'),scopeId:'active'},{...task('in-flight','cancelled'),activeRunId:'live'}]);
  const before=JSON.stringify(input),view=taskHistoryView(input,[done]);
  expect([...view.taskIds]).toEqual(['complete','cancel']);expect(JSON.stringify(input)).toBe(before);
  const html=render(input);expect(html).toContain('历史任务 · 2');expect(html).toContain('<details class="office-history">');
  const current=html.split('<details class="office-history"')[0];expect(current).not.toContain('data-task-id="complete"');expect(current).not.toContain('data-task-id="cancel"');
  for(const id of ['failed','interrupted','blocked','checkpointed','waiting','queued','running','pending','in-flight'])expect(html).toContain(`data-task-id="${id}"`);
});

it('缺失、旧事件流、完成依据不完整及未关闭周期都不把候选当作完成',()=>{
  const input=graph([task('candidate','result_ready')]);
  for(const scopes of [[],[{...done,hasGoal:false}],[{...done,hasPlan:false}],[{...done,reviewDecision:undefined}],[{...done,needsReplan:true}],[{...done,activeInputStatus:'unknown' as const}],[{...done,status:'active' as const}],[{...done,stamp:{...done.stamp,streamId:'scopes:other'}}]]){
    expect(taskHistoryView(input,scopes).tasks).toEqual([]);
  }
  input.tasks[0].result!.planRevision=2;expect(taskHistoryView(input,[done]).tasks).toEqual([]);
  input.tasks[0].result=undefined;expect(taskHistoryView(input,[done]).tasks).toEqual([]);
});

it('候选获主 Agent 接受仍需等目标可靠完成，拒绝的候选不能藏入完成历史',()=>{
  const member=task('candidate','result_ready');
  member.candidateReview={runId:member.result!.runId,resultId:member.result!.resultId,planRevision:1,decision:'accept',reason:'依据已核实',mainRunId:'main',recordedAt:time};
  const input=graph([member]);expect(taskHistoryView(input,[{...done,status:'active'}]).tasks).toEqual([]);
  expect(taskHistoryView(input,[done]).tasks).toEqual([member]);
  member.candidateReview.decision='reject';expect(taskHistoryView(input,[done]).tasks).toEqual([]);
});



it('全部折叠时保留主根和历史入口，直接定位历史任务自动展开原节点与详情',()=>{
  const input=graph([task('old','cancelled')]);
  const collapsed=render(input);expect(collapsed).toContain('data-office-actor="main:root"');expect(collapsed).toContain('当前没有待处理任务');expect(collapsed).not.toContain('尚未派发成员任务');
  const selected=render(input,[done],'old');expect(selected).toContain('<details class="office-history" open="">');expect(selected).toContain('data-task-id="old"');expect(selected).toContain('成员任务详情');
  const foreign={...input,identity:{...identity,workspaceId:'foreign'}};expect(render(foreign)).not.toContain('task-history-toggle');
});
