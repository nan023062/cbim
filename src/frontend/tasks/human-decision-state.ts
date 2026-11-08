/**
 * 完整选择同草稿/命令冻结，重开不重读；清除、切换和迟到响应均核完整选择，不能借旧文件预览提交新清单。
 * 作用定位：维护当前主会话人工决定的草稿、手动预览、冻结命令及回执，供两处目标卡共享。
 * 设计原因：保存意见与执行分离；先持久化再发送，通信未知只能核实原命令。返工后须显式清除旧候选再核实，预览迟到或切换选择不能使过期依据变为可提交。
 */
import {humanDecisionPreviewInputSchema,humanDecisionPreviewSchema,humanDecisionRequestSchema,humanDecisionReceiptSchema} from '../../bridge/contracts/human-decisions';
import type {HumanDecisionKind,HumanDecisionBaselineSelection,HumanDecisionManifestSelection,HumanDecisionPreviewInput,HumanDecisionPreview,HumanDecisionRequest,HumanDecisionLookup,HumanDecisionReceipt} from '../../bridge/contracts/human-decisions';

/** anchor 来自当前已同步目标详情，仅用于视图失效判断，不作为后端证明。 */
export interface HumanDecisionTarget extends Omit<HumanDecisionPreviewInput,'baselines'|'manifests'> {anchor:string}
export interface HumanDecisionAttempt {request:HumanDecisionRequest;phase:'submitting'|'unknown'|'accepted'|'rejected';uncertain:boolean;receipt?:HumanDecisionReceipt;error?:string}
export interface HumanDecisionDraft {scopeId:string;criterionId:string;baselines:HumanDecisionBaselineSelection[];manifests?:HumanDecisionManifestSelection[];decision?:HumanDecisionKind;comment:string;attempt?:HumanDecisionAttempt}
export interface HumanDecisionPreviewState {anchor:string;input:HumanDecisionPreviewInput;loading:boolean;result?:HumanDecisionPreview;error:string}
export interface HumanDecisionState {records:readonly HumanDecisionDraft[];error:string}
/** 端口没有启动模型或修改权限能力；本机持久化异常会阻止新的发送。 */
export interface HumanDecisionPorts {
  storage:Pick<Storage,'getItem'|'setItem'>;
  preview:(input:HumanDecisionPreviewInput)=>Promise<unknown>;
  submit:(input:HumanDecisionRequest)=>Promise<unknown>;
  lookup:(input:HumanDecisionLookup)=>Promise<unknown>;
  uuid:()=>string;
}
const identityKey=(scopeId:string,criterionId:string)=>JSON.stringify([scopeId,criterionId]);
const textError=(error:unknown)=>error instanceof Error?error.message:String(error);
function ordered(value:unknown):unknown{return Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,ordered(v)])):value}
const equal=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const selected=<T extends {taskId:string;runId:string}>(values:T[])=>[...values].sort((a,b)=>a.taskId.localeCompare(b.taskId)||a.runId.localeCompare(b.runId));
/** 只有首次明确的未提交领域拒绝可编辑；未知、IO 和命令冲突不自动换 ID。 */
export function humanDecisionRejected(error:unknown){return /^(?:HUMAN_(?:INPUT_INVALID|IDENTITY|NOT_WAITING|SOURCE_INVALID|KNOWLEDGE_CHANGED|UNAVAILABLE|EVIDENCE_INVALID|STALE|LIMIT|REVISION_CONFLICT|DECISION_UNAVAILABLE)|WORKSPACE_EXECUTION_BUSY):/.test(textError(error))}

/** 预览不能借用另一人工项或另一组已选文件；无依据只显示问题，不能提交。 */
export function checkedHumanDecisionPreview(raw:unknown,input:HumanDecisionPreviewInput):HumanDecisionPreview{
  const value=humanDecisionPreviewSchema.parse(raw),{baselines,manifests,...identity}=input;
  const observed=value.candidates.flatMap(candidate=>candidate.selected?[{taskId:candidate.taskId,runId:candidate.runId,baselineId:candidate.selected.baselineId}]:[]);
  const observedManifests=value.candidates.flatMap(candidate=>candidate.selectedManifest?[{taskId:candidate.taskId,runId:candidate.runId,manifestId:candidate.selectedManifest.manifest.manifestId}]:[]);
  if(!equal(value.identity,identity)||value.basis&&(!equal(selected(observed),selected(baselines))||!equal(selected(observedManifests),selected(manifests??[]))))throw Error('人工决定预览与当前目标或产物选择不一致');
  return value;
}
/** 回执必须确认冻结的内容；scope 后续状态可变，既有 record 本身不能被查询替换。 */
export function checkedHumanDecisionReceipt(raw:unknown,request:HumanDecisionRequest,previous?:HumanDecisionReceipt):HumanDecisionReceipt{
  const value=humanDecisionReceiptSchema.parse(raw),record=value.record;
  if(value.workspaceId!==request.workspaceId||value.rootSessionId!==request.rootSessionId||value.scopeId!==request.scopeId||!equal(record.proof.identity,{workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,scopeId:request.scopeId})||record.decisionId!==request.commandId||record.criterionId!==request.criterionId||record.revision!==request.expectedDecisionRevision+1||record.basis!==request.expectedBasis||record.decision!==request.decision||record.comment!==request.comment||!equal(selected(record.baselines),selected(request.baselines))||!equal(selected(record.manifests??[]),selected(request.manifests??[]))||previous&&!equal(previous.record,record))throw Error('人工决定回执与冻结请求不一致，请查询原命令');
  return value;
}

/** 每 root 唯一控制器；同一人工项的未知提交保持冻结，其他项可各自查询预览。 */
export class HumanDecisionController {
  private value:HumanDecisionState={records:[],error:''};
  private unavailable=false;
  private listeners=new Set<()=>void>();
  private pending=new Set<string>();
  private previews=new Map<string,HumanDecisionPreviewState>();
  readonly storageKey:string;
  constructor(readonly workspaceId:string,readonly rootSessionId:string,private ports:HumanDecisionPorts){
    this.storageKey='cbim.human-decisions.v1.'+JSON.stringify([workspaceId,rootSessionId]);
    try{
      const raw=ports.storage.getItem(this.storageKey);if(!raw)return;
      if(new TextEncoder().encode(raw).length>2*1024*1024)throw Error('本地记录超过容量上限');
      const saved=JSON.parse(raw);if(saved.version!==1||saved.workspaceId!==workspaceId||saved.rootSessionId!==rootSessionId||!Array.isArray(saved.records)||saved.records.length>128)throw Error('本地记录格式或身份不一致');
      const seen=new Set<string>();
      const records:HumanDecisionDraft[]=saved.records.map((entry:any)=>{
        const input=humanDecisionPreviewInputSchema.parse({workspaceId,rootSessionId,scopeId:entry.scopeId,criterionId:entry.criterionId,baselines:entry.baselines,...(entry.manifests?{manifests:entry.manifests}:{})});
        const key=identityKey(input.scopeId,input.criterionId);if(seen.has(key)||typeof entry.comment!=='string'||entry.comment.length>4000||entry.decision!==undefined&&!['accept','reject','request_evidence'].includes(entry.decision))throw Error('人工决定草稿重复或内容无效');seen.add(key);
        let attempt:HumanDecisionAttempt|undefined;
        if(entry.attempt){
          const request=humanDecisionRequestSchema.parse(entry.attempt.request);
          if(!equal(selected(input.manifests??[]),selected(request.manifests??[])))throw Error('冻结请求与完整清单选择不一致');
          if(!equal({workspaceId,rootSessionId,scopeId:input.scopeId,criterionId:input.criterionId,baselines:input.baselines},{workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,scopeId:request.scopeId,criterionId:request.criterionId,baselines:request.baselines})||request.decision!==entry.decision||request.comment!==entry.comment.trim()||!['submitting','unknown','accepted','rejected'].includes(entry.attempt.phase))throw Error('冻结请求与人工项不一致');
          const receipt=entry.attempt.receipt?checkedHumanDecisionReceipt(entry.attempt.receipt,request):undefined;
          if(entry.attempt.phase==='accepted'&&!receipt)throw Error('已提交记录缺少回执');
          const unknown=['submitting','unknown'].includes(entry.attempt.phase);
          attempt={request,phase:unknown?'unknown':entry.attempt.phase,uncertain:unknown||!!entry.attempt.uncertain,receipt,error:typeof entry.attempt.error==='string'?entry.attempt.error:undefined};
        }
        return {scopeId:input.scopeId,criterionId:input.criterionId,baselines:input.baselines,...(input.manifests?{manifests:input.manifests}:{}),decision:entry.decision,comment:entry.comment,attempt};
      });this.value={records,error:''};
    }catch(error){this.unavailable=true;this.value={records:[],error:'本地人工决定记录无法读取，未发送任何请求：'+textError(error)}}
  }
  get snapshot(){return this.value}
  get available(){return !this.unavailable}
  get canRelease(){return !this.listeners.size&&!this.pending.size&&![...this.previews.values()].some(value=>value.loading)}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  record(scopeId:string,criterionId:string){return this.value.records.find(value=>value.scopeId===scopeId&&value.criterionId===criterionId)}
  previewState(target:HumanDecisionTarget){return this.previews.get(identityKey(target.scopeId,target.criterionId))}
  isPending(record?:HumanDecisionDraft){return !!record?.attempt&&this.pending.has(record.attempt.request.commandId)}
  locked(record?:HumanDecisionDraft){return this.isPending(record)||!!record?.attempt&&['submitting','unknown'].includes(record.attempt.phase)}
  private emit(){for(const listener of this.listeners)listener()}
  private belongs(target:HumanDecisionTarget){return target.workspaceId===this.workspaceId&&target.rootSessionId===this.rootSessionId}
  private update(record:HumanDecisionDraft):boolean{
    const records=[...this.value.records],index=records.findIndex(value=>value.scopeId===record.scopeId&&value.criterionId===record.criterionId);if(index<0)records.push(record);else records[index]=record;
    this.value={records,error:''};
    try{
      if(this.unavailable||records.length>128)throw Error('本机人工决定记录不可写或已达上限');
      const raw=JSON.stringify({version:1,workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,records});if(new TextEncoder().encode(raw).length>2*1024*1024)throw Error('本地记录超过 2 MiB 上限');
      this.ports.storage.setItem(this.storageKey,raw);this.emit();return true;
    }catch(error){this.unavailable=true;this.value={records,error:'本地保存失败；保留当前请求，不再发送：'+textError(error)};this.emit();return false}
  }
  /** 修改已成功记录的草稿表示准备新决定；原决定仍在后端历史中，不覆盖它。 */
  edit(target:HumanDecisionTarget,change:Partial<Pick<HumanDecisionDraft,'baselines'|'manifests'|'decision'|'comment'>>){
    const record=this.record(target.scopeId,target.criterionId);if(!this.available||!this.belongs(target)||this.locked(record))return;
    this.update({scopeId:target.scopeId,criterionId:target.criterionId,baselines:record?.baselines??[],...(record?.manifests?{manifests:record.manifests}:{}),comment:record?.comment??'',decision:record?.decision,...change,attempt:undefined});
  }
  /** 明确清除旧候选选择才能核实返工成果；不改后端历史，也不能清除未知/在途请求。 */
  resetBaselines(target:HumanDecisionTarget):boolean{
    const record=this.record(target.scopeId,target.criterionId);if(!this.available||!this.belongs(target)||this.locked(record))return false;
    // 使正在回来的旧预览失效，避免新候选菜单再次被旧文件观察覆盖。
    this.previews.delete(identityKey(target.scopeId,target.criterionId));
    return this.update({scopeId:target.scopeId,criterionId:target.criterionId,baselines:[],comment:record?.comment??'',decision:undefined});
  }
  currentPreview(target:HumanDecisionTarget):HumanDecisionPreview|undefined{
    const state=this.previewState(target),record=this.record(target.scopeId,target.criterionId);
    return state&&!state.loading&&!state.error&&state.anchor===target.anchor&&equal(selected(state.input.baselines),selected(record?.baselines??[]))&&equal(selected(state.input.manifests??[]),selected(record?.manifests??[]))?state.result:undefined;
  }
  /** 明确点击才读取文件；选择变化可显示旧菜单，但旧观察不得用于提交。 */
  async preview(target:HumanDecisionTarget){
    if(!this.available||!this.belongs(target))return;
    const record=this.record(target.scopeId,target.criterionId);if(this.locked(record))return;
    const key=identityKey(target.scopeId,target.criterionId),input=humanDecisionPreviewInputSchema.parse({workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,scopeId:target.scopeId,criterionId:target.criterionId,baselines:record?.baselines??[],...(record?.manifests?{manifests:record.manifests}:{})});
    const old=this.previews.get(key);if(old?.loading&&old.anchor===target.anchor&&equal(old.input,input))return;
    const state:HumanDecisionPreviewState={anchor:target.anchor,input,loading:true,error:''};this.previews.set(key,state);this.emit();
    try{const result=checkedHumanDecisionPreview(await this.ports.preview(structuredClone(input)),input);if(this.previews.get(key)===state)this.previews.set(key,{...state,result,loading:false})}
    catch(error){if(this.previews.get(key)===state)this.previews.set(key,{...state,loading:false,error:textError(error)})}
    finally{this.emit()}
  }
  async submit(target:HumanDecisionTarget){
    const record=this.record(target.scopeId,target.criterionId),preview=this.currentPreview(target);
    if(!this.available||!this.belongs(target)||!record||this.locked(record)||record.attempt?.phase==='accepted'||!preview?.basis||!record.decision||!preview.allowedDecisions.includes(record.decision))return;
    let request:HumanDecisionRequest;
    try{request=humanDecisionRequestSchema.parse({workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,scopeId:target.scopeId,criterionId:target.criterionId,baselines:record.baselines,...(record.manifests?{manifests:record.manifests}:{}),commandId:this.ports.uuid(),expectedDecisionRevision:preview.decisionRevision,expectedBasis:preview.basis,decision:record.decision,comment:record.comment})}
    catch(error){this.value={...this.value,error:textError(error)};this.emit();return}
    const frozen={...record,comment:request.comment,attempt:{request,phase:'submitting' as const,uncertain:false}};
    if(this.update(frozen))await this.send(frozen);
  }
  private async send(record:HumanDecisionDraft){
    const attempt=record.attempt!,request=attempt.request;if(this.pending.has(request.commandId))return;
    this.pending.add(request.commandId);this.emit();
    try{const receipt=checkedHumanDecisionReceipt(await this.ports.submit(structuredClone(request)),request,attempt.receipt);this.update({...record,attempt:{...attempt,phase:'accepted',receipt,error:undefined}})}
    catch(error){
      const rejected=!attempt.uncertain&&humanDecisionRejected(error);
      // 明确未受理后需重新核实，不能用旧预览不断换命令重试；未知响应仍只保留原命令。
      if(rejected){const key=identityKey(record.scopeId,record.criterionId),preview=this.previews.get(key);if(preview)this.previews.set(key,{...preview,error:'提交未受理，请重新核实当前依据。'})}
      this.update({...record,attempt:{...attempt,phase:rejected?'rejected':'unknown',uncertain:!rejected,error:textError(error)}});
    }
    finally{this.pending.delete(request.commandId);this.emit()}
  }
  /** 未知通信结果只重发已保存命令，不使用现在选择的验收项、文件或意见。 */
  async retry(scopeId:string,criterionId:string){const record=this.record(scopeId,criterionId);if(!this.available||record?.attempt?.phase!=='unknown'||this.isPending(record))return;await this.send(record)}
  /** 查不到回执不等于未提交，仍冻结；查询不会触发模型或新的人工决定。 */
  async query(scopeId:string,criterionId:string){
    const record=this.record(scopeId,criterionId),attempt=record?.attempt;if(!this.available||!record||!attempt||this.isPending(record))return;
    const request=attempt.request;this.pending.add(request.commandId);this.emit();
    try{
      const raw=await this.ports.lookup({workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,scopeId,commandId:request.commandId});
      if(raw!==undefined)this.update({...record,attempt:{...attempt,phase:'accepted',receipt:checkedHumanDecisionReceipt(raw,request,attempt.receipt),error:undefined}});
      else if(attempt.phase!=='accepted')this.update({...record,attempt:{...attempt,phase:'unknown',uncertain:true,error:'尚未查到回执，请继续查询或用原命令重试。'}});
    }catch(error){this.update({...record,attempt:{...attempt,phase:attempt.phase==='accepted'?'accepted':'unknown',uncertain:true,error:'查询结果未确认：'+textError(error)}})}
    finally{this.pending.delete(request.commandId);this.emit()}
  }
  /** 重开仅补查未知请求；不重做预览或自动提交。 */
  async restore(){await Promise.all(this.value.records.filter(value=>value.attempt?.phase==='unknown').map(value=>this.query(value.scopeId,value.criterionId)))}
}

/** 同一 renderer 中两个卡片及重访工作区复用控制器；仅回收完全闲置项。 */
export class HumanDecisionPool {
  private values=new Map<string,HumanDecisionController>();
  get(workspaceId:string,rootSessionId:string,ports:HumanDecisionPorts){
    const key=JSON.stringify([workspaceId,rootSessionId]),value=this.values.get(key)??new HumanDecisionController(workspaceId,rootSessionId,ports);this.values.delete(key);this.values.set(key,value);
    for(const [oldKey,old] of this.values){if(this.values.size<=16)break;if(oldKey!==key&&old.canRelease)this.values.delete(oldKey)}return value;
  }
}
