import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemberTaskDetail} from '../src/frontend/tasks/MemberTaskDetail';
import {MemberActivityCard} from '../src/frontend/tasks/MemberActivity';
import {identity,request,candidate,approved} from './support/candidate-review';
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
