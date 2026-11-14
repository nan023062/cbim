import {test,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {generateKeyPairSync,sign} from 'node:crypto';
import {EngineArtifacts} from '../../../../src/logic/updates/service/engine-artifacts';
import type {RuntimeStore} from '../../../../src/logic/updates/service/runtime-store';
import type {ColdRuntime,EnginePackage,RuntimeManifest} from '../../../../src/logic/updates/service/runtime-manifest';
import type {EngineReleaseIndex} from '../../../../src/logic/updates/service/engine-index';

async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-engine-index-')),pair=generateKeyPairSync('ed25519');
  const cold:ColdRuntime={schema:1,codeVersion:'0.1.0',coldFingerprint:'c'.repeat(64),platform:'win32-x64',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString()};
  const signed=(value:unknown)=>{const payload=JSON.stringify(value);return {payload,signature:sign(null,Buffer.from(payload),pair.privateKey).toString('base64')}};
  const pkg=(version:string,id:string):EnginePackage=>({kind:'pi',version:'1.5.0',entry:'adapter.cjs',adapter:{entry:'adapter.cjs',version,protocol:1},package:{tag:'runtime-engines',name:'pi-'+version+'.zip',bytes:100,sha256:id.repeat(64),files:[{path:'adapter.cjs',bytes:1,sha256:'b'.repeat(64)}]}});
  const pi=pkg('1.0.0','a'),next=pkg('1.1.0','b'),times={createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),sourceCommit:'a'.repeat(40),notes:''};
  const seed=(engine:EnginePackage,codeVersion='0.1.0')=>signed({schema:1,codeVersion,coldFingerprint:cold.coldFingerprint,resourceVersion:1,platform:cold.platform,...times,resource:{...pi.package,files:['.vite/build/main.js','.vite/build/preload.js','.vite/renderer/main_window/index.html'].map(path=>({path,bytes:1,sha256:'b'.repeat(64)}))},engines:[engine]} satisfies RuntimeManifest);
  const index=(sequence:number,engine=next)=>signed({schema:1,sequence,platform:cold.platform,...times,current:[{kind:'pi',identity:engine.package.sha256}],releases:[engine]} satisfies EngineReleaseIndex);
  const prepare=vi.fn(async()=>root),store={cold,prepare} as unknown as RuntimeStore,fetchIndex=vi.fn(async()=>index(1)),file=path.join(root,'index.json');
  return {root,cold,pi,next,pkg,seed,index,store,prepare,fetchIndex,file,service:new EngineArtifacts(file,store,seed(pi),new AbortController().signal,fetchIndex),async cleanup(){if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('cbim-engine-index-'))throw Error('cleanup boundary');await fs.rm(root,{recursive:true,force:true})}};
}
test('发现独立引擎版本不下载，准备只接受签名摘要，重开仍可离线使用历史版本',async()=>{
  const f=await fixture();try{
    expect((await f.service.list()).current[0].version).toBe('1.0.0');await f.service.check();expect(f.prepare).not.toHaveBeenCalled();
    expect((await f.service.list()).current[0].version).toBe('1.1.0');await expect(f.service.prepare('pi','d'.repeat(64))).rejects.toThrow(/受信/);
    await f.service.prepare('pi',f.pi.package.sha256);expect(f.prepare).toHaveBeenCalledOnce();
    const reopened=new EngineArtifacts(f.file,f.store,f.seed(f.next,'0.2.0'),new AbortController().signal,async()=>{throw Error('offline')});
    expect((await reopened.list()).available.map(item=>item.version)).toEqual(['1.0.0','1.1.0']);await reopened.prepare('pi',f.pi.package.sha256);
  }finally{await f.cleanup()}
});
test('回退、同序号不同内容、同版本不同摘要拒绝，失败保留上次可信候选',async()=>{
  const f=await fixture();try{
    f.fetchIndex.mockResolvedValueOnce(f.index(2));await f.service.check();
    f.fetchIndex.mockResolvedValueOnce(f.index(1));await expect(f.service.check()).rejects.toThrow(/回退/);
    f.fetchIndex.mockResolvedValueOnce(f.index(2,f.pkg('1.2.0','e')));await expect(f.service.check()).rejects.toThrow(/冲突/);
    f.fetchIndex.mockResolvedValueOnce(f.index(3,f.pkg('1.1.0','e')));await expect(f.service.check()).rejects.toThrow(/不同制品/);
    expect((await f.service.list()).current[0].identity).toBe(f.next.package.sha256);
    const reopened=new EngineArtifacts(f.file,f.store,f.seed(f.pi),new AbortController().signal,f.fetchIndex);expect((await reopened.list()).current[0].version).toBe('1.1.0');
  }finally{await f.cleanup()}
});
