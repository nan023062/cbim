/**
 * 目录归属：backend/main/registry；岗位、责任与来源协调。
 * 作用定位：桌面与真实主工具共用的模块负责人服务，关系和岗位在唯一 DispatchStore 内裁决。
 * 设计原因：责任登记与业务派发分离；来源引用只消费真实来源日志，旧记录不按路径或相同指纹补造代次。采纳固定知识串行快照后进入 Store；列表依据包含来源游标，防同字节重建混页。
 * 恢复边界：原命令先查不可变回执，未找到才核当前实例和来源；保存后不重新执行、不撤回，解除允许来源缺失。
 * 读取边界：模块读取经 knowledge/read-models 的公开入口，责任裁决和提交仍由本服务及原 Store 事务拥有。
 */
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {fail} from '../../core/foundation/errors';
import {hash} from '../../core/foundation/serialization';
import type {Snapshot} from '../../core/knowledge/types';
import {BusinessWorkspace} from '../../core/knowledge/read-models';
import type {DispatchState,DispatchStore} from '../../core/dispatch/dispatch-storage';
import {summarizeWorkspaceMember} from '../../core/team/workspace-member';
import {
  moduleOwnershipActorSchema,moduleOwnershipByMemberInputSchema,moduleOwnershipCommitInputSchema,moduleOwnershipDetailSchema,
  moduleOwnershipGetInputSchema,moduleOwnershipListInputSchema,moduleOwnershipLookupSchema,moduleOwnershipPageSchema,
  moduleOwnershipPreviewInputSchema,moduleOwnershipPreviewSchema,moduleOwnershipReceiptSchema,summarizeModuleOwnershipChange,isModuleOwnershipSourceAdoption,
  type ModuleOwnership,type ModuleOwnershipActor,type ModuleOwnershipChange,type ModuleOwnershipIdentity,
  type ModuleOwnershipPreview,type ModuleOwnershipPreviewInput,type ModuleOwnershipReadBasis,type ModuleOwnershipReceipt,
  type ModuleOwnershipView,type ObservedModule,
} from '../../core/workspace/module-ownership';
import {assertModuleOwnershipExpectedBinding,moduleOwnershipBasis,moduleOwnershipCommand,moduleOwnershipHash,moduleOwnershipReceipt} from '../../core/workspace/module-ownership-rules';
import {checkModuleOwnershipActor,moduleOwnershipImpact} from '../../core/tasks/module-ownership-invariants';
import type {KnowledgeSourceWorkspace} from './knowledge-sources';
import {knowledgeSourcePending} from '../../core/workspace/knowledge-source-rules';

function input<S extends z.ZodTypeAny>(schema:S,raw:unknown):z.output<S>{const result=schema.safeParse(raw);if(!result.success)fail('OWNERSHIP_INPUT','责任请求不完整或包含不支持的字段');return result.data}
type Knowledge={snapshot?:Snapshot;visible:Map<string,{name:string;summary:string}>;issue?:'invalid'|'unavailable'};

/** 无执行器和模型端口；写入只追加单条责任审计，不改变知识、任务或默认执行者。 */
export class ModuleOwnerships {
  constructor(private readonly owner:KnowledgeSourceWorkspace,private readonly store:DispatchStore,private readonly isCurrent:()=>boolean=()=>true){}
  private identity(){return {workspaceId:this.owner.entry.id,instanceId:this.owner.instanceId}}
  private assert(identity:ModuleOwnershipIdentity){
    if(identity.workspaceId!==this.owner.entry.id||identity.instanceId!==this.owner.instanceId)fail('OWNERSHIP_IDENTITY','工作区实例已变化，请重新读取责任关系');
    this.owner.assert(identity);if(!this.isCurrent())fail('OWNERSHIP_UNAVAILABLE','工作区正在关闭，未接受新的责任变更');
  }
  private workspace(id:string){if(id!==this.owner.entry.id)fail('OWNERSHIP_IDENTITY','责任记录不属于当前工作区')}
  private cursor(state:DispatchState){return state.ownershipCursor??null}
  private basis(state:DispatchState,knowledge:Knowledge):ModuleOwnershipReadBasis{return {ownershipCursor:this.cursor(state),memberRegistryCursor:state.registryCursor??null,knowledgeRevision:knowledge.snapshot?.revision??null,sourceCursor:state.sourceCursor??null}}
  private async knowledge(fixed?:Snapshot):Promise<Knowledge>{
    let snapshot:Snapshot;try{snapshot=fixed??await this.owner.snapshot()}catch{return {visible:new Map(),issue:'unavailable'}}
    if(snapshot.workspaceId!==this.owner.entry.id||!snapshot.validation?.structural)return {snapshot,visible:new Map(),issue:'invalid'};
    try{
      const modules=(await new BusinessWorkspace(snapshot).modules()).modules as Array<{id:string;summary:string}>;
      // 派生注册表只含 id/summary；显示名称来自同一已校验树，不能假定索引有 name 或用 ID 补造名称。
      if(!Array.isArray(modules)||modules.some(item=>typeof item.id!=='string'||typeof item.summary!=='string'||typeof snapshot.validation!.tree.nodes[item.id]?.name!=='string'))throw Error('invalid registry');
      return {snapshot,visible:new Map(modules.map(item=>[item.id,{name:snapshot.validation!.tree.nodes[item.id].name,summary:item.summary}]))};
    }catch{return {snapshot,visible:new Map(),issue:'invalid'}}
  }
  private observed(knowledge:Knowledge,moduleId:string):ObservedModule|undefined{
    if(knowledge.issue||!knowledge.visible.has(moduleId))return;
    const file=knowledge.snapshot!.files.find(item=>item.path===moduleId+'/module.json');
    if(!file||file.hash!==hash(file.text))return;
    return {knowledgeRevision:knowledge.snapshot!.revision,definitionHash:file.hash,observedAt:new Date().toISOString()};
  }
  private view(state:DispatchState,knowledge:Knowledge,moduleId:string):ModuleOwnershipView{
    const binding=state.moduleOwnerships?.find(item=>item.moduleId===moduleId)??null,member=binding?.ownerMemberId?state.workspaceMembers?.find(item=>item.memberId===binding.ownerMemberId):undefined;
    const observed=this.observed(knowledge,moduleId),module=knowledge.visible.get(moduleId);
    const source:ModuleOwnershipView['source']=observed?{status:binding?(observed.definitionHash===binding.observedModule.definitionHash?'same':'changed'):'observed',knowledgeRevision:observed.knowledgeRevision,definitionHash:observed.definitionHash}
      :{status:knowledge.issue??(module?'invalid':'missing'),issue:knowledge.issue==='unavailable'?'当前知识无法读取；保留原责任记录':knowledge.issue==='invalid'||module?'当前模块知识未通过结构校验':'模块缺失或不在当前可见注册表；不自动解除责任'};
    const pending=knowledgeSourcePending(state),sourceStatus=pending?{status:'pending' as const,transitionId:pending.transitionId}:knowledge.snapshot?this.owner.sources!.status(state,knowledge.snapshot,{kind:'module',sourceId:moduleId},binding?.sourceRef):{status:'unverifiable' as const,issue:'当前知识无法核实来源'};
    return {moduleId,...(module?{module}:{}),binding,...(member?{owner:summarizeWorkspaceMember(member)}:{}),status:!binding?.ownerMemberId?'unassigned':!member?'owner_missing':member.state==='active'?'assigned':member.state==='suspended'?'owner_suspended':'owner_retired',source,sourceStatus};
  }
  /** 每次都读真实知识；游标只绑定页，不缓存模块存在性或当前岗位状态。 */
  async list(raw:unknown){return this.page(input(moduleOwnershipListInputSchema,raw))}
  /** 只查当前明确引用，不把历史曾负责关系混入反查。来源失效仍能看到并解除原关系。 */
  async byMember(raw:unknown){return this.page(input(moduleOwnershipByMemberInputSchema,raw))}
  /** 主工具按明确模块集合一次读取同一依据；不拼接多个不同版本的详情，也不批量复制历史。 */
  async inspectModules(identity:ModuleOwnershipIdentity,moduleIds:readonly string[]){
    const ids=input(z.array(z.string().min(1).max(1024)).min(1).max(20).refine(values=>new Set(values).size===values.length),moduleIds);
    this.assert(identity);const state=await this.store.read(),knowledge=await this.knowledge();this.assert(identity);
    const items=ids.map(id=>{const value=this.view(state,knowledge,id);if(!value.binding&&!knowledge.visible.has(id))fail('OWNERSHIP_NOT_FOUND','所选模块及其责任记录不存在');return value});
    await this.verifyRead(state,knowledge,identity);
    return moduleOwnershipPageSchema.parse({identity:this.identity(),readOnly:true,checkedAt:new Date().toISOString(),basis:this.basis(state,knowledge),offset:0,total:items.length,items});
  }
  private async page(request:z.output<typeof moduleOwnershipListInputSchema>&{memberId?:string}){
    this.assert(request);const state=await this.store.read();this.assert(request);
    if(request.memberId&&!state.workspaceMembers?.some(item=>item.memberId===request.memberId))fail('OWNERSHIP_NOT_FOUND','指定岗位不存在');
    const knowledge=await this.knowledge();this.assert(request);
    if(!request.memberId&&knowledge.issue)fail('OWNERSHIP_SOURCE_INVALID','无法完整读取模块注册表，请先处理知识问题');
    const ids=request.memberId?(state.moduleOwnerships??[]).filter(item=>item.ownerMemberId===request.memberId).map(item=>item.moduleId):[...new Set([...knowledge.visible.keys(),...(state.moduleOwnerships??[]).map(item=>item.moduleId)])];
    ids.sort();const basis=this.basis(state,knowledge),offset=request.offset??0,limit=request.limit??20;
    if(request.expectedReadBasis&&!isDeepStrictEqual(basis,request.expectedReadBasis)||offset>ids.length)fail('OWNERSHIP_REGISTRY_STALE','责任列表依据已变化，请从第一页重新读取');
    const items=ids.slice(offset,offset+limit).map(id=>this.view(state,knowledge,id)),end=offset+items.length;
    await this.verifyRead(state,knowledge,request);
    return moduleOwnershipPageSchema.parse({identity:this.identity(),readOnly:true,checkedAt:new Date().toISOString(),basis,offset,total:ids.length,items,...(end<ids.length?{nextOffset:end}:{})});
  }
  /** 历史只投影近二十项摘要；旧关系来源缺失不妨碍查询，不推断来源连续性。 */
  async get(raw:unknown){
    const request=input(moduleOwnershipGetInputSchema,raw);this.assert(request);
    const state=await this.store.read(),knowledge=await this.knowledge();this.assert(request);
    const view=this.view(state,knowledge,request.moduleId);
    if(!view.binding&&!knowledge.visible.has(request.moduleId))fail('OWNERSHIP_NOT_FOUND','模块及其责任记录不存在');
    const changes=(state.ownershipChanges??[]).filter(item=>item.next.moduleId===request.moduleId),items=changes.slice(-20).map(summarizeModuleOwnershipChange);
    await this.verifyRead(state,knowledge,request);
    return moduleOwnershipDetailSchema.parse({identity:this.identity(),readOnly:true,checkedAt:new Date().toISOString(),basis:this.basis(state,knowledge),view,history:{total:changes.length,truncated:changes.length>items.length,items}});
  }
  private async verifyKnowledge(knowledge:Knowledge,identity:ModuleOwnershipIdentity,assertCurrent?:()=>void){
    if(knowledge.snapshot){const current=await this.owner.read();this.assert(identity);assertCurrent?.();if(current.revision!==knowledge.snapshot.revision)fail('OWNERSHIP_SOURCE_CHANGED','读取期间知识变化，请重新读取或预览')}
    this.assert(identity);assertCurrent?.();
  }
  private async verifyRead(state:DispatchState,knowledge:Knowledge,identity:ModuleOwnershipIdentity){
    await this.verifyKnowledge(knowledge,identity);
    const after=await this.store.read();this.assert(identity);
    if(!isDeepStrictEqual(this.cursor(state),this.cursor(after))||!isDeepStrictEqual(state.registryCursor??null,after.registryCursor??null)||!isDeepStrictEqual(state.sourceCursor,after.sourceCursor))fail('OWNERSHIP_REGISTRY_STALE','读取期间责任、岗位或来源变化，请重新读取');
  }
  /** 只读重建依据；不保存预览、不生成关系身份。 */
  async preview(raw:unknown){
    const request=input(moduleOwnershipPreviewInputSchema,raw);this.assert(request);const state=await this.store.read(),prepared=await this.prepare(state,request);
    await this.verifyKnowledge(prepared.knowledge,request);const after=await this.store.read();this.assert(request);
    if(!isDeepStrictEqual(this.cursor(state),this.cursor(after))||!isDeepStrictEqual(state.registryCursor??null,after.registryCursor??null)||!isDeepStrictEqual(state.sourceCursor,after.sourceCursor)||moduleOwnershipImpact(after,request.change.moduleId).digest!==prepared.preview.impact.digest)fail('OWNERSHIP_REGISTRY_STALE','预览期间责任、岗位、来源或关联任务变化，请重新预览');
    return prepared.preview;
  }
  private async prepare(state:DispatchState,request:ModuleOwnershipPreviewInput,assertCurrent?:()=>void,fixed?:Snapshot){
    this.assert(request);assertCurrent?.();const change=request.change,previous=state.moduleOwnerships?.find(item=>item.moduleId===change.moduleId)??null;
    assertModuleOwnershipExpectedBinding(change,previous);
    const previousOwner=previous?.ownerMemberId?state.workspaceMembers?.find(item=>item.memberId===previous.ownerMemberId):undefined;
    const adopting=isModuleOwnershipSourceAdoption(change),requiresSource=adopting||!!change.nextOwner;
    if(requiresSource&&knowledgeSourcePending(state))fail('OWNERSHIP_SOURCE_PENDING','来源事务待核实，尚未保存新的责任采纳');
    const nextOwner=adopting?previousOwner:change.nextOwner?state.workspaceMembers?.find(item=>item.memberId===change.nextOwner!.memberId):undefined;
    if(requiresSource&&(!nextOwner||nextOwner.state!=='active'))fail('OWNERSHIP_MEMBER_UNAVAILABLE','负责人必须是本工作区启用的岗位');
    // 退役内置岗位只保留历史；解除它可恢复主 Agent 默认执行，不允许新增或继续采纳该关系。
    if(requiresSource&&nextOwner?.adoption.configuration.source==='builtin')fail('AGENT_RETIRED','内置默认执行 Agent 已退役；请解除旧负责人以恢复主 Agent 默认执行，或选择自定义岗位');
    if(change.nextOwner&&nextOwner&&nextOwner.revision!==change.nextOwner.expectedRevision)fail('OWNERSHIP_MEMBER_CHANGED','岗位版本已变化，请重新预览');
    // 解除不读取已失效来源；原 observedModule 由关系头保留，不制造新的观察时间。
    const knowledge:Knowledge=requiresSource?await this.knowledge(fixed):{visible:new Map()};this.assert(request);assertCurrent?.();
    const observedModule=requiresSource?this.observed(knowledge,change.moduleId):undefined;
    if(requiresSource&&!observedModule)fail('OWNERSHIP_SOURCE_INVALID','新责任需要真实、可见且结构有效的模块');
    const sourceSelection=requiresSource?this.owner.sources!.selection(state,knowledge.snapshot!,{kind:'module',sourceId:change.moduleId}):undefined;
    if(adopting&&sourceSelection?.kind==='workspace'&&sourceSelection.expectedRef&&isDeepStrictEqual(previous?.sourceRef,sourceSelection.expectedRef))fail('OWNERSHIP_NO_CHANGE','原负责人已经采纳当前来源');
    const facts={workspaceId:request.workspaceId,change,ownershipCursor:this.cursor(state),previous,...(previousOwner?{previousOwner:summarizeWorkspaceMember(previousOwner)}:{}),...(nextOwner?{nextOwner:summarizeWorkspaceMember(nextOwner)}:{}),...(observedModule?{observedModule}:{}),...(sourceSelection?{sourceSelection}:{}),impact:moduleOwnershipImpact(state,change.moduleId)};
    const {workspaceId:_,...body}=facts;
    const preview:ModuleOwnershipPreview=moduleOwnershipPreviewSchema.parse({identity:this.identity(),readOnly:true,...body,basis:moduleOwnershipBasis(facts),checkedAt:new Date().toISOString(),issues:[]});
    return {preview,knowledge};
  }
  /** 只读原命令，无当前实例/来源要求；未找到保持未知，不借事务重放查回执。 */
  async receipt(raw:unknown):Promise<ModuleOwnershipReceipt|undefined>{
    const request=input(moduleOwnershipLookupSchema,raw);this.workspace(request.workspaceId);
    const record=await this.store.commandReceipt('module-ownership-'+request.commandId);
    return record?this.checkedReceipt(record.receipt,request.workspaceId,request.commandId):undefined;
  }
  private checkedReceipt(raw:unknown,workspaceId:string,commandId:string){
    const result=moduleOwnershipReceiptSchema.safeParse(raw);
    if(!result.success||result.data.identity.workspaceId!==workspaceId||result.data.commandId!==commandId)fail('OWNERSHIP_RECEIPT_INVALID','原责任回执不完整，请保留命令核实');return result.data;
  }
  /** actor 只由桌面路由或真实主闭包注入；主写必须携带停止复验端口，保存后不再抛预受理失败。 */
  async commit(raw:unknown,rawActor:ModuleOwnershipActor,assertCurrent?:()=>void):Promise<ModuleOwnershipReceipt>{
    const request=input(moduleOwnershipCommitInputSchema,raw),actor=input(moduleOwnershipActorSchema,rawActor),command=moduleOwnershipCommand(request,actor);this.workspace(request.workspaceId);
    const old=await this.store.commandReceipt(command.commandId);
    if(old){if(old.fingerprint!==command.fingerprint)fail('OWNERSHIP_COMMAND_CONFLICT','原命令已绑定其他请求，请查询原回执');return this.checkedReceipt(old.receipt,request.workspaceId,request.commandId)}
    if(actor.kind==='main_agent'&&!assertCurrent)fail('OWNERSHIP_ACTOR','主运行责任写入缺少可信生命周期端口');
    this.assert(request);assertCurrent?.();
    const requiresSource=isModuleOwnershipSourceAdoption(request.change)||!!request.change.nextOwner;
    const execute=(snapshot?:Snapshot)=>this.store.transact(command,async state=>{
      this.assert(request);assertCurrent?.();checkModuleOwnershipActor(state,actor);
      if(!isDeepStrictEqual(this.cursor(state),request.expectedOwnershipCursor))fail('OWNERSHIP_REGISTRY_STALE','责任登记版本已变化，请重新预览');
      const prepared=await this.prepare(state,request,assertCurrent,snapshot),p=prepared.preview;
      if(p.basis!==request.expectedBasis)fail('OWNERSHIP_BASIS_STALE','模块、岗位或任务影响已变化，请重新预览');
      await this.verifyKnowledge(prepared.knowledge,request,assertCurrent);checkModuleOwnershipActor(state,actor);
      const time=new Date().toISOString(),changeId=randomUUID(),previous=p.previous,cursor=this.cursor(state);
      const capture=p.sourceSelection?this.owner.sources!.capture(state,p.sourceSelection,{kind:'module_ownership',changeId},time):undefined;
      if(capture&&'kind' in capture.ref)fail('OWNERSHIP_SOURCE_INVALID','模块责任不能采用内置能力来源');
      const next:ModuleOwnership={workspaceId:request.workspaceId,bindingId:previous?.bindingId??randomUUID(),moduleId:request.change.moduleId,revision:(previous?.revision??0)+1,ownerMemberId:isModuleOwnershipSourceAdoption(request.change)?previous!.ownerMemberId:request.change.nextOwner?.memberId??null,observedModule:p.observedModule??previous!.observedModule,...(capture?{sourceRef:capture.ref as NonNullable<ModuleOwnership['sourceRef']>}:previous?.sourceRef?{sourceRef:previous.sourceRef}:{}),createdAt:previous?.createdAt??time,updatedAt:time,lastChangeId:changeId};
      const change:ModuleOwnershipChange={version:1,request,actor,changeId,ownershipCursor:{kind:'module_ownership',workspaceId:request.workspaceId,streamId:cursor?.streamId??randomUUID(),seq:(cursor?.seq??0)+1},previousRevision:previous?.revision??0,previousBindingHash:previous?moduleOwnershipHash(previous):null,...(p.sourceSelection?{sourceSelection:p.sourceSelection}:{}),next,impact:p.impact,committedAt:time};
      return {ownershipChanges:[change],...(capture?.event?{knowledgeSourceChanges:[capture.event]}:{}),receipt:moduleOwnershipReceipt(change)};
    });
    return requiresSource?this.owner.withSourceSnapshot(execute):execute();
  }
}
