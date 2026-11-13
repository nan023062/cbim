import {it,expect,vi} from 'vitest';
import path from 'node:path';
import {runtimeFixture,digest} from './runtime-fixture';
import {RuntimeStore} from '../src/logic/updates/service/runtime-store';
import {RuntimeJournal} from '../src/logic/updates/service/runtime-journal';
import {RuntimeUpdates} from '../src/logic/updates/service/runtime-updates';
import {DesktopUpdates} from '../src/logic/updates/service/desktop-updates';
it('same-C R update prepares files and used engines, then switches only after explicit drain without NSIS',async()=>{
  const f=await runtimeFixture();let service:DesktopUpdates|undefined;try{
    const download=vi.fn(f.download),store=new RuntimeStore(path.join(f.root,'cache'),f.cold,download),journal=new RuntimeJournal(path.join(f.root,'cache/state'),{digest:digest(f.envelope().payload),resourceVersion:1});
    const legacy={prepare:vi.fn(),download:vi.fn(),install:vi.fn(),close:vi.fn()},restart=vi.fn(),drain=vi.fn(async()=>{});
    const installer=new RuntimeUpdates(store,journal,f.manifest,legacy,restart,{cold:async()=>undefined,resources:async()=>f.envelope({...f.manifest,resourceVersion:2})},()=>['pi']);
    service=new DesktopUpdates(f.cold.codeVersion,'old',true,signal=>installer.latest(signal),installer,drain,1);
    await service.check();expect(service.status()).toMatchObject({phase:'ready',currentResourceVersion:1,release:{delivery:'resources',resourceVersion:2}});
    expect(download).toHaveBeenCalledTimes(2);expect(journal.read().pending).toBeUndefined();expect(drain).not.toHaveBeenCalled();expect(restart).not.toHaveBeenCalled();
    await service.install();expect(drain).toHaveBeenCalledOnce();expect(restart).toHaveBeenCalledOnce();expect(journal.read().pending).toMatchObject({resourceVersion:2,stage:'authorized',dataAccessed:false});expect(legacy.install).not.toHaveBeenCalled();
  }finally{service?.close();await f.cleanup()}
});
it('ordinary exit cannot activate R and C upgrades retain the existing installer port',async()=>{
  const f=await runtimeFixture();try{
    const store=new RuntimeStore(path.join(f.root,'cache'),f.cold,f.download),journal=new RuntimeJournal(path.join(f.root,'cache/state'),{digest:digest(f.envelope().payload),resourceVersion:1});
    const legacy={prepare:vi.fn(async()=>{}),download:vi.fn(async(progress:(p:number)=>void)=>progress(100)),install:vi.fn(),close:vi.fn()},restart=vi.fn();
    const cold={version:'0.3.0',tag:'desktop-v0.3.0',notes:'cold',publishedAt:new Date().toISOString()};
    const updater=new RuntimeUpdates(store,journal,f.manifest,legacy,restart,{cold:async()=>cold,resources:async()=>{throw Object.assign(Error('missing'),{status:404})}});
    expect(await updater.latest(new AbortController().signal)).toEqual(cold);await updater.prepare(cold);await expect(updater.install()).rejects.toThrow(/完成/);await updater.download(()=>{});await updater.install();expect(legacy.install).toHaveBeenCalledOnce();expect(restart).not.toHaveBeenCalled();expect(journal.read().pending).toBeUndefined();updater.close();
    const resource=new RuntimeUpdates(store,journal,f.manifest,legacy,restart,{cold:async()=>undefined,resources:async()=>f.envelope({...f.manifest,resourceVersion:2})});
    await resource.prepare((await resource.latest(new AbortController().signal))!);await resource.download(()=>{});resource.close();await expect(resource.install()).rejects.toThrow();expect(journal.read().pending).toBeUndefined();
  }finally{await f.cleanup()}
});
