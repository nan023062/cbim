import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {scopeWaitProvider,waitFixture} from './scope-wait-provider';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {WorkspaceExecutionLease} from '../src/logic/execution/admission/workspace-lease';
import type {DispatchScope} from '../src/logic/tasks/rules/dispatch-scope';
import type {GraphSnapshot} from '../src/logic/tasks/rules/graph-types';

/** Real native Pi and Application; observing acquire/release never substitutes for the real lease checks. */
it.each(['parked-restart','shutdown-before-park','missing-review'] as const)('keeps safe persistent waiting distinct from shutdown and failed completion (%s)',async(mode)=>{
  const f=await fixture(),provider=await scopeWaitProvider({missingReview:mode==='missing-review',holdFinal:mode==='shutdown-before-park'});
  let app=f.app;
  const leases=new Set<string>(),originalAcquire=WorkspaceExecutionLease.prototype.acquire;
  const leaseSpy=vi.spyOn(WorkspaceExecutionLease.prototype,'acquire').mockImplementation(function(this:WorkspaceExecutionLease,...args:Parameters<typeof originalAcquire>){const release=originalAcquire.apply(this,args);leases.add(args[0]);return ()=>{release();leases.delete(args[0])}});
  try{
    await app.models.save({profile:{name:'Scope waiting fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:'wait-fixture',models:[{id:'wait-fixture',name:'Wait fixture',enabled:true,contextWindow:65536,maxTokens:2048,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
    const entry=await app.dispatch('add',{path:f.a}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);
    const knowledge=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(knowledge.files.find(file=>file.path===modulePath)!.text);
    definition.maintenance={bindingId:'wait-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'wait-review',source:'local_user',confirmedAt:new Date().toISOString()}};
    await workspace.commit(request(knowledge,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
    const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:(await app.models.list()).selectedId!,modelId:'wait-fixture'});
    provider.bind(team.input.agentId,team.input.moduleId,owner.selection);
    await fs.writeFile(path.join(f.a,'wait-input.txt'),waitFixture.fact);
    const scopes=async()=>{
      const raw=await fs.readFile(path.join(f.user,entry.id,'dispatch','dispatch.jsonl'),'utf8'),found=new Map<string,DispatchScope>();
      for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){const {body}=JSON.parse(line);expect(body.workspaceId).toBe(entry.id);for(const scope of body.mutation.scopes??[])found.set(scope.scopeId,scope)}
      return [...found.values()];
    };
    const started=await app.dispatch('loop.chat',{id:entry.id,message:waitFixture.mainGoal,options:{permission:'read',turnTimeoutMs:30000}}) as {taskId:string;runId:string};
    const identity={workspaceId:entry.id,rootSessionId:started.taskId},graph=()=>app.dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>;
    if(mode==='shutdown-before-park'){
      await vi.waitFor(async()=>{expect(provider.mainRequests).toHaveLength(6);expect((await scopes())[0]).toMatchObject({status:'active',goal:{review:{decision:'awaiting_user'}}});expect(leases.size).toBe(1)},{timeout:25000,interval:30});
      await app.shutdown();
      const closed=(await scopes())[0];expect(closed).toMatchObject({status:'closed',outcome:'cancelled'});expect(closed.wait).toBeUndefined();expect(leases.size).toBe(0);
      const count=provider.mainRequests.length+provider.memberRequests.length;
      app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
      expect(await scopes()).toEqual([closed]);expect(provider.mainRequests.length+provider.memberRequests.length).toBe(count);
      expect((await graph()).tasks[0].result?.acceptance).toBe('not_evaluated');return;
    }
    await vi.waitFor(async()=>{expect((await scopes())[0].status).toBe(mode==='parked-restart'?'waiting':'closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);expect(leases.size).toBe(0)},{timeout:30000,interval:30});
    const saved=(await scopes())[0],beforeGraph=await graph(),thread=await app.execution(entry.id).thread(started.taskId),count=provider.mainRequests.length+provider.memberRequests.length;
    expect(thread).toHaveLength(mode==='missing-review'?4:2);expect(thread.every(run=>run.status==='completed')).toBe(true);
    expect(saved.goal?.input).toEqual({message:waitFixture.mainGoal,attachmentIds:[]});
    expect(beforeGraph.tasks).toHaveLength(1);expect(beforeGraph.tasks[0]).toMatchObject({status:'result_ready',result:{acceptance:'not_evaluated'}});
    if(mode==='missing-review'){
      expect(provider.mainRequests).toHaveLength(6);expect(provider.memberRequests).toHaveLength(5);expect(provider.errors).toEqual([]);
      expect(thread.slice(2).map(run=>run.source)).toEqual([1,2].map(attempt=>expect.objectContaining({kind:'goal-repair',scopeId:saved.scopeId,attempt,failureCode:'GOAL_REVIEW_REQUIRED'})));
      expect(saved.goal?.plan?.criteria.find(item=>item.id===waitFixture.humanId)).toMatchObject({kind:'human',text:waitFixture.humanCriterion});
      expect(saved).toMatchObject({status:'closed',outcome:'failed',goal:{blocked:{reason:expect.any(String)}}});expect(saved.wait).toBeUndefined();
      await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
      expect(await scopes()).toEqual([saved]);expect(provider.mainRequests.length+provider.memberRequests.length).toBe(count);
      await expect(app.memberDispatch(entry.id).parkScope(identity,saved.scopeId,thread[1],thread.map(run=>run.runId))).rejects.toThrow();
      expect(await scopes()).toEqual([saved]);return;
    }
    expect(saved).toMatchObject({status:'waiting',goal:{revision:3,review:{decision:'awaiting_user'}},wait:{waitId:expect.any(String),reason:expect.any(String),runId:thread[1].runId,goalRevision:3,knowledgeRevision:expect.any(String)}});
    expect(saved.closedAt).toBeUndefined();expect(saved.outcome).toBeUndefined();expect(saved.goal?.blocked).toBeUndefined();
    expect(saved.wait?.mainRunIds).toEqual(thread.map(run=>run.runId));
    expect(saved.goal?.review?.checks.find(check=>check.criterionId===waitFixture.humanId)?.outcome).toBe('needs_human');
    const runtime=app.runtime.snapshot(),executorId=beforeGraph.tasks[0].assignee.agentInstanceId;
    const executor=runtime.members.find(member=>member.agentInstanceId===executorId);expect(executor).toBeDefined();expect(executor?.lifecycle).not.toBe('released');
    await app.dispatch('loop.enqueue',{id:entry.id,taskId:started.taskId,message:'同意',options:{permission:'read'}});
    // Attempting the old general continuation entry is not a formal human decision and cannot wake waiting.
    await expect(app.dispatch('loop.queueContinue',{id:entry.id,taskId:started.taskId})).rejects.toThrow();
    expect(await scopes()).toEqual([saved]);expect(provider.mainRequests.length+provider.memberRequests.length).toBe(count);
    expect((await app.dispatch('loop.queue',{id:entry.id,taskId:started.taskId})).map((item:{message:string})=>item.message)).toEqual(['同意']);
    await app.shutdown();expect(await scopes()).toEqual([saved]);expect(leases.size).toBe(0);
    app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect(await scopes()).toEqual([saved]);expect((await graph()).root.agent).toEqual(beforeGraph.root.agent);
    expect((await graph()).tasks).toEqual(beforeGraph.tasks);expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);expect(leases.size).toBe(0);
    expect(provider.mainRequests.length+provider.memberRequests.length).toBe(count);
    const resumed=await app.dispatch('loop.resume',{id:entry.id,taskId:started.taskId,runId:thread[1].runId,message:'重启后同意',options:{permission:'read'}});
    expect(resumed).toMatchObject({queued:true});expect(await scopes()).toEqual([saved]);
    await expect(app.dispatch('loop.queueContinue',{id:entry.id,taskId:started.taskId})).rejects.toThrow();
    expect(provider.mainRequests.length+provider.memberRequests.length).toBe(count);
    await app.dispatch('loop.stop',{id:entry.id,taskId:started.taskId});
    const stopped=(await scopes())[0];expect(stopped).toMatchObject({status:'closed',outcome:'cancelled',goal:saved.goal,wait:saved.wait});
    const after=app.runtime.snapshot();expect(after.members.find(member=>member.agentInstanceId===executorId)?.lifecycle).toBe('released');const main=after.members.find(member=>member.agentInstanceId===beforeGraph.root.agent.agentInstanceId);expect(main).toBeDefined();expect(main?.lifecycle).not.toBe('released');
    expect((await app.dispatch('loop.queue',{id:entry.id,taskId:started.taskId})).every((item:{status:string})=>item.status==='paused')).toBe(true);
    expect(provider.mainRequests.length+provider.memberRequests.length).toBe(count);expect(leases.size).toBe(0);
    expect(provider.mainRequests).toHaveLength(6);expect(provider.memberRequests).toHaveLength(5);expect(provider.errors).toEqual([]);
  }finally{provider.releaseFinal();await app.shutdown();leaseSpy.mockRestore();await f.cleanup();await provider.close()}
},120000);
