/**
 * 作用定位：负责人登记的规范依据、命令指纹、不可变审计与关系头投影，供 Main 与 Store 重放共同调用。
 * 设计原因：关系不写业务定义，独立版本不混岗位游标；实际来源读取与运行身份由上层可信闭包和 tasks 门禁核验。
 * 职责边界：纯规则不访问知识、网络或模型，也不把来源观察和责任保存当成实际派发切换。
 */
import {createHash} from 'node:crypto';
import {hash} from '../foundation/serialization';
import {fail} from '../foundation/errors';
import {workspaceMemberCanonical} from '../team/workspace-member-rules';
import {summarizeWorkspaceMember,type WorkspaceMember,type WorkspaceMemberSummary} from '../team/workspace-member';
import {moduleOwnershipChangeSchema,moduleOwnershipMainActorSchema,moduleOwnershipLimits,type ModuleOwnership,type ModuleOwnershipActor,type ModuleOwnershipChange,type ModuleOwnershipChangeInput,type ModuleOwnershipCommitInput,type ModuleOwnershipCursor,type ModuleOwnershipImpact,type ModuleOwnershipMainActor,type ModuleOwnershipReceipt,type ObservedModule} from './module-ownership';

/** 后端规范 JSON：对象键排序、数组保序，不将公开 DTO 引入 Node 依赖。 */
export const moduleOwnershipCanonical=workspaceMemberCanonical;
const equal=(a:unknown,b:unknown)=>moduleOwnershipCanonical(a)===moduleOwnershipCanonical(b);
function check(condition:unknown,code:string,message:string):asserts condition{if(!condition)fail(code,message)}
export const moduleOwnershipHash=(value:ModuleOwnership)=>hash(moduleOwnershipCanonical(value));

/** 只取可信运行闭包；同一次调用的稳定命令不含可变化的工作区实例、时钟或随机重试 ID。 */
export function moduleOwnershipMainCommandId(workspaceId:string,actor:ModuleOwnershipMainActor):string{
  const source=moduleOwnershipMainActorSchema.parse(actor);
  check(typeof workspaceId==='string'&&!!workspaceId.trim()&&workspaceId.length<=512,'OWNERSHIP_IDENTITY','责任操作缺少工作区身份');
  const bytes=createHash('sha1').update(Buffer.from('2d79bb144cea5bcabec29ca72046e75d','hex')).update(moduleOwnershipCanonical({workspaceId,source})).digest().subarray(0,16);
  bytes[6]=(bytes[6]&0x0f)|0x50;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
/** 全工作区命令命名空间；请求与真实来源都进入指纹，桌面与模型不能互换同一命令。 */
export function moduleOwnershipCommand(request:ModuleOwnershipCommitInput,actor:ModuleOwnershipActor){return {commandId:'module-ownership-'+request.commandId,fingerprint:hash(moduleOwnershipCanonical({domain:'module-ownership-v1',request,actor}))}}

export interface ModuleOwnershipBasisFacts {
  workspaceId:string;change:ModuleOwnershipChangeInput;ownershipCursor:ModuleOwnershipCursor|null;
  previous:ModuleOwnership|null;previousOwner?:WorkspaceMemberSummary;nextOwner?:WorkspaceMemberSummary;
  observedModule?:ObservedModule;impact:ModuleOwnershipImpact;
}
/** 新观察的时钟不进入依据；原关系、明确选择、岗位版本、知识与实际任务影响均须一致。 */
export function moduleOwnershipBasis(facts:ModuleOwnershipBasisFacts):string{
  const {previous,observedModule,...rest}=facts;
  return hash(moduleOwnershipCanonical({version:1,...rest,previousBindingHash:previous?moduleOwnershipHash(previous):null,...(observedModule?{observedModule:{knowledgeRevision:observedModule.knowledgeRevision,definitionHash:observedModule.definitionHash}}:{})}));
}
/** 回执仅描述原审计，不按当前岗位名称、关系头或权限重新生成历史结果。 */
export function moduleOwnershipReceipt(event:ModuleOwnershipChange):ModuleOwnershipReceipt{
  const {request,next}=event,previousOwnerMemberId=request.change.expectedBinding?.ownerMemberId??null;
  return {identity:{workspaceId:request.workspaceId,instanceId:request.instanceId},commandId:request.commandId,action:next.ownerMemberId===null?'unassign':previousOwnerMemberId===null?'assign':'replace',actor:structuredClone(event.actor),changeId:event.changeId,moduleId:next.moduleId,bindingId:next.bindingId,previousRevision:event.previousRevision,revision:next.revision,previousOwnerMemberId,ownerMemberId:next.ownerMemberId,ownershipCursor:structuredClone(event.ownershipCursor),basis:request.expectedBasis,bindingHash:moduleOwnershipHash(next),committedAt:event.committedAt};
}

/** 结构化窄端口不导入 DispatchState，避免 workspace 与 tasks 产生类型环。 */
export interface ModuleOwnershipRegistry {
  workspaceId:string;workspaceMembers?:readonly WorkspaceMember[];
  moduleOwnerships?:readonly ModuleOwnership[];ownershipChanges?:readonly ModuleOwnershipChange[];ownershipCursor?:ModuleOwnershipCursor|null;
}
/** 单条追加，impact 必须由调用方从同事务前态真实任务计算；运行 actor 另由 tasks 层核对。 */
export function applyModuleOwnershipChange(state:ModuleOwnershipRegistry,raw:ModuleOwnershipChange,impact:ModuleOwnershipImpact):{moduleOwnerships:ModuleOwnership[];ownershipChanges:ModuleOwnershipChange[];ownershipCursor:ModuleOwnershipCursor}{
  const valid=moduleOwnershipChangeSchema.safeParse(raw);check(valid.success,'OWNERSHIP_AUDIT','责任审计结构无效');
  const event=raw,request=event.request,input=request.change,next=event.next;
  const heads=state.moduleOwnerships??[],history=state.ownershipChanges??[],cursor=state.ownershipCursor??null,members=state.workspaceMembers??[];
  check(request.workspaceId===state.workspaceId,'OWNERSHIP_IDENTITY','责任操作不属于本工作区');
  check(equal(request.expectedOwnershipCursor,cursor),'OWNERSHIP_REGISTRY_STALE','责任登记游标已变化');
  check(history.length===(cursor?.seq??0)&&(cursor?event.ownershipCursor.streamId===cursor.streamId&&event.ownershipCursor.seq===cursor.seq+1:event.ownershipCursor.seq===1&&heads.length===0),'OWNERSHIP_AUDIT','责任审计流或前缀不一致');
  check(new Set(heads.map(item=>item.moduleId)).size===heads.length&&new Set(heads.map(item=>item.bindingId)).size===heads.length,'OWNERSHIP_AUDIT','责任头重复');
  check(!history.some(item=>item.changeId===event.changeId||item.request.commandId===request.commandId),'OWNERSHIP_AUDIT','责任变更或命令身份重复');
  if(event.actor.kind==='main_agent')check(request.commandId===moduleOwnershipMainCommandId(state.workspaceId,event.actor),'OWNERSHIP_ACTOR','主工具原命令与真实来源不一致');
  const previous=heads.find(item=>item.moduleId===input.moduleId)??null,expected=input.expectedBinding;
  check(previous?expected&&expected.bindingId===previous.bindingId&&expected.revision===previous.revision&&expected.ownerMemberId===previous.ownerMemberId:expected===null,'OWNERSHIP_BINDING_STALE','原负责人关系已变化');
  check(event.previousRevision===(previous?.revision??0)&&event.previousBindingHash===(previous?moduleOwnershipHash(previous):null),'OWNERSHIP_AUDIT','责任原版本或指纹不一致');
  check(previous?next.bindingId===previous.bindingId&&next.createdAt===previous.createdAt&&Date.parse(next.updatedAt)>=Date.parse(previous.updatedAt):next.createdAt===event.committedAt&&!heads.some(item=>item.bindingId===next.bindingId),'OWNERSHIP_AUDIT','责任身份、创建时间或历史被改写');
  const previousOwner=previous?.ownerMemberId?members.find(member=>member.memberId===previous.ownerMemberId):undefined,nextOwner=input.nextOwner?members.find(member=>member.memberId===input.nextOwner!.memberId):undefined;
  if(input.nextOwner){
    check(nextOwner&&nextOwner.workspaceId===state.workspaceId,'OWNERSHIP_MEMBER_CHANGED','明确目标岗位不存在或不属于工作区');
    check(nextOwner.revision===input.nextOwner.expectedRevision,'OWNERSHIP_MEMBER_CHANGED','目标岗位版本已变化');
    check(nextOwner.state==='active','OWNERSHIP_MEMBER_UNAVAILABLE','只有启用岗位可以作为新负责人');
  }else check(previous&&equal(next.observedModule,previous.observedModule),'OWNERSHIP_AUDIT','解除必须保留原模块观察，不伪造新来源');
  check(equal(event.impact,impact),'OWNERSHIP_BASIS_STALE','相关任务影响已经变化');
  const basis=moduleOwnershipBasis({workspaceId:state.workspaceId,change:input,ownershipCursor:cursor,previous,...(previousOwner?{previousOwner:summarizeWorkspaceMember(previousOwner)}:{}),...(nextOwner?{nextOwner:summarizeWorkspaceMember(nextOwner),observedModule:next.observedModule}:{}),impact});
  check(basis===request.expectedBasis,'OWNERSHIP_BASIS_STALE','责任预览与实际提交依据不一致');
  check(heads.length+(previous?0:1)<=moduleOwnershipLimits.bindings&&history.length<moduleOwnershipLimits.changes,'OWNERSHIP_LIMIT','责任关系或审计数量超过上限');
  const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length;
  check(history.reduce((sum,item)=>sum+bytes(item),0)+bytes(event)<=moduleOwnershipLimits.historyBytes,'OWNERSHIP_LIMIT','责任审计累计超过容量上限');
  return {moduleOwnerships:previous?heads.map(item=>item.bindingId===next.bindingId?next:item):[...heads,next],ownershipChanges:[...history,event],ownershipCursor:event.ownershipCursor};
}
