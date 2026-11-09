/**
 * 作用定位：后端从可信主 canonical 与唯一周期重建三项持久写命令的原查询引用。
 * 设计原因：复用实际工具的严格参数与命令算法；身份由读取服务核实，模型和页面不能提供 actor 或 commandId。
 * 职责边界：只生成原引用，不写入、不补造原工作区实例；旧实例仅从匹配的持久命令核实。
 */
import {hash,json} from '../foundation/serialization';
import {governanceObserveInputSchema,governanceProposeInputSchema,type GovernanceObserveInput,type GovernanceProposeInput} from '../governance/module-governance-tools';
import {moduleGovernanceMainOriginSchema,type ModuleGovernanceMainOrigin} from '../governance/module-governance';
import {moduleGovernanceMainCommandId} from '../governance/module-governance-rules';
import {moduleOwnerCommitInputSchema,type ModuleOwnerCommitInput} from '../workspace/module-ownership-tools';
import {moduleOwnershipMainActorSchema,type ModuleOwnershipMainActor} from '../workspace/module-ownership';
import {moduleOwnershipMainCommandId} from '../workspace/module-ownership-rules';
import {persistentWriteIdentitySchema} from './persistent-write-observation';

export interface PersistentMainSource {workspaceId:string;rootSessionId:string;scopeId:string;agentInstanceId:string;agentSessionId:string;runId:string;toolCallId:string}
export type PersistentWriteReference=
  |{kind:'governance';action:'observe';workspaceId:string;source:ModuleGovernanceMainOrigin;input:GovernanceObserveInput}
  |{kind:'governance';action:'propose';workspaceId:string;source:ModuleGovernanceMainOrigin;input:GovernanceProposeInput}
  |{kind:'ownership';workspaceId:string;source:ModuleOwnershipMainActor;input:ModuleOwnerCommitInput};

/** 调用前已核 canonical、授权与唯一 scope；旧参数不严格匹配则无适配，不纠正或剥离未知字段。 */
export function originalPersistentWrite(name:string,raw:unknown,binding:PersistentMainSource):PersistentWriteReference|undefined{
  try{
    const {workspaceId,scopeId,...main}=binding;
    if(name==='cbim_governance_observe'||name==='cbim_governance_propose'){
      const source=moduleGovernanceMainOriginSchema.parse({kind:'main_agent',...main,toolName:name});
      const reference:PersistentWriteReference=name==='cbim_governance_observe'?{kind:'governance',action:'observe',workspaceId,source,input:governanceObserveInputSchema.parse(raw)}:{kind:'governance',action:'propose',workspaceId,source,input:governanceProposeInputSchema.parse(raw)};
      persistentWriteIdentity(reference);return reference;
    }
    if(name==='cbim_module_owner_change_commit'){
      const reference:PersistentWriteReference={kind:'ownership',workspaceId,source:moduleOwnershipMainActorSchema.parse({kind:'main_agent',...main,scopeId,toolName:name}),input:moduleOwnerCommitInputSchema.parse(raw)};
      persistentWriteIdentity(reference);return reference;
    }
  }catch{return undefined}
}
/** 稳定原命令不含当前实例；完整来源与输入另入 sourceHash，避免同 ID 异参冒领。 */
export function persistentWriteIdentity(reference:PersistentWriteReference){
  const {workspaceId,source}=reference;
  return persistentWriteIdentitySchema.parse({workspaceId,rootSessionId:source.rootSessionId,runId:source.runId,toolCallId:source.toolCallId,toolName:source.toolName,commandId:reference.kind==='governance'?moduleGovernanceMainCommandId(workspaceId,reference.source):moduleOwnershipMainCommandId(workspaceId,reference.source)});
}
/** 同一命令算法之外另核原参数及完整主来源，不返回其中正文或权限。 */
export function persistentWriteSourceHash(reference:PersistentWriteReference){return hash(json(reference))}
