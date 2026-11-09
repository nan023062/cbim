import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemberProgressSummary} from '../src/frontend/tasks/MemberProgressSummary';
import {WorkStatus} from '../src/frontend/conversation/WorkStatus';
import {validateGraph} from '../src/bridge/contracts/dispatch';
import {publicDispatchScopeSchema} from '../src/backend/core/tasks/scope-public';
import {progressFixture,progressMemberRun} from './conversation-progress-fixture';

it('进展夹具仍遵守公开图和目标契约，供内联过程与任务详情共用',()=>{
  for(let phase=0;phase<=8;phase++){const f=progressFixture(phase);validateGraph(f.graph);publicDispatchScopeSchema.parse(f.scope)}
});
it('成员公开步骤可见但已报告和交付候选不能变成人工验收',()=>{
  const run=progressMemberRun('member-1',3);let result=renderToStaticMarkup(createElement(MemberProgressSummary,{run,compact:true}));expect(result).toContain('正在执行 · 实现并验证走子逻辑');expect(result).toContain('查看全部 2 个步骤');
  result=renderToStaticMarkup(createElement(MemberProgressSummary,{run:progressMemberRun('member-1',4)}));expect(result).toContain('交付候选 · 尚未验收');expect(result).toContain('已报告');expect(result).toContain('证据引用');expect(result).not.toContain('目标已完成');
});
it('工具失败或拒绝在折叠外可见，普通工具动作使用一致的可读名称',()=>{
  const run=progressMemberRun('member-1',3);run.status='completed';run.events.push({...run.events[0],seq:run.events.length+1,type:'tool.finished',data:{id:'plan',name:'cbim_goal_plan',isError:true,result:'失败'}});
  const result=renderToStaticMarkup(createElement(WorkStatus,{run,now:Date.now()}));expect(result).toContain('执行失败 · 保存目标计划');expect(result.indexOf('展开工作记录查看原因')).toBeGreaterThan(result.indexOf('</details>'));
});
