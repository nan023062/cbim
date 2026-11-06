import {test,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MessageCard} from '../src/frontend/conversation/MessageCard';
import {WorkStatus} from '../src/frontend/conversation/WorkStatus';
import type {RunSummary} from '../src/backend/core/brain/types';
test('user bubble and assistant bare surface keep copy and real timestamp accessible',()=>{
  const render=(speaker:'user'|'assistant')=>renderToStaticMarkup(createElement(MessageCard,{speaker,text:'hello',time:'2026-11-06T00:00:00Z',children:'hello'}));
  expect(render('user')).toContain('user-bubble');expect(render('assistant')).toContain('bare-bubble');
  expect(render('assistant')).toContain('复制回复');expect(render('user')).toContain('dateTime="2026-11-06T00:00:00Z"');
});
test('work header distinguishes awaiting authorization, running, failed and stopped from durable events',()=>{
  const run={status:'running',events:[{type:'run.started',time:'2026-11-06T00:00:00Z',data:{}},{type:'tool.proposed',data:{id:'write1',name:'write',input:{path:'game.html'}}}]} as RunSummary;
  const render=()=>renderToStaticMarkup(createElement(WorkStatus,{run,now:Date.parse('2026-11-06T00:00:12Z')}));
  expect(render()).toContain('等待授权 · write');expect(render()).toContain('work-spinner');
  run.events.push({version:1,seq:3,taskId:'t',runId:'r',workspaceId:'w',type:'tool.finished',time:'2026-11-06T00:00:13Z',data:{id:'write1',name:'write',isError:true,result:'disk full'}});run.status='failed';
  expect(render()).toContain('执行失败');expect(render()).toContain('disk full');expect(render()).not.toContain('work-live-preview');
  run.status='cancelled';expect(render()).toContain('已停止');
});
