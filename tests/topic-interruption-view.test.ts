import {expect,it,vi} from 'vitest';
import {TopicInterruptionController,checkedTopicInterruptionReceipt,type TopicInterruptionPorts} from '../src/view/conversation/topic-interruption-state';
import type {TopicInterruptionRequest,GoalContinuationReceipt} from '../src/bridge/contracts/dispatch';

const target={workspaceId:'workspace',rootSessionId:'root',scopeId:'scope',expectedInputRevision:1};
const options={provider:'cbim-11111111-1111-4111-8111-111111111111',profileId:'11111111-1111-4111-8111-111111111111',model:'model',permission:'ask' as const};
const command='22222222-2222-4222-8222-222222222222',time='2026-11-14T00:00:00.000Z';
const request:TopicInterruptionRequest={...target,commandId:command,input:{message:'补充原文'},options};
function receipt(value:TopicInterruptionRequest):GoalContinuationReceipt{return {workspaceId:target.workspaceId,rootSessionId:target.rootSessionId,scopeId:target.scopeId,scopeStatus:'active',continuation:{continuationId:value.commandId,acceptedAt:time,wait:{waitId:value.commandId,interruptionId:value.commandId,reason:'整组已退出',createdAt:time,runId:'old-run',goalRevision:3,graphCursor:{streamId:'graph',seq:1},knowledgeRevision:'knowledge',mainRunIds:['old-run']},inputRevision:value.expectedInputRevision+1,input:structuredClone(value.input),runId:'new-run',options:structuredClone(value.options)}}}
function fixture(submit:TopicInterruptionPorts['submit']=async value=>receipt(value),lookup:TopicInterruptionPorts['lookup']=async()=>undefined){
  const saved=new Map<string,string>(),send=vi.fn(submit),query=vi.fn(lookup),ports:TopicInterruptionPorts={storage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>{saved.set(key,value)}},uuid:()=>command,submit:send,lookup:query};
  return {saved,ports,send,query,controller:new TopicInterruptionController(target,ports)};
}
it('浏览及重开只查询，提交前持久冻结原文且双击只产生一个命令',async()=>{
  let finish!:(value:unknown)=>void;
  const f=fixture(value=>{expect([...f.saved.values()].map(value=>JSON.parse(value))).toEqual([value]);return new Promise(resolve=>{finish=resolve})});
  await f.controller.restore();expect(f.send).not.toHaveBeenCalled();expect(f.query).not.toHaveBeenCalled();
  const first=f.controller.submit('  原文\n保持  ',options),second=f.controller.submit('另一份',options);expect(first).toBe(second);
  await Promise.resolve();expect(f.send).toHaveBeenCalledTimes(1);const value=f.send.mock.calls[0][0];expect(value.input.message).toBe('  原文\n保持  ');
  finish(receipt(value));await first;expect(f.controller.snapshot.receipt?.continuation.runId).toBe('new-run');
  const reopened=new TopicInterruptionController(target,f.ports);await reopened.restore();expect(f.query).toHaveBeenCalledTimes(1);expect(f.send).toHaveBeenCalledTimes(1);
});
it('通信未知保留原请求，明确重试先查回执且不改变模型、权限或命令',async()=>{
  const f=fixture(async()=>{throw Error('IPC_TIMEOUT')});await f.controller.restore();await f.controller.submit(request.input.message,options);
  expect(f.controller.snapshot.request).toEqual(request);expect(f.controller.snapshot.error).toContain('IPC_TIMEOUT');
  await f.controller.submit('不同正文',{...options,permission:'execute'});expect(f.send).toHaveBeenCalledTimes(1);
  f.send.mockImplementation(async value=>receipt(value));await f.controller.retry();expect(f.query).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[1][0]).toEqual(request);
  await f.controller.retry();expect(f.send).toHaveBeenCalledTimes(2);
});
it('服务已受理但响应丢失，重开和重试都从原回执恢复且不重新提交',async()=>{
  let accepted:GoalContinuationReceipt|undefined;const f=fixture(async value=>{accepted=receipt(value);throw Error('断开')},async()=>accepted);
  await f.controller.restore();await f.controller.submit(request.input.message,options);const reopened=new TopicInterruptionController(target,f.ports);await reopened.restore();await reopened.retry();
  expect(f.send).toHaveBeenCalledTimes(1);expect(reopened.snapshot.receipt).toEqual(accepted);
});
it('保存失败不发送；损坏记录和跨办公室记录不能作为空草稿覆盖',async()=>{
  const f=fixture();await f.controller.restore();f.ports.storage.setItem=()=>{throw Error('QuotaExceededError')};await f.controller.submit('保留',options);expect(f.send).not.toHaveBeenCalled();expect(f.controller.snapshot.request).toBeUndefined();
  for(const raw of ['broken',JSON.stringify({...request,rootSessionId:'foreign'})]){
    const bad=fixture();bad.ports.storage.getItem=()=>raw;await bad.controller.restore();await bad.controller.submit('覆盖',options);expect(bad.send).not.toHaveBeenCalled();expect(bad.controller.snapshot.ready).toBe(false);
  }
});
it('同一话题的另一表单发现已保存请求时不能新建第二条，服务器原请求可只读接管',async()=>{
  const f=fixture();await f.controller.restore();const second=new TopicInterruptionController(target,f.ports);await second.restore();
  await f.controller.submit(request.input.message,options);await second.submit('另一入口',options);expect(f.send).toHaveBeenCalledTimes(1);expect(second.snapshot.request).toEqual(request);
  const remote=fixture();await remote.controller.restore(request);expect(remote.send).not.toHaveBeenCalled();expect(remote.query).toHaveBeenCalledTimes(1);expect([...remote.saved.values()].map(value=>JSON.parse(value))).toEqual([request]);
  await remote.controller.restore({...request,input:{message:'不同服务器请求'}});expect(remote.controller.snapshot.error).toContain('不同');await remote.controller.retry();expect(remote.send).not.toHaveBeenCalled();
});
it('迟到回执只写原话题，身份/版本/原文/运行不符均不能作为受理事实',async()=>{
  let finish!:(value:unknown)=>void;const f=fixture(()=>new Promise(resolve=>{finish=resolve}));await f.controller.restore();const pending=f.controller.submit(request.input.message,options);await Promise.resolve();
  const next=new TopicInterruptionController({...target,scopeId:'other'},f.ports);await next.restore();finish(receipt(request));await pending;expect(next.snapshot.request).toBeUndefined();expect(next.snapshot.receipt).toBeUndefined();
  const accepted=receipt(request);
  for(const bad of [{...accepted,rootSessionId:'other'},{...accepted,continuation:{...accepted.continuation,inputRevision:3}},{...accepted,continuation:{...accepted.continuation,input:{message:'伪造'}}},{...accepted,continuation:{...accepted.continuation,wait:{...accepted.continuation.wait,interruptionId:undefined}}}])expect(()=>checkedTopicInterruptionReceipt(bad,request)).toThrow();
  expect(()=>checkedTopicInterruptionReceipt({...accepted,continuation:{...accepted.continuation,runId:'replaced'}},request,accepted)).toThrow();
});

it('频道附件随原请求冻结，未知后的重试不借用其他频道的选择',async()=>{
 const f=fixture(async()=>{throw Error('IPC_TIMEOUT')});await f.controller.restore();const ids=['33333333-3333-4333-8333-333333333333'];await f.controller.submit('附件补充',options,ids);ids.push('44444444-4444-4444-8444-444444444444');
 expect(f.controller.snapshot.request?.input.attachmentIds).toEqual(['33333333-3333-4333-8333-333333333333']);
 f.send.mockImplementation(async value=>receipt(value));await f.controller.retry();expect(f.send.mock.calls[1][0].input.attachmentIds).toEqual(['33333333-3333-4333-8333-333333333333']);
});
