/**
 * 作用定位：为同一主会话的主/成员调用保存显式影响观察、处置草稿、稳定命令及后续关联。
 * 设计原因：观察不定时回读，处置先在本机保存再发送；丢回包只查询原命令，不换 ID 重试。跨视图共享一个控制器，迟到读取不能替换其他来源的依据。
 * 持久边界：普通聊天草稿独立；旧处置与原异常均保留。报告只在内存，重新进入后必须显式观察，不能拿旧 hash 自动开修复任务。
 * 订阅边界：前端 SubscriptionSet 只持有监听器；通知时机、状态、轮询及销毁仍由本控制器决定。
 */
import {SubscriptionSet} from '../foundations/utility';
import {
  effectObservationInputSchema,effectObservationReportSchema,effectDispositionInputSchema,effectDispositionReceiptSchema,
  effectDispositionListSchema,effectRelationsSchema,sameEffectSubject,
} from '../../bridge/contracts/effect-observation';
import type {
  EffectObservationInput,EffectObservationReport,EffectDispositionInput,EffectDispositionReceipt,
  EffectDispositionRecord,EffectDispositionLookup,EffectDispositionList,EffectRelationsInput,EffectRelations,
} from '../../bridge/contracts/effect-observation';

export type EffectDecision=EffectDispositionInput['decision'];
export interface EffectAttempt {request:EffectDispositionInput;phase:'submitting'|'unknown'|'accepted'|'rejected';receipt?:EffectDispositionReceipt;error?:string}
export interface EffectDraft {identity:EffectObservationInput;reason:string;decision:EffectDecision;commandId?:string}
export interface EffectReadState {report?:EffectObservationReport;anchor?:string;loading:boolean;error:string;list?:EffectDispositionList;relations?:EffectRelations;selectedId?:string}
export interface EffectState {drafts:readonly EffectDraft[];attempts:readonly EffectAttempt[];reads:Readonly<Record<string,EffectReadState>>;error:string}
export interface EffectPorts {
  storage:Pick<Storage,'getItem'|'setItem'>;uuid:()=>string;
  observe:(input:EffectObservationInput)=>Promise<unknown>;
  list:(input:EffectObservationInput)=>Promise<unknown>;
  record:(input:EffectDispositionInput)=>Promise<unknown>;
  receipt:(input:EffectDispositionLookup)=>Promise<unknown>;
  relations:(input:EffectRelationsInput)=>Promise<unknown>;
}
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
/** 仅后端在调用事务前明确标记的拒绝可编辑；CAS、IO 或已提交未知不能据错误文字自动解锁。 */
export const effectPreacceptRejected=(e:unknown)=>/^EFFECT_PREACCEPT_(?:INPUT_INVALID|IDENTITY|ACTOR|BASIS_STALE|REVISION_CONFLICT|SOURCE_NOT_CLOSED|LIMIT):/.test(errorText(e));
const bytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).length;
export const EFFECT_LOCAL_BYTES=2*1024*1024,EFFECT_LOCAL_LIMIT=64;
export const effectSelectionKey=(value:EffectObservationInput)=>JSON.stringify([value.workspaceId,value.rootSessionId,value.subject.kind,'taskId' in value.subject?value.subject.taskId:null,value.subject.runId,value.subject.toolCallIds]);
const sameIdentity=(a:EffectObservationInput,b:EffectObservationInput)=>a.workspaceId===b.workspaceId&&a.rootSessionId===b.rootSessionId&&sameEffectSubject(a.subject,b.subject);

/** 身份与原调用顺序完整核对后才能展示；不按模型提交的路径、工具名或成功声明补全。 */
export function checkedEffectReport(raw:unknown,selection:EffectObservationInput):EffectObservationReport{
  const report=effectObservationReportSchema.parse(raw);
  if(!sameIdentity(report.identity,selection))throw Error('影响报告不属于所选原调用');
  return report;
}
/** 回执严格匹配已经冻结的命令与观察依据，已保存事实不能被后续查询改写。 */
export function checkedEffectReceipt(raw:unknown,request:EffectDispositionInput,previous?:EffectDispositionReceipt):EffectDispositionReceipt{
  const receipt=effectDispositionReceiptSchema.parse(raw);
  if(JSON.stringify(receipt.record.request)!==JSON.stringify(effectDispositionInputSchema.parse(request)))throw Error('处置回执与原请求不一致，请查询原命令');
  if(previous&&JSON.stringify(previous)!==JSON.stringify(receipt))throw Error('已保存处置发生冲突，保留原回执');
  return receipt;
}

/** 读写状态按原 subject 分开；构造/订阅/重开均不查询、不发模型任务。 */
export class EffectObservationController {
  private value:EffectState={drafts:[],attempts:[],reads:{},error:''};
  private listeners=new SubscriptionSet();
  private pending=new Set<string>();
  private generations=new Map<string,number>();
  /** 同来源历史选择按点击次序生效；较早的回包仍保存事实但不能把当前选择切回去。 */
  private selectionGenerations=new Map<string,number>();
  private anchors=new Map<string,string>();
  private unavailable=false;
  readonly storageKey:string;
  constructor(readonly workspaceId:string,readonly rootSessionId:string,private ports:EffectPorts){
    this.storageKey='cbim.effect-dispositions.v1.'+JSON.stringify([workspaceId,rootSessionId]);
    try{
      const text=ports.storage.getItem(this.storageKey);if(text===null)return;
      if(new TextEncoder().encode(text).length>EFFECT_LOCAL_BYTES)throw Error('本机处置索引超出读取上限');
      const saved=JSON.parse(text);
      if(saved.version!==1||saved.workspaceId!==workspaceId||saved.rootSessionId!==rootSessionId||!Array.isArray(saved.drafts)||!Array.isArray(saved.attempts)||saved.drafts.length>EFFECT_LOCAL_LIMIT||saved.attempts.length>EFFECT_LOCAL_LIMIT)throw Error('本机处置索引格式无效');
      const commandIds=new Set<string>(),keys=new Set<string>();
      const attempts:EffectAttempt[]=saved.attempts.map((raw:any)=>{
        const request=effectDispositionInputSchema.parse(raw.request);
        if(!this.owns(request)||commandIds.has(request.commandId)||!['submitting','unknown','accepted','rejected'].includes(raw.phase))throw Error('本机处置命令身份无效');
        commandIds.add(request.commandId);
        const receipt=raw.receipt?checkedEffectReceipt(raw.receipt,request):undefined;
        if(raw.phase==='accepted'&&!receipt)throw Error('已保存处置缺少回执');
        return {request,phase:raw.phase==='submitting'?'unknown':raw.phase,receipt,error:typeof raw.error==='string'?raw.error:undefined};
      });
      const drafts:EffectDraft[]=saved.drafts.map((raw:any)=>{
        const identity=effectObservationInputSchema.parse(raw.identity),key=effectSelectionKey(identity);
        if(!this.owns(identity)||keys.has(key)||typeof raw.reason!=='string'||raw.reason.length>4096||!['inspect_more','repair_in_new_cycle','leave_unresolved'].includes(raw.decision))throw Error('本机处置草稿无效');
        keys.add(key);
        const attempt=raw.commandId?attempts.find(a=>a.request.commandId===raw.commandId):undefined;
        if(raw.commandId&&(!attempt||!sameIdentity(attempt.request,identity)||attempt.request.reason!==raw.reason||attempt.request.decision!==raw.decision))throw Error('处置草稿与冻结命令不一致');
        return {identity,reason:raw.reason,decision:raw.decision,...(raw.commandId?{commandId:raw.commandId}:{})};
      });
      this.value={...this.value,drafts,attempts};
    }catch(error){this.unavailable=true;this.value={...this.value,error:'本机处置记录无法读取，未发送请求：'+errorText(error)}}
  }
  private owns(v:{workspaceId:string;rootSessionId:string}){return v.workspaceId===this.workspaceId&&v.rootSessionId===this.rootSessionId}
  get snapshot(){return this.value}
  get available(){return !this.unavailable}
  get canRelease(){return this.listeners.size===0&&this.pending.size===0&&!Object.values(this.value.reads).some(v=>v.loading)}
  subscribe=(listener:()=>void)=>{return this.listeners.subscribe(listener)};
  private publish(next:EffectState){this.value=next;this.listeners.notify()}
  draft(identity:EffectObservationInput){return this.value.drafts.find(x=>sameIdentity(x.identity,identity))}
  attempt(identity:EffectObservationInput){const id=this.draft(identity)?.commandId;return this.value.attempts.find(x=>x.request.commandId===id)}
  read(identity:EffectObservationInput){return this.value.reads[effectSelectionKey(identity)]}
  isPending(commandId?:string){return !!commandId&&this.pending.has(commandId)}
  selected(identity:EffectObservationInput):EffectDispositionRecord|undefined{
    const id=this.read(identity)?.selectedId??this.attempt(identity)?.receipt?.record.dispositionId;
    return this.value.attempts.find(x=>x.request.commandId===id&&sameIdentity(x.request,identity))?.receipt?.record;
  }
  private setRead(identity:EffectObservationInput,patch:Partial<EffectReadState>){const key=effectSelectionKey(identity),previous=this.value.reads[key]??{loading:false,error:''};this.publish({...this.value,reads:{...this.value.reads,[key]:{...previous,...patch}}})}
  /** 图/日志只改变时效，不读取报告；迟到回包保留为旧依据，不能赋予新提交资格。 */
  observeAnchor(identity:EffectObservationInput,anchor:string){if(this.owns(identity))this.anchors.set(effectSelectionKey(identity),anchor)}
  fresh(identity:EffectObservationInput){const r=this.read(identity);return !!r?.report&&!r.error&&!r.loading&&r.report.consistency==='stable'&&r.anchor===this.anchors.get(effectSelectionKey(identity))}
  private persist(drafts:readonly EffectDraft[],attempts:readonly EffectAttempt[]):boolean{
    try{
      if(this.unavailable)throw Error('本机记录不可用');
      const saved={version:1,workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,drafts,attempts};
      // 未知命令的回执最多 128 KiB；预留空间不被另一草稿吃掉。
      const reserve=attempts.filter(x=>!x.receipt&&x.phase!=='rejected').length*(128*1024+4096);
      if(drafts.length>EFFECT_LOCAL_LIMIT||attempts.length>EFFECT_LOCAL_LIMIT||bytes(saved)+reserve>EFFECT_LOCAL_BYTES)throw Error('本机处置记录达到保存上限，原记录保留');
      this.ports.storage.setItem(this.storageKey,JSON.stringify(saved));
    }catch(error){this.publish({...this.value,error:'处置请求未能保存：'+errorText(error)});return false}
    this.publish({...this.value,drafts,attempts,error:''});return true;
  }
  edit(identity:EffectObservationInput,reason:string,decision:EffectDecision){
    if(!this.owns(identity)||this.unavailable||reason.length>4096||this.draft(identity)?.commandId&&this.attempt(identity)?.phase!=='rejected'||!['inspect_more','repair_in_new_cycle','leave_unresolved'].includes(decision))return;
    const parsed=effectObservationInputSchema.safeParse(identity);if(!parsed.success)return;
    this.persist([...this.value.drafts.filter(x=>!sameIdentity(x.identity,identity)),{identity:parsed.data,reason,decision}],this.value.attempts);
  }
  /** 显式准备下一条处置，上一条 immutable 回执仍留在历史，不构造新命令或访问后端。 */
  prepare(identity:EffectObservationInput){const draft=this.draft(identity),attempt=this.attempt(identity);if(!draft||attempt?.phase!=='accepted'||this.isPending(attempt.request.commandId))return;this.persist(this.value.drafts.map(x=>x===draft?{...x,commandId:undefined}:x),this.value.attempts);this.setRead(identity,{selectedId:undefined,relations:undefined})}
  async observe(identity:EffectObservationInput){
    if(!this.owns(identity)||this.read(identity)?.loading)return;
    const key=effectSelectionKey(identity),generation=(this.generations.get(key)??0)+1,anchor=this.anchors.get(key);this.generations.set(key,generation);
    this.setRead(identity,{loading:true,error:''});
    try{const report=checkedEffectReport(await this.ports.observe(structuredClone(identity)),identity);if(this.generations.get(key)===generation)this.setRead(identity,{report,anchor,loading:false,error:''})}
    catch(error){if(this.generations.get(key)===generation)this.setRead(identity,{loading:false,error:'影响核实失败：'+errorText(error)})}
  }
  /** 只有点击保存才生成命令；未知不开放换 ID 重发，模型调用与恢复由其它显式入口负责。 */
  async submit(identity:EffectObservationInput){
    const draft=this.draft(identity),report=this.read(identity)?.report;
    if(!draft||draft.commandId&&this.attempt(identity)?.phase!=='rejected'||!report||!this.fresh(identity)||!draft.reason.trim()||this.unavailable)return;
    let request:EffectDispositionInput;
    try{request=effectDispositionInputSchema.parse({...identity,commandId:this.ports.uuid(),expectedBasis:report.basis,expectedRevision:report.dispositionRevision,decision:draft.decision,reason:draft.reason});if(this.value.attempts.some(x=>x.request.commandId===request.commandId))throw Error('新命令与已保存处置重号')}
    catch(error){this.publish({...this.value,error:errorText(error)});return}
    const attempt:EffectAttempt={request,phase:'submitting'};
    if(!this.persist(this.value.drafts.map(x=>x===draft?{...x,commandId:request.commandId}:x),[...this.value.attempts,attempt]))return;
    this.pending.add(request.commandId);this.publish({...this.value});
    try{const receipt=checkedEffectReceipt(await this.ports.record(structuredClone(request)),request);this.saveAttempt({...attempt,phase:'accepted',receipt});this.setRead(identity,{selectedId:request.commandId,relations:undefined,anchor:undefined})}
    catch(error){const rejected=effectPreacceptRejected(error);this.saveAttempt({...attempt,phase:rejected?'rejected':'unknown',error:(rejected?'请求尚未进入保存事务，请重新核实后编辑处置：':'保存结果尚未确认：')+errorText(error)+(rejected?'':'。请查询原命令。')});if(rejected)this.setRead(identity,{anchor:undefined})}
    finally{this.pending.delete(request.commandId);this.publish({...this.value})}
  }
  private saveAttempt(attempt:EffectAttempt){const found=this.value.attempts.some(x=>x.request.commandId===attempt.request.commandId);return this.persist(this.value.drafts,found?this.value.attempts.map(x=>x.request.commandId===attempt.request.commandId?attempt:x):[...this.value.attempts,attempt])}
  /** 查询已冻结命令或显式历史选择；回执丢失不能解释成未执行，不能修改原正文重试。 */
  async query(identity:EffectObservationInput,commandId:string){
    const previous=this.value.attempts.find(x=>x.request.commandId===commandId),listed=this.read(identity)?.list?.records.some(x=>x.dispositionId===commandId);
    if(!this.owns(identity)||this.pending.has(commandId)||previous&&!sameIdentity(previous.request,identity)||!previous&&!listed)return;
    const selectionKey=effectSelectionKey(identity),selectionGeneration=(this.selectionGenerations.get(selectionKey)??0)+1;this.selectionGenerations.set(selectionKey,selectionGeneration);
    this.pending.add(commandId);this.publish({...this.value});
    try{
      const raw=await this.ports.receipt({workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,commandId});
      if(raw===undefined)throw Error('尚未查到保存回执，保留未知状态');
      const parsed=effectDispositionReceiptSchema.parse(raw);
      if(!sameIdentity(parsed.record.request,identity)||parsed.record.dispositionId!==commandId)throw Error('处置历史不属于所选原调用');
      const receipt=checkedEffectReceipt(parsed,previous?.request??parsed.record.request,previous?.receipt);
      if(this.saveAttempt({request:receipt.record.request,phase:'accepted',receipt})&&this.selectionGenerations.get(selectionKey)===selectionGeneration)this.setRead(identity,{selectedId:commandId,relations:this.read(identity)?.relations?.identity.dispositionId===commandId?this.read(identity)?.relations:undefined,error:''});
    }catch(error){
      const message='查询结果未确认：'+errorText(error);
      if(previous)this.saveAttempt({...previous,phase:previous.receipt?'accepted':'unknown',error:message});
      // 历史选择不一定是当前草稿；错误放在该来源读取区，保留原选择及其真实关系。
      if(this.selectionGenerations.get(selectionKey)===selectionGeneration)this.setRead(identity,{error:message});
    }
    finally{this.pending.delete(commandId);this.publish({...this.value})}
  }
  /** 只返回所选来源的摘要；不自动挑最新决定、不自动打开或执行后续任务。 */
  async list(identity:EffectObservationInput){
    if(!this.owns(identity)||this.read(identity)?.loading)return;
    this.setRead(identity,{loading:true,error:''});
    try{const list=effectDispositionListSchema.parse(await this.ports.list(structuredClone(identity)));if(!sameIdentity(list.identity,identity))throw Error('处置列表属于其他来源');this.setRead(identity,{list,loading:false})}
    catch(error){this.setRead(identity,{loading:false,error:'处置列表读取失败：'+errorText(error)})}
  }
  async relations(identity:EffectObservationInput){
    const selected=this.selected(identity);if(!selected||!this.owns(identity)||this.read(identity)?.loading)return;
    const dispositionId=selected.dispositionId;this.setRead(identity,{loading:true,error:''});
    try{
      const relations=effectRelationsSchema.parse(await this.ports.relations({workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,dispositionId}));
      if(!sameIdentity(relations.record.request,identity)||relations.identity.dispositionId!==dispositionId||JSON.stringify(relations.record)!==JSON.stringify(selected))throw Error('后续关系与原处置不一致');
      if(this.selected(identity)?.dispositionId===dispositionId)this.setRead(identity,{relations,loading:false});else this.setRead(identity,{loading:false});
    }catch(error){this.setRead(identity,{loading:false,error:'后续关系读取失败：'+errorText(error)})}
  }
}

/** 同 renderer 的主工具与任务节点共享稳定请求；仅空闲无订阅控制器可被回收。 */
export class EffectObservationPool {
  private values=new Map<string,EffectObservationController>();
  constructor(private idleLimit=16){}
  get(workspaceId:string,rootSessionId:string,ports:EffectPorts){const key=JSON.stringify([workspaceId,rootSessionId]),controller=this.values.get(key)??new EffectObservationController(workspaceId,rootSessionId,ports);this.values.delete(key);this.values.set(key,controller);for(const [id,old]of this.values){if(this.values.size<=this.idleLimit)break;if(id!==key&&old.canRelease)this.values.delete(id)}return controller}
}
