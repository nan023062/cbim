/**
 * 作用定位：保存用户从异常报告新建只读核实周期的草稿、冻结命令和受理回执。
 * 设计原因：新周期不是恢复旧运行；先持久化再发送，未知结果只查原命令。明确再次核实须重新确认旧周期已关闭并保存完整历史，保存失败不解锁，报告版本不参与来源键。
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
export type RecoveryArchive=RecoveryAttempt&{phase:'accepted';receipt:RecoveryReceipt};
export interface RecoveryDraft {source:RecoverySource;observation:string;message:string;attempt?:RecoveryAttempt;history?:readonly RecoveryArchive[]}
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
/** 上限只拒绝新增保存，不淘汰旧请求；实际浏览器配额不足也须保留原锁定状态。 */
export const RECOVERY_SOURCE_HISTORY_LIMIT=32,RECOVERY_ROOT_HISTORY_LIMIT=128,RECOVERY_INDEX_BYTE_LIMIT=2*1024*1024;
/** 回执会复制冻结正文/选项；另留 8 KiB 给身份、ISO 时间及可信版本字段，防止发送成功后无处保存受理事实。 */
const receiptReserve=(record:RecoveryDraft)=>record.attempt&&!record.attempt.receipt&&['submitting','unknown'].includes(record.attempt.phase)?new TextEncoder().encode(JSON.stringify(record.attempt.request)).length+8192:0;
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
  /** v1 始终保留原字节；回滚旧客户端不会覆盖 v2 的在途命令或归档。 */
  readonly legacyStorageKey:string;
  constructor(readonly workspaceId:string,readonly rootSessionId:string,private ports:RecoveryPorts){
    this.storageKey='cbim.execution-recovery.v2.'+JSON.stringify([workspaceId,rootSessionId]);
    this.legacyStorageKey='cbim.execution-recovery.v1.'+JSON.stringify([workspaceId,rootSessionId]);
    try{
      const current=ports.storage.getItem(this.storageKey),text=current??ports.storage.getItem(this.legacyStorageKey);if(text===null)return;
      const saved=JSON.parse(text);if(saved.version!==(current===null?1:2)||saved.workspaceId!==workspaceId||saved.rootSessionId!==rootSessionId||!Array.isArray(saved.records))throw Error('本地核实请求格式不匹配');
      const keys=new Set<string>(),commands=new Set<string>();
      const parseAttempt=(raw:any,source:RecoverySource):RecoveryAttempt=>{
        const request=recoveryRequestSchema.parse(raw?.request);
        if(request.workspaceId!==workspaceId||request.rootSessionId!==rootSessionId||recoverySourceKey(request.source)!==recoverySourceKey(source)||!['submitting','unknown','accepted','rejected'].includes(raw.phase))throw Error('本地核实命令身份不匹配');
        if(commands.has(request.commandId))throw Error('本地核实命令出现重复身份');commands.add(request.commandId);
        const receipt=raw.receipt?checkedRecoveryReceipt(raw.receipt,request):undefined;
        if(raw.phase==='accepted'&&!receipt)throw Error('已受理核实任务缺少回执');
        const unresolved=raw.phase==='submitting'||raw.phase==='unknown';
        return {request,phase:unresolved?'unknown':raw.phase,uncertain:unresolved||!!raw.uncertain,receipt,error:typeof raw.error==='string'?raw.error:undefined};
      };
      const records:RecoveryDraft[]=saved.records.map((entry:any)=>{
        const source=recoveryRequestSchema.shape.source.omit({reportBasis:true}).parse(entry.source);
        if(typeof entry.observation!=='string'||typeof entry.message!=='string'||entry.observation.length>64000||entry.message.length>64000)throw Error('本地核实草稿无效');
        const key=recoverySourceKey(source);if(keys.has(key))throw Error('本地核实来源重复');keys.add(key);
        if(entry.history!==undefined&&!Array.isArray(entry.history))throw Error('本地核实历史格式不匹配');
        const history:RecoveryArchive[]=(entry.history??[]).map((raw:any)=>{const attempt=parseAttempt(raw,source);if(attempt.phase!=='accepted'||attempt.receipt?.scopeStatus!=='closed')throw Error('核实历史只能保存已关闭的受理记录');return attempt as RecoveryArchive});
        const attempt=entry.attempt?parseAttempt(entry.attempt,source):undefined;
        if(attempt&&attempt.phase!=='rejected'&&(attempt.request.input.message!==entry.message||attempt.request.observation.text!==entry.observation))throw Error('本地核实正文与冻结命令不一致');
        return {source,observation:entry.observation,message:entry.message,history,attempt};
      });this.value={records,error:''};
    }catch(error){this.unavailable=true;this.value={records:[],error:'本地核实记录无法读取，未发送请求：'+textError(error)}}
  }
  get snapshot(){return this.value}
  get available(){return !this.unavailable}
  get canRelease(){return this.listeners.size===0&&this.pending.size===0}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  /** 归档成功先使该来源各视图的旧报告失效，再通知重绘；挂载期间错过的变更也会补查。 */
  subscribeSource(source:RecoverySource,listener:()=>void,onPrepared:()=>void,observedHistoryCount=this.record(source)?.history?.length??0){
    let count=observedHistoryCount;
    const changed=()=>{const next=this.record(source)?.history?.length??0;if(next!==count){count=next;onPrepared()}listener()};
    const unsubscribe=this.subscribe(changed);changed();return unsubscribe;
  }
  record(source:RecoverySource){const key=recoverySourceKey(source);return this.value.records.find(item=>recoverySourceKey(item.source)===key)}
  isPending(record?:RecoveryDraft){return !!record?.attempt&&this.pending.has(record.attempt.request.commandId)}
  private emit(){for(const listener of this.listeners)listener()}
  private update(record:RecoveryDraft):boolean{
    const key=recoverySourceKey(record.source),index=this.value.records.findIndex(item=>recoverySourceKey(item.source)===key),records=[...this.value.records];if(index<0)records.push(record);else records[index]=record;
    try{
      if(this.unavailable)throw Error('本地记录不可用');
      if(records.some(item=>(item.history?.length??0)>RECOVERY_SOURCE_HISTORY_LIMIT)||records.reduce((total,item)=>total+(item.history?.length??0),0)>RECOVERY_ROOT_HISTORY_LIMIT)throw Error('本地核实历史达到保存上限，原记录保持不变');
      const saved=JSON.stringify({version:2,workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,records});
      if(new TextEncoder().encode(saved).length+records.reduce((total,item)=>total+receiptReserve(item),0)>RECOVERY_INDEX_BYTE_LIMIT)throw Error('本地核实记录及未决回执预留超过 2 MiB 保存上限，原记录保持不变');
      this.ports.storage.setItem(this.storageKey,saved);
    }catch(error){this.value={...this.value,error:'核实请求未能保存：'+textError(error)};this.emit();return false}
    // 只有保存成功才能发布新草稿/解除 accepted 锁；提交后的存储失败仍保留原 command 供查询。
    this.value={records,error:''};this.emit();return true;
  }
  /** 编辑只影响当前来源的未提交草稿；报告 basis 不写入草稿 key。 */
  edit(source:RecoverySource,fields:{observation:string;message:string}){
    if(this.unavailable||fields.observation.length>64000||fields.message.length>64000)return;
    const old=this.record(source);if(old?.attempt&&old.attempt.phase!=='rejected')return;
    this.update({source:sourceIdentity(source),...fields,history:old?.history??[],attempt:old?.attempt});
  }
  /** 仅首次明确点击构造命令；保存失败不调用后端，双击不能绕过冻结状态。 */
  async submit(target:RecoveryTarget,options:RecoveryRequest['options']){
    if(this.unavailable||target.workspaceId!==this.workspaceId||target.rootSessionId!==this.rootSessionId)return;
    const record=this.record(target.source);if(!record||record.attempt&&record.attempt.phase!=='rejected')return;
    let request:RecoveryRequest;
    try{
      request=recoveryRequestSchema.parse({...target,commandId:this.ports.uuid(),operation:'inspect_effects',observation:{text:record.observation},input:{message:record.message},options});
      if(this.value.records.some(item=>item.attempt?.request.commandId===request.commandId||item.history?.some(old=>old.request.commandId===request.commandId)))throw Error('新命令与已有核实记录重号，请重新提交');
    }
    catch(error){this.value={...this.value,error:'核实目标或模型配置无效：'+textError(error)};this.emit();return}
    const next={...record,attempt:{request,phase:'submitting' as const,uncertain:false}};
    if(!this.update(next))return;
    await this.send(next);
  }
  /**
   * 明确准备下一次核实：重新查询旧受理命令，确认 closed 后完整归档，再保存无命令的新草稿。
   * 查询缺失、冲突、在途或本地保存失败均不解锁；不生成 UUID、不发启动请求，也不改旧周期。
   */
  async prepareAgain(source:RecoverySource,expectedCommandId:string):Promise<boolean>{
    const record=this.record(source),attempt=record?.attempt;
    if(this.unavailable||!record||attempt?.phase!=='accepted'||attempt.receipt?.scopeStatus!=='closed'||attempt.request.commandId!==expectedCommandId||this.isPending(record))return false;
    const request=attempt.request;this.pending.add(request.commandId);this.emit();
    try{
      const raw=await this.ports.lookup({workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,commandId:request.commandId});
      if(raw===undefined)throw Error('本次查询未确认旧周期已关闭，保留原请求');
      const receipt=checkedRecoveryReceipt(raw,request,attempt.receipt);
      if(receipt.scopeStatus!=='closed')throw Error('旧核实周期尚未关闭，不能准备新草稿');
      if(this.record(source)?.attempt?.request.commandId!==expectedCommandId)throw Error('当前核实请求已变化，保留原记录');
      return this.update({...record,attempt:undefined,history:[...(record.history??[]),{...attempt,phase:'accepted',receipt}]});
    }catch(error){this.value={...this.value,error:'未能准备再次核实：'+textError(error)};this.emit();return false}
    finally{this.pending.delete(request.commandId);this.emit()}
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
