import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {effectObservationProvider,effectFixture as data} from './effect-observation-provider';
import {prepareRecursiveUnknownEffect} from './recursive-effect-fixture';
import type {RecoveryRequest,RecoveryReceipt} from '../src/logic/tasks/rules/scope-recovery';

it.each(['complete-restart','stop','again'] as const)('isolates damaged recursive sources in an explicit fresh read-only inspection (%s)',async mode=>{
 const f=await fixture(),provider=await effectObservationProvider({recursive:true,holdInspection:true});let app=f.app;
 try{
  const source=await prepareRecursiveUnknownEffect(app,f.user,f.a,provider),id=source.identity.workspaceId,identity=source.identity;
  const state=()=>app.Workspace(id).dispatchStore.Read(),observe=()=>app.Dispatch('dispatch.effectObserve',{...identity,subject:source.subject});
  const before=await observe(),old=(await state()).scopes![0],oldRuns=(await state()).agentBusinessRuns!;
  const root=(await app.Execution(id).Thread(identity.rootSessionId))[0];
  const originalPaths=[source.original.canonicalPath,path.join(f.user,id,'loop-engine/tasks',identity.rootSessionId,root.runId,'events.jsonl')];
  await app.Shutdown();
  for(const file of originalPaths)await fs.appendFile(file,'{"invalid_history":true}\n');
  const damaged=await Promise.all(originalPaths.map(p=>fs.readFile(p))),native=await fs.readFile(root.sessionFile!);
  app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.Init();
  const report=await observe();expect(report.source.logState).toBe('invalid');expect(report.basis).not.toBe(before.basis);
  const options={...source.seed.options,permission:'read' as const},req:RecoveryRequest={...identity,commandId:randomUUID(),source:{...source.subject,reportBasis:report.basis},operation:'inspect_effects',observation:{text:data.observation},input:{message:data.inspectGoal},options};
  await expect(app.Dispatch('loop.recoveryStart',{...req,source:{...req.source,reportBasis:before.basis}})).rejects.toMatchObject({code:'RECOVERY_REPORT_STALE'});
  const until=async(check:()=>void|Promise<void>)=>{await vi.waitFor(async()=>{if(provider.errors.length)return;await check()},{timeout:30000,interval:30});if(provider.errors.length)throw Error(provider.errors.join('\n'))};
  const [receipt,duplicate]=await Promise.all([app.Dispatch('loop.recoveryStart',req),app.Dispatch('loop.recoveryStart',req)]);
  expect(duplicate.recovery).toEqual(receipt.recovery);expect(receipt.recovery.source).toMatchObject({executionModel:'agent-tools-v1',taskId:source.subject.taskId,runId:source.subject.runId});
  expect(receipt.recovery.source).not.toHaveProperty('taskRevision');expect(receipt.recovery.source).not.toHaveProperty('planRevision');
  await until(()=>expect(provider.main).toHaveLength(3));expect(provider.member).toHaveLength(3);
  await expect(app.Dispatch('loop.recoveryStart',{...req,input:{message:'changed'}})).rejects.toMatchObject({code:'RECOVERY_COMMAND_CONFLICT'});
  let final:RecoveryReceipt=receipt;
  if(mode==='stop'||mode==='again'){
   await app.Dispatch('loop.stop',{id,taskId:identity.rootSessionId});
   await until(async()=>expect((await state()).scopes![1]).toMatchObject({status:'closed',outcome:'cancelled'}));
   if(mode==='again'){
    provider.releaseInspection();const next={...req,commandId:randomUUID(),source:{...req.source,reportBasis:(await observe()).basis}};
    final=await app.Dispatch('loop.recoveryStart',next);expect(final.recovery.runId).not.toBe(receipt.recovery.runId);
   }
  }
  provider.releaseInspection();
  await until(async()=>{expect((await state()).scopes!.at(-1)?.status).toBe('closed');expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0)});
  const saved=await state(),complete=mode!=='stop';
  expect(saved.scopes![0]).toEqual(old);expect(saved.agentBusinessRuns!.slice(0,1)).toEqual(oldRuns);expect(saved.graphs[0].tasks).toEqual([]);
  expect(saved.scopes!.at(-1)?.outcome).toBe(complete?'completed':'cancelled');expect(saved.agentBusinessRuns).toHaveLength(complete?2:1);
  expect(provider.member).toHaveLength(complete?8:3);
  if(complete){
   const run=saved.agentBusinessRuns!.at(-1)!,summary=await new FileRunStorage().Read(path.join(f.user,id,'loop-engine/tasks',run.binding.taskId,run.binding.runId));
   expect(summary.taskProgress?.delivery?.summary).toContain('partial');expect(summary.toolReceipts?.filter(r=>r.toolName==='write'||r.toolName==='edit'||r.toolName==='bash')).toEqual([]);
   expect(summary.sessionFile).not.toBe(source.summary.sessionFile);
  }
  expect(await Promise.all(originalPaths.map(p=>fs.readFile(p)))).toEqual(damaged);expect(await fs.readFile(root.sessionFile!)).toEqual(native);expect(await fs.readFile(source.original.nativePath)).toEqual(source.original.native);
  expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(data.oldText);
  const lookup={...identity,commandId:req.commandId},stored=await app.Dispatch('loop.recoveryReceipt',lookup),counts=[provider.main.length,provider.member.length],journal=await fs.readFile(path.join(f.user,id,'dispatch/dispatch.jsonl'));
  await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.Init();
  expect(await state()).toEqual(saved);expect(await app.Dispatch('loop.recoveryReceipt',lookup)).toEqual(stored);expect((await app.Dispatch('loop.recoveryStart',req)).recovery).toEqual(receipt.recovery);
  expect(await fs.readFile(path.join(f.user,id,'dispatch/dispatch.jsonl'))).toEqual(journal);expect([provider.main.length,provider.member.length]).toEqual(counts);expect(await Promise.all(originalPaths.map(p=>fs.readFile(p)))).toEqual(damaged);
 }finally{provider.releaseInspection();await app.Shutdown();await provider.close();await f.cleanup()}
},120000);
