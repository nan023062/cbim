import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {prepareRecursivePause} from './support/recursive-pause-fixture';
import {memberCheckpointFixture as data} from '../../../team/runtime/unittest/support/member-checkpoint-provider';

it.each(['complete','stop','restart','command-rejected'] as const)('keeps one paused recursive execution and rejects invalidated file proof (%s)',async mode=>{
 const c=await prepareRecursivePause(false,false,mode==='command-rejected');
 try{
  const original=await c.child(),first=await c.state();
  expect(first.graphs[0].tasks).toEqual([]);expect(first.agentBusinessRuns).toHaveLength(1);
  expect(first.agentBusinessRuns![0].status).toBe('active');expect(original.events.some(e=>e.type==='run.settled'||e.type==='run.interrupted')).toBe(false);expect(original.events.filter(e=>e.type==='run.started')).toHaveLength(1);
  const nativeSession=original.events.find(e=>e.type==='session.bound')?.data.sessionId,marker=(await fs.stat(path.join(c.f.a,data.files[0]))).mtimeMs;
  const catalog=c.provider.byChild[0][0].tools?.map(t=>t.function.name)??[];expect(catalog).not.toContain('cbim_task_checkpoint');expect(catalog).not.toContain('cbim_dispatch_resume');
  if(mode==='stop')await c.stop();
  else if(mode==='restart')await c.reopen();
  else await c.answer(c.first);
  await c.until(async()=>{expect((await c.state()).scopes?.[0].status).toBe('closed');expect(c.app.runtime.Snapshot().pressure.activeRuns).toBe(0)});
  const state=await c.state(),child=await c.child(),runs=state.agentBusinessRuns!;
  expect(runs).toHaveLength(mode==='complete'?3:1);expect(runs.every(r=>r.status==='closed')).toBe(true);expect(runs[0].binding).toEqual(c.binding);
  expect(child.sessionFile).toBe(original.sessionFile);expect(child.events.find(e=>e.type==='session.bound')?.data.sessionId).toBe(nativeSession);
  expect(child.events.filter(e=>e.type==='tool.allowed'&&e.data.id==='pause-write')).toHaveLength(1);
  expect((await fs.stat(path.join(c.f.a,data.files[0]))).mtimeMs).toBe(marker);
  if(mode==='complete'){expect(c.provider.state.result.verification).toMatchObject({state:'verified',acceptance:'not_evaluated'});expect(state.scopes?.[0].outcome).toBe('completed')}
  else if(mode==='command-rejected'){
   expect(child.toolReceipts?.find(r=>r.toolCallId==='pause-unsafe-command')?.outcome).toBe('succeeded');
   expect(child.toolReceipts?.find(r=>r.toolCallId==='pause-step')?.outcome,JSON.stringify(child.toolReceipts)).toBe('succeeded');expect(child.toolReceipts?.find(r=>r.toolCallId==='pause-delivery')?.outcome).toBe('succeeded');
   expect(c.provider.state.result.error.code).toBe('ARTIFACT_BASELINE_STALE');
   expect(c.provider.byChild.slice(1)).toEqual([[],[]]);expect(await fs.readFile(path.join(c.f.a,data.files[0]),'utf8')).toContain('UNSAFE_AFTER_CAPTURE');
  }else{expect(state.scopes?.[0].outcome).toBe('cancelled');expect(c.provider.byChild.slice(1)).toEqual([[],[]]);expect(await c.questions()).toEqual([])}
  const canonical=await fs.readFile(path.join(c.directory,'events.jsonl')),native=await fs.readFile(child.sessionFile!),sequence=[...c.provider.sequence];
  await c.reopen();expect(await c.state()).toEqual(state);expect(c.provider.sequence).toEqual(sequence);
  expect(await fs.readFile(path.join(c.directory,'events.jsonl'))).toEqual(canonical);expect(await fs.readFile(child.sessionFile!)).toEqual(native);
 }finally{await c.cleanup()}
},90000);
