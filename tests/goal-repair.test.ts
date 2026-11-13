import {expect,it} from 'vitest';
import {goalRepairFeedback} from '../src/backend/scheduler-engine/dispatch/goal-repair';
import {checkedRunInputSource} from '../src/logic/execution/rules/input-source';
import type {DispatchScope} from '../src/logic/tasks/rules/dispatch-scope';
import type {GraphSnapshot} from '../src/logic/tasks/rules/graph-types';
import {transcript} from '../src/frontend/execution-view/transcript';
import type {RunSummary} from '../src/logic/execution/rules/types';

const scope={scopeId:'scope',workspaceId:'workspace',rootSessionId:'root',status:'active',createdAt:'2026-11-12T00:00:00.000Z',goal:{revision:1,input:{message:'开发',attachmentIds:[]}}} satisfies DispatchScope;
const graph={tasks:[]} as unknown as GraphSnapshot;
it('只接受可修复拒绝；三次总限额与两次无进展限额独立于目标版本',()=>{
  const first=goalRepairFeedback(scope,graph,'run-1',{code:'GOAL_REVIEW_REQUIRED'},[])!;
  const second=goalRepairFeedback(scope,graph,'run-2',{code:'GOAL_REVIEW_REQUIRED'},[first.source])!;
  expect(second.source.attempt).toBe(2);
  expect(goalRepairFeedback({...scope,goal:{...scope.goal,revision:9}},graph,'run-3',{code:'GOAL_REVIEW_REQUIRED'},[first.source,second.source])).toBeUndefined();
  const third=goalRepairFeedback(scope,graph,'run-3',{code:'GOAL_KNOWLEDGE_CHANGED'},[first.source,second.source])!;
  expect(third.source.attempt).toBe(3);
  expect(goalRepairFeedback(scope,graph,'run-4',{code:'GOAL_EFFECT_CHANGED'},[first.source,second.source,third.source])).toBeUndefined();
  for(const code of ['GOAL_MAIN_UNSETTLED','GOAL_EVIDENCE_INVALID','GOAL_HUMAN_REQUIRED','GOAL_ACTIVE_INPUT_UNRESOLVED','PERMISSION','SCOPE_BUDGET_EXCEEDED'])expect(goalRepairFeedback(scope,graph,'run',{code},[])).toBeUndefined();
  expect(checkedRunInputSource(first.source)).toEqual(first.source);
  expect(()=>checkedRunInputSource({...first.source,attempt:4})).toThrow();
  expect(()=>checkedRunInputSource({...first.source,permission:'execute'})).toThrow();
});
it('返工不绕过在途、明确阻塞或人工等待，界面标为系统反馈',()=>{
  expect(goalRepairFeedback({...scope,status:'closed'},graph,'run',{code:'GOAL_REVIEW_REQUIRED'},[])).toBeUndefined();
  expect(goalRepairFeedback(scope,{tasks:[{scopeId:'scope',status:'running'}]} as unknown as GraphSnapshot,'run',{code:'GOAL_REVIEW_REQUIRED'},[])).toBeUndefined();
  const feedback=goalRepairFeedback(scope,graph,'run',{code:'GOAL_REVIEW_REQUIRED'},[])!;
  const view=transcript({runId:'repair',source:feedback.source,events:[],task:{goal:'原目标'}} as unknown as RunSummary);
  expect(view[0]).toMatchObject({kind:'system'});expect(view.some(item=>item.kind==='user')).toBe(false);
});
