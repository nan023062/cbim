import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture,request} from './helpers';
import {seedTeam} from './team-fixture';
import {scopeContinuationProvider,continuationFixture} from './scope-continuation-provider';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import type {GoalContinuationRequest,GoalContinuationReceipt} from '../src/backend/core/tasks/scope-continuation';

it.each(['complete-restart','wait-again','stop-race'] as const)('resumes only explicit goal input and preserves original scope with real Pi (%s)',async(mode)=>{
  const f=await fixture(),provider=await scopeContinuationProvider({holdContinuation:true,waitAgain:mode==='wait-again'});let app=f.app;
  try{
    await app.models.save({profile:{name:'Scope continuation fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:'continue-fixture',models:[{id:'continue-fixture',name:'Continue fixture',enabled:true,contextWindow:65536,maxTokens:2048,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
    const profileId=(await app.models.list()).selectedId!;
    const entry=await app.dispatch('add',{path:f.a}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);
    const knowledge=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(knowledge.files.find(file=>file.path===modulePath)!.text);
    definition.maintenance={bindingId:'continue-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'continue-review',source:'local_user',confirmedAt:new Date().toISOString()}};
    await workspace.commit(request(knowledge,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
    const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:(await app.models.list()).selectedId!,modelId:'continue-fixture'});
    provider.bind(team.input.agentId,team.input.moduleId,owner.selection);
    await fs.writeFile(path.join(f.a,'continue-input.txt'),continuationFixture.fact);
    const scopes=async()=>{
      const raw=await fs.readFile(path.join(f.user,entry.id,'dispatch','dispatch.jsonl'),'utf8'),found=new Map<string,DispatchScope>();
      for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){const {body}=JSON.parse(line);expect(body.workspaceId).toBe(entry.id);for(const scope of body.mutation.scopes??[])found.set(scope.scopeId,scope)}return [...found.values()];
    };
    const started=await app.dispatch('loop.chat',{id:entry.id,message:continuationFixture.mainGoal,options:{permission:'read',turnTimeoutMs:30000}}) as {taskId:string;runId:string};
    const identity={workspaceId:entry.id,rootSessionId:started.taskId},graph=()=>app.dispatch('dispatch.graphSnapshot',{identity}),queue=()=>app.dispatch('loop.queue',{id:entry.id,taskId:started.taskId});
    await vi.waitFor(async()=>{expect((await scopes())[0].status).toBe('waiting');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:30});
    const original=(await scopes())[0],originalGraph=await graph();expect(provider.mainRequests).toHaveLength(6);expect(provider.memberRequests).toHaveLength(5);
    await app.dispatch('loop.enqueue',{id:entry.id,taskId:started.taskId,message:continuationFixture.queuedGoal,options:{permission:'read'}});
    const queued=await queue();expect(queued).toHaveLength(1);expect(queued[0].status).toBe('paused');
    await expect(app.dispatch('loop.queueContinue',{id:entry.id,taskId:started.taskId})).rejects.toThrow();
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect(await scopes()).toEqual([original]);expect(provider.mainRequests).toHaveLength(6);expect(await queue()).toEqual(queued);
    const req:GoalContinuationRequest={...identity,scopeId:original.scopeId,waitId:original.wait!.waitId,expectedGoalRevision:original.goal!.revision,expectedInputRevision:original.goal!.inputRevision??1,commandId:randomUUID(),input:{message:continuationFixture.supplement},options:{provider:'cbim-'+profileId,model:'continue-fixture',profileId,permission:'read',turnTimeoutMs:30000}};
    const lookup={...identity,scopeId:req.scopeId,commandId:req.commandId};
    expect(await app.dispatch('loop.goalContinuation',lookup)).toBeUndefined();
    await expect(app.dispatch('loop.goalContinue',{...req,waitId:'obsolete-wait'})).rejects.toThrow();
    expect(await scopes()).toEqual([original]);expect(provider.mainRequests).toHaveLength(6);
    if(mode==='stop-race'){
      const continuation=app.dispatch('loop.goalContinue',req),stop=app.dispatch('loop.stop',{id:entry.id,taskId:started.taskId});
      const results=await Promise.allSettled([continuation,stop]);expect(results[1].status).toBe('fulfilled');
      await vi.waitFor(async()=>{expect((await scopes())[0]).toMatchObject({status:'closed',outcome:'cancelled'});expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:20000,interval:30});
      const closed=(await scopes())[0];expect(closed.goal?.input).toEqual(original.goal?.input);expect(closed.continuations?.length??0).toBeLessThanOrEqual(1);expect(provider.mainRequests.length).toBeLessThanOrEqual(7);expect(provider.memberRequests).toHaveLength(5);
      const count=provider.mainRequests.length;
      const receipt=await app.dispatch('loop.goalContinuation',lookup) as GoalContinuationReceipt|undefined;
      if(receipt){expect(receipt.scopeStatus).toBe('closed');expect((await app.dispatch('loop.goalContinue',req)).continuation).toEqual(receipt.continuation)}
      else await expect(app.dispatch('loop.goalContinue',req)).rejects.toThrow();
      expect(provider.mainRequests).toHaveLength(count);expect((await queue())[0].status).toBe('paused');expect((await graph()).root.agent).toEqual(originalGraph.root.agent);return;
    }
    const [receipt,duplicate]=await Promise.all([app.dispatch('loop.goalContinue',req),app.dispatch('loop.goalContinue',req)]) as GoalContinuationReceipt[];
    expect(receipt).toMatchObject({...identity,scopeId:original.scopeId,scopeStatus:'active',continuation:{continuationId:req.commandId,input:req.input,inputRevision:2,wait:original.wait,options:req.options}});
    expect(duplicate.continuation).toEqual(receipt.continuation);
    await vi.waitFor(()=>expect(provider.mainRequests).toHaveLength(7),{timeout:20000,interval:30});
    const accepted=(await scopes())[0];expect(accepted.scopeId).toBe(original.scopeId);expect(accepted.status).toBe('active');expect(accepted.goal?.input).toEqual(original.goal?.input);expect(accepted.goal?.inputRevision).toBe(2);expect(accepted.goal?.revision).toBe(original.goal!.revision+1);expect(accepted.goal?.review).toBeUndefined();expect(accepted.continuations).toEqual([receipt.continuation]);
    expect((await graph()).root.agent).toEqual(originalGraph.root.agent);expect((await graph()).tasks).toEqual(originalGraph.tasks);
    expect((await app.dispatch('loop.goalContinue',req)).continuation).toEqual(receipt.continuation);expect((await app.dispatch('loop.goalContinuation',lookup)).continuation).toEqual(receipt.continuation);expect(provider.mainRequests).toHaveLength(7);
    await expect(app.dispatch('loop.goalContinue',{...req,input:{message:'changed input'}})).rejects.toThrow();
    await expect(app.dispatch('loop.goalContinue',{...req,commandId:randomUUID()})).rejects.toThrow();
    await expect(app.dispatch('loop.goalContinuation',{...lookup,rootSessionId:'wrong-root'})).rejects.toThrow();
    expect(await queue()).toEqual(queued.map((item:any)=>({...item,reason:'原目标已接收补充，后续消息仍暂停；目标结束后可继续队列'})));provider.releaseContinuation();
    await vi.waitFor(async()=>{expect((await scopes())[0].status).toBe(mode==='wait-again'?'waiting':'closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:30});
    const resolved=(await scopes())[0],thread=await app.execution(entry.id).thread(started.taskId);
    expect(thread).toHaveLength(3);expect(thread[2].source).toMatchObject({kind:'user-continuation',scopeId:req.scopeId,continuationId:req.commandId,inputRevision:2});expect(thread[2].runId).toBe(receipt.continuation.runId);expect(thread[2].events.find(event=>event.type==='run.started')?.data.message).toBe(req.input.message);
    expect(resolved.goal?.input).toEqual(original.goal?.input);expect(resolved.continuations).toEqual([receipt.continuation]);expect(resolved.goal?.plan?.inputRevision).toBe(2);expect(resolved.goal?.review?.inputRevision).toBe(2);expect((await graph()).tasks).toEqual(originalGraph.tasks);
    const denied=thread[2].toolReceipts?.find(item=>item.toolCallId==='continue-stale-review');expect(denied?.outcome).toBe('failed');
    expect(provider.mainRequests).toHaveLength(12);expect(provider.memberRequests).toHaveLength(5);expect((await queue())[0].status).toBe('paused');
    if(mode==='wait-again'){
      expect(resolved.wait!.waitId).not.toBe(original.wait!.waitId);expect(resolved.wait!.mainRunIds).toEqual(thread.map(run=>run.runId));expect(resolved.wait!.goalRevision).toBe(resolved.goal!.revision);
      await expect(app.dispatch('loop.goalContinue',{...req,commandId:randomUUID(),expectedGoalRevision:resolved.goal!.revision,expectedInputRevision:2})).rejects.toThrow();
      expect((await app.dispatch('loop.goalContinue',req)).continuation).toEqual(receipt.continuation);expect(await scopes()).toEqual([resolved]);expect(provider.mainRequests).toHaveLength(12);
      await app.dispatch('loop.stop',{id:entry.id,taskId:started.taskId});expect((await scopes())[0].outcome).toBe('cancelled');
    }else{
      expect(resolved).toMatchObject({status:'closed',outcome:'completed',goal:{review:{decision:'complete'}}});
      await expect(app.dispatch('loop.goalContinue',{...req,commandId:randomUUID()})).rejects.toThrow();
      expect((await app.dispatch('loop.goalContinue',req)).continuation).toEqual(receipt.continuation);expect(provider.mainRequests).toHaveLength(12);
      await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await scopes()).toEqual([resolved]);expect((await app.dispatch('loop.goalContinuation',lookup)).continuation).toEqual(receipt.continuation);expect(provider.mainRequests).toHaveLength(12);
      await app.dispatch('loop.queueContinue',{id:entry.id,taskId:started.taskId});await vi.waitFor(async()=>{const all=await scopes();expect(all).toHaveLength(2);expect(all[1]).toMatchObject({status:'closed',outcome:'completed',goal:{input:{message:continuationFixture.queuedGoal}}})},{timeout:20000,interval:30});expect(await queue()).toEqual([]);expect(provider.mainRequests).toHaveLength(13);
    }
    expect(provider.errors).toEqual([]);
  }finally{provider.releaseContinuation();await app.shutdown();await f.cleanup();await provider.close()}
},120000);
