import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {jsonValidationProvider,jsonValidationFixture as data} from './json-validation-provider';
import {jsonValidationRecords,jsonValidationLogBytes} from './json-validation-fixture';
import {seedWorkflowSelection,assertWorkflowSelection} from './workflow-selection-fixture';

it.each(['complete','stop']as const)('explicit second workflow controls actual Pi JSON delivery and stays bound (%s)',async mode=>{
  const f=await fixture(),provider=await jsonValidationProvider(mode);let app=f.app;
  try{
    const seeded=await seedWorkflowSelection(app,f.a,provider),started=await app.dispatch('loop.chat',{id:seeded.entry.id,message:data.goal,options:{permission:'execute',turnTimeoutMs:60000}}),records=()=>jsonValidationRecords(f.user,seeded.entry.id),identity={workspaceId:seeded.entry.id,rootSessionId:started.taskId},graph=()=>app.dispatch('dispatch.graphSnapshot',{identity});
    const until=async(check:()=>Promise<void>|void)=>{await vi.waitFor(async()=>{if(provider.errors.length)return;await check()},{timeout:45000,interval:30});expect(provider.errors,JSON.stringify(provider.errors)).toEqual([])};
    await until(()=>expect(provider.state.deniedDelivery).toMatchObject({code:'WORKFLOW_VALIDATION_REQUIRED',retryable:false}));expect(provider.state.rejected.validation.outcome).toBe('rejected');expect(seeded.firstContract.delivery).not.toHaveProperty('requiredValidations');const original=await graph(),bound=await assertWorkflowSelection(f.user,seeded.entry.id,original,seeded.selection);expect(bound.workflowVersion).toBe(seeded.workflowVersion);expect(original.tasks[0].modules[0].workflow.id).not.toBe(seeded.firstWorkflowId);expect(provider.main).toHaveLength(3);expect(provider.member).toHaveLength(9);
    if(mode==='stop'){await app.dispatch('loop.stop',{id:seeded.entry.id,taskId:started.taskId});provider.releaseAll()}
    else{provider.releaseRepair();await until(()=>expect(provider.state.readyForReview).toBe(true));expect(provider.state.passed.validation.outcome).toBe('passed');await assertWorkflowSelection(f.user,seeded.entry.id,await graph(),seeded.selection,true);provider.releaseReview()}
    await until(async()=>{expect((await records()).scopes[0].status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)});const saved=await records(),finished=await graph();expect(saved.scopes[0].outcome).toBe(mode==='complete'?'completed':'cancelled');await assertWorkflowSelection(f.user,seeded.entry.id,finished,seeded.selection,mode==='complete');expect(finished.tasks[0].taskId).toBe(bound.taskId);expect(finished.tasks[0].runIds).toEqual([bound.runId]);expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(mode==='complete'?data.good:data.bad);expect(provider.main).toHaveLength(mode==='complete'?6:3);expect(provider.member).toHaveLength(mode==='complete'?16:9);
    const bytes=await jsonValidationLogBytes(f.user,seeded.entry.id),stat=await fs.stat(path.join(f.a,data.file)),counts={main:provider.main.length,member:provider.member.length};await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await records()).toEqual(saved);expect(await graph()).toEqual(finished);expect(await jsonValidationLogBytes(f.user,seeded.entry.id)).toEqual(bytes);expect((await fs.stat(path.join(f.a,data.file))).mtimeMs).toBe(stat.mtimeMs);expect({main:provider.main.length,member:provider.member.length}).toEqual(counts);expect(provider.errors).toEqual([]);
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/workflow-selection-${mode}-failure.json`,JSON.stringify({error:String(error),actual:(error as {actual?:unknown}).actual,expected:(error as {expected?:unknown}).expected,requests:{main:provider.main.length,member:provider.member.length},providerErrors:provider.errors,state:provider.state,lastMain:provider.main.at(-1)?.messages,lastMember:provider.member.at(-1)?.messages},null,2));throw error}
  finally{provider.releaseAll();await app.shutdown();await f.cleanup();await provider.close()}
},120000);
