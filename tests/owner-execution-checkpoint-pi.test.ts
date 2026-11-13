import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {GraphSnapshot} from '../src/logic/tasks/rules/graph-types';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';
import {seedOwnerExecution,ownerExecutionData as data,ownerExecutionRecords} from './owner-execution-fixture';
import {ownerCheckpointProvider,ownerCheckpointData,type OwnerCheckpointMode} from './owner-execution-checkpoint-provider';
import {moduleOwnershipChange,commitModuleOwnership} from './module-ownership-fixture';

it.each(['complete','before-reservation','before-claim'] as OwnerCheckpointMode[])('keeps owner identity and original native channel across real checkpoint gates (%s)',async mode=>{
  const f=await fixture(),provider=await ownerCheckpointProvider(mode);let app=f.app,id='';
  try{
    const seeded=await seedOwnerExecution(app,f.a,provider.urls);id=seeded.entry.id;provider.bind(seeded.team.input.agentId,seeded.modules[0]);
    const started=await app.dispatch('loop.chat',{id,message:ownerCheckpointData.goal,options:{...seeded.mainOptions,permission:'execute'}}),identity={workspaceId:id,rootSessionId:started.taskId},records=()=>ownerExecutionRecords(f.user,id),graph=()=>app.dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>;
    await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(provider.state.parked).toBeDefined()},{timeout:60000,interval:30});
    const initial=await records(),task=provider.state.parked!.tasks[0],checkpoint=task.checkpoints![0],oldRun=initial.runs[0],canonical=path.join(f.user,id,'dispatch','runs','tasks',task.taskId,oldRun.binding.runId,'events.jsonl'),originalBytes=await fs.readFile(canonical);
    expect(oldRun.status).toBe('completed');expect(oldRun.prepared.memberContext?.binding).toEqual(task.ownerBinding);expect(oldRun.model.model).toBe(data.models[0]);expect(oldRun.session.sessionFile).toBeTruthy();
    const originalNative=await fs.readFile(oldRun.session.sessionFile!),marker=await fs.stat(path.join(f.a,data.files[0]));expect(provider.member).toHaveLength(7);
    const changeOwner=async()=>commitModuleOwnership(app,id,await moduleOwnershipChange(app,id,seeded.modules[0],{memberId:seeded.positions[1].member.memberId,expectedRevision:seeded.positions[1].member.revision},'真实检查点窗口更换模块负责人，旧岗位不可自动取得新执行许可'));
    if(mode==='before-reservation')await changeOwner();provider.releaseBefore();
    if(mode!=='before-reservation'){
      await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(provider.state.queued).toBeDefined()},{timeout:30000,interval:30});expect((await records()).runs).toHaveLength(1);expect(provider.member).toHaveLength(7);
      if(mode==='before-claim')await changeOwner();provider.releaseAfter();
    }
    await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0]?.status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:60000,interval:30});
    const saved=await records(),finished=await graph(),next=finished.tasks[0];expect(next.taskId).toBe(task.taskId);expect(next.assignee).toEqual(task.assignee);expect(next.ownerBinding).toEqual(task.ownerBinding);expect(next.checkpoints).toEqual([checkpoint]);expect(await fs.readFile(canonical)).toEqual(originalBytes);expect((await fs.stat(path.join(f.a,data.files[0]))).mtimeMs).toBe(marker.mtimeMs);
    if(mode==='complete'){
      expect(saved.scopes[0].outcome).toBe('completed');expect(saved.runs).toHaveLength(2);expect(provider.member).toHaveLength(12);
      const resumed=saved.runs.find(run=>run.binding.runId!==oldRun.binding.runId)!;expect(resumed.binding.taskId).toBe(oldRun.binding.taskId);expect(resumed.binding.agentInstanceId).toBe(oldRun.binding.agentInstanceId);expect(resumed.binding.agentSessionId).toBe(oldRun.binding.agentSessionId);expect(resumed.session).toEqual(oldRun.session);expect(resumed.prepared.memberContext).toEqual(oldRun.prepared.memberContext);expect(resumed.model).toEqual(oldRun.model);expect(next.result?.evidenceRefs).toEqual(['owner-checkpoint-new-read']);
    }else{expect(saved.scopes[0].outcome).toBe('failed');expect(saved.runs).toHaveLength(1);expect(provider.member).toHaveLength(7);expect(next.result).toBeUndefined();expect(await fs.readFile(oldRun.session.sessionFile!)).toEqual(originalNative);if(mode==='before-reservation')expect(next.resumeRequest).toBeUndefined()}
    const storage=new FileRunStorage(),summaries=await Promise.all(saved.runs.map(run=>storage.read(path.join(f.user,id,'dispatch','runs','tasks',run.binding.taskId,run.binding.runId))));
    expect(summaries.flatMap(summary=>summary.toolReceipts??[]).filter(receipt=>receipt.toolName==='write'&&receipt.outcome==='succeeded')).toHaveLength(1);
    for(const summary of summaries){expect(summary.task.ownerBinding).toEqual(task.ownerBinding);expect(summary.sessionFile).toBe(oldRun.session.sessionFile);expect(summary.events.some(event=>event.type==='session.bound'&&event.data.sessionId===oldRun.session.nativeSessionId)).toBe(true)}
    const stableNative=await fs.readFile(oldRun.session.sessionFile!),sequence=[...provider.sequence];await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await records()).toEqual(saved);expect(await graph()).toEqual(finished);expect(provider.sequence).toEqual(sequence);expect(await fs.readFile(oldRun.session.sessionFile!)).toEqual(stableNative);expect(await fs.readFile(canonical)).toEqual(originalBytes);
    await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/owner-execution-checkpoint-${mode}-pi-evidence.json`,JSON.stringify({mode,workspaceId:id,taskId:task.taskId,memberId:task.ownerBinding?.memberId,outcome:saved.scopes[0].outcome,runs:saved.runs.map(run=>({binding:run.binding,model:run.model,session:run.session,resumeFrom:run.resumeFrom})),requests:{main:provider.main.length,member:provider.member.length},writeCount:1,originalCheckpointPreserved:true,noReplayOnRestart:true,errors:provider.errors},null,2));
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/owner-execution-checkpoint-${mode}-pi-failure.json`,JSON.stringify({mode,error:String(error),state:provider.state,requests:{main:provider.main.length,member:provider.member.length},errors:provider.errors,records:id?await ownerExecutionRecords(f.user,id).catch(()=>undefined):undefined},null,2));throw error}
  finally{provider.releaseBefore();provider.releaseAfter();await app.shutdown();await f.cleanup();await provider.close()}
},120000);
