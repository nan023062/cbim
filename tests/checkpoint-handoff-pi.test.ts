import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import type {AbandonCheckpointReceipt} from '../src/backend/core/tasks/checkpoint-handoff';
import type {MemberCheckpointHistoryPorts} from '../src/backend/scheduler-engine/members/member-checkpoint-verifier';
import {seedCheckpointHandoff,changeCheckpointOwner,checkpointHandoffRecords,checkpointHandoffRunBytes,checkpointHandoffClosed} from './checkpoint-handoff-fixture';
import {checkpointHandoffProvider,checkpointHandoffData as data,type CheckpointHandoffMode} from './checkpoint-handoff-provider';
import {additionRunBytes,additionRunByteEvidence} from './queued-dependency-addition-fixture';

it.each(['complete','reserved','prepare-stop','lost-output'] as CheckpointHandoffMode[])('hands off an actual checkpoint to fresh owner tasks without replaying original work (%s)',async mode=>{
  const f=await fixture(),provider=await checkpointHandoffProvider(mode);let app=f.app,id='',restore=()=>{},releaseHistory!:()=>void,historyEntered!:()=>void,committed:AbandonCheckpointReceipt|undefined;
  const historyGate=new Promise<void>(resolve=>releaseHistory=resolve),entered=new Promise<void>(resolve=>historyEntered=resolve);let heldHistory=false;
  try{
    const seeded=await seedCheckpointHandoff(app,f.a,provider.urls);id=seeded.entry.id;provider.bind(seeded.team.input.agentId,seeded.moduleId);
    const service=app.memberDispatch(id),original=service.abandonCheckpoint.bind(service);let calls=0,args:Parameters<typeof original>|undefined;
    const callSpy=vi.spyOn(service,'abandonCheckpoint').mockImplementation(async(...input)=>{calls++;args=input;const receipt=await original(...input);committed=structuredClone(receipt);return mode==='lost-output'?{...receipt,rootSessionId:'wrong-handoff-root'}:receipt});
    // Per-fixture private port wrapping retains the real canonical read. Only its return is held; no proof, journal or state is fabricated.
    const ports=(service as unknown as {checkpointAbandonment:{ports:MemberCheckpointHistoryPorts}}).checkpointAbandonment.ports,inspect=ports.inspect.bind(ports);
    const readSpy=vi.spyOn(ports,'inspect').mockImplementation(async run=>{const summary=await inspect(run);if(mode==='prepare-stop'&&!heldHistory){heldHistory=true;historyEntered();await historyGate}return summary});
    restore=()=>{callSpy.mockRestore();readSpy.mockRestore()};
    const started=await app.dispatch('loop.chat',{id,message:data.goal,options:seeded.mainOptions}),identity={workspaceId:id,rootSessionId:started.taskId},records=()=>checkpointHandoffRecords(f.user,id),graph=()=>app.dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>;
    await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(provider.state.readyForHandoff).toBe(true)},{timeout:60000,interval:30});
    const before=await graph(),old=data.oldGoals.map(goal=>before.tasks.find(task=>task.goal===goal)!),originalA=old[0],initialRecords=await records(),originalRun=initialRecords.runs[0],originalBytes=await checkpointHandoffRunBytes(f.user,id,originalRun);
    expect(initialRecords.runs).toHaveLength(1);expect(originalRun.status).toBe('completed');expect(originalRun.binding.taskId).toBe(originalA.taskId);expect(originalRun.model.model).toBe(data.models.a);expect(originalRun.prepared.memberContext?.binding).toEqual(originalA.ownerBinding);expect(originalA.ownerBinding?.memberId).toBe(seeded.positions[0].member.memberId);expect(originalA.result).toBeUndefined();expect(originalA.help).toBeUndefined();expect(provider.a).toHaveLength(7);expect(provider.b).toHaveLength(0);
    expect(old.slice(1).every(task=>task.runIds.length===0)).toBe(true);expect(originalA.resumeRequest?.requestId??null).toBe(mode==='reserved'?provider.state.reservation!.requestId:null);
    const marker=await fs.stat(path.join(f.a,data.files[0])),ownerCommit=await changeCheckpointOwner(app,seeded);
    expect(await graph()).toEqual(before);expect(await checkpointHandoffRunBytes(f.user,id,originalRun)).toEqual(originalBytes);provider.releaseHandoff();
    if(mode==='prepare-stop'){
      await entered;expect(provider.state.input).toBeDefined();const stopping=app.dispatch('loop.stop',{id,taskId:started.taskId});
      await vi.waitFor(async()=>{const thread=await app.execution(id).thread(started.taskId);expect(thread.at(-1)?.events.some(event=>event.type==='run.stop_requested')).toBe(true)},{timeout:15000,interval:20});releaseHistory();await stopping;provider.releaseAfterAbandon();
    }else{
      await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(committed).toBeDefined();expect(mode==='lost-output'?provider.state.badOutput:provider.state.receipt).toBeDefined()},{timeout:30000,interval:30});
      const snapshot=await graph(),saved=await records(),task=snapshot.tasks.find(item=>item.taskId===originalA.taskId)!;
      expect(task.checkpointAbandonment).toEqual(committed!.abandonment);expect(task.status).toBe('cancelled');expect(task.runIds).toEqual(originalA.runIds);expect(task.checkpoints).toEqual(originalA.checkpoints);expect(task.resumeRequest).toEqual(originalA.resumeRequest);expect(task.ownerBinding).toEqual(originalA.ownerBinding);expect(task.assignee).toEqual(originalA.assignee);expect(saved.runs).toEqual(initialRecords.runs);expect(provider.b).toHaveLength(0);
      if(mode==='reserved'){const envelope=saved.messages.find(item=>item.kind==='assignment'&&item.messageId===originalA.resumeRequest!.requestId)!;expect(envelope).toMatchObject({delivery:'processed'});expect(envelope.claim).toBeUndefined()}
      const journal=path.join(f.user,id,'dispatch','dispatch.jsonl'),bytes=await fs.readFile(journal);restore();restore=()=>{};
      // Retry is a read of the exact original persisted command through the same real service, not a fabricated receipt or a second tool call.
      expect(await service.abandonCheckpoint(...args!)).toEqual(committed);expect(await fs.readFile(journal)).toEqual(bytes);expect(await graph()).toEqual(snapshot);expect(await records()).toEqual(saved);expect(calls).toBe(1);
      const changed=[...args!] as Parameters<typeof original>;changed[4]={...changed[4],reason:'Changed input cannot query the original command'};await expect(service.abandonCheckpoint(...changed)).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});expect(await fs.readFile(journal)).toEqual(bytes);
      provider.releaseAfterAbandon();
    }
    await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);await checkpointHandoffClosed(app,f.user,id)},{timeout:90000,interval:30});restore();restore=()=>{};
    const saved=await records(),finished=await graph(),scope=saved.scopes[0];expect(scope.outcome).toBe(mode==='prepare-stop'?'cancelled':'completed');expect(provider.a).toHaveLength(7);expect(provider.b).toHaveLength(mode==='prepare-stop'?0:15);expect(provider.main).toHaveLength(mode==='prepare-stop'?9:mode==='reserved'?22:21);
    expect((await fs.stat(path.join(f.a,data.files[0]))).mtimeMs).toBe(marker.mtimeMs);expect(await checkpointHandoffRunBytes(f.user,id,originalRun)).toEqual(originalBytes);
    for(const item of old){const actual=finished.tasks.find(task=>task.taskId===item.taskId)!;expect(actual.assignee).toEqual(item.assignee);expect(actual.ownerBinding).toEqual(item.ownerBinding);expect(actual.goal).toBe(item.goal);expect(actual.modules).toEqual(item.modules);expect(actual.acceptance).toEqual(item.acceptance);expect(actual.runIds).toEqual(item.runIds);expect(actual.checkpoints).toEqual(item.checkpoints);expect(actual.resumeRequest).toEqual(item.resumeRequest);expect(actual.result).toBeUndefined()}
    expect(finished.edges.filter(edge=>before.edges.some(previous=>previous.edgeId===edge.edgeId))).toEqual(before.edges);
    if(mode==='prepare-stop'){expect(committed).toBeUndefined();expect(saved.runs).toHaveLength(1);expect(finished.tasks).toHaveLength(3);expect(finished.tasks.every(task=>!task.checkpointAbandonment)).toBe(true)}
    else{
      expect(saved.runs).toHaveLength(4);const fresh=data.newGoals.map(goal=>finished.tasks.find(task=>task.goal===goal)!);expect(fresh.every(task=>task.status==='result_ready'&&task.ownerBinding?.memberId===seeded.positions[1].member.memberId)).toBe(true);expect(new Set(finished.tasks.map(task=>task.assignee.agentInstanceId)).size).toBe(6);
      const runs=fresh.map(task=>saved.runs.find(run=>run.binding.taskId===task.taskId)!);expect(runs.every(run=>run.model.model===data.models.b&&run.model.id===seeded.profiles[2].id)).toBe(true);expect(new Set(saved.runs.map(run=>run.session.nativeSessionId)).size).toBe(4);expect(runs[0].prerequisites).toEqual([]);for(const index of [1,2])expect(runs[index].prerequisites).toEqual([{taskId:fresh[index-1].taskId,planRevision:fresh[index-1].planRevision,result:fresh[index-1].result}]);
      expect(scope.goal?.review?.superseded.map(item=>({taskId:item.taskId,replacementTaskIds:item.replacementTaskIds}))).toEqual(old.map((item,index)=>({taskId:item.taskId,replacementTaskIds:[fresh[index].taskId]})));
      for(const task of fresh){expect(task.result!.evidenceRefs).toEqual(['handoff-b-'+fresh.indexOf(task)+'-read']);expect(task.runIds).toHaveLength(1)}
      expect(JSON.stringify(scope.goal?.review?.checks)).not.toContain('handoff-a-read');expect(JSON.stringify(scope.goal?.review?.checks)).not.toContain('handoff-abandon');
      const persisted=(await fs.readFile(path.join(f.user,id,'dispatch','dispatch.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect(persisted.filter(record=>record.body.command.commandId===committed!.commandId)).toHaveLength(1);
    }
    const thread=await app.execution(id).thread(started.taskId),receipt=thread.flatMap(run=>run.toolReceipts??[]).find(item=>item.toolCallId==='handoff-abandon');if(mode==='lost-output')expect(receipt?.outcome).toBe('failed');else if(mode!=='prepare-stop')expect(receipt?.outcome).toBe('succeeded');
    const allBytes=await additionRunBytes(f.user,id,started.taskId,thread,saved.runs),sequence=[...provider.sequence];expect(allBytes.filter(item=>item.kind==='member')).toHaveLength(saved.runs.length);
    const actualSummaries=await Promise.all(saved.runs.map(run=>checkpointHandoffRunBytes(f.user,id,run)));expect(actualSummaries.flatMap(item=>item.summary.toolReceipts??[]).filter(item=>item.toolName==='write'&&item.outcome==='succeeded')).toHaveLength(1);
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await records()).toEqual(saved);expect(await graph()).toEqual(finished);expect(provider.sequence).toEqual(sequence);expect(await additionRunBytes(f.user,id,started.taskId,await app.execution(id).thread(started.taskId),saved.runs)).toEqual(allBytes);expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);
    await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/checkpoint-handoff-${mode}-pi-evidence.json`,JSON.stringify({mode,workspaceId:id,rootSessionId:started.taskId,requests:{main:provider.main.length,a:provider.a.length,b:provider.b.length},sequence,ownerCommit,committed,toolReceipt:receipt,scope,graph:finished,runs:saved.runs,runBytes:additionRunByteEvidence(allBytes),originalWriteCount:1,oldRunCanonicalAndNativeUnchanged:true,restartNoReplay:true,errors:provider.errors},null,2));
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/checkpoint-handoff-${mode}-pi-failure.json`,JSON.stringify({error:String(error),state:provider.state,requests:{main:provider.main.length,a:provider.a.length,b:provider.b.length},main:provider.main,sequence:provider.sequence,errors:provider.errors,committed,records:id?await checkpointHandoffRecords(f.user,id).catch(()=>undefined):undefined},null,2));throw error}
  finally{releaseHistory();restore();provider.releaseHandoff();provider.releaseAfterAbandon();await app.shutdown();await provider.close();await f.cleanup()}
},180000);
