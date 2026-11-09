import {afterEach,expect,test,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileDispatchStore} from '../src/backend/main/persistence/tasks/dispatch-store';
import {MessageQueue} from '../src/backend/scheduler-engine/conversation/message-queue';
import {WorkspaceExecutionManager} from '../src/backend/scheduler-engine/execution/execution-manager';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import type {DispatchObserver} from '../src/backend/core/tasks/dispatch-storage';
import type {KnowledgeWorkspace} from '../src/backend/core/knowledge/ports';

const directories:string[]=[];
async function directory(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-runtime-feed-'));directories.push(dir);return dir}
const observer=():DispatchObserver=>({loaded:vi.fn(),committed:vi.fn(),failed:vi.fn()});
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(directories.splice(0).map(dir=>fs.rm(dir,{recursive:true,force:true})))});

test('dispatch observer receives one complete baseline and post-sync commits, never replay or idempotent duplicates',async()=>{
  const dir=await directory(),sink=observer(),store=new FileDispatchStore(dir,'ws',sink);
  await Promise.all([store.read(),store.read()]);expect(sink.loaded).toHaveBeenCalledTimes(1);
  const command={commandId:'c1',fingerprint:'f1'};
  await store.transact(command,async()=>({receipt:{id:'a'}}));
  await store.transact(command,async()=>{throw Error('must not prepare again')});
  expect(sink.committed).toHaveBeenCalledTimes(1);expect(sink.failed).not.toHaveBeenCalled();
  expect((JSON.parse(await fs.readFile(path.join(dir,'dispatch.jsonl'),'utf8'))).body.mutation.receipt).toEqual({id:'a'});
  // Mutation and baseline objects handed to observers cannot change the authoritative receipt/state.
  vi.mocked(sink.committed).mock.calls[0][0].receipt={id:'changed'};
  vi.mocked(sink.loaded).mock.calls[0][0].workspaceId='foreign';
  expect(await store.transact(command,async()=>({receipt:'wrong'}))).toEqual({id:'a'});
  expect((await store.read()).workspaceId).toBe('ws');await store.close();
  const restoredSink=observer(),restored=new FileDispatchStore(dir,'ws',restoredSink);
  await restored.read();await restored.transact(command,async()=>({receipt:'wrong'}));
  expect(restoredSink.loaded).toHaveBeenCalledTimes(1);expect(restoredSink.committed).not.toHaveBeenCalled();await restored.close();
});

test('observer errors cannot reject a durable transaction and storage failures never publish a commit',async()=>{
  const dir=await directory(),sink=observer();vi.mocked(sink.committed).mockImplementation(()=>{throw Error('monitor unavailable')});
  const store=new FileDispatchStore(dir,'ws',sink);
  await expect(store.transact({commandId:'c1',fingerprint:'f1'},async()=>({receipt:'ok'}))).resolves.toBe('ok');
  expect(sink.failed).toHaveBeenCalledWith(expect.objectContaining({message:'monitor unavailable'}));
  const originalOpen=fs.open.bind(fs);
  vi.spyOn(fs,'open').mockImplementation(async(...args:any[])=>{
    const file=await (originalOpen as any)(...args);if(args[1]!=='a')return file;
    return new Proxy(file,{get(target,key){if(key==='sync')return async()=>{throw Error('sync failed')};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}});
  });
  await expect(store.transact({commandId:'c2',fingerprint:'f2'},async()=>({receipt:'bad'}))).rejects.toMatchObject({code:'GRAPH_STORAGE_FAILED'});
  expect(sink.committed).toHaveBeenCalledTimes(1);expect(sink.failed).toHaveBeenLastCalledWith(expect.objectContaining({code:'GRAPH_STORAGE_FAILED'}));await store.close();
});

test('corrupt dispatch recovery reports failure without a partial baseline',async()=>{
  const dir=await directory();await fs.writeFile(path.join(dir,'dispatch.jsonl'),'{}\n');
  const sink=observer(),store=new FileDispatchStore(dir,'ws',sink);
  await expect(store.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'});
  expect(sink.failed).toHaveBeenCalledTimes(1);expect(sink.loaded).not.toHaveBeenCalled();expect(sink.committed).not.toHaveBeenCalled();await store.close();
});

test('queue monitoring follows saved changes, failed save rolls back, polling never notifies',async()=>{
  const dir=await directory(),file=path.join(dir,'queue.json'),queue=new MessageQueue(file),changes=vi.fn(),failed=vi.fn();
  queue.subscribe(changes,failed);await Promise.all([queue.load(),queue.load()]);expect(changes).toHaveBeenCalledTimes(1);
  const first=await queue.add('t','one',{provider:'p',model:'m'}),second=await queue.add('t','two',{provider:'p',model:'m'});
  expect(changes).toHaveBeenLastCalledWith({pending:2,paused:0,inserting:0});
  await queue.claim('t',first.id);expect(queue.counts()).toEqual({pending:1,paused:0,inserting:1});
  await queue.complete(first.id);await queue.pause('t','pause');expect(queue.counts()).toEqual({pending:0,paused:1,inserting:0});
  await queue.resume('t');expect(queue.counts()).toEqual({pending:1,paused:0,inserting:0});
  const notifications=changes.mock.calls.length;
  queue.list('t');queue.delta('t');await queue.load();expect(changes).toHaveBeenCalledTimes(notifications);
  const rename=vi.spyOn(fs,'rename').mockRejectedValueOnce(Error('rename denied'));
  await expect(queue.change('t',second.id,'remove')).rejects.toThrow('rename denied');
  expect(changes).toHaveBeenCalledTimes(notifications);expect(failed).toHaveBeenCalledTimes(1);
  expect(queue.list('t').map(x=>x.id)).toEqual([second.id]);expect(queue.counts()).toEqual({pending:1,paused:0,inserting:0});rename.mockRestore();
  await queue.change('t',second.id,'remove');expect(changes).toHaveBeenLastCalledWith({pending:0,paused:0,inserting:0});
});

test('execution manager loads queue monitoring without a model and releases listeners on close',async()=>{
  const dir=await directory(),file=path.join(dir,'loop-engine','pending-messages.json');
  const existing=new MessageQueue(file);await existing.load();await existing.add('t','pending',{provider:'p',model:'m'});
  const workspace={entry:{id:'ws'},paths:{project:()=>dir},assert:()=>{}} as unknown as KnowledgeWorkspace;
  const factory=vi.fn(async()=>{throw Error('must not start model')});
  const manager=new WorkspaceExecutionManager(workspace,new FileRunStorage(),factory);
  const changes=vi.fn();manager.observeQueue(changes);await manager.initializeQueueMonitoring();
  expect(changes).toHaveBeenCalledTimes(1);expect(changes).toHaveBeenLastCalledWith({pending:0,paused:1,inserting:0});
  await manager.initializeQueueMonitoring();await manager.queued('t');expect(changes).toHaveBeenCalledTimes(1);expect(factory).not.toHaveBeenCalled();
  const later=vi.fn();const unsubscribe=manager.observeQueue(later);expect(later).toHaveBeenCalledTimes(1);unsubscribe();
  await manager.close();await expect(manager.initializeQueueMonitoring()).rejects.toThrow('正在关闭');
});
