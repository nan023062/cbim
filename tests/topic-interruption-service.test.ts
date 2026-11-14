import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fixture} from './helpers';
import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';
import {WorkspaceDispatchService} from '../src/logic/dispatch/runtime/dispatch-service';
import {RunJournal} from '../src/logic/execution/storage/run-journal';
import type {TaskSpec} from '../src/logic/tasks/rules/types';
import type {TopicInterruptionRequest} from '../src/logic/tasks/rules/topic-interruption';
import {pendingTopicInterruption} from '../src/logic/tasks/rules/topic-interruption';
import {mainToolScopeSchema} from '../src/logic/tasks/rules/main-tool-scope';

async function setup(){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id);
  const identity={workspaceId:entry.id,rootSessionId:'topic-root'},directory=path.join(f.user,'topic-interruption'),store=new FileDispatchStore(directory,entry.id),service=new WorkspaceDispatchService(workspace,store);
  const task:TaskSpec={...identity,taskId:identity.rootSessionId,root:f.a,goal:'原始目标',mode:'chat',agentId:'cbim:main',moduleIds:[],acceptance:[]};
  const binding=await service.conversationBinding(task);
  await service.openScope(identity,'topic',{message:'原始目标'},'main-first');
  async function journal(runId='main-first',status:'cancelled'|'completed'|'interrupted'='cancelled'){
    const journal=new RunJournal(path.join(f.user,'topic-runs',runId),task,runId);await journal.init();
    await journal.append({type:'run.started',data:{task,message:'原始目标',conversationBinding:binding}});
    await journal.append({type:'session.bound',data:{sessionFile:'fixture/native.jsonl',sessionId:'fixture-native'}});
    await journal.append(status==='interrupted'?{type:'run.interrupted',data:{error:'未知工具结果',unresolvedTools:['unknown-tool']}}:{type:'run.settled',data:{status}});
    return RunJournal.read(journal.directory);
  }
  const request:TopicInterruptionRequest={...identity,scopeId:'topic',expectedInputRevision:1,commandId:randomUUID(),input:{message:'  改为分步处理\n保持原话题'},options:{provider:'fixture',model:'fixture',profileId:randomUUID(),permission:'read'}};
  return {...f,identity,store,service,directory,request,journal,cleanup:async()=>{await store.close();await f.cleanup()}};
}

it('保存原补充后才停泊，安全取消主轮可以接续原话题；重复命令、版本与归档可重放',async()=>{
  const f=await setup();try{
    const requested=await f.service.interruptions.prepare(f.request);
    expect(requested.status).toBe('active');expect(requested.wait).toBeUndefined();
    expect(pendingTopicInterruption(requested)?.request).toEqual(f.request);
    expect(await f.service.interruptions.prepare(f.request)).toEqual(requested);
    await expect(f.service.interruptions.prepare({...f.request,input:{message:'换原文'}})).rejects.toMatchObject({code:'TOPIC_INPUT_CONFLICT'});
    await expect(f.service.interruptions.prepare({...f.request,commandId:randomUUID()})).rejects.toMatchObject({code:'TOPIC_NOT_ACTIVE'});
    await expect(f.service.interruptions.prepare({...f.request,rootSessionId:'other'})).rejects.toMatchObject({code:'TOPIC_IDENTITY'});
    const parked=await f.service.interruptions.park(f.request,await f.journal());
    expect(parked).toMatchObject({status:'waiting',goal:{revision:1},wait:{interruptionId:f.request.commandId,runId:'main-first'}});
    const read=await f.service.sessionRead({identity:f.identity,selectedScopeId:'topic'});
    expect(read.detail.mode).toBe('updated');if(read.detail.mode==='updated')expect(mainToolScopeSchema.safeParse(read.detail.scope).success).toBe(true);
    const continuation={...f.request,waitId:parked.wait!.waitId,expectedGoalRevision:1};
    await expect(f.service.continuations.accept({...continuation,input:{message:'替换暂停原文'}},'main-second')).rejects.toMatchObject({code:'TOPIC_INPUT_CONFLICT'});
    const accepted=await f.service.continuations.accept(continuation,'main-second');
    expect(accepted.scope).toMatchObject({status:'active',goal:{input:{message:'原始目标'},inputRevision:2,revision:2}});
    expect(pendingTopicInterruption(accepted.scope)).toBeUndefined();
    expect((await f.service.continuations.accept(continuation,'unused')).fresh).toBe(false);
    expect((await f.service.interruptions.prepare(f.request)).continuations).toEqual([accepted.continuation]);
    const next={...f.request,commandId:randomUUID(),expectedInputRevision:2};
    await f.service.interruptions.prepare(next);
    const pausedAgain=await f.service.interruptions.park(next,await f.journal('main-second'));
    expect(pausedAgain.wait?.mainRunIds).toEqual(['main-first','main-second']);
    await f.store.close();const replay=new FileDispatchStore(f.directory,f.identity.workspaceId);
    try{expect((await replay.read()).scopes?.[0]).toEqual(pausedAgain)}finally{await replay.close()}
  }finally{await f.cleanup()}
});

it('未知主轮不能被标记为安全暂停，原补充保留且新话题不能越过占位',async()=>{
  const f=await setup();try{
    await f.service.interruptions.prepare(f.request);
    await expect(f.service.interruptions.park(f.request,await f.journal('main-first','interrupted'))).rejects.toMatchObject({code:'TOPIC_MAIN_UNSETTLED'});
    const scope=(await f.store.read()).scopes![0];expect(scope.status).toBe('active');expect(scope.wait).toBeUndefined();expect(pendingTopicInterruption(scope)?.request).toEqual(f.request);
    await expect(f.service.openScope(f.identity,'later',{message:'后续任务'},'later-main')).rejects.toMatchObject({code:'DISPATCH_SCOPE_BUSY'});
    await f.service.recoverScopes();const recovered=(await f.store.read()).scopes![0];
    expect(recovered).toMatchObject({status:'closed',outcome:'interrupted'});expect(recovered.wait).toBeUndefined();expect(pendingTopicInterruption(recovered)?.request).toEqual(f.request);
  }finally{await f.cleanup()}
});

it('已结束话题拒绝打断请求，不能借补充重开历史',async()=>{
  const f=await setup();try{
    await f.service.closeScope(f.identity,'topic','cancelled');
    await expect(f.service.interruptions.prepare(f.request)).rejects.toMatchObject({code:'TOPIC_NOT_ACTIVE'});
    expect((await f.store.read()).scopes![0].topicInterruptions).toBeUndefined();
  }finally{await f.cleanup()}
});
