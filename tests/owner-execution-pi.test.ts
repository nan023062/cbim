import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import {ownerExecutionBindingSchema} from '../src/backend/core/team/member-execution-binding';
import {seedOwnerExecution,ownerExecutionData as data,ownerExecutionRecords} from './owner-execution-fixture';
import {ownerExecutionProvider,type OwnerExecutionMode} from './owner-execution-provider';
import {moduleOwnershipChange,commitModuleOwnership} from './module-ownership-fixture';
import {additionRunBytes,additionRunByteEvidence} from './queued-dependency-addition-fixture';

it.each(['complete','owner-before-claim','profile-before-claim','profile-after-claim','stop','bad-wire'] as OwnerExecutionMode[])('real Pi dispatches the actual registered module owners with separate models and adaptation (%s)',async mode=>{
  const f=await fixture(),provider=await ownerExecutionProvider(mode);let app=f.app,workspaceId='';
  try{
    const seeded=await seedOwnerExecution(app,f.a,provider.urls);workspaceId=seeded.entry.id;provider.bind(seeded.team.input.agentId,seeded.modules);
    const service=app.memberDispatch(workspaceId),realDispatch=service.dispatchTask.bind(service);let firstArgs:Parameters<typeof realDispatch>|undefined,firstReceipt:Awaited<ReturnType<typeof realDispatch>>|undefined;
    const calls=vi.spyOn(service,'dispatchTask').mockImplementation(async(...args)=>{
      const receipt=await realDispatch(...args);
      if(!firstReceipt){firstArgs=args;firstReceipt=receipt;if(mode==='bad-wire')return {...receipt,rootSessionId:'wrong-output-root-after-real-commit'}}
      return receipt;
    });
    const started=await app.dispatch('loop.chat',{id:workspaceId,message:data.goal,options:seeded.mainOptions}) as {taskId:string;runId:string};
    const identity={workspaceId,rootSessionId:started.taskId},records=()=>ownerExecutionRecords(f.user,workspaceId),graph=()=>app.dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>;
    await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(provider.state.held).toBe(true)},{timeout:60000,interval:30});
    expect(provider.members.map(items=>items.length)).toEqual([0,0]);expect((await records()).runs).toEqual([]);expect(calls).toHaveBeenCalledTimes(2);
    const original=await graph();expect(original.tasks).toHaveLength(2);expect(new Set(original.tasks.map(task=>task.assignee.agentInstanceId)).size).toBe(2);
    for(const [index,moduleId] of seeded.modules.entries()){
      const task=original.tasks.find(task=>task.modules[0].moduleId===moduleId)!;
      expect(ownerExecutionBindingSchema.parse(task.ownerBinding)).toMatchObject({workspaceId,memberId:seeded.positions[index].member.memberId,capability:{agentId:seeded.team.input.agentId},model:{profileId:seeded.profiles[index+1].id,modelId:data.models[index]}});
      expect(task.ownerBinding?.model.profileId).not.toBe(seeded.mainOptions.profileId);
    }
    // The same service and command return the real first receipt without another transaction, lookup, task, or provider request.
    const bytes=await fs.readFile(path.join(f.user,workspaceId,'dispatch','dispatch.jsonl'));
    expect(await realDispatch(...firstArgs!)).toEqual(firstReceipt);expect(await graph()).toEqual(original);
    expect(await fs.readFile(path.join(f.user,workspaceId,'dispatch','dispatch.jsonl'))).toEqual(bytes);expect(provider.main).toHaveLength(6);
    if(mode==='owner-before-claim'){
      const a=seeded.positions[0].member,b=seeded.positions[1].member;
      await commitModuleOwnership(app,workspaceId,await moduleOwnershipChange(app,workspaceId,seeded.modules[0],{memberId:b.memberId,expectedRevision:b.revision},'测试主轮尚未结束时明确从 A 换为 B'));
      await commitModuleOwnership(app,workspaceId,await moduleOwnershipChange(app,workspaceId,seeded.modules[0],{memberId:a.memberId,expectedRevision:a.revision},'测试同岗位返回 A 仍不得复用旧关系版本'));
    }
    const updateProfile=async()=>{const profile=seeded.profiles[1];return app.models.save({id:profile.id,profile:{...profile.definition,models:profile.definition.models.map(model=>({...model,maxTokens:2048}))}})};
    if(mode==='profile-before-claim')await updateProfile();
    if(mode==='stop')await app.dispatch('loop.stop',{id:workspaceId,taskId:started.taskId});
    provider.releaseMain();
    if(mode==='profile-after-claim'){
      // The workspace legitimately executes the two members in order. The first real HTTP request proves A's claim committed before this edit.
      await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(provider.members[0]).toHaveLength(1)},{timeout:60000,interval:30});
      const claimed=await records(),taskA=original.tasks.find(task=>task.modules[0].moduleId===seeded.modules[0])!;
      expect(claimed.runs.find(run=>run.binding.taskId===taskA.taskId)?.status).toBe('running');await updateProfile();provider.releaseMembers();
    }
    await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);const scopes=(await records()).scopes;expect(scopes).toHaveLength(1);expect(scopes[0].status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:60000,interval:40});
    calls.mockRestore();const finalRecords=await records(),finalGraph=await graph(),scope=finalRecords.scopes[0],successful=['complete','profile-after-claim','bad-wire'].includes(mode);
    expect(scope.outcome).toBe(mode==='stop'?'cancelled':successful?'completed':'failed');
    expect(finalGraph.tasks.map(task=>task.taskId)).toEqual(original.tasks.map(task=>task.taskId));
    for(const task of finalGraph.tasks){const before=original.tasks.find(item=>item.taskId===task.taskId)!;expect(task.ownerBinding).toEqual(before.ownerBinding);expect(task.assignee).toEqual(before.assignee)}
    if(successful){
      expect(provider.main).toHaveLength(9);expect(provider.members.map(items=>items.length)).toEqual([5,5]);expect(finalRecords.runs).toHaveLength(2);
      expect(scope.goal?.review?.decision).toBe('complete');expect(finalGraph.tasks.every(task=>task.status==='result_ready')).toBe(true);
      const storage=new FileRunStorage();
      for(const [index,moduleId] of seeded.modules.entries()){
        const task=finalGraph.tasks.find(task=>task.modules[0].moduleId===moduleId)!,run=finalRecords.runs.find(run=>run.binding.taskId===task.taskId)!;
        expect(run.model).toMatchObject({id:seeded.profiles[index+1].id,model:data.models[index],maxTokens:4096,baseUrl:index===0?provider.urls.a:provider.urls.b});
        expect(run.prepared.memberContext?.binding).toEqual(task.ownerBinding);expect(run.prepared.memberContext?.adaptation.instructions).toBe(data.adaptations[index]);
        expect(run.prepared.agent.effectiveSkills.map(skill=>skill.content).join('\n')).toContain(data.sharedSkill);expect(run.prepared.agent.effectiveSkills.map(skill=>skill.content).join('\n')).toContain(data.ownSkill);
        const summary=await storage.read(path.join(f.user,workspaceId,'dispatch','runs','tasks',task.taskId,run.binding.runId));
        expect(summary.task.ownerBinding).toEqual(task.ownerBinding);expect(summary.memberBinding).toEqual(run.binding);expect(summary.unresolvedTools).toEqual([]);
        expect(task.result?.runId).toBe(run.binding.runId);expect(task.result?.evidenceRefs).toEqual(['execution-worker-'+index+'-read']);
      }
    }else if(mode==='stop'){expect(finalRecords.runs).toEqual([]);expect(provider.members.map(items=>items.length)).toEqual([0,0]);expect(provider.main).toHaveLength(6)}
    else{
      const a=finalGraph.tasks.find(task=>task.modules[0].moduleId===seeded.modules[0])!;expect(a.runIds).toEqual([]);expect(finalRecords.runs.some(run=>run.binding.taskId===a.taskId)).toBe(false);expect(provider.members[0]).toEqual([]);expect(a.ownerBinding).toEqual(original.tasks.find(task=>task.taskId===a.taskId)?.ownerBinding);
      expect(scope.goal?.review?.decision==='blocked'||!!scope.goal?.blocked).toBe(true);
    }
    const thread=await app.execution(workspaceId).thread(started.taskId);
    expect(thread[0].toolReceipts?.find(receipt=>receipt.toolCallId==='execution-owner-dispatch-0')?.outcome).toBe(mode==='bad-wire'?'failed':'succeeded');
    const runBytes=await additionRunBytes(f.user,workspaceId,started.taskId,thread,finalRecords.runs),sequence=[...provider.sequence];
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect(await records()).toEqual(finalRecords);expect(await graph()).toEqual(finalGraph);expect(provider.sequence).toEqual(sequence);
    expect(await additionRunBytes(f.user,workspaceId,started.taskId,await app.execution(workspaceId).thread(started.taskId),finalRecords.runs)).toEqual(runBytes);
    expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);expect(provider.errors).toEqual([]);
    await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/owner-execution-${mode}-pi-evidence.json`,JSON.stringify({mode,workspaceId,rootSessionId:started.taskId,scopeId:scope.scopeId,outcome:scope.outcome,realPi:true,onlineProvider:false,httpRequests:provider.httpRequests,requestCounts:{main:provider.main.length,members:provider.members.map(items=>items.length)},tasks:finalGraph.tasks,originalSelections:provider.state.selections,runBytes:additionRunByteEvidence(runBytes),restartWithoutReplay:true,errors:provider.errors},null,2));
  }catch(error){
    await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/owner-execution-${mode}-pi-failure.json`,JSON.stringify({mode,error:String(error),state:provider.state,httpRequests:provider.httpRequests,errors:provider.errors,records:workspaceId?await ownerExecutionRecords(f.user,workspaceId).catch(()=>undefined):undefined},null,2));throw error;
  }finally{provider.releaseMain();provider.releaseMembers();vi.restoreAllMocks();await app.shutdown();await f.cleanup();await provider.close()}
},120000);
