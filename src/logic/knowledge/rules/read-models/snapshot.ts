/**
 * 目录归属：logic/knowledge/rules/knowledge/read-models；知识快照与领域读模型。
 * 作用定位：已校验知识快照的版本信息、定义读取和受限正文引用解析。
 * 设计原因：团队与业务领域共用只读快照辅助；严格 JSON 解析来自 Foundation，不经知识查询门面反向调用领域模型。
 * 读取边界：本文件属于读取模型内部实现；跨边界正文查询统一从 read-models 导入，不能据此读取或提交磁盘知识。
 */
import path from 'node:path';
import {fail} from '../../../../core/errors';
import {parseJson} from '../../../../core/json';
import type {Snapshot} from '../types';
export function context(s:Snapshot){return {workspaceId:s.workspaceId,instanceId:s.instanceId,revision:s.revision,structural:s.validation!.structural,issues:s.validation!.issues}}
export function data(s:Snapshot,p:string){const f=s.files.find(f=>f.path===p);if(!f)fail('OBJECT_NOT_FOUND','知识对象不存在，请重新查询注册表');return parseJson(f.text)}
export function content(s:Snapshot,owner:string,reference:unknown){
  if(typeof reference!=='string')return {available:false,reference};
  const p=path.posix.normalize(path.posix.join(owner,reference.split('#')[0]));
  if(!p.startsWith('.cbim/'))return {available:false,reference,reason:'引用越界'};
  const f=s.files.find(f=>f.path===p);return f?{available:true,...f}:{available:false,reference,path:p,reason:'正文未找到或不属于知识正文类型'};
}
