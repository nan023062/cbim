import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {memberPauseServiceFixture} from './member-pause-service-fixture';
import {memberPauseSelection} from '../src/backend/core/tasks/member-pause-rules';
import {FileDispatchStore} from '../src/backend/main/persistence/tasks/dispatch-store';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/execution/dispatch-service';
import {request} from './helpers';
import {commitWorkspaceMember} from './workspace-member-fixture';
import {hash} from '../src/backend/core/foundation/serialization';
import {checkedMainToolResult} from '../src/backend/scheduler-engine/tools/main-tool-contracts';
import {projectMainScope} from '../src/backend/core/tasks/main-tool-scope';

it('可靠检查点和原后继持久等待，重开不重放；明确继续一次消费，仍以原权限和身份续执行',async()=>{
  const f=await memberPauseServiceFixture();try{
    const before=await f.store.read(),parked=await f.park(),state=await f.store.read();expect(parked.wait?.memberPause).toEqual(f.pause);expect(state.graphs).toEqual(before.graphs);expect(state.runs).toEqual(before.runs);expect(state.members).toEqual(before.members);expect(state.outbox).toEqual(before.outbox);expect(f.starts).toBe(1);
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{const service=new WorkspaceDispatchService(f.workspace,reader);await service.recoverScopes();expect(await service.waitingScopes()).toEqual([parked]);expect(await reader.read()).toEqual(state)}finally{await reader.close()}
    const input=await f.input();await f.service.memberPauses.preflight(input);expect(await f.store.read()).toEqual(state);expect(f.readCount()).toBe(0);
    const accepted=await f.service.continuations.accept(input,'explicit-main'),replay=await f.service.continuations.accept(input,'no-new-main');expect(accepted.fresh).toBe(true);expect(replay.fresh).toBe(false);expect(replay.continuation).toEqual(accepted.continuation);expect(accepted.continuation.wait).toEqual(parked.wait);
    await f.journal('explicit-main');const old=f.scope.goal!.plan!;await f.service.goals.plan(f.identity,f.scopeId,'explicit-main','replan-after-wait',{expectedRevision:accepted.scope.goal!.revision,objective:old.objective,constraints:old.constraints,criteria:old.criteria,assignments:old.assignments.map(({agentId,moduleIds,ownerSelection,criterionIds,reason})=>({agentId,moduleIds,ownerSelection,criterionIds,reason})),reason:'明确继续原任务'});
    const graph=await f.service.snapshot(f.identity),a=graph.tasks.find(t=>t.taskId===f.taskId)!;await f.members.requestResume(f.identity,f.scopeId,'explicit-main','reserve-after-wait',{expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:5,taskId:a.taskId,expectedRevision:a.revision,checkpointId:a.checkpoints![0].checkpointId,reason:'用户明确继续后核实原任务'},()=>{});
    await f.resume();await f.members.waitForSettlement({...f.identity,taskId:f.taskId});f.finishNewTasks();const updated=await f.service.snapshot(f.identity),b=updated.tasks.find(t=>t.taskId===f.b.taskId)!;await f.members.start({...f.identity,taskId:b.taskId,commandId:'after-pause-b',expectedRevision:b.revision,options:{permission:'read'}});await f.members.waitForSettlement({...f.identity,taskId:b.taskId});
    const final=await f.store.read(),aRuns=final.runs!.filter(r=>r.binding.taskId===f.taskId);expect(aRuns).toHaveLength(2);expect(aRuns[1].permission).toBe('read');expect(aRuns[1].binding.agentInstanceId).toBe(aRuns[0].binding.agentInstanceId);expect(aRuns[1].session).toEqual(aRuns[0].session);expect(final.runs!.find(r=>r.binding.taskId===b.taskId)!.prerequisites?.[0].result.runId).toBe(aRuns[1].binding.runId);expect(final.graphs[0].tasks.every(t=>t.status==='result_ready')).toBe(true);
  }finally{await f.cleanup()}
});

it('清单不能遗漏后继、伪造检查点、修改版本或包含无关未领取任务，拒绝已预约/已释放/未知段',async()=>{
  const f=await memberPauseServiceFixture();try{
    const state=await f.store.read(),scope=state.scopes![0];
    for(const alter of [(s:typeof state)=>{s.graphs[0].tasks[0].resumeRequest={} as never},(s:typeof state)=>{s.runs![0].status='interrupted'},(s:typeof state)=>{s.members.find(m=>m.executionTaskId===f.taskId)!.lifecycle='released'},(s:typeof state)=>{s.runs![0].checkpointProof!.logHash='invalid'},(s:typeof state)=>{s.graphs[0].edges=s.graphs[0].edges.filter(e=>e.kind!=='dependency')},(s:typeof state)=>{s.outbox.find(m=>m.kind==='assignment'&&m.taskId===f.b.taskId)!.delivery='processed'}]){const changed=structuredClone(state);alter(changed);expect(()=>memberPauseSelection(changed,scope,f.pause)).toThrow()}
    for(const pause of [{...f.pause,tasks:f.pause.tasks.slice(0,1)},{...f.pause,expectedGraphCursor:{...f.pause.expectedGraphCursor,seq:0}},{...f.pause,tasks:f.pause.tasks.map(t=>({...t,expectedRevision:t.expectedRevision+1}))}])await expect(f.service.goals.review(f.identity,f.scopeId,f.mainRunId,randomUUID(),{...f.review,memberPause:pause})).rejects.toMatchObject({code:'GOAL_MEMBER_PAUSE_INVALID'});
    await expect(f.service.goals.review(f.identity,f.scopeId,f.mainRunId,'invalid-complete',{...f.review,decision:'complete'})).rejects.toMatchObject({code:'GOAL_MEMBER_PAUSE_INVALID'});expect(await f.store.read()).toEqual(state);
  }finally{await f.cleanup()}
});

it('等待期间文件、native、canonical 或知识变化拒绝继续，原等待、输入和信封不消费',async()=>{
  const f=await memberPauseServiceFixture();try{
    await f.park();const input=await f.input(),before=await f.store.read();
    await fs.writeFile(path.join(f.a,'checkpoint.txt'),'external change');await expect(f.service.continuations.accept(input,'file-change')).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_ARTIFACT_CHANGED'});await fs.writeFile(path.join(f.a,'checkpoint.txt'),'captured bytes');
    f.native.mockResolvedValueOnce({byteLength:128,sha256:'b'.repeat(64)});await expect(f.service.memberPauses.preflight(input)).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_NATIVE_CHANGED'});
    f.inspect.mockImplementationOnce(async run=>({...await f.read(run),logIntegrity:{partialTail:true}}));await expect(f.service.continuations.accept(input,'bad-log')).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_INVALID'});
    expect(await f.store.read()).toEqual(before);expect(f.readCount()).toBe(0);expect(f.starts).toBe(1);
    const snapshot=await f.workspace.snapshot();await f.workspace.commit(request(snapshot,[{path:'.cbim/README.md',text:'# changed while waiting'}]));await expect(f.service.continuations.accept(input,'knowledge-change')).rejects.toMatchObject({code:'GOAL_KNOWLEDGE_CHANGED'});expect((await f.store.read()).scopes).toEqual(before.scopes);expect(f.readCount()).toBe(0);
  }finally{await f.cleanup()}
});

it('等待冻结任务/原生通道/派发信封；显式停止原子封存所有待办，旧等待不能复活',async()=>{
  const f=await memberPauseServiceFixture();try{
    const parked=await f.park(),input=await f.input(),before=await f.store.read(),session=before.sessions.find(s=>s.lastTaskId===f.taskId)!;
    await expect(f.store.transact({commandId:'late-session',fingerprint:'late-session'},async()=>({sessions:[{...session,nativeSessionId:'changed'}],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    const message=before.outbox.find(m=>m.kind==='assignment'&&m.taskId===f.b.taskId)!;await expect(f.store.transact({commandId:'late-message',fingerprint:'late-message'},async()=>({messages:[{...message,delivery:'processed'}],receipt:true}))).rejects.toThrow();expect(await f.store.read()).toEqual(before);
    await f.service.closeScope(f.identity,f.scopeId,'cancelled');const state=await f.store.read();expect(state.scopes![0].wait).toEqual(parked.wait);expect(state.graphs[0].tasks.every(t=>t.status==='cancelled')).toBe(true);expect(state.runs).toEqual(before.runs);expect(state.members.filter(m=>m.executionScopeId===f.scopeId).every(m=>m.lifecycle==='released'&&!m.activeRunId)).toBe(true);expect(state.outbox.filter(m=>m.kind==='assignment').every(m=>m.delivery==='processed')).toBe(true);
    await expect(f.service.continuations.accept(input,'cannot-revive')).rejects.toThrow();const reader=new FileDispatchStore(f.directory,f.entry.id);try{expect(await reader.read()).toEqual(state)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it('停止发生在核实 IO 时不消费等待；仅已保存的原命令可在关闭后查询',async()=>{
  const f=await memberPauseServiceFixture();try{
    await f.park();const input=await f.input(),before=await f.store.read(),controller=new AbortController();f.native.mockImplementationOnce(async()=>{controller.abort();return {byteLength:128,sha256:'a'.repeat(64)}});
    await expect(f.service.continuations.accept(input,'cancel-in-io',{signal:controller.signal})).rejects.toThrow();expect(await f.store.read()).toEqual(before);expect(f.readCount()).toBe(0);
    const accepted=await f.service.continuations.accept(input,'actual-main');await f.service.closeScope(f.identity,f.scopeId,'cancelled');expect((await f.service.continuations.accept(input,'never-new')).continuation).toEqual(accepted.continuation);expect(f.starts).toBe(1);
  }finally{await f.cleanup()}
});

it('同命令并发只有一次消费，等待岗位锁的重复请求返回原事实，不产生第二主运行',async()=>{
  const f=await memberPauseServiceFixture();try{
    await f.park();const input=await f.input(),results=await Promise.all(['one-main','other-main'].map(run=>f.service.continuations.accept(input,run)));
    expect(results.filter(r=>r.fresh)).toHaveLength(1);expect(results[0].continuation).toEqual(results[1].continuation);expect((await f.store.read()).scopes![0].continuations).toHaveLength(1);expect(f.readCount()).toBe(0);expect(f.starts).toBe(1);
    await expect(f.service.continuations.accept({...input,input:{message:'changed'}},'changed-main')).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
  }finally{await f.cleanup()}
});

it.each(['model','member'] as const)('等待后的真实岗位配置变化在主运行创建前拒绝（%s）',async change=>{
  const f=await memberPauseServiceFixture();try{
    await f.park();const input=await f.input(),before=await f.store.read();
    if(change==='model')await f.app.models.save({id:f.model.id,profile:{name:'changed model',api:'openai-completions',baseUrl:'https://example.test/v1',auth:'none',defaultModel:'fixture',models:[{id:'fixture',name:'fixture',enabled:true,contextWindow:200000,maxTokens:2048,reasoning:false,vision:false}]}});
    else{const member=before.workspaceMembers!.find(m=>m.memberId===f.task.ownerBinding!.memberId)!;await commitWorkspaceMember(f.app,f.entry.id,{kind:'state',memberId:member.memberId,expectedRevision:member.revision,nextState:'suspended',reason:'本机明确暂停岗位'})}
    await expect(f.service.memberPauses.preflight(input)).rejects.toMatchObject({code:change==='model'?'OWNER_MODEL_CHANGED':'OWNER_MEMBER_UNAVAILABLE'});const after=await f.store.read();expect(after.scopes).toEqual(before.scopes);expect(after.graphs).toEqual(before.graphs);expect(after.runs).toEqual(before.runs);expect(f.starts).toBe(1);expect(f.readCount()).toBe(0);
  }finally{await f.cleanup()}
});

it('等待清单在原 wire 中与实际请求精确相同；损坏回包不能省略或替换已保存清单',async()=>{
  const f=await memberPauseServiceFixture();try{
    const saved=await f.service.goals.review(f.identity,f.scopeId,f.mainRunId,'review-wire',f.review),binding={...f.identity,scopeId:f.scopeId,runId:f.mainRunId},scope=projectMainScope(saved);
    expect(()=>checkedMainToolResult('cbim_goal_review',scope,binding,f.review,'call-review')).not.toThrow();
    const changed=structuredClone(scope);changed.goal!.review!.memberPause!.tasks.pop();expect(()=>checkedMainToolResult('cbim_goal_review',changed,binding,f.review,'call-review')).toThrow();expect((await f.store.read()).scopes![0]).toEqual(saved);
  }finally{await f.cleanup()}
});

it('即使重新计算日志哈希，重放仍拒绝遗漏未领取后继的等待清单',async()=>{
  const f=await memberPauseServiceFixture();try{
    await f.park();const file=path.join(f.directory,'dispatch.jsonl'),original=await fs.readFile(file,'utf8'),records=original.trim().split('\n').map(line=>JSON.parse(line));
    const scope=records.at(-1).body.mutation.scopes[0];scope.wait.memberPause.tasks.pop();scope.goal.review.memberPause.tasks.pop();let prior='';for(const record of records){record.body.previousHash=prior;record.checksum=hash(JSON.stringify(record.body));prior=record.checksum}
    await fs.writeFile(file,records.map(record=>JSON.stringify(record)).join('\n')+'\n');const reader=new FileDispatchStore(f.directory,f.entry.id);try{await expect(reader.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'})}finally{await reader.close();await fs.writeFile(file,original)}
  }finally{await f.cleanup()}
});
