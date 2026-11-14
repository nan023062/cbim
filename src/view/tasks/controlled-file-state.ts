/**
 * 作用定位：维护同主会话的受控文件报告、补偿预览和本机原命令索引，供成员详情共享。
 * 设计原因：显式补偿先持久固定请求再发送；未知只能查原命令，查询失败保留已知的受理前拒绝或终态，不能反向解除未知锁。重开不自动写文件。
 * 边界：只存公共身份及字节摘要，不保存 before 正文；读取没有轮询，晚到响应按原调用隔离，普通聊天草稿不在本控制器内。
 * 订阅边界：前端 SubscriptionSet 只持有监听器；通知时机、状态、轮询及销毁仍由本控制器决定。
 */
import {SubscriptionSet} from '../foundations/utility';
import {
  controlledFileLimits,controlledFileUtf8Bytes,controlledFileReportInputSchema,controlledFileReportSchema,controlledFileOperationSummarySchema,
  fileCompensationPreviewInputSchema,fileCompensationPreviewSchema,fileCompensationInputSchema,fileCompensationReceiptSchema,
} from '../../bridge/contracts/controlled-files';
import type {
  ControlledFileReportInput,ControlledFileReport,ControlledFileOperationSummary,ControlledFilePhase,
  FileCompensationPreviewInput,FileCompensationPreview,FileCompensationInput,FileCompensationLookup,FileCompensationReceipt,FileCompensationSummary,
} from '../../bridge/contracts/controlled-files';

/** source 是原可靠操作的公开快照，只用于核对原补偿回包，不能作为恢复正文或重新授权。 */
export interface FileCompensationAttempt {identity:ControlledFileReportInput;request:FileCompensationInput;source:ControlledFileOperationSummary;state:'sending'|'unknown'|'settled'|'rejected';receipt?:FileCompensationReceipt;error?:string}
export interface ControlledFileDraft {identity:ControlledFileReportInput;reason:string;commandId?:string}
export interface ControlledFileRead {report?:ControlledFileReport;preview?:FileCompensationPreview;anchor?:string;loading:boolean;error:string}
export interface ControlledFileState {drafts:readonly ControlledFileDraft[];attempts:readonly FileCompensationAttempt[];reads:Readonly<Record<string,ControlledFileRead>>;error:string}
/** 私有文件/进程能力不出现在该端口；只接受固定原调用及明确的新补偿命令。 */
export interface ControlledFilePorts {
  storage:Pick<Storage,'getItem'|'setItem'>;uuid:()=>string;
  report:(input:ControlledFileReportInput)=>Promise<unknown>;
  preview:(input:FileCompensationPreviewInput)=>Promise<unknown>;
  apply:(input:FileCompensationInput)=>Promise<unknown>;
  receipt:(input:FileCompensationLookup)=>Promise<unknown>;
}
export const CONTROLLED_FILE_LOCAL_BYTES=2*1024*1024,CONTROLLED_FILE_LOCAL_LIMIT=64;
export const controlledFileSelectionKey=(v:ControlledFileReportInput)=>JSON.stringify([v.workspaceId,v.rootSessionId,v.taskId,v.runId,v.toolCallId]);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const sameIdentity=(a:ControlledFileReportInput,b:ControlledFileReportInput)=>controlledFileSelectionKey(a)===controlledFileSelectionKey(b);
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
/** 只有后端保证尚未提交 prepared 的专用码可解除草稿锁；连接错误、CAS 和普通错误文本都不证明零写。 */
function knownPreAcceptRejection(error:unknown){return error instanceof Error&&/^(FILE_COMPENSATION_PRE_ACCEPT_INPUT|FILE_COMPENSATION_PRE_ACCEPT_REJECTED): /.test(error.message)}
const byteLength=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).length;
const terminal=(phase:ControlledFilePhase)=>phase==='applied'||phase==='not_applied'||phase==='unknown';
const ownsSource=(s:ControlledFileOperationSummary,i:ControlledFileReportInput)=>s.toolCallId===i.toolCallId&&(['workspaceId','rootSessionId','taskId','runId'] as const).every(k=>s.binding[k]===i[k]);
const localObject=(value:unknown,keys:readonly string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
/** 阶段可跳过未观察的中间版本，但不能倒退、同版改写或修改已观察终态。 */
function phaseAdvances(previous:{revision:number;phase:ControlledFilePhase},next:{revision:number;phase:ControlledFilePhase}){
  return next.revision>previous.revision&&!terminal(previous.phase)&&(previous.phase==='prepared'||next.revision===3&&terminal(next.phase));
}
/** 已见公开历史也是单调依据，不能因尚无本机完整回执而接受改名或退回的终态。 */
function summaryAdvances(previous:FileCompensationSummary,next:FileCompensationSummary){
  return previous.compensationId===next.compensationId&&previous.commandId===next.commandId&&previous.preparedAt===next.preparedAt&&(same(previous,next)||phaseAdvances(previous,next))&&Date.parse(next.updatedAt)>=Date.parse(previous.updatedAt);
}
function bounded(raw:unknown){if(byteLength(raw)>controlledFileLimits.outputBytes)throw Error('文件操作回包超过读取上限');return raw}
/** 报告必须属于所选真实调用；已读到的操作不能被后来查无或另一操作替代。 */
export function checkedControlledFileReport(raw:unknown,identity:ControlledFileReportInput,previous?:ControlledFileReport):ControlledFileReport{
  const report=controlledFileReportSchema.parse(bounded(raw));
  if(!sameIdentity(report.identity,identity))throw Error('文件操作报告不属于所选调用');
  if(previous?.ledger.state==='recorded'){
    if(report.ledger.state!=='recorded')throw Error('原已登记操作未能重新核实，保留上次记录');
    const a=previous.ledger.operation,b=report.ledger.operation;
    const fixed=(v:ControlledFileOperationSummary)=>{const {phase,revision,updatedAt,issue,...rest}=v;return rest};
    if(!same(fixed(a),fixed(b))||(!same(a,b)&&!phaseAdvances(a,b))||Date.parse(b.updatedAt)<Date.parse(a.updatedAt))throw Error('原文件操作记录发生冲突');
    for(const old of previous.ledger.compensations){const next=report.ledger.compensations.find(v=>v.compensationId===old.compensationId);if(!next||!summaryAdvances(old,next))throw Error('原补偿历史发生冲突')}
  }
  return report;
}
/** 补偿恢复原 before；回执不能借同一 command 返回另一文件、摘要或请求。 */
export function checkedFileCompensationReceipt(raw:unknown,request:FileCompensationInput,source:ControlledFileOperationSummary,previous?:FileCompensationReceipt):FileCompensationReceipt{
  const receipt=fileCompensationReceiptSchema.parse(bounded(raw));
  if(!same(receipt.request,fileCompensationInputSchema.parse(request))||receipt.operationId!==source.operationId||receipt.relativePath!==source.relativePath||!same(receipt.before,source.intendedAfter)||!same(receipt.after,source.before))throw Error('补偿回执与原请求或文件摘要不一致');
  if(previous){
    const fixed=(v:FileCompensationReceipt)=>{const {revision,phase,updatedAt,issue,...rest}=v;return rest};
    if(!same(fixed(previous),fixed(receipt))||(!same(previous,receipt)&&!phaseAdvances(previous,receipt))||Date.parse(receipt.updatedAt)<Date.parse(previous.updatedAt))throw Error('已保存补偿回执发生冲突，保留原记录');
  }
  return receipt;
}

/** 每主会话共享；构造、订阅和身份/图版本变化均不调用任何后端端口。 */
export class ControlledFileController {
  private value:ControlledFileState={drafts:[],attempts:[],reads:{},error:''};
  private listeners=new SubscriptionSet();private pending=new Set<string>();private anchors=new Map<string,string>();private unavailable=false;
  readonly storageKey:string;
  constructor(readonly workspaceId:string,readonly rootSessionId:string,private ports:ControlledFilePorts){
    this.storageKey='cbim.file-compensation.v1.'+JSON.stringify([workspaceId,rootSessionId]);
    try{
      const text=ports.storage.getItem(this.storageKey);if(text===null)return;
      if(new TextEncoder().encode(text).length>CONTROLLED_FILE_LOCAL_BYTES)throw Error('本机补偿索引超出读取上限');
      const saved=JSON.parse(text);
      if(!localObject(saved,['version','workspaceId','rootSessionId','drafts','attempts'])||saved.version!==1||saved.workspaceId!==workspaceId||saved.rootSessionId!==rootSessionId||!Array.isArray(saved.drafts)||!Array.isArray(saved.attempts)||saved.drafts.length>CONTROLLED_FILE_LOCAL_LIMIT||saved.attempts.length>CONTROLLED_FILE_LOCAL_LIMIT)throw Error('本机补偿索引格式无效');
      const ids=new Set<string>(),keys=new Set<string>();
      const attempts:FileCompensationAttempt[]=saved.attempts.map((raw:any)=>{
        if(!localObject(raw,['identity','request','source','state','receipt','error'])||raw.error!==undefined&&typeof raw.error!=='string')throw Error('本机补偿请求格式无效');
        const identity=controlledFileReportInputSchema.parse(raw.identity),request=fileCompensationInputSchema.parse(raw.request),source=controlledFileOperationSummarySchema.parse(raw.source);
        if(!this.owns(identity)||!this.owns(request)||!ownsSource(source,identity)||source.operationId!==request.operationId||source.phase!=='applied'||ids.has(request.commandId)||!['sending','unknown','settled','rejected'].includes(raw.state))throw Error('本机补偿请求身份无效');
        ids.add(request.commandId);const receipt=raw.receipt!==undefined?checkedFileCompensationReceipt(raw.receipt,request,source):undefined;
        if(raw.state==='settled'&&(!receipt||!['applied','not_applied'].includes(receipt.phase))||raw.state==='rejected'&&receipt)throw Error('本机补偿状态与回执不符');
        return {identity,request,source,state:raw.state==='sending'?'unknown':raw.state,receipt,error:typeof raw.error==='string'?raw.error.slice(0,4096):undefined};
      });
      const drafts:ControlledFileDraft[]=saved.drafts.map((raw:any)=>{
        if(!localObject(raw,['identity','reason','commandId'])||raw.commandId!==undefined&&typeof raw.commandId!=='string')throw Error('本机补偿草稿格式无效');
        const identity=controlledFileReportInputSchema.parse(raw.identity),key=controlledFileSelectionKey(identity),length=typeof raw.reason==='string'?controlledFileUtf8Bytes(raw.reason):undefined;
        if(!this.owns(identity)||keys.has(key)||length===undefined||length>controlledFileLimits.reasonBytes)throw Error('本机补偿草稿无效');keys.add(key);
        const attempt=raw.commandId!==undefined?attempts.find(v=>v.request.commandId===raw.commandId):undefined;
        if(raw.commandId!==undefined&&(!attempt||!sameIdentity(attempt.identity,identity)||attempt.request.reason!==raw.reason))throw Error('补偿草稿与原命令不一致');
        return {identity,reason:raw.reason,...(raw.commandId!==undefined?{commandId:raw.commandId}:{})};
      });
      this.value={...this.value,drafts,attempts};
    }catch(error){this.unavailable=true;this.value={...this.value,error:'本机补偿索引无法读取，未发送请求：'+errorText(error)}}
  }
  private owns(v:{workspaceId:string;rootSessionId:string}){return v.workspaceId===this.workspaceId&&v.rootSessionId===this.rootSessionId}
  get snapshot(){return this.value}get available(){return !this.unavailable}
  get canRelease(){return !this.listeners.size&&!this.pending.size&&!Object.values(this.value.reads).some(v=>v.loading)}
  subscribe=(listener:()=>void)=>{return this.listeners.subscribe(listener)};
  private publish(next:ControlledFileState){this.value=next;this.listeners.notify()}
  read(identity:ControlledFileReportInput){return this.value.reads[controlledFileSelectionKey(identity)]}
  draft(identity:ControlledFileReportInput){return this.value.drafts.find(v=>sameIdentity(v.identity,identity))}
  attempt(identity:ControlledFileReportInput){return this.value.attempts.find(v=>v.request.commandId===this.draft(identity)?.commandId)}
  isPending(commandId?:string){return !!commandId&&this.pending.has(commandId)}
  private setRead(identity:ControlledFileReportInput,patch:Partial<ControlledFileRead>){const key=controlledFileSelectionKey(identity),previous=this.read(identity)??{loading:false,error:''};this.publish({...this.value,reads:{...this.value.reads,[key]:{...previous,...patch}}})}
  observeAnchor(identity:ControlledFileReportInput,anchor:string){if(this.owns(identity))this.anchors.set(controlledFileSelectionKey(identity),anchor)}
  fresh(identity:ControlledFileReportInput,instanceId?:string){const r=this.read(identity);return !!instanceId&&!!r?.preview?.eligible&&!r.error&&!r.loading&&r.preview.identity.instanceId===instanceId&&r.anchor===this.anchors.get(controlledFileSelectionKey(identity))}
  private persist(drafts:readonly ControlledFileDraft[],attempts:readonly FileCompensationAttempt[]):boolean{
    try{
      if(this.unavailable)throw Error('本机记录不可用');
      const saved={version:1,workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,drafts,attempts},reserve=attempts.filter(v=>v.state!=='settled'&&v.state!=='rejected').length*(controlledFileLimits.outputBytes+4096);
      if(drafts.length>CONTROLLED_FILE_LOCAL_LIMIT||attempts.length>CONTROLLED_FILE_LOCAL_LIMIT||byteLength(saved)+reserve>CONTROLLED_FILE_LOCAL_BYTES)throw Error('本机补偿记录达到保存上限，原记录保留');
      this.ports.storage.setItem(this.storageKey,JSON.stringify(saved));
    }catch(error){this.publish({...this.value,error:'补偿请求未能保存：'+errorText(error)});return false}
    this.publish({...this.value,drafts,attempts,error:''});return true;
  }
  edit(identity:ControlledFileReportInput,reason:string){
    const length=controlledFileUtf8Bytes(reason),attempt=this.attempt(identity);
    if(!this.owns(identity)||!this.available||this.draft(identity)?.commandId&&attempt?.state!=='rejected'||length===undefined||length>controlledFileLimits.reasonBytes)return;
    const parsed=controlledFileReportInputSchema.safeParse(identity);if(!parsed.success)return;
    this.persist([...this.value.drafts.filter(v=>!sameIdentity(v.identity,identity)),{identity:parsed.data,reason}],this.value.attempts);
  }
  /** 明确未写的已结算补偿才可准备另一个请求；成功、未知和在途不能换 ID 重发。 */
  prepare(identity:ControlledFileReportInput){const draft=this.draft(identity),attempt=this.attempt(identity);if(!draft||attempt?.receipt?.phase!=='not_applied'||this.isPending(attempt.request.commandId))return;this.persist(this.value.drafts.map(v=>v===draft?{identity:v.identity,reason:v.reason}:v),this.value.attempts);this.setRead(identity,{preview:undefined,anchor:undefined})}
  async inspect(identity:ControlledFileReportInput){
    if(!this.owns(identity)||this.read(identity)?.loading)return;
    this.setRead(identity,{loading:true,error:'',anchor:undefined});
    try{const report=checkedControlledFileReport(await this.ports.report(structuredClone(identity)),identity,this.read(identity)?.report);this.setRead(identity,{report,loading:false,preview:undefined})}
    catch(error){this.setRead(identity,{loading:false,error:'原操作核实失败：'+errorText(error)})}
  }
  /** 预览才读取当前文件；不保存补偿意图或持有句柄等待用户决定。 */
  async preview(identity:ControlledFileReportInput,instanceId:string){
    const read=this.read(identity),operation=read?.report?.ledger.state==='recorded'?read.report.ledger.operation:undefined;
    if(!this.owns(identity)||read?.loading||operation?.phase!=='applied'||this.isPending(this.draft(identity)?.commandId))return;
    const parsed=fileCompensationPreviewInputSchema.safeParse({workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,instanceId,operationId:operation.operationId});
    if(!parsed.success){this.setRead(identity,{error:'当前工作区实例无效，请重新打开工作区后核实',anchor:undefined});return}
    const input=parsed.data,anchor=this.anchors.get(controlledFileSelectionKey(identity));
    this.setRead(identity,{loading:true,error:'',anchor:undefined});
    try{
      const preview=fileCompensationPreviewSchema.parse(bounded(await this.ports.preview(structuredClone(input))));
      if(!same(preview.identity,input)||!same(preview.source,operation)||!ownsSource(preview.source,identity))throw Error('补偿预览不属于原操作或当前工作区实例');
      this.setRead(identity,{preview,anchor,loading:false});
    }catch(error){this.setRead(identity,{loading:false,error:'补偿预览失败：'+errorText(error)})}
  }
  private saveAttempt(attempt:FileCompensationAttempt){return this.persist(this.value.drafts,this.value.attempts.some(v=>v.request.commandId===attempt.request.commandId)?this.value.attempts.map(v=>v.request.commandId===attempt.request.commandId?attempt:v):[...this.value.attempts,attempt])}
  /** 保存原命令后只发一次。仅首次提交的两个明确事务前拒绝码允许修改草稿；未知后的查询失败不能解除原命令锁。 */
  async submit(identity:ControlledFileReportInput,instanceId:string){
    const draft=this.draft(identity),preview=this.read(identity)?.preview;
    if(!draft||draft.commandId&&this.attempt(identity)?.state!=='rejected'||!preview?.eligible||!this.fresh(identity,instanceId)||!this.available)return;
    let request:FileCompensationInput;
    try{request=fileCompensationInputSchema.parse({...preview.identity,commandId:this.ports.uuid(),expectedOperationRevision:preview.operationRevision,expectedCompensationRevision:preview.compensationRevision,expectedBasis:preview.basis,reason:draft.reason});if(this.value.attempts.some(v=>v.request.commandId===request.commandId))throw Error('补偿命令与旧记录重号')}
    catch(error){this.publish({...this.value,error:errorText(error)});return}
    const attempt:FileCompensationAttempt={identity:structuredClone(identity),request,source:structuredClone(preview.source),state:'sending'};
    if(!this.persist(this.value.drafts.map(v=>v===draft?{...v,commandId:request.commandId}:v),[...this.value.attempts,attempt]))return;
    this.pending.add(request.commandId);this.setRead(identity,{anchor:undefined});
    try{const receipt=checkedFileCompensationReceipt(await this.ports.apply(structuredClone(request)),request,attempt.source);this.saveAttempt({...attempt,receipt,state:['applied','not_applied'].includes(receipt.phase)?'settled':'unknown'})}
    catch(error){const rejected=knownPreAcceptRejection(error);this.saveAttempt({...attempt,state:rejected?'rejected':'unknown',error:(rejected?'请求在写入前被拒绝，请重新预览后提交：':'补偿结果尚未确认，请查询原命令：')+errorText(error)})}
    finally{this.pending.delete(request.commandId);this.publish({...this.value})}
  }
  /** 查询原本机命令或后端历史；阶段只前进，查询失败既不把未知升级拒绝，也不抹去此前明确拒绝。 */
  async query(identity:ControlledFileReportInput,commandId:string){
    const previous=this.value.attempts.find(v=>v.request.commandId===commandId),ledger=this.read(identity)?.report?.ledger;
    const source=previous?.source??(ledger?.state==='recorded'&&ledger.compensations.some(v=>v.commandId===commandId)?ledger.operation:undefined);
    if(!this.owns(identity)||this.pending.has(commandId)||previous&&!sameIdentity(previous.identity,identity)||!source||source.phase!=='applied')return;
    this.pending.add(commandId);this.publish({...this.value});
    try{
      const raw=await this.ports.receipt({workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,commandId});if(raw===undefined)throw Error('尚未查到原补偿回执，保留未知状态');
      const parsed=fileCompensationReceiptSchema.parse(bounded(raw));
      if(!this.owns(parsed)||parsed.commandId!==commandId||parsed.operationId!==source.operationId)throw Error('回执不属于所选原命令');
      const receipt=checkedFileCompensationReceipt(parsed,previous?.request??parsed.request,source,previous?.receipt);
      const summary=ledger?.state==='recorded'?ledger.compensations.find(v=>v.commandId===commandId):undefined;
      const {compensationId,revision,phase,preparedAt,updatedAt,issue}=receipt;
      if(summary&&!summaryAdvances(summary,{compensationId,commandId,revision,phase,preparedAt,updatedAt,...(issue?{issue}:{})}))throw Error('补偿回执与已观察历史冲突，保留原记录');
      this.saveAttempt({identity:structuredClone(identity),request:receipt.request,source,receipt,state:['applied','not_applied'].includes(receipt.phase)?'settled':'unknown'});
      this.setRead(identity,{error:'',anchor:undefined});
    }catch(error){const message='原补偿查询未确认：'+errorText(error);if(previous)this.saveAttempt({...previous,state:previous.state==='rejected'?'rejected':previous.receipt&&['applied','not_applied'].includes(previous.receipt.phase)?'settled':'unknown',error:message});this.setRead(identity,{error:message})}
    finally{this.pending.delete(commandId);this.publish({...this.value})}
  }
}

/** 同 renderer 的节点/页签共享未决命令；仅无订阅且无请求的控制器可逐出，重开从本机索引恢复。 */
export class ControlledFilePool {
  private values=new Map<string,ControlledFileController>();
  constructor(private idleLimit=16){}
  get(workspaceId:string,rootSessionId:string,ports:ControlledFilePorts){const key=JSON.stringify([workspaceId,rootSessionId]),value=this.values.get(key)??new ControlledFileController(workspaceId,rootSessionId,ports);this.values.delete(key);this.values.set(key,value);for(const [id,controller]of this.values){if(this.values.size<=this.idleLimit)break;if(id!==key&&controller.canRelease)this.values.delete(id)}return value}
}
