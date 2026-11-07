/**
 * 作用定位：组合原调用授权、已提交控制面、原知识事务、原治理/责任记录、受控文件阶段与当前选定文件，保存本机明确处置并派生新周期关联。
 * 设计原因：原 unknown、今天的字节和后来修复完成各自保留；取证在任务事务外，提交只做原身份/版本 CAS，不执行工具或反向等知识/模型队列。
 * 职责边界：只操作已打开工作区的唯一 Store；refresh只识别原授权中的v2契约。edit只接受当前数组与旧单对形状，不补造基线、清除unknown或授予续跑。
 */
import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {DispatchStore,DispatchState} from '../../core/tasks/dispatch-storage';
import {effectObservationInputSchema,effectObservationReportSchema,effectFileObservationSchema,effectDispositionInputSchema,effectDispositionLookupSchema,effectDispositionReceiptSchema,effectDispositionRecordSchema,effectDispositionListSchema,effectRelationsInputSchema,effectRelationsSchema,effectObservationLimits,sameEffectSubject,type EffectObservationInput,type EffectObservationReport,type EffectFileObservation,type EffectCallObservation,type EffectDispositionInput,type EffectDispositionLookup,type EffectDispositionReceipt,type EffectRelationsInput} from '../../core/tasks/effect-observation';
import {effectObservationBasis,effectDispositionCommand,effectDispositionRevision,effectDispositionReceipt,summarizeEffectDisposition} from '../../core/tasks/effect-observation-rules';
import {isVerifiableMainToolName} from '../../core/tasks/command-verification';
import {verifyArtifactBaselines} from '../../core/tasks/artifact-evidence';
import {artifactRelativePathSchema} from '../../core/tasks/artifact-baseline';
import {CommandVerificationService} from './command-verification-service';
import {readEffectSource,effectStateStamp,type EffectSourcePorts,type EffectSourceRead} from './effect-source';
import {knowledgeTransactionObservationSchema,type KnowledgeTransactionObservation} from '../../core/knowledge/knowledge-write-observation';
import {originalKnowledgeWrite,originalKnowledgeIdentity,type KnowledgeWriteReference} from '../../core/knowledge/knowledge-write-input';
import {persistentWriteObservationSchema,persistentWriteEffects,type PersistentWriteObservation,type PersistentWriteName} from '../../core/tasks/persistent-write-observation';
import {originalPersistentWrite,persistentWriteIdentity,persistentWriteSourceHash,type PersistentWriteReference} from '../../core/tasks/persistent-write-input';
import {controlledFileWriteInputSchema,controlledFileWriteToolName,type ControlledFileReportInput,type ControlledFileReport} from '../../core/tasks/controlled-file-operation';
import {observeControlledEffect,type ControlledEffectReference} from './effect-controlled-file';

/** Main 固定工作区根的可信只读端口；路径仍须二次规范化，释放只读占用不代表原调用已核实成功。 */
export interface EffectObservationPorts extends EffectSourcePorts {
  normalizePath(raw:string):string;
  observeFiles(paths:readonly string[],signal:AbortSignal):Promise<EffectFileObservation[]>;
  acquireRead():()=>void;
  /** 仅核原请求或固定计划的 journal；不提交、刷新、恢复或修剪文件。旧实例只可查询。 */
  observeKnowledge?(reference:KnowledgeWriteReference,signal?:AbortSignal):Promise<KnowledgeTransactionObservation>;
  /** 原治理账本或责任审计的保存证明；不读取当前关系替代原命令，不实施或批准。 */
  observePersistent?(reference:PersistentWriteReference,signal?:AbortSignal):Promise<PersistentWriteObservation>;
  /** 复用原成员受控阶段/补偿只读报告，不获取业务文件、备份或补偿写入口。 */
  observeControlled?(input:ControlledFileReportInput,signal?:AbortSignal):Promise<ControlledFileReport>;
  assertCurrent?():void;
}
// 只识别原授权中无歧义的单文件形状，不执行 Pi 的字符串/单对象参数纠正，也不合并新旧字段。
// edits 的成功匹配、顺序和重叠属于原工具执行结果；这里仅据原 path 观察今天的字节。
const editPair=z.object({oldText:z.string(),newText:z.string()}).strict();
const nativeInputs={
  read:z.object({path:z.string().min(1),offset:z.number().int().positive().optional(),limit:z.number().int().positive().optional()}).strict(),
  write:z.object({path:z.string().min(1),content:z.string()}).strict(),
  edit:z.union([
    z.object({path:z.string().min(1),edits:z.array(editPair).min(1)}).strict(),
    z.object({path:z.string().min(1),oldText:z.string(),newText:z.string()}).strict(),
  ]),
};
type Owner=Pick<KnowledgeWorkspace,'entry'|'assert'>;
function check(value:unknown,code:string,message:string):asserts value{if(!value)fail(code,message)}
export class EffectObservationService {
  constructor(private readonly owner:Owner,private readonly store:DispatchStore,private readonly commands:CommandVerificationService,private readonly ports?:EffectObservationPorts){}
  private parse<S extends z.ZodTypeAny>(schema:S,raw:unknown):z.output<S>{const value=schema.safeParse(raw);if(!value.success)fail('EFFECT_INPUT_INVALID','影响核实或处置请求无效');return value.data}
  /** 公共读取也有总字节界限；无法交付不改原存储，不把输出错误解释为未提交。 */
  private output<T>(value:T):T{check(Buffer.byteLength(JSON.stringify(value),'utf8')<=effectObservationLimits.outputBytes,'EFFECT_OUTPUT_LIMIT','公开结果超过有界读取上限，原记录仍保留');return value}
  private alive(workspaceId:string,signal?:AbortSignal){signal?.throwIfAborted();this.owner.assert();this.ports?.assertCurrent?.();check(workspaceId===this.owner.entry.id,'EFFECT_IDENTITY','请求不属于当前工作区')}
  /** 仅读当前原事实；所有路径只由已经核对的 proposed/allowed 推导，不能接受客户端路径。 */
  async observe(raw:unknown,signal?:AbortSignal):Promise<EffectObservationReport>{return (await this.prepare(this.parse(effectObservationInputSchema,raw),signal)).report}
  private async prepare(input:EffectObservationInput,signal?:AbortSignal){
    this.alive(input.workspaceId,signal);const before=await this.store.read();check(before.workspaceId===input.workspaceId,'EFFECT_IDENTITY','存储不属于当前工作区');
    const first=await readEffectSource(before,input,this.owner.entry.path,this.ports,this.commands);this.alive(input.workspaceId,signal);
    const report:EffectObservationReport={version:1,identity:input,checkedAt:new Date().toISOString(),basis:'0'.repeat(64),dispositionRevision:effectDispositionRevision(before,input.rootSessionId),consistency:'stable',source:first.source,calls:[],limitations:['本报告仅覆盖明确选择的调用和文件；当前观察不证明原操作完整效果，也不代表业务验收。'],readOnly:true,acceptance:'not_evaluated'};
    const paths=new Map<string,string>(),knowledge=new Map<string,KnowledgeWriteReference>(),persistent=new Map<string,PersistentWriteReference>(),controlled=new Map<string,ControlledEffectReference>(),readable=first.source.state==='verified'&&first.summary&&first.facts;
    for(const toolCallId of input.subject.toolCallIds){
      const fact=readable?first.facts!.items.find(x=>x.toolCallId===toolCallId):undefined;
      const item:EffectCallObservation={toolCallId,outcome:fact?.status??'unknown',coverage:'unsupported',limitations:[]};report.calls.push(item);
      if(!fact){item.limitations.push('原日志或调用身份不能完整核实，未推导文件路径或执行效果。');continue}
      const original=first.summary!.events.find(e=>e.seq===fact.proposedSeq)?.data.input;
      Object.assign(item,{toolName:fact.toolName,inputHash:hash(JSON.stringify(original)??'undefined'),proposedSeq:fact.proposedSeq,...(fact.allowedSeq?{allowedSeq:fact.allowedSeq}:{}),...(fact.finishedSeq?{finishedSeq:fact.finishedSeq}:{}),effects:fact.effects,scope:fact.scope});
      if(input.subject.kind==='main_run'&&isVerifiableMainToolName(fact.toolName)){
        const control=await this.commands.read({workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,runId:input.subject.runId,toolCallId},signal);
        item.coverage='control_commit_only';item.command=control.command;item.limitations.push('仅核实原控制面提交，不证明成员执行或业务完成。');
        if(control.consistency!=='stable')report.consistency='changed_during_read';continue;
      }
      const name=fact.toolName;
      if(input.subject.kind==='member_run'&&name===controlledFileWriteToolName&&fact.allowedSeq&&fact.status!=='denied'&&fact.scope.kind==='workspace'&&fact.scope.workspaceId===input.workspaceId&&fact.effects.length===1&&fact.effects[0]==='business-write'&&this.ports?.observeControlled&&first.run&&first.source.scopeId){
        const parsed=controlledFileWriteInputSchema.safeParse(original);
        if(!parsed.success){item.limitations.push('原受控写入参数不符合严格协议，未查询阶段。');continue}
        const reference:ControlledEffectReference={identity:{workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,taskId:input.subject.taskId,runId:input.subject.runId,toolCallId},scopeId:first.source.scopeId,binding:first.run.binding,input:parsed.data};
        item.coverage='controlled_file';item.controlled=await observeControlledEffect(reference,this.ports.observeControlled,()=>this.alive(input.workspaceId,signal),signal);controlled.set(toolCallId,reference);
        item.limitations.push('仅核实原写入和独立补偿阶段；不读取当前文件，不授予补偿或业务验收。');
        if(item.controlled.state==='absent')item.limitations.push('未查到原受控记录不等于没有写入，不可据此重试。');
        continue;
      }
      if(input.subject.kind==='main_run'&&Object.prototype.hasOwnProperty.call(persistentWriteEffects,name)&&fact.allowedSeq&&fact.status!=='denied'&&fact.scope.kind==='knowledge'&&fact.scope.workspaceId===input.workspaceId&&fact.effects.length===1&&fact.effects[0]===persistentWriteEffects[name as PersistentWriteName]&&this.ports?.observePersistent){
        const main=first.summary!.conversationBinding;
        const reference=main&&first.source.scopeId?originalPersistentWrite(name,original,{workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,scopeId:first.source.scopeId,agentInstanceId:main.agentInstanceId,agentSessionId:main.agentSessionId,runId:input.subject.runId,toolCallId}):undefined;
        if(!reference){item.limitations.push('原参数或主身份不符合保存记录协议，未查询原命令。');continue}
        item.coverage='persistent_record';item.persistent=await this.persistent(reference,signal);persistent.set(toolCallId,reference);
        item.limitations.push(reference.kind==='governance'?'只核实原观察或提案的保存，不表示批准、知识实施、迁移或业务完成。':'只核实原责任变更的保存，不证明今日负责人、旧任务交接或派发切换。');
        if(item.persistent.state==='absent')item.limitations.push('未查到原保存记录不等于从未执行，原结果保持。');
        continue;
      }
      if(input.subject.kind==='main_run'&&(name==='cbim_knowledge_commit'||name==='cbim_object_commit'||name==='cbim_knowledge_refresh')&&fact.allowedSeq&&fact.status!=='denied'&&fact.scope.kind==='knowledge'&&fact.scope.workspaceId===input.workspaceId&&fact.effects.length===1&&fact.effects[0]==='knowledge-write'&&this.ports?.observeKnowledge){
        const version=first.summary!.events.find(e=>e.seq===fact.allowedSeq)?.data.contractVersion;
        const reference=originalKnowledgeWrite(name,original,typeof version==='number'?version:undefined);
        if(!reference||originalKnowledgeIdentity(reference).workspaceId!==input.workspaceId){item.limitations.push('原知识参数缺少可核实的请求或计划身份，未查询事务。');continue}
        item.coverage='knowledge_transaction';item.knowledge=await this.knowledge(reference,signal);knowledge.set(toolCallId,reference);
        item.limitations.push('仅核实原知识事务阶段，不证明今天的正文、业务验收或可安全重放。');
        if(name==='cbim_object_commit')item.limitations.push('对象事务提交不证明后续空目录修剪成功；查询不会修剪目录。');
        if(item.knowledge.state==='absent')item.limitations.push('未查到原事务不等于从未执行，原结果保持。');
        continue;
      }
      if((name!=='read'&&name!=='write'&&name!=='edit')||!fact.allowedSeq||fact.status==='denied'||fact.scope.kind!=='workspace'||fact.effects.length!==1||fact.effects[0]!==(name==='read'?'read':'business-write')||!this.ports){item.limitations.push('没有受支持的单文件授权适配；不执行补充命令，不把查无记录解释为未执行。');continue}
      const parsed=nativeInputs[name].safeParse(original);
      if(!parsed.success){item.limitations.push('原单文件参数不符合支持协议，未读取文件。');continue}
      try{const relative=artifactRelativePathSchema.parse(this.ports.normalizePath(parsed.data.path));paths.set(toolCallId,relative)}catch{item.limitations.push('原路径不能安全定位到当前工作区业务文件，未读取内容。')}
    }
    const unique=[...new Set(paths.values())];
    if(unique.length){
      let release:(()=>void)|undefined;
      try{
        this.alive(input.workspaceId,signal);release=this.ports!.acquireRead();
        const timeout=AbortSignal.timeout(15_000),readSignal=signal?AbortSignal.any([signal,timeout]):timeout;
        const files=(await this.ports!.observeFiles(unique,readSignal)).map(value=>effectFileObservationSchema.parse(value));
        check(files.length===unique.length&&files.every((file,i)=>file.relativePath===unique[i]),'EFFECT_PORT_INVALID','文件观察返回值不属于原选择');
        for(const item of report.calls){const relative=paths.get(item.toolCallId);if(!relative)continue;item.coverage='selected_files_now';item.file=files[unique.indexOf(relative)];item.limitations.push('仅为当前字节观察，不证明原调用成功、完整作用或可恢复。');if(item.file.reason==='读取期间文件发生变化')report.consistency='changed_during_read'}
        this.baselines(first,report);
      }catch(error){this.alive(input.workspaceId,signal);for(const item of report.calls)if(paths.has(item.toolCallId)){item.coverage='unsupported';delete item.file;delete item.baselineChecks;item.limitations.push('文件只读占用、读取或返回值不可核实；没有取得当前证明。')}}
      finally{release?.()}
    }
    // 两次核实同一原引用；prepared 等阶段变化不能沿用第一次观察保存确定依据。
    for(const [toolCallId,reference]of knowledge){const again=await this.knowledge(reference,signal);if(!isDeepStrictEqual(report.calls.find(call=>call.toolCallId===toolCallId)!.knowledge,again)){report.consistency='changed_during_read';report.limitations.push('读取期间原知识事务发生变化，请重新核实。')}}
    for(const [toolCallId,reference]of persistent){const again=await this.persistent(reference,signal);if(!isDeepStrictEqual(report.calls.find(call=>call.toolCallId===toolCallId)!.persistent,again)){report.consistency='changed_during_read';report.limitations.push('读取期间原保存记录发生变化，请重新核实。')}}
    for(const [toolCallId,reference]of controlled){const again=await observeControlledEffect(reference,this.ports!.observeControlled!,()=>this.alive(input.workspaceId,signal),signal);if(!isDeepStrictEqual(report.calls.find(call=>call.toolCallId===toolCallId)!.controlled,again)){report.consistency='changed_during_read';report.limitations.push('读取期间原受控阶段或补偿历史变化，请重新核实。')}}
    const last=await readEffectSource(before,input,this.owner.entry.path,this.ports,this.commands);this.alive(input.workspaceId,signal);
    const after=await this.store.read();this.alive(input.workspaceId,signal);
    if(first.stamp!==last.stamp||effectStateStamp(before,input)!==effectStateStamp(after,input)||report.dispositionRevision!==effectDispositionRevision(after,input.rootSessionId)){report.consistency='changed_during_read';report.limitations.push('读取期间来源、周期或处置版本变化，请重新核实；本次不作为确定保存依据。')}
    // 先形成严格公开对象再计算依据，避免构造时键插入顺序与 Store 重放的 Schema 顺序不同。
    const checked=effectObservationReportSchema.parse(report);checked.basis=effectObservationBasis(checked);
    check(Buffer.byteLength(JSON.stringify(checked),'utf8')<=effectObservationLimits.outputBytes,'EFFECT_LIMIT','观察超过公开输出上限');
    return {report:checked,stateStamp:effectStateStamp(before,input)};
  }
  /** 可信端口同样核身份与输出；异常只给出不可核实诊断，不产生未写入证明。 */
  private async knowledge(reference:KnowledgeWriteReference,signal?:AbortSignal):Promise<KnowledgeTransactionObservation>{
    const identity=originalKnowledgeIdentity(reference);this.alive(identity.workspaceId,signal);
    try{const value=knowledgeTransactionObservationSchema.parse(await this.ports!.observeKnowledge!(reference,signal));this.alive(identity.workspaceId,signal);check(isDeepStrictEqual(value.identity,identity),'EFFECT_PORT_INVALID','知识观察不属于原请求');if(reference.kind==='request')check(value.requestHash===undefined||value.requestHash===hash(json(reference.request)),'EFFECT_PORT_INVALID','知识观察的原请求指纹不一致');return value}
    catch{this.alive(identity.workspaceId,signal);return knowledgeTransactionObservationSchema.parse({identity,state:'unverifiable',reason:'query_unavailable'})}
  }
  /** 原身份和解析参数摘要均须匹配；端口错误保持不可核实，不能洗成未保存。 */
  private async persistent(reference:PersistentWriteReference,signal?:AbortSignal):Promise<PersistentWriteObservation>{
    const identity=persistentWriteIdentity(reference),sourceHash=persistentWriteSourceHash(reference);this.alive(identity.workspaceId,signal);
    try{const value=persistentWriteObservationSchema.parse(await this.ports!.observePersistent!(reference,signal));this.alive(identity.workspaceId,signal);check(isDeepStrictEqual(value.identity,identity)&&value.sourceHash===sourceHash,'EFFECT_PORT_INVALID','保存记录观察不属于原调用或原参数');return value}
    catch{this.alive(identity.workspaceId,signal);return persistentWriteObservationSchema.parse({identity,sourceHash,state:'unverifiable',reason:'query_unavailable'})}
  }
  private baselines(source:EffectSourceRead,report:EffectObservationReport){
    if(!source.run||!source.summary||!this.ports)return;
    const verified=verifyArtifactBaselines(source.summary.events,source.run.binding,source.run.prepared.knowledgeRevision,this.ports.normalizePath);
    for(const call of report.calls){const current=call.file;if(!current)continue;
      const checks:NonNullable<EffectCallObservation['baselineChecks']>=[];
      const matching=verified.records.filter(record=>record.baseline.files.some(file=>file.relativePath===current.relativePath));
      // records 来自 canonical 的持久顺序；只比较最近八份，较旧历史仍由原运行报告读取。
      if(matching.length>effectObservationLimits.baselines)call.limitations.push('同文件成功基线较多，本次仅比较持久顺序中最近的八份；不代表覆盖全部历史。');
      for(const record of matching.slice(-effectObservationLimits.baselines)){const file=record.baseline.files.find(file=>file.relativePath===current.relativePath)!;const expected={byteLength:file.byteLength,sha256:file.sha256},observed=current.state==='present'?{byteLength:current.byteLength!,sha256:current.sha256!}:undefined;
        checks.push({baselineId:record.baseline.baselineId,invalidated:verified.refs.find(ref=>ref.baselineId===record.baseline.baselineId)!.invalidated,file:{relativePath:current.relativePath,state:observed?(isDeepStrictEqual(expected,observed)?'matches':'changed'):current.state==='missing'?'missing':'unverifiable',...(observed?{observed}:{}),expected,...(current.reason?{reason:current.reason}:{})}});
      }
      if(checks.length)call.baselineChecks=checks;
    }
  }
  /** 同 root 版本与所选来源摘要分开；查询不初始化另一个存储，也不重读文件。 */
  async list(raw:unknown){const input=this.parse(effectObservationInputSchema,raw);this.alive(input.workspaceId);const state=await this.store.read();const result=effectDispositionListSchema.parse({identity:input,revision:effectDispositionRevision(state,input.rootSessionId),records:(state.effectDispositions??[]).filter(r=>r.request.workspaceId===input.workspaceId&&r.request.rootSessionId===input.rootSessionId&&sameEffectSubject(r.request.subject,input.subject)).map(summarizeEffectDisposition),readOnly:true});check(Buffer.byteLength(JSON.stringify(result),'utf8')<=effectObservationLimits.outputBytes,'EFFECT_LIMIT','处置摘要超过公开输出上限');return result}
  /** 已保存回执优先，后来的文件/知识变化不能让它重新保存或变成未受理。 */
  async receipt(raw:EffectDispositionLookup):Promise<EffectDispositionReceipt|undefined>{const input=this.parse(effectDispositionLookupSchema,raw);this.alive(input.workspaceId);const value=await this.store.commandReceipt('effect-disposition-'+input.commandId);if(!value)return undefined;const receipt=effectDispositionReceiptSchema.parse(value.receipt);check(receipt.workspaceId===input.workspaceId&&receipt.rootSessionId===input.rootSessionId&&receipt.record.dispositionId===input.commandId,'EFFECT_IDENTITY','处置命令不属于原选择');return this.output(receipt)}
  /** actor 只能来自本机入口；任何取证和停止失败都不回滚已保存附录。 */
  private async recordReady(raw:EffectDispositionInput,actor:{kind:'local_desktop';interaction:'explicit_submit'},signal?:AbortSignal){
    const input=this.parse(effectDispositionInputSchema,raw),command=effectDispositionCommand(input);
    this.alive(input.workspaceId,signal);const old=await this.store.commandReceipt(command.commandId);
    if(old){check(old.fingerprint===command.fingerprint,'EFFECT_COMMAND_CONFLICT','同一处置命令已绑定其它选择或决定');return {receipt:effectDispositionReceiptSchema.parse(old.receipt)}}
    check(isDeepStrictEqual(actor,{kind:'local_desktop',interaction:'explicit_submit'}),'EFFECT_ACTOR','处置只能由本机明确提交');
    const selection={workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,subject:input.subject},prepared=await this.prepare(selection,signal),observation=prepared.report;
    check(observation.consistency==='stable'&&observation.basis===input.expectedBasis,'EFFECT_BASIS_STALE','观察依据已变化，请重新核实');
    check(observation.dispositionRevision===input.expectedRevision,'EFFECT_REVISION_CONFLICT','已有新的处置记录，请刷新后再提交');
    check(observation.source.scopeId&&observation.source.scopeStatus==='closed'&&observation.source.execution!=='in_flight','EFFECT_SOURCE_NOT_CLOSED','请先停止并结算原周期，再保存处置');
    this.alive(input.workspaceId,signal);
    const record=effectDispositionRecordSchema.parse({version:1,dispositionId:input.commandId,request:input,revision:input.expectedRevision+1,recordedAt:new Date().toISOString(),actor,observation});
    check(Buffer.byteLength(JSON.stringify(effectDispositionReceipt(record)),'utf8')<=effectObservationLimits.outputBytes,'EFFECT_LIMIT','处置回执超过公开输出上限，请缩小调用集合');
    return {input,command,selection,prepared,record};
  }
  /** 只有进入事务前的确定拒绝使用 PREACCEPT；Store/CAS/落盘及回包异常保持未知，由原命令查询收口。 */
  async record(raw:EffectDispositionInput,actor:{kind:'local_desktop';interaction:'explicit_submit'},signal?:AbortSignal):Promise<EffectDispositionReceipt>{
    let ready:Awaited<ReturnType<EffectObservationService['recordReady']>>;
    try{ready=await this.recordReady(raw,actor,signal)}catch(error){
      const code=(error as {code?:string})?.code;
      if(code&&['EFFECT_INPUT_INVALID','EFFECT_IDENTITY','EFFECT_ACTOR','EFFECT_BASIS_STALE','EFFECT_REVISION_CONFLICT','EFFECT_SOURCE_NOT_CLOSED','EFFECT_LIMIT'].includes(code))fail(code.replace('EFFECT_','EFFECT_PREACCEPT_'),'处置尚未提交：'+(error instanceof Error?error.message:'请重新核实输入'));
      throw error;
    }
    if(ready.receipt)return this.output(ready.receipt);
    const {input,command,selection,prepared,record}=ready;
    const receipt=await this.store.transact(command,async state=>{
      this.alive(input.workspaceId,signal);check(effectStateStamp(state,selection)===prepared.stateStamp,'EFFECT_BASIS_STALE','保存前来源事实已变化，请重新核实');check(effectDispositionRevision(state,input.rootSessionId)===input.expectedRevision,'EFFECT_REVISION_CONFLICT','保存前处置版本已变化');
      return {effectDispositions:[record],receipt:effectDispositionReceipt(record)};
    });
    return this.output(effectDispositionReceiptSchema.parse(receipt));
  }
  /** 只从已保存意图派生后续关系；新修复完成不改写原调用状态或原处置。 */
  async relations(raw:EffectRelationsInput){const input=this.parse(effectRelationsInputSchema,raw);this.alive(input.workspaceId);const state=await this.store.read(),record=state.effectDispositions?.find(r=>r.dispositionId===input.dispositionId&&r.request.workspaceId===input.workspaceId&&r.request.rootSessionId===input.rootSessionId);check(record,'EFFECT_NOT_FOUND','未找到本会话的处置记录');
    const graph=state.graphs.find(g=>g.identity.rootSessionId===input.rootSessionId),links=(state.scopes??[]).filter(s=>s.rootSessionId===input.rootSessionId&&s.workspaceId===input.workspaceId&&(s.recovery?.dispositionId===input.dispositionId||s.replan?.dispositionId===input.dispositionId)).map(s=>({kind:s.recovery?'inspection' as const:'repair' as const,scopeId:s.scopeId,status:s.status,...(s.outcome?{outcome:s.outcome}:{}),runId:(s.recovery??s.replan)!.context.initialRunId,taskIds:graph?.tasks.filter(t=>t.scopeId===s.scopeId).map(t=>t.taskId)??[],...(s.goal?{goalRevision:s.goal.revision}:{}),...(s.goal?.review?{reviewDecision:s.goal.review.decision}:{})}));
    return this.output(effectRelationsSchema.parse({identity:input,record,links,readOnly:true}));
  }
}
