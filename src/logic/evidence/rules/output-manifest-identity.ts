/**
 * 目录归属：logic/evidence/rules/evidence；产物与 Workflow 证据规则。
 * 作用定位：完整清单的确定性范围/内容指纹及引用投影，作为清单和原操作证明共用的单向基础。
 * 设计原因：操作证据要核前后集合，不能反向依赖遍历 canonical 的验证器而形成循环。
 * 职责边界：只重算结构及摘要，不访问文件，也不将合法结构等同真实采集。
 * 机制边界：对象递归排序由 utility 提供，本模块保留历史比较器、字段省略和业务指纹规则。
 */
import {orderJsonValue} from '../../../core/utility';
import {isDeepStrictEqual as equal} from 'node:util';
import {hash} from '../../../core/platform/node/serialization';
import {artifactScopeBindingsSchema,type ArtifactScopeBinding} from '../../workspace/rules/artifact-scope';
import {outputManifestRefSchema,outputManifestSnapshotSchema,type OutputManifestSnapshot,type OutputManifestStaged,type OutputManifestRef} from './output-manifest';

/** 保留本模块历史键排序与 undefined 规则；utility 只提供递归复制机制。 */
const ordered=(value:unknown):unknown=>orderJsonValue(value,{compareKeys:(a,b)=>a<b?-1:a>b?1:0,omitUndefinedProperties:false});
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
