import {expect,it,vi} from 'vitest';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import type {ReplaceQueuedDependencyReceipt} from '../src/logic/tasks/rules/queued-dependency-replacement';
import {abandonedDependencyProvider,abandonedDependencyData as data} from './abandoned-checkpoint-dependency-provider';
import {seedAbandonedDependency,assertAbandonedDependency,abandonedRecords,abandonedWait,abandonedRunBytes,abandonedRunByteEvidence} from './abandoned-checkpoint-dependency-fixture';

it.each(['complete','bad-output','submitted-stop','restart-held']as const)('真实Pi显式放弃检查点并保留后继换边：%s',async mode=>{
  const f=await fixture(),provider=await abandonedDependencyProvider({badOutput:mode==='bad-output'});let app=f.app,receipt:ReplaceQueuedDependencyReceipt|undefined,restore=()=>{},invocations=0;
  try{
    // 本例核实长链事务与坏回包恢复，保留全部调用证据；64K 会触发原生摘要并超出此确定性供应商协议。
    // 仅本 fixture 使用 128K，真实摘要仍由 pi-runtime-config/model-request-budget-pi 独立覆盖。
    const {entry}=await seedAbandonedDependency(app,f.a,provider,131072),service=app.memberDispatch(entry.id),original=service.replaceQueuedDependency.bind(service);let originalArgs:Parameters<typeof original>|undefined;
    const spy=vi.spyOn(service,'replaceQueuedDependency').mockImplementation(async(...args)=>{invocations++;originalArgs=args;receipt=await original(...args);return mode==='bad-output'?{...receipt,taskId:'wrong-task'}:receipt});restore=()=>spy.mockRestore();
    const start=await app.dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:'read',turnTimeoutMs:60000}}),identity={workspaceId:entry.id,rootSessionId:start.taskId},records=()=>abandonedRecords(f.user,entry.id),graph=()=>app.memberDispatch(entry.id).snapshot(identity);
    await abandonedWait(async()=>{expect(provider.errors).toEqual([]);return provider.main.length===provider.heldTurn+1&&!!receipt},'检查点放弃和替换均已实际保存');expect(provider.member).toHaveLength(10);
    // HTTP 请求已到达不代表暂停文本已落入 canonical；先等真实日志，避免把读取期间变化的保护误判成提交失败。
    await abandonedWait(async()=>{const summary=await app.execution(entry.id).inspect(start.taskId,receipt!.mainRunId);return summary.events.filter(event=>event.type==='message.delta').map(event=>typeof event.data.text==='string'?event.data.text:'').join('').includes(data.held)},'暂停响应已写入原运行日志');
    const saved=await graph(),before=provider.state.beforeReplacement!,initial=provider.state.initialGraph!,nodes=assertAbandonedDependency(saved,initial,before,receipt!,false),held=await records();
    expect(held.runs).toHaveLength(2);const reservations=held.messages.filter(m=>m.kind==='assignment'&&m.resumeFrom);expect(reservations).toHaveLength(1);expect(reservations[0].delivery).toBe('processed');expect(reservations[0].claim).toBeUndefined();
    const sourceRun=held.runs.find(r=>r.binding.taskId===nodes.a.taskId)!;expect(sourceRun.resumeFrom).toBeUndefined();expect(sourceRun.checkpointProof).toBeDefined();
    const heldBytes=await abandonedRunBytes(f.user,entry.id,start.taskId,await app.execution(entry.id).thread(start.taskId),held.runs),sourceBytes=heldBytes.filter(b=>b.taskId===nodes.a.taskId);
    restore();restore=()=>{};expect(await service.replaceQueuedDependency(...originalArgs!)).toEqual(receipt);expect(await records()).toEqual(held);
    const report=await service.commandReport({...identity,runId:receipt!.mainRunId,toolCallId:'abandoned-replace'});expect(report.command.state).toBe('committed');expect(report.source.outcome).toBe(mode==='bad-output'?'failed':'succeeded');expect(await records()).toEqual(held);
    if(mode==='submitted-stop')await app.dispatch('loop.stop',{id:entry.id,taskId:start.taskId});
    else if(mode==='restart-held'){const sequence=[...provider.sequence];await app.shutdown();provider.releaseMain();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(provider.sequence).toEqual(sequence)}
    provider.releaseMain();await abandonedWait(async()=>(await records()).scopes[0].status==='closed'&&app.runtime.snapshot().pressure.activeRuns===0,'替换后周期实际结束');
    const final=await records(),finished=await graph(),complete=mode==='complete'||mode==='bad-output',after=assertAbandonedDependency(finished,initial,before,receipt!,complete);expect(invocations).toBe(1);expect(provider.errors).toEqual([]);
    if(complete){expect(final.scopes[0].outcome).toBe('completed');expect(provider.member).toHaveLength(20);expect(provider.main).toHaveLength(provider.heldTurn+10);expect(final.runs).toHaveLength(4);expect(final.scopes[0].goal!.review!.superseded).toEqual([{taskId:after.a.taskId,replacementTaskIds:[after.a2.taskId],reason:expect.any(String)}]);
      const b=final.runs.find(r=>r.binding.taskId===after.b.taskId)!,c=final.runs.find(r=>r.binding.taskId===after.c.taskId)!;expect(b.prerequisites).toEqual([{taskId:after.a2.taskId,planRevision:after.a2.planRevision,result:after.a2.result}]);expect(c.prerequisites).toEqual([{taskId:after.b.taskId,planRevision:after.b.planRevision,result:after.b.result}]);
    }else{expect(['cancelled','interrupted']).toContain(final.scopes[0].outcome);expect(provider.member).toHaveLength(10);expect(final.runs).toHaveLength(2)}
    const bytes=await abandonedRunBytes(f.user,entry.id,start.taskId,await app.execution(entry.id).thread(start.taskId),final.runs);expect(bytes.filter(b=>b.taskId===nodes.a.taskId)).toEqual(sourceBytes);
    const sequence=[...provider.sequence];await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await records()).toEqual(final);expect(await graph()).toEqual(finished);expect(await abandonedRunBytes(f.user,entry.id,start.taskId,await app.execution(entry.id).thread(start.taskId),final.runs)).toEqual(bytes);expect(provider.sequence).toEqual(sequence);
    expect(abandonedRunByteEvidence(bytes).length).toBeGreaterThanOrEqual(5);
  }catch(error){console.error(JSON.stringify({mode,temp:f.temp,sequence:provider.sequence,providerErrors:provider.errors}));throw error}
  finally{restore();provider.releaseMain();await app.shutdown();await provider.close();await f.cleanup()}
},120000);
