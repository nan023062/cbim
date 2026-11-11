import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {MemberEventsRead,MemberRunView,TaskNode} from '../src/bridge/contracts/dispatch';
import type {StoredEvent} from '../src/bridge/contracts/execution';
import {applyMemberEvents,emptyMemberEvents,memberEventKey,memberPollDelay} from '../src/frontend/tasks/member-event-state';
import {MemberRunTranscript} from '../src/frontend/tasks/MemberRunTranscript';
import {MemberActivity} from '../src/frontend/tasks/MemberActivity';
import {MemberTaskDetail} from '../src/frontend/tasks/MemberTaskDetail';
import {transcript} from '../src/frontend/run-view/transcript';

const scope={workspaceId:'workspace',rootSessionId:'root',taskId:'task',runId:'run'};
const view:MemberRunView={task:{workspaceId:scope.workspaceId,taskId:scope.taskId,root:'',goal:'核实真实产物',agentId:'developer',moduleIds:['module'],acceptance:['证据有效']},runId:scope.runId,status:'running',acceptance:'not_evaluated',unresolvedTools:[]};
const event=(seq:number,type:StoredEvent['type'],data:StoredEvent['data']={}):StoredEvent=>({version:1,workspaceId:scope.workspaceId,taskId:scope.taskId,runId:scope.runId,seq,time:'2026-11-06T12:00:00.000Z',type,data});
const reset=(events:StoredEvent[],run=view,hasMore=false):MemberEventsRead=>({mode:'reset',run,cursor:{runId:run.runId,seq:events.at(-1)?.seq??0},events,hasMore});
const delta=(events:StoredEvent[],run=view,hasMore=false):MemberEventsRead=>({mode:'delta',run,cursor:{runId:run.runId,seq:events.at(-1)?.seq??0},events,hasMore});

test('成员事件分页追加、重复投递去重，noop保持state/run/events引用',()=>{
  const first=event(1,'run.started',{task:view.task,message:view.task.goal}),text=event(2,'message.delta',{text:'正在核实'});
  const base=applyMemberEvents(emptyMemberEvents(scope),reset([first],view,true));
  const next=applyMemberEvents(base,delta([text]));
  expect(next.run!.events).toEqual([first,text]);expect(next.run!.events[0]).toBe(base.run!.events[0]);expect(next.hasMore).toBe(false);
  expect(applyMemberEvents(next,delta([text]))).toBe(next);
  expect(applyMemberEvents(next,{mode:'noop',run:view,cursor:next.cursor!})).toBe(next);
  expect(applyMemberEvents(next,reset([first,text]))).toBe(next);
  expect(base.run!.events).toHaveLength(1);
});

test('同游标的终态事务更新状态，最终消息替换流式正文而不重复显示',()=>{
  let state=applyMemberEvents(emptyMemberEvents(scope),reset([event(1,'run.started',{task:view.task}),event(2,'message.delta',{text:'已验证'}),event(3,'message.delta',{text:'页面'})]));
  state=applyMemberEvents(state,delta([event(4,'message',{text:'已验证页面，测试通过。'})]));
  const events=state.run!.events,completed={...view,status:'completed' as const};
  const settled=applyMemberEvents(state,{mode:'noop',run:completed,cursor:state.cursor!});
  expect(settled.run!.status).toBe('completed');expect(settled.run!.events).toBe(events);expect(settled.cursor).toBe(state.cursor);
  expect(transcript(settled.run!).filter(item=>item.kind==='assistant')).toEqual([expect.objectContaining({text:'已验证页面，测试通过。',pending:false})]);
  const html=renderToStaticMarkup(createElement(MemberRunTranscript,{run:settled.run!,workspaceId:scope.workspaceId,memberName:'开发成员'}));
  expect(html).toContain('开发成员的公开输出');expect(html).not.toContain('主 Agent 回复');expect(html.match(/已验证页面，测试通过。/g)).toHaveLength(1);
});

test('初始 starting 空前缀保持读取，终态分页未读完时不漏掉最后消息',()=>{
  const starting=applyMemberEvents(emptyMemberEvents(scope),reset([]));
  expect(starting.cursor?.seq).toBe(0);expect(memberPollDelay(starting,false)).toBe(1000);expect(memberPollDelay(starting,true)).toBe(5000);
  const html=renderToStaticMarkup(createElement(MemberRunTranscript,{run:starting.run!,workspaceId:scope.workspaceId,memberName:'开发成员'}));
  expect(html).toContain('正在准备成员执行');expect(html).not.toContain('正在工作');
  const completed={...view,status:'completed' as const};
  const firstPage=applyMemberEvents(starting,delta([event(1,'run.started',{task:view.task})],completed,true));
  expect(memberPollDelay(firstPage,false)).toBe(0);
  const lastPage=applyMemberEvents(firstPage,delta([event(2,'message',{text:'最后一段公开回复'}),event(3,'run.settled',{status:'completed'})],completed));
  expect(memberPollDelay(lastPage,false)).toBeUndefined();expect(memberPollDelay(lastPage,true)).toBeUndefined();
  expect(transcript(lastPage.run!).at(-1)?.text).toBe('最后一段公开回复');
});

test('旧响应不回退状态，跨工作区/任务/轮次和序号缺口拒绝合并',()=>{
  const first=event(1,'run.started',{task:view.task}),second=event(2,'message.delta',{text:'当前内容'});
  const state=applyMemberEvents(emptyMemberEvents(scope),reset([first,second]));
  expect(applyMemberEvents(state,reset([first]))).toBe(state);
  expect(()=>applyMemberEvents(state,{mode:'noop',run:view,cursor:{runId:'other',seq:2}})).toThrow('身份不一致');
  expect(()=>applyMemberEvents(state,reset([first],{...view,task:{...view.task,workspaceId:'other'}}))).toThrow('身份不一致');
  expect(()=>applyMemberEvents(state,reset([first],{...view,task:{...view.task,taskId:'other'}}))).toThrow('身份不一致');
  expect(()=>applyMemberEvents(state,delta([event(4,'message.delta',{text:'有缺口'})]))).toThrow('不连续');
  expect(()=>applyMemberEvents(state,delta([{...event(3,'message'),taskId:'other'}]))).toThrow('事件身份无效');
  expect(()=>applyMemberEvents(state,delta([event(2,'message.delta',{text:'冲突正文'})]))).toThrow('内容冲突');
  expect(()=>applyMemberEvents(emptyMemberEvents(scope),delta([first]))).toThrow('初始记录');
  expect(memberEventKey({...scope,rootSessionId:'other'})).not.toBe(memberEventKey(scope));
  expect(state.run!.events).toEqual([first,second]);
});

function task(id:string,rootSessionId='root'):TaskNode{
  const agent={agentId:'developer',agentInstanceId:'instance',agentSessionId:'member-session',name:'开发成员'};
  return {kind:'task',nodeId:'task:'+id,taskId:id,identity:{workspaceId:scope.workspaceId,rootSessionId},requester:agent,assignee:agent,goal:id,acceptance:[{id:'check',text:'核实结果'}],modules:[],revision:1,planRevision:1,status:'queued',awaitedChildren:[],runIds:[],createdAt:'2026-11-06T12:00:00.000Z',updatedAt:'2026-11-06T12:00:00.000Z'};
}
test('成员活动只显示本主会话最近三项，详情明确候选并拒绝跨会话展示',()=>{
  const tasks=[task('one'),task('two'),task('three'),task('four'),task('FOREIGN','other')];
  const html=renderToStaticMarkup(createElement(MemberActivity,{workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,tasks,onSelectTask:()=>{}}));
  expect(html).toContain('成员动态 · 4 项任务');expect(html.match(/class="member-activity-card"/g)).toHaveLength(3);expect(html).not.toContain('FOREIGN');expect(html).toContain('查看全部任务');
  const candidate={...task('candidate'),runIds:['run'],status:'result_ready' as const,result:{resultId:'result',runId:'run',planRevision:1,summary:'交付摘要',evidenceRefs:['receipt-1'],limitations:['尚未人工审阅'],acceptance:'not_evaluated' as const}};
  const detail=renderToStaticMarkup(createElement(MemberTaskDetail,{workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,task:candidate}));
  expect(detail).toContain('尚未验收');expect(detail).toContain('receipt-1');expect(detail).toContain('尚未人工审阅');expect(detail).not.toContain('停止成员执行');
  const foreign=renderToStaticMarkup(createElement(MemberTaskDetail,{workspaceId:'other',rootSessionId:scope.rootSessionId,task:candidate}));
  expect(foreign).toContain('不属于当前会话');expect(foreign).not.toContain('交付摘要');
});
