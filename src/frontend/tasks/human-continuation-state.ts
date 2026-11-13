/**
 * 作用定位：管理按真实人工决定继续的独立持久请求，供主会话两处目标卡共享。
 * 设计原因：继续会产生新运行，必须先保存固定决定与配置再发送；通信未知不能借新意见或新模型换命令重播。
 * 职责边界：不生成批准、不改原始输入、不自动发起工作；重开只查询未确认的原命令。
 * 公共比较：通过前端 utility 保持原键排序与空值语义；身份、版本、回执和恢复决策仍由本控制器负责。
 */
import {equalJson as equal} from '../foundations/utility';
import {humanContinuationRequestSchema,humanContinuationReceiptSchema} from '../../bridge/contracts/human-continue';
import type {HumanContinuationRequest,HumanContinuationReceipt,HumanContinuationLookup} from '../../bridge/contracts/human-continue';

export type HumanContinuationTarget=Omit<HumanContinuationRequest,'commandId'|'options'>;
/** uncertain 一旦为真，后来拒绝也不能解除冻结；receipt 表示意图受理，不表示目标完成。 */
export interface HumanContinuationAttempt {request:HumanContinuationRequest;phase:'submitting'|'unknown'|'accepted'|'rejected';uncertain:boolean;receipt?:HumanContinuationReceipt;error?:string}
/** 每次真实等待一条启动意图，已受理后不可换 ID；新的等待使用新记录。 */
export interface HumanContinuationDraft {scopeId:string;waitId:string;attempt:HumanContinuationAttempt}
export interface HumanContinuationState {records:readonly HumanContinuationDraft[];error:string}
/** submit 可能已在后端受理后丢失响应，lookup 为空也不能证明未受理；storage 失败必须先阻止发送。 */
export interface HumanContinuationPorts {storage:Pick<Storage,'getItem'|'setItem'>;submit:(request:HumanContinuationRequest)=>Promise<unknown>;lookup:(input:HumanContinuationLookup)=>Promise<unknown>;uuid:()=>string}
const textError=(error:unknown)=>error instanceof Error?error.message:String(error);
const sameIds=(a:string[],b:string[])=>equal([...a].sort(),[...b].sort());
/** 仅明确尚未受理的领域拒绝可重新提交；命令冲突、运行失败和未知 IO 始终冻结。 */
export function humanContinuationRejected(error:unknown){return /^(?:CAPACITY_BUSY|SCOPE_BUDGET_EXCEEDED|SCOPE_BUDGET_UNVERIFIABLE|SCOPE_BUDGET_WAITING|HUMAN_CONTINUATION_INPUT|HUMAN_CONTINUATION_IDENTITY|HUMAN_CONTINUATION_NOT_WAITING|HUMAN_CONTINUATION_UNAVAILABLE|HUMAN_CONTINUATION_NOT_READY|HUMAN_CONTINUATION_LIMIT|HUMAN_CONTINUATION_STALE|HUMAN_NOT_WAITING|HUMAN_IDENTITY|HUMAN_SOURCE_INVALID|HUMAN_KNOWLEDGE_CHANGED|HUMAN_EVIDENCE_INVALID|HUMAN_STALE|HUMAN_REVISION_CONFLICT|GOAL_IDENTITY|GOAL_NOT_WAITING|GOAL_WAIT_CONFLICT|GOAL_REVISION_CONFLICT|GOAL_CYCLE_LIMIT|GOAL_DECISION_LIMIT|GOAL_RUN_CONFLICT|GOAL_INPUT_LIMIT|GOAL_WORK_PENDING|IDENTITY|CONTINUATION_NOT_READY):/.test(textError(error))}

/** 接受回执不是目标完成；查询允许外层状态变化，但不可替换原意图的固定内容。 */
export function checkedHumanContinuationReceipt(raw:unknown,request:HumanContinuationRequest,previous?:HumanContinuationReceipt):HumanContinuationReceipt{
  const receipt=humanContinuationReceiptSchema.parse(raw),value=receipt.continuation;
  if(receipt.workspaceId!==request.workspaceId||receipt.rootSessionId!==request.rootSessionId||receipt.scopeId!==request.scopeId||value.continuationId!==request.commandId||value.wait.waitId!==request.waitId||value.wait.goalRevision!==request.expectedGoalRevision||value.inputRevision!==request.expectedInputRevision+1||value.decisionRevision!==request.expectedDecisionRevision||!sameIds(value.decisionIds,request.decisionIds)||!equal(value.options,request.options)||previous&&!equal(previous.continuation,value))throw Error('人工决定接续回执与冻结请求不一致，请查询原命令');
  return receipt;
}

export class HumanContinuationController {
  private value:HumanContinuationState={records:[],error:''};
  private unavailable=false;
  private listeners=new Set<()=>void>();
  private pending=new Set<string>();
  readonly storageKey:string;
  constructor(readonly workspaceId:string,readonly rootSessionId:string,private ports:HumanContinuationPorts){
    this.storageKey='cbim.human-continuation.v1.'+JSON.stringify([workspaceId,rootSessionId]);
    try{
      const raw=ports.storage.getItem(this.storageKey);if(!raw)return;if(new TextEncoder().encode(raw).length>2*1024*1024)throw Error('本地意图超过容量上限');
      const saved=JSON.parse(raw);if(saved.version!==1||saved.workspaceId!==workspaceId||saved.rootSessionId!==rootSessionId||!Array.isArray(saved.records)||saved.records.length>128)throw Error('本地记录格式或归属不匹配');
      const seen=new Set<string>();const records:HumanContinuationDraft[]=saved.records.map((entry:any)=>{
        const request=humanContinuationRequestSchema.parse(entry.attempt?.request),key=JSON.stringify([request.scopeId,request.waitId]);
        if(request.workspaceId!==workspaceId||request.rootSessionId!==rootSessionId||request.scopeId!==entry.scopeId||request.waitId!==entry.waitId||seen.has(key)||!['submitting','unknown','accepted','rejected'].includes(entry.attempt.phase))throw Error('冻结意图身份、状态或唯一性不匹配');seen.add(key);
        const receipt=entry.attempt.receipt?checkedHumanContinuationReceipt(entry.attempt.receipt,request):undefined;if(entry.attempt.phase==='accepted'&&!receipt)throw Error('已受理意图没有回执');
        const unknown=['submitting','unknown'].includes(entry.attempt.phase);return {scopeId:request.scopeId,waitId:request.waitId,attempt:{request,phase:unknown?'unknown':entry.attempt.phase,uncertain:unknown||!!entry.attempt.uncertain,receipt,error:typeof entry.attempt.error==='string'?entry.attempt.error:undefined}};
      });this.value={records,error:''};
    }catch(error){this.unavailable=true;this.value={records:[],error:'本地接续意图无法读取，未启动执行：'+textError(error)}}
  }
  get snapshot(){return this.value}
  get available(){return !this.unavailable}
  get canRelease(){return !this.listeners.size&&!this.pending.size}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  record(scopeId:string,waitId:string){return this.value.records.find(value=>value.scopeId===scopeId&&value.waitId===waitId)}
  isPending(record?:HumanContinuationDraft){return !!record&&this.pending.has(record.attempt.request.commandId)}
  private emit(){for(const listener of this.listeners)listener()}
  private update(record:HumanContinuationDraft):boolean{
    const records=[...this.value.records],index=records.findIndex(value=>value.scopeId===record.scopeId&&value.waitId===record.waitId);if(index<0)records.push(record);else records[index]=record;this.value={records,error:''};
    try{const raw=JSON.stringify({version:1,workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,records});if(records.length>128||new TextEncoder().encode(raw).length>2*1024*1024)throw Error('本地记录超过容量上限');this.ports.storage.setItem(this.storageKey,raw);this.unavailable=false;this.emit();return true}
    catch(error){this.unavailable=true;this.value={records,error:'接续意图未能保存，保留当前请求并停止发送：'+textError(error)};this.emit();return false}
  }
  /** 只有明确点击调用；无需自由正文，最新决定、等待版本与执行配置一并冻结。 */
  async submit(target:HumanContinuationTarget,options:HumanContinuationRequest['options']){
    if(!this.available||target.workspaceId!==this.workspaceId||target.rootSessionId!==this.rootSessionId)return;
    const old=this.record(target.scopeId,target.waitId);if(old&&(old.attempt.phase!=='rejected'||this.isPending(old)))return;
    let request:HumanContinuationRequest;try{request=humanContinuationRequestSchema.parse({...target,commandId:this.ports.uuid(),options})}catch(error){this.value={...this.value,error:textError(error)};this.emit();return}
    const record:HumanContinuationDraft={scopeId:target.scopeId,waitId:target.waitId,attempt:{request,phase:'submitting',uncertain:false}};if(this.update(record))await this.send(record);
  }
  private async send(record:HumanContinuationDraft){
    const {attempt}=record,request=attempt.request;if(this.pending.has(request.commandId))return;this.pending.add(request.commandId);this.emit();
    try{const receipt=checkedHumanContinuationReceipt(await this.ports.submit(structuredClone(request)),request,attempt.receipt);this.update({...record,attempt:{...attempt,phase:'accepted',receipt,error:undefined}})}
    catch(error){const rejected=!attempt.uncertain&&humanContinuationRejected(error);this.update({...record,attempt:{...attempt,phase:rejected?'rejected':'unknown',uncertain:!rejected,error:textError(error)}})}
    finally{this.pending.delete(request.commandId);this.emit()}
  }
  /** 原命令重试不采纳后来选择的意见、模型或权限。 */
  async retry(scopeId:string,waitId:string){const record=this.record(scopeId,waitId);if(this.available&&record?.attempt.phase==='unknown'&&!this.isPending(record))await this.send(record)}
  /** 未找到回执不能推出未执行；存储暂时不可写仍允许核实已有请求，只读查询不发起新运行。 */
  async query(scopeId:string,waitId:string){
    const record=this.record(scopeId,waitId);if(!record||this.isPending(record))return;
    const {attempt}=record,request=attempt.request;this.pending.add(request.commandId);this.emit();
    try{const raw=await this.ports.lookup({workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,scopeId:request.scopeId,commandId:request.commandId});if(raw!==undefined)this.update({...record,attempt:{...attempt,phase:'accepted',receipt:checkedHumanContinuationReceipt(raw,request,attempt.receipt),error:undefined}});else if(attempt.phase!=='accepted')this.update({...record,attempt:{...attempt,phase:'unknown',uncertain:true,error:'尚未查到回执；保留原请求，请继续查询或原请求重试。'}})}
    catch(error){this.update({...record,attempt:{...attempt,phase:attempt.phase==='accepted'?'accepted':'unknown',uncertain:true,error:'查询结果未确认：'+textError(error)}})}
    finally{this.pending.delete(request.commandId);this.emit()}
  }
  async restore(){await Promise.all(this.value.records.filter(value=>value.attempt.phase==='unknown').map(value=>this.query(value.scopeId,value.waitId)))}
}

/** 同一 renderer 的两个卡片及重访共用在途命令，空闲历史允许从有界缓存回收。 */
export class HumanContinuationPool {
  private controllers=new Map<string,HumanContinuationController>();
  get(workspaceId:string,rootSessionId:string,ports:HumanContinuationPorts){const key=JSON.stringify([workspaceId,rootSessionId]),value=this.controllers.get(key)??new HumanContinuationController(workspaceId,rootSessionId,ports);this.controllers.delete(key);this.controllers.set(key,value);for(const [oldKey,old]of this.controllers){if(this.controllers.size<=16)break;if(oldKey!==key&&old.canRelease)this.controllers.delete(oldKey)}return value}
}
