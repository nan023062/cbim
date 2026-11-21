import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {runtimeFixture,digest} from './support/runtime-fixture';
import {RuntimeJournal} from '../../../../../src/logic-new/updates/service/runtime-journal';
import {selectBootResources} from '../../../../../src/bridge/server/bootstrap/selection';
import {RuntimeStore} from '../../../../../src/logic-new/updates/service/runtime-store';
it('download does not activate; confirmed activation advances monotonically and cannot replay an old resource',async()=>{
  const f=await runtimeFixture();try{
    const cache=path.join(f.root,'cache'),initial=digest(f.envelope().payload),store=new RuntimeStore(cache,f.cold,f.download),journal=new RuntimeJournal(path.join(cache,'state'),{digest:initial,resourceVersion:1});
    const next=await store.SaveManifest(f.envelope({...f.manifest,resourceVersion:2}));await store.Prepare(next.manifest.resource,new AbortController().signal);
    expect(selectBootResources(f.cold,cache,f.source,f.initial)).toMatchObject({digest:initial,pending:false});
    journal.Authorize({digest:next.digest,resourceVersion:2});expect(selectBootResources(f.cold,cache,f.source,f.initial)).toMatchObject({digest:next.digest,pending:true});
    journal.AccessData(next.digest);expect(()=>selectBootResources(f.cold,cache,f.source,f.initial)).toThrow(/RECOVERY/);
    expect(()=>journal.RejectBeforeData(next.digest)).toThrow();journal.Confirm(next.digest);
    expect(selectBootResources(f.cold,cache,f.source,f.initial)).toMatchObject({digest:next.digest,pending:false});
    expect(()=>journal.Authorize({digest:initial,resourceVersion:1})).toThrow(/重放/);
  }finally{await f.cleanup()}
});
it('only a never-loaded candidate may fall back; explicit retry retains its irreversible data-access fact',async()=>{
  const f=await runtimeFixture();try{
    const cache=path.join(f.root,'cache'),initial=digest(f.envelope().payload),journal=new RuntimeJournal(path.join(cache,'state'),{digest:initial,resourceVersion:1});
    const missing=digest('missing');journal.Authorize({digest:missing,resourceVersion:2});
    expect(selectBootResources(f.cold,cache,f.source,f.initial).digest).toBe(initial);expect(journal.Read().quarantined).toContain(missing);
    const touched=digest('touched');journal.Authorize({digest:touched,resourceVersion:3});journal.AccessData(touched);journal.RetryPending();
    expect(journal.Read().pending?.dataAccessed).toBe(true);expect(()=>selectBootResources(f.cold,cache,f.source,f.initial)).toThrow();expect(()=>journal.RejectBeforeData(touched)).toThrow();
    const latest=(await fs.readdir(path.join(cache,'state'))).filter(name=>name.endsWith('.json')).sort().at(-1)!;await fs.writeFile(path.join(cache,'state',latest),'corrupt');expect(()=>journal.Read()).toThrow();
  }finally{await f.cleanup()}
});
it('cache deletion or missing journal files cannot silently reset an already activated profile to R1',async()=>{
  const f=await runtimeFixture();try{
    const cache=path.join(f.root,'cache'),state=path.join(f.root,'user-state'),store=new RuntimeStore(cache,f.cold,f.download),initial=digest(f.envelope().payload),journal=new RuntimeJournal(state,{digest:initial,resourceVersion:1});
    const next=await store.SaveManifest(f.envelope({...f.manifest,resourceVersion:2}));await store.Prepare(next.manifest.resource,new AbortController().signal);journal.Authorize({digest:next.digest,resourceVersion:2});journal.AccessData(next.digest);journal.Confirm(next.digest);
    await fs.unlink(store.ManifestPath(next.digest));expect(()=>selectBootResources(f.cold,cache,f.source,f.initial,state)).toThrow();
    for(const name of await fs.readdir(state))await fs.unlink(path.join(state,name));expect(()=>journal.Read()).toThrow(/状态丢失/);
  }finally{await f.cleanup()}
});
