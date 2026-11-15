import {createPublicKey,sign,type KeyObject} from 'node:crypto';
import {enginePackageSchema,type EnginePackage,type ColdRuntime,type SignedRuntimeManifest} from '../src/logic/updates/service/runtime-manifest';
import {verifyEngineIndex,type EngineReleaseIndex} from '../src/logic/updates/service/engine-index';
import {engineDescriptor,loopEngineSchema} from '../src/logic/engines';

/** 只生成可审阅签名候选，不上传制品或切换公开通道；旧索引必须使用同一信任根。 */
export function signEngineRelease(input:{engines:EnginePackage[];sequence:number;notes:string;sourceCommit:string;previous?:SignedRuntimeManifest},key:KeyObject,cold:ColdRuntime){
  if(createPublicKey(key).export({type:'spki',format:'pem'}).toString()!==cold.publicKey)throw Error('签名密钥与冷基础信任根不一致');
  const previous=input.previous?verifyEngineIndex(input.previous,cold,true).index:undefined;
  if(input.sequence<=(previous?.sequence??0))throw Error('发布序号必须大于上一版');
  const releases=[...(previous?.releases??[])],current=new Map(previous?.current.map(ref=>[ref.kind,ref.identity])??[]);
  if(!input.engines.length)throw Error('没有待发布的引擎制品');
  const kinds=new Set<string>();
  for(const raw of input.engines){
    const engine=enginePackageSchema.parse(raw),descriptor=engineDescriptor(loopEngineSchema.parse(engine.kind));
    if(kinds.has(engine.kind))throw Error('重复引擎候选');kinds.add(engine.kind);
    if(!engine.adapter||(engine.dependencies??[]).length!==(descriptor.packageDependencies??[]).length||(engine.dependencies??[]).some(ref=>!(descriptor.packageDependencies??[]).includes(ref.kind)))throw Error('引擎包不满足静态声明');
    const old=releases.find(item=>item.kind===engine.kind&&item.adapter?.version===engine.adapter!.version);
    if(old&&JSON.stringify(old)!==JSON.stringify(engine))throw Error('同版本不能覆盖，请先增加引擎包版本');
    if(!old)releases.push(engine);current.set(engine.kind,engine.package.sha256);
  }
  const index:EngineReleaseIndex={schema:1,sequence:input.sequence,platform:cold.platform,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+90*86400000).toISOString(),sourceCommit:input.sourceCommit,notes:input.notes,current:[...current].map(([kind,identity])=>({kind,identity})),releases};
  const payload=JSON.stringify(index),envelope={payload,signature:sign(null,Buffer.from(payload),key).toString('base64')};
  verifyEngineIndex(envelope,cold);return envelope;
}
