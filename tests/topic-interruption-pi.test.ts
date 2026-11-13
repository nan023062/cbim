import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {activeInputProvider,activeInputData as data} from './active-goal-input-provider';
import {activeInputWait,seedActiveInput} from './active-goal-input-fixture';

it('真实 Pi 中断旧主轮后按原话题新版本重新规划，已返回成员候选不重放',async()=>{
  const f=await fixture(),provider=await activeInputProvider('replan');
  try{
    const seed=await seedActiveInput(f.app,f.a,f.user,provider),started=await f.app.dispatch('loop.chat',{id:seed.entry.id,message:data.goal,options:seed.options});
    await activeInputWait(async()=>provider.main.length===6,'旧主轮已审阅且仍在输出');
    const original=(await seed.scopes())[0],identity={workspaceId:seed.entry.id,rootSessionId:started.taskId};
    const before=await f.app.dispatch('dispatch.graphSnapshot',{identity});
    const request={...identity,scopeId:original.scopeId,expectedInputRevision:1,commandId:randomUUID(),input:{message:data.insert},options:seed.options};
    const [accepted,repeated]=await Promise.all([f.app.dispatch('loop.topicInterrupt',request),f.app.dispatch('loop.topicInterrupt',request)]);
    expect(repeated.continuation).toEqual(accepted.continuation);expect(accepted.continuation.wait.interruptionId).toBe(request.commandId);
    await activeInputWait(async()=>{const scope=(await seed.scopes())[0];return scope.status==='closed'&&f.app.runtime.snapshot().pressure.activeRuns===0},'新输入在原话题重新审阅完成');
    const scopes=await seed.scopes(),scope=scopes[0],thread=await f.app.execution(seed.entry.id).thread(started.taskId);
    expect(scopes).toHaveLength(1);expect(scope).toMatchObject({scopeId:original.scopeId,status:'closed',outcome:'completed',goal:{inputRevision:2,review:{inputRevision:2,decision:'complete'}}});
    expect(scope.goal?.input).toEqual(original.goal?.input);expect(scope.topicInterruptions?.[0].request).toEqual(request);
    expect(thread).toHaveLength(3);expect(thread[1].status).toBe('cancelled');expect(thread[2].source).toMatchObject({kind:'user-continuation',scopeId:original.scopeId,interruptionId:request.commandId,inputRevision:2});
    expect(provider.member).toHaveLength(5);expect((await f.app.dispatch('dispatch.graphSnapshot',{identity})).tasks).toEqual(before.tasks);
    const count=provider.main.length;expect((await f.app.dispatch('loop.topicInterrupt',request)).continuation).toEqual(accepted.continuation);expect(provider.main).toHaveLength(count);expect(provider.errors).toEqual([]);
  }finally{provider.release();await f.cleanup();await provider.close()}
},90000);
