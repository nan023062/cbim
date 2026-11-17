import {it,expect,vi} from 'vitest';
import path from 'node:path';
import {runtimeFixture,digest} from './support/runtime-fixture';
import {RuntimeStore} from '../../../../../src/logic/updates/service/runtime-store';
import {RuntimeJournal} from '../../../../../src/logic/updates/service/runtime-journal';
import {RuntimeUpdates} from '../../../../../src/logic/updates/service/runtime-updates';
import {DesktopUpdates} from '../../../../../src/logic/updates/service/desktop-updates';
it('same-C R update prepares files and used engines, then switches only after explicit drain without NSIS',async()=>{
  const f=await runtimeFixture();let service:DesktopUpdates|undefined;try{
    const download=vi.fn(f.download),store=new RuntimeStore(path.join(f.root,'cache'),f.cold,download),journal=new RuntimeJournal(path.join(f.root,'cache/state'),{digest:digest(f.envelope().payload),resourceVersion:1});
    const legacy={Prepare:vi.fn(),Download:vi.fn(),Install:vi.fn(),Close:vi.fn()},restart=vi.fn(),drain=vi.fn(async()=>{});
    const installer=new RuntimeUpdates(store,journal,f.manifest,legacy,restart,{Cold:async()=>undefined,Resources:async()=>f.envelope({...f.manifest,resourceVersion:2})},()=>['pi']);
    service=new DesktopUpdates(f.cold.codeVersion,'old',true,signal=>installer.Latest(signal),installer,drain,1);
    await service.Check();expect(service.Status()).toMatchObject({phase:'ready',currentResourceVersion:1,release:{delivery:'resources',resourceVersion:2}});
    expect(download).toHaveBeenCalledTimes(2);expect(journal.Read().pending).toBeUndefined();expect(drain).not.toHaveBeenCalled();expect(restart).not.toHaveBeenCalled();
    await service.Install();expect(drain).toHaveBeenCalledOnce();expect(restart).toHaveBeenCalledOnce();expect(journal.Read().pending).toMatchObject({resourceVersion:2,stage:'authorized',dataAccessed:false});expect(legacy.Install).not.toHaveBeenCalled();
  }finally{service?.Close();await f.cleanup()}
});
it('ordinary exit cannot activate R and C upgrades retain the existing installer port',async()=>{
  const f=await runtimeFixture();try{
    const store=new RuntimeStore(path.join(f.root,'cache'),f.cold,f.download),journal=new RuntimeJournal(path.join(f.root,'cache/state'),{digest:digest(f.envelope().payload),resourceVersion:1});
    const legacy={Prepare:vi.fn(async()=>{}),Download:vi.fn(async(progress:(p:number)=>void)=>progress(100)),Install:vi.fn(),Close:vi.fn()},restart=vi.fn();
    const cold={version:'0.3.0',tag:'desktop-v0.3.0',notes:'cold',publishedAt:new Date().toISOString()};
    const updater=new RuntimeUpdates(store,journal,f.manifest,legacy,restart,{Cold:async()=>cold,Resources:async()=>{throw Object.assign(Error('missing'),{status:404})}});
    expect(await updater.Latest(new AbortController().signal)).toEqual(cold);await updater.Prepare(cold);await expect(updater.Install()).rejects.toThrow(/完成/);await updater.Download(()=>{});await updater.Install();expect(legacy.Install).toHaveBeenCalledOnce();expect(restart).not.toHaveBeenCalled();expect(journal.Read().pending).toBeUndefined();updater.Close();
    const resource=new RuntimeUpdates(store,journal,f.manifest,legacy,restart,{Cold:async()=>undefined,Resources:async()=>f.envelope({...f.manifest,resourceVersion:2})});
    await resource.Prepare((await resource.Latest(new AbortController().signal))!);await resource.Download(()=>{});resource.Close();await expect(resource.Install()).rejects.toThrow();expect(journal.Read().pending).toBeUndefined();
  }finally{await f.cleanup()}
});
