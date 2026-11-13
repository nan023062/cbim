import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {memberPauseProvider,memberPauseData as data} from './member-pause-provider';
import {seedMemberCheckpoint,checkpointRecords,checkpointRuns,checkpointLogBytes,assertCheckpointGraph} from './member-checkpoint-fixture';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {GoalContinuationRequest} from '../src/logic/tasks/rules/scope-continuation';

it.each(['complete-restart','stop-wait','changed-files','submitted-stop'] as const)('durable member pause and explicit continuation through real Pi (%s)',async mode=>{
  const f=await fixture(),provider=await memberPauseProvider(mode==='submitted-stop');let app=f.app;
  try{
    const {entry}=await seedMemberCheckpoint(app,f.a,provider),profileId=(await app.models.list()).selectedId!;
    const start=await app.dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:'execute',turnTimeoutMs:60000}}) as {taskId:string;runId:string},identity={workspaceId:entry.id,rootSessionId:start.taskId};
    const records=()=>checkpointRecords(f.user,entry.id),graph=()=>app.dispatch('dispatch.graphSnapshot',{identity});
    await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0].status).toBe('waiting');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:45000,interval:30});
    const original=await records(),waiting=original.scopes[0],parked=await graph(),runs=await checkpointRuns(f.user,entry.id),logs=await checkpointLogBytes(f.user,entry.id,runs),native=await fs.readFile(runs[0].session.sessionFile!);expect(waiting.wait?.memberPause?.tasks).toHaveLength(3);expect(provider.main).toHaveLength(8);expect(provider.member).toHaveLength(7);
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await records()).toEqual(original);expect(await graph()).toEqual(parked);expect(await fs.readFile(runs[0].session.sessionFile!)).toEqual(native);expect(provider.main).toHaveLength(8);expect(provider.member).toHaveLength(7);
    const input:GoalContinuationRequest={...identity,scopeId:waiting.scopeId,waitId:waiting.wait!.waitId,expectedGoalRevision:waiting.goal!.revision,expectedInputRevision:waiting.goal!.inputRevision??1,commandId:randomUUID(),input:{message:data.supplement},options:{provider:'cbim-'+profileId,model:data.model,profileId,permission:'execute',turnTimeoutMs:60000}};
    if(mode==='stop-wait')await app.dispatch('loop.stop',{id:entry.id,taskId:start.taskId});
    else{
      if(mode==='changed-files'){
        await expect(app.dispatch('loop.goalContinue',{...input,options:{...input.options,permission:'read'}})).rejects.toMatchObject({code:'GOAL_MEMBER_PAUSE_PERMISSION'});expect(await records()).toEqual(original);expect(provider.main).toHaveLength(8);
        await fs.writeFile(path.join(f.a,data.files[0]),'external update');await expect(app.dispatch('loop.goalContinue',input)).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_ARTIFACT_CHANGED'});expect(await records()).toEqual(original);expect(provider.main).toHaveLength(8);expect(provider.member).toHaveLength(7);await fs.writeFile(path.join(f.a,data.files[0]),data.facts[0]);
      }
      const accepted=await app.dispatch('loop.goalContinue',input);expect(accepted.continuation.wait).toEqual(waiting.wait);expect((await app.dispatch('loop.goalContinue',input)).continuation).toEqual(accepted.continuation);
      if(mode==='submitted-stop'){await vi.waitFor(()=>expect(provider.state.continued).toBe(true),{timeout:15000});await app.dispatch('loop.stop',{id:entry.id,taskId:start.taskId});provider.releaseContinuation()}
    }
    await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0].status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:60000,interval:40});
    const complete=mode==='complete-restart'||mode==='changed-files',saved=await records(),finalGraph=await graph(),finalRuns=await checkpointRuns(f.user,entry.id);assertCheckpointGraph(finalGraph,parked,finalRuns,complete);expect(saved.scopes[0].outcome).toBe(complete?'completed':'cancelled');expect(saved.scopes[0].goal!.input).toEqual(waiting.goal!.input);expect((await checkpointLogBytes(f.user,entry.id,runs))).toEqual(logs);expect(provider.main).toHaveLength(complete?22:mode==='stop-wait'?8:9);expect(provider.member).toHaveLength(complete?22:7);
    if(!complete)expect(await fs.readFile(runs[0].session.sessionFile!)).toEqual(native);else expect(saved.scopes[0].continuations![0].wait).toEqual(waiting.wait);
    if(mode==='stop-wait')await expect(app.dispatch('loop.goalContinue',input)).rejects.toThrow();else{const receipt=await app.dispatch('loop.goalContinuation',{...identity,scopeId:waiting.scopeId,commandId:input.commandId});expect((await app.dispatch('loop.goalContinue',input)).continuation).toEqual(receipt!.continuation)}
    const sequence=[...provider.sequence];await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await records()).toEqual(saved);expect(await graph()).toEqual(finalGraph);expect(await checkpointRuns(f.user,entry.id)).toEqual(finalRuns);expect(provider.sequence).toEqual(sequence);expect(provider.errors).toEqual([]);
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/member-pause-pi-'+mode+'-diagnostic.json',JSON.stringify({error:String(error),state:provider.state,main:provider.main.length,member:provider.member.length,errors:provider.errors,sequence:provider.sequence},null,2));throw error}
  finally{provider.releaseContinuation();await app.shutdown();await f.cleanup();await provider.close()}
},150000);
