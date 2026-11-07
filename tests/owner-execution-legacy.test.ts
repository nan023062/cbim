import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {createOwnerExecutionLegacyFixture,ownerExecutionLegacyExecutable} from './owner-execution-legacy-fixture';
import {ownerExecutionRecords} from './owner-execution-fixture';
import {knowledgeSourceDiskEvidence} from './knowledge-source-lifecycle-fixture';

it.skipIf(!existsSync(ownerExecutionLegacyExecutable()))('reads genuine pre-owner queued/running/checkpoint records, settles old intent without rebinding, and rejects new legacy claims',async()=>{
  const legacy=await createOwnerExecutionLegacyFixture();let app:Application|undefined,passed=false;
  try{
    app=new Application(new Paths(legacy.user,path.resolve('.')),path.resolve('design'));await app.init();const current=app,id=legacy.workspaceId,old=legacy.evidence;
    await vi.waitFor(async()=>{expect(current.runtime.snapshot().pressure.activeRuns).toBe(0);expect((await ownerExecutionRecords(legacy.user,id)).runs.every(run=>run.status!=='running'&&run.status!=='starting')).toBe(true)},{timeout:30000,interval:30});
    const records=await ownerExecutionRecords(legacy.user,id),queuedIdentity={workspaceId:id,rootSessionId:old.queued.input.rootSessionId,taskId:old.queued.receipt.taskId};
    const queued=await current.dispatch('dispatch.graphSnapshot',{identity:{workspaceId:id,rootSessionId:queuedIdentity.rootSessionId}});
    expect(queued).toEqual(old.queuedGraph);expect(queued.tasks[0].ownerBinding).toBeUndefined();
    const bytes=(await knowledgeSourceDiskEvidence(legacy.user,id)).dispatchBytes;
    expect(await current.dispatch('dispatch.task',old.queued.input)).toEqual(old.queued.receipt);
    await expect(current.dispatch('dispatch.executionStart',{...queuedIdentity,commandId:randomUUID(),expectedRevision:queued.tasks[0].revision,options:{permission:'read'}})).rejects.toMatchObject({code:'OWNER_BINDING_REQUIRED'});
    expect((await knowledgeSourceDiskEvidence(legacy.user,id)).dispatchBytes).toEqual(bytes);
    expect(await current.dispatch('dispatch.ownerInspect',queuedIdentity)).toMatchObject({taskId:queuedIdentity.taskId,taskRevision:queued.tasks[0].revision});
    const inspection=await current.dispatch('dispatch.ownerInspect',queuedIdentity);expect(inspection.ownerBinding).toBeUndefined();
    const live=records.runs.find(run=>run.binding.runId===old.run.runId)!;expect(live).toBeDefined();expect(live.status).toBe('interrupted');expect(live.prepared.memberContext).toBeUndefined();
    const oldLive=old.records.runs.find(run=>run.binding.runId===old.run.runId)!;expect(live.binding).toEqual(oldLive.binding);expect(live.model).toEqual(oldLive.model);expect(live.prepared).toEqual(oldLive.prepared);
    const parked=await current.dispatch('dispatch.graphSnapshot',{identity:{workspaceId:id,rootSessionId:old.main.taskId}}),original=old.parked.tasks.find(task=>task.taskId===old.checkpointTaskId)!;
    expect(parked.tasks.find((task:{taskId:string})=>task.taskId===old.checkpointTaskId)?.checkpoints).toEqual(original.checkpoints);
    expect(parked.tasks.every((task:{ownerBinding?:unknown})=>task.ownerBinding===undefined)).toBe(true);
    for(const row of legacy.originalRunBytes){expect(await fs.readFile(row.sessionFile)).toEqual(row.native);const actual=await fs.readFile(row.canonicalPath);expect(actual.subarray(0,row.canonical.length)).toEqual(row.canonical)}
    expect(legacy.counts()).toEqual(old.requestCounts);expect(legacy.providerErrors()).toEqual([]);
    const stabilized=(await knowledgeSourceDiskEvidence(legacy.user,id)).dispatchBytes;await current.shutdown();app=new Application(new Paths(legacy.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect((await knowledgeSourceDiskEvidence(legacy.user,id)).dispatchBytes).toEqual(stabilized);expect(await ownerExecutionRecords(legacy.user,id)).toEqual(records);expect(legacy.counts()).toEqual(old.requestCounts);
    await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/owner-execution-legacy-application-evidence.json',JSON.stringify({oldExecutable:old.executable,workspaceId:id,killedTestPid:old.killedPid,actualQueuedTask:old.queued.receipt.taskId,actualRunningTask:old.live.receipt.taskId,actualCheckpointTask:old.checkpointTaskId,oldRunningFinalStatus:live.status,originalReceiptStable:true,legacyClaimError:'OWNER_BINDING_REQUIRED',originalModelsAndPreparedBytesPreserved:true,originalNativeBytesPreserved:true,canonicalOriginalPrefixesPreserved:true,noOwnerBindingBackfill:true,restartWithoutReplay:true,requestCounts:legacy.counts()},null,2));passed=true;
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/owner-execution-legacy-application-failure.json',JSON.stringify({...legacy.evidence,error:String(error),actualCounts:legacy.counts(),providerErrors:legacy.providerErrors(),retained:true},null,2));throw error}
  finally{if(app)await app.shutdown();await legacy.cleanup(passed)}
},150000);
