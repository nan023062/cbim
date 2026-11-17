import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../../application/unittest/support/helpers';
import {Workspace} from '../workspace';
import {KernelLock} from '../../../../core/platform/node/locking';
import {FileDispatchStore} from '../../../dispatch/storage/dispatch-store';
import {FileAgentHistoryStore} from '../../../history/service/file-store';

it('历史索引加载完成之前持有工程锁但不读取派发 Store，后续装配不重复加载索引',async()=>{
  const f=await fixture(),entry=await f.app.catalog.Add(f.a);
  let release!:()=>void,entered!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve}),loading=new Promise<void>(resolve=>{entered=resolve});
  const original=FileAgentHistoryStore.prototype.Load;
  const load=vi.spyOn(FileAgentHistoryStore.prototype,'Load').mockImplementation(async function(this:FileAgentHistoryStore){
    const result=await original.call(this);entered();await blocked;return result;
  });
  const read=vi.spyOn(FileDispatchStore.prototype,'Read');
  const opening=f.app.Open(entry.id);
  try{
    await loading;
    expect(f.app.Workspace(entry.id).state).toBe('opening');
    expect(JSON.parse(await fs.readFile(path.join(f.user,entry.id,'identity.json'),'utf8')).path).toBe(entry.path);
    expect(()=>new KernelLock(entry.path,entry.id)).toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(()=>f.app.MemberDispatch(entry.id)).toThrow();
    release();const workspace=await opening;
    expect(workspace.state).toBe('running');expect(read).toHaveBeenCalled();expect(load).toHaveBeenCalledTimes(1);
    expect((await f.app.AgentHistory(entry.id).Roles({workspaceId:entry.id})).diagnostics).toEqual([]);
  }finally{release();await opening.catch(()=>{});load.mockRestore();read.mockRestore();await f.cleanup()}
});

it('历史路径身份不符时既不加载索引也不读取或修复派发 Store',async()=>{
  const f=await fixture(),entry=await f.app.catalog.Add(f.a),project=f.app.paths.Project(entry.id);
  await fs.mkdir(project,{recursive:true});await fs.writeFile(path.join(project,'identity.json'),JSON.stringify({id:entry.id,path:f.b}));
  const load=vi.spyOn(FileAgentHistoryStore.prototype,'Load'),read=vi.spyOn(FileDispatchStore.prototype,'Read');
  try{
    await expect(f.app.Open(entry.id)).rejects.toMatchObject({code:'IDENTITY'});
    expect(load).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();expect(f.app.Workspace(entry.id).state).toBe('failed');
    const lock=new KernelLock(entry.path,entry.id);lock.Close();
  }finally{load.mockRestore();read.mockRestore();await f.cleanup()}
});

it('可信历史启动阶段失败封闭实例并释放锁，不继续 Store 或知识恢复',async()=>{
  const f=await fixture(),entry=await f.app.catalog.Add(f.a),workspace=new Workspace(entry,f.app.paths,f.app.rules);
  const store=new FileDispatchStore(path.join(f.user,entry.id,'dispatch'),entry.id),read=vi.spyOn(store,'Read');
  workspace.AttachDispatchStore(store);
  try{
    await expect(workspace.Open({beforeDispatchLoad:async()=>{
      expect(()=>new KernelLock(entry.path,entry.id)).toThrow();
      expect(JSON.parse(await fs.readFile(path.join(f.user,entry.id,'identity.json'),'utf8')).path).toBe(entry.path);
      throw Error('history startup unavailable');
    }})).rejects.toThrow('history startup unavailable');
    expect(workspace.state).toBe('failed');expect(read).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(f.a,'.cbim'))).rejects.toMatchObject({code:'ENOENT'});
    const lock=new KernelLock(entry.path,entry.id);lock.Close();
  }finally{read.mockRestore();await workspace.Close();await f.cleanup()}
});
