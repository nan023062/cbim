/**
 * 作用定位：项目岗位页面的严格回包核对与持久提交控制器；跨同工作区页面共享未决命令。
 * 设计原因：岗位登记不应因超时重复创建。来源只随明确能力采纳改变；先保存完整原请求再发送，未知只查询或明确重送。
 */
import {workspaceMemberCommitInputSchema,workspaceMemberPreviewSchema,workspaceMemberReceiptSchema,workspaceMemberListSchema,workspaceMemberDetailSchema} from '../../bridge/contracts/workspace-members';
import type {WorkspaceMemberIdentity,WorkspaceMemberPreviewInput,WorkspaceMemberPreview,WorkspaceMemberCommitInput,WorkspaceMemberReceipt,WorkspaceMemberListInput,WorkspaceMemberList,WorkspaceMemberGetInput,WorkspaceMemberDetail,WorkspaceMemberLookup} from '../../bridge/contracts/workspace-members';

const message=(error:unknown)=>error instanceof Error?error.message:String(error);
function ordered(value:unknown):unknown{return Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,ordered(item)])):value}
const same=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const identity=(value:WorkspaceMemberIdentity,input:WorkspaceMemberIdentity)=>same(value,{workspaceId:input.workspaceId,instanceId:input.instanceId});

/** 分页固定登记游标，不能把另一个实例或变更后的第二页拼到原列表。 */
export function checkedWorkspaceMemberList(raw:unknown,input:WorkspaceMemberListInput):WorkspaceMemberList{
  const value=workspaceMemberListSchema.parse(raw),offset=input.offset??0;
  if(!identity(value.identity,input)||value.offset!==offset||value.items.length>(input.limit??20)||new Set(value.items.map(item=>item.memberId)).size!==value.items.length||input.expectedRegistryCursor&&!same(value.registryCursor,input.expectedRegistryCursor)||value.registryCursor&&value.registryCursor.workspaceId!==input.workspaceId||value.offset+value.items.length>value.total||value.nextOffset!==undefined&&(value.nextOffset!==offset+value.items.length||value.nextOffset>=value.total)||value.nextOffset===undefined&&offset+value.items.length<value.total)throw Error('岗位列表身份、版本或分页不一致，请重新读取');
  return value;
}
/** 详情包含历史采纳快照；当前差异只是本次读取事实，不自动修改岗位。 */
export function checkedWorkspaceMemberDetail(raw:unknown,input:WorkspaceMemberGetInput):WorkspaceMemberDetail{
  const value=workspaceMemberDetailSchema.parse(raw);
  if(!identity(value.identity,input)||value.registryCursor.workspaceId!==input.workspaceId||value.member.workspaceId!==input.workspaceId||value.member.memberId!==input.memberId)throw Error('岗位详情身份不一致，请重新读取');
  return value;
}
/** 预览必须对应当前表单选择；只读预览没有创建岗位或启动模型的权限。 */
export function checkedWorkspaceMemberPreview(raw:unknown,input:WorkspaceMemberPreviewInput):WorkspaceMemberPreview{
  const value=workspaceMemberPreviewSchema.parse(raw),change=input.change,old=value.previousMember,p=value.proposed;
  const wrong=!identity(value.identity,input)||!same(value.change,change)||!!value.registryCursor&&value.registryCursor.workspaceId!==input.workspaceId||p.capability.configuration.workspaceId!==input.workspaceId||value.previousRevision!==(change.kind==='register'?0:change.expectedRevision);
  if(wrong||(change.kind==='register'?!!old:!old||old.workspaceId!==input.workspaceId||old.memberId!==change.memberId||old.revision!==change.expectedRevision))throw Error('岗位预览与当前身份或版本不一致');
  if(change.kind==='register'&&(p.state!=='active'||p.name!==change.name||p.position!==change.position||!same(p.adaptation,change.adaptation)||p.capability.configuration.agentId!==change.agentId||p.runtimePolicy.profileId!==change.runtimePolicy.profileId||p.runtimePolicy.modelId!==change.runtimePolicy.modelId))throw Error('岗位预览与登记内容不一致');
  if(old&&change.kind!=='register'){
    const source=old.adoption.configuration,next=p.capability.configuration;
    if(source.agentId!==next.agentId||source.teamId!==next.teamId||source.source!==next.source)throw Error('岗位预览不能更换静态能力身份');
    const expected={name:old.name,position:old.position,adaptation:old.adaptation,state:old.state,capability:{configuration:source,capabilityHash:old.adoption.capabilityHash,...(old.adoption.sourceRef?{sourceRef:old.adoption.sourceRef}:{})},runtimePolicy:old.runtimePolicy};
    if(change.kind==='update'){const {runtimePolicy,...patch}=change.patch;Object.assign(expected,patch);if(runtimePolicy)expected.runtimePolicy=p.runtimePolicy}
    else if(change.kind==='state')expected.state=change.nextState;
    else if(change.target==='capability')expected.capability=p.capability;
    else{if(p.runtimePolicy.profileId!==old.runtimePolicy.profileId||p.runtimePolicy.modelId!==old.runtimePolicy.modelId)throw Error('采纳模型不能改换原模型选择');expected.runtimePolicy=p.runtimePolicy}
    if(!same(expected,p))throw Error('岗位预览改变了未选择的配置');
  }
  if(change.kind==='update')for(const [key,item] of Object.entries(change.patch)){if(key==='runtimePolicy'){if(p.runtimePolicy.profileId!==change.patch.runtimePolicy?.profileId||p.runtimePolicy.modelId!==change.patch.runtimePolicy?.modelId)throw Error('岗位预览模型选择不一致')}else if(!same(p[key as 'name'|'position'|'adaptation'],item))throw Error('岗位预览与修改内容不一致')}
  if(change.kind==='state'&&p.state!==change.nextState)throw Error('岗位预览状态不一致');
  return value;
}
/** 所有回执字段都固定为原提交事实，后来的查询不能更换岗位、版本或时间。 */
export function checkedWorkspaceMemberReceipt(raw:unknown,request:WorkspaceMemberCommitInput,previous?:WorkspaceMemberReceipt):WorkspaceMemberReceipt{
  const value=workspaceMemberReceiptSchema.parse(raw),revision=request.change.kind==='register'?0:request.change.expectedRevision,cursor=request.expectedRegistryCursor;
  if(!identity(value.identity,request)||value.commandId!==request.commandId||value.action!==request.change.kind||value.basis!==request.expectedBasis||value.previousRevision!==revision||value.memberRevision!==revision+1||request.change.kind!=='register'&&value.memberId!==request.change.memberId||value.registryCursor.workspaceId!==request.workspaceId||value.registryCursor.seq!==(cursor?.seq??0)+1||cursor&&value.registryCursor.streamId!==cursor.streamId||previous&&!same(value,previous))throw Error('岗位回执与原命令不一致，请查询原命令');
  return value;
}

export interface WorkspaceMemberAttempt {request:WorkspaceMemberCommitInput;phase:'submitting'|'unknown'|'accepted'|'rejected';uncertain:boolean;receipt?:WorkspaceMemberReceipt;error?:string}
/** 只含公开请求和紧凑回执，历史正文仍由 Main 的权威审计持有。 */
export interface WorkspaceMemberCommandState {records:readonly WorkspaceMemberAttempt[];error:string}
export interface WorkspaceMemberCommandPorts {storage:Pick<Storage,'getItem'|'setItem'>;commit:(input:WorkspaceMemberCommitInput)=>Promise<unknown>;lookup:(input:WorkspaceMemberLookup)=>Promise<unknown>;uuid:()=>string}
/** 精确列举首次受理前拒绝，包含仍有模块责任时的退休拒绝；未知、IO 与命令冲突不能解释为可换 ID 重做。 */
export function workspaceMemberPreRejected(error:unknown){return /^MEMBER_(?:INPUT_INVALID|NOT_FOUND|IDENTITY|REGISTRY_STALE|REVISION_CONFLICT|BASIS_STALE|SOURCE_INVALID|SOURCE_PENDING|MODEL_INVALID|NO_CHANGE|RETIRED|LIMIT|SOURCE_CHANGED|OWNERSHIP_ACTIVE):/.test(message(error))}

/** 每工作区共享的本机命令日志；卸载视图不取消已经送达的登记，也不删除未决记录。 */
export class WorkspaceMemberCommands {
  readonly storageKey:string;
  private value:WorkspaceMemberCommandState={records:[],error:''};
  private listeners=new Set<()=>void>();private pending=new Set<string>();private unavailable=false;private corrupt=false;
  constructor(readonly workspaceId:string,private ports:WorkspaceMemberCommandPorts){
    this.storageKey='cbim.workspace-members.commands.v1.'+workspaceId;
    try{const raw=ports.storage.getItem(this.storageKey);if(!raw)return;if(new TextEncoder().encode(raw).length>2*1024*1024)throw Error('超过本机记录容量');const parsed=JSON.parse(raw);if(parsed.version!==1||parsed.workspaceId!==workspaceId||Object.keys(parsed).some(key=>!['version','workspaceId','records'].includes(key))||!Array.isArray(parsed.records)||parsed.records.length>128)throw Error('记录格式错误');const ids=new Set<string>();
      const records:WorkspaceMemberAttempt[]=parsed.records.map((item:any)=>{const request=workspaceMemberCommitInputSchema.parse(item.request);if(request.workspaceId!==workspaceId||ids.has(request.commandId)||Object.keys(item).some(key=>!['request','phase','uncertain','receipt','error'].includes(key))||!['submitting','unknown','accepted','rejected'].includes(item.phase)||typeof item.uncertain!=='boolean'||item.phase==='rejected'&&item.uncertain||item.phase==='unknown'&&!item.uncertain||item.error!==undefined&&typeof item.error!=='string')throw Error('请求身份或状态错误');ids.add(request.commandId);const receipt=item.receipt?checkedWorkspaceMemberReceipt(item.receipt,request):undefined;if(item.phase==='accepted'?!receipt:receipt!==undefined)throw Error('回执与提交状态不一致');return {request,phase:item.phase==='submitting'?'unknown':item.phase,uncertain:item.uncertain||['submitting','unknown'].includes(item.phase),receipt,error:item.error}});this.value={records,error:''};
    }catch(error){this.corrupt=true;this.unavailable=true;this.value={records:[],error:'岗位本机提交记录无法读取，未发送请求：'+message(error)}}
  }
  get snapshot(){return this.value}
  get blocked(){return this.unavailable||this.pending.size>0||this.value.records.some(item=>item.phase==='unknown'||item.phase==='submitting')}
  get canRelease(){return !this.listeners.size&&!this.pending.size}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  isPending(id:string){return this.pending.has(id)}
  private emit(){for(const listener of this.listeners)listener()}
  private save(record:WorkspaceMemberAttempt){
    const records=[...this.value.records],index=records.findIndex(item=>item.request.commandId===record.request.commandId);if(index<0)records.push(record);else records[index]=record;this.value={records,error:''};
    try{if(this.corrupt||records.length>128)throw Error('本机记录不可写或达到 128 条上限');const raw=JSON.stringify({version:1,workspaceId:this.workspaceId,records});if(new TextEncoder().encode(raw).length>2*1024*1024)throw Error('本机记录超过 2 MiB');this.ports.storage.setItem(this.storageKey,raw);this.unavailable=false;this.emit();return true}
    catch(error){this.unavailable=true;this.value={records,error:'本机保存失败，保留原命令并停止新提交：'+message(error)};this.emit();return false}
  }
  /** 调用方仅在当前预览仍对应表单时显式调用；实际版本和来源由服务再次核实。 */
  async submit(input:WorkspaceMemberPreviewInput,preview:WorkspaceMemberPreview){
    if(this.blocked||input.workspaceId!==this.workspaceId)return;let request:WorkspaceMemberCommitInput;
    try{const checked=checkedWorkspaceMemberPreview(preview,input);request=workspaceMemberCommitInputSchema.parse({...input,commandId:this.ports.uuid(),expectedRegistryCursor:checked.registryCursor,expectedBasis:checked.basis})}catch(error){this.value={...this.value,error:message(error)};this.emit();return}
    const record:WorkspaceMemberAttempt={request,phase:'submitting',uncertain:false};if(this.save(record))await this.send(record);
  }
  private async send(record:WorkspaceMemberAttempt){
    const request=record.request;if(this.pending.has(request.commandId))return;this.pending.add(request.commandId);this.emit();
    try{const receipt=checkedWorkspaceMemberReceipt(await this.ports.commit(structuredClone(request)),request,record.receipt);this.save({...record,phase:'accepted',receipt,error:undefined})}
    catch(error){const rejected=!record.uncertain&&workspaceMemberPreRejected(error);this.save({...record,phase:rejected?'rejected':'unknown',uncertain:!rejected,error:message(error)})}
    finally{this.pending.delete(request.commandId);this.emit()}
  }
  /** 手动重送永远使用已冻结原请求；重开应用不会调用本接口。 */
  async retry(id:string){const record=this.value.records.find(item=>item.request.commandId===id);if(this.unavailable||this.pending.size||record?.phase!=='unknown')return;await this.send(record)}
  /** 查询失败或空回执仍是未知；允许修复“已受理但本机保存失败”，不执行新的登记。 */
  async query(id:string){const record=this.value.records.find(item=>item.request.commandId===id);if(this.corrupt||!record||this.pending.has(id))return;this.pending.add(id);this.emit();
    try{const raw=await this.ports.lookup({workspaceId:this.workspaceId,commandId:id});if(raw!==undefined)this.save({...record,phase:'accepted',receipt:checkedWorkspaceMemberReceipt(raw,record.request,record.receipt),error:undefined});else if(record.phase!=='accepted')this.save({...record,phase:'unknown',uncertain:true,error:'尚未查到原回执；不能据此新建命令。'})}
    catch(error){this.save({...record,phase:record.phase==='accepted'?'accepted':'unknown',uncertain:true,error:'查询未确认：'+message(error)})}
    finally{this.pending.delete(id);this.emit()}}
  /** 重开只核实已持久未知命令；尚未查到回执不会自动预览、提交或换新 ID。 */
  async restore(){for(const record of this.value.records)if(record.phase==='unknown')await this.query(record.request.commandId)}
}

/** 多个团队页签共享原工作区未决命令；仅回收无人使用的控制器，不丢持久记录。 */
export class WorkspaceMemberCommandPool {
  private values=new Map<string,WorkspaceMemberCommands>();
  get(workspaceId:string,ports:WorkspaceMemberCommandPorts){const value=this.values.get(workspaceId)??new WorkspaceMemberCommands(workspaceId,ports);this.values.delete(workspaceId);this.values.set(workspaceId,value);for(const [key,item] of this.values){if(this.values.size<=16)break;if(key!==workspaceId&&item.canRelease)this.values.delete(key)}return value}
}
