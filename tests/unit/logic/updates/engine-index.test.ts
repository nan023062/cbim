import {test,expect} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyEngineIndex,type EngineReleaseIndex} from '../../../../src/logic/updates/service/engine-index';
const pair=generateKeyPairSync('ed25519'),cold={publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),platform:'win32-x64' as const};
const pkg=(kind='pi',id='a')=>({kind,version:'1.5.0',entry:'adapter.cjs',adapter:{entry:'adapter.cjs',version:'1.0.0',protocol:1 as const},package:{tag:'runtime-engines',name:kind+'.zip',bytes:100,sha256:id.repeat(64),files:[{path:'adapter.cjs',bytes:1,sha256:'b'.repeat(64)}]}});
const index=():EngineReleaseIndex=>({schema:1,sequence:1,platform:cold.platform,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),sourceCommit:'a'.repeat(40),notes:'',current:[{kind:'pi',identity:'a'.repeat(64)}],releases:[pkg()]});
const envelope=(value:unknown)=>{const payload=JSON.stringify(value);return {payload,signature:sign(null,Buffer.from(payload),pair.privateKey).toString('base64')}};
test('独立 E 索引只绑定公钥与平台，不要求 C/R 版本；离线已接纳版本不受过期影响',()=>{
  expect(verifyEngineIndex(envelope(index()),cold).index.sequence).toBe(1);
  const expired={...index(),createdAt:'2020-01-01T00:00:00Z',expiresAt:'2020-01-02T00:00:00Z'};
  expect(()=>verifyEngineIndex(envelope(expired),cold)).toThrow(/过期/);expect(verifyEngineIndex(envelope(expired),cold,true).index.sequence).toBe(1);
  expect(()=>verifyEngineIndex({...envelope(index()),payload:'{}'},cold)).toThrow(/签名/);
});
test('每个固定依赖必须存在，无环且入口属于完整清单；索引不是支持名单',()=>{
  const pi=pkg(),codex={...pkg('codex','c'),dependencies:[{kind:'pi',identity:pi.package.sha256}]};
  expect(verifyEngineIndex(envelope({...index(),releases:[pi,codex]}),cold).index.releases).toHaveLength(2);
  expect(()=>verifyEngineIndex(envelope({...index(),releases:[codex]}),cold)).toThrow(/缺失/);
  expect(()=>verifyEngineIndex(envelope({...index(),releases:[{...pi,dependencies:[{kind:'codex',identity:codex.package.sha256}]},codex]}),cold)).toThrow(/成环/);
  expect(()=>verifyEngineIndex(envelope({...index(),releases:[{...pi,adapter:{...pi.adapter,entry:'../outside.cjs'}}]}),cold)).toThrow(/路径/);
  expect(verifyEngineIndex(envelope({...index(),current:[{kind:'new-domain',identity:'a'.repeat(64)}],releases:[pkg('new-domain')]}),cold).index.current[0].kind).toBe('new-domain');
});
