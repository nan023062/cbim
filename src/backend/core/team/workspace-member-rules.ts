/**
 * 作用定位：岗位登记的规范指纹、预览依据、不可变审计与单条事件投影；由可信服务与 Store 重放共同调用。
 * 设计原因：正文只保存在审计 next 中，当前岗位由原日志派生；哈希函数留在后端模块，公开 schema 不把 crypto 带入前端。
 * 职责边界：核对固定事实与合法迁移，来源选择进入 basis、新代次属于明确能力采纳；不读取知识/profile，不把启用当执行许可。独立引擎变化属于选型编辑，配置刷新仍须明确采纳；旧快照不补字段。
 */
import {hash} from '../foundation/serialization';
import {fail} from '../foundation/errors';
import type {SourceSelection} from '../workspace/knowledge-source';
import {workspaceMemberEngine,workspaceMemberChangeSchema,workspaceMemberSchema,workspaceMemberLimits,type WorkspaceMember,type WorkspaceMemberChange,type WorkspaceMemberCapability,type WorkspaceMemberModelSnapshot,type WorkspaceMemberProposed,type WorkspaceMemberChangeInput,type WorkspaceMemberCommitInput,type WorkspaceMemberReceipt,type WorkspaceRegistryCursor,type WorkspaceMemberField} from './workspace-member';

/** 对象键排序、数组保序；只用于已经过 strict schema 的 JSON 领域值。 */
export function workspaceMemberCanonical(value:unknown):string{
  const order=(item:unknown):unknown=>Array.isArray(item)?item.map(order):item&&typeof item==='object'?Object.fromEntries(Object.entries(item).filter(([,entry])=>entry!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,entry])=>[key,order(entry)])):item;
  return JSON.stringify(order(value));
}
const equal=(a:unknown,b:unknown)=>workspaceMemberCanonical(a)===workspaceMemberCanonical(b);
function valid(condition:unknown,message:string,code='MEMBER_AUDIT'):asserts condition{if(!condition)fail(code,message)}
export const workspaceMemberModelHash=(snapshot:WorkspaceMemberModelSnapshot)=>hash(workspaceMemberCanonical(snapshot));
/** 整库 revision 是出处而不是能力内容；不因其他模块变化要求重新采纳同一能力。 */
export function workspaceMemberCapabilityHash(configuration:WorkspaceMemberCapability){const {knowledgeRevision:_,...content}=configuration;return hash(workspaceMemberCanonical(content))}
export const workspaceMemberHash=(member:WorkspaceMember)=>hash(workspaceMemberCanonical(member));
/** 全工作区幂等命令命名空间；fingerprint 包含原 instance、完整变更和预览/CAS 依据。 */
export function workspaceMemberCommand(request:WorkspaceMemberCommitInput){return {commandId:'workspace-member-'+request.commandId,fingerprint:hash(workspaceMemberCanonical({domain:'workspace-member-v1',request}))}}

/** 只去掉新登记时尚不存在的身份、采纳时间和版本；未选中的配置保持原保存事实。 */
export function workspaceMemberProposed(member:WorkspaceMember):WorkspaceMemberProposed{
  return structuredClone({name:member.name,position:member.position,adaptation:member.adaptation,state:member.state,capability:{configuration:member.adoption.configuration,capabilityHash:member.adoption.capabilityHash,...(member.adoption.sourceRef?{sourceRef:member.adoption.sourceRef}:{})},runtimePolicy:member.runtimePolicy});
}
/** 固定差异字段顺序；能力比较内容 hash，不把整库版本刷新当作岗位语义变化。 */
export function workspaceMemberChangedFields(previous:WorkspaceMember|undefined,proposed:WorkspaceMemberProposed):WorkspaceMemberField[]{
  const fields:WorkspaceMemberField[]=['name','position','adaptation','capability','runtimePolicy','state'];
  if(!previous)return fields;
  const old=workspaceMemberProposed(previous);
  return fields.filter(field=>field==='capability'?old.capability.capabilityHash!==proposed.capability.capabilityHash||!equal(old.capability.sourceRef,proposed.capability.sourceRef):!equal(old[field],proposed[field]));
}
/** 时钟、待生成身份及整库知识 revision 不进入依据；来源代次、定义内容、成员原版本与登记游标仍被冻结。 */
export function workspaceMemberPreviewBasis(input:{workspaceId:string;change:WorkspaceMemberChangeInput;registryCursor:WorkspaceRegistryCursor|null;previousMember?:WorkspaceMember;proposed:WorkspaceMemberProposed;sourceSelection?:SourceSelection}):string{
  const {knowledgeRevision:_,...configuration}=input.proposed.capability.configuration;
  // source 的全库版本也是观察出处；无关知识编辑不能作废同能力预览，事件仍保存完整真实观察。
  const sourceSelection=input.sourceSelection?.kind==='workspace'?{...input.sourceSelection,observation:{definitionHash:input.sourceSelection.observation.definitionHash,visible:input.sourceSelection.observation.visible}}:input.sourceSelection;
  // 新 capture 的随机代次尚不存在，依据固定 selection；其余操作必须把已有 sourceRef 继续纳入摘要。
  return hash(workspaceMemberCanonical({version:1,workspaceId:input.workspaceId,change:input.change,registryCursor:input.registryCursor,previousMemberHash:input.previousMember?workspaceMemberHash(input.previousMember):null,...(sourceSelection?{sourceSelection}:{}),proposedDigest:hash(workspaceMemberCanonical({...input.proposed,capability:{configuration,capabilityHash:input.proposed.capability.capabilityHash,...(!input.sourceSelection&&input.proposed.capability.sourceRef?{sourceRef:input.proposed.capability.sourceRef}:{})}}))}));
}
/** 紧凑回执来自实际事件；后续编辑不重算或覆盖原命令回执。 */
export function workspaceMemberReceipt(change:WorkspaceMemberChange):WorkspaceMemberReceipt{
  const {request,next}=change;
  return {identity:{workspaceId:request.workspaceId,instanceId:request.instanceId},commandId:request.commandId,action:request.change.kind,changeId:change.changeId,memberId:next.memberId,previousRevision:change.previousRevision,memberRevision:next.revision,registryCursor:structuredClone(change.registryCursor),basis:request.expectedBasis,memberHash:workspaceMemberHash(next),committedAt:change.committedAt};
}

/** 结构只包含登记投影，避免 team 规则反向导入调度状态造成类型环。缺省为旧空日志。 */
export interface WorkspaceMemberRegistry {
  workspaceId:string;
  workspaceMembers?:readonly WorkspaceMember[];
  workspaceMemberChanges?:readonly WorkspaceMemberChange[];
  registryCursor?:WorkspaceRegistryCursor|null;
}
/** 严格检查新审计的目标变更；固定身份、原采纳和未选中的配置不允许顺带改变。 */
function validateTransition(previous:WorkspaceMember|undefined,event:WorkspaceMemberChange,history:readonly WorkspaceMemberChange[]){
  const next=event.next,input=event.request.change,proposed=workspaceMemberProposed(next);
  valid(next.adoption.capabilityHash===workspaceMemberCapabilityHash(next.adoption.configuration)&&next.runtimePolicy.configurationHash===workspaceMemberModelHash(next.runtimePolicy.snapshot),'采纳快照与规范内容指纹不一致');
  const freshCapture=()=>valid(next.adoption.capturedAt===event.committedAt&&!history.some(item=>item.next.adoption.captureId===next.adoption.captureId),'新采纳必须使用本次时间和未使用的采集身份');
  if(input.kind==='register'){
    valid(!previous&&event.previousRevision===0&&event.previousMemberHash===null,'首次登记不能覆盖已有岗位');
    valid(next.state==='active'&&next.revision===1&&next.createdAt===event.committedAt,'首次登记必须是本次创建的启用岗位');
    valid(next.adoption.configuration.agentId===input.agentId&&next.name===input.name&&next.position===input.position&&equal(next.adaptation,input.adaptation)&&next.runtimePolicy.profileId===input.runtimePolicy.profileId&&next.runtimePolicy.modelId===input.runtimePolicy.modelId&&next.runtimePolicy.engine===input.runtimePolicy.engine,'首次登记与明确选择不一致');
    freshCapture();return;
  }
  valid(previous,'变更引用的岗位不存在');
  valid(previous.state!=='retired','退休岗位不可修改或复活','MEMBER_RETIRED');
  valid(previous.revision===input.expectedRevision&&event.previousRevision===previous.revision&&event.previousMemberHash===workspaceMemberHash(previous),'岗位版本已变化','MEMBER_REVISION_CONFLICT');
  valid(next.memberId===previous.memberId&&next.workspaceId===previous.workspaceId&&next.createdAt===previous.createdAt&&next.revision===previous.revision+1&&Date.parse(event.committedAt)>=Date.parse(previous.updatedAt),'岗位身份或创建历史不能改变');
  const oldSource=previous.adoption.configuration,newSource=next.adoption.configuration;
  valid(oldSource.agentId===newSource.agentId&&oldSource.teamId===newSource.teamId&&oldSource.source===newSource.source,'已有岗位不能改绑另一能力来源');
  const expected=workspaceMemberProposed(previous);
  if(input.kind==='update'){
    const {runtimePolicy,...patch}=input.patch;Object.assign(expected,patch);
    if(runtimePolicy){
      valid(next.runtimePolicy.profileId===runtimePolicy.profileId&&next.runtimePolicy.modelId===runtimePolicy.modelId&&next.runtimePolicy.engine===runtimePolicy.engine,'编辑模型引用与明确选择不一致');
      valid(runtimePolicy.profileId!==previous.runtimePolicy.profileId||runtimePolicy.modelId!==previous.runtimePolicy.modelId||(workspaceMemberEngine(next.runtimePolicy)??'pi')!==(workspaceMemberEngine(previous.runtimePolicy)??'pi')||equal(next.runtimePolicy,previous.runtimePolicy),'同一模型配置变化须显式采纳','MEMBER_NO_CHANGE');
      expected.runtimePolicy=next.runtimePolicy;
    }
    valid(equal(next.adoption,previous.adoption),'编辑元信息不得顺带采纳能力');
  }else if(input.kind==='state'){
    expected.state=input.nextState;
    valid(equal(next.adoption,previous.adoption),'状态变化不能改写能力采纳');
  }else if(input.target==='capability'){
    expected.capability=proposed.capability;freshCapture();
    valid(next.adoption.capabilityHash!==previous.adoption.capabilityHash||!equal(next.adoption.sourceRef,previous.adoption.sourceRef),'能力内容及来源没有变化','MEMBER_NO_CHANGE');
  }else{
    valid(equal(next.adoption,previous.adoption)&&next.runtimePolicy.profileId===previous.runtimePolicy.profileId&&next.runtimePolicy.modelId===previous.runtimePolicy.modelId&&next.runtimePolicy.engine===previous.runtimePolicy.engine,'模型采纳只能更新原模型引用');
    expected.runtimePolicy=next.runtimePolicy;
  }
  valid(equal(expected,proposed),'审计修改了未被本次操作选定的字段');
  valid(workspaceMemberChangedFields(previous,proposed).length>0,'岗位没有语义变化','MEMBER_NO_CHANGE');
}

/** 仅追加一条严格审计并派生 head；不接收可绕过审计的成员 upsert，也不启动实例。 */
export function applyWorkspaceMemberChange(state:WorkspaceMemberRegistry,raw:WorkspaceMemberChange):{workspaceMembers:WorkspaceMember[];workspaceMemberChanges:WorkspaceMemberChange[];registryCursor:WorkspaceRegistryCursor}{
  const parsed=workspaceMemberChangeSchema.safeParse(raw);valid(parsed.success,'岗位登记审计结构无效');
  const event=raw,members=state.workspaceMembers??[],history=state.workspaceMemberChanges??[],cursor=state.registryCursor??null;
  valid(Array.isArray(members)&&Array.isArray(history)&&new Set(members.map(item=>item.memberId)).size===members.length,'岗位登记投影无效');
  valid(event.request.workspaceId===state.workspaceId&&event.next.workspaceId===state.workspaceId,'岗位不属于当前工作区','MEMBER_IDENTITY');
  valid(equal(event.request.expectedRegistryCursor,cursor),'登记游标已变化','MEMBER_REGISTRY_STALE');
  valid(cursor?event.registryCursor.streamId===cursor.streamId&&event.registryCursor.seq===cursor.seq+1:event.registryCursor.seq===1&&history.length===0&&members.length===0,'登记流或顺序不一致');
  valid(history.length===(cursor?.seq??0),'登记游标缺少完整审计前缀');
  valid(!history.some(item=>item.changeId===event.changeId||item.request.commandId===event.request.commandId),'登记审计或命令身份重复');
  const previous=members.find(item=>item.memberId===event.next.memberId);
  validateTransition(previous,event,history);
  valid(event.request.expectedBasis===workspaceMemberPreviewBasis({workspaceId:state.workspaceId,change:event.request.change,registryCursor:cursor,previousMember:previous,proposed:workspaceMemberProposed(event.next),...(event.sourceSelection?{sourceSelection:event.sourceSelection}:{})}),'预览依据与实际提交不一致','MEMBER_BASIS_STALE');
  valid(members.length+(previous?0:1)<=workspaceMemberLimits.members&&history.length<workspaceMemberLimits.changes,'岗位或审计数量超过上限','MEMBER_LIMIT');
  const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length;
  valid(history.reduce((total,item)=>total+bytes(item),0)+bytes(event)<=workspaceMemberLimits.historyBytes,'岗位审计累计超过容量上限','MEMBER_LIMIT');
  // 不排序，不删除退休岗位；首次登记位置也是分页的稳定顺序。
  const nextMembers=previous?members.map(item=>item.memberId===event.next.memberId?event.next:item):[...members,event.next];
  return {workspaceMembers:nextMembers,workspaceMemberChanges:[...history,event],registryCursor:event.registryCursor};
}

/** 读取详情时可再次检查被持久化的独立快照，绝不据当前来源重写旧采纳。 */
export function validateWorkspaceMember(member:WorkspaceMember):void{
  valid(workspaceMemberSchema.safeParse(member).success&&member.adoption.capabilityHash===workspaceMemberCapabilityHash(member.adoption.configuration)&&member.runtimePolicy.configurationHash===workspaceMemberModelHash(member.runtimePolicy.snapshot),'岗位快照或内容指纹无效');
}
