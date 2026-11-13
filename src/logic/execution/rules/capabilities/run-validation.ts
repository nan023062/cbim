/**
 * 目录归属：logic/execution/rules/execution/capabilities；成员运行能力与短期门闩。

 * 装配边界：启动前检查冻结验证要求和真实平台支持，验证器扩展不再修改通用运行核心。
 * 作用定位：正式成员的 JSON/CSV/PNG 验证短门闩，连接冻结要求、原文件或完整集合身份及平台同字节读取。
 * 设计原因：模型不能指定路径、规则或结论；完整模式保留原操作证明，在专业检查两侧重核全集合，共用15秒期限；知识、进度与代次须稳定，暂存须有真实成功回执。
 * 职责边界：rejected只表示实际检查不符合；交付另重核同一完整集合，旧模式复核选定文件，不执行命令或授予恢复权限。
 * 写入时序包含 external-write，验证不能跨过新的外部副作用继续沿用旧边界。
 */
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fail} from '../../../../core/errors';
import {jsonValidationLimits,type BoundedJsonSchema,type JsonValidationOutcome} from '../../../workspace/rules/json-validation-schema';
import type {CsvTableSchema,CsvValidationOutcome} from '../../../workspace/rules/csv-validation-schema';
import type {PngImageSchema,PngValidationOutcome} from '../../../workspace/rules/png-validation-schema';
import type {ArtifactFileFact,ArtifactFileCheck} from '../../../evidence/rules/artifact-baseline';
import {verifyArtifactBaselines} from '../../../evidence/rules/artifact-evidence';
import {verifyOutputManifests} from '../../../evidence/rules/output-manifest-evidence';
import type {OutputManifestRecord} from '../../../evidence/rules/output-manifest';
import {completeOutputRequired,selectCompleteOutput,outputManifestIdentity} from '../../../evidence/rules/complete-output-evidence';
import {preparedArtifactScopes,artifactScopeLimits} from '../../../workspace/rules/artifact-scope';
import {validationInputSchema,validationResultSchema,validationToolName,type ValidationInput,type ValidationResult,type ValidationRecord} from '../../../evidence/rules/validation';
import {ValidationTools} from '../../../evidence/rules/validation-tools';
import {validationRequirement,verifyValidationRecords} from '../../../evidence/rules/validation-evidence';
import type {WorkflowContractBinding} from '../../../tasks/rules/execution-context';
import type {TaskProgress} from '../../../evidence/rules/progress';
import type {ArtifactCapturePort} from './artifact-capture';
import type {MemberRunBinding} from '../member-run';
import type {StoredEvent} from '../types';

/** 仅可信平台实现；JSON/CSV/PNG 各端口的指纹与判定须来自同一次安全读取，正文不得返回模型。 */
export interface ValidationFilePort {
  validateFile(expected:ArtifactFileFact,schema:BoundedJsonSchema,signal:AbortSignal):Promise<JsonValidationOutcome&{artifact:ArtifactFileFact}>;
  /** 旧JSON端口可不实现；声明CSV时必须在启动前具备真实实现，不能退回JSON或只读哈希。 */
  validateTable?(expected:ArtifactFileFact,schema:CsvTableSchema,signal:AbortSignal):Promise<CsvValidationOutcome&{artifact:ArtifactFileFact}>;
  /** 声明PNG时须具备真实完整解码端口；不能退回签名、元数据或显示成功。 */
  validateImage?(expected:ArtifactFileFact,schema:PngImageSchema,signal:AbortSignal):Promise<PngValidationOutcome&{artifact:ArtifactFileFact}>;
  checkFiles(files:readonly ArtifactFileFact[],signal:AbortSignal):Promise<ArtifactFileCheck[]>;
}
/** 运行时仅提供可信身份、当前进度、授权核实与可靠事件保存，不定义各验证器规则。 */
export interface RunValidationContext {
    current():TaskProgress|undefined;
    generation():number;
    assertReady(toolCallId:string):void;
    /** 交付自身已获准，其余调用（包括未完成审批）不得与文件复核重叠。 */
    assertDeliveryReady():void;
    /** 完整模式下在同字节专业检查两侧重读全部范围，共用一次读取时限。 */
    verifyManifest?(record:OutputManifestRecord,signal:AbortSignal):Promise<void>;
    save(value:ValidationResult):Promise<void>;
  }
/** 在获取运行资源前核实冻结要求；无要求时不创建能力，失败不启动引擎。 */
export function prepareRunValidation(workflows:readonly WorkflowContractBinding[],member:MemberRunBinding|undefined,artifacts:ArtifactCapturePort|undefined,files:ValidationFilePort|undefined):{required:boolean;create(context:RunValidationContext):RunValidation|undefined} {
    const validationCount=workflows.reduce((count,item)=>count+(item.contract.delivery?.requiredValidations?.length??0),0),validationRequired=validationCount>0;
    if(validationCount>jsonValidationLimits.records)fail('WORKFLOW_VALIDATION_LIMIT','冻结的产物验证要求超过本轮 16 条记录上限，不能启动执行');
    if(validationRequired&&(!member||!artifacts||!files))fail('VALIDATION_UNAVAILABLE','冻结的产物验证要求缺少正式成员文件验证端口');
    if(workflows.some(item=>item.contract.delivery?.requiredValidations?.some(rule=>rule.validator==='csv-table-v1'))&&!files?.validateTable)fail('VALIDATION_UNAVAILABLE','冻结的CSV要求缺少真实表格验证端口，不能启动执行');
    if(workflows.some(item=>item.contract.delivery?.requiredValidations?.some(rule=>rule.validator==='png-raster-v1'))&&!files?.validateImage)fail('VALIDATION_UNAVAILABLE','冻结的PNG要求缺少真实图片解码端口，不能启动执行');
  return {required:validationRequired,create:context=>validationRequired?new RunValidation(member!,workflows,artifacts!,files!,context):undefined};
}
/** 一轮一实例；真实 validation 调用结束释放其锁，交付复核拥有独立 finally 生命周期。 */
export class RunValidation {
  readonly tools:ValidationTools;
  private events:StoredEvent[]=[];
  private reserved?:{id:string;input:ValidationInput;consumed:boolean};
  private deliveryReading=false;
  private generations=new Map<string,number>();
  private controller=new AbortController();
  constructor(private readonly binding:MemberRunBinding,private readonly bindings:readonly WorkflowContractBinding[],private readonly artifacts:ArtifactCapturePort,private readonly files:ValidationFilePort,private readonly context:RunValidationContext){
    this.binding=Object.freeze(structuredClone(binding));this.bindings=structuredClone(bindings);
    this.tools=new ValidationTools(this.binding,{knowledgeRevision:artifacts.knowledgeRevision,bindings:this.bindings,manifestIdentity:input=>{const manifest=this.selected(input).manifest;return manifest?outputManifestIdentity(manifest.manifest):undefined},run:(input,id)=>this.run(input,id)});
  }
  /** 在任何策略 await 之前预占；交付复核期间同样拒绝新工具，避免审批或写入越过读取窗口。 */
  guard(name:string,id:string,input:unknown,activeIds:readonly string[]):string|undefined{
    if(this.reserved||this.deliveryReading)return '正在核实 JSON/CSV/PNG 产物，请等待本次核实结束后再调用工具';
    if(name!==validationToolName)return;
    if(this.controller.signal.aborted)return '运行已停止，不能验证 JSON/CSV/PNG 产物';
    const parsed=validationInputSchema.safeParse(input);if(!parsed.success)return 'JSON/CSV/PNG 产物验证参数不符合结构约定';
    if(activeIds.length)return '仍有工具或审批未结束，不能验证 JSON/CSV/PNG 产物';
    this.reserved={id,input:parsed.data,consumed:false};
  }
  /** 只接收已经落盘的事件；当前代次由运行时持有，不从模型传来的 progressVersion 推断。 */
  observed(event:StoredEvent){
    if(event.type==='run.started'||event.type.startsWith('tool.')||event.type.startsWith('artifact.transition_')||['task.updated','artifact.baseline_captured','artifact.manifest_captured','validation.checked','run.stop_requested','run.interrupted'].includes(event.type))this.events.push(event);
    if(event.type==='validation.checked'){
      const value=event.data.validation as ValidationResult|undefined;if(value)this.generations.set(value.toolCallId,this.context.generation());
    }
    if((event.type==='tool.finished'||event.type==='tool.denied')&&event.data.id===this.reserved?.id)this.reserved=undefined;
  }
  stop(){this.controller.abort(Error('运行已停止，JSON/CSV/PNG 产物验证取消'))}
  /** 返回当前计划/副作用代次的可信记录；步骤版本增加不使同一代次的验证失效。 */
  records():ValidationRecord[]{return verifyValidationRecords(this.events,this.binding,this.artifacts.knowledgeRevision,this.bindings,this.artifacts.normalizePath).filter(record=>this.generations.get(record.result.toolCallId)===this.context.generation())}
  private lastEffectSeq(){return this.events.filter(event=>event.type==='tool.allowed'&&Array.isArray(event.data.effects)&&event.data.effects.some(effect=>['business-write','knowledge-write','external-write','command'].includes(String(effect)))).at(-1)?.seq??0}
  private selected(input:ValidationInput){
    const selected=validationRequirement(this.bindings,input.moduleId,input.requirementId);
    if(completeOutputRequired(this.bindings)){
      if(!input.manifestId||!this.context.verifyManifest)fail('MANIFEST_REQUIRED','完整模式的产物验证须明确选择清单并提供真实全集合复核');
      const evidence=verifyOutputManifests(this.events,this.binding,this.artifacts.knowledgeRevision,preparedArtifactScopes(this.bindings));
      const manifest=selectCompleteOutput(evidence,this.bindings,input.manifestId,{...this.binding,knowledgeRevision:this.artifacts.knowledgeRevision,progressVersion:input.expectedTaskProgressVersion});
      const file=manifest.manifest.snapshot.entries.find(entry=>entry.kind==='file'&&this.artifacts.normalizePath(entry.relativePath)===this.artifacts.normalizePath(selected.requirement.artifactPath));
      if(!file||file.kind!=='file')fail('VALIDATION_BASELINE','完整清单没有覆盖 Workflow 指定的必验文件');
      return {selected,file:{relativePath:file.relativePath,byteLength:file.byteLength,sha256:file.sha256},manifest};
    }
    if(!input.baselineId)fail('MANIFEST_UNDECLARED','未声明完整交付的运行须选择原文件基线');
    const verified=verifyArtifactBaselines(this.events,this.binding,this.artifacts.knowledgeRevision,this.artifacts.normalizePath,input.baselineId);
    const record=verified.records.find(item=>item.baseline.baselineId===input.baselineId),ref=verified.refs.find(item=>item.baselineId===input.baselineId);
    if(!record||!ref||ref.invalidated||record.baseline.progressVersion>input.expectedTaskProgressVersion)fail('VALIDATION_BASELINE','需要当前运行中已确认且未失效的明确文件基线');
    const file=record.baseline.files.find(item=>this.artifacts.normalizePath(item.relativePath)===this.artifacts.normalizePath(selected.requirement.artifactPath));
    if(!file)fail('VALIDATION_BASELINE','所选基线未覆盖 Workflow 指定的必验文件');
    return {selected,file:{relativePath:file.relativePath,byteLength:file.byteLength,sha256:file.sha256}};
  }
  private async run(input:ValidationInput,id:string):Promise<ValidationResult>{
    const reserved=this.reserved;
    if(!reserved||reserved.id!==id||reserved.consumed||!isDeepStrictEqual(reserved.input,input))fail('VALIDATION_CALL','产物验证必须来自本轮已授权的一次性调用');reserved.consumed=true;
    const generation=this.context.generation(),lastEffectSeq=this.lastEffectSeq(),signal=AbortSignal.any([this.controller.signal,AbortSignal.timeout(artifactScopeLimits.readMs)]);
    const check=()=>{signal.throwIfAborted();this.context.assertReady(id);if(this.context.current()?.version!==input.expectedTaskProgressVersion||this.context.generation()!==generation||this.lastEffectSeq()!==lastEffectSeq)fail('VALIDATION_PROGRESS_CHANGED','验证期间计划或产物代次已经变化，请重新核实')};
    check();if(this.events.filter(event=>event.type==='validation.checked').length>=jsonValidationLimits.records)fail('VALIDATION_LIMIT','本轮产物验证记录已达到上限');
    const {selected,file,manifest}=this.selected(input);
    await this.artifacts.assertCurrentKnowledge();check();
    if(manifest){await this.context.verifyManifest!(manifest,signal);check()}
    const requirement=selected.requirement;
    if(requirement.validator==='csv-table-v1'&&!this.files.validateTable)fail('VALIDATION_UNAVAILABLE','CSV要求缺少本轮真实表格验证端口');
    if(requirement.validator==='png-raster-v1'&&!this.files.validateImage)fail('VALIDATION_UNAVAILABLE','PNG要求缺少本轮真实图片解码端口');
    const outcome=await (requirement.validator==='png-raster-v1'?this.files.validateImage!(structuredClone(file),structuredClone(requirement.schema),signal):requirement.validator==='csv-table-v1'?this.files.validateTable!(structuredClone(file),structuredClone(requirement.schema),signal):this.files.validateFile(structuredClone(file),structuredClone(requirement.schema),signal));check();
    if(!isDeepStrictEqual(outcome.artifact,file))fail('VALIDATION_BASELINE_CHANGED','验证文件与选中基线不一致，请重新采集');
    if(manifest){await this.context.verifyManifest!(manifest,signal);check()}
    await this.artifacts.assertCurrentKnowledge();check();
    if(!isDeepStrictEqual(this.selected(input),{selected,file,...(manifest?{manifest}:{})}))fail('VALIDATION_BASELINE_CHANGED','验证期间原产物依据已经变化');
    const result=validationResultSchema.parse({version:1,validationId:randomUUID(),toolCallId:id,binding:this.binding,validator:requirement.validator,requirement:{moduleId:selected.binding.moduleId,workflowId:selected.binding.workflowId,workflowVersion:selected.binding.workflowVersion,requirementId:selected.requirement.id,schemaHash:selected.schemaHash},knowledgeRevision:this.artifacts.knowledgeRevision,taskProgressVersion:input.expectedTaskProgressVersion,...(manifest?{manifest:outputManifestIdentity(manifest.manifest)}:{baselineId:input.baselineId}),artifact:file,lastEffectSeq,checkedAt:new Date().toISOString(),outcome:outcome.outcome,issues:outcome.issues});
    await this.context.save(result);check();return result;
  }
  /** 保存交付前只读复核；锁与真正 validation 调用分离，finally 不得释放另一调用的占位。 */
  async verifyCurrent(records:readonly ValidationRecord[]):Promise<void>{
    if(this.reserved||this.deliveryReading)fail('VALIDATION_BUSY','产物验证尚未结束，不能准备交付');
    this.context.assertDeliveryReady();this.deliveryReading=true;
    const generation=this.context.generation(),version=this.context.current()?.version;
    const check=()=>{this.controller.signal.throwIfAborted();this.context.assertDeliveryReady();if(this.context.generation()!==generation||this.context.current()?.version!==version)fail('VALIDATION_PROGRESS_CHANGED','交付核实期间计划或产物代次已变化')};
    try{
      check();const current=this.records();
      if(records.some(record=>record.result.outcome!=='passed'||!current.some(item=>isDeepStrictEqual(item,record))))fail('VALIDATION_RECORD','交付必须引用本轮当前代次的真实通过记录');
      const files=new Map<string,ArtifactFileFact>();
      for(const record of records){const file=record.result.artifact,old=files.get(file.relativePath);if(old&&!isDeepStrictEqual(old,file))fail('VALIDATION_BASELINE_CHANGED','同一必验文件存在不同验证指纹');files.set(file.relativePath,file)}
      await this.artifacts.assertCurrentKnowledge();check();
      if(files.size){const observed=await this.files.checkFiles([...files.values()],this.controller.signal);check();if(observed.length!==files.size||observed.some((item,index)=>{const file=[...files.values()][index];return item.relativePath!==file.relativePath||item.state!=='matches'||!isDeepStrictEqual(item.expected,{byteLength:file.byteLength,sha256:file.sha256})||!isDeepStrictEqual(item.observed,{byteLength:file.byteLength,sha256:file.sha256})}))fail('VALIDATION_ARTIFACT_CHANGED','必验文件已偏离通过验证时的字节，请重新读取、采集和验证')}
      await this.artifacts.assertCurrentKnowledge();check();
      if(records.some(record=>!this.records().some(item=>isDeepStrictEqual(item,record))))fail('VALIDATION_RECORD','交付核实期间验证记录已失效');
    }finally{this.deliveryReading=false}
  }
}
