import {it,expect} from 'vitest';
import {runtimeFixture,digest} from './runtime-fixture';
import {verifyRuntimeManifest,runtimeRelativePath,validateRuntimeFiles,runtimePackageUrl} from '../src/logic/updates/service/runtime-manifest';
it('authenticates exact payload bytes, C/platform/fingerprint and bounded freshness; installed releases work offline',async()=>{
  const f=await runtimeFixture();try{
    expect(verifyRuntimeManifest(f.envelope(),f.cold).manifest.resourceVersion).toBe(1);
    expect(()=>verifyRuntimeManifest({...f.envelope(),payload:f.envelope().payload+' '},f.cold)).toThrow(/签名/);
    for(const cold of [{...f.cold,codeVersion:'0.3.0'},{...f.cold,coldFingerprint:digest('changed')},{...f.cold,platform:'linux-x64' as any}])expect(()=>verifyRuntimeManifest(f.envelope(),cold)).toThrow(/兼容/);
    const expired=f.envelope({...f.manifest,createdAt:'2026-01-01T00:00:00Z',expiresAt:'2026-01-02T00:00:00Z'});
    expect(()=>verifyRuntimeManifest(expired,f.cold)).toThrow(/过期/);expect(verifyRuntimeManifest(expired,f.cold,{installed:true}).manifest.resourceVersion).toBe(1);
    expect(()=>verifyRuntimeManifest(f.envelope({...f.manifest,createdAt:new Date(Date.now()+3600000).toISOString()}),f.cold)).toThrow(/时间/);
  }finally{await f.cleanup()}
});
it('rejects Windows aliases, traversal, duplicate files, native R payloads and undeclared engine entrypoints',async()=>{
  for(const name of ['../file','/abs','a\\b','a/../b','a:b','NUL.txt','com1','a.','a ','a//b'])expect(()=>runtimeRelativePath(name),name).toThrow();
  for(const paths of [['a','A'],['a','a/b']])expect(()=>validateRuntimeFiles(paths.map(path=>({path,bytes:1,sha256:digest(path)})))).toThrow();
  expect(()=>runtimePackageUrl({tag:'../../other',name:'a.zip'})).toThrow();
  const f=await runtimeFixture();try{
    expect(()=>verifyRuntimeManifest(f.envelope({...f.manifest,resource:{...f.manifest.resource,files:[...f.manifest.resource.files,{path:'addon.node',bytes:1,sha256:digest('n')}]}}),f.cold)).toThrow(/原生/);
    expect(()=>verifyRuntimeManifest(f.envelope({...f.manifest,engines:f.manifest.engines.map(engine=>({...engine,entry:'other.js'}))}),f.cold)).toThrow(/入口/);
    expect(()=>verifyRuntimeManifest(f.envelope({...f.manifest,engines:[f.manifest.engines[0],f.manifest.engines[0],f.manifest.engines[2]]}),f.cold)).toThrow(/重复/);
  }finally{await f.cleanup()}
});
