import {test,expect} from 'vitest';
import {TaskProgressTools} from '../src/logic/evidence/rules/progress-tools';
import type {TaskProgress} from '../src/logic/evidence/rules/progress';
import type {ToolReceipt} from '../src/logic/tools/rules/types';

const plan={expectedVersion:0,goal:'实现游戏',reason:'用户要求实现',acceptance:['浏览器可运行'],steps:[{id:'build',title:'实现并验证',owner:'主 Agent'}]};
const identity={workspaceId:'w',taskId:'t',runId:'r'};
const receipt=(id='verify'):ToolReceipt=>({version:1,toolCallId:id,toolName:'bash',...identity,outcome:'succeeded',inputHash:'a'.repeat(64),resultHash:'b'.repeat(64),effects:['command'],scope:{kind:'unknown',workspaceId:'w'},recordedAt:new Date().toISOString()});
const value=async(p:TaskProgressTools)=>JSON.parse((await p.call('cbim_task_inspect',{})).content[0].text);
test('versioned plans reject missing evidence and never self-accept delivery',async()=>{
  const revisions:TaskProgress[]=[];const p=new TaskProgressTools(undefined,async s=>{revisions.push(structuredClone(s))},{identity});
  expect((await value(p)).plan).toBeNull();await p.call('cbim_task_plan',plan);
  await expect(p.call('cbim_task_plan',plan)).rejects.toThrow('版本');
  await expect(p.call('cbim_task_step',{expectedVersion:1,id:'build',state:'reported_done',evidenceIds:[]})).rejects.toThrow('缺少');
  await expect(p.call('cbim_task_step',{expectedVersion:1,id:'build',state:'reported_done',evidenceIds:['fake']})).rejects.toThrow('不存在');
  p.record(receipt(),p.generation);await p.call('cbim_task_step',{expectedVersion:1,id:'build',state:'reported_done',evidenceIds:['verify']});
  await p.call('cbim_delivery_prepare',{expectedVersion:2,summary:'候选交付',limitations:['触屏未验证']});
  expect((await value(p)).plan.state).toBe('awaiting_review');expect(revisions).toHaveLength(3);
  await p.invalidate('文件再次修改');expect((await value(p)).plan).toMatchObject({version:4,state:'executing',steps:[{state:'pending',evidence:[]}]});
  await expect(p.call('cbim_delivery_prepare',{expectedVersion:4,summary:'沿用旧证据',limitations:[]})).rejects.toThrow('缺失有效证据');
});
test('restoring and changing scope retains history but invalidates earlier evidence',async()=>{
  const revisions:TaskProgress[]=[];const p=new TaskProgressTools(undefined,async s=>{revisions.push(structuredClone(s))},{identity});
  await p.call('cbim_task_plan',plan);p.record(receipt(),p.generation);
  await p.call('cbim_task_step',{expectedVersion:1,id:'build',state:'reported_done',evidenceIds:['verify']});
  const restored=new TaskProgressTools(revisions.at(-1),async s=>{revisions.push(structuredClone(s))},{identity});
  await restored.invalidate('恢复重新核实');expect((await value(restored)).plan.steps[0].state).toBe('pending');
  await restored.call('cbim_task_plan',{...plan,expectedVersion:3,goal:'新增双人模式',reason:'用户扩大范围'});
  expect(revisions[0].goal).toBe('实现游戏');expect(revisions.at(-1)?.goal).toBe('新增双人模式');
  restored.record(receipt('late'),0);expect((await value(restored)).evidence).toEqual([]);
});
test('failed persistence and concurrent stale edits cannot overwrite the committed plan',async()=>{
  let fail=false;const p=new TaskProgressTools(undefined,async()=>{if(fail)throw Error('disk failed')},{identity});
  await p.call('cbim_task_plan',plan);fail=true;
  await expect(p.call('cbim_task_plan',{...plan,expectedVersion:1,goal:'lost'})).rejects.toThrow('disk failed');
  expect((await value(p)).plan.goal).toBe('实现游戏');fail=false;
  const results=await Promise.allSettled([p.call('cbim_task_plan',{...plan,expectedVersion:1}),p.call('cbim_task_plan',{...plan,expectedVersion:1})]);
  expect(results.map(x=>x.status)).toEqual(['fulfilled','rejected']);
});
test('dispatch and goal review receipts cannot turn scheduling bookkeeping into delivery evidence',async()=>{
  const p=new TaskProgressTools(undefined,async()=>{},{identity});
  await p.call('cbim_task_plan',plan);
  for(const name of ['cbim_dispatch_task','cbim_dispatch_inspect','cbim_dispatch_result','cbim_goal_inspect','cbim_goal_plan','cbim_goal_review'])p.record({...receipt(name),toolName:name},p.generation);
  expect((await value(p)).evidence).toEqual([]);
  await expect(p.call('cbim_task_step',{expectedVersion:1,id:'build',state:'reported_done',evidenceIds:['cbim_dispatch_task']})).rejects.toThrow('证据不存在');
  await expect(p.call('cbim_task_step',{expectedVersion:1,id:'build',state:'reported_done',evidenceIds:['cbim_goal_review']})).rejects.toThrow('证据不存在');
  p.record(receipt('real-verification'),p.generation);
  expect((await value(p)).evidence.map((r:ToolReceipt)=>r.toolCallId)).toEqual(['real-verification']);
});
