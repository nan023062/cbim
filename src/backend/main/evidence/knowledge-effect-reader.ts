/**
 * 目录归属：backend/main/evidence；跨域持久事实读取。
 * 作用定位：在已打开工作区内只读核实原知识工具请求和事务，向调度影响观察提供有界摘要。
 * 设计原因：完整 journal 校验复用唯一知识串行队列，原对象计划只从固定私有缓存加载；不把工具失败当作事务回滚，也不借当前实例补造历史请求。
 * 职责边界：不提交知识、不刷新索引、不修剪目录、不恢复事务或创建另一个 Store；前后正文仅参与私有摘要，不进入公开报告。
 */
import {hash,json} from '../../core/foundation/serialization';
import {fail} from '../../core/foundation/errors';
import type {StoragePaths} from '../../core/foundation/paths';
import type {ChangeRequest} from '../../core/knowledge/types';
import {knowledgeTransactionObservationSchema,type KnowledgeTransactionObservation} from '../../core/knowledge/knowledge-write-observation';
import {originalKnowledgeIdentity,type KnowledgeWriteReference} from '../../core/knowledge/knowledge-write-input';
import type {KnowledgeGovernanceTransaction} from '../knowledge/governance-port';
import {readKnowledgePlan} from '../knowledge/planned-commit';

interface KnowledgeEffectOwner {
  entry:{id:string};paths:StoragePaths;assert():void;
  /** 只借用同一知识队列的 journal 读取，不获取 apply 或 preview 能力。 */
  governed<T>(operation:(transaction:Pick<KnowledgeGovernanceTransaction,'journal'>)=>Promise<T>):Promise<T>;
}
/** 原实例只参与比对，允许重开后读取原阶段；停止或关闭中断查询，不自动推进任何持久状态。 */
export async function observeKnowledgeTransaction(owner:KnowledgeEffectOwner,reference:KnowledgeWriteReference,signal?:AbortSignal):Promise<KnowledgeTransactionObservation>{
  const identity=originalKnowledgeIdentity(reference),alive=()=>{signal?.throwIfAborted();owner.assert()};
  alive();if(identity.workspaceId!==owner.entry.id)fail('EFFECT_IDENTITY','原知识请求不属于当前工作区');
  return owner.governed(async transaction=>{
    alive();let request:ChangeRequest;
    if(reference.kind==='request')request=reference.request;
    else{
      try{
        const loaded=await readKnowledgePlan(owner,{kind:'object_plan',planId:reference.planId});
        if(loaded.request.workspaceId!==identity.workspaceId||loaded.request.instanceId!==identity.instanceId||loaded.request.requestId!==identity.requestId)throw Error('Original knowledge plan identity mismatch');
        request=loaded.request;
      }catch{alive();return knowledgeTransactionObservationSchema.parse({identity,state:'unverifiable',reason:'original_plan_unavailable'})}
    }
    alive();const requestHash=hash(json(request));let observation:KnowledgeTransactionObservation;
    try{
      const status=await transaction.journal(request);
      observation=knowledgeTransactionObservationSchema.parse(status?{identity,state:status.state,requestHash,evidenceHash:hash(json(status)),...(status.state==='committed'?{revision:status.result?.revision,changedCount:status.result?.changed.length}:{})}:{identity,state:'absent',requestHash});
    }catch{observation=knowledgeTransactionObservationSchema.parse({identity,state:'unverifiable',requestHash,reason:'original_record_unverifiable'})}
    alive();return observation;
  });
}
