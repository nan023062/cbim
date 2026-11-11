import {test,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MessageCard} from '../src/frontend/conversation/MessageCard';
import {WorkStatus} from '../src/frontend/execution-view/WorkStatus';
import {UsageStatus,type ConversationActivity} from '../src/frontend/conversation/UsageStatus';
import type {RunSummary} from '../src/backend/core/brain/types';
test('user bubble and assistant bare surface keep copy and real timestamp accessible',()=>{
  const render=(speaker:'user'|'assistant')=>renderToStaticMarkup(createElement(MessageCard,{speaker,text:'hello',time:'2026-11-06T00:00:00Z',children:'hello'}));
  expect(render('user')).toContain('user-bubble');expect(render('assistant')).toContain('bare-bubble');
  expect(render('assistant')).toContain('复制回复');expect(render('user')).toContain('dateTime="2026-11-06T00:00:00Z"');
});
test('work header distinguishes awaiting authorization, running, failed and stopped from durable events',()=>{
  const run={status:'running',events:[{type:'run.started',time:'2026-11-06T00:00:00Z',data:{}},{type:'tool.proposed',data:{id:'write1',name:'write',input:{path:'game.html'}}}]} as RunSummary;
  const render=()=>renderToStaticMarkup(createElement(WorkStatus,{run,now:Date.parse('2026-11-06T00:00:12Z')}));
  expect(render()).toContain('等待授权 · 写入文件');expect(render()).toContain('work-spinner');
  run.events.push({version:1,seq:3,taskId:'t',runId:'r',workspaceId:'w',type:'tool.finished',time:'2026-11-06T00:00:13Z',data:{id:'write1',name:'write',isError:true,result:'disk full'}});run.status='failed';
  const failed=render();expect(failed).toContain('执行失败');expect(failed).toContain('disk full');
  // 失败动作在折叠轨道之外保持可见，但不再显示运行中的呼吸点。
  expect(failed.split('</details>').at(-1)).toContain('执行失败 · 写入文件');expect(failed).not.toContain('work-live-dot');
  run.status='cancelled';expect(render()).toContain('已停止');
  run.status='completed';expect(render()).toContain('本轮结束');expect(render()).not.toContain('本轮完成');
});

test('the composer keeps the outer goal active between main runs and separates a review request from completed work',()=>{
  const run={status:'completed',events:[{type:'run.started',time:'2026-11-06T00:00:00Z',data:{}},{type:'run.settled',time:'2026-11-06T00:00:01Z',data:{status:'completed'}}]} as RunSummary;
  const render=(activity:ConversationActivity)=>renderToStaticMarkup(createElement(UsageStatus,{runs:[run],now:Date.parse('2026-11-06T00:00:15Z'),placement:'above',activity}));
  const waiting=render({label:'等待成员执行',active:true,tone:'running'});
  expect(waiting).toContain('等待成员执行');expect(waiting).toContain('usage-sparkle');expect(waiting).not.toContain('本轮已结束');
  expect(render({label:'完成申请待复核',active:true,tone:'running'})).not.toContain('目标已完成');
  const blocked=render({label:'目标未完成',active:false,tone:'warning'});
  expect(blocked).toContain('目标未完成');expect(blocked).not.toContain('usage-sparkle');
  run.status='running';run.events.push({version:1,seq:3,workspaceId:'w',taskId:'t',runId:'r',type:'message.delta',data:{text:'继续'},time:'2026-11-06T00:00:15Z'});
  expect(render({label:'等待成员执行',active:true,tone:'running'})).toContain('正在生成');
  expect(render({label:'等待成员执行',active:true,tone:'running'})).not.toContain('等待成员执行');
});
