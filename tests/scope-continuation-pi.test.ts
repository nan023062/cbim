import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {prepareRecursivePause} from './recursive-pause-fixture';
import {pauseQueuedGoal} from './recursive-pause-provider';

it.each(['complete-restart','wait-again','stop-race','live-queue'] as const)('continues the same recursive call only from its actual question answer (%s)',async mode=>{
 const c=await prepareRecursivePause(mode==='wait-again',mode==='stop-race');
 try{
  const initial=await c.state(),queue=()=>c.app.dispatch('loop.queue',{id:c.entry.id,taskId:c.start.taskId});
  expect(initial.scopes?.[0].status).toBe('active');expect(initial.scopes?.[0].wait).toBeUndefined();
  expect(initial.graphs[0].tasks).toEqual([]);expect(c.provider.byChild[0]).toHaveLength(5);
  await expect(c.answer({...c.first,id:'obsolete-question'})).rejects.toThrow();
  expect(await c.questions()).toEqual([c.first]);expect(await c.state()).toEqual(initial);
  if(mode==='live-queue'){
   await c.app.dispatch('loop.enqueue',{id:c.entry.id,taskId:c.start.taskId,message:pauseQueuedGoal,options:{permission:'read'}});
   expect((await queue())[0]).toMatchObject({message:pauseQueuedGoal,status:'pending'});
   expect(await c.questions()).toEqual([c.first]);expect(c.provider.queued).toEqual([]);expect(c.provider.byChild.slice(1)).toEqual([[],[]]);
  }
  await c.answer(c.first);
  if(mode==='stop-race'){
   await c.until(()=>expect(c.provider.state.continued).toBe(true));
   const stopping=c.stop();c.provider.releaseContinuation();await stopping;
  }else if(mode==='wait-again'){
   const second=await c.question(c.first.id);expect(second.id).not.toBe(c.first.id);
   await expect(c.answer(c.first)).rejects.toThrow();expect(await c.questions()).toEqual([second]);
   expect((await c.state()).agentBusinessRuns![0].binding).toEqual(c.binding);await c.answer(second);
  }
  await c.until(async()=>{
   const state=await c.state();expect(state.scopes?.every(s=>s.status==='closed')).toBe(true);
   expect(c.app.runtime.snapshot().pressure.activeRuns).toBe(0);
   if(mode==='live-queue'){expect(c.provider.queued).toHaveLength(1);expect(await queue()).toEqual([])}
  });
  const state=await c.state(),runs=state.agentBusinessRuns!;
  expect(state.scopes?.[0].outcome).toBe(mode==='stop-race'?'cancelled':'completed');
  expect(runs).toHaveLength(mode==='stop-race'?1:3);expect(runs.every(r=>r.status==='closed')).toBe(true);
  expect(runs[0].binding).toEqual(c.binding);expect(state.graphs[0].tasks).toEqual([]);
  const child=await c.child();expect(child.events.filter(e=>e.type==='tool.allowed'&&e.data.id==='pause-write')).toHaveLength(1);
  expect(child.events.filter(e=>e.type==='run.started')).toHaveLength(1);
  const thread=await c.app.execution(c.entry.id).thread(c.start.taskId);
  expect(thread).toHaveLength(mode==='live-queue'?2:1);expect(thread[0].runId).toBe(c.start.runId);
  const canonical=await fs.readFile(path.join(c.directory,'events.jsonl')),native=await fs.readFile(child.sessionFile!);
  const counts=[c.provider.main.length,c.provider.member.length,c.provider.queued.length];
  await c.reopen();
  expect(await c.state()).toEqual(state);expect(await c.app.execution(c.entry.id).thread(c.start.taskId)).toEqual(thread);
  expect(await fs.readFile(path.join(c.directory,'events.jsonl'))).toEqual(canonical);expect(await fs.readFile(child.sessionFile!)).toEqual(native);
  expect([c.provider.main.length,c.provider.member.length,c.provider.queued.length]).toEqual(counts);
  expect(await c.questions()).toEqual([]);
 }finally{await c.cleanup()}
},90000);
