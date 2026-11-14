/**
 * 作用定位：独立 E 发布索引的签名、版本和准确依赖闭包验证。
 * 设计原因：E 的发布序号不依赖 C/R 版本；公钥与平台仍由冷壳固定，索引只能提供制品，不能扩大 R 的静态支持名单。
 */
import {createPublicKey,verify} from 'node:crypto';
import {z} from 'zod';
import {enginePackageSchema,validateEnginePackage,runtimeManifestDigest,type EnginePackage,type ColdRuntime} from './runtime-manifest';

const reference=z.object({kind:z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),identity:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const indexSchema=z.object({schema:z.literal(1),sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),platform:z.literal('win32-x64'),createdAt:z.string().datetime(),expiresAt:z.string().datetime(),sourceCommit:z.string().regex(/^[a-f0-9]{40}$/),notes:z.string().max(30000),current:z.array(reference).min(1).max(64),releases:z.array(enginePackageSchema).min(1).max(256)}).strict();
export type EngineReleaseIndex=z.infer<typeof indexSchema>;
/** 历史已接纳索引允许离线过期；签名和结构每次重开均复核。 */
export function verifyEngineIndex(raw:unknown,cold:Pick<ColdRuntime,'publicKey'|'platform'>,installed=false){
  const envelope=z.object({payload:z.string().max(12*1024*1024),signature:z.string().regex(/^[A-Za-z0-9+/]{86}==$/)}).strict().parse(raw);
  const key=createPublicKey(cold.publicKey);
  if(key.asymmetricKeyType!=='ed25519'||!verify(null,Buffer.from(envelope.payload),key,Buffer.from(envelope.signature,'base64')))throw Error('引擎索引签名无效');
  const index=indexSchema.parse(JSON.parse(envelope.payload));
  if(index.platform!==cold.platform)throw Error('引擎平台不兼容');
  if(Date.parse(index.createdAt)>Date.now()+300000||Date.parse(index.expiresAt)<=Date.parse(index.createdAt)||!installed&&Date.parse(index.expiresAt)<=Date.now())throw Error('引擎索引时间无效或已过期');
  const releases=new Map<string,EnginePackage>();
  const versions=new Set<string>();
  for(const engine of index.releases){validateEnginePackage(engine);if(!engine.adapter)throw Error('引擎缺少版本化适配器');const id=engine.kind+':'+engine.package.sha256,version=engine.kind+':'+engine.adapter.version;if(releases.has(id)||versions.has(version))throw Error('引擎制品或版本重复');releases.set(id,engine);versions.add(version)}
  if(new Set(index.current.map(ref=>ref.kind)).size!==index.current.length)throw Error('引擎当前版本重复');
  const visiting=new Set<string>(),visited=new Set<string>();
  function visit(kind:string,identity:string){
    const id=kind+':'+identity;if(visiting.has(id))throw Error('引擎依赖成环');if(visited.has(id))return;
    const engine=releases.get(id);if(!engine)throw Error('引擎依赖或当前制品缺失');
    visiting.add(id);for(const ref of engine.dependencies??[])visit(ref.kind,ref.identity);visiting.delete(id);visited.add(id);
  }
  for(const ref of index.current)visit(ref.kind,ref.identity);
  for(const engine of index.releases)visit(engine.kind,engine.package.sha256);
  return {index,envelope,digest:runtimeManifestDigest(envelope)};
}
