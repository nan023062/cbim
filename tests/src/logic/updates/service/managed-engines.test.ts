import {it,expect,vi} from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import {runtimeFixture} from './support/runtime-fixture';
import {RuntimeStore} from '../../../../../src/logic/updates/service/runtime-store';
import {ManagedEngines} from '../../../../../src/logic/updates/service/managed-engines';

it('listing is read-only; explicit preparation shares execution work and preserves progress',async()=>{
 const f=await runtimeFixture();try{
 let finish!:()=>void;const gate=new Promise<void>(r=>finish=r);
 const download=vi.fn(async(...args:Parameters<typeof f.download>)=>{args[3](40);await gate;return f.download(...args)});
 const store=new RuntimeStore(path.join(f.root,'cache'),f.cold,download),manager=new ManagedEngines(store,f.manifest.engines,new AbortController().signal);
 expect((await manager.Status()).map(s=>s.state)).toEqual(['install','install','install']);expect(download).not.toHaveBeenCalled();
 const a=manager.ResolveEngine('pi'),b=manager.ResolveEngine('pi');expect(a).toBe(b);
 await vi.waitFor(()=>expect(manager.Preparations()[0]?.progress).toBe(28));
 expect((await manager.Status())[0].state).toBe('preparing');finish();const value=await a;
 expect(download).toHaveBeenCalledOnce();expect(value.identity).toBe(f.manifest.engines[0].package.sha256);
 expect((await manager.Status())[0]).toMatchObject({state:'ready',installedVersion:'1.0.0'});expect(manager.Preparations()).toEqual([]);
 const reopened=new ManagedEngines(store,f.manifest.engines,new AbortController().signal);
 expect((await reopened.Status())[0].state).toBe('ready');expect(download).toHaveBeenCalledOnce();
 }finally{await f.cleanup()}
});
it('a changed pinned package is an update, leaving the previously prepared directory intact',async()=>{
 const f=await runtimeFixture();try{
 const store=new RuntimeStore(path.join(f.root,'cache'),f.cold,f.download),manager=new ManagedEngines(store,f.manifest.engines,new AbortController().signal);
 const original=await manager.ResolveEngine('pi');
 const descriptors=f.manifest.engines.map(d=>d.kind==='pi'?{...d,version:'2.0.0',entry:'.vite/build/main.js',package:f.manifest.resource}:d);
 const next=new ManagedEngines(store,descriptors,new AbortController().signal);
 expect((await next.Status())[0]).toMatchObject({state:'update',version:'2.0.0',installedVersion:'1.0.0'});
 const updated=await next.ResolveEngine('pi');expect(updated.identity).not.toBe(original.identity);
 expect(await fs.readFile(original.entry,'utf8')).toContain('external engine');
 expect((await next.Status())[0].state).toBe('ready');
 }finally{await f.cleanup()}
});
it('failed preparation is visible and retryable, cancelled or unavailable engines never become ready',async()=>{
 const f=await runtimeFixture();try{
 let fail=true;const store=new RuntimeStore(path.join(f.root,'cache'),f.cold,async(...args)=>{if(fail)throw Error('private network details');await f.download(...args)});
 const manager=new ManagedEngines(store,f.manifest.engines,new AbortController().signal);
 await expect(manager.ResolveEngine('codex')).rejects.toThrow('引擎准备失败');
 expect((await manager.Status())[2]).toMatchObject({state:'failed'});expect(manager.Preparations()[0].error).not.toContain('private');
 fail=false;await manager.ResolveEngine('codex');expect((await manager.Status())[2].state).toBe('ready');
 const empty=new ManagedEngines(store,[],new AbortController().signal);expect((await empty.Status()).every(s=>s.state==='unavailable')).toBe(true);
 await expect(empty.ResolveEngine('pi')).rejects.toThrow('没有兼容');
 const c=new AbortController();c.abort();await expect(new ManagedEngines(store,f.manifest.engines,c.signal).ResolveEngine('pi')).rejects.toThrow();
 }finally{await f.cleanup()}
});
