import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RuntimeMetrics} from '../src/frontend/runtime/RuntimeOverview';
import {RuntimeScopeRow,RuntimeTaskRow} from '../src/frontend/runtime/RuntimeRows';
import {runtimeScopeLabel,runtimeScopeMatches,runtimeTaskMatches,runtimeTaskTarget,runtimeRunTarget} from '../src/frontend/runtime/runtime-view-state';
import {GlobalRuntimeManager} from '../src/logic/runtime/monitoring/global-runtime';
import type {RuntimeLoopTask,RuntimeScope} from '../src/bridge/contracts/runtime';
const scope:RuntimeScope={workspaceId:'a',rootSessionId:'root',scopeId:'scope',status:'waiting',createdAt:'2026-11-07T00:00:00.000Z',hasGoal:true,goalRevision:2,wait:{createdAt:'2026-11-07T00:01:00.000Z',reason:'需要用户提供验收证据'}};
const loop:RuntimeLoopTask={source:'loop',binding:'role-only',workspaceId:'a',taskId:'root',moduleIds:[],status:'completed',runIds:['run'],activeRunIds:[],lastRunId:'run',updatedAt:'2026-11-07T00:00:00.000Z'};

it('completed model turn and waiting goal remain distinct facts with exact root navigation',()=>{
  expect(runtimeScopeLabel(scope)).toBe('等待用户');expect(runtimeScopeMatches(scope,'current')).toBe(true);expect(runtimeScopeMatches(scope,'attention')).toBe(true);expect(runtimeTaskMatches(loop,'current')).toBe(false);expect(runtimeTaskTarget(loop)).toEqual({workspaceId:'a',rootSessionId:'root'});
  const goal=renderToStaticMarkup(createElement(RuntimeScopeRow,{value:scope,workspace:'A',canOpen:true,onOpen:()=>{}})),run=renderToStaticMarkup(createElement(RuntimeTaskRow,{value:loop,workspace:'A',canOpen:true,onOpen:()=>{}}));
  expect(goal).toContain('等待用户');expect(goal).toContain('data-root-session-id="root"');expect(run).toContain('本轮结束');expect(run).not.toContain('目标周期完成');
  expect(runtimeScopeLabel({...scope,status:'closed',outcome:'completed',reviewDecision:'complete'})).toBe('目标周期完成');expect(runtimeScopeLabel({...scope,status:'closed',outcome:'completed'})).toBe('周期已结束');expect(runtimeScopeLabel({...scope,status:'closed',outcome:'failed'})).toBe('周期失败');
  expect(runtimeScopeLabel({...scope,status:'closed'})).toBe('周期已关闭（结果未报告）');
});

it('unreported and unpriced usage never renders zero cost or complete billing, partial price is named',()=>{
  const data=new GlobalRuntimeManager().snapshot();data.usage={...data.usage,runCount:3,unreportedRuns:1,reportedRuns:2,unpricedRuns:1,total:1200,usageReported:true,costPartial:true};
  let html=renderToStaticMarkup(createElement(RuntimeMetrics,{data}));expect(html).toContain('未计价');expect(html).not.toContain('$0.0000');expect(html).toContain('用量缺失');expect(html).toContain('不是上下文占用');
  data.usage.cost=.04;html=renderToStaticMarkup(createElement(RuntimeMetrics,{data}));expect(html).toContain('$0.0400');expect(html).toContain('已知部分');
  data.usage.cost=0;data.usage.costPartial=false;data.usage.unreportedRuns=0;html=renderToStaticMarkup(createElement(RuntimeMetrics,{data}));expect(html).toContain('$0.0000');
});

it('dispatch/result candidate routes to its own original node; old unbound run does not invent a root',()=>{
  const task={source:'dispatch' as const,binding:'instance' as const,workspaceId:'b',rootSessionId:'different-root',taskId:'member-task',scopeId:'member-scope',agentId:'role',agentInstanceId:'instance',moduleIds:['game'],status:'result_ready' as const,revision:1,planRevision:1,runIds:['run'],updatedAt:scope.createdAt};
  expect(runtimeTaskTarget(task)).toEqual({workspaceId:'b',rootSessionId:'different-root',taskId:'member-task',scopeId:'member-scope'});expect(runtimeTaskMatches(task,'current')).toBe(false);
  expect(renderToStaticMarkup(createElement(RuntimeTaskRow,{value:task,workspace:'B',canOpen:false,onOpen:()=>{}}))).toContain('候选不代表已验收');
  expect(runtimeRunTarget({workspaceId:'b',taskId:'old',runId:'run',status:'completed',phase:'settled',lastSeq:1,updatedAt:scope.createdAt,usage:new GlobalRuntimeManager().snapshot().usage})).toBeUndefined();
});
