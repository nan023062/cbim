/**
 * 作用定位：将桌面岗位登记、采纳与当前差异查询接到工作区唯一 DispatchStore，公开模型配置由 Main 注入。
 * 设计原因：稳定 memberId 与运行实例分离；登记只保存实际原则、有效 Skill 和无凭据模型快照，不派工、不修改知识或默认执行角色。
 * 事务边界：能力采纳固定知识串行快照后进入同一 Store，未追踪来源捕获与岗位事件同事务；模型配置仍前后复验，不宣称拥有跨存储原子锁。原命令先查回执，重开不能重做已提交动作。
 */
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {fail} from '../../core/foundation/errors';
import type {DispatchState,DispatchStore} from '../../core/tasks/dispatch-storage';
import {
  workspaceMemberCapabilitySchema,workspaceMemberCommitInputSchema,workspaceMemberDetailSchema,
  workspaceMemberGetInputSchema,workspaceMemberListInputSchema,workspaceMemberListSchema,
  workspaceMemberLookupSchema,workspaceMemberModelSnapshotSchema,workspaceMemberPreviewInputSchema,
  workspaceMemberPreviewSchema,workspaceMemberReceiptSchema,summarizeWorkspaceMember,
  type WorkspaceMember,type WorkspaceMemberCapability,type WorkspaceMemberChange,
  type WorkspaceMemberCurrentDiff,type WorkspaceMemberIdentity,
  type WorkspaceMemberModelRef,type WorkspaceMemberModelSnapshot,type WorkspaceMemberPreview,
  workspaceMemberEngine,type WorkspaceMemberPreviewInput,type WorkspaceMemberReceipt,type WorkspaceMemberRuntimePolicy,
} from '../../core/team/workspace-member';
import {
  workspaceMemberCapabilityHash,workspaceMemberChangedFields,workspaceMemberCommand,
  workspaceMemberHash,workspaceMemberModelHash,workspaceMemberPreviewBasis,
  workspaceMemberProposed,workspaceMemberReceipt,
} from '../../core/team/workspace-member-rules';
import {resolveDispatchAgent} from '../../scheduler-engine/context/dispatch-context';
import type {Snapshot} from '../../core/knowledge/types';
import {knowledgeSourcePending} from '../../core/workspace/knowledge-source-rules';
import type {SourceSelection,KnowledgeSourceReadState} from '../../core/workspace/knowledge-source';
import type {KnowledgeSourceWorkspace} from './knowledge-sources';

/** 只接收岗位独立选择的引擎、明确供应商和模型公开参数；不得在实现中解密、网络探测或读取默认选择。 */
export interface WorkspaceMemberModels {configuration(profileId:string,modelId:string,engine?:WorkspaceMemberModelRef['engine']):Promise<WorkspaceMemberModelSnapshot>}
interface PreparedMember {
  preview:WorkspaceMemberPreview;
  knowledgeRevision?:string;
  model?:WorkspaceMemberRuntimePolicy;
}
function input<T>(schema:z.ZodType<T>,raw:unknown):T{const value=schema.safeParse(raw);if(!value.success)fail('MEMBER_INPUT_INVALID','岗位登记请求不完整或包含不支持的字段');return value.data}
function issue(error:unknown){return error&&typeof error==='object'&&'code' in error?String(error.code):''}

/** 每个工作区实例只装配一次，共用派发存储；本服务没有执行、领取或停止模型的端口。 */
export class WorkspaceMembers {
  constructor(private readonly owner:KnowledgeSourceWorkspace,private readonly store:DispatchStore,private readonly models:WorkspaceMemberModels,private readonly isCurrent:()=>boolean=()=>true){}
  private assert(identity:WorkspaceMemberIdentity){
    if(identity.workspaceId!==this.owner.entry.id||identity.instanceId!==this.owner.instanceId)fail('MEMBER_IDENTITY','工作区实例已变化，请重新读取岗位登记');
    this.owner.assert(identity);if(!this.isCurrent())fail('MEMBER_UNAVAILABLE','工作区正在关闭，未接受新的岗位登记');
  }
  private identity(){return {workspaceId:this.owner.entry.id,instanceId:this.owner.instanceId}}
  private sameWorkspace(workspaceId:string){if(workspaceId!==this.owner.entry.id)fail('MEMBER_IDENTITY','岗位登记不属于此工作区')}
  private cursor(state:DispatchState){return state.registryCursor??null}
  private member(state:DispatchState,id:string){const member=state.workspaceMembers?.find(value=>value.memberId===id);if(!member)fail('MEMBER_NOT_FOUND','岗位不存在');return member}

  /** 登记列表不复制能力正文；后续页严格绑定游标，修改名称不会重新排序。 */
  async list(raw:unknown){
    const request=input(workspaceMemberListInputSchema,raw);this.assert(request);
    const state=await this.store.read();this.assert(request);
    const cursor=this.cursor(state),members=state.workspaceMembers??[],offset=request.offset??0,limit=request.limit??20;
    if(request.expectedRegistryCursor&&!isDeepStrictEqual(request.expectedRegistryCursor,cursor)||offset>members.length)fail('MEMBER_REGISTRY_STALE','岗位列表已变化，请从第一页重新读取');
    const items=members.slice(offset,offset+limit).map(summarizeWorkspaceMember),end=offset+items.length;
    return workspaceMemberListSchema.parse({identity:this.identity(),registryCursor:cursor,offset,total:members.length,items,...(end<members.length?{nextOffset:end}:{})});
  }

  /** 每次详情读取重新观察知识和公开模型配置；登记游标不作为外部来源的缓存键。 */
  async get(raw:unknown){
    const request=input(workspaceMemberGetInputSchema,raw);this.assert(request);
    const state=await this.store.read(),member=this.member(state,request.memberId);this.assert(request);
    const currentDiff=await this.diff(member);this.assert(request);
    let sourceStatus:KnowledgeSourceReadState;
    try{const snapshot=await this.owner.snapshot(),configuration=member.adoption.configuration,pending=knowledgeSourcePending(state);sourceStatus=pending?{status:'pending',transitionId:pending.transitionId}:configuration.source==='builtin'?await this.builtinStatus(member,snapshot):this.owner.sources!.status(state,snapshot,{kind:'agent',sourceId:configuration.agentId},member.adoption.sourceRef)}catch{sourceStatus={status:'invalid',issue:'当前知识无法核实来源，原采纳仍保留'}}
    const after=await this.store.read();this.assert(request);
    if(!isDeepStrictEqual(this.cursor(state),this.cursor(after))||!isDeepStrictEqual(state.sourceCursor,after.sourceCursor))fail('MEMBER_REGISTRY_STALE','读取期间岗位或来源登记发生变化，请重新读取');
    return workspaceMemberDetailSchema.parse({identity:this.identity(),registryCursor:this.cursor(state),member,currentDiff,sourceStatus});
  }

  /** 预览只读取来源，不生成岗位、采纳 ID 或审计记录。 */
  async preview(raw:unknown){
    const request=input(workspaceMemberPreviewInputSchema,raw);this.assert(request);
    const state=await this.store.read(),prepared=await this.prepare(state,request);await this.verifySources(prepared,request);
    const after=await this.store.read();this.assert(request);
    if(!isDeepStrictEqual(this.cursor(state),this.cursor(after))||!isDeepStrictEqual(state.sourceCursor,after.sourceCursor))fail('MEMBER_REGISTRY_STALE','预览期间岗位或来源登记已变化，请重新预览');
    return prepared.preview;
  }

  /** 原命令查询不会调用事务、知识读取、默认模型解析或重放；未找到不等于证明从未受理。 */
  async receipt(raw:unknown):Promise<WorkspaceMemberReceipt|undefined>{
    const request=input(workspaceMemberLookupSchema,raw);this.sameWorkspace(request.workspaceId);
    const recorded=await this.store.commandReceipt('workspace-member-'+request.commandId);
    return recorded?this.checkedReceipt(recorded.receipt,request.workspaceId,request.commandId):undefined;
  }
  private checkedReceipt(raw:unknown,workspaceId:string,commandId:string){
    const parsed=workspaceMemberReceiptSchema.safeParse(raw);
    if(!parsed.success||parsed.data.identity.workspaceId!==workspaceId||parsed.data.commandId!==commandId)fail('MEMBER_RECEIPT_INVALID','原岗位登记回执不完整，请保留原命令核实');
    return parsed.data;
  }

  /** 仅可信桌面入口可调用。先核原命令，再在 Store 串行事务内复验版本和来源；已落盘后的回包失败不撤回或重做。 */
  async commit(raw:unknown,actor:{kind:'local_desktop';interaction:'explicit_submit'}):Promise<WorkspaceMemberReceipt>{
    const request=input(workspaceMemberCommitInputSchema,raw),command=workspaceMemberCommand(request);this.sameWorkspace(request.workspaceId);
    const existing=await this.store.commandReceipt(command.commandId);
    if(existing){if(existing.fingerprint!==command.fingerprint)fail('MEMBER_COMMAND_CONFLICT','原命令已用于另一份请求，请查询原回执');return this.checkedReceipt(existing.receipt,request.workspaceId,request.commandId)}
    if(!actor||actor.kind!=='local_desktop'||actor.interaction!=='explicit_submit')fail('MEMBER_ACTOR','岗位登记需要明确的本机提交');
    this.assert(request);
    const adopting=request.change.kind==='register'||request.change.kind==='adopt'&&request.change.target==='capability';
    const execute=(snapshot?:Snapshot)=>this.store.transact(command,async state=>{
      this.assert(request);
      if(!isDeepStrictEqual(this.cursor(state),request.expectedRegistryCursor))fail('MEMBER_REGISTRY_STALE','岗位登记版本已变化，请重新预览');
      const prepared=await this.prepare(state,request,snapshot),preview=prepared.preview;
      if(preview.basis!==request.expectedBasis)fail('MEMBER_BASIS_STALE','岗位或来源内容已变化，请重新预览');
      await this.verifySources(prepared,request);this.assert(request);
      const time=new Date().toISOString(),old=preview.previousMember,p=preview.proposed,changeId=randomUUID();
      const adopt=!old||request.change.kind==='adopt'&&request.change.target==='capability';
      const capture=adopt&&preview.sourceSelection?this.owner.sources!.capture(state,preview.sourceSelection,{kind:'workspace_member',changeId},time):undefined;
      const member:WorkspaceMember={workspaceId:request.workspaceId,memberId:old?.memberId??randomUUID(),revision:(old?.revision??0)+1,
        name:p.name,position:p.position,adaptation:p.adaptation,state:p.state,
        adoption:adopt?{captureId:randomUUID(),capturedAt:time,knowledgeRevision:p.capability.configuration.knowledgeRevision,capabilityHash:p.capability.capabilityHash,configuration:p.capability.configuration,...(capture?{sourceRef:capture.ref}:{})}:old!.adoption,
        runtimePolicy:p.runtimePolicy,createdAt:old?.createdAt??time,updatedAt:time};
      const cursor=this.cursor(state),change:WorkspaceMemberChange={version:1,request,changeId,registryCursor:{kind:'workspace_registry',workspaceId:request.workspaceId,streamId:cursor?.streamId??randomUUID(),seq:(cursor?.seq??0)+1},previousRevision:old?.revision??0,previousMemberHash:old?workspaceMemberHash(old):null,...(preview.sourceSelection?{sourceSelection:preview.sourceSelection}:{}),next:member,actor:{kind:'local_desktop',interaction:'explicit_submit'},committedAt:time};
      return {workspaceMemberChanges:[change],...(capture?.event?{knowledgeSourceChanges:[capture.event]}:{}),receipt:workspaceMemberReceipt(change)};
    });
    return adopting?this.owner.withSourceSnapshot(execute):execute();
  }

  private async capability(agentId:string,fixed?:Snapshot):Promise<WorkspaceMemberCapability>{
    const snapshot=fixed??await this.owner.snapshot();
    const configuration=await resolveDispatchAgent(snapshot,agentId);
    const parsed=workspaceMemberCapabilitySchema.safeParse(configuration);if(!parsed.success)fail('MEMBER_SOURCE_INVALID','当前角色能力不符合岗位快照协议或超过容量');
    return parsed.data;
  }
  private async policy(ref:WorkspaceMemberModelRef & {snapshot?:WorkspaceMemberModelSnapshot}):Promise<WorkspaceMemberRuntimePolicy>{
    const snapshot=workspaceMemberModelSnapshotSchema.parse(await this.models.configuration(ref.profileId,ref.modelId,workspaceMemberEngine(ref)));
    return {profileId:ref.profileId,modelId:ref.modelId,...(ref.engine===undefined?{}:{engine:ref.engine}),snapshot,configurationHash:workspaceMemberModelHash(snapshot)};
  }
  private async prepare(state:DispatchState,request:WorkspaceMemberPreviewInput,fixed?:Snapshot):Promise<PreparedMember>{
    this.assert(request);const change=request.change,old=change.kind==='register'?undefined:this.member(state,change.memberId);
    if(old){if(old.revision!==('expectedRevision' in change?change.expectedRevision:0))fail('MEMBER_REVISION_CONFLICT','岗位版本已变化，请重新读取');if(old.state==='retired')fail('MEMBER_RETIRED','岗位已退休，历史可读但不能修改或恢复')}
    let proposed=old?workspaceMemberProposed(old):undefined,knowledgeRevision:string|undefined,model:WorkspaceMemberRuntimePolicy|undefined,sourceSelection:SourceSelection|undefined;
    const adopting=change.kind==='register'||change.kind==='adopt'&&change.target==='capability';
    if(adopting&&knowledgeSourcePending(state))fail('MEMBER_SOURCE_PENDING','来源事务待核实，尚未保存新的岗位采纳');
    const snapshot=adopting?(fixed??await this.owner.snapshot()):undefined;
    if(change.kind==='register'){
      const configuration=await this.selectedCapability(change.agentId,snapshot);this.assert(request);knowledgeRevision=configuration.knowledgeRevision;
      model=await this.selectedPolicy(change.runtimePolicy);this.assert(request);
      proposed={name:change.name,position:change.position,adaptation:change.adaptation,state:'active',capability:{configuration,capabilityHash:workspaceMemberCapabilityHash(configuration)},runtimePolicy:model};
    }else if(change.kind==='update'){
      const {runtimePolicy,...patch}=change.patch;proposed={...proposed!,...patch};
      if(runtimePolicy){
        if(runtimePolicy.profileId===old!.runtimePolicy.profileId&&runtimePolicy.modelId===old!.runtimePolicy.modelId&&(runtimePolicy.engine??'pi')===(workspaceMemberEngine(old!.runtimePolicy)??'pi'))fail('MEMBER_NO_CHANGE','相同模型的配置刷新请使用明确采纳操作');
        model=await this.selectedPolicy(runtimePolicy);this.assert(request);proposed.runtimePolicy=model;
      }
    }else if(change.kind==='adopt'){
      if(change.target==='capability'){
        const configuration=await this.selectedCapability(old!.adoption.configuration.agentId,snapshot);this.assert(request);
        const source=old!.adoption.configuration;
        if(configuration.workspaceId!==source.workspaceId||configuration.teamId!==source.teamId||configuration.agentId!==source.agentId||configuration.source!==source.source)fail('MEMBER_SOURCE_CHANGED','能力来源身份发生变化，不能作为原岗位的能力采纳');
        knowledgeRevision=configuration.knowledgeRevision;proposed!.capability={configuration,capabilityHash:workspaceMemberCapabilityHash(configuration)};
      }else {model=await this.selectedPolicy(old!.runtimePolicy);this.assert(request);proposed!.runtimePolicy=model}
    }else proposed!.state=change.nextState;
    if(adopting){
      const configuration=proposed!.capability.configuration;
      try{sourceSelection=configuration.source==='builtin'?{kind:'builtin',ref:{kind:'builtin',id:'cbim:executor',contentHash:proposed!.capability.capabilityHash}}:this.owner.sources!.selection(state,snapshot!,{kind:'agent',sourceId:configuration.agentId})}catch{fail('MEMBER_SOURCE_INVALID','当前来源无法明确采纳')}
      const ref=sourceSelection.kind==='builtin'?sourceSelection.ref:sourceSelection.expectedRef;
      proposed!.capability={configuration,capabilityHash:proposed!.capability.capabilityHash,...(ref?{sourceRef:ref}:{})};
    }
    const changedFields=workspaceMemberChangedFields(old,proposed!);if(adopting&&sourceSelection?.kind==='workspace'&&!sourceSelection.expectedRef&&!changedFields.includes('capability'))changedFields.push('capability');if(!changedFields.length)fail('MEMBER_NO_CHANGE','本次操作没有改变岗位登记内容');
    const registryCursor=this.cursor(state),basis=workspaceMemberPreviewBasis({workspaceId:request.workspaceId,change,registryCursor,previousMember:old,proposed:proposed!,...(sourceSelection?{sourceSelection}:{})});
    const preview=workspaceMemberPreviewSchema.parse({identity:this.identity(),change,registryCursor,basis,checkedAt:new Date().toISOString(),previousRevision:old?.revision??0,...(old?{previousMember:old}:{}),...(sourceSelection?{sourceSelection}:{}),proposed,changedFields});
    return {preview,knowledgeRevision,model};
  }
  /** 独立来源最后复验后立即返回 mutation；不宣称模型设置与知识存储拥有同一事务锁。 */
  private async verifySources(prepared:PreparedMember,identity:WorkspaceMemberIdentity){
    if(prepared.knowledgeRevision!==undefined){const current=await this.owner.read();this.assert(identity);if(current.revision!==prepared.knowledgeRevision)fail('MEMBER_SOURCE_CHANGED','读取期间知识来源发生变化，请重新预览')}
    if(prepared.model){const current=await this.selectedPolicy(prepared.model);this.assert(identity);if(current.configurationHash!==prepared.model.configurationHash)fail('MEMBER_SOURCE_CHANGED','读取期间模型配置发生变化，请重新预览')}
    this.assert(identity);
  }
  private async selectedCapability(agentId:string,snapshot?:Snapshot){
    if(agentId==='cbim:executor')fail('AGENT_RETIRED','内置默认执行 Agent 已退役；主 Agent 默认执行，无需登记岗位');
    try{return await this.capability(agentId,snapshot)}catch{fail('MEMBER_SOURCE_INVALID','无法采纳当前角色能力，请检查角色、原则、有效 Skill 与知识结构')}
  }
  /** 旧采纳快照与账本保持可读，不再读取或重建已退役的内置能力。 */
  private async builtinStatus(_member:WorkspaceMember,_snapshot:Snapshot):Promise<KnowledgeSourceReadState>{return {status:'invalid',issue:'内置默认执行 Agent 已退役，历史岗位保留；未配置自定义 Agent 的模块由主 Agent 直接执行'}}
  private async selectedPolicy(ref:WorkspaceMemberModelRef & {snapshot?:WorkspaceMemberModelSnapshot}){try{return await this.policy(ref)}catch{fail('MEMBER_MODEL_INVALID','无法读取明确选定的公开模型配置，请检查供应商与已启用模型')}}
  private async diff(member:WorkspaceMember):Promise<WorkspaceMemberCurrentDiff>{
    let capability:WorkspaceMemberCurrentDiff['capability'],model:WorkspaceMemberCurrentDiff['model'];
    try{
      const current=await this.capability(member.adoption.configuration.agentId),after=await this.owner.read();
      if(after.revision!==current.knowledgeRevision)fail('MEMBER_SOURCE_STALE','知识来源读取期间变化');
      const currentHash=workspaceMemberCapabilityHash(current);
      capability={status:currentHash===member.adoption.capabilityHash?'same':'changed',adoptedHash:member.adoption.capabilityHash,currentHash,knowledgeRevision:current.knowledgeRevision};
    }catch(error){capability={status:issue(error)==='AGENT_MISSING'?'missing':'invalid',adoptedHash:member.adoption.capabilityHash,issue:'当前角色能力缺失、无效或读取期间发生变化；已采纳快照仍保留'}}
    try{
      const current=await this.policy(member.runtimePolicy),after=await this.policy(member.runtimePolicy);
      if(current.configurationHash!==after.configurationHash)fail('MEMBER_SOURCE_STALE','模型配置读取期间变化');
      model={status:current.configurationHash===member.runtimePolicy.configurationHash?'same':'changed',adoptedHash:member.runtimePolicy.configurationHash,currentHash:current.configurationHash};
    }catch(error){model={status:issue(error)==='LLM_REQUIRED'?'missing':'invalid',adoptedHash:member.runtimePolicy.configurationHash,issue:'当前公开模型配置缺失、无效或读取期间发生变化；不代表凭据或接口状态'}}
    return {checkedAt:new Date().toISOString(),capability,model};
  }
}
