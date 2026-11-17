import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../../application/unittest/support/helpers';
import {Application} from '../../../../bridge/server/application';
import {Paths} from '../../../workspace/service/paths';
import type {RunSummary} from '../../rules/types';
import {AgentBusinessRuns} from '../../storage/business-runs';
import {RunJournal} from '../../storage/run-journal';
import {mainToolContractProvider,mainToolContractFixture as data,type MainToolContractMode} from './support/main-tool-contract-provider';
import {seedMainToolContract,mainToolContractRecords,mainToolContractLogBytes} from './support/main-tool-contract-fixture';

it.each(['complete','stop','lost-registration','lost-parent-link']as MainToolContractMode[])('keeps recursive main execution facts without replay after %s',async mode=>{
 const f=await fixture(),provider=await mainToolContractProvider(mode);let app=f.app,links=0;
 try{
  const seeded=await seedMainToolContract(app,f.a,provider),id=seeded.entry.id;
  const original=AgentBusinessRuns.prototype.Start,register=vi.spyOn(AgentBusinessRuns.prototype,'Start').mockImplementation(async function(this:AgentBusinessRuns,...args:Parameters<typeof original>){
   const result=await original.apply(this,args);if(mode==='lost-registration')throw Error('registration saved but acknowledgement lost');return result;
  });
  const append=RunJournal.prototype.Append;
  vi.spyOn(RunJournal.prototype,'Append').mockImplementation(async function(this:RunJournal,...args:Parameters<typeof append>){
   const result=await append.apply(this,args),event=args[0];
   if(event.type==='tool.updated'&&event.data.id==='contract-call'&&event.data.limits){links++;if(mode==='lost-parent-link')throw Error('parent link saved but acknowledgement lost')}
   return result;
  });
  const started=await app.Dispatch('loop.chat',{id,message:data.goal,options:{permission:'read',turnTimeoutMs:60000}});
  const identity={workspaceId:id,rootSessionId:started.taskId},records=()=>mainToolContractRecords(f.user,id),graph=()=>app.Dispatch('dispatch.graphSnapshot',{identity}),fault=mode.startsWith('lost-');
  if(!fault){
   await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(provider.member).toHaveLength(1)},{timeout:30000,interval:30});
   if(mode==='stop')await app.Dispatch('loop.stop',{id,taskId:started.taskId});provider.release();
  }
  await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0]?.status).toBe('closed');expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:30});
  const saved=await records(),finished=await graph(),thread=await app.Execution(id).Thread(started.taskId),summary=thread[0]as RunSummary;
  const registered=(await app.Workspace(id).dispatchStore.Read()).agentBusinessRuns??[];
  expect(saved.scopes[0].outcome).toBe(mode==='stop'?'cancelled':'completed');expect(finished.tasks).toEqual([]);expect(saved.runs).toEqual([]);expect(thread).toHaveLength(1);
  expect(links).toBe(1);expect(register).toHaveBeenCalledTimes(mode==='lost-parent-link'?0:1);expect(registered).toHaveLength(mode==='lost-parent-link'?0:1);
  if(registered.length)expect(registered[0]).toMatchObject({status:'closed',parent:{callerTaskId:started.taskId,callerRunId:started.runId,toolCallId:'contract-call'}});
  const references=summary.events.filter(e=>e.type==='tool.updated'&&e.data.id==='contract-call'&&e.data.limits);
  expect(references).toHaveLength(1);
  if(fault){
   expect(provider.state.faultConfirmed).toBe(true);expect(provider.main).toHaveLength(2);expect(provider.member).toHaveLength(0);
   const event=summary.events.filter(e=>e.type==='tool.finished'&&e.data.id==='contract-call');expect(event).toHaveLength(1);expect(event[0].data.isError).toBe(true);
   expect(summary.toolReceipts?.find(r=>r.toolCallId==='contract-call')?.outcome).toBe('failed');expect(event[0].data.outcome).toMatchObject({status:'unknown',retryable:false});
   const ref=references[0].data.agentCall as {taskId:string;runId:string};
   await expect(fs.readFile(path.join(f.user,id,'loop-engine/tasks',ref.taskId,ref.runId,'events.jsonl'))).rejects.toMatchObject({code:'ENOENT'});
   const native=(await fs.readFile(summary.sessionFile!,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
   expect(native.find(e=>e.message?.toolCallId==='contract-call')?.message.isError).toBe(true);
  }else{
   expect(provider.main).toHaveLength(mode==='complete'?3:1);expect(provider.member).toHaveLength(mode==='complete'?5:1);
   const b=registered[0].binding,child=await RunJournal.Read(path.join(f.user,id,'loop-engine/tasks',b.taskId,b.runId));
   expect(child.events.filter(e=>e.type==='run.started')).toHaveLength(1);expect(b.agentInstanceId).not.toBe(finished.root.agent.agentInstanceId);
   if(mode==='complete'){
    expect(provider.state.receipt.verification).toMatchObject({state:'verified',acceptance:'not_evaluated'});expect(provider.state.check).toEqual(provider.state.receipt.verification);
    expect(child.toolReceipts?.find(r=>r.toolCallId==='contract-member-read')?.outcome).toBe('succeeded');
    expect(child.taskProgress?.steps.find(step=>step.id==='verify')?.evidence).toContain('contract-member-read');expect(child.taskProgress?.delivery?.summary).toContain(data.fact);
   }else expect(child.status).not.toBe('completed');
  }
  expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(data.fact);
  const bytes=await mainToolContractLogBytes(f.user,id),counts=[provider.main.length,provider.member.length],journal=await fs.readFile(path.join(f.user,id,'dispatch/dispatch.jsonl')),native=await fs.readFile(summary.sessionFile!);
  vi.restoreAllMocks();await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init();
  expect(await graph()).toEqual(finished);expect(await records()).toEqual(saved);expect(await mainToolContractLogBytes(f.user,id)).toEqual(bytes);expect(await fs.readFile(path.join(f.user,id,'dispatch/dispatch.jsonl'))).toEqual(journal);
  expect(await fs.readFile(summary.sessionFile!)).toEqual(native);expect([provider.main.length,provider.member.length]).toEqual(counts);expect(provider.errors).toEqual([]);
 }finally{vi.restoreAllMocks();provider.release();await app.Shutdown();await f.cleanup();await provider.close()}
},90000);
