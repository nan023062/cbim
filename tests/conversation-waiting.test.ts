import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {conversationExecutionState} from '../src/frontend/conversation/conversation-state';
import {UsageStatus} from '../src/frontend/conversation/UsageStatus';
import {MessageQueue} from '../src/frontend/execution-view/MessageQueue';
import {SendButton} from '../src/frontend/conversation/SendButton';
import type {ScopeSummary} from '../src/bridge/contracts/dispatch';
import type {RunSummary,QueuedMessage} from '../src/bridge/contracts/execution';

const since='2026-11-07T01:00:10.000Z';
const waiting:ScopeSummary={scopeId:'scope',status:'waiting',createdAt:'2026-11-07T01:00:00.000Z',hasGoal:true,goalRevision:3,hasPlan:true,reviewDecision:'awaiting_user',stamp:{scopeId:'scope',streamId:'scopes:graph',seq:3},wait:{waitId:'wait',reason:'需要补充',goalRevision:3,createdAt:since}};
it('持久等待没有活动执行，但普通输入只入队，取消入口保留且禁止插入和继续队列',()=>{
  const state=conversationExecutionState({status:'completed'},waiting);
  expect(state).toMatchObject({waiting:true,mainRunning:false,executing:false,taskOpen:true,canInsert:false,canContinueQueue:false,shouldQueue:true});
  expect(conversationExecutionState({status:'running'},waiting)).toEqual(state);
  expect(conversationExecutionState({status:'completed'},undefined)).toMatchObject({taskOpen:false,shouldQueue:false,canContinueQueue:true});
  expect(conversationExecutionState({status:'completed'},undefined,1).shouldQueue).toBe(true);
  expect(conversationExecutionState({status:'running'},{...waiting,status:'active',wait:undefined})).toMatchObject({executing:true,canInsert:true,taskOpen:true});
});
it('持久等待优先于暂未追齐的running日志，状态不旋转且等待时间不增长',()=>{
  const run={status:'running',events:[{type:'run.started',time:'2026-11-07T01:00:00.000Z',data:{}},{type:'message.delta',time:'2026-11-07T01:00:09.000Z',data:{text:'请求补充'}}]} as RunSummary;
  const render=(now:string)=>renderToStaticMarkup(createElement(UsageStatus,{runs:[run],now:Date.parse(now),placement:'above',activity:{label:'等待补充 · 执行已暂停',active:false,tone:'warning',waitingSince:since}}));
  const first=render('2026-11-07T01:00:20.000Z');expect(first).toContain('等待补充 · 执行已暂停');expect(first).not.toContain('usage-sparkle');expect(first).not.toContain('正在生成');expect(render('2026-11-07T02:00:20.000Z')).toBe(first);
});
it('等待期间只禁止继续队列，仍可编辑删除排序，并明确取消目标按钮',()=>{
  const item:QueuedMessage={id:'q',taskId:'root',message:'同意',options:{provider:'p',model:'m'},status:'paused',reason:'当前目标等待补充'};
  const html=renderToStaticMarkup(createElement(MessageQueue,{items:[item],busy:false,continueDisabled:true,onChange:()=>{},onContinue:()=>{},onEdit:async()=>true,onMove:()=>{}}));
  expect(html).toMatch(/<button disabled=""[^>]*>继续队列<\/button>/);expect(html).toContain('编辑第 1 条消息');expect(html).toContain('删除第 1 条消息');expect(html).toContain('draggable="true"');expect(html).not.toContain('插入第 1 条到当前任务');
  expect(renderToStaticMarkup(createElement(SendButton,{disabled:false,isStreaming:true,stopLabel:'取消当前任务',onClick:()=>{}}))).toContain('aria-label="取消当前任务"');
});
