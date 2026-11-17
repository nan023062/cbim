// logic/dispatch/storage: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {afterEach,expect,test,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileDispatchStore} from '../dispatch-store';
import {MessageQueue} from '../../../conversation/runtime/message-queue';
import {WorkspaceExecutionManager} from '../../../conversation/runtime/execution-manager';
import {FileRunStorage} from '../../../execution/storage/run-storage';
import type {DispatchObserver} from '../../rules/dispatch-storage';
import type {KnowledgeWorkspace} from '../../../knowledge/rules/ports';

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
