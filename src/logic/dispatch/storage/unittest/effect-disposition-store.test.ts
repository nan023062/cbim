import {afterEach,expect,test,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {FileDispatchStore} from '../dispatch-store';
import {effectDispositionCommand,effectDispositionReceipt} from '../../../tasks/rules/effect-observation-rules';
import {hash} from '../../../../core/platform/node/serialization';
import {effectIdentity,effectRootMutation,effectScope,effectRecord,effectTime} from '../../../evidence/rules/unittest/support/effect-core-fixture';
import type {DispatchScope} from '../../../tasks/rules/dispatch-scope';

async function fixture(){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-effect-append-')),store=new FileDispatchStore(directory,effectIdentity.workspaceId),file=path.join(directory,'dispatch.jsonl');await store.Transact({commandId:'open',fingerprint:'open'},async()=>effectRootMutation());await store.Transact({commandId:'scope',fingerprint:'scope'},async()=>({scopes:[effectScope()],receipt:true}));await store.Transact({commandId:'close',fingerprint:'close'},async()=>({scopes:[{...effectScope(),status:'closed',outcome:'failed',closedAt:effectTime}],receipt:true}));return {directory,store,file,async close(){await store.Close();if(!path.resolve(directory).startsWith(path.join(os.tmpdir(),'cbim-effect-append-')))throw Error('unsafe temp path');await fs.rm(directory,{recursive:true,force:true})}}}
async function save(store:FileDispatchStore,record=effectRecord()){return store.Transact(effectDispositionCommand(record.request),async()=>({effectDispositions:[record],receipt:effectDispositionReceipt(record)}))}
afterEach(()=>vi.restoreAllMocks());

test('真实Store只追加处置，原图/运行/周期及游标不变；重开恢复原回执不重做',async()=>{
  const f=await fixture();try{
    const before=await f.store.Read(),record=effectRecord(),receipt=await save(f.store,record),state=await f.store.Read();
    const {effectDispositions,...rest}=state;expect(rest).toEqual(before);expect(effectDispositions).toEqual([record]);
    const bytes=await fs.readFile(f.file);let invoked=false;
    expect(await f.store.Transact(effectDispositionCommand(record.request),async()=>{invoked=true;throw Error('must not reenter')})).toEqual(receipt);expect(invoked).toBe(false);
    expect(await fs.readFile(f.file)).toEqual(bytes);await f.store.Close();const reader=new FileDispatchStore(f.directory,effectIdentity.workspaceId);
    try{await reader.Read();expect(await reader.CommandReceipt(effectDispositionCommand(record.request).commandId)).toEqual({fingerprint:effectDispositionCommand(record.request).fingerprint,receipt});expect((await reader.Read()).effectDispositions).toEqual([record]);expect(await fs.readFile(f.file)).toEqual(bytes)}finally{await reader.Close()}
  }finally{await f.close()}
});

test('真实并发同head只能追加一条；冲突/混合写/篡改receipt均不修改原账本',async()=>{
  const f=await fixture();try{
    const a=effectRecord(),b=effectRecord(),results=await Promise.allSettled([save(f.store,a),save(f.store,b)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const before=await fs.readFile(f.file),state=await f.store.Read(),first=state.effectDispositions![0],next=effectRecord(1),command=effectDispositionCommand(next.request);
    await expect(f.store.Transact(command,async()=>({effectDispositions:[next],scopes:[],receipt:effectDispositionReceipt(next)}))).rejects.toMatchObject({code:'EFFECT_DISPOSITION_AUDIT'});
    await expect(f.store.Transact(command,async()=>({effectDispositions:[next],receipt:{...effectDispositionReceipt(next),workspaceId:'foreign'}}))).rejects.toMatchObject({code:'EFFECT_DISPOSITION_AUDIT'});
    await expect(f.store.Transact({...effectDispositionCommand(first.request),fingerprint:'different'},async()=>({receipt:true}))).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    expect(await f.store.Read()).toEqual(state);expect(await fs.readFile(f.file)).toEqual(before);
  }finally{await f.close()}
});

test('legacy前缀不补附录；新帧追加后重开不改变任何旧字节',async()=>{
  const f=await fixture();try{
    await f.store.Close();let previous='';const legacy=(await fs.readFile(f.file,'utf8')).trim().split('\n').map(line=>{const frame=JSON.parse(line);delete frame.body.executionProtocol;frame.body.previousHash=previous;frame.checksum=hash(JSON.stringify(frame.body));previous=frame.checksum;return JSON.stringify(frame)}).join('\n')+'\n';await fs.writeFile(f.file,legacy);
    const reader=new FileDispatchStore(f.directory,effectIdentity.workspaceId);try{expect(Object.hasOwn(await reader.Read(),'effectDispositions')).toBe(false);await save(reader);expect((await fs.readFile(f.file,'utf8')).startsWith(legacy)).toBe(true)}finally{await reader.Close()}
    const reopened=new FileDispatchStore(f.directory,effectIdentity.workspaceId);try{expect((await reopened.Read()).effectDispositions).toHaveLength(1);expect((await fs.readFile(f.file,'utf8')).startsWith(legacy)).toBe(true)}finally{await reopened.Close()}
  }finally{await f.close()}
});

test('完整帧被改actor即使重算checksum也不能重放成可信处置',async()=>{
  const f=await fixture();try{
    await save(f.store);await f.store.Close();const lines=(await fs.readFile(f.file,'utf8')).trim().split('\n');const frame=JSON.parse(lines.at(-1)!);frame.body.mutation.effectDispositions[0].actor={kind:'model',interaction:'explicit_submit'};frame.body.mutation.receipt.record.actor=frame.body.mutation.effectDispositions[0].actor;frame.checksum=hash(JSON.stringify(frame.body));lines[lines.length-1]=JSON.stringify(frame);await fs.writeFile(f.file,lines.join('\n')+'\n');
    const reader=new FileDispatchStore(f.directory,effectIdentity.workspaceId);try{await expect(reader.Read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'})}finally{await reader.Close()}
  }finally{await f.close()}
});

test('已写帧fsync失败保持unknown；同实例不发布、重开核原事实而不重发',async()=>{
  const f=await fixture();try{
    const record=effectRecord(),original=fs.open.bind(fs),spy=vi.spyOn(fs,'open').mockImplementation(async(...args:any[])=>{const handle=await (original as any)(...args);if(args[1]!=='a')return handle;return new Proxy(handle,{get(target,key){if(key==='sync')return async()=>{throw Error('unknown fsync')};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}})});
    await expect(save(f.store,record)).rejects.toMatchObject({code:'GRAPH_STORAGE_FAILED'});spy.mockRestore();await expect(f.store.CommandReceipt(effectDispositionCommand(record.request).commandId)).rejects.toMatchObject({code:'GRAPH_STORAGE_FAILED'});await f.store.Close();const bytes=await fs.readFile(f.file),reader=new FileDispatchStore(f.directory,effectIdentity.workspaceId);
    try{expect((await reader.Read()).effectDispositions).toEqual([record]);expect(await reader.CommandReceipt(effectDispositionCommand(record.request).commandId)).toMatchObject({receipt:effectDispositionReceipt(record)});expect(await fs.readFile(f.file)).toEqual(bytes)}finally{await reader.Close()}
  }finally{await f.close()}
});

test('main无原plan可创建新只读意图并冻结处置引用；旧scope不改、跨run及事后补写拒绝',async()=>{
  const f=await fixture();try{
    const record=effectRecord();await save(f.store,record);const before=await f.store.Read(),scopeId=randomUUID();
    const scope:DispatchScope={...effectIdentity,scopeId,status:'active',createdAt:effectTime,goal:{revision:1,input:{message:'读取实际文件',attachmentIds:[]}},runTracking:{version:1,mainRunIds:['inspection-run']},recovery:{recoveryId:scopeId,acceptedAt:effectTime,source:{kind:'main_run',runId:'main-run',toolCallIds:['write-call'],reportBasis:record.observation.basis,scopeId:'source',scopeOutcome:'failed',reportExecution:'unknown',logState:'verified',unknownToolCount:1,sourceGoalRevision:1,sourceInputRevision:1},operation:'inspect_effects',observation:{text:'请核实'},input:{message:'读取实际文件'},options:{permission:'read',profileId:randomUUID(),provider:'fixture',model:'fixture'},context:{initialRunId:'inspection-run',nativeSessionId:randomUUID(),excludedRunIds:['main-run']},dispositionId:record.dispositionId}};
    const bad=structuredClone(scope);bad.recovery!.source.runId='foreign';await expect(f.store.Transact({commandId:'bad-inspection',fingerprint:'bad'},async()=>({scopes:[bad],receipt:true}))).rejects.toMatchObject({code:'EFFECT_DISPOSITION_AUDIT'});
    await f.store.Transact({commandId:'inspection',fingerprint:'valid'},async()=>({scopes:[scope],receipt:true}));const state=await f.store.Read();expect(state.scopes![0]).toEqual(before.scopes![0]);expect(state.graphs).toEqual(before.graphs);expect(state.runs).toEqual(before.runs);
    const altered=structuredClone(scope);delete altered.recovery!.dispositionId;await expect(f.store.Transact({commandId:'unlink',fingerprint:'unlink'},async()=>({scopes:[altered],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    const bytes=await fs.readFile(f.file);await f.store.Close();const reader=new FileDispatchStore(f.directory,effectIdentity.workspaceId);try{expect((await reader.Read()).scopes!.at(-1)).toEqual(scope);expect(await fs.readFile(f.file)).toEqual(bytes)}finally{await reader.Close()}
  }finally{await f.close()}
});
