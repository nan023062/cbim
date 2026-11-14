import {expect,it} from 'vitest';
import {TaskProgressTools,progressTool} from '../src/logic/evidence/rules/progress-tools';
import type {TaskProgress} from '../src/logic/evidence/rules/progress';
import {dispatchTaskInput} from '../src/logic/tasks/rules/dispatch-commands';

it('preserves the full goal and all acceptance criteria allowed by a dispatched task, while short review fields remain bounded',async()=>{
  const goal='目标'.repeat(8000),acceptance=Array.from({length:50},(_,index)=>String(index).padEnd(16000,'验'));
  const dispatched=dispatchTaskInput.parse({workspaceId:'workspace',rootSessionId:'root',commandId:'dispatch',expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:['.cbim/workspace/game'],goal,acceptance:acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]}});
  const saved:TaskProgress[]=[];
  const tools=new TaskProgressTools(undefined,async state=>{saved.push(structuredClone(state))},{identity:{workspaceId:'workspace',taskId:'task',runId:'run'}});
  const plan={expectedVersion:0,goal:dispatched.task.goal,acceptance:dispatched.task.acceptance.map(item=>item.text),reason:'执行正式派发',steps:[{id:'verify',title:'完成验证',owner:'开发者'}]};
  await tools.call('cbim_task_plan',plan);
  expect(saved[0].goal).toBe(goal);expect(saved[0].acceptance).toEqual(acceptance);expect(saved[0].acceptance).toHaveLength(50);
  for(const patch of [{goal:goal+'超'},{acceptance:[...acceptance,'第51项']},{acceptance:[acceptance[0]+'超']},{reason:'原'.repeat(4001)}])expect(()=>progressTool('cbim_task_plan',{...plan,...patch})).toThrow();
  expect(()=>progressTool('cbim_delivery_prepare',{expectedVersion:1,summary:'摘'.repeat(4001),limitations:[]})).toThrow();
  expect(saved).toHaveLength(1);
});
