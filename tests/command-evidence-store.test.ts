import {afterEach,expect,test,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';
import {hash} from '../src/core/platform/node/serialization';
import type {DispatchMutation} from '../src/logic/dispatch/rules/dispatch-storage';
import type {GraphEventBatch,GraphIdentity} from '../src/logic/tasks/rules/graph-types';

const identity={workspaceId:'_workspace',rootSessionId:'-root'},time='2026-11-08T10:00:00.000Z';
function rootMutation(id:GraphIdentity=identity):DispatchMutation{
  const member={workspaceId:id.workspaceId,teamId:'team',agentId:'cbim:main',agentInstanceId:'main-'+id.rootSessionId,leaseEpoch:0,configurationRevision:'knowledge',agentSessionIds:['session-'+id.rootSessionId],activity:'idle' as const,waitingTaskIds:[],communicatingMessageIds:[],mainRootSessionId:id.rootSessionId};
  const agent={agentId:member.agentId,agentInstanceId:member.agentInstanceId,agentSessionId:member.agentSessionIds[0],name:'主调度'};
  return {members:[member],sessions:[{workspaceId:id.workspaceId,teamId:member.teamId,agentId:member.agentId,agentInstanceId:member.agentInstanceId,agentSessionId:agent.agentSessionId,rootSessionId:id.rootSessionId}],receipt:{root:id.rootSessionId},batch:{version:1,identity:id,streamId:'stream-'+id.rootSessionId,seq:1,eventId:'event-'+id.rootSessionId,commandId:'open-'+id.rootSessionId,cause:'graph.created',committedAt:time,changes:[{type:'root.upserted',root:{kind:'session-root',nodeId:'session:'+id.rootSessionId,identity:id,agent,revision:1,createdAt:time}},{type:'agent.upserted',agent:{agentId:agent.agentId,agentInstanceId:agent.agentInstanceId,name:agent.name,revision:1,state:'idle',waitingTaskIds:[]}}]}};
}
async function fixture(){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-command-evidence-'));const store=new FileDispatchStore(directory,identity.workspaceId);return {directory,file:path.join(directory,'dispatch.jsonl'),store,async cleanup(){await store.close();const target=path.resolve(directory);if(!target.startsWith(path.join(os.tmpdir(),'cbim-command-evidence-')))throw Error('unexpected cleanup path');await fs.rm(target,{recursive:true,force:true})}}}
const open=(store:FileDispatchStore,id=identity)=>store.transact({commandId:'open-'+id.rootSessionId,fingerprint:hash(id.rootSessionId)},async()=>rootMutation(id));
async function revise(store:FileDispatchStore,commandId:string,id=identity){return store.transact({commandId,fingerprint:hash(commandId)},async state=>{
  const g=state.graphs.find(item=>item.identity.rootSessionId===id.rootSessionId)!;
  const batch:GraphEventBatch={version:1,identity:id,streamId:g.cursor.streamId,seq:g.cursor.seq+1,eventId:commandId,commandId,cause:'agent.state_changed',committedAt:time,changes:[{type:'root.upserted',root:{...g.root,revision:g.root.revision+1}}]};
  return {batch,receipt:{revision:g.root.revision+1}};
})}
afterEach(()=>vi.restoreAllMocks());

test('commandEvidence 不初始化未开 Store，明确读取缺失后也不会创建日志',async()=>{
  const f=await fixture();try{const read=vi.spyOn(fs,'readFile');await expect(f.store.commandEvidence('missing')).rejects.toMatchObject({code:'GRAPH_STORE_NOT_READY'});expect(read).not.toHaveBeenCalled();read.mockRestore();await f.store.read();expect(await f.store.commandEvidence('missing')).toBeUndefined();await expect(fs.stat(f.file)).rejects.toMatchObject({code:'ENOENT'})}finally{await f.cleanup()}
});

test('原前态在后续根变化、不同root与重开后保持；原receipt形状不增加字段',async()=>{
  const f=await fixture();try{
    await open(f.store);const created=await f.store.commandEvidence('open-'+identity.rootSessionId);expect(created?.graph?.before).toBeUndefined();
    await revise(f.store,'first');const original=await f.store.commandEvidence('first');expect(original?.graph).toMatchObject({identity,before:{rootRevision:1,cursor:{seq:1}},afterCursor:{seq:2}});
    await revise(f.store,'second');const other={...identity,rootSessionId:'other'};await open(f.store,other);await revise(f.store,'other-change',other);
    expect((await f.store.commandEvidence('other-change'))?.graph?.identity).toEqual(other);
    expect(await f.store.commandEvidence('first')).toEqual(original);expect((await f.store.snapshot(identity)).root.revision).toBe(3);
    expect(Object.keys((await f.store.commandReceipt('first'))!)).toEqual(['fingerprint','receipt']);
    original!.graph!.before!.rootRevision=999;(original!.receipt as {revision:number}).revision=999;
    expect((await f.store.commandEvidence('first'))?.graph?.before?.rootRevision).toBe(1);expect(await f.store.commandReceipt('first')).toEqual({fingerprint:hash('first'),receipt:{revision:2}});
    const fixed=await f.store.commandEvidence('first'),bytes=await fs.readFile(f.file);await f.store.close();const reader=new FileDispatchStore(f.directory,identity.workspaceId);
    try{await reader.read();expect(await reader.commandEvidence('first')).toEqual(fixed);expect(await fs.readFile(f.file)).toEqual(bytes)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

test('无图事务无伪造前态，幂等与只读查询零写入零重新解析',async()=>{
  const f=await fixture();try{
    await open(f.store);let count=0;const command={commandId:'control',fingerprint:hash('control')};const prepare=async()=>{count++;return {receipt:{saved:true}}};
    await f.store.transact(command,prepare);const before=await fs.readFile(f.file);const read=vi.spyOn(fs,'readFile'),write=vi.spyOn(fs,'open');
    const proof=await f.store.commandEvidence('control');expect(proof?.graph).toBeUndefined();expect(proof?.commit.transactionSeq).toBe(2);
    await f.store.commandEvidence('control');await f.store.commandReceipt('control');await f.store.transact(command,prepare);expect(count).toBe(1);expect(read).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();read.mockRestore();write.mockRestore();expect(await fs.readFile(f.file)).toEqual(before);
  }finally{await f.cleanup()}
});

test('旧无executionProtocol前缀按原验证重放派生legacy依据且不改原字节',async()=>{
  const f=await fixture();try{
    await open(f.store);await revise(f.store,'old-change');await f.store.close();let previous='';
    const lines=(await fs.readFile(f.file,'utf8')).trim().split('\n').map(line=>{const record=JSON.parse(line);delete record.body.executionProtocol;record.body.previousHash=previous;record.checksum=hash(JSON.stringify(record.body));previous=record.checksum;return JSON.stringify(record)}).join('\n')+'\n';
    await fs.writeFile(f.file,lines);const reader=new FileDispatchStore(f.directory,identity.workspaceId);try{await reader.read();expect(await reader.commandEvidence('old-change')).toMatchObject({commit:{executionProtocol:'legacy',transactionSeq:2},graph:{before:{rootRevision:1}}});expect(await fs.readFile(f.file,'utf8')).toBe(lines)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

test('同步失败不发布命令证据；重开按真实完整帧恢复而不重做',async()=>{
  const f=await fixture();try{
    await open(f.store);const original=fs.open.bind(fs);const spy=vi.spyOn(fs,'open').mockImplementation(async(...args:any[])=>{const handle=await (original as any)(...args);if(args[1]!=='a')return handle;return new Proxy(handle,{get(target,key){if(key==='sync')return async()=>{throw Error('sync unknown')};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}})});
    await expect(revise(f.store,'unknown')).rejects.toMatchObject({code:'GRAPH_STORAGE_FAILED'});spy.mockRestore();await expect(f.store.commandEvidence('unknown')).rejects.toMatchObject({code:'GRAPH_STORAGE_FAILED'});await f.store.close();const bytes=await fs.readFile(f.file);const reader=new FileDispatchStore(f.directory,identity.workspaceId);
    try{await reader.read();expect(await reader.commandEvidence('unknown')).toMatchObject({graph:{before:{rootRevision:1}},receipt:{revision:2}});expect(await fs.readFile(f.file)).toEqual(bytes)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

test('fsync尚未完成时查询等待同一提交屏障，不能提前发布前态证据',async()=>{
  const f=await fixture();let release=()=>{};try{
    await open(f.store);let entered=()=>{};const reached=new Promise<void>(resolve=>{entered=resolve}),gate=new Promise<void>(resolve=>{release=resolve});
    const original=fs.open.bind(fs);const spy=vi.spyOn(fs,'open').mockImplementation(async(...args:any[])=>{const handle=await (original as any)(...args);if(args[1]!=='a')return handle;return new Proxy(handle,{get(target,key){if(key==='sync')return async()=>{entered();await gate;await target.sync()};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}})});
    const writing=revise(f.store,'held-sync');await reached;let returned=false;const reading=f.store.commandEvidence('held-sync').then(value=>{returned=true;return value});await Promise.resolve();await Promise.resolve();expect(returned).toBe(false);
    release();await writing;expect(await reading).toMatchObject({graph:{before:{rootRevision:1},afterCursor:{seq:2}},receipt:{revision:2}});spy.mockRestore();
  }finally{release();await f.cleanup()}
});

test('错误指纹不覆盖原证据，坏完整帧/跨workspace加载不伪装为空索引',async()=>{
  const f=await fixture();try{
    await open(f.store);const evidence=await f.store.commandEvidence('open-'+identity.rootSessionId);await expect(f.store.transact({commandId:'open-'+identity.rootSessionId,fingerprint:hash('other')},async()=>({receipt:true}))).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});expect(await f.store.commandEvidence('open-'+identity.rootSessionId)).toEqual(evidence);
    await f.store.close();const foreign=new FileDispatchStore(f.directory,'another');try{await expect(foreign.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'});await expect(foreign.commandEvidence('open-'+identity.rootSessionId)).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'})}finally{await foreign.close()}
    await fs.appendFile(f.file,'{"body":{}}\n');const bad=new FileDispatchStore(f.directory,identity.workspaceId);try{await expect(bad.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'});await expect(bad.commandEvidence('absent')).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'})}finally{await bad.close()}
  }finally{await f.cleanup()}
});
