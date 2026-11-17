import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../../application/unittest/support/helpers';
import {Application} from '../../../../bridge/server/application';
import {Paths} from '../../../workspace/service/paths';
import {jsonValidationProvider,jsonValidationFixture as data} from './support/json-validation-provider';
import {jsonValidationRecords,jsonValidationLogBytes} from './support/json-validation-fixture';
import {seedWorkflowSelection,assertWorkflowSelection} from './support/workflow-selection-fixture';

it.each(['complete','stop']as const)('explicit second workflow controls actual Pi JSON delivery and stays bound (%s)',async mode=>{
  const f=await fixture(),provider=await jsonValidationProvider(mode,data,true);let app=f.app;
  try{
    const seeded=await seedWorkflowSelection(app,f.a,provider),started=await app.Dispatch('loop.chat',{id:seeded.entry.id,message:data.goal,options:{permission:'execute',turnTimeoutMs:60000}}),records=()=>jsonValidationRecords(f.user,seeded.entry.id),identity={workspaceId:seeded.entry.id,rootSessionId:started.taskId},graph=()=>app.Dispatch('dispatch.graphSnapshot',{identity});
    const until=async(check:()=>Promise<void>|void)=>{await vi.waitFor(async()=>{if(provider.errors.length)return;await check()},{timeout:45000,interval:30});expect(provider.errors,JSON.stringify(provider.errors)).toEqual([])};
    await until(()=>expect(provider.state.deniedDelivery).toMatchObject({code:'WORKFLOW_VALIDATION_REQUIRED',retryable:false}));expect(provider.state.rejected.validation.outcome).toBe('rejected');expect(seeded.firstContract.delivery).not.toHaveProperty('requiredValidations');const bound=await assertWorkflowSelection(f.user,seeded.entry.id,started,seeded.selection);expect(bound.workflowVersion).toBe(seeded.workflowVersion);expect(bound.selection.workflowId).not.toBe(seeded.firstWorkflowId);expect(provider.main).toHaveLength(1);expect(provider.member).toHaveLength(9);
    if(mode==='stop'){await app.Dispatch('loop.stop',{id:seeded.entry.id,taskId:started.taskId});provider.releaseAll()}
    else{provider.releaseRepair();await until(()=>expect(provider.state.readyForReview).toBe(true));expect(provider.state.passed.validation.outcome).toBe('passed');await assertWorkflowSelection(f.user,seeded.entry.id,started,seeded.selection,true);provider.releaseReview()}
    await until(async()=>{expect((await records()).scopes[0].status).toBe('closed');expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0)});const saved=await records(),finished=await graph();expect(saved.scopes[0].outcome).toBe(mode==='complete'?'completed':'cancelled');const finalBound=await assertWorkflowSelection(f.user,seeded.entry.id,started,seeded.selection,mode==='complete');expect(finalBound.taskId).toBe(bound.taskId);expect(finalBound.runId).toBe(bound.runId);expect(finished.tasks).toHaveLength(0);expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(mode==='complete'?data.good:data.bad);expect(provider.main).toHaveLength(mode==='complete'?3:1);expect(provider.member).toHaveLength(mode==='complete'?16:9);
    const bytes=await jsonValidationLogBytes(f.user,seeded.entry.id),stat=await fs.stat(path.join(f.a,data.file)),counts={main:provider.main.length,member:provider.member.length};await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init();expect(await records()).toEqual(saved);expect(await graph()).toEqual(finished);expect(await jsonValidationLogBytes(f.user,seeded.entry.id)).toEqual(bytes);expect((await fs.stat(path.join(f.a,data.file))).mtimeMs).toBe(stat.mtimeMs);expect({main:provider.main.length,member:provider.member.length}).toEqual(counts);expect(provider.errors).toEqual([]);
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/workflow-selection-${mode}-failure.json`,JSON.stringify({error:String(error),actual:(error as {actual?:unknown}).actual,expected:(error as {expected?:unknown}).expected,requests:{main:provider.main.length,member:provider.member.length},providerErrors:provider.errors,state:provider.state,lastMain:provider.main.at(-1)?.messages,lastMember:provider.member.at(-1)?.messages},null,2));throw error}
  finally{provider.releaseAll();await app.Shutdown();await f.cleanup();await provider.close()}
},120000);
