import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {generateKeyPairSync,sign} from 'node:crypto';
import {runtimeFixture,digest} from '../../logic/updates/service/support/runtime-fixture';
import {archiveDirectory} from '../../../../scripts/runtime-packaging';
import {RuntimeStore} from '../../../../src/logic/updates/service/runtime-store';
import {EngineArtifacts} from '../../../../src/logic/updates/service/engine-artifacts';
import {EnginePackages} from '../../../../src/resource/engines';

it.each([false,true])('CBIM 更换冷版本和资源（换钥=%s）后，原安装/停用选择及引擎缓存离线复用',async rotate=>{
  const f=await runtimeFixture();try{
    const userRoot=path.join(f.root,'user'),cacheRoot=path.join(f.root,'shared-engines');
    const stateFile=path.join(userRoot,'engine-installations.json'),indexFile=path.join(userRoot,'engine-index.json');
    const engineRoot=path.join(f.root,'engine');await fs.writeFile(path.join(engineRoot,'adapter.cjs'),'module.exports={}');
    const pkg=await archiveDirectory(engineRoot,f.output,'runtime-engines','adapter-engine');
    const engine={...f.manifest.engines[0],package:pkg,adapter:{entry:'adapter.cjs',version:'1.0.0',protocol:1 as const}};
    const manifest={...f.manifest,engines:[engine]},download=vi.fn(f.download),signal=new AbortController().signal;
    const oldArtifacts=new EngineArtifacts(indexFile,new RuntimeStore(cacheRoot,f.cold,download),f.envelope(manifest),signal);
    const old=new EnginePackages(stateFile,oldArtifacts);
    await old.Install('pi');await old.SetEnabled('memory',false);
    const installed=await old.Read(),bytes=await fs.readFile(stateFile,'utf8');
    const original=await old.ResolveEngine('pi');expect(download).toHaveBeenCalledOnce();
    const offline=vi.fn(async()=>{throw Error('离线不得下载')});
    const pair=generateKeyPairSync('ed25519');
    const cold={...f.cold,codeVersion:'0.3.0',coldFingerprint:digest('next-cold'),publicKey:rotate?pair.publicKey.export({type:'spki',format:'pem'}).toString():f.cold.publicKey};
    const updated={...manifest,codeVersion:cold.codeVersion,coldFingerprint:cold.coldFingerprint,resourceVersion:2};
    const payload=JSON.stringify(updated),seed=rotate?{payload,signature:sign(null,Buffer.from(payload),pair.privateKey).toString('base64')}:f.envelope(updated);
    const artifacts=new EngineArtifacts(indexFile,new RuntimeStore(cacheRoot,cold,offline),seed,signal,offline,undefined,rotate?[f.cold.publicKey]:[]);
    const reopened=new EnginePackages(stateFile,artifacts);
    expect(await reopened.Read()).toEqual(installed);
    const reused=await reopened.ResolveEngine('pi');
    expect(reused.root).toBe(original.root);expect(reused.identity).toBe(original.identity);
    expect(await fs.readFile(stateFile,'utf8')).toBe(bytes);expect(offline).not.toHaveBeenCalled();
    await expect(reopened.ResolveEngine('memory')).rejects.toThrow(/停用/);
    await reopened.SetEnabled('pi',false,true);
    expect((await reopened.Read()).items[0].installed).toHaveLength(1);
    await reopened.Install('pi');expect((await reopened.ResolveEngine('pi')).root).toBe(original.root);
    expect(offline).not.toHaveBeenCalled();
    await fs.writeFile(path.join(reused.root,'entry.js'),'broken');
    await expect(reopened.ResolveEngine('pi')).rejects.toThrow();
    expect((await reopened.Read()).items[0].error).toBeTruthy();
    await expect(reopened.ResolveEngine('pi')).rejects.toThrow();expect(offline).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});
