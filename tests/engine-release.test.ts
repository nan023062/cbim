import {test,expect} from 'vitest';
import {generateKeyPairSync} from 'node:crypto';
import {signEngineRelease} from '../scripts/engine-release';
import {verifyEngineIndex} from '../src/logic/updates/service/engine-index';
import type {ColdRuntime,EnginePackage} from '../src/logic/updates/service/runtime-manifest';
const keys=generateKeyPairSync('ed25519'),cold:ColdRuntime={schema:1,codeVersion:'0.1.0',coldFingerprint:'a'.repeat(64),platform:'win32-x64',publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString()};
const pkg=(kind:string,version:string,id:string,dependencies?:EnginePackage['dependencies']):EnginePackage=>({kind,version:'1.5.0',entry:'adapter.cjs',adapter:{entry:'adapter.cjs',version,protocol:1},...(dependencies?{dependencies}:{}),package:{tag:'runtime-engines',name:kind+'-'+version+'.zip',bytes:1,sha256:id.repeat(64),files:[{path:'adapter.cjs',bytes:1,sha256:'a'.repeat(64)}]}});
const input=(engines:EnginePackage[],sequence=1)=>({engines,sequence,notes:'升级说明',sourceCommit:'a'.repeat(40)});
test('同 C/R 单独更新引擎，保留其他引擎和旧依赖的准确版本',()=>{
  const pi=pkg('pi','1.0.0','a'),codex=pkg('codex','1.0.0','c',[{kind:'pi',identity:pi.package.sha256}]);
  const previous=signEngineRelease(input([pi,codex]),keys.privateKey,cold);
  const next=signEngineRelease({...input([pkg('pi','1.1.0','b')],2),previous},keys.privateKey,cold);
  const checked=verifyEngineIndex(next,cold).index;expect(checked.current).toEqual([{kind:'pi',identity:'b'.repeat(64)},{kind:'codex',identity:'c'.repeat(64)}]);expect(checked.releases).toHaveLength(3);
  expect(verifyEngineIndex(next,{...cold,codeVersion:'0.2.0'} as ColdRuntime).index.sequence).toBe(2);
});
test('重复版本覆盖、错误签名根、未知引擎和缺失依赖拒绝生成索引',()=>{
  const previous=signEngineRelease(input([pkg('pi','1.0.0','a')]),keys.privateKey,cold);
  expect(()=>signEngineRelease({...input([pkg('pi','1.0.0','b')],2),previous},keys.privateKey,cold)).toThrow(/同版本/);
  expect(()=>signEngineRelease({...input([pkg('pi','1.1.0','b')]),previous},keys.privateKey,cold)).toThrow(/序号/);
  expect(()=>signEngineRelease(input([pkg('pi','1.0.0','a')]),generateKeyPairSync('ed25519').privateKey,cold)).toThrow(/信任根/);
  expect(()=>signEngineRelease(input([pkg('user-plugin','1.0.0','a')]),keys.privateKey,cold)).toThrow();
  expect(()=>signEngineRelease(input([pkg('codex','1.0.0','c',[{kind:'pi',identity:'a'.repeat(64)}])]),keys.privateKey,cold)).toThrow(/缺失/);
});
