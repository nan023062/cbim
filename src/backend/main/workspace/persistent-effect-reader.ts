/**
 * 作用定位：只读原治理命令与责任审计，向影响观察投影有界的“原记录已保存”证据。
 * 设计原因：治理账本借用知识串行队列，责任事件与回执复用唯一 DispatchStore；完整原请求与来源均核实，不从当前保护或负责人倒推旧结果。
 * 职责边界：不调用提交、预览、恢复或初始化；不查询新模型，不把保存当作批准、实施、迁移或交接。正文只参与私有指纹。
 */
import {isDeepStrictEqual} from 'node:util';
import {hash,json} from '../../core/foundation/serialization';
import {fail} from '../../core/foundation/errors';
import {persistentWriteObservationSchema,type PersistentWriteObservation} from '../../core/tasks/persistent-write-observation';
import {persistentWriteIdentity,persistentWriteSourceHash,type PersistentWriteReference} from '../../core/tasks/persistent-write-input';
import {moduleGovernanceObserveInputSchema,moduleGovernanceProposeInputSchema,moduleGovernanceReceiptSchema} from '../../core/governance/module-governance';
import {moduleOwnershipChangeSchema,moduleOwnershipCommitInputSchema,moduleOwnershipReceiptSchema} from '../../core/workspace/module-ownership';
import {moduleOwnershipCommand,moduleOwnershipReceipt} from '../../core/workspace/module-ownership-rules';
import type {DispatchStore} from '../../core/tasks/dispatch-storage';
import {governanceCommandFingerprint,type ModuleGovernanceStore} from '../persistence/governance/module-governance-store';

interface PersistentEffectOwner {
  entry:{id:string};assert():void;dispatchStore:Pick<DispatchStore,'read'|'commandReceipt'>;
  governance:{store:Pick<ModuleGovernanceStore,'find'>};
  /** 仅借同一队列，闭包不取得任何事务写端口。 */
  governed<T>(operation:()=>Promise<T>):Promise<T>;
}
function check(value:unknown):asserts value{if(!value)fail('EFFECT_RECORD_INVALID','原保存记录与调用来源或请求不一致')}

/** 已保存原实例随请求保留，重开读取不换实例重放；停止或存储不可用不能降级为 absent。 */
export async function observePersistentWrite(owner:PersistentEffectOwner,reference:PersistentWriteReference,signal?:AbortSignal):Promise<PersistentWriteObservation>{
  const identity=persistentWriteIdentity(reference),sourceHash=persistentWriteSourceHash(reference),base={identity,sourceHash};
  const alive=()=>{signal?.throwIfAborted();owner.assert()};alive();check(identity.workspaceId===owner.entry.id);
  try{
    let result:PersistentWriteObservation;
    if(reference.kind==='governance')result=await owner.governed(async()=>{
      alive();const command=owner.governance.store.find(identity.commandId);if(!command)return {...base,state:'absent'};
      const receipt=moduleGovernanceReceiptSchema.parse(command.receipt),schema=reference.action==='observe'?moduleGovernanceObserveInputSchema:moduleGovernanceProposeInputSchema;
      const input=schema.parse({...reference.input,workspaceId:identity.workspaceId,instanceId:command.input.instanceId,commandId:identity.commandId});
      check(!command.intent&&receipt.action===reference.action&&isDeepStrictEqual(command.origin,reference.source)&&isDeepStrictEqual(command.input,input)&&receipt.identity.workspaceId===identity.workspaceId&&receipt.identity.instanceId===input.instanceId&&receipt.commandId===identity.commandId);
      check(command.fingerprint===governanceCommandFingerprint(reference.action,input,reference.source));
      check((receipt.action==='observe'||receipt.action==='propose')&&receipt.record.workspaceId===identity.workspaceId&&isDeepStrictEqual(receipt.record.origin,reference.source));
      // 原账本在 init/append 已核整条保护/观察/提案链；这里再把该原命令与当前选择的真实来源绑定。
      const record=receipt.action==='observe'?{kind:'observation' as const,recordId:receipt.record.observationId,recordedAt:receipt.record.observedAt}:{kind:'proposal' as const,recordId:receipt.record.proposalId,recordedAt:receipt.record.createdAt};
      return {...base,state:'recorded',requestHash:command.fingerprint,evidenceHash:hash(json(command)),record:{...record,instanceId:input.instanceId}};
    });
    else{
      const state=await owner.dispatchStore.read();alive();check(state.workspaceId===identity.workspaceId);
      const changes=state.ownershipChanges?.filter(change=>change.request.commandId===identity.commandId)??[];
      const command=await owner.dispatchStore.commandReceipt('module-ownership-'+identity.commandId);alive();
      if(!command&&!changes.length)result={...base,state:'absent'};
      else{
        check(command&&changes.length===1);const change=moduleOwnershipChangeSchema.parse(changes[0]),receipt=moduleOwnershipReceiptSchema.parse(command.receipt);
        const input=moduleOwnershipCommitInputSchema.parse({...reference.input,workspaceId:identity.workspaceId,instanceId:change.request.instanceId,commandId:identity.commandId});
        check(isDeepStrictEqual(change.request,input)&&isDeepStrictEqual(change.actor,reference.source)&&command.fingerprint===moduleOwnershipCommand(input,reference.source).fingerprint&&isDeepStrictEqual(receipt,moduleOwnershipReceipt(change)));
        result={...base,state:'recorded',requestHash:command.fingerprint,evidenceHash:hash(json({change,command})),record:{kind:'ownership',recordId:change.changeId,instanceId:input.instanceId,recordedAt:change.committedAt,action:receipt.action,revision:receipt.revision}};
      }
    }
    alive();return persistentWriteObservationSchema.parse(result);
  }catch{alive();return persistentWriteObservationSchema.parse({...base,state:'unverifiable',reason:'original_record_unverifiable'})}
}
