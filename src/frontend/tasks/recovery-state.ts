/**
 * 作用定位：保存用户从异常报告新建只读核实周期的草稿、冻结命令和受理回执。
 * 设计原因：新周期不是恢复旧运行；先持久化再发送，通信未知只查询或重试同一命令。来源身份独立于报告版本，重新核实不能藏起一个尚未确认的请求。
 */
import {recoveryRequestSchema,recoveryReceiptSchema} from '../../bridge/contracts/dispatch';
import type {RecoveryRequest,RecoveryLookup,RecoveryReceipt} from '../../bridge/contracts/dispatch';

export type RecoverySource=Omit<RecoveryRequest['source'],'reportBasis'>;
export type RecoveryTarget=Pick<RecoveryRequest,'workspaceId'|'rootSessionId'|'source'>;
export interface RecoveryAttempt {
  /** 保存时即固定正文、核实依据与只读模型设置；后续界面选择不能改写在途请求。 */
  request:RecoveryRequest;phase:'submitting'|'unknown'|'accepted'|'rejected';uncertain:boolean;
  receipt?:RecoveryReceipt;error?:string;
}
export interface RecoveryDraft {source:RecoverySource;observation:string;message:string;attempt?:RecoveryAttempt}
export interface RecoveryState {records:readonly RecoveryDraft[];error:string}
export interface RecoveryPorts {
  storage:Pick<Storage,'getItem'|'setItem'>;
  submit:(request:RecoveryRequest)=>Promise<unknown>;
  lookup:(request:RecoveryLookup)=>Promise<unknown>;
  uuid:()=>string;
}
/** 报告更新不改变草稿归属；workspace/root 由外层控制器固定，不与目标补充的 waitId 混用。 */
export const recoverySourceKey=(source:RecoverySource)=>JSON.stringify([source.scopeId,source.taskId,source.runId]);
const sourceIdentity=(source:RecoverySource):RecoverySource=>({scopeId:source.scopeId,taskId:source.taskId,...(source.runId?{runId:source.runId}:{})});
const textError=(error:unknown)=>error instanceof Error?error.message:String(error);
const sameOptions=(a:RecoveryRequest['options'],b:RecoveryRequest['options'])=>a.provider===b.provider&&a.model===b.model&&a.profileId===b.profileId&&a.permission===b.permission&&a.turnTimeoutMs===b.turnTimeoutMs;
/** 仅协议明确保证尚未受理的拒绝才可重新编辑；冲突、IO 与未知代码保持冻结。 */
export function recoveryRejected(error:unknown){return /^(?:RECOVERY_INPUT_INVALID|RECOVERY_IDENTITY|RECOVERY_SOURCE_NOT_CLOSED|RECOVERY_BUSY|RECOVERY_SOURCE_INVALID|RECOVERY_RUN_REQUIRED|RECOVERY_UNAVAILABLE|RECOVERY_REPORT_STALE|RECOVERY_CONTEXT_CONFLICT):/.test(textError(error))}

/** 回执需匹配原始命令及内容，新周期和新运行不能借用来源身份；受理不等于正在运行。 */
export function checkedRecoveryReceipt(raw:unknown,request:RecoveryRequest,previous?:RecoveryReceipt):RecoveryReceipt{
  const receipt=recoveryReceiptSchema.parse(raw),value=receipt.recovery;
  if(receipt.workspaceId!==request.workspaceId||receipt.rootSessionId!==request.rootSessionId||receipt.scopeId!==request.commandId||receipt.scopeId===request.source.scopeId||value.recoveryId!==request.commandId||recoverySourceKey(value.source)!==recoverySourceKey(request.source)||value.source.reportBasis!==request.source.reportBasis||value.operation!==request.operation||value.observation.text!==request.observation.text||value.input.message!==request.input.message||!sameOptions(value.options,request.options)||value.runId===request.source.runId)throw Error('核实任务回执与冻结请求不一致，请查询原命令');
  // 受理事实不可改写；后续查询仅允许周期状态演进，不能把同命令指向另一个启动运行或来源版本。
  if(previous&&(JSON.stringify(value)!==JSON.stringify(previous.recovery)||previous.scopeStatus==='closed'&&receipt.scopeStatus!=='closed'))throw Error('同一核实命令的受理事实发生冲突，保留原回执');
  return receipt;
}

/** 每个主会话一份持久索引；来源删除、选中节点变化或报告更新均不丢弃未确认命令。 */
export class ExecutionRecoveryController {
  private value:RecoveryState={records:[],error:''};
  private unavailable=false;
  private listeners=new Set<()=>void>();
  private pending=new Set<string>();
  readonly storageKey:string;
  constructor(readonly workspaceId:string,readonly rootSessionId:string,private ports:RecoveryPorts){
    this.storageKey='cbim.execution-recovery.v1.'+JSON.stringify([workspaceId,rootSessionId]);
    try{
      const text=ports.storage.getItem(this.storageKey);if(!text)return;
      const saved=JSON.parse(text);if(saved.version!==1||saved.workspaceId!==workspaceId||saved.rootSessionId!==rootSessionId||!Array.isArray(saved.records))throw Error('本地核实请求格式不匹配');
      const keys=new Set<string>();
      const records:RecoveryDraft[]=saved.records.map((entry:any)=>{
        const source=recoveryRequestSchema.shape.source.omit({reportBasis:true}).parse(entry.source);
        if(typeof entry.observation!=='string'||typeof entry.message!=='string'||entry.observation.length>64000||entry.message.length>64000)throw Error('本地核实草稿无效');
        const key=recoverySourceKey(source);if(keys.has(key))throw Error('本地核实来源重复');keys.add(key);
        if(!entry.attempt)return {source,observation:entry.observation,message:entry.message};
        const request=recoveryRequestSchema.parse(entry.attempt.request);
        if(request.workspaceId!==workspaceId||request.rootSessionId!==rootSessionId||recoverySourceKey(request.source)!==key||!['submitting','unknown','accepted','rejected'].includes(entry.attempt.phase))throw Error('本地核实命令身份不匹配');
        if(entry.attempt.phase!=='rejected'&&(request.input.message!==entry.message||request.observation.text!==entry.observation))throw Error('本地核实正文与冻结命令不一致');
        const receipt=entry.attempt.receipt?checkedRecoveryReceipt(entry.attempt.receipt,request):undefined;
        if(entry.attempt.phase==='accepted'&&!receipt)throw Error('已受理核实任务缺少回执');
        const unresolved=entry.attempt.phase==='submitting'||entry.attempt.phase==='unknown';
        return {source,observation:entry.observation,message:entry.message,attempt:{request,phase:unresolved?'unknown':entry.attempt.phase,uncertain:unresolved||!!entry.attempt.uncertain,receipt,error:typeof entry.attempt.error==='string'?entry.attempt.error:undefined}};
      });this.value={records,error:''};
    }catch(error){this.unavailable=true;this.value={records:[],error:'本地核实记录无法读取，未发送请求：'+textError(error)}}
  }
  get snapshot(){return this.value}
  get available(){return !this.unavailable}
  get canRelease(){return this.listeners.size===0&&this.pending.size===0}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  record(source:RecoverySource){const key=recoverySourceKey(source);return this.value.records.find(item=>recoverySourceKey(item.source)===key)}
  isPending(record?:RecoveryDraft){return !!record?.attempt&&this.pending.has(record.attempt.request.commandId)}
  private emit(){for(const listener of this.listeners)listener()}
  private update(record:RecoveryDraft):boolean{
    const key=recoverySourceKey(record.source),index=this.value.records.findIndex(item=>recoverySourceKey(item.source)===key),records=[...this.value.records];if(index<0)records.push(record);else records[index]=record;
    this.value={records,error:''};let saved=true;
    try{if(this.unavailable)throw Error('本地记录不可用');this.ports.storage.setItem(this.storageKey,JSON.stringify({version:1,workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,records}))}
    catch(error){saved=false;this.value={...this.value,error:'核实请求未能保存：'+textError(error)}}this.emit();return saved;
  }
  /** 编辑只影响当前来源的未提交草稿；报告 basis 不写入草稿 key。 */
  edit(source:RecoverySource,fields:{observation:string;message:string}){
    if(this.unavailable||fields.observation.length>64000||fields.message.length>64000)return;
    const old=this.record(source);if(old?.attempt&&old.attempt.phase!=='rejected')return;
    this.update({source:sourceIdentity(source),...fields,attempt:old?.attempt});
  }
  /** 仅首次明确点击构造命令；保存失败不调用后端，双击不能绕过冻结状态。 */
  async submit(target:RecoveryTarget,options:RecoveryRequest['options']){
    if(this.unavailable||target.workspaceId!==this.workspaceId||target.rootSessionId!==this.rootSessionId)return;
    const record=this.record(target.source);if(!record||record.attempt&&record.attempt.phase!=='rejected')return;
    let request:RecoveryRequest;
    try{request=recoveryRequestSchema.parse({...target,commandId:this.ports.uuid(),operation:'inspect_effects',observation:{text:record.observation},input:{message:record.message},options})}
    catch(error){this.value={...this.value,error:'核实目标或模型配置无效：'+textError(error)};this.emit();return}
    const next={...record,attempt:{request,phase:'submitting' as const,uncertain:false}};
    if(!this.update(next)){this.value={...this.value,records:this.value.records.map(item=>item===next?{...next,attempt:{...next.attempt,phase:'rejected',error:'请求尚未发送，请先解决本地保存问题。'}}:item)};this.emit();return}
    await this.send(next);
  }
  private async send(record:RecoveryDraft){
    const attempt=record.attempt!,request=attempt.request;if(this.pending.has(request.commandId))return;
    this.pending.add(request.commandId);this.emit();
    try{const receipt=checkedRecoveryReceipt(await this.ports.submit(structuredClone(request)),request,attempt.receipt);this.update({...record,attempt:{...attempt,phase:'accepted',receipt,error:undefined}})}
    catch(error){const rejected=!attempt.uncertain&&recoveryRejected(error);this.update({...record,attempt:{...attempt,phase:rejected?'rejected':'unknown',uncertain:!rejected,error:textError(error)}})}
    finally{this.pending.delete(request.commandId);this.emit()}
  }
  /** 同命令重试不重新读取模型或报告。当前图已改变也须由后端先查询该命令，不能换 ID 重建。 */
  async retry(source:RecoverySource){const record=this.record(source);if(this.unavailable||record?.attempt?.phase!=='unknown'||this.isPending(record))return;const next={...record,attempt:{...record.attempt,uncertain:true}};if(this.update(next))await this.send(next)}
  /** 没有查询到回执仍是未知；已有受理事实不能被一次查询失败降为未受理。 */
  async query(source:RecoverySource){
    const record=this.record(source),attempt=record?.attempt;if(this.unavailable||!record||!attempt||this.isPending(record))return;
    const request=attempt.request;this.pending.add(request.commandId);this.emit();
    try{
      const raw=await this.ports.lookup({workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,commandId:request.commandId});
      if(raw!==undefined)this.update({...record,attempt:{...attempt,phase:'accepted',receipt:checkedRecoveryReceipt(raw,request,attempt.receipt),error:undefined}});
      else if(attempt.phase!=='accepted')this.update({...record,attempt:{...attempt,phase:'unknown',uncertain:true,error:'尚未查到回执；只能查询或使用原请求重试。'}});
    }catch(error){this.update({...record,attempt:{...attempt,phase:attempt.phase==='accepted'?'accepted':'unknown',uncertain:true,error:'查询结果未确认：'+textError(error)}})}
    finally{this.pending.delete(request.commandId);this.emit()}
  }
  /** 重开只查询未确认命令，不发送模型任务或重新运行旧工具。 */
  async restore(){await Promise.all(this.value.records.filter(item=>item.attempt?.phase==='unknown').map(item=>this.query(item.source)))}
}

/** 切换节点/工作区仍保留在途请求，闲置且无观察者的控制器可回收后从本机记录恢复。 */
export class ExecutionRecoveryPool {
  private controllers=new Map<string,ExecutionRecoveryController>();
  constructor(private idleLimit=16){}
  get(workspaceId:string,rootSessionId:string,ports:RecoveryPorts){
    const key=JSON.stringify([workspaceId,rootSessionId]),controller=this.controllers.get(key)??new ExecutionRecoveryController(workspaceId,rootSessionId,ports);
    this.controllers.delete(key);this.controllers.set(key,controller);
    for(const [oldKey,old] of this.controllers){if(this.controllers.size<=this.idleLimit)break;if(oldKey!==key&&old.canRelease)this.controllers.delete(oldKey)}
    return controller;
  }
}
