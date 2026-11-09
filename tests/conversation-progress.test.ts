import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {conversationProgress} from '../src/frontend/conversation/conversation-progress';
import {ConversationProgress} from '../src/frontend/conversation/ConversationProgress';
import {MemberProgressSummary} from '../src/frontend/tasks/MemberProgressSummary';
import {WorkStatus} from '../src/frontend/conversation/WorkStatus';
import {validateGraph} from '../src/bridge/contracts/dispatch';
import {publicDispatchScopeSchema} from '../src/backend/core/tasks/scope-public';
import {progressFixture,progressMemberRun} from './conversation-progress-fixture';

const html=(phase:number)=>renderToStaticMarkup(createElement(ConversationProgress,{...progressFixture(phase),onSelectTask:()=>{}}));
it('从公开事实逐步展示计划、派发、真实运行、依赖消费和候选，重新读取可还原',()=>{
  for(let phase=0;phase<=8;phase++){const f=progressFixture(phase);validateGraph(f.graph);publicDispatchScopeSchema.parse(f.scope)}
  expect(html(0)).toContain('正在梳理目标');expect(html(1)).toContain('规则执行员 → 棋子规则');expect(html(1)).not.toContain('已派发给');
  expect(html(2)).toContain('已派发给 规则执行员');expect(html(2)).toContain('等待前置任务成果');expect(html(2)).not.toContain('已接收候选');
  expect(html(3)).toContain('规则执行员 · 正在执行');expect(html(4)).toContain('前置候选已接收');expect(html(4)).toContain('证据引用 2 项');expect(html(4)).toContain('尚未验收');
  const f=progressFixture(4),before=JSON.stringify(f),copy=JSON.parse(before);expect(conversationProgress(copy.identity,copy.graph,copy.summary,copy.scope)).toEqual(conversationProgress(f.identity,f.graph,f.summary,f.scope));expect(JSON.stringify(f)).toBe(before);
});
it('等待、失败、完成申请和可靠关闭分别显示，旧选择不拼接当前目标',()=>{
  expect(html(5)).toContain('等待补充 · 执行已暂停');expect(html(5)).toContain('主 Agent 请求用户补充');expect(html(6)).toContain('界面执行员 · 执行失败');
  expect(html(7)).toContain('完成申请待复核');expect(html(7)).not.toContain('目标已完成');expect(html(8)).toContain('目标已完成');
  const f=progressFixture(4);expect(conversationProgress({...f.identity,rootSessionId:'other'},f.graph,f.summary,f.scope)).toEqual([]);expect(conversationProgress(f.identity,f.graph,{...f.summary,goalRevision:20},f.scope)).toEqual([]);expect(conversationProgress(f.identity,f.graph,f.summary,{...f.scope,scopeId:'other'})).toEqual([]);
});
it('成员公开步骤可见但已报告和交付候选不能变成人工验收',()=>{
  const run=progressMemberRun('member-1',3);let result=renderToStaticMarkup(createElement(MemberProgressSummary,{run,compact:true}));expect(result).toContain('正在执行 · 实现并验证走子逻辑');expect(result).toContain('查看全部 2 个步骤');
  result=renderToStaticMarkup(createElement(MemberProgressSummary,{run:progressMemberRun('member-1',4)}));expect(result).toContain('交付候选 · 尚未验收');expect(result).toContain('已报告');expect(result).toContain('证据引用');expect(result).not.toContain('目标已完成');
});
it('工具失败或拒绝在折叠外可见，普通工具动作使用一致的可读名称',()=>{
  const run=progressMemberRun('member-1',3);run.status='completed';run.events.push({...run.events[0],seq:run.events.length+1,type:'tool.finished',data:{id:'plan',name:'cbim_goal_plan',isError:true,result:'失败'}});
  const result=renderToStaticMarkup(createElement(WorkStatus,{run,now:Date.now()}));expect(result).toContain('执行失败 · 保存目标计划');expect(result.indexOf('展开工作记录查看原因')).toBeGreaterThan(result.indexOf('</details>'));
});
