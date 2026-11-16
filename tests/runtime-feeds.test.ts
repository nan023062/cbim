import {afterEach,expect,test,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';
import {MessageQueue} from '../src/logic/conversation/runtime/message-queue';
import {WorkspaceExecutionManager} from '../src/logic/conversation/runtime/execution-manager';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import type {DispatchObserver} from '../src/logic/dispatch/rules/dispatch-storage';
import type {KnowledgeWorkspace} from '../src/logic/knowledge/rules/ports';

const directories:string[]=[];
async function directory(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-runtime-feed-'));directories.push(dir);return dir}
const observer=():DispatchObserver=>({Loaded:vi.fn(),Committed:vi.fn(),Failed:vi.fn()});
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(directories.splice(0).map(dir=>fs.rm(dir,{recursive:true,force:true})))});

test('dispatch observer receives one complete baseline and post-sync commits, never replay or idempotent duplicates',async()=>{
  const dir=await directory(),sink=observer(),store=new FileDispatchStore(dir,'ws',sink);
  await Promise.all([store.Read(),store.Read()]);expect(sink.Loaded).toHaveBeenCalledTimes(1);
  const command={commandId:'c1',fingerprint:'f1'};
  await store.Transact(command,async()=>({receipt:{id:'a'}}));
  await store.Transact(command,async()=>{throw Error('must not prepare again')});
  expect(sink.Committed).toHaveBeenCalledTimes(1);expect(sink.Failed).not.toHaveBeenCalled();
  expect((JSON.parse(await fs.readFile(path.join(dir,'dispatch.jsonl'),'utf8'))).body.mutation.receipt).toEqual({id:'a'});
  // Mutation and baseline objects handed to observers cannot change the authoritative receipt/state.
  vi.mocked(sink.Committed).mock.calls[0][0].receipt={id:'changed'};
  vi.mocked(sink.Loaded).mock.calls[0][0].workspaceId='foreign';
  expect(await store.Transact(command,async()=>({receipt:'wrong'}))).toEqual({id:'a'});
  expect((await store.Read()).workspaceId).toBe('ws');await store.Close();
  const restoredSink=observer(),restored=new FileDispatchStore(dir,'ws',restoredSink);
  await restored.Read();await restored.Transact(command,async()=>({receipt:'wrong'}));
  expect(restoredSink.Loaded).toHaveBeenCalledTimes(1);expect(restoredSink.Committed).not.toHaveBeenCalled();await restored.Close();
});

test('observer errors cannot reject a durable transaction and storage failures never publish a commit',async()=>{
  const dir=await directory(),sink=observer();vi.mocked(sink.Committed).mockImplementation(()=>{throw Error('monitor unavailable')});
  const store=new FileDispatchStore(dir,'ws',sink);
  await expect(store.Transact({commandId:'c1',fingerprint:'f1'},async()=>({receipt:'ok'}))).resolves.toBe('ok');
  expect(sink.Failed).toHaveBeenCalledWith(expect.objectContaining({message:'monitor unavailable'}));
  const originalOpen=fs.open.bind(fs);
  vi.spyOn(fs,'open').mockImplementation(async(...args:any[])=>{
    const file=await (originalOpen as any)(...args);if(args[1]!=='a')return file;
    return new Proxy(file,{get(target,key){if(key==='sync')return async()=>{throw Error('sync failed')};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}});
  });
  await expect(store.Transact({commandId:'c2',fingerprint:'f2'},async()=>({receipt:'bad'}))).rejects.toMatchObject({code:'GRAPH_STORAGE_FAILED'});
  expect(sink.Committed).toHaveBeenCalledTimes(1);expect(sink.Failed).toHaveBeenLastCalledWith(expect.objectContaining({code:'GRAPH_STORAGE_FAILED'}));await store.Close();
});

test('corrupt dispatch recovery reports failure without a partial baseline',async()=>{
  const dir=await directory();await fs.writeFile(path.join(dir,'dispatch.jsonl'),'{}\n');
  const sink=observer(),store=new FileDispatchStore(dir,'ws',sink);
  await expect(store.Read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'});
  expect(sink.Failed).toHaveBeenCalledTimes(1);expect(sink.Loaded).not.toHaveBeenCalled();expect(sink.Committed).not.toHaveBeenCalled();await store.Close();
});

test('queue monitoring follows saved changes, failed save rolls back, polling never notifies',async()=>{
  const dir=await directory(),file=path.join(dir,'queue.json'),queue=new MessageQueue(file),changes=vi.fn(),failed=vi.fn();
  queue.Subscribe(changes,failed);await Promise.all([queue.Load(),queue.Load()]);expect(changes).toHaveBeenCalledTimes(1);
  const first=await queue.Add('t','one',{provider:'p',model:'m'}),second=await queue.Add('t','two',{provider:'p',model:'m'});
  expect(changes).toHaveBeenLastCalledWith({pending:2,paused:0,inserting:0});
  await queue.Claim('t',first.id);expect(queue.Counts()).toEqual({pending:1,paused:0,inserting:1});
  await queue.Complete(first.id);await queue.Pause('t','pause');expect(queue.Counts()).toEqual({pending:0,paused:1,inserting:0});
  await queue.Resume('t');expect(queue.Counts()).toEqual({pending:1,paused:0,inserting:0});
  const notifications=changes.mock.calls.length;
  queue.List('t');queue.Delta('t');await queue.Load();expect(changes).toHaveBeenCalledTimes(notifications);
  const rename=vi.spyOn(fs,'rename').mockRejectedValueOnce(Error('rename denied'));
  await expect(queue.Change('t',second.id,'remove')).rejects.toThrow('rename denied');
  expect(changes).toHaveBeenCalledTimes(notifications);expect(failed).toHaveBeenCalledTimes(1);
  expect(queue.List('t').map(x=>x.id)).toEqual([second.id]);expect(queue.Counts()).toEqual({pending:1,paused:0,inserting:0});rename.mockRestore();
  await queue.Change('t',second.id,'remove');expect(changes).toHaveBeenLastCalledWith({pending:0,paused:0,inserting:0});
});

test('execution manager loads queue monitoring without a model and releases listeners on close',async()=>{
  const dir=await directory(),file=path.join(dir,'loop-engine','pending-messages.json');
  const existing=new MessageQueue(file);await existing.Load();await existing.Add('t','pending',{provider:'p',model:'m'});
  const workspace={entry:{id:'ws'},paths:{Project:()=>dir},Assert:()=>{}} as unknown as KnowledgeWorkspace;
  const factory=vi.fn(async()=>{throw Error('must not start model')});
  const manager=new WorkspaceExecutionManager(workspace,new FileRunStorage(),factory);
  const changes=vi.fn();manager.ObserveQueue(changes);await manager.InitializeQueueMonitoring();
  expect(changes).toHaveBeenCalledTimes(1);expect(changes).toHaveBeenLastCalledWith({pending:0,paused:1,inserting:0});
  await manager.InitializeQueueMonitoring();await manager.Queued('t');expect(changes).toHaveBeenCalledTimes(1);expect(factory).not.toHaveBeenCalled();
  const later=vi.fn();const unsubscribe=manager.ObserveQueue(later);expect(later).toHaveBeenCalledTimes(1);unsubscribe();
  await manager.Close();await expect(manager.InitializeQueueMonitoring()).rejects.toThrow('正在关闭');
});
