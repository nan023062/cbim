import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {dependencyReplacementProvider,dependencyReplacementFixture as data} from './queued-dependency-replacement-provider';
import {seedDependencyReplacement,dependencyRecords,dependencyRuns,assertDependencyReplacement} from './queued-dependency-replacement-fixture';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import type {GraphSnapshot,GraphDelta} from '../src/logic/tasks/rules/graph-types';

it.each(['complete','stop','restart-held'] as const)('replaces one queued prerequisite with a real candidate while preserving original downstream identities (%s)',async mode=>{
  const f=await fixture(),provider=await dependencyReplacementProvider();let app=f.app,failed=false;
  try{
    const {entry}=await seedDependencyReplacement(app,f.a,provider),started=await app.dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:'read',turnTimeoutMs:60000}}) as {taskId:string;runId:string},identity={workspaceId:entry.id,rootSessionId:started.taskId};
    const records=()=>dependencyRecords(f.user,entry.id),graph=()=>app.dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>;
    await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(provider.state.receipt).toBeDefined();expect(provider.main).toHaveLength(12)},{timeout:35000,interval:40});
    const initial=provider.state.initialGraph!,before=provider.state.beforeReplacement!,receipt=provider.state.receipt!,held=await graph(),nodes=assertDependencyReplacement(held,initial,before,receipt,false),record=await records();
    expect(record.scopes[0].status).toBe('active');expect(record.scopes[0].goal?.plan?.revision).toBe(3);expect(provider.member).toHaveLength(9);expect((await dependencyRuns(f.user,entry.id)).map(run=>run.binding.taskId).sort()).toEqual([nodes.a.taskId,nodes.a2.taskId].sort());
    expect(nodes.b.revision).toBe(before.tasks.find(task=>task.taskId===nodes.b.taskId)!.revision+1);expect(nodes.c).toEqual(before.tasks.find(task=>task.taskId===nodes.c.taskId));
    const delta=await app.dispatch('dispatch.graphDelta',{identity,cursor:before.cursor,limit:100}) as GraphDelta;expect(delta.mode).toBe('delta');if(delta.mode==='delta'){
      const mutation=delta.batches.find(batch=>batch.commandId===receipt.commandId)!;expect(mutation.cause).toBe('dependency.changed');expect(mutation.seq).toBe(receipt.graphCursor.seq);expect(mutation.changes).toContainEqual(expect.objectContaining({type:'task.upserted',task:expect.objectContaining({taskId:nodes.b.taskId,dependencyReplacements:[receipt.replacement]})}));expect(mutation.changes).toContainEqual(expect.objectContaining({type:'edge.upserted',edge:expect.objectContaining({edgeId:receipt.replacement.retired.edgeId,enabled:false})}));expect(mutation.changes).toContainEqual(expect.objectContaining({type:'edge.upserted',edge:expect.objectContaining({edgeId:receipt.replacement.replacement.edgeId,enabled:true,condition:expect.objectContaining({resultId:nodes.a2.result!.resultId})})}));
    }
    if(mode==='restart-held'){
      const sequence=[...provider.sequence];await app.shutdown();provider.releaseMain();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(provider.sequence).toEqual(sequence);
    }else if(mode==='stop'){await app.dispatch('loop.stop',{id:entry.id,taskId:started.taskId});provider.releaseMain()}
    else provider.releaseMain();
    await vi.waitFor(async()=>{expect((await records()).scopes[0].status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:35000,interval:40});
    const finalRecords=await records(),scope=finalRecords.scopes[0],finished=await graph(),after=assertDependencyReplacement(finished,initial,before,receipt,mode==='complete');expect(scope.goal?.input).toEqual({message:data.goal,attachmentIds:[]});expect(scope.budget?.policy.enabled).toBe(false);
    if(mode==='complete'){
      expect(scope.outcome).toBe('completed');expect(provider.main).toHaveLength(21);expect(provider.member).toHaveLength(19);expect(scope.goal?.review?.superseded).toEqual([{taskId:after.a.taskId,replacementTaskIds:[after.a2.taskId],reason:expect.any(String)}]);
      const runs=await dependencyRuns(f.user,entry.id),bRun=runs.find(run=>run.binding.taskId===after.b.taskId)!,cRun=runs.find(run=>run.binding.taskId===after.c.taskId)!;expect(bRun.prerequisites).toEqual([{taskId:after.a2.taskId,planRevision:after.a2.planRevision,result:after.a2.result}]);expect(cRun.prerequisites).toEqual([{taskId:after.b.taskId,planRevision:after.b.planRevision,result:after.b.result}]);expect(bRun.binding.agentSessionId).toBe(initial.tasks.find(task=>task.taskId===after.b.taskId)!.assignee.agentSessionId);expect(cRun.binding.agentSessionId).toBe(initial.tasks.find(task=>task.taskId===after.c.taskId)!.assignee.agentSessionId);
      expect(provider.sequence.indexOf('member:4')).toBeLessThan(provider.sequence.indexOf('member:9'));expect(provider.sequence.indexOf('member:9')).toBeLessThan(provider.sequence.indexOf('member:14'));
    }else{expect(['cancelled','interrupted']).toContain(scope.outcome);expect(provider.main).toHaveLength(12);expect(provider.member).toHaveLength(9);expect((await dependencyRuns(f.user,entry.id)).some(run=>[after.b.taskId,after.c.taskId].includes(run.binding.taskId))).toBe(false)}
    const thread=await app.execution(entry.id).thread(started.taskId);expect(thread[2].toolReceipts?.find(item=>item.toolCallId==='replace-exact')?.outcome).toBe('succeeded');expect(finalRecords.messages.filter(message=>message.kind==='help')).toHaveLength(1);expect(provider.errors).toEqual([]);
    const sequence=[...provider.sequence],runs=await dependencyRuns(f.user,entry.id);await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await records()).toEqual(finalRecords);expect(await graph()).toEqual(finished);expect(await dependencyRuns(f.user,entry.id)).toEqual(runs);expect(provider.sequence).toEqual(sequence);for(let i=0;i<data.files.length;i++)expect(await fs.readFile(path.join(f.a,data.files[i]),'utf8')).toBe(data.facts[i]);
  }catch(error){failed=true;console.error(JSON.stringify({mode,temp:f.temp,sequence:provider.sequence,providerErrors:provider.errors,state:provider.state}));throw error}
  finally{provider.releaseMain();const errors:unknown[]=[];for(const clean of [()=>app.shutdown(),()=>f.cleanup(),()=>provider.close()])try{await clean()}catch(error){errors.push(error)}if(!failed&&errors.length)throw errors[0]}
},120000);
