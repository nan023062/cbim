/**
 * 作用定位：管理显式目标补充的本地草稿、冻结请求与回执，不直接依赖 React 或桌面全局对象。
 * 设计原因：请求连同有序附件身份先保存再发送；首次明确预受理拒绝可编辑，通信未知仍冻结。两处目标卡共享草稿和选择器锁，迟到导入不得污染新等待，普通聊天草稿独立。
 * 回执边界：首次受理后仅周期状态可更新；矛盾运行或附件清单保留旧回执并显示查询错误。
 * 成员等待：已核实的检查点/岗位/权限预受理拒绝保留可编辑草稿；曾通信未知的原请求仍冻结。
 */
import {goalContinuationRequestSchema,goalContinuationReceiptSchema} from '../../bridge/contracts/dispatch';
import type {GoalContinuationRequest,GoalContinuationReceipt} from '../../bridge/contracts/dispatch';
import type {ChatAttachment,ChatMaterialImport} from '../../bridge/contracts/chat';
import type {RepositoryToolTarget,RepositoryListOutput} from '../../bridge/contracts/repository-connections';
import {continuationFiles,continuationAttachments,appendContinuationAttachments} from './continuation-attachments';
import {checkedMaterialTargets,checkedMaterialPage} from './continuation-source-state';

export type ContinuationTarget=Pick<GoalContinuationRequest,'workspaceId'|'rootSessionId'|'scopeId'|'waitId'|'expectedGoalRevision'|'expectedInputRevision'>;
export type ContinuationPhase='submitting'|'unknown'|'accepted'|'rejected';
export interface ContinuationAttempt {
  /** 发送前持久化的原始请求；未知结果只能重发这一份，不能套用后来选择的模型或权限。 */
  request:GoalContinuationRequest;
  phase:ContinuationPhase;
  /** 一旦出现通信未知，后续拒绝也不足以证明原请求未被接受。 */
  uncertain:boolean;
  receipt?:GoalContinuationReceipt;error?:string;
}
export interface ContinuationDraft {scopeId:string;waitId:string;text:string;/** 仅公开快照元数据；无附件的旧草稿不添加空字段。 */ attachments?:ChatAttachment[];attempt?:ContinuationAttempt}
export interface ContinuationState {records:readonly ContinuationDraft[];error:string}
export type ContinuationSourceSelection={kind:'file'|'folder'}|ChatMaterialImport;
export interface ContinuationMaterialPage {target:RepositoryToolTarget;expectedRevision?:string;offset?:number}
/** IO 端口允许测试真正的超时、重复请求与重开；不包含模型执行或知识路径。 */
export interface ContinuationPorts {
  storage:Pick<Storage,'getItem'|'setItem'>;
  submit:(request:GoalContinuationRequest)=>Promise<unknown>;
  lookup:(request:Pick<GoalContinuationRequest,'workspaceId'|'rootSessionId'|'scopeId'|'commandId'>)=>Promise<unknown>;
  uuid:()=>string;
  /** 原生选择器返回本工作区保存的文件快照；不接受 renderer 传任意源文件路径。 */
  pickFiles?:()=>Promise<unknown>;
  /** 一次显式导入；取消信号属于原等待，不能迁移到新会话。 */
  importSource?:(selection:ContinuationSourceSelection,signal:AbortSignal)=>Promise<unknown>;
  materialTargets?:(signal:AbortSignal)=>Promise<unknown>;
  materialList?:(selection:ContinuationMaterialPage,signal:AbortSignal)=>Promise<unknown>;
}
const equal=(a:unknown,b:unknown):boolean=>{const order=(value:unknown):unknown=>Array.isArray(value)?value.map(order):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,order(v)])):value;return JSON.stringify(order(a))===JSON.stringify(order(b))};
const textError=(error:unknown)=>error instanceof Error?error.message:String(error);
/** 成员核验仅在消费等待之前抛出这些确定拒绝；显式枚举，不把未来未知错误默认视为未提交。 */
const memberPauseRejections=new Set(['GOAL_MEMBER_PAUSE_INVALID','GOAL_MEMBER_PAUSE_PERMISSION','GOAL_MEMBER_PAUSE_UNAVAILABLE','GOAL_KNOWLEDGE_CHANGED','MEMBER_CHECKPOINT_ARTIFACT_CHANGED','MEMBER_CHECKPOINT_NATIVE_CHANGED','MEMBER_CHECKPOINT_INVALID','MEMBER_CHECKPOINT_PROGRESS','MEMBER_CHECKPOINT_MISSING','MEMBER_CHECKPOINT_CHANGED','OWNER_MEMBER_UNAVAILABLE','OWNER_MODEL_CHANGED','OWNER_CAPABILITY_CHANGED','OWNER_BINDING_REQUIRED','OWNER_BINDING_STALE','OWNER_KNOWLEDGE_CHANGED']);
/** 仅列出协议保证尚未接受意图的错误。未知代码（含通用 IO/运行失败）必须保留冻结请求。 */
export function continuationRejected(error:unknown){const message=textError(error),code=/^([A-Z_]+):/.exec(message)?.[1];return !!code&&memberPauseRejections.has(code)||/^(?:CAPACITY_BUSY|SCOPE_BUDGET_EXCEEDED|SCOPE_BUDGET_UNVERIFIABLE|SCOPE_BUDGET_WAITING|GOAL_ATTACHMENT_[A-Z_]+|GOAL_CONTINUATION_INPUT|GOAL_IDENTITY|GOAL_NOT_WAITING|GOAL_CONTINUATION_UNAVAILABLE|GOAL_WAIT_CONFLICT|GOAL_REVISION_CONFLICT|GOAL_CYCLE_LIMIT|GOAL_DECISION_LIMIT|GOAL_RUN_CONFLICT|GOAL_INPUT_LIMIT|GOAL_WORK_PENDING|IDENTITY|CONTINUATION_NOT_READY):/.test(message)}

/** 回执还需核对冻结内容，不能只凭“成功”或某个 runId 确认另一目标的请求。 */
export function checkedContinuationReceipt(raw:unknown,request:GoalContinuationRequest,previous?:GoalContinuationReceipt):GoalContinuationReceipt{
  const receipt=goalContinuationReceiptSchema.parse(raw),value=receipt.continuation;
  if(receipt.workspaceId!==request.workspaceId||receipt.rootSessionId!==request.rootSessionId||receipt.scopeId!==request.scopeId||value.continuationId!==request.commandId||value.wait.waitId!==request.waitId||value.wait.goalRevision!==request.expectedGoalRevision||value.inputRevision!==request.expectedInputRevision+1||!equal(value.input,request.input)||!equal(value.options,request.options))throw Error('补充回执与冻结请求不一致，请查询原请求结果');
  // 周期可从 active 变为 closed，但已受理的运行、时间和附件清单不能被后来的矛盾回包替换。
  if(previous&&!equal(value,previous.continuation))throw Error('查询回执与已记录的受理事实不一致，原回执已保留');
  return receipt;
}

/** 每个主会话一份控制器；本地持久化失败时拒绝发送，不偷偷丢弃可能已提交的请求。 */
export class ScopeContinuationController {
  private value:ContinuationState={records:[],error:''};
  private unavailable=false;
  private listeners=new Set<()=>void>();
  private pending=new Set<string>();
  /** 同一主会话的两个表单共用；选择器返回前不提交或回收控制器。 */
  private importing=false;
  private sourceOperation?:{target:string;abort:AbortController};
  readonly storageKey:string;
  constructor(readonly workspaceId:string,readonly rootSessionId:string,private ports:ContinuationPorts){
    this.storageKey='cbim.goal-continuation.v1.'+JSON.stringify([workspaceId,rootSessionId]);
    try{
      const text=ports.storage.getItem(this.storageKey);if(!text)return;
      const saved=JSON.parse(text);if(saved.version!==1||saved.workspaceId!==workspaceId||saved.rootSessionId!==rootSessionId||!Array.isArray(saved.records))throw Error('本地补充记录格式不匹配');
      const keys=new Set<string>();
      const records:ContinuationDraft[]=saved.records.map((entry:any)=>{
        if(typeof entry.scopeId!=='string'||!entry.scopeId||typeof entry.waitId!=='string'||!entry.waitId||typeof entry.text!=='string')throw Error('本地补充草稿缺少目标身份');
        const key=JSON.stringify([entry.scopeId,entry.waitId]);if(keys.has(key))throw Error('本地补充记录出现重复目标');keys.add(key);
        const attachments=entry.attachments===undefined?undefined:continuationAttachments(entry.attachments);
        const draft={scopeId:entry.scopeId,waitId:entry.waitId,text:entry.text,...(attachments?.length?{attachments}:{})};
        if(!entry.attempt)return draft;
        const request=goalContinuationRequestSchema.parse(entry.attempt.request);
        if(request.workspaceId!==workspaceId||request.rootSessionId!==rootSessionId||request.scopeId!==entry.scopeId||request.waitId!==entry.waitId||!['submitting','unknown','accepted','rejected'].includes(entry.attempt.phase))throw Error('本地冻结请求身份不匹配');
        const receipt=entry.attempt.receipt?checkedContinuationReceipt(entry.attempt.receipt,request):undefined;
        if(entry.attempt.phase==='accepted'&&!receipt)throw Error('已受理记录缺少回执');
        const unresolved=['submitting','unknown'].includes(entry.attempt.phase);
        if(entry.attempt.phase!=='rejected'&&(request.input.message!==entry.text||!equal(request.input.attachmentIds,attachments?.length?attachments.map(item=>item.id):undefined)))throw Error('本地附件或正文与冻结请求不一致');
        return {...draft,attempt:{request,phase:unresolved?'unknown':entry.attempt.phase,uncertain:unresolved||!!entry.attempt.uncertain,receipt,error:typeof entry.attempt.error==='string'?entry.attempt.error:undefined}};
      });this.value={records,error:''};
    }catch(error){this.unavailable=true;this.value={records:[],error:'本地补充记录无法读取，未发送请求：'+textError(error)}}
  }
  get snapshot(){return this.value}
  get available(){return !this.unavailable}
  /** 仅无视图观察且无请求在途时可被renderer缓存回收，重开再从本机记录恢复。 */
  get canRelease(){return this.listeners.size===0&&this.pending.size===0&&!this.importing}
  get isImporting(){return this.importing}
  subscribe(listener:()=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener)}}
  record(scopeId:string,waitId:string){return this.value.records.find(item=>item.scopeId===scopeId&&item.waitId===waitId)}
  isPending(record:ContinuationDraft|undefined){return !!record?.attempt&&this.pending.has(record.attempt.request.commandId)}
  private emit(){for(const listener of this.listeners)listener()}
  private store(){
    if(this.unavailable)throw Error(this.value.error);
    this.ports.storage.setItem(this.storageKey,JSON.stringify({version:1,workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,records:this.value.records}));
  }
  private update(record:ContinuationDraft):boolean{
    const index=this.value.records.findIndex(item=>item.scopeId===record.scopeId&&item.waitId===record.waitId),records=[...this.value.records];if(index<0)records.push(record);else records[index]=record;
    this.value={records,error:''};let saved=true;
    try{this.store()}catch(error){saved=false;this.value={...this.value,error:'补充记录未能保存：'+textError(error)}}this.emit();return saved;
  }
  /** 编辑仅改变指定等待的草稿；结果未知或已受理的请求不允许换正文重发。 */
  edit(target:ContinuationTarget,text:string){
    if(this.unavailable||target.workspaceId!==this.workspaceId||target.rootSessionId!==this.rootSessionId)return;
    const old=this.record(target.scopeId,target.waitId);if(old?.attempt&&old.attempt.phase!=='rejected')return;
    this.update({...old,scopeId:target.scopeId,waitId:target.waitId,text});
  }
  private canEdit(target:ContinuationTarget){
    const record=this.record(target.scopeId,target.waitId);
    return !this.unavailable&&target.workspaceId===this.workspaceId&&target.rootSessionId===this.rootSessionId&&(!record?.attempt||record.attempt.phase==='rejected');
  }
  /** 主视图提供当前身份复核；切换、关闭或等待变化后的选择结果被丢弃，不写入旧目标或新目标。 */
  async pickFiles(target:ContinuationTarget,isCurrent:()=>boolean){
    await this.importSource(target,{kind:'file'},isCurrent);
  }
  /** 选择和目录分页共享同一在途锁；结果必须仍属于原等待且未取消才可进入公开草稿。 */
  private async source<T>(target:ContinuationTarget,isCurrent:()=>boolean,read:(signal:AbortSignal)=>Promise<T>,accept?:(result:T)=>void):Promise<T|undefined>{
    if(this.importing||!this.canEdit(target)||!isCurrent())return;
    const operation={target:JSON.stringify(target),abort:new AbortController()};this.sourceOperation=operation;this.importing=true;this.emit();
    try{
      const result=await read(operation.abort.signal);
      if(operation.abort.signal.aborted||!isCurrent()||!this.canEdit(target))return;
      accept?.(result);return result;
    }catch(error){if(!operation.abort.signal.aborted&&isCurrent()){this.value={...this.value,error:'补充附件未能添加：'+textError(error)};this.emit()}}
    finally{if(this.sourceOperation===operation){this.sourceOperation=undefined;this.importing=false;this.emit()}}
  }
  /** 取消当前来源准备，不消费等待、不改变已选附件，也不取消运行或原生系统对话框本身。 */
  cancelImport(target?:ContinuationTarget){if(!target||this.sourceOperation?.target===JSON.stringify(target))this.sourceOperation?.abort.abort()}
  async importSource(target:ContinuationTarget,selection:ContinuationSourceSelection,isCurrent:()=>boolean){
    await this.source(target,isCurrent,async signal=>{
      const picked=this.ports.importSource?await this.ports.importSource(selection,signal):selection.kind==='file'&&this.ports.pickFiles?await this.ports.pickFiles():undefined;
      if(picked===undefined)throw Error('当前来源导入入口不可用');
      const items=selection.kind==='file'?continuationFiles(picked):continuationAttachments(picked);
      if(items.some(item=>item.kind!==selection.kind))throw Error('来源回包与原选择种类不一致');
      return items;
    },items=>{
      const old=this.record(target.scopeId,target.waitId),attachments=appendContinuationAttachments(old?.attachments??[],items);
      if(attachments.length)this.update({...old,scopeId:target.scopeId,waitId:target.waitId,text:old?.text??'',attachments});
    });
  }
  async materialTargets(target:ContinuationTarget,isCurrent:()=>boolean):Promise<RepositoryToolTarget[]|undefined>{
    return this.source(target,isCurrent,async signal=>{
      if(!this.ports.materialTargets)throw Error('仓库资料入口不可用');
      return checkedMaterialTargets(await this.ports.materialTargets(signal),this.workspaceId);
    });
  }
  async materialList(target:ContinuationTarget,selection:ContinuationMaterialPage,isCurrent:()=>boolean):Promise<RepositoryListOutput|undefined>{
    return this.source(target,isCurrent,async signal=>{
      if(!this.ports.materialList)throw Error('仓库目录入口不可用');
      return checkedMaterialPage(await this.ports.materialList(selection,signal),this.workspaceId,selection);
    });
  }
  /** 仅未提交或明确拒绝的草稿可移除附件，未知和已受理请求保持原顺序与身份。 */
  removeFile(target:ContinuationTarget,id:string){
    if(this.importing||!this.canEdit(target))return;
    const old=this.record(target.scopeId,target.waitId);if(!old?.attachments)return;
    const attachments=old.attachments.filter(item=>item.id!==id),{attachments:_,...draft}=old;
    this.update({...draft,...(attachments.length?{attachments}:{})});
  }
  /** 第一次提交前保存完整请求；重复点击由控制器锁及已有 attempt 双重挡住。 */
  async submit(target:ContinuationTarget,options:GoalContinuationRequest['options']){
    if(this.importing||this.unavailable||target.workspaceId!==this.workspaceId||target.rootSessionId!==this.rootSessionId)return;
    const record=this.record(target.scopeId,target.waitId);if(!record||record.attempt&&record.attempt.phase!=='rejected')return;
    let request:GoalContinuationRequest;
    try{request=goalContinuationRequestSchema.parse({...target,commandId:this.ports.uuid(),input:{message:record.text,...(record.attachments?.length?{attachmentIds:record.attachments.map(item=>item.id)}:{})},options})}
    catch(error){this.value={...this.value,error:'补充内容或模型配置无效：'+textError(error)};this.emit();return}
    const next={...record,attempt:{request,phase:'submitting' as const,uncertain:false}};
    if(!this.update(next)){
      // 尚未调用 IPC，允许释放空间后重新保存；不能把一个未发送的本地失败显示成服务受理未知。
      this.value={...this.value,records:this.value.records.map(item=>item===next?{...next,attempt:{...next.attempt,phase:'rejected',error:'请求尚未发送，请先解决本地保存问题。'}}:item)};this.emit();return;
    }
    await this.send(next);
  }
  private async send(record:ContinuationDraft){
    const attempt=record.attempt!,request=attempt.request;if(this.pending.has(request.commandId))return;
    this.pending.add(request.commandId);this.emit();
    try{const receipt=checkedContinuationReceipt(await this.ports.submit(structuredClone(request)),request,attempt.receipt);this.update({...record,attempt:{...attempt,phase:'accepted',receipt,error:undefined}})}
    catch(error){const rejected=!attempt.uncertain&&continuationRejected(error);this.update({...record,attempt:{...attempt,phase:rejected?'rejected':'unknown',uncertain:!rejected,error:textError(error)}})}
    finally{this.pending.delete(request.commandId);this.emit()}
  }
  /** 未知结果只能重发原命令与原正文；当前模型选择不会替换已冻结 options。 */
  async retry(scopeId:string,waitId:string){const record=this.record(scopeId,waitId);if(this.unavailable||record?.attempt?.phase!=='unknown'||this.isPending(record))return;if(!this.update({...record,attempt:{...record.attempt,uncertain:true}}))return;await this.send(record)}
  /** 只读回执；undefined 不证明请求未执行，因此仍保持 unknown。 */
  async query(scopeId:string,waitId:string){
    const record=this.record(scopeId,waitId),attempt=record?.attempt;if(this.unavailable||!record||!attempt||this.isPending(record))return;
    const request=attempt.request;this.pending.add(request.commandId);this.emit();
    try{
      const raw=await this.ports.lookup({workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,scopeId:request.scopeId,commandId:request.commandId});
      if(raw===undefined){if(attempt.phase!=='accepted')this.update({...record,attempt:{...attempt,phase:'unknown',uncertain:true,error:'尚未查到回执；只能查询或使用原请求重试。'}})}
      else this.update({...record,attempt:{...attempt,phase:'accepted',receipt:checkedContinuationReceipt(raw,request,attempt.receipt),error:undefined}});
    }catch(error){this.update({...record,attempt:{...attempt,phase:attempt.phase==='accepted'?'accepted':'unknown',uncertain:true,error:'查询结果未确认：'+textError(error)}})}
    finally{this.pending.delete(request.commandId);this.emit()}
  }
  /** 重开只补查未知请求，不自动发送；等待或选择变化也不会触发模型。 */
  async restore(){await Promise.all(this.value.records.filter(item=>item.attempt?.phase==='unknown').map(item=>this.query(item.scopeId,item.waitId)))}
}

/** 同一 renderer 重访工作区时复用在途控制器，避免旧回执覆盖新草稿；闲置历史采用有界缓存。 */
export class ScopeContinuationPool {
  private controllers=new Map<string,ScopeContinuationController>();
  constructor(private idleLimit=16){}
  get(workspaceId:string,rootSessionId:string,ports:ContinuationPorts){
    const key=JSON.stringify([workspaceId,rootSessionId]);
    const controller=this.controllers.get(key)??new ScopeContinuationController(workspaceId,rootSessionId,ports);
    this.controllers.delete(key);this.controllers.set(key,controller);
    for(const [oldKey,old] of this.controllers){if(this.controllers.size<=this.idleLimit)break;if(oldKey!==key&&old.canRelease)this.controllers.delete(oldKey)}
    return controller;
  }
}
