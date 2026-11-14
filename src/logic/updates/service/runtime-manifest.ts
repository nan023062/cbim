/**
 * 作用定位：冷壳与资源更新器共用的签名清单、制品身份和路径约束。
 * 设计原因：C/R 与引擎依赖分别标识，远端只能声明固定仓库制品；完整文件集合参与签名，校验逻辑不归待加载的业务包。
 */
import {createHash,createPublicKey,verify} from 'node:crypto';
import {z} from 'zod';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const version=z.string().regex(/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/);
const asset=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/);
const fileSchema=z.object({path:z.string().min(1).max(600),bytes:z.number().int().min(0).max(2**31),sha256:hash}).strict();
const packageSchema=z.object({tag:asset,name:asset,bytes:z.number().int().positive().max(2**31),sha256:hash,files:z.array(fileSchema).min(1).max(50000)}).strict();
export const enginePackageSchema=z.object({kind:z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),version,entry:z.string(),adapter:z.object({entry:z.string(),version,protocol:z.literal(1)}).strict().optional(),dependencies:z.array(z.object({kind:z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),identity:hash}).strict()).max(16).optional(),package:packageSchema}).strict();
const manifestSchema=z.object({schema:z.literal(1),codeVersion:version,resourceVersion:z.number().int().positive(),coldFingerprint:hash,
  platform:z.literal('win32-x64'),createdAt:z.string().datetime(),expiresAt:z.string().datetime(),sourceCommit:z.string().regex(/^[a-f0-9]{40}$/),
  notes:z.string().max(30000),resource:packageSchema,engines:z.array(enginePackageSchema).min(1).max(64)}).strict();

export type RuntimeManifest=z.infer<typeof manifestSchema>;
export type RuntimePackage=z.infer<typeof packageSchema>;
export type RuntimeFile=z.infer<typeof fileSchema>;
export type EnginePackage=z.infer<typeof enginePackageSchema>;
/** 通用制品校验不持有支持名单；R 静态清单决定哪些 ID 可被 Agent 选择。 */
export function validateEnginePackage(engine:EnginePackage){
  runtimeRelativePath(engine.entry);if(!engine.package.files.some(file=>file.path===engine.entry))throw Error('引擎入口不在清单中');
  if(engine.adapter){runtimeRelativePath(engine.adapter.entry);if(!engine.adapter.entry.endsWith('.cjs')||!engine.package.files.some(file=>file.path===engine.adapter!.entry))throw Error('适配器入口不在清单中');}
  const dependencies=engine.dependencies??[];if(dependencies.some(d=>d.kind===engine.kind)||new Set(dependencies.map(d=>d.kind)).size!==dependencies.length)throw Error('引擎依赖无效或重复');
  validateRuntimeFiles(engine.package.files);
}
/** 由安装基础包携带；只有冷更可更换公钥与基础能力指纹。 */
export interface ColdRuntime {schema:1;codeVersion:string;coldFingerprint:string;platform:'win32-x64';publicKey:string}
/** payload 保留发布者签名时的准确 UTF-8 字节，避免不同 JSON 序列化产生歧义。 */
export interface SignedRuntimeManifest {payload:string;signature:string}

/** 限定 Windows 相对文件路径；拒绝 ADS、设备名、大小写别名和路径穿越。 */
export function runtimeRelativePath(value:string){
  if(!value||value.length>600||value.includes('\\')||/[\x00-\x1f<>:"|?*]/.test(value)||value.startsWith('/')||value.normalize('NFC')!==value)throw Error('更新文件路径无效');
  for(const segment of value.split('/'))if(!segment||segment==='.'||segment==='..'||/[ .]$/.test(segment)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))throw Error('更新文件路径无效');
  return value;
}
/** 完整清单决定目录终态；文件与目录不能互相遮蔽，禁止 Windows 大小写重复。 */
export function validateRuntimeFiles(files:RuntimeFile[]){
  const names=new Set<string>();let bytes=0;
  for(const file of files){const name=runtimeRelativePath(file.path).toLowerCase();if(names.has(name))throw Error('更新文件重复');names.add(name);bytes+=file.bytes;}
  if(bytes>4*2**30)throw Error('更新展开大小超过上限');
  for(const name of names){const parts=name.split('/');parts.pop();while(parts.length){if(names.has(parts.join('/')))throw Error('更新文件与目录冲突');parts.pop();}}
}
/** 仅允许本项目 Release 附件；制品不是模型或 IPC 提供的任意下载 URL。 */
export function runtimePackageUrl(pkg:Pick<RuntimePackage,'tag'|'name'>){
  asset.parse(pkg.tag);asset.parse(pkg.name);
  return `https://github.com/nan023062/cbim/releases/download/${pkg.tag}/${pkg.name}`;
}
export function runtimeManifestDigest(envelope:SignedRuntimeManifest){return createHash('sha256').update(envelope.payload).digest('hex')}

/** 首次发现时检查有效期；已确认的本地制品过期后仍可离线启动，签名和文件校验始终执行。 */
export function verifyRuntimeManifest(raw:unknown,cold:ColdRuntime,options:{now?:number;installed?:boolean}={}):{manifest:RuntimeManifest;envelope:SignedRuntimeManifest;digest:string}{
  const envelope=z.object({payload:z.string().max(12*1024*1024),signature:z.string().regex(/^[A-Za-z0-9+/]{86}==$/)}).strict().parse(raw);
  const key=createPublicKey(cold.publicKey);
  if(key.asymmetricKeyType!=='ed25519'||!verify(null,Buffer.from(envelope.payload),key,Buffer.from(envelope.signature,'base64')))throw Error('更新清单签名无效');
  const manifest=manifestSchema.parse(JSON.parse(envelope.payload));
  if(manifest.codeVersion!==cold.codeVersion||manifest.platform!==cold.platform||manifest.coldFingerprint!==cold.coldFingerprint)throw Error('资源包与冷更基础不兼容');
  const now=options.now??Date.now();
  if(Date.parse(manifest.createdAt)>now+5*60_000||Date.parse(manifest.expiresAt)<=Date.parse(manifest.createdAt)||(!options.installed&&Date.parse(manifest.expiresAt)<=now))throw Error('更新清单时间无效或已过期');
  const kinds=new Set<string>();
  for(const engine of manifest.engines){if(kinds.has(engine.kind))throw Error('引擎清单重复');kinds.add(engine.kind);runtimeRelativePath(engine.entry);if(!engine.package.files.some(file=>file.path===engine.entry))throw Error('引擎入口不在清单中');validateEnginePackage(engine);}
  validateRuntimeFiles(manifest.resource.files);
  for(const file of manifest.resource.files)if(/\.(exe|dll|node|sys|dylib|so)$/i.test(file.path))throw Error('资源包不能更换冷基础原生文件');
  for(const entry of ['.vite/build/main.js','.vite/build/preload.js','.vite/renderer/main_window/index.html'])if(!manifest.resource.files.some(file=>file.path===entry))throw Error('资源包缺少应用入口');
  return {manifest,envelope,digest:runtimeManifestDigest(envelope)};
}
