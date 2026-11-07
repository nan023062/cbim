import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {hash,json} from '../src/backend/core/foundation/serialization';
import {checkedRunInputSource} from '../src/backend/core/brain/input-source';
import type {TaskSpec} from '../src/backend/core/brain/types';
import {continuationAttachmentManifestSchema,assertContinuationAttachmentManifest,continuationAttachmentLimits,type ContinuationAttachmentManifest} from '../src/backend/core/tasks/scope-continuation-attachments';
import {goalContinuationRequestSchema,goalContinuationReceiptSchema,type GoalContinuationRequest} from '../src/backend/core/tasks/scope-continuation';
import {FileDispatchStore} from '../src/backend/main/persistence/tasks/dispatch-store';
import {RunJournal} from '../src/backend/main/persistence/tasks/run-journal';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/execution/dispatch-service';

function manifest(ids:string[],message='补充说明'):ContinuationAttachmentManifest{return {version:1,items:ids.map((attachmentId,index)=>({attachmentId,kind:'file',contentKind:index?'image':'text',name:index?'figure.png':'notes.txt',snapshotHash:hash('snapshot-'+index),contentHash:hash('content-'+index),byteLength:16,...(index?{mimeType:'image/png' as const}:{})})) as ContinuationAttachmentManifest['items'],expandedMessageHash:hash(message+'\n保存的附件快照'),expandedMessageBytes:256}}
function lookup(input:GoalContinuationRequest){const {workspaceId,rootSessionId,scopeId,commandId}=input;return {workspaceId,rootSessionId,scopeId,commandId}}
async function setup(){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),identity={workspaceId:entry.id,rootSessionId:'attachment-root'},directory=path.join(f.user,'attachment-continuations'),store=new FileDispatchStore(directory,entry.id);
  const runId='attachment-initial',task:TaskSpec={mode:'chat',taskId:identity.rootSessionId,workspaceId:entry.id,root:f.a,goal:'保留原目标',agentId:'cbim:main',moduleIds:[],acceptance:[]},journal=new RunJournal(path.join(f.user,'attachment-main'),task,runId);
  const service=new WorkspaceDispatchService(workspace,store,{inspectMain:async()=>RunJournal.read(journal.directory),inspectMember:async()=>{throw Error('unexpected member')}}),binding=await service.conversationBinding(task);
  const scope=await service.openScope(identity,'attachment-scope',{message:'最初原文',attachmentIds:[]},runId);
  await journal.init();await journal.append({type:'run.started',data:{task,message:'最初原文',conversationBinding:binding}});
  await service.goals.plan(identity,scope.scopeId,runId,'attachment-plan',{expectedRevision:1,objective:'保留原目标',constraints:[],criteria:[{id:'human',text:'等待真实补充',kind:'human'}],assignments:[{agentId:'cbim:main',moduleIds:[],criterionIds:['human'],reason:'管理目标'}],reason:'等待信息'});
  await service.goals.review(identity,scope.scopeId,runId,'attachment-review',{expectedRevision:2,decision:'awaiting_user',checks:[{criterionId:'human',outcome:'needs_human',reason:'仍需补充',evidence:[]}],superseded:[],gaps:['资料未提供'],reason:'等待用户'});
  await journal.append({type:'run.settled',data:{status:'completed'}});
  const parked=await service.parkScope(identity,scope.scopeId,await RunJournal.read(journal.directory),[runId]),ids=[randomUUID(),randomUUID()];
  const input:GoalContinuationRequest={...identity,scopeId:scope.scopeId,waitId:parked.wait!.waitId,expectedGoalRevision:parked.goal!.revision,expectedInputRevision:1,commandId:randomUUID(),input:{message:'补充说明',attachmentIds:ids},options:{provider:'fixture',model:'fixture',profileId:randomUUID(),permission:'read'}};
  return {...f,entry,workspace,identity,directory,store,service,scope,parked,input,manifest:manifest(ids),cleanup:async()=>{await store.close();await f.cleanup()}};
}

it('附件协议拒绝 IPC 清单、重复引用及不匹配清单，旧文本保持没有新增字段',()=>{
  const ids=[randomUUID(),randomUUID()],value=manifest(ids);
  expect(continuationAttachmentManifestSchema.parse(value)).toEqual(value);
  expect(()=>assertContinuationAttachmentManifest({message:'补充',attachmentIds:ids},value)).not.toThrow();
  const invalid=[undefined,{...value,items:[...value.items].reverse()},{...value,items:[value.items[0]]},{...value,expandedMessageBytes:1},{...value,images:['secret']},{...value,items:[{...value.items[0],path:'/private/source'},value.items[1]]}];
  for(const item of invalid)expect(()=>assertContinuationAttachmentManifest({message:'补充',attachmentIds:ids},item)).toThrow();
  expect(()=>assertContinuationAttachmentManifest({message:'补充'},value)).toThrow();
  expect(()=>assertContinuationAttachmentManifest({message:'补充'},undefined)).not.toThrow();
  const request={workspaceId:'workspace',rootSessionId:'root',scopeId:'scope',waitId:'wait',expectedGoalRevision:3,expectedInputRevision:1,commandId:randomUUID(),input:{message:'原文'},options:{provider:'p',model:'m',profileId:randomUUID(),permission:'read'}};
  expect(goalContinuationRequestSchema.parse(request)).toEqual(request);
  for(const input of [{...request.input,attachmentManifest:value},{...request.input,attachmentIds:[]},{...request.input,attachmentIds:[ids[0],ids[0]]},{...request.input,attachmentIds:Array.from({length:13},()=>randomUUID())}])expect(goalContinuationRequestSchema.safeParse({...request,input}).success).toBe(false);
});

it('清单限定解码图片与文本快照大小，禁止隐含 MIME、绝对路径和不安全数值',()=>{
  const value=manifest([randomUUID(),randomUUID()]),image=value.items[1];
  for(const item of [{...image,byteLength:continuationAttachmentLimits.imageBytes+1},{...image,byteLength:0},{...image,mimeType:undefined},{...image,mimeType:'application/octet-stream'},{...image,contentHash:'A'.repeat(64)},{...value.items[0],byteLength:Infinity},{...value.items[0],mimeType:'image/png'}])expect(continuationAttachmentManifestSchema.safeParse({...value,items:[item]}).success).toBe(false);
  const images=Array.from({length:5},()=>({...image,attachmentId:randomUUID(),byteLength:continuationAttachmentLimits.imageBytes}));
  expect(continuationAttachmentManifestSchema.safeParse({...value,items:images}).success).toBe(false);
  expect(continuationAttachmentManifestSchema.safeParse({...value,expandedMessageBytes:continuationAttachmentLimits.expandedMessageBytes+1}).success).toBe(false);
});

it('真实事务同序持久化清单、隔离输入别名，重复命令不需要附件仍可读取',async()=>{
  const f=await setup();try{
    const original=structuredClone(f.input),expected=structuredClone(f.manifest),runId=randomUUID(),pending=f.service.continuations.accept(f.input,runId,{attachmentManifest:f.manifest});
    f.input.input.attachmentIds!.reverse();f.manifest.items[0].name='后改名称';
    const accepted=await pending;expect(accepted.fresh).toBe(true);expect(accepted.continuation).toMatchObject({input:original.input,attachmentManifest:expected,runId,inputRevision:2});
    expect(accepted.scope.goal!.input).toEqual(f.scope.goal!.input);expect(accepted.scope.runTracking!.mainRunIds).toEqual(['attachment-initial',runId]);expect(accepted.scope.goal!.review).toBeUndefined();
    const before=await fs.readFile(path.join(f.directory,'dispatch.jsonl'),'utf8'),aborted=new AbortController();aborted.abort();
    const duplicate=await f.service.continuations.accept(original,randomUUID(),{signal:aborted.signal});expect(duplicate.fresh).toBe(false);expect(duplicate.continuation).toEqual(accepted.continuation);
    const receipt=await f.service.continuations.inspect(lookup(original));expect(goalContinuationReceiptSchema.parse(JSON.parse(JSON.stringify(receipt)))).toEqual(receipt);expect(await fs.readFile(path.join(f.directory,'dispatch.jsonl'),'utf8')).toBe(before);
    for(const changed of [{...original,input:{...original.input,attachmentIds:[...original.input.attachmentIds!].reverse()}},{...original,input:{...original.input,attachmentIds:[randomUUID()]}},{...original,options:{...original.options,permission:'ask' as const}}])await expect(f.service.continuations.accept(changed,randomUUID())).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    await f.service.closeScope(f.identity,f.scope.scopeId,'cancelled');const reader=new FileDispatchStore(f.directory,f.entry.id);try{const service=new WorkspaceDispatchService(f.workspace,reader);expect((await service.continuations.accept(original,randomUUID())).continuation).toEqual(accepted.continuation);expect((await reader.read()).runs).toEqual([])}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it('缺少或错绑快照在预算和受理之前拒绝，原等待及派发日志完全不变',async()=>{
  const f=await setup();try{
    const before=await fs.readFile(path.join(f.directory,'dispatch.jsonl'),'utf8'),admit=vi.spyOn(f.service.budgets,'admit');
    for(const value of [undefined,{...f.manifest,items:[...f.manifest.items].reverse()}])await expect(f.service.continuations.accept(f.input,randomUUID(),{attachmentManifest:value})).rejects.toMatchObject({code:'GOAL_ATTACHMENT_MANIFEST'});
    await expect(f.service.continuations.accept({...f.input,input:{message:'没有附件'}},randomUUID(),{attachmentManifest:f.manifest})).rejects.toMatchObject({code:'GOAL_ATTACHMENT_MANIFEST'});
    expect(admit).not.toHaveBeenCalled();expect((await f.store.read()).scopes![0]).toEqual(f.parked);expect(await fs.readFile(path.join(f.directory,'dispatch.jsonl'),'utf8')).toBe(before);
  }finally{await f.cleanup()}
});

it('预算读取期间停止不消费等待、输入版本、附件或运行名额',async()=>{
  const f=await setup();try{
    const before=await fs.readFile(path.join(f.directory,'dispatch.jsonl'),'utf8'),original=f.service.budgets.admit.bind(f.service.budgets),controller=new AbortController();
    let entered!:()=>void,release!:()=>void;const inside=new Promise<void>(resolve=>entered=resolve),barrier=new Promise<void>(resolve=>release=resolve);
    vi.spyOn(f.service.budgets,'admit').mockImplementation(async(...args)=>{entered();await barrier;return original(...args)});
    const pending=f.service.continuations.accept(f.input,randomUUID(),{attachmentManifest:f.manifest,signal:controller.signal}),rejection=expect(pending).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});
    await inside;controller.abort(Object.assign(Error('stop'),{code:'COLLABORATION_STOPPED'}));release();await rejection;
    expect((await f.store.read()).scopes![0]).toEqual(f.parked);expect(await f.service.continuations.inspect(lookup(f.input))).toBeUndefined();expect(await fs.readFile(path.join(f.directory,'dispatch.jsonl'),'utf8')).toBe(before);
  }finally{await f.cleanup()}
});

it('并发相同附件命令只追加一次，清单之后不能借普通事务修改或删除',async()=>{
  const f=await setup();try{
    const results=await Promise.all([randomUUID(),randomUUID()].map(run=>f.service.continuations.accept(f.input,run,{attachmentManifest:f.manifest})));
    expect(results.filter(value=>value.fresh)).toHaveLength(1);expect(results[0].continuation).toEqual(results[1].continuation);
    const accepted=results[0],changed=structuredClone(accepted.scope);changed.continuations![0]={...accepted.continuation,attachmentManifest:{...f.manifest,items:[{...f.manifest.items[0],name:'forged'},f.manifest.items[1]]}};
    await expect(f.store.transact({commandId:'tamper-manifest',fingerprint:'tamper-manifest'},async()=>({scopes:[changed],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    const missing=structuredClone(accepted.scope);delete (missing.continuations![0] as typeof accepted.continuation).attachmentManifest;
    await expect(f.store.transact({commandId:'missing-manifest',fingerprint:'missing-manifest'},async()=>({scopes:[missing],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
  }finally{await f.cleanup()}
});

it('重算外层日志哈希仍不能隐藏清单错绑或缺失',async()=>{
  const f=await setup();try{
    await f.service.continuations.accept(f.input,randomUUID(),{attachmentManifest:f.manifest});
    const file=path.join(f.directory,'dispatch.jsonl'),original=await fs.readFile(file,'utf8');
    for(const mutate of [(value:any)=>{delete value.attachmentManifest},(value:any)=>{value.attachmentManifest.items.reverse()},(value:any)=>{value.attachmentManifest.items[0].sourcePath='/secret'}]){
      const records=original.trim().split('\n').map(line=>JSON.parse(line));mutate(records.at(-1).body.mutation.scopes[0].continuations[0]);let prior='';
      for(const record of records){record.body.previousHash=prior;record.checksum=hash(JSON.stringify(record.body));prior=record.checksum}
      await fs.writeFile(file,records.map(record=>JSON.stringify(record)).join('\n')+'\n');const reader=new FileDispatchStore(f.directory,f.entry.id);try{await expect(reader.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'})}finally{await reader.close();await fs.writeFile(file,original)}
    }
  }finally{await f.cleanup()}
});

it('用户补充 source 只增加可信清单摘要，旧来源 wire 与人工分支不变',()=>{
  const source={kind:'user-continuation' as const,continuationId:randomUUID(),scopeId:'scope',waitId:'wait',inputRevision:2},manifestHash=hash(json(manifest([randomUUID()])));
  expect(checkedRunInputSource(source)).toEqual(source);expect(checkedRunInputSource({...source,attachmentManifestHash:manifestHash})).toEqual({...source,attachmentManifestHash:manifestHash});
  for(const extra of [{attachmentManifestHash:'bad'},{attachmentManifestHash:'A'.repeat(64)},{images:[]},{attachmentIds:[randomUUID()]}])expect(()=>checkedRunInputSource({...source,...extra})).toThrow();
  expect(()=>checkedRunInputSource({kind:'human_decisions',continuationId:randomUUID(),scopeId:'scope',waitId:'wait',inputRevision:2,decisionRevision:1,decisionIds:[randomUUID()],attachmentManifestHash:manifestHash})).toThrow();
});
