/**
 * 作用定位：正式成员的 JSON 产物验证短门闩，连接冻结 Workflow、真实基线与平台同字节读取。
 * 设计原因：模型只选择已有要求和基线，不能指定路径、Schema 或结论；读前后核知识、进度与代次，暂存须有真实成功回执才成为可引用事实。
 * 职责边界：rejected 仍是验证已经执行的事实，不能通过工具成功冒充 passed；交付时再次核实选定文件，不执行命令或授予恢复权限。
 */
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fail} from '../foundation/errors';
import {jsonValidationLimits,type BoundedJsonSchema,type JsonValidationOutcome} from '../workspace/json-validation-schema';
import type {ArtifactFileFact,ArtifactFileCheck} from '../tasks/artifact-baseline';
import {verifyArtifactBaselines} from '../tasks/artifact-evidence';
import {validationInputSchema,validationResultSchema,validationToolName,type ValidationInput,type ValidationResult,type ValidationRecord} from '../tasks/validation';
import {ValidationTools} from '../tasks/validation-tools';
import {validationRequirement,verifyValidationRecords} from '../tasks/validation-evidence';
import type {WorkflowContractBinding} from '../tasks/execution-context';
import type {TaskProgress} from '../tasks/progress';
import type {ArtifactCapturePort} from './artifact-capture';
import type {MemberRunBinding} from './member-run';
import type {StoredEvent} from './types';

/** 仅可信平台实现；validateFile 的指纹与判定须来自同一次安全读取，正文不得返回模型。 */
export interface ValidationFilePort {
  validateFile(expected:ArtifactFileFact,schema:BoundedJsonSchema,signal:AbortSignal):Promise<JsonValidationOutcome&{artifact:ArtifactFileFact}>;
  checkFiles(files:readonly ArtifactFileFact[],signal:AbortSignal):Promise<ArtifactFileCheck[]>;
}
/** 一轮一实例；真实 validation 调用结束释放其锁，交付复核拥有独立 finally 生命周期。 */
export class RunValidation {
  readonly tools:ValidationTools;
  private events:StoredEvent[]=[];
  private reserved?:{id:string;input:ValidationInput;consumed:boolean};
  private deliveryReading=false;
  private generations=new Map<string,number>();
  private controller=new AbortController();
  constructor(private readonly binding:MemberRunBinding,private readonly bindings:readonly WorkflowContractBinding[],private readonly artifacts:ArtifactCapturePort,private readonly files:ValidationFilePort,private readonly context:{
    current():TaskProgress|undefined;
    generation():number;
    assertReady(toolCallId:string):void;
    /** 交付自身已获准，其余调用（包括未完成审批）不得与文件复核重叠。 */
    assertDeliveryReady():void;
    save(value:ValidationResult):Promise<void>;
  }){
    this.binding=Object.freeze(structuredClone(binding));this.bindings=structuredClone(bindings);
    this.tools=new ValidationTools(this.binding,{knowledgeRevision:artifacts.knowledgeRevision,bindings:this.bindings,run:(input,id)=>this.run(input,id)});
  }
  /** 在任何策略 await 之前预占；交付复核期间同样拒绝新工具，避免审批或写入越过读取窗口。 */
  guard(name:string,id:string,input:unknown,activeIds:readonly string[]):string|undefined{
    if(this.reserved||this.deliveryReading)return '正在核实 JSON 产物，请等待本次核实结束后再调用工具';
    if(name!==validationToolName)return;
    if(this.controller.signal.aborted)return '运行已停止，不能验证 JSON 产物';
    const parsed=validationInputSchema.safeParse(input);if(!parsed.success)return 'JSON 产物验证参数不符合结构约定';
    if(activeIds.length)return '仍有工具或审批未结束，不能验证 JSON 产物';
    this.reserved={id,input:parsed.data,consumed:false};
  }
  /** 只接收已经落盘的事件；当前代次由运行时持有，不从模型传来的 progressVersion 推断。 */
  observed(event:StoredEvent){
    if(event.type==='run.started'||event.type.startsWith('tool.')||['task.updated','artifact.baseline_captured','validation.checked','run.stop_requested'].includes(event.type))this.events.push(event);
    if(event.type==='validation.checked'){
      const value=event.data.validation as ValidationResult|undefined;if(value)this.generations.set(value.toolCallId,this.context.generation());
    }
    if((event.type==='tool.finished'||event.type==='tool.denied')&&event.data.id===this.reserved?.id)this.reserved=undefined;
  }
  stop(){this.controller.abort(Error('运行已停止，JSON 产物验证取消'))}
  /** 返回当前计划/副作用代次的可信记录；步骤版本增加不使同一代次的验证失效。 */
  records():ValidationRecord[]{return verifyValidationRecords(this.events,this.binding,this.artifacts.knowledgeRevision,this.bindings,this.artifacts.normalizePath).filter(record=>this.generations.get(record.result.toolCallId)===this.context.generation())}
  private lastEffectSeq(){return this.events.filter(event=>event.type==='tool.allowed'&&Array.isArray(event.data.effects)&&event.data.effects.some(effect=>['business-write','knowledge-write','command'].includes(String(effect)))).at(-1)?.seq??0}
  private selected(input:ValidationInput){
    const selected=validationRequirement(this.bindings,input.moduleId,input.requirementId),verified=verifyArtifactBaselines(this.events,this.binding,this.artifacts.knowledgeRevision,this.artifacts.normalizePath,input.baselineId);
    const record=verified.records.find(item=>item.baseline.baselineId===input.baselineId),ref=verified.refs.find(item=>item.baselineId===input.baselineId);
    if(!record||!ref||ref.invalidated||record.baseline.progressVersion>input.expectedTaskProgressVersion)fail('VALIDATION_BASELINE','需要当前运行中已确认且未失效的明确文件基线');
    const file=record.baseline.files.find(item=>this.artifacts.normalizePath(item.relativePath)===this.artifacts.normalizePath(selected.requirement.artifactPath));
    if(!file)fail('VALIDATION_BASELINE','所选基线未覆盖 Workflow 指定的 JSON 文件');
    return {selected,file:{relativePath:file.relativePath,byteLength:file.byteLength,sha256:file.sha256}};
  }
  private async run(input:ValidationInput,id:string):Promise<ValidationResult>{
    const reserved=this.reserved;
    if(!reserved||reserved.id!==id||reserved.consumed||!isDeepStrictEqual(reserved.input,input))fail('VALIDATION_CALL','JSON 验证必须来自本轮已授权的一次性调用');reserved.consumed=true;
    const generation=this.context.generation(),lastEffectSeq=this.lastEffectSeq();
    const check=()=>{this.controller.signal.throwIfAborted();this.context.assertReady(id);if(this.context.current()?.version!==input.expectedTaskProgressVersion||this.context.generation()!==generation||this.lastEffectSeq()!==lastEffectSeq)fail('VALIDATION_PROGRESS_CHANGED','验证期间计划或产物代次已经变化，请重新核实')};
    check();if(this.events.filter(event=>event.type==='validation.checked').length>=jsonValidationLimits.records)fail('VALIDATION_LIMIT','本轮 JSON 验证记录已达到上限');
    const {selected,file}=this.selected(input);
    await this.artifacts.assertCurrentKnowledge();check();
    const outcome=await this.files.validateFile(structuredClone(file),structuredClone(selected.requirement.schema),this.controller.signal);check();
    if(!isDeepStrictEqual(outcome.artifact,file))fail('VALIDATION_BASELINE_CHANGED','验证文件与选中基线不一致，请重新采集');
    await this.artifacts.assertCurrentKnowledge();check();
    if(!isDeepStrictEqual(this.selected(input).file,file))fail('VALIDATION_BASELINE_CHANGED','验证期间文件基线已经变化');
    const result=validationResultSchema.parse({version:1,validationId:randomUUID(),toolCallId:id,binding:this.binding,validator:'json-schema-v1',requirement:{moduleId:selected.binding.moduleId,workflowId:selected.binding.workflowId,workflowVersion:selected.binding.workflowVersion,requirementId:selected.requirement.id,schemaHash:selected.schemaHash},knowledgeRevision:this.artifacts.knowledgeRevision,taskProgressVersion:input.expectedTaskProgressVersion,baselineId:input.baselineId,artifact:file,lastEffectSeq,checkedAt:new Date().toISOString(),outcome:outcome.outcome,issues:outcome.issues});
    await this.context.save(result);check();return result;
  }
  /** 保存交付前只读复核；锁与真正 validation 调用分离，finally 不得释放另一调用的占位。 */
  async verifyCurrent(records:readonly ValidationRecord[]):Promise<void>{
    if(this.reserved||this.deliveryReading)fail('VALIDATION_BUSY','JSON 验证尚未结束，不能准备交付');
    this.context.assertDeliveryReady();this.deliveryReading=true;
    const generation=this.context.generation(),version=this.context.current()?.version;
    const check=()=>{this.controller.signal.throwIfAborted();this.context.assertDeliveryReady();if(this.context.generation()!==generation||this.context.current()?.version!==version)fail('VALIDATION_PROGRESS_CHANGED','交付核实期间计划或产物代次已变化')};
    try{
      check();const current=this.records();
      if(records.some(record=>record.result.outcome!=='passed'||!current.some(item=>isDeepStrictEqual(item,record))))fail('VALIDATION_RECORD','交付必须引用本轮当前代次的真实通过记录');
      const files=new Map<string,ArtifactFileFact>();
      for(const record of records){const file=record.result.artifact,old=files.get(file.relativePath);if(old&&!isDeepStrictEqual(old,file))fail('VALIDATION_BASELINE_CHANGED','同一 JSON 文件存在不同验证指纹');files.set(file.relativePath,file)}
      await this.artifacts.assertCurrentKnowledge();check();
      if(files.size){const observed=await this.files.checkFiles([...files.values()],this.controller.signal);check();if(observed.length!==files.size||observed.some((item,index)=>{const file=[...files.values()][index];return item.relativePath!==file.relativePath||item.state!=='matches'||!isDeepStrictEqual(item.expected,{byteLength:file.byteLength,sha256:file.sha256})||!isDeepStrictEqual(item.observed,{byteLength:file.byteLength,sha256:file.sha256})}))fail('VALIDATION_ARTIFACT_CHANGED','JSON 文件已偏离通过验证时的字节，请重新读取、采集和验证')}
      await this.artifacts.assertCurrentKnowledge();check();
      if(records.some(record=>!this.records().some(item=>isDeepStrictEqual(item,record))))fail('VALIDATION_RECORD','交付核实期间验证记录已失效');
    }finally{this.deliveryReading=false}
  }
}
