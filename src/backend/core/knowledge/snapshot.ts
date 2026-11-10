/**
 * 作用定位：已校验知识快照的版本信息、定义读取和受限正文引用解析。
 * 设计原因：团队与业务领域共用只读快照契约；仅依赖知识数据与 Foundation，不反向引用查询编排、领域视图或存储实现。
 */
import path from 'node:path';
import {fail} from '../foundation/errors';
import {parseJson} from '../foundation/json';
import type {Snapshot} from './types';
/** 查询编排只取得当前校验快照；不暴露知识写入、维护任务或工作区生命周期。 */
export interface KnowledgeSnapshotReader {
  /** 每次调用返回一次完整版本；跨次调用不承诺同版，由组合用例核对 revision。 */
  snapshot():Promise<Snapshot>;
}
export function context(s:Snapshot){return {workspaceId:s.workspaceId,instanceId:s.instanceId,revision:s.revision,structural:s.validation!.structural,issues:s.validation!.issues}}
export function data(s:Snapshot,p:string){const f=s.files.find(f=>f.path===p);if(!f)fail('OBJECT_NOT_FOUND','知识对象不存在，请重新查询注册表');return parseJson(f.text)}
export function content(s:Snapshot,owner:string,reference:unknown){
  if(typeof reference!=='string')return {available:false,reference};
  const p=path.posix.normalize(path.posix.join(owner,reference.split('#')[0]));
  if(!p.startsWith('.cbim/'))return {available:false,reference,reason:'引用越界'};
  const f=s.files.find(f=>f.path===p);return f?{available:true,...f}:{available:false,reference,path:p,reason:'正文未找到或不属于知识正文类型'};
}
