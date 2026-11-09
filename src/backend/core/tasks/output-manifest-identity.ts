/**
 * 作用定位：完整清单的确定性范围/内容指纹及引用投影，作为清单和原操作证明共用的单向基础。
 * 设计原因：操作证据要核前后集合，不能反向依赖遍历 canonical 的验证器而形成循环。
 * 职责边界：只重算结构及摘要，不访问文件，也不将合法结构等同真实采集。
 */
import {isDeepStrictEqual as equal} from 'node:util';
import {hash} from '../foundation/serialization';
import {artifactScopeBindingsSchema,type ArtifactScopeBinding} from '../workspace/artifact-scope';
import {outputManifestRefSchema,outputManifestSnapshotSchema,type OutputManifestSnapshot,type OutputManifestStaged,type OutputManifestRef} from './output-manifest';

const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,ordered(item)])):value;
/** 全部冻结根、模块和操作声明进入同一范围身份。 */
export const outputManifestScopeHash=(scopes:readonly ArtifactScopeBinding[])=>hash(JSON.stringify(ordered(artifactScopeBindingsSchema.parse(scopes))));
/** 包括缺失根与全部目录条目；不采纳调用者自报内容 hash。 */
export const outputManifestHash=(snapshot:OutputManifestSnapshot)=>hash(JSON.stringify(ordered(outputManifestSnapshotSchema.parse(snapshot))));
/** 引用从完整快照计算；操作证明的原日志真实性由上层独立核实。 */
export function outputManifestReference(manifest:OutputManifestStaged):OutputManifestRef{
  const {version:_version,binding:_binding,snapshot,...ref}=manifest,files=snapshot.entries.filter(entry=>entry.kind==='file');
  if(!equal(ref.scopes,snapshot.scopes)||ref.scopeHash!==outputManifestScopeHash(snapshot.scopes)||ref.manifestHash!==outputManifestHash(snapshot)||ref.entryCount!==snapshot.entries.length||ref.fileCount!==files.length||ref.byteLength!==files.reduce((sum,file)=>sum+file.byteLength,0))throw Error('完整产物清单的范围、数量或摘要不一致');
  return outputManifestRefSchema.parse(ref);
}
