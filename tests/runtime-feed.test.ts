import {afterEach,expect,it,vi} from 'vitest';
import {RuntimeFeed,reconcileRuntime} from '../src/frontend/runtime/runtime-feed';
import {GlobalRuntimeManager} from '../src/logic/runtime/monitoring/global-runtime';
import type {RuntimeSnapshot} from '../src/bridge/contracts/runtime';
const response=(snapshot:RuntimeSnapshot)=>({mode:'snapshot',cursor:snapshot.cursor,snapshot});
function initial(){const manager=new GlobalRuntimeManager(),epoch=manager.begin('workspace','Project');manager.ready('workspace',epoch);return manager.snapshot()}
afterEach(()=>vi.useRealTimers());

it('single in-flight read, noop and equal snapshots retain state and rows without notification',async()=>{
  vi.useFakeTimers();const first=initial(),read=vi.fn().mockResolvedValueOnce(response(first)).mockResolvedValueOnce({mode:'noop',cursor:first.cursor}).mockResolvedValueOnce(response(structuredClone(first))),listener=vi.fn(),feed=new RuntimeFeed(read),stop=feed.subscribe(listener);await feed.refresh();
  const state=feed.snapshot;expect(listener).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1000);expect(feed.snapshot).toBe(state);expect(listener).toHaveBeenCalledTimes(1);await feed.refresh();expect(feed.snapshot).toBe(state);stop();await vi.advanceTimersByTimeAsync(5000);expect(read).toHaveBeenCalledTimes(3);
});

it('changed projection only replaces changed rows and whole stream replacement preserves no old rows',()=>{
  const first=initial(),next=structuredClone(first);next.cursor.revision++;next.scopes.push({workspaceId:'workspace',rootSessionId:'root',scopeId:'scope',status:'waiting',createdAt:'2026-11-07T00:00:00.000Z',hasGoal:false});
  const merged=reconcileRuntime(first,next);expect(merged.workspaces).toBe(first.workspaces);expect(merged.pressure).toBe(first.pressure);expect(merged.scopes).not.toBe(first.scopes);expect(merged.scopes[0]).toEqual(next.scopes[0]);
  const renamed=structuredClone(merged);renamed.workspaces[0].name='Changed';renamed.cursor.revision++;const changed=reconcileRuntime(merged,renamed);expect(changed.workspaces[0]).not.toBe(merged.workspaces[0]);expect(changed.scopes[0]).toBe(merged.scopes[0]);
  const restarted=structuredClone(renamed);restarted.cursor.streamId='new-process';expect(reconcileRuntime(changed,restarted)).toBe(restarted);
});

it('late request cannot publish after unsubscribe/remount and never overlaps reads',async()=>{
  vi.useFakeTimers();let resolve!:(value:unknown)=>void;const first=initial(),read=vi.fn().mockImplementationOnce(()=>new Promise(done=>{resolve=done})).mockResolvedValue(response(first)),feed=new RuntimeFeed(read),old=vi.fn(),current=vi.fn(),off=feed.subscribe(old);
  const waiting=feed.refresh();expect(feed.refresh()).toBe(waiting);expect(read).toHaveBeenCalledTimes(1);off();const stop=feed.subscribe(current);resolve(response(first));await waiting;
  expect(feed.snapshot.data).toBeUndefined();expect(old).not.toHaveBeenCalled();expect(current).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(0);expect(read).toHaveBeenCalledTimes(2);expect(current).toHaveBeenCalledTimes(1);stop();
});

it('network/invalid data/cursor regression preserve last known values and show an error, valid noop clears only error',async()=>{
  const first=initial(),read=vi.fn().mockResolvedValue(response(first)),feed=new RuntimeFeed(read);await feed.refresh();const data=feed.snapshot.data;
  read.mockRejectedValueOnce(Error('offline'));await feed.refresh();expect(feed.snapshot.data).toBe(data);expect(feed.snapshot.error).toBe('offline');
  read.mockResolvedValueOnce({mode:'snapshot',cursor:first.cursor,snapshot:{}});await feed.refresh();expect(feed.snapshot.data).toBe(data);expect(feed.snapshot.error).toContain('格式异常');
  const stale=structuredClone(first);stale.cursor.revision--;read.mockResolvedValueOnce(response(stale));await feed.refresh();expect(feed.snapshot.error).toContain('版本倒退');expect(feed.snapshot.data).toBe(data);
  read.mockResolvedValueOnce({mode:'noop',cursor:first.cursor});await feed.refresh();expect(feed.snapshot).toEqual({data,error:''});expect(feed.snapshot.data).toBe(data);
});

it('noop without a confirmed snapshot and mismatched response cursor cannot become success',async()=>{
  const first=initial(),read=vi.fn().mockResolvedValueOnce({mode:'noop',cursor:first.cursor}).mockResolvedValueOnce({...response(first),cursor:{...first.cursor,revision:999}}),feed=new RuntimeFeed(read);
  await feed.refresh();expect(feed.snapshot.error).toContain('游标不一致');expect(feed.snapshot.data).toBeUndefined();await feed.refresh();expect(feed.snapshot.error).toBeTruthy();expect(feed.snapshot.data).toBeUndefined();
});

it('same cursor with conflicting facts preserves previous data and reports inconsistency',async()=>{
  const first=initial(),conflict=structuredClone(first);conflict.pressure.activeRuns=99;
  const read=vi.fn().mockResolvedValueOnce(response(first)).mockResolvedValueOnce(response(conflict)),feed=new RuntimeFeed(read);await feed.refresh();const saved=feed.snapshot.data;await feed.refresh();
  expect(feed.snapshot.data).toBe(saved);expect(feed.snapshot.data?.pressure.activeRuns).toBe(0);expect(feed.snapshot.error).toContain('矛盾内容');
});

it('same task number in different roots and same run number in different tasks retain independent rows',()=>{
  const first=initial(),task={source:'dispatch' as const,binding:'instance' as const,workspaceId:'workspace',rootSessionId:'root-a',taskId:'same-task',agentId:'role',agentInstanceId:'member',moduleIds:[],status:'queued' as const,revision:1,planRevision:1,runIds:[],updatedAt:'2026-11-07T00:00:00.000Z'};
  first.tasks=[task,{...task,rootSessionId:'root-b'}];first.runs=[{workspaceId:'workspace',taskId:'a',runId:'same-run',status:'completed',phase:'settled',lastSeq:1,updatedAt:task.updatedAt,usage:first.usage},{workspaceId:'workspace',taskId:'b',runId:'same-run',status:'completed',phase:'settled',lastSeq:1,updatedAt:task.updatedAt,usage:first.usage}];
  const next=structuredClone(first);next.cursor.revision++;const merged=reconcileRuntime(first,next);
  expect(merged.tasks).toBe(first.tasks);expect(merged.runs).toBe(first.runs);expect(merged.tasks[0]).not.toBe(merged.tasks[1]);
});
