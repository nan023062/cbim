import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {runtimeFixture,digest} from './runtime-fixture';
import {archiveDirectory} from '../scripts/runtime-packaging';
import {RuntimeStore} from '../src/logic/updates/service/runtime-store';
import {EngineArtifacts} from '../src/logic/updates/service/engine-artifacts';
import {EnginePackages} from '../src/logic/engines/packages';

it('CBIM 更换冷版本和资源后，原安装/停用选择及引擎缓存离线复用，不重复下载或写入安装清单',async()=>{
  const f=await runtimeFixture();try{
    const userRoot=path.join(f.root,'user'),cacheRoot=path.join(f.root,'shared-engines');
    const stateFile=path.join(userRoot,'engine-installations.json'),indexFile=path.join(userRoot,'engine-index.json');
    const engineRoot=path.join(f.root,'engine');await fs.writeFile(path.join(engineRoot,'adapter.cjs'),'module.exports={}');
    const pkg=await archiveDirectory(engineRoot,f.output,'runtime-engines','adapter-engine');
    const engine={...f.manifest.engines[0],package:pkg,adapter:{entry:'adapter.cjs',version:'1.0.0',protocol:1 as const}};
    const manifest={...f.manifest,engines:[engine]},download=vi.fn(f.download),signal=new AbortController().signal;
    const oldArtifacts=new EngineArtifacts(indexFile,new RuntimeStore(cacheRoot,f.cold,download),f.envelope(manifest),signal);
    const old=new EnginePackages(stateFile,oldArtifacts);
    await old.install('pi');await old.setEnabled('memory',false);
    const installed=await old.read(),bytes=await fs.readFile(stateFile,'utf8');
    const original=await old.resolveEngine('pi');expect(download).toHaveBeenCalledOnce();
    const offline=vi.fn(async()=>{throw Error('离线不得下载')});
    const cold={...f.cold,codeVersion:'0.3.0',coldFingerprint:digest('next-cold')};
    const updated={...manifest,codeVersion:cold.codeVersion,coldFingerprint:cold.coldFingerprint,resourceVersion:2};
    const artifacts=new EngineArtifacts(indexFile,new RuntimeStore(cacheRoot,cold,offline),f.envelope(updated),signal,offline);
    const reopened=new EnginePackages(stateFile,artifacts);
    expect(await reopened.read()).toEqual(installed);
    const reused=await reopened.resolveEngine('pi');
    expect(reused.root).toBe(original.root);expect(reused.identity).toBe(original.identity);
    expect(await fs.readFile(stateFile,'utf8')).toBe(bytes);expect(offline).not.toHaveBeenCalled();
    await expect(reopened.resolveEngine('memory')).rejects.toThrow(/停用/);
    await reopened.setEnabled('pi',false,true);
    expect((await reopened.read()).items[0].installed).toHaveLength(1);
    await reopened.install('pi');expect((await reopened.resolveEngine('pi')).root).toBe(original.root);
    expect(offline).not.toHaveBeenCalled();
    await fs.writeFile(path.join(reused.root,'entry.js'),'broken');
    await expect(reopened.resolveEngine('pi')).rejects.toThrow();
    expect((await reopened.read()).items[0].error).toBeTruthy();
    await expect(reopened.resolveEngine('pi')).rejects.toThrow();expect(offline).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});
