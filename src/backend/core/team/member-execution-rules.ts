/**
 * 作用定位：从同一岗位、责任与来源登记快照核实执行选择，供调度和存储共用。
 * 设计原因：通用 mutation 也必须匹配当前登记；外部知识正文与公开模型配置仍由上层持锁读取，纯规则不伪造这些观察。
 */
import {fail} from '../foundation/errors';
import type {WorkspaceMember} from './workspace-member';
import {workspaceMemberHash,workspaceMemberCapabilityHash,workspaceMemberModelHash,workspaceMemberCanonical} from './workspace-member-rules';
import type {ModuleOwnership} from '../workspace/module-ownership';
import {currentKnowledgeSource,knowledgeSourcePending,knowledgeSourceRef,type KnowledgeSourceRegistry} from '../workspace/knowledge-source-rules';
import {ownerExecutionBindingSchema,ownerExecutionSelectionSchema,ownerExecutionSelectionFor,type OwnerExecutionSelection,type OwnerExecutionBinding} from './member-execution-binding';
import {implicitModuleOwner} from './implicit-module-owner';

export interface OwnerExecutionRegistry extends KnowledgeSourceRegistry {workspaceMembers?:readonly WorkspaceMember[];moduleOwnerships?:readonly ModuleOwnership[]}
function check(value:unknown,code:string,message:string):asserts value{if(!value)fail(code,message)}
const equal=(a:unknown,b:unknown)=>workspaceMemberCanonical(a)===workspaceMemberCanonical(b);
/** 只重建本次精确模块的冻结身份；调用方须另外核同知识快照能力及同模型队列公开配置。 */
export function resolveOwnerExecutionSelection(state:OwnerExecutionRegistry,raw:OwnerExecutionSelection,moduleIds:readonly string[]):OwnerExecutionBinding{
  const parsed=ownerExecutionSelectionSchema.safeParse(raw);check(parsed.success,'OWNER_SELECTION_INVALID','负责人执行选择无效');const selection=parsed.data;
  check(moduleIds.length>0&&moduleIds.length<=50&&new Set(moduleIds).size===moduleIds.length&&selection.expectedOwners.length===moduleIds.length&&moduleIds.every(id=>selection.expectedOwners.some(owner=>owner.moduleId===id)),'OWNER_MODULES_INVALID','负责人选择必须精确覆盖本次模块');
  check(!knowledgeSourcePending(state),'SOURCE_PENDING','知识来源仍待核实，不能授予新的业务执行许可');
  const member=state.workspaceMembers?.find(value=>value.memberId===selection.memberId);
  check(member&&member.workspaceId===state.workspaceId&&member.state==='active','OWNER_MEMBER_UNAVAILABLE','负责岗位缺失、暂停或已退休');
  check(member.revision===selection.expectedMemberRevision&&member.adoption.capabilityHash===selection.expectedCapabilityHash&&member.runtimePolicy.configurationHash===selection.expectedConfigurationHash,'OWNER_SELECTION_STALE','岗位、能力或模型已变化，请重新查询并规划');
  check(workspaceMemberCapabilityHash(member.adoption.configuration)===member.adoption.capabilityHash&&workspaceMemberModelHash(member.runtimePolicy.snapshot)===member.runtimePolicy.configurationHash,'OWNER_BINDING_INVALID','岗位采纳快照指纹不一致');
  const ref=member.adoption.sourceRef;check(ref,'OWNER_SOURCE_UNADOPTED','负责岗位尚未明确采纳能力来源');
  if('kind' in ref)check(ref.id==='cbim:executor'&&ref.contentHash===member.adoption.capabilityHash,'OWNER_SOURCE_STALE','内置能力来源不一致');
  else {const current=currentKnowledgeSource(state,{kind:'agent',sourceId:member.adoption.configuration.agentId});check(current&&equal(knowledgeSourceRef(current),ref),'OWNER_SOURCE_STALE','岗位能力来源已失效或被替换');}
  const owners=moduleIds.map(moduleId=>{
    const expected=selection.expectedOwners.find(owner=>owner.moduleId===moduleId)!,owner=implicitModuleOwner(state.moduleOwnerships,moduleId);
    const current=currentKnowledgeSource(state,{kind:'module',sourceId:moduleId});
    if(expected.match){
      check(!owner,'OWNER_SELECTION_STALE','模块已有显式或父级负责人，不能沿用模型匹配');
      check(current&&equal(knowledgeSourceRef(current),expected.match.sourceRef),'OWNER_SOURCE_STALE','模型匹配的模块来源已变化，请重新读取分析');
      return {...expected,sourceRef:structuredClone(expected.match.sourceRef)};
    }
    check(owner&&owner.workspaceId===state.workspaceId&&owner.ownerMemberId===member.memberId,'OWNER_UNASSIGNED','模块没有所选岗位的明确负责人');
    check((owner.moduleId===moduleId?undefined:owner.moduleId)===expected.inheritedFrom,'OWNER_SELECTION_STALE','最近父级负责人已变化，请重新查询并规划');
    check(owner.bindingId===expected.bindingId&&owner.revision===expected.revision&&owner.ownerMemberId===expected.ownerMemberId,'OWNER_SELECTION_STALE','模块责任已变化，请重新查询并规划');
    const ownerSource=currentKnowledgeSource(state,{kind:'module',sourceId:owner.moduleId});check(owner.sourceRef&&ownerSource&&equal(knowledgeSourceRef(ownerSource),owner.sourceRef)&&current,'OWNER_SOURCE_STALE','模块或父级责任尚未采纳当前来源');
    return {...expected,sourceRef:structuredClone(knowledgeSourceRef(current))};
  });
  return ownerExecutionBindingSchema.parse({version:1,workspaceId:state.workspaceId,memberId:member.memberId,memberRevision:member.revision,memberHash:workspaceMemberHash(member),capability:{agentId:member.adoption.configuration.agentId,teamId:member.adoption.configuration.teamId,captureId:member.adoption.captureId,capabilityHash:member.adoption.capabilityHash,sourceRef:structuredClone(ref)},model:{profileId:member.runtimePolicy.profileId,modelId:member.runtimePolicy.modelId,configurationHash:member.runtimePolicy.configurationHash},owners});
}
/** 只用于新计划/派发/领取/预约；历史结果与既有运行结算不能用当前负责人反向否定。 */
export function assertCurrentOwnerExecutionBinding(state:OwnerExecutionRegistry,binding:OwnerExecutionBinding,moduleIds:readonly string[]):void{
  check(ownerExecutionBindingSchema.safeParse(binding).success,'OWNER_BINDING_INVALID','执行负责人绑定无效');const current=resolveOwnerExecutionSelection(state,ownerExecutionSelectionFor(binding),moduleIds);
  check(equal({...current,owners:[...current.owners].sort((a,b)=>a.moduleId.localeCompare(b.moduleId))},{...binding,owners:[...binding.owners].sort((a,b)=>a.moduleId.localeCompare(b.moduleId))}),'OWNER_BINDING_STALE','原执行负责人与当前登记不一致，不能改写原绑定后继续执行');
}
