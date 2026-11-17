import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from '../../application/support/helpers';
import {businessReplanProvider,businessReplanFixture as data} from './support/business-replan-provider';
import {prepareRecursiveReplan} from './support/recursive-replan-fixture';
import {Application} from '../../../../../src/bridge/server/application';
import {Paths} from '../../../../../src/logic/workspace/service/paths';
import type {ReplanRequest} from '../../../../../src/logic/tasks/rules/scope-replan';

it.each(['execute','ask','stop'] as const)('creates explicit recursive business work from verified inspection (%s)',async mode=>{
 const f=await fixture(),provider=await businessReplanProvider({recursive:true,holdBusiness:true,holdOld:true});let app=f.app;
 try{
  const seed=await prepareRecursiveReplan(app,f.a,f.user,provider),{entry,identity,profileId,inspection,inspectionRun,oldScope,oldRun}=seed;
  const query={...identity,inspectionScopeId:inspection.scopeId},journal=path.join(f.user,entry.id,'dispatch/dispatch.jsonl'),before=await fs.readFile(journal),preview=await app.Dispatch('dispatch.replans.preview',query);
  expect(preview.eligible,JSON.stringify(preview)).toBe(true);expect(preview.requiredModules.map(item=>item.moduleId)).toEqual(inspectionRun.prepared.modules.map(item=>item.binding.moduleId));
  expect((await app.Dispatch('dispatch.replans.preview',query)).basis).toBe(preview.basis);expect(await fs.readFile(journal)).toEqual(before);
  const evidence=path.join(f.user,entry.id,'loop-engine/tasks',inspectionRun.binding.taskId,inspectionRun.binding.runId,'events.jsonl'),bytes=await fs.readFile(evidence);
  await fs.appendFile(evidence,'{"incomplete":');
  try{expect((await app.Dispatch('dispatch.replans.preview',query)).eligible).toBe(false)}finally{await fs.writeFile(evidence,bytes)}
  const request:ReplanRequest={...identity,commandId:randomUUID(),source:{inspectionScopeId:inspection.scopeId,expectedBasis:preview.basis!},input:{message:data.businessGoal},options:{profileId,provider:'cbim-'+profileId,model:'report-fixture',permission:mode==='ask'?'ask':'execute',turnTimeoutMs:30000}},lookup={...identity,commandId:request.commandId};
  await expect(app.Dispatch('loop.replanStart',{...request,source:{...request.source,expectedBasis:'0'.repeat(64)}})).rejects.toThrow();
  await expect(app.Dispatch('loop.replanStart',{...request,options:{...request.options,permission:'read'}} as never)).rejects.toThrow();
  expect(await seed.scopes()).toEqual([oldScope,inspection]);expect(provider.mainRequests).toHaveLength(4);
  const [receipt,duplicate]=await Promise.all([app.Dispatch('loop.replanStart',request),app.Dispatch('loop.replanStart',request)]);
  expect(duplicate.replan).toEqual(receipt.replan);expect(receipt.replan.source.proof).toMatchObject({executionModel:'agent-tools-v1',sourceAcceptance:oldRun.request!.acceptance,sourceTaskId:oldRun.binding.taskId,inspectionRunId:inspection.recovery!.context.initialRunId});
  expect(receipt.replan.source.proof).not.toHaveProperty('inspectionPlanRevision');expect(JSON.stringify(receipt)).not.toContain('excludedRunIds');
  await seed.wait(async()=>provider.mainRequests.length===5,'new root held');
  const newInput=JSON.stringify(provider.mainRequests[4].messages);
  for(const requirement of oldRun.request!.acceptance)expect(newInput).toContain(requirement);
  for(const module of oldRun.prepared.modules)expect(newInput).toContain(module.binding.moduleId);
  expect((await app.Dispatch('loop.replanStart',request)).replan).toEqual(receipt.replan);
  await expect(app.Dispatch('loop.replanStart',{...request,input:{message:'changed'}})).rejects.toThrow();
  if(mode==='stop')await app.Dispatch('loop.stop',{id:entry.id,taskId:identity.rootSessionId});
  else{
   provider.releaseBusiness();
   if(mode==='ask'){
    const input={id:entry.id,taskId:identity.rootSessionId};
    await seed.wait(async()=>(await app.Dispatch('loop.approvals',input)).some(item=>item.name==='write'),'actual write approval');
    await expect(fs.access(path.join(f.a,data.result))).rejects.toThrow();
    const approval=(await app.Dispatch('loop.approvals',input)).find(item=>item.name==='write')!;
    await app.Dispatch('loop.approve',{...input,approvalId:approval.id,allow:true});
   }
  }
  await seed.wait(async()=>(await seed.scopes())[2]?.status==='closed'&&app.runtime.Snapshot().pressure.activeRuns===0,'new business closed');
  const scopes=await seed.scopes(),business=scopes[2],state=await app.Workspace(entry.id).dispatchStore.Read();
  expect(business.outcome).toBe(mode==='stop'?'cancelled':'completed');expect(scopes.slice(0,2)).toEqual([oldScope,inspection]);expect(state.graphs[0].tasks).toEqual([]);
  expect(state.agentBusinessRuns!.find(run=>run.binding.runId===oldRun.binding.runId)).toEqual(oldRun);
  expect(business.replan!.context.nativeSessionId).not.toBe(inspection.recovery!.context.nativeSessionId);
  if(mode==='stop'){expect(provider.mainRequests).toHaveLength(5);expect(provider.memberRequests).toHaveLength(8);await expect(fs.access(path.join(f.a,data.result))).rejects.toThrow()}
  else{
   expect(provider.mainRequests).toHaveLength(6);expect(provider.memberRequests).toHaveLength(15);expect(await fs.readFile(path.join(f.a,data.result),'utf8')).toBe(data.resultText);
   const run=state.agentBusinessRuns!.find(run=>run.scopeId===business.scopeId)!;expect(run.binding.agentInstanceId).not.toBe(inspectionRun.binding.agentInstanceId);expect(run.request?.acceptance).toEqual(oldRun.request!.acceptance);
  }
  await seed.unchanged();expect(await fs.readFile(seed.marker,'utf8')).toBe(data.markerLine);expect((await fs.stat(seed.marker)).mtimeMs).toBe(seed.markerStat.mtimeMs);
  expect((await app.Dispatch('loop.queue',{id:entry.id,taskId:identity.rootSessionId}))[0]).toMatchObject({message:data.queued,status:'paused'});
  expect((await app.Dispatch('dispatch.replans.preview',query)).eligible).toBe(false);
  const counts=[provider.mainRequests.length,provider.memberRequests.length];
  await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init();
  expect(await seed.scopes()).toEqual(scopes);expect((await app.Dispatch('loop.replanReceipt',lookup))?.scopeStatus).toBe('closed');expect((await app.Dispatch('loop.replanStart',request)).replan).toEqual(receipt.replan);
  expect([provider.mainRequests.length,provider.memberRequests.length]).toEqual(counts);await seed.unchanged();expect(provider.errors).toEqual([]);
 }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/recursive-replan-'+mode+'.json',JSON.stringify({error:String(error),main:provider.mainRequests,member:provider.memberRequests,errors:provider.errors},null,2));throw error}
 finally{provider.releaseBusiness();provider.releaseOld();await app.Shutdown();await provider.close();await f.cleanup()}
},120000);
