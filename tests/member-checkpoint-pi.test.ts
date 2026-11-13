import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {TaskNode} from '../src/logic/tasks/rules/graph-types';
import {memberCheckpointProvider,memberCheckpointFixture as data,type CheckpointFixtureMode} from './member-checkpoint-provider';
import {seedMemberCheckpoint,checkpointRecords,checkpointRuns,checkpointLogBytes,assertCheckpointGraph} from './member-checkpoint-fixture';

it.each(['complete','stop','restart','command-rejected'] as CheckpointFixtureMode[])('continues only a safe file-bound checkpoint with original identities (%s)',async mode=>{
  const f=await fixture(),provider=await memberCheckpointProvider(mode);let reopened:Application|undefined;
  try{
    const {entry}=await seedMemberCheckpoint(f.app,f.a,provider),start=await f.app.dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:'execute',turnTimeoutMs:60000}}) as {taskId:string;runId:string};
    const identity={workspaceId:entry.id,rootSessionId:start.taskId},records=()=>checkpointRecords(f.user,entry.id),graph=()=>f.app.dispatch('dispatch.graphSnapshot',{identity});
    await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(provider.state.parked).toBeTruthy()},{timeout:45000,interval:30});
    if(mode==='command-rejected'){
      expect(provider.state.checkpointRejected).toBeTruthy();await vi.waitFor(async()=>expect((await records()).scopes[0].status).toBe('closed'),{timeout:30000,interval:30});
      const rejected=await graph(),runs=await checkpointRuns(f.user,entry.id);expect(rejected.tasks[0].checkpoints??[]).toEqual([]);expect(rejected.tasks[0].status).toBe('failed');expect(rejected.tasks[0].result).toBeUndefined();expect(runs).toHaveLength(1);expect(runs[0].checkpointProof).toBeUndefined();expect(runs[0].resumeFrom).toBeUndefined();expect(provider.main).toHaveLength(8);expect(provider.member).toHaveLength(7);
      const logs=await checkpointLogBytes(f.user,entry.id,runs),saved=await records(),sequence=[...provider.sequence];expect(saved.scopes[0].outcome).toBe('failed');expect(await fs.readFile(path.join(f.a,data.files[0]),'utf8')).toBe(data.facts[0]);await f.app.shutdown();reopened=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await reopened.init();expect(await checkpointLogBytes(f.user,entry.id,runs)).toEqual(logs);expect(await records()).toEqual(saved);expect(provider.sequence).toEqual(sequence);return;
    }
    const parked=provider.state.parked!,parkedTask=parked.tasks.find(task=>task.goal===data.goals[0])!,initialRuns=await checkpointRuns(f.user,entry.id),initialLogs=await checkpointLogBytes(f.user,entry.id,initialRuns),first=initialRuns[0],markerStat=await fs.stat(path.join(f.a,data.files[0]));
    expect(parkedTask.status).toBe('checkpointed');expect(parkedTask.activeRunId).toBeUndefined();expect(parkedTask.checkpoints).toHaveLength(1);expect(parkedTask.result).toBeUndefined();expect(first.status).toBe('completed');expect(first.checkpointProof).toBeTruthy();expect(provider.member).toHaveLength(7);expect(provider.main).toHaveLength(7);expect((await records()).scopes[0].status).toBe('active');
    const admitted=await f.app.dispatch('admission.read',{});expect(admitted.kind).toBe('snapshot');if(admitted.kind==='snapshot')expect(admitted.snapshot.occupied.some((value:{agentInstanceId?:string})=>value.agentInstanceId===parkedTask.assignee.agentInstanceId)).toBe(false);
    if(mode==='restart'){
      await f.app.shutdown();provider.releaseCheckpoint();provider.releaseResume();reopened=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await reopened.init();
    }else{
      provider.releaseCheckpoint();await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(provider.state.resume).toBeTruthy();expect(provider.main).toHaveLength(8)},{timeout:30000,interval:30});
      const queued=await graph();expect(queued.tasks.find((task:TaskNode)=>task.taskId===parkedTask.taskId)?.runIds).toEqual(parkedTask.runIds);expect(await checkpointRuns(f.user,entry.id)).toEqual(initialRuns);expect(provider.member).toHaveLength(7);
      if(mode==='stop')await f.app.dispatch('loop.stop',{id:entry.id,taskId:identity.rootSessionId});provider.releaseResume();
    }
    await vi.waitFor(async()=>expect((await records()).scopes[0].status).toBe('closed'),{timeout:45000,interval:30});const current=reopened??f.app,savedGraph=await current.dispatch('dispatch.graphSnapshot',{identity}),saved=await records(),runs=await checkpointRuns(f.user,entry.id);
    if(mode==='complete'&&saved.scopes[0].outcome!=='completed'){
      await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/member-checkpoint-pi-diagnostic.json',JSON.stringify({state:provider.state,errors:provider.errors,sequence:provider.sequence,returnedMessages:provider.main[8]?.messages,graph:savedGraph,records:saved,runs},null,2));
    }
    const nodes=assertCheckpointGraph(savedGraph,parked,runs,mode==='complete'),logs=await checkpointLogBytes(f.user,entry.id,runs);
    expect(logs[first.binding.runId]).toBe(initialLogs[first.binding.runId]);expect((await fs.stat(path.join(f.a,data.files[0]))).mtimeMs).toBe(markerStat.mtimeMs);expect(provider.main).toHaveLength(mode==='complete'?17:mode==='stop'?8:7);expect(provider.member).toHaveLength(mode==='complete'?22:7);expect(mode==='restart'?['cancelled','interrupted']:mode==='complete'?['completed']:['cancelled']).toContain(saved.scopes[0].outcome);
    const events=Object.values(logs).flatMap(raw=>raw.trim().split('\n').map(line=>JSON.parse(line)));expect(events.filter(event=>event.type==='tool.finished'&&event.data.name==='write'&&event.data.receipt?.outcome==='succeeded')).toHaveLength(1);
    if(mode==='complete')expect(provider.state.resumeProgressVersion).toBeGreaterThan(provider.state.initialProgressVersion!);else expect(nodes.a.resumeRequest!==undefined).toBe(mode==='stop');
    for(let i=0;i<data.files.length;i++)expect(await fs.readFile(path.join(f.a,data.files[i]),'utf8')).toBe(data.facts[i]);const sequence=[...provider.sequence];await current.shutdown();reopened=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await reopened.init();expect(await records()).toEqual(saved);expect(await reopened.dispatch('dispatch.graphSnapshot',{identity})).toEqual(savedGraph);expect(await checkpointRuns(f.user,entry.id)).toEqual(runs);expect(await checkpointLogBytes(f.user,entry.id,runs)).toEqual(logs);expect(provider.sequence).toEqual(sequence);expect(provider.errors).toEqual([]);
  }finally{provider.releaseCheckpoint();provider.releaseResume();if(reopened)await reopened.shutdown();await f.cleanup();await provider.close()}
},150000);
