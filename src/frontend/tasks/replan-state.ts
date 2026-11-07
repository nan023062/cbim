/**
 * 作用定位：保存从已完成核实周期创建正式业务周期的独立草稿、条件预览和稳定提交命令。
 * 设计原因：只读核实不能原地提权；提交前保存新目标和 ask/execute 权限。首次容量拒绝不锁死草稿，曾通信未知仍只能查询或重试原命令，不能借准入等待重放业务。
 * 职责边界：本模块不复活旧任务、不批准人工验收；来源与知识是否仍有效由后端在受理时再次核验。
 * 新影响来源：dispositionId 纳入目标键、预览和稳定命令；回执必须匹配原选择，不为历史请求补造关联。
 */
import {replanPreviewSchema,replanRequestSchema,replanReceiptSchema} from '../../bridge/contracts/dispatch';
import type {ReplanPreviewInput,ReplanPreview,ReplanRequest,ReplanLookup,ReplanReceipt} from '../../bridge/contracts/dispatch';

/** anchor 是视图已核对的图/周期/模型选择版本，仅用于丢弃迟到预览，不作为后端授权字段。 */
export interface ReplanTarget extends ReplanPreviewInput {anchor:string;graphCursor:{streamId:string;seq:number};inspectionGoalRevision:number;dispositionId?:string}
export interface ReplanAttempt {
  request:ReplanRequest;proof:ReplanPreview;
  phase:'submitting'|'unknown'|'accepted'|'rejected';uncertain:boolean;
  receipt?:ReplanReceipt;error?:string;
}
/** 同一 inspectionScopeId 只保留一次已受理的新业务命令；权限不继承聊天输入区。 */
export interface ReplanDraft {inspectionScopeId:string;message:string;permission:'ask'|'execute';attempt?:ReplanAttempt}
export interface ReplanPreviewState {target:ReplanTarget;draftKey:string;loading:boolean;result?:ReplanPreview;error:string}
export interface ReplanState {records:readonly ReplanDraft[];preview?:ReplanPreviewState;error:string}
export interface ReplanPorts {
  storage:Pick<Storage,'getItem'|'setItem'>;
  preview:(input:ReplanPreviewInput)=>Promise<unknown>;
  submit:(request:ReplanRequest)=>Promise<unknown>;
  lookup:(input:ReplanLookup)=>Promise<unknown>;
  uuid:()=>string;
}
const key=(target:ReplanTarget|undefined)=>target?JSON.stringify([target.workspaceId,target.rootSessionId,target.inspectionScopeId,target.anchor,target.dispositionId]):'';
const draftKey=(draft:ReplanDraft|undefined)=>JSON.stringify([draft?.message??'',draft?.permission??'ask']);
const textError=(error:unknown)=>error instanceof Error?error.message:String(error);
const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length;
export const REPLAN_RECORD_LIMIT=128,REPLAN_INDEX_BYTE_LIMIT=2*1024*1024;
/** 仅第一次确定未受理的领域拒绝允许修正；曾未知、冲突或取消不能按失败自动换命令。 */
export function replanRejected(error:unknown){return /^(?:CAPACITY_BUSY|REPLAN_(?:INPUT_INVALID|IDENTITY|SOURCE_INVALID|BUSY|PROOF_INVALID|LEGACY|KNOWLEDGE_CHANGED|STALE|CONTEXT_CONFLICT)):/.test(textError(error))}

/** 返回事实必须属于请求来源；eligible 才能携带创建资格，预览不是已生成的执行计划。 */
export function checkedReplanPreview(raw:unknown,input:ReplanPreviewInput):ReplanPreview{
  const result=replanPreviewSchema.parse(raw);
  if(result.identity.workspaceId!==input.workspaceId||result.identity.rootSessionId!==input.rootSessionId||result.identity.inspectionScopeId!==input.inspectionScopeId)throw Error('条件核验结果不属于当前核实周期');
  if(result.eligible&&(!result.basis||!result.graphCursor||!result.knowledgeRevision||result.inspectionGoalRevision===undefined||!result.requiredModules.length))throw Error('条件核验结果缺少完整依据');
  return result;
}

/** 受理不表示执行已开始；同命令的来源、目标、权限、初始运行和受理时间不可被后续查询替换。 */
export function checkedReplanReceipt(raw:unknown,request:ReplanRequest,proof:ReplanPreview,previous?:ReplanReceipt):ReplanReceipt{
  const receipt=replanReceiptSchema.parse(raw),value=receipt.replan;
  if(value.dispositionId!==request.dispositionId)throw Error('新业务周期回执关联了其他处置，请查询原命令');
  if(receipt.workspaceId!==request.workspaceId||receipt.rootSessionId!==request.rootSessionId||receipt.scopeId!==request.commandId||receipt.scopeId===request.source.inspectionScopeId||value.replanId!==request.commandId||value.operation!=='business_replan'||value.source.inspectionScopeId!==request.source.inspectionScopeId||value.source.expectedBasis!==request.source.expectedBasis||value.input.message!==request.input.message||JSON.stringify(value.options)!==JSON.stringify(request.options)||proof.basis!==request.source.expectedBasis)throw Error('新业务周期回执与冻结请求不一致，请查询原命令');
  const facts=value.source.proof;
  if(facts.inspectionGoalRevision!==proof.inspectionGoalRevision||facts.knowledgeRevision!==proof.knowledgeRevision||JSON.stringify(facts.requiredModules)!==JSON.stringify(proof.requiredModules)||JSON.stringify(facts.inheritedHuman)!==JSON.stringify(proof.inheritedHuman)||value.runId===facts.reviewRunId||value.runId===facts.sourceRunId)throw Error('新业务周期回执的前置依据与已核验条件不一致');
  if(previous&&(JSON.stringify(previous.replan)!==JSON.stringify(value)||previous.scopeStatus==='closed'&&receipt.scopeStatus!=='closed'))throw Error('同一业务命令的受理事实发生冲突，保留原回执');
  return receipt;
}

/** 每个主会话一份索引；预览仅在内存且由显式点击产生，重开只恢复请求并查询未知结果。 */
export class ScopeReplanController {
  private value:ReplanState={records:[],error:''};
  private unavailable=false;
  private target?:ReplanTarget;
  private previewGeneration=0;
  private pending=new Set<string>();
  private listeners=new Set<()=>void>();
  readonly storageKey:string;
  constructor(readonly workspaceId:string,readonly rootSessionId:string,private ports:ReplanPorts){
    this.storageKey='cbim.scope-replan.v1.'+JSON.stringify([workspaceId,rootSessionId]);
    try{
      const text=ports.storage.getItem(this.storageKey);if(text===null)return;
      if(new TextEncoder().encode(text).length>REPLAN_INDEX_BYTE_LIMIT)throw Error('本地业务请求超过 2 MiB 读取上限，保留原记录');
      const saved=JSON.parse(text);
      if(saved.version!==1||saved.workspaceId!==workspaceId||saved.rootSessionId!==rootSessionId||!Array.isArray(saved.records))throw Error('本地业务重规划记录身份或格式不匹配');
      if(saved.records.length>REPLAN_RECORD_LIMIT)throw Error('本地业务请求超过 128 个来源读取上限，保留原记录');
      const sources=new Set<string>(),commands=new Set<string>();
      const records:ReplanDraft[]=saved.records.map((raw:any)=>{
        const inspectionScopeId=replanRequestSchema.shape.source.shape.inspectionScopeId.parse(raw.inspectionScopeId);
        if(sources.has(inspectionScopeId)||typeof raw.message!=='string'||raw.message.length>64000||!['ask','execute'].includes(raw.permission))throw Error('本地业务目标草稿无效或重复');
        sources.add(inspectionScopeId);let attempt:ReplanAttempt|undefined;
        if(raw.attempt){
          const savedAttempt=raw.attempt,request=replanRequestSchema.parse(savedAttempt.request);
          if(request.workspaceId!==workspaceId||request.rootSessionId!==rootSessionId||request.source.inspectionScopeId!==inspectionScopeId||commands.has(request.commandId)||!['submitting','unknown','accepted','rejected'].includes(savedAttempt.phase))throw Error('本地业务命令身份无效或重复');
          commands.add(request.commandId);
          const proof=checkedReplanPreview(savedAttempt.proof,{workspaceId,rootSessionId,inspectionScopeId});
          if(!proof.eligible||proof.basis!==request.source.expectedBasis)throw Error('本地业务命令缺少对应条件核验依据');
          const receipt=savedAttempt.receipt?checkedReplanReceipt(savedAttempt.receipt,request,proof):undefined;
          if(savedAttempt.phase==='accepted'&&!receipt)throw Error('已受理业务命令缺少回执');
          const unresolved=savedAttempt.phase==='submitting'||savedAttempt.phase==='unknown';
          attempt={request,proof,receipt,phase:unresolved?'unknown':savedAttempt.phase,uncertain:unresolved||!!savedAttempt.uncertain,error:typeof savedAttempt.error==='string'?savedAttempt.error:undefined};
          if(attempt.phase!=='rejected'&&(request.input.message!==raw.message||request.options.permission!==raw.permission))throw Error('本地草稿与冻结业务命令不一致');
        }
        return {inspectionScopeId,message:raw.message,permission:raw.permission,attempt};
      });this.value={records,error:''};
    }catch(error){this.unavailable=true;this.value={records:[],error:'本地业务请求无法读取，未发送任务：'+textError(error)}}
  }
  get snapshot(){return this.value}
  get available(){return !this.unavailable}
  get canRelease(){return this.listeners.size===0&&this.pending.size===0&&!this.value.preview?.loading}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  private emit(){for(const listener of this.listeners)listener()}
  record(inspectionScopeId:string){return this.value.records.find(item=>item.inspectionScopeId===inspectionScopeId)}
  isPending(record?:ReplanDraft){return !!record?.attempt&&this.pending.has(record.attempt.request.commandId)}
  /** 历史选择、图或模型版本改变只作废预览，绝不改写冻结提交和它的迟到回执。 */
  observeTarget(target:ReplanTarget|undefined){
    if(target&&(target.workspaceId!==this.workspaceId||target.rootSessionId!==this.rootSessionId))target=undefined;
    if(key(target)===key(this.target))return;
    this.target=target;this.previewGeneration++;this.value={...this.value,preview:undefined};this.emit();
  }
  private save(record:ReplanDraft,clearPreview=false):boolean{
    const records=[...this.value.records],index=records.findIndex(item=>item.inspectionScopeId===record.inspectionScopeId);
    if(index<0)records.push(record);else records[index]=record;
    try{
      if(this.unavailable)throw Error('本地记录不可用');
      if(records.length>REPLAN_RECORD_LIMIT)throw Error('本机业务请求达到 128 个来源上限，原记录保持不变');
      const saved={version:1,workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,records};
      // 受理回执会复制目标、模型和可信前置事实；保存其他草稿也不能占用未决回执的预留空间。
      const reserved=records.reduce((total,item)=>total+(item.attempt&&!item.attempt.receipt&&['submitting','unknown'].includes(item.attempt.phase)?bytes(item.attempt.request)+bytes(item.attempt.proof)+16384:0),0);
      if(bytes(saved)+reserved>REPLAN_INDEX_BYTE_LIMIT)throw Error('本机业务请求及未决回执预留超过 2 MiB，原记录保持不变');
      this.ports.storage.setItem(this.storageKey,JSON.stringify(saved));
    }catch(error){this.value={...this.value,error:'业务请求未能保存：'+textError(error)};this.emit();return false}
    if(clearPreview)this.previewGeneration++;
    this.value={records,preview:clearPreview?undefined:this.value.preview,error:''};this.emit();return true;
  }
  /** 独立保存新业务目标及明确权限；写入失败不发布更改，不影响聊天草稿或只读核实权限。 */
  edit(inspectionScopeId:string,message:string,permission:'ask'|'execute'){
    if(this.unavailable||message.length>64000||!['ask','execute'].includes(permission)||!replanRequestSchema.shape.source.shape.inspectionScopeId.safeParse(inspectionScopeId).success)return;
    const old=this.record(inspectionScopeId);if(old?.attempt&&old.attempt.phase!=='rejected'||this.isPending(old))return;
    if(old&&old.message===message&&old.permission===permission)return;
    this.save({inspectionScopeId,message,permission,attempt:old?.attempt},true);
  }
  /** 仅显式读取；返回后来源/图/草稿已改变则丢弃，不把迟到依据赋给新的目标。 */
  async preview(target:ReplanTarget){
    const record=this.record(target.inspectionScopeId);
    if(this.unavailable||key(target)!==key(this.target)||this.value.preview?.loading||record?.attempt&&record.attempt.phase!=='rejected'||this.isPending(record))return;
    const generation=++this.previewGeneration,fields=draftKey(record);
    this.value={...this.value,preview:{target,draftKey:fields,loading:true,error:''}};this.emit();
    try{
      const result=checkedReplanPreview(await this.ports.preview({workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,inspectionScopeId:target.inspectionScopeId}),target);
      if(generation!==this.previewGeneration||key(target)!==key(this.target)||fields!==draftKey(this.record(target.inspectionScopeId)))return;
      if(result.eligible&&(result.graphCursor?.streamId!==target.graphCursor.streamId||result.graphCursor.seq!==target.graphCursor.seq||result.inspectionGoalRevision!==target.inspectionGoalRevision))throw Error('来源或任务图已变化，请同步后重新核验条件');
      this.value={...this.value,preview:{target,draftKey:fields,loading:false,result,error:''}};this.emit();
    }catch(error){if(generation===this.previewGeneration){this.value={...this.value,preview:{target,draftKey:fields,loading:false,error:'条件核验失败：'+textError(error)}};this.emit()}}
  }
  ready(target:ReplanTarget|undefined):ReplanPreview|undefined{
    const preview=this.value.preview;
    return target&&key(target)===key(this.target)&&preview&&key(preview.target)===key(target)&&!preview.loading&&!preview.error&&preview.draftKey===draftKey(this.record(target.inspectionScopeId))&&preview.result?.eligible?preview.result:undefined;
  }
  /** 创建 UUID 只发生在最终提交；持久化的完整请求是后续查询/重试的唯一依据。 */
  async submit(target:ReplanTarget,model:Omit<ReplanRequest['options'],'permission'>){
    const record=this.record(target.inspectionScopeId),proof=this.ready(target);
    if(this.unavailable||!record||!proof?.basis||record.attempt&&record.attempt.phase!=='rejected'||this.isPending(record))return;
    let request:ReplanRequest;
    try{
      request=replanRequestSchema.parse({workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,commandId:this.ports.uuid(),source:{inspectionScopeId:target.inspectionScopeId,expectedBasis:proof.basis},input:{message:record.message},options:{...model,permission:record.permission},...(target.dispositionId?{dispositionId:target.dispositionId}:{})});
      if(this.value.records.some(item=>item.attempt?.request.commandId===request.commandId))throw Error('命令标识与已有业务请求重复');
    }catch(error){this.value={...this.value,error:'新业务目标或模型无效：'+textError(error)};this.emit();return}
    const next={...record,attempt:{request,proof,phase:'submitting' as const,uncertain:false}};
    if(this.save(next))await this.send(next);
  }
  private async send(record:ReplanDraft){
    const attempt=record.attempt!,request=attempt.request;if(this.pending.has(request.commandId))return;
    this.pending.add(request.commandId);this.emit();
    try{const receipt=checkedReplanReceipt(await this.ports.submit(structuredClone(request)),request,attempt.proof,attempt.receipt);this.save({...record,attempt:{...attempt,phase:'accepted',receipt,error:undefined}})}
    catch(error){const rejected=!attempt.uncertain&&replanRejected(error);this.save({...record,attempt:{...attempt,phase:rejected?'rejected':'unknown',uncertain:!rejected,error:textError(error)}})}
    finally{this.pending.delete(request.commandId);this.emit()}
  }
  /** 查询 undefined 仍是未知；受理事实不因网络失败退回可编辑状态。 */
  async query(inspectionScopeId:string){
    const record=this.record(inspectionScopeId),attempt=record?.attempt;
    if(this.unavailable||!record||!attempt||this.isPending(record))return;
    const request=attempt.request;this.pending.add(request.commandId);this.emit();
    try{
      const raw=await this.ports.lookup({workspaceId:this.workspaceId,rootSessionId:this.rootSessionId,commandId:request.commandId});
      if(raw!==undefined)this.save({...record,attempt:{...attempt,phase:'accepted',receipt:checkedReplanReceipt(raw,request,attempt.proof,attempt.receipt),error:undefined}});
      else if(attempt.phase!=='accepted')this.save({...record,attempt:{...attempt,phase:'unknown',uncertain:true,error:'尚未查询到受理回执；保留原请求，不创建另一命令。'}});
    }catch(error){this.save({...record,attempt:{...attempt,phase:attempt.phase==='accepted'?'accepted':'unknown',uncertain:true,error:'查询结果未确认：'+textError(error)}})}
    finally{this.pending.delete(request.commandId);this.emit()}
  }
  async retry(inspectionScopeId:string){const record=this.record(inspectionScopeId);if(this.unavailable||record?.attempt?.phase!=='unknown'||this.isPending(record))return;const next={...record,attempt:{...record.attempt,uncertain:true}};if(this.save(next))await this.send(next)}
  /** 恢复仅查未知命令；预览不持久为有效资格，重新进入草稿必须再次明确核验。 */
  async restore(){await Promise.all(this.value.records.filter(item=>item.attempt?.phase==='unknown').map(item=>this.query(item.inspectionScopeId)))}
}

/** 同 renderer 共享一个 root 控制器；工作区切换不能生成竞争写入同一本机索引的请求。 */
export class ScopeReplanPool {
  private controllers=new Map<string,ScopeReplanController>();
  constructor(private idleLimit=16){}
  get(workspaceId:string,rootSessionId:string,ports:ReplanPorts){
    const identity=JSON.stringify([workspaceId,rootSessionId]),controller=this.controllers.get(identity)??new ScopeReplanController(workspaceId,rootSessionId,ports);
    this.controllers.delete(identity);this.controllers.set(identity,controller);
    for(const [oldKey,old] of this.controllers){if(this.controllers.size<=this.idleLimit)break;if(oldKey!==identity&&old.canRelease)this.controllers.delete(oldKey)}
    return controller;
  }
}
