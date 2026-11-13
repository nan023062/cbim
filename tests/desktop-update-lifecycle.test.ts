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
    const entry=await f.app.dispatch('add',{path:f.a});await f.app.shutdown();
    early=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await early.init({restore:false});
    expect((await early.dispatch('list')).entries.map((entry:any)=>entry.id)).toContain(entry.id);expect(()=>early!.workspace(entry.id)).toThrow();
    await early.restore();expect(early.workspace(entry.id).entry.id).toBe(entry.id);await early.shutdown();await early.restore();expect(()=>early!.workspace(entry.id)).toThrow();
  }finally{await early?.shutdown();await f.cleanup()}
},15000);

it('prefetch leaves the workspace open; explicit install drains and preserves it on reopen',async()=>{
  const f=await fixture();let reopened:Application|undefined,updates:DesktopUpdates|undefined;
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id);
    await workspace.commit(request(await workspace.snapshot(),moduleFiles()));
    const before=await workspace.snapshot();await fs.writeFile(path.join(f.a,'retained.txt'),'original business file');await fs.writeFile(path.join(f.user,'update-marker.txt'),'original user profile');
    const calls:string[]=[],port:DesktopUpdateInstaller={prepare:async()=>{calls.push('prepare')},download:async progress=>{calls.push('download');progress(100)},install:()=>{expect(()=>f.app.workspace(entry.id)).toThrow();calls.push('install')},close:()=>{}};
    const stop=vi.fn(async()=>{calls.push('drain');await f.app.shutdown();calls.push('drained')});
    updates=new DesktopUpdates('0.1.2','notes',true,async()=>({version:'0.2.0',tag:'desktop-v0.2.0',notes:'next',publishedAt:'2026-11-09T00:00:00Z'}),port,stop);
    await updates.check();
    expect(stop).not.toHaveBeenCalled();expect(calls).toEqual(['prepare','download']);
    expect((await f.app.workspace(entry.id).snapshot()).files).toEqual(before.files);
    await updates.install();
    expect(stop).toHaveBeenCalledOnce();expect(calls).toEqual(['prepare','download','drain','drained','install']);expect(updates.status().phase).toBe('installing');
    reopened=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await reopened.init();
    const after=await reopened.workspace(entry.id).snapshot();expect(after.files).toEqual(before.files);expect(after.workspaceId).toBe(before.workspaceId);
    expect(await fs.readFile(path.join(f.a,'retained.txt'),'utf8')).toBe('original business file');expect(await fs.readFile(path.join(f.user,'update-marker.txt'),'utf8')).toBe('original user profile');expect(await reopened.dispatch('loop.list',{id:entry.id})).toEqual([]);
  }finally{updates?.close();await reopened?.shutdown();await f.cleanup()}
},15000);
