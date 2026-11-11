import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {ToolTimeline as ToolActivity} from '../src/frontend/execution-view/ToolTimeline';
import {WorkStatus} from '../src/frontend/execution-view/WorkStatus';
import type {RunSummary} from '../src/bridge/contracts/execution';

const run:RunSummary={task:{taskId:'task',workspaceId:'workspace',root:'root',goal:'展示',moduleIds:[],acceptance:[]},runId:'run',status:'failed',acceptance:'not_evaluated',unresolvedTools:['call'],events:[
  {version:1,seq:1,workspaceId:'workspace',taskId:'task',runId:'run',time:'2026-11-11T00:00:00Z',type:'tool.proposed',data:{id:'call',name:'read',input:{path:'file'}}},
  {version:1,seq:2,workspaceId:'workspace',taskId:'task',runId:'run',time:'2026-11-11T00:00:02Z',type:'tool.finished',data:{id:'call',name:'read',isError:true,result:'无法读取'}},
]};
it('不装配业务控制器也可独立展示时间、失败和原工具结果，且不改写输入',()=>{
  const before=JSON.stringify(run),html=renderToStaticMarkup(createElement(WorkStatus,{run,now:0}));
  expect(html).toContain('2s');expect(html).toContain('执行失败');expect(html).toContain('无法读取');
  expect(html).not.toContain('command-verification-panel');expect(html).not.toContain('effect-observation-panel');expect(JSON.stringify(run)).toBe(before);
});
it('显式插槽只收到被展示的原调用，行尾状态不创建隐藏的核实面板',()=>{
  const details=vi.fn(({id:toolCallId}:{id:string})=>createElement('span',null,'核实 '+toolCallId));
  const html=renderToStaticMarkup(createElement(ToolActivity,{run,toolCallId:'call',renderControls:details}));
  expect(html).toContain('核实 call');expect(details).toHaveBeenCalledExactlyOnceWith({id:'call',name:'read',attention:true});
  details.mockClear();renderToStaticMarkup(createElement(ToolActivity,{run,toolCallId:'other',renderControls:details}));expect(details).not.toHaveBeenCalled();
  renderToStaticMarkup(createElement(WorkStatus,{run,now:0,inline:true,activityDetails:createElement(ToolActivity,{run,renderControls:details})}));expect(details).not.toHaveBeenCalled();
});
