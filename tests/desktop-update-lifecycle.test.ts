import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {DesktopUpdates,type DesktopUpdateInstaller} from '../src/logic/updates/service/desktop-updates';
import {fixture} from './helpers';
import {moduleFiles,request} from './data/knowledge';

it('catalog startup can precede workspace restore, and shutdown cancels later background restore',async()=>{
  const f=await fixture();let early:Application|undefined;
  try{
    const entry=await f.app.Dispatch('add',{path:f.a});await f.app.Shutdown();
    early=new Application(new Paths(f.user,path.resolve('.')));await early.Init({restore:false});
    expect((await early.Dispatch('list')).entries.map((entry:any)=>entry.id)).toContain(entry.id);expect(()=>early!.Workspace(entry.id)).toThrow();
    await early.Restore();expect(early.Workspace(entry.id).entry.id).toBe(entry.id);await early.Shutdown();await early.Restore();expect(()=>early!.Workspace(entry.id)).toThrow();
  }finally{await early?.Shutdown();await f.cleanup()}
},15000);

it('prefetch leaves the workspace open; explicit install drains and preserves it on reopen',async()=>{
  const f=await fixture();let reopened:Application|undefined,updates:DesktopUpdates|undefined;
  try{
    const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id);
    await workspace.Commit(request(await workspace.Snapshot(),moduleFiles()));
    const before=await workspace.Snapshot();await fs.writeFile(path.join(f.a,'retained.txt'),'original business file');await fs.writeFile(path.join(f.user,'update-marker.txt'),'original user profile');
    const calls:string[]=[],port:DesktopUpdateInstaller={Prepare:async()=>{calls.push('prepare')},Download:async progress=>{calls.push('download');progress(100)},Install:()=>{expect(()=>f.app.Workspace(entry.id)).toThrow();calls.push('install')},Close:()=>{}};
    const stop=vi.fn(async()=>{calls.push('drain');await f.app.Shutdown();calls.push('drained')});
    updates=new DesktopUpdates('0.1.2','notes',true,async()=>({version:'0.2.0',tag:'desktop-v0.2.0',notes:'next',publishedAt:'2026-11-09T00:00:00Z'}),port,stop);
    await updates.Check();
    expect(stop).not.toHaveBeenCalled();expect(calls).toEqual(['prepare','download']);
    expect((await f.app.Workspace(entry.id).Snapshot()).files).toEqual(before.files);
    await updates.Install();
    expect(stop).toHaveBeenCalledOnce();expect(calls).toEqual(['prepare','download','drain','drained','install']);expect(updates.Status().phase).toBe('installing');
    reopened=new Application(new Paths(f.user,path.resolve('.')));await reopened.Init();
    const after=await reopened.Workspace(entry.id).Snapshot();expect(after.files).toEqual(before.files);expect(after.workspaceId).toBe(before.workspaceId);
    expect(await fs.readFile(path.join(f.a,'retained.txt'),'utf8')).toBe('original business file');expect(await fs.readFile(path.join(f.user,'update-marker.txt'),'utf8')).toBe('original user profile');expect(await reopened.Dispatch('loop.list',{id:entry.id})).toEqual([]);
  }finally{updates?.Close();await reopened?.Shutdown();await f.cleanup()}
},15000);
