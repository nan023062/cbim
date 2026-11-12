import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {memberCheckpointChainProvider,memberChainData as data} from './member-checkpoint-chain-provider';
import {seedMemberCheckpoint,checkpointRecords,checkpointRuns,checkpointLogBytes} from './member-checkpoint-fixture';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {GoalContinuationRequest} from '../src/backend/core/tasks/scope-continuation';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import {memberCheckpointView} from '../src/frontend/tasks/member-checkpoint-state';

it.each(['complete','stop','abandon'] as const)('two durable checkpoints retain their chain through real Pi and restart (%s)',async mode=>{
  const f=await fixture(),provider=await memberCheckpointChainProvider(mode==='abandon');let app=f.app;
  try{
    const {entry}=await seedMemberCheckpoint(app,f.a,provider),profileId=(await app.models.list()).selectedId!;
    const start=await app.dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:'execute',turnTimeoutMs:60000}}),identity={workspaceId:entry.id,rootSessionId:start.taskId},records=()=>checkpointRecords(f.user,entry.id),graph=():Promise<GraphSnapshot>=>app.dispatch('dispatch.graphSnapshot',{identity});
    const receipts:GoalContinuationRequest[]=[],waits:unknown[]=[],frozenLogs:Record<string,string>[]=[];
    for(let round=1;round<=2;round++){
      await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0].status).toBe('waiting');expect(provider.main).toHaveLength(round===1?8:16);expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:60000,interval:40});
      const before=await records(),waiting=before.scopes[0],parked=await graph(),runs=await checkpointRuns(f.user,entry.id),logs=await checkpointLogBytes(f.user,entry.id,runs),native=await fs.readFile(runs.at(-1)!.session.sessionFile!);waits.push(waiting.wait);frozenLogs.push(logs);
      expect(parked.tasks[0].checkpoints).toHaveLength(round);expect(parked.tasks[0].runIds).toHaveLength(round);expect(parked.tasks[1].runIds).toEqual([]);expect(memberCheckpointView(parked.tasks[0])).toMatchObject({phase:'parked',segment:round,total:round});expect(provider.member).toHaveLength(round===1?7:12);
      if(round===2){expect(parked.tasks[0].resumeRequest).toBeDefined();expect(parked.tasks[0].resumeHistory).toBeUndefined();expect(memberCheckpointView(parked.tasks[0],parked.tasks[0].runIds[0]).phase).toBe('resumed')}
      const sequence=[...provider.sequence];await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await records()).toEqual(before);expect(await graph()).toEqual(parked);expect(await fs.readFile(runs.at(-1)!.session.sessionFile!)).toEqual(native);expect(provider.sequence).toEqual(sequence);
      const input:GoalContinuationRequest={...identity,scopeId:waiting.scopeId,waitId:waiting.wait!.waitId,expectedGoalRevision:waiting.goal!.revision,expectedInputRevision:waiting.goal!.inputRevision??1,commandId:randomUUID(),input:{message:data.supplement},options:{provider:'cbim-'+profileId,model:data.model,profileId,permission:'execute',turnTimeoutMs:60000}};
      if(round===2&&mode==='stop'){await app.dispatch('loop.stop',{id:entry.id,taskId:start.taskId});await expect(app.dispatch('loop.goalContinue',input)).rejects.toThrow();break}
      if(round===2&&mode==='complete'){
        await fs.writeFile(path.join(f.a,data.files[0]),'outside change to first-segment-only file');await expect(app.dispatch('loop.goalContinue',input)).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_ARTIFACT_CHANGED'});expect(await records()).toEqual(before);expect(provider.sequence).toEqual(sequence);await fs.writeFile(path.join(f.a,data.files[0]),data.facts[0]);
      }
      const accepted=await Promise.all([app.dispatch('loop.goalContinue',input),app.dispatch('loop.goalContinue',input)]);expect(accepted[0].continuation).toEqual(accepted[1].continuation);expect(accepted[0].continuation.wait).toEqual(waiting.wait);receipts.push(input);
    }
    await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0].status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:60000,interval:40});
    const saved=await records(),finalGraph=await graph(),runs=await checkpointRuns(f.user,entry.id),task=finalGraph.tasks[0],complete=mode==='complete';expect(task.checkpoints).toHaveLength(2);expect(task.runIds).toHaveLength(complete?3:2);expect(saved.scopes[0].continuations!.map(c=>c.wait)).toEqual(complete||mode==='abandon'?waits:waits.slice(0,1));expect(await checkpointLogBytes(f.user,entry.id,runs.filter(r=>task.runIds.slice(0,2).includes(r.binding.runId)))).toEqual(frozenLogs[1]);
    if(complete){expect(saved.scopes[0].outcome).toBe('completed');expect(task.status).toBe('result_ready');expect(task.resumeHistory).toHaveLength(1);expect(task.result!.runId).toBe(task.runIds[2]);expect(finalGraph.tasks.every(t=>t.status==='result_ready')).toBe(true)}
    else{expect(task.status).toBe('cancelled');expect(finalGraph.tasks.slice(1).every(t=>!t.runIds.length)).toBe(true);expect(task.checkpointAbandonment?.checkpointId).toBe(mode==='abandon'?task.checkpoints![1].checkpointId:undefined);expect(memberCheckpointView(task).phase).toBe(mode==='abandon'?'abandoned':'sealed')}
    expect(provider.main).toHaveLength(complete?24:mode==='stop'?16:23);expect(provider.member).toHaveLength(complete?27:12);expect(await fs.readFile(path.join(f.a,data.files[0]),'utf8')).toBe(data.facts[0]);
    const sequence=[...provider.sequence];await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await records()).toEqual(saved);expect(await graph()).toEqual(finalGraph);
    for(const input of receipts){const read=await app.dispatch('loop.goalContinuation',{...identity,scopeId:input.scopeId,commandId:input.commandId});expect((await app.dispatch('loop.goalContinue',input)).continuation).toEqual(read!.continuation)}expect(provider.sequence).toEqual(sequence);
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/member-chain-pi-'+mode+'-diagnostic.json',JSON.stringify({error:String(error),state:provider.state,main:provider.main.length,member:provider.member.length,errors:provider.errors,sequence:provider.sequence},null,2));throw error}
  finally{await app.shutdown();await f.cleanup();await provider.close()}
},180000);
