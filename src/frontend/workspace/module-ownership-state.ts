/**
 * 作用定位：模块负责人面板的回包核对和持久原命令状态，跨业务架构与项目岗位视图共享。
 * 设计原因：模块卡片与完整责任页共用命令池，更换负责人和同负责人采纳来源分别核对；未知不代表未保存，重开只查原命令，不补造来源。
 */
import {moduleOwnershipCommitInputSchema,moduleOwnershipPreviewSchema,moduleOwnershipReceiptSchema,moduleOwnershipPageSchema,moduleOwnershipDetailSchema,isModuleOwnershipSourceAdoption} from '../../bridge/contracts/module-ownership';
import {sourceReadStateMatches} from '../../bridge/contracts/knowledge-source';
import type {ModuleOwnershipIdentity,ModuleOwnershipPreviewInput,ModuleOwnershipPreview,ModuleOwnershipCommitInput,ModuleOwnershipReceipt,ModuleOwnershipListInput,ModuleOwnershipByMemberInput,ModuleOwnershipPage,ModuleOwnershipGetInput,ModuleOwnershipDetail,ModuleOwnershipLookup,ModuleOwnershipView} from '../../bridge/contracts/module-ownership';

const message=(error:unknown)=>error instanceof Error?error.message:String(error);
function ordered(value:unknown):unknown{return Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,ordered(item)])):value}
const same=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const identity=(value:ModuleOwnershipIdentity,input:ModuleOwnershipIdentity)=>same(value,{workspaceId:input.workspaceId,instanceId:input.instanceId});
function checkView(view:ModuleOwnershipView,workspaceId:string){
  if(view.binding&&(view.binding.workspaceId!==workspaceId||view.binding.moduleId!==view.moduleId)||view.owner&&(!view.binding||view.owner.memberId!==view.binding.ownerMemberId))throw Error('模块责任与岗位身份不一致');
  if(view.sourceStatus&&!sourceReadStateMatches(view.sourceStatus,workspaceId,{kind:'module',sourceId:view.moduleId},view.binding?.sourceRef))throw Error('模块来源不属于当前工作区或责任记录');
}
/** 三项读取依据一起冻结后续页；岗位改名、知识变化或关系变更均不能拼入旧列表。 */
export function checkedModuleOwnershipPage(raw:unknown,input:ModuleOwnershipListInput|ModuleOwnershipByMemberInput):ModuleOwnershipPage{
  const value=moduleOwnershipPageSchema.parse(raw),offset=input.offset??0;
  if(!identity(value.identity,input)||value.offset!==offset||value.items.length>(input.limit??20)||new Set(value.items.map(item=>item.moduleId)).size!==value.items.length||input.expectedReadBasis&&!same(value.basis,input.expectedReadBasis)||value.basis.ownershipCursor&&value.basis.ownershipCursor.workspaceId!==input.workspaceId||value.basis.memberRegistryCursor&&value.basis.memberRegistryCursor.workspaceId!==input.workspaceId||value.offset+value.items.length>value.total||value.nextOffset!==undefined&&(value.nextOffset<=offset||value.nextOffset!==offset+value.items.length||value.nextOffset>=value.total)||value.nextOffset===undefined&&offset+value.items.length<value.total)throw Error('责任列表身份、依据或分页不一致，请重新读取');
  for(const item of value.items){checkView(item,input.workspaceId);if('memberId' in input&&item.binding?.ownerMemberId!==input.memberId)throw Error('反查结果不属于当前岗位')}
  return value;
}
/** 详情只显示当前关系和真实历史，不依据旧任务或 Agent 名称补造负责人。 */
export function checkedModuleOwnershipDetail(raw:unknown,input:ModuleOwnershipGetInput):ModuleOwnershipDetail{
  const value=moduleOwnershipDetailSchema.parse(raw);
  if(!identity(value.identity,input)||value.view.moduleId!==input.moduleId)throw Error('模块责任详情不属于当前选择');
  checkView(value.view,input.workspaceId);return value;
}
/** 未选中的身份、原关系或目标岗位不能由预览回包改写。 */
export function checkedModuleOwnershipPreview(raw:unknown,input:ModuleOwnershipPreviewInput):ModuleOwnershipPreview{
  const value=moduleOwnershipPreviewSchema.parse(raw),change=input.change,previous=value.previous,expected=change.expectedBinding;
  if(!identity(value.identity,input)||!same(value.change,change)||value.ownershipCursor&&value.ownershipCursor.workspaceId!==input.workspaceId||expected===null&&previous!==null||expected!==null&&(!previous||previous.workspaceId!==input.workspaceId||previous.moduleId!==change.moduleId||previous.bindingId!==expected.bindingId||previous.revision!==expected.revision||previous.ownerMemberId!==expected.ownerMemberId))throw Error('负责人预览与原关系或选择不一致');
  if(isModuleOwnershipSourceAdoption(change)){
    if(!previous?.ownerMemberId||!value.previousOwner||!same(value.previousOwner,value.nextOwner)||value.nextOwner?.memberId!==previous.ownerMemberId||!value.observedModule)throw Error('来源采纳预览改变了原负责人');
  }else if(change.nextOwner?(!value.nextOwner||value.nextOwner.memberId!==change.nextOwner.memberId||value.nextOwner.revision!==change.nextOwner.expectedRevision||value.nextOwner.state!=='active'||!value.observedModule):value.nextOwner!==undefined)throw Error('负责人预览改变了目标岗位');
  if(value.previousOwner&&value.previousOwner.memberId!==previous?.ownerMemberId)throw Error('负责人预览改变了原岗位');
  return value;
}
/** 桌面原请求只能对应本机明确提交来源；回执一经受理，全部事实保持不变。 */
export function checkedModuleOwnershipReceipt(raw:unknown,request:ModuleOwnershipCommitInput,previous?:ModuleOwnershipReceipt):ModuleOwnershipReceipt{
  const value=moduleOwnershipReceiptSchema.parse(raw),expected=request.change.expectedBinding,cursor=request.expectedOwnershipCursor,revision=expected?.revision??0;
  const sourceAdoption=isModuleOwnershipSourceAdoption(request.change);
  const owner=sourceAdoption?expected?.ownerMemberId??null:request.change.nextOwner?.memberId??null;
  const action=sourceAdoption?'adopt_source':owner?(expected?.ownerMemberId?'replace':'assign'):'unassign';
  if(!identity(value.identity,request)||value.commandId!==request.commandId||value.action!==action||value.moduleId!==request.change.moduleId||value.basis!==request.expectedBasis||value.previousRevision!==revision||value.revision!==revision+1||expected&&value.bindingId!==expected.bindingId||value.previousOwnerMemberId!==(expected?.ownerMemberId??null)||value.ownerMemberId!==owner||sourceAdoption&&!owner||value.ownershipCursor.workspaceId!==request.workspaceId||value.ownershipCursor.seq!==(cursor?.seq??0)+1||cursor&&value.ownershipCursor.streamId!==cursor.streamId||!same(value.actor,{kind:'local_desktop',interaction:'explicit_submit'})||previous&&!same(value,previous))throw Error('责任回执与原命令不一致，请查询原命令');
  return value;
}

export interface ModuleOwnershipAttempt {request:ModuleOwnershipCommitInput;phase:'submitting'|'unknown'|'accepted'|'rejected';uncertain:boolean;receipt?:ModuleOwnershipReceipt;error?:string}
/** 只含公开请求和紧凑回执，历史正文仍由 Main 的权威审计持有。 */
export interface ModuleOwnershipCommandState {records:readonly ModuleOwnershipAttempt[];error:string}
export interface ModuleOwnershipCommandPorts {storage:Pick<Storage,'getItem'|'setItem'>;commit:(input:ModuleOwnershipCommitInput)=>Promise<unknown>;lookup:(input:ModuleOwnershipLookup)=>Promise<unknown>;uuid:()=>string}
/** 精确列举首次受理前拒绝；未知、IO 与命令冲突不能被解释为可换 ID 的拒绝。 */
export function moduleOwnershipPreRejected(error:unknown){return /^OWNERSHIP_(?:INPUT|IDENTITY|NOT_FOUND|REGISTRY_STALE|BINDING_STALE|ALREADY_EXISTS|MEMBER_CHANGED|MEMBER_UNAVAILABLE|SOURCE_INVALID|SOURCE_CHANGED|SOURCE_PENDING|BASIS_STALE|NO_CHANGE|LIMIT):/.test(message(error))}

/** 每工作区共享的本机命令日志；卸载视图不取消已经送达的登记，也不删除未决记录。 */
export class ModuleOwnershipCommands {
  readonly storageKey:string;
  private value:ModuleOwnershipCommandState={records:[],error:''};
  private listeners=new Set<()=>void>();private pending=new Set<string>();private unavailable=false;private corrupt=false;
  constructor(readonly workspaceId:string,private ports:ModuleOwnershipCommandPorts){
    this.storageKey='cbim.module-ownership.commands.v1.'+workspaceId;
    try{const raw=ports.storage.getItem(this.storageKey);if(!raw)return;if(new TextEncoder().encode(raw).length>2*1024*1024)throw Error('超过本机记录容量');const parsed=JSON.parse(raw);if(parsed.version!==1||parsed.workspaceId!==workspaceId||Object.keys(parsed).some(key=>!['version','workspaceId','records'].includes(key))||!Array.isArray(parsed.records)||parsed.records.length>128)throw Error('记录格式错误');const ids=new Set<string>();
      const records:ModuleOwnershipAttempt[]=parsed.records.map((item:any)=>{const request=moduleOwnershipCommitInputSchema.parse(item.request);if(request.workspaceId!==workspaceId||ids.has(request.commandId)||Object.keys(item).some(key=>!['request','phase','uncertain','receipt','error'].includes(key))||!['submitting','unknown','accepted','rejected'].includes(item.phase)||typeof item.uncertain!=='boolean'||item.phase==='rejected'&&item.uncertain||item.phase==='unknown'&&!item.uncertain||item.error!==undefined&&typeof item.error!=='string')throw Error('请求身份或状态错误');ids.add(request.commandId);const receipt=item.receipt?checkedModuleOwnershipReceipt(item.receipt,request):undefined;if(item.phase==='accepted'?!receipt:receipt!==undefined)throw Error('回执与提交状态不一致');return {request,phase:item.phase==='submitting'?'unknown':item.phase,uncertain:item.uncertain||['submitting','unknown'].includes(item.phase),receipt,error:item.error}});this.value={records,error:''};
    }catch(error){this.corrupt=true;this.unavailable=true;this.value={records:[],error:'责任本机提交记录无法读取，未发送请求：'+message(error)}}
  }
  get snapshot(){return this.value}
  get blocked(){return this.unavailable||this.pending.size>0||this.value.records.some(item=>item.phase==='unknown'||item.phase==='submitting')}
  get canRelease(){return !this.listeners.size&&!this.pending.size}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  isPending(id:string){return this.pending.has(id)}
  private emit(){for(const listener of this.listeners)listener()}
  private save(record:ModuleOwnershipAttempt){
    const records=[...this.value.records],index=records.findIndex(item=>item.request.commandId===record.request.commandId);if(index<0)records.push(record);else records[index]=record;this.value={records,error:''};
    try{if(this.corrupt||records.length>128)throw Error('本机记录不可写或达到 128 条上限');const raw=JSON.stringify({version:1,workspaceId:this.workspaceId,records});if(new TextEncoder().encode(raw).length>2*1024*1024)throw Error('本机记录超过 2 MiB');this.ports.storage.setItem(this.storageKey,raw);this.unavailable=false;this.emit();return true}
    catch(error){this.unavailable=true;this.value={records,error:'本机保存失败，保留原命令并停止新提交：'+message(error)};this.emit();return false}
  }
  /** 当前明确选择对应预览才提交；返回本次命令记录，不能从共享池最后一条推测调用结果。 */
  async submit(input:ModuleOwnershipPreviewInput,preview:ModuleOwnershipPreview){
    if(this.blocked||input.workspaceId!==this.workspaceId)return;let request:ModuleOwnershipCommitInput;
    try{const checked=checkedModuleOwnershipPreview(preview,input);request=moduleOwnershipCommitInputSchema.parse({...input,commandId:this.ports.uuid(),expectedOwnershipCursor:checked.ownershipCursor,expectedBasis:checked.basis})}catch(error){this.value={...this.value,error:message(error)};this.emit();return}
    const record:ModuleOwnershipAttempt={request,phase:'submitting',uncertain:false};if(this.save(record))await this.send(record);
    return this.value.records.find(item=>item.request.commandId===request.commandId);
  }
  private async send(record:ModuleOwnershipAttempt){
    const request=record.request;if(this.pending.has(request.commandId))return;this.pending.add(request.commandId);this.emit();
    try{const receipt=checkedModuleOwnershipReceipt(await this.ports.commit(structuredClone(request)),request,record.receipt);this.save({...record,phase:'accepted',receipt,error:undefined})}
    catch(error){const rejected=!record.uncertain&&moduleOwnershipPreRejected(error);this.save({...record,phase:rejected?'rejected':'unknown',uncertain:!rejected,error:message(error)})}
    finally{this.pending.delete(request.commandId);this.emit()}
  }
  /** 手动重送永远使用已冻结原请求；重开应用不会调用本接口。 */
  async retry(id:string){const record=this.value.records.find(item=>item.request.commandId===id);if(this.unavailable||this.pending.size||record?.phase!=='unknown')return;await this.send(record)}
  /** 查询失败或空回执仍是未知；允许修复“已受理但本机保存失败”，不执行新的登记。 */
  async query(id:string){const record=this.value.records.find(item=>item.request.commandId===id);if(this.corrupt||!record||this.pending.has(id))return;this.pending.add(id);this.emit();
    try{const raw=await this.ports.lookup({workspaceId:this.workspaceId,commandId:id});if(raw!==undefined)this.save({...record,phase:'accepted',receipt:checkedModuleOwnershipReceipt(raw,record.request,record.receipt),error:undefined});else if(record.phase!=='accepted')this.save({...record,phase:'unknown',uncertain:true,error:'尚未查到原回执；不能据此新建命令。'})}
    catch(error){this.save({...record,phase:record.phase==='accepted'?'accepted':'unknown',uncertain:true,error:'查询未确认：'+message(error)})}
    finally{this.pending.delete(id);this.emit()}}
  /** 重开只核实已持久未知命令；尚未查到回执不会自动预览、提交或换新 ID。 */
  async restore(){for(const record of this.value.records)if(record.phase==='unknown')await this.query(record.request.commandId)}
}

/** 多个业务架构或岗位页签共享原工作区未决命令；仅回收无人使用的控制器，不丢持久记录。 */
export class ModuleOwnershipCommandPool {
  private values=new Map<string,ModuleOwnershipCommands>();
  get(workspaceId:string,ports:ModuleOwnershipCommandPorts){const value=this.values.get(workspaceId)??new ModuleOwnershipCommands(workspaceId,ports);this.values.delete(workspaceId);this.values.set(workspaceId,value);for(const [key,item] of this.values){if(this.values.size<=16)break;if(key!==workspaceId&&item.canRelease)this.values.delete(key)}return value}
}
/** 业务卡片、完整责任页与岗位反查入口共享未决写入。 */
export const moduleOwnershipCommands=new ModuleOwnershipCommandPool();
