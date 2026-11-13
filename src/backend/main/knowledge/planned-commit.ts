/**
 * 目录归属：backend/main/knowledge；知识物理事务与恢复。
 * 作用定位：从固定私有缓存读取对象及资源包计划，向知识事务提供原请求与经过核实的不可变语义。
 * 设计原因：模型只可引用 planId；完整替换范围不能由公共 ChangeRequest 或可变回执缓存注入。旧计划仅可用于查询原成功 journal。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {fail} from '../../../core/errors';
import {hash,json} from '../../../core/platform/node/serialization';
import {checkedKnowledgePlan,plannedRequestSchema,type KnowledgePlanRef,type PlannedKnowledgeCommit} from '../../../logic/knowledge/rules/planned-commit';
import type {StoragePaths} from '../../../logic/workspace/ports/paths';
import type {ChangeRequest} from '../../../logic/knowledge/rules/types';

/** 返回旧请求不赋予新提交权；调用方必须先查原 journal，缺少 v2 计划时拒绝新的写入。 */
export async function readKnowledgePlan(owner:{entry:{id:string};paths:StoragePaths},ref:KnowledgePlanRef):Promise<{request:ChangeRequest;plan?:PlannedKnowledgeCommit}>{
  if(!z.string().uuid().safeParse(ref.planId).success||!['object_plan','package_plan'].includes(ref.kind))fail('SOURCE_PLAN_INVALID','知识计划标识无效');
  const file=path.join(owner.paths.local(owner.entry.id,'cache'),ref.kind==='object_plan'?'object-plans':'resource-imports',ref.planId+'.json');
  let raw:Record<string,unknown>;try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)fail('SOURCE_PLAN_INVALID','知识计划文件无效或超过容量');raw=JSON.parse(await fs.readFile(file,'utf8'))}catch{fail('SOURCE_PLAN_INVALID','原知识计划不存在或损坏，请重新预览')}
  const parsed=plannedRequestSchema.safeParse(raw.request);if(!parsed.success||parsed.data.workspaceId!==owner.entry.id||parsed.data.requestId!==ref.planId)fail('SOURCE_PLAN_INVALID','知识计划身份不一致');
  const request=raw.request as ChangeRequest;
  if(ref.kind==='object_plan'){
    if(raw.version!==2){if(raw.hash!==hash(json(request))||!Array.isArray(raw.deletedRoots)||raw.deletedRoots.some(x=>typeof x!=='string')||Object.keys(raw).some(k=>!['request','hash','deletedRoots'].includes(k)))fail('SOURCE_PLAN_INVALID','旧对象计划不完整');return {request}}
    return {request,plan:checkedKnowledgePlan(ref.kind,raw)};
  }
  const {fingerprint,...body}=raw;
  if(fingerprint!==hash(json(body)))fail('SOURCE_PLAN_INVALID','资源计划缓存指纹不一致');
  if(Object.keys(raw).some(k=>!['version','request','source','createdRoots','deletedRoots','fingerprint','committed','reindexRequest','result','kind','mode','targetRoot','planHash'].includes(k)))fail('SOURCE_PLAN_INVALID','资源计划包含未知字段');
  if(raw.version!==2)return {request};
  const {committed:_,reindexRequest:__,result:___,...immutable}=body;
  return {request,plan:checkedKnowledgePlan(ref.kind,immutable)};
}
