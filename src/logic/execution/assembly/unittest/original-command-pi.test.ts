import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../../application/unittest/support/helpers';
import {Application} from '../../../../bridge/server/application';
import {Paths} from '../../../workspace/service/paths';
import {mainToolContractProvider} from './support/main-tool-contract-provider';
import {prepareRecursiveOriginal,type OriginalRecursiveMode} from './support/recursive-original-fixture';

it.each(['lost-registration','lost-result','before-call'] as OriginalRecursiveMode[])('checks original recursive facts without replaying an ambiguous response (%s)',async mode=>{
 const f=await fixture(),provider=await mainToolContractProvider(mode,true);let app=f.app;
 try{
  const source=await prepareRecursiveOriginal(app,f.a,provider,mode),id=source.identity.workspaceId,root=source.thread[0];
  const failures=root.events.filter(e=>e.type==='tool.finished'&&e.data.id==='contract-call');
  expect(failures).toHaveLength(1);expect(failures[0].data.isError).toBe(true);
  const updates=root.events.filter(e=>e.type==='tool.updated'&&e.data.id==='contract-call'&&e.data.limits);
  expect(updates).toHaveLength(mode==='before-call'?0:1);
  if(mode==='lost-result')expect(provider.state.check).toMatchObject({state:'verified',acceptance:'not_evaluated',runId:source.state.agentBusinessRuns![0].binding.runId});
  else expect(provider.state.check.error.code).toBe('AGENT_RESULT_UNAVAILABLE');
  const run=source.state.agentBusinessRuns?.[0],selection=run?{...source.identity,taskId:run.binding.taskId,runId:run.binding.runId}:undefined;
  const report=selection?await app.Dispatch('dispatch.executionReport',selection):undefined;
  if(report){expect(report.basis.executionModel).toBe('agent-tools-v1');expect(report.log.state).toBe(mode==='lost-result'?'verified':'missing');expect(report.execution).toBe(mode==='lost-result'?'settled':'unknown');expect(report.candidate).toBeUndefined()}
  const originalFiles=[root.sessionFile!,path.join(f.user,id,'loop-engine/tasks',root.task.taskId,root.runId,'events.jsonl')],bytes=await Promise.all(originalFiles.map(p=>fs.readFile(p)));
  const other=await app.Dispatch('loop.chat',{id,message:'ORIGINAL_OTHER_ROOT: inspect only its own calls',options:{permission:'read'}});
  await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0);expect((await app.Workspace(id).dispatchStore.Read()).scopes?.every(s=>s.status==='closed')).toBe(true)},{timeout:30000,interval:30});
  expect(provider.other).toHaveLength(2);
  if(selection)await expect(app.Dispatch('dispatch.executionReport',{...selection,rootSessionId:other.taskId})).rejects.toMatchObject({code:'TASK_NOT_FOUND'});
  const state=await app.Workspace(id).dispatchStore.Read(),journal=await fs.readFile(path.join(f.user,id,'dispatch/dispatch.jsonl')),counts=[provider.main.length,provider.member.length,provider.other.length];
  if(selection)for(let i=0;i<3;i++)expect((await app.Dispatch('dispatch.executionReport',selection)).basis).toEqual(report!.basis);
  expect(await fs.readFile(path.join(f.user,id,'dispatch/dispatch.jsonl'))).toEqual(journal);
  expect(await Promise.all(originalFiles.map(p=>fs.readFile(p)))).toEqual(bytes);
  await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init();
  expect(await app.Workspace(id).dispatchStore.Read()).toEqual(state);
  if(selection)expect((await app.Dispatch('dispatch.executionReport',selection)).basis).toEqual(report!.basis);
  expect(await fs.readFile(path.join(f.user,id,'dispatch/dispatch.jsonl'))).toEqual(journal);expect(await Promise.all(originalFiles.map(p=>fs.readFile(p)))).toEqual(bytes);expect([provider.main.length,provider.member.length,provider.other.length]).toEqual(counts);
 }finally{vi.restoreAllMocks();provider.release();await app.Shutdown();await provider.close();await f.cleanup()}
},90000);
