import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {queuedTaskCancelProvider,queuedTaskCancelFixture as data} from './queued-task-cancel-provider';
import {seedQueuedTaskCancel,queuedTaskCancelRecords} from './queued-task-cancel-fixture';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import type {GoalContinuationRequest} from '../src/backend/core/tasks/scope-continuation';

it.each(['complete','stop','cancel-not-success'] as const)('explicitly cancels unstarted dependencies then preserves the goal and immutable history (%s)',async mode=>{
  const f=await fixture(),provider=await queuedTaskCancelProvider({holdContinuation:true,invalidComplete:mode==='cancel-not-success'});let app=f.app;
  try{
    const {entry}=await seedQueuedTaskCancel(app,f.a,provider),profileId=(await app.models.list()).selectedId!;
    const started=await app.dispatch('loop.chat',{id:entry.id,message:data.mainGoal,options:{permission:'read',turnTimeoutMs:30000}}) as {taskId:string;runId:string};
    const identity={workspaceId:entry.id,rootSessionId:started.taskId},records=()=>queuedTaskCancelRecords(f.user,entry.id),graph=()=>app.dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>,queue=()=>app.dispatch('loop.queue',{id:entry.id,taskId:started.taskId});
    await vi.waitFor(async()=>{expect((await records()).scopes[0].status).toBe(mode==='cancel-not-success'?'closed':'waiting');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:35000,interval:30});
    const parked=await records(),scope=parked.scopes[0],before=await graph(),old=data.oldGoals.map(goal=>before.tasks.find(task=>task.goal===goal)!);expect(before.tasks).toHaveLength(3);expect(old[0].help).toBeDefined();expect(old[0].result).toBeUndefined();
    for(const task of old.slice(1)){
      expect(task).toMatchObject({status:'cancelled',runIds:[],cancelledBeforeStart:{scopeId:scope.scopeId,reason:data.cancelReason,previousRevision:task.revision-1}});expect(task.result).toBeUndefined();expect(task.help).toBeUndefined();expect(task.activeRunId).toBeUndefined();
      expect(parked.messages.filter(message=>message.taskId===task.taskId)).toEqual([expect.objectContaining({kind:'assignment',delivery:'processed'})]);expect(parked.messages.find(message=>message.taskId===task.taskId)?.claim).toBeUndefined();
      const count=provider.mainRequests.length+provider.memberRequests.length,report=await app.dispatch('dispatch.executionReport',{...identity,taskId:task.taskId});expect(report).toMatchObject({execution:'not_started',log:{state:'not_expected'}});expect(provider.mainRequests.length+provider.memberRequests.length).toBe(count);
      const member=parked.members.find(item=>item.agentInstanceId===task.assignee.agentInstanceId)!;expect(member.waitingTaskIds).toEqual([]);expect(member.activeTaskId).toBeUndefined();expect(member.activeRunId).toBeUndefined();expect(member.activity).toBe('idle');expect(member.lifecycle).toBe(mode==='cancel-not-success'?'released':'active');
    }
    expect(old[1].cancelledBeforeStart?.commandId).toBe(old[2].cancelledBeforeStart?.commandId);expect(provider.memberRequests).toHaveLength(4);expect(provider.mainRequests).toHaveLength(mode==='cancel-not-success'?13:14);
    const firstThread=await app.execution(entry.id).thread(started.taskId);expect(firstThread).toHaveLength(2);expect(firstThread[1].toolReceipts?.find(item=>item.toolCallId==='cancel-wrong-set')?.outcome).toBe('failed');expect(firstThread[1].toolReceipts?.find(item=>item.toolCallId==='cancel-exact')?.outcome).toBe('succeeded');expect(firstThread[1].toolReceipts?.find(item=>item.toolCallId==='cancel-not-success')?.outcome).toBe('failed');expect(old[1].cancelledBeforeStart?.mainRunId).toBe(firstThread[1].runId);
    expect(scope.goal?.input).toEqual({message:data.mainGoal,attachmentIds:[]});expect(before.edges.filter(edge=>edge.kind==='dependency')).toHaveLength(2);
    if(mode==='cancel-not-success'){
      expect(scope.outcome).toBe('failed');expect(scope.goal?.blocked).toBeDefined();expect(scope.goal?.review?.decision).not.toBe('complete');expect(scope.wait).toBeUndefined();
      await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await records()).toEqual(parked);expect(await graph()).toEqual(before);expect(provider.mainRequests).toHaveLength(13);expect(provider.memberRequests).toHaveLength(4);expect(provider.errors).toEqual([]);return;
    }
    expect(scope.wait).toBeDefined();expect(scope.goal?.review?.decision).toBe('awaiting_user');await app.dispatch('loop.enqueue',{id:entry.id,taskId:started.taskId,message:'同意',options:{permission:'read'}});await expect(app.dispatch('loop.queueContinue',{id:entry.id,taskId:started.taskId})).rejects.toThrow();expect((await queue())[0]).toMatchObject({message:'同意',status:'paused'});
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await records()).toEqual(parked);expect(await graph()).toEqual(before);expect(provider.mainRequests).toHaveLength(14);expect(provider.memberRequests).toHaveLength(4);
    const req:GoalContinuationRequest={...identity,scopeId:scope.scopeId,waitId:scope.wait!.waitId,expectedGoalRevision:scope.goal!.revision,expectedInputRevision:scope.goal!.inputRevision??1,commandId:randomUUID(),input:{message:data.supplement},options:{profileId,provider:'cbim-'+profileId,model:'cancel-fixture',permission:'read',turnTimeoutMs:30000}};
    const receipt=await app.dispatch('loop.goalContinue',req);await vi.waitFor(()=>expect(provider.mainRequests).toHaveLength(15),{timeout:20000,interval:30});expect((await app.dispatch('loop.goalContinue',req)).continuation).toEqual(receipt.continuation);expect(provider.mainRequests).toHaveLength(15);expect((await graph()).tasks).toEqual(before.tasks);
    if(mode==='stop')await app.dispatch('loop.stop',{id:entry.id,taskId:started.taskId});else provider.releaseContinuation();
    await vi.waitFor(async()=>{expect((await records()).scopes[0].status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:35000,interval:30});
    const final=await records(),closed=final.scopes[0],finished=await graph();expect(final.scopes).toHaveLength(1);expect(closed.scopeId).toBe(scope.scopeId);expect(closed.goal?.input).toEqual(scope.goal?.input);expect(closed.goal?.inputRevision).toBe(2);expect(closed.continuations).toHaveLength(1);expect(finished.root.agent).toEqual(before.root.agent);expect(finished.tasks.filter(task=>old.some(previous=>previous.taskId===task.taskId))).toEqual(before.tasks);
    expect(closed.outcome).toBe(mode==='stop'?'cancelled':'completed');
    if(mode==='stop'){expect(finished.tasks).toHaveLength(3);expect(provider.mainRequests).toHaveLength(15);expect(provider.memberRequests).toHaveLength(4)}
    else{
      expect(finished.tasks).toHaveLength(6);const fresh=data.newGoals.map(goal=>finished.tasks.find(task=>task.goal===goal)!);expect(new Set(finished.tasks.map(task=>task.assignee.agentInstanceId)).size).toBe(6);expect(new Set(finished.tasks.map(task=>task.assignee.agentSessionId)).size).toBe(6);
      fresh.forEach((task,index)=>{expect(task.status).toBe('result_ready');expect(task.result?.evidenceRefs).toEqual(['cancel-replacement-'+index+'-read']);expect(task.runIds).toHaveLength(1);expect(task.cancelledBeforeStart).toBeUndefined()});
      expect(closed.goal?.review?.superseded.map(item=>({taskId:item.taskId,replacementTaskIds:item.replacementTaskIds}))).toEqual(old.map((task,index)=>({taskId:task.taskId,replacementTaskIds:[fresh[index].taskId]})));expect(closed.goal?.plan?.inputRevision).toBe(2);expect(provider.mainRequests).toHaveLength(23);expect(provider.memberRequests).toHaveLength(19);
    }
    const thread=await app.execution(entry.id).thread(started.taskId);expect(thread[2].source).toMatchObject({kind:'user-continuation',scopeId:scope.scopeId,continuationId:req.commandId,inputRevision:2});expect((await queue())[0]).toMatchObject({message:'同意',status:'paused'});expect(provider.errors).toEqual([]);
    const counts=[provider.mainRequests.length,provider.memberRequests.length];await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await records()).toEqual(final);expect(await graph()).toEqual(finished);expect((await app.dispatch('loop.goalContinue',req)).continuation).toEqual(receipt.continuation);expect([provider.mainRequests.length,provider.memberRequests.length]).toEqual(counts);
    for(let index=0;index<data.files.length;index++)expect(await fs.readFile(path.join(f.a,data.files[index]),'utf8')).toBe(data.facts[index]);
  }finally{provider.releaseContinuation();await app.shutdown();await f.cleanup();await provider.close()}
},120000);
