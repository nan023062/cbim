import {expect,it} from 'vitest';
import {memberFailureStopReason} from '../src/backend/scheduler-engine/dispatch/member-failure-limit';
import type {TaskNode} from '../src/logic/tasks/rules/graph-types';
import {appendScopeMainRun,createScopeRunTracking} from '../src/logic/tasks/rules/scope-run-tracking';

function task(id:string,status:TaskNode['status']='interrupted',scopeId='scope'):TaskNode{
  return {taskId:id,scopeId,status,runIds:['run-'+id]} as TaskNode;
}
it('三次异常按目标累计，改变任务、运行和负责人编号或穿插成功都不能清零',()=>{
  const tasks=[task('one'),task('two','failed')];
  expect(memberFailureStopReason({tasks},'scope')).toBeUndefined();
  tasks.push(task('success','result_ready'),task('new-name'));
  expect(memberFailureStopReason({tasks},'scope')).toContain('累计 3 次');
  // 没有可丢失的内存计数；重读序列化事实与原判定一致。
  expect(memberFailureStopReason(JSON.parse(JSON.stringify({tasks})),'scope')).toBe(memberFailureStopReason({tasks},'scope'));
});
it('隔离其它目标；取消、求助、检查点、候选和未启动任务不消耗异常额度',()=>{
  const tasks=[task('failed'),task('other','failed','other'),task('cancel','cancelled'),task('help','blocked'),task('pause','checkpointed'),task('done','result_ready'),{...task('unstarted','failed'),runIds:[]},{...task('unsettled'),activeRunId:'run-unsettled'}];
  expect(memberFailureStopReason({tasks},'scope')).toBeUndefined();
  tasks.push(task('two'),task('three'));
  expect(memberFailureStopReason({tasks},'scope')).toContain('3 次自动接续上限');
});
it('原有32轮总上限在磁盘往返后保持，重复运行登记不增加额度也不延长上限',()=>{
  let scope={status:'active' as const,runTracking:createScopeRunTracking('main-0')};
  for(let i=1;i<32;i++)scope=appendScopeMainRun(scope,'main-'+i);
  const restored=JSON.parse(JSON.stringify(scope));
  expect(appendScopeMainRun(restored,'main-31')).toEqual(scope);
  expect(()=>appendScopeMainRun(restored,'new-main')).toThrow('32');
});
