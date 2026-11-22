import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startRegistry} from '../services/resource-registry/src-server/registry.mjs';
import {localRegistry} from '../src/logic/resource-management/local-registry';
it('desktop publisher and read-only desktop pull exact selected bytes from local registry',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'desktop-registry-'));
  const token=crypto.randomUUID(),server=await startRegistry({data:path.join(dir,'server'),token});
  try{
    const port=new URL(server.url).port,a=localRegistry(path.join(dir,'a'),port,token),b=localRegistry(path.join(dir,'b'),port);
    const file=path.join(dir,'template.json'),key={kind:'talent',id:'planner',version:'1.0.0'};
    await fs.writeFile(file,'first');
    const first=await a.Publish(key,file);
    expect(await b.List()).toEqual([first]);
    await expect(b.Publish(key,file)).rejects.toThrow('REGISTRY_TOKEN');
    await fs.writeFile(file,'second');await a.Publish({...key,version:'2.0.0'},file);
    expect(await fs.readFile(await b.Pull(first),'utf8')).toBe('first');
    await expect(b.Pull({...first,sha256:'0'.repeat(64)})).rejects.toThrow('已变化');
  }finally{await server.close();await fs.rm(dir,{recursive:true,force:true});}
});

it('engine manager downloads a signed release, upgrades and uninstalls without unpublishing',async()=>{
  const {runtimeFixture}=await import('./src/logic/updates/service/support/runtime-fixture');
  const {EngineArtifacts}=await import('../src/logic/updates/service/engine-artifacts');
  const {EnginePackages}=await import('../src/resource/engines');
  const {RuntimeStore}=await import('../src/logic/updates/service/runtime-store');
  const {DownloadService}=await import('../src/logic/updates/service/download-service');
  const {archiveDirectory}=await import('../scripts/runtime-packaging');
  const f=await runtimeFixture(),data=path.join(f.root,'registry'),token=crypto.randomUUID(),server=await startRegistry({data,token});
  const prev=process.env.CBIM_REGISTRY_PORT,port=new URL(server.url).port;process.env.CBIM_REGISTRY_PORT=port;
  try{
    const client=localRegistry(f.root,port,token),signal=new AbortController().signal;
    const artifacts=new EngineArtifacts(path.join(f.root,'index.json'),new RuntimeStore(path.join(f.root,'store'),f.cold,new DownloadService(path.join(f.root,'dl'),signal)),undefined,signal);
    const engines=new EnginePackages(path.join(f.root,'state.json'),artifacts);
    for(const sequence of [1,2]){
      const dir=path.join(f.root,'engine'),version='1.0.'+sequence;await fs.writeFile(path.join(dir,'adapter.cjs'),'// adapter '+sequence);
      const pkg=await archiveDirectory(dir,f.output,'runtime-engines','pi-'+sequence);
      const release={...f.manifest.engines[0],package:pkg,adapter:{version,entry:'adapter.cjs',protocol:1}};
      await client.Publish({kind:'engine',id:'pi',version},path.join(f.output,pkg.name));
      const index={schema:1,sequence,createdAt:f.manifest.createdAt,expiresAt:f.manifest.expiresAt,sourceCommit:f.manifest.sourceCommit,notes:'test',platform:'win32-x64',releases:[release],current:[{kind:'pi',identity:pkg.sha256}]};
      await fs.writeFile(path.join(data,'signed-engine-index.json'),JSON.stringify(f.envelope(index)));
      await engines.Check();await engines.Install('pi');
      expect((await engines.ResolveEngine('pi')).identity).toBe(pkg.sha256);
    }
    await engines.SetEnabled('pi',false,true);
    await expect(engines.ResolveEngine('pi')).rejects.toThrow();
    expect(await client.List()).toHaveLength(2);
  }finally{if(prev===undefined)delete process.env.CBIM_REGISTRY_PORT;else process.env.CBIM_REGISTRY_PORT=prev;await server.close();await f.cleanup();}
});
