/**
 * 完整出口另持交付调用门闩至真实结束；JSON读取共用原调用时限，始终重核所选原清单，不自动替换身份。
 * 作用定位：成员本轮完整产物采集的短期门闩，冻结 Workflow 范围并将真实观察可靠写入 canonical。
 * 设计原因：全目录读取跨多个 await；审批前预占，读取及保存前后核停止、进度和知识，不能把竞争中的局部集合当完整证据。
 * 职责边界：只保存观察，不签发验收；原事件与成功工具结束共同生效，门闩仅由真实结束/拒绝释放。
 */
import {randomUUID} from 'node:crypto';
import {fail} from '../foundation/errors';
import {isDeepStrictEqual as equal} from 'node:util';
import {artifactScopeLimits,artifactScopeBindingsSchema,type ArtifactScopeBinding} from '../workspace/artifact-scope';
import {OutputManifestTools} from '../tasks/output-manifest-tools';
import {outputManifestInputSchema,outputManifestStagedSchema,outputManifestSnapshotSchema,outputManifestToolName,type OutputManifestInput,type OutputManifestSnapshot,type OutputManifestStaged,type OutputManifestRecord} from '../tasks/output-manifest';
import {completeOutputRequired,selectCompleteOutput,assertCompleteOutputCurrent,type CompleteOutputBinding} from '../tasks/complete-output-evidence';
import {outputManifestHash,outputManifestScopeHash,verifyOutputManifests} from '../tasks/output-manifest-evidence';
import {artifactEventChangesFiles} from '../tasks/artifact-evidence';
import type {TaskProgress} from '../tasks/progress';
import type {MemberRunBinding} from './member-run';
import type {StoredEvent} from './types';

export interface OutputManifestCapturePort {
  knowledgeRevision:string;
  assertCurrentKnowledge():Promise<void>;
  /** 参数只来自可信冻结范围，结果必须完整；不能以返回子集作为成功。 */
  capture(scopes:readonly ArtifactScopeBinding[],signal:AbortSignal):Promise<OutputManifestSnapshot>;
}
export class RunOutputManifestCapture {
  readonly tools:OutputManifestTools;
  private readonly events:StoredEvent[]=[];
  private readonly controller=new AbortController();
  private reserved?:{id:string;input:OutputManifestInput;consumed:boolean};
  /** 完整交付的门闩持有到真实工具结束，不能在文件复核后、候选落盘前放入其它调用。 */
  private deliveryOwner?:string;
  private reading=false;
  private readonly bindings:readonly CompleteOutputBinding[];
  constructor(private readonly binding:MemberRunBinding,private readonly scopes:ArtifactScopeBinding[],private readonly port:OutputManifestCapturePort,private readonly context:{bindings:readonly CompleteOutputBinding[];current():TaskProgress|undefined;assertReady(id:string):void;assertReadingReady(name:'cbim_delivery_prepare'|'cbim_validation_run'):void;save(manifest:OutputManifestStaged):Promise<void>}){
    this.binding=structuredClone(binding);this.bindings=structuredClone(context.bindings);this.scopes=artifactScopeBindingsSchema.parse(scopes);this.tools=new OutputManifestTools(this.binding,port.knowledgeRevision,this.scopes,{capture:(input,id)=>this.capture(input,id),inspect:()=>this.inspect()});
  }
  /** 同步预占先于任何异步审批，阻止读取期间插入其它操作。 */
  guard(name:string,id:string,input:unknown,activeIds:readonly string[]):string|undefined{
    if(this.reserved||this.deliveryOwner||this.reading)return '正在完整采集或核实产物，请等待本次调用结束';
    if(name==='cbim_delivery_prepare'&&completeOutputRequired(this.bindings)){
      if(this.controller.signal.aborted)return '本轮已停止完整交付';
      if(activeIds.length)return '仍有工具或审批在途，不能完整交付';
      this.deliveryOwner=id;return;
    }
    if(name!==outputManifestToolName)return;
    if(this.controller.signal.aborted)return '本轮已停止完整产物采集';
    const parsed=outputManifestInputSchema.safeParse(input);if(!parsed.success)return '完整产物采集参数无效';
    if(activeIds.length)return '仍有工具或审批在途，不能采集完整产物';
    this.reserved={id,input:parsed.data,consumed:false};
  }
  /** 只保留证据所需事件，不缓存消息正文；坏回包不让原暂存变成成功记录。 */
  observed(event:StoredEvent){
    if(event.type==='run.started'||event.type.startsWith('tool.')||['task.updated','artifact.manifest_captured','run.stop_requested','run.interrupted'].includes(event.type))this.events.push(event);
    if((event.type==='tool.finished'||event.type==='tool.denied')&&event.data.id===this.reserved?.id)this.reserved=undefined;
    if((event.type==='tool.finished'||event.type==='tool.denied')&&event.data.id===this.deliveryOwner)this.deliveryOwner=undefined;
  }
  stop(){this.controller.abort(Error('本轮已停止完整产物采集'))}
  private inspect(){return verifyOutputManifests(this.events,this.binding,this.port.knowledgeRevision,this.scopes)}
  /** 只返回本轮完整有效记录；调用者不能以较新清单替换原明确选择。 */
  select(manifestId:string,progressVersion:number):OutputManifestRecord{return selectCompleteOutput(this.inspect(),this.bindings,manifestId,{...this.binding,knowledgeRevision:this.port.knowledgeRevision,progressVersion})}
  /** 原验证/交付的授权范围内重读全集合；停止、进度与知识变化均拒绝，交付门闩由真实结束释放。 */
  async verifyCurrent(record:OutputManifestRecord,name:'cbim_delivery_prepare'|'cbim_validation_run',signal:AbortSignal=new AbortController().signal):Promise<void>{
    if(this.reserved||this.reading||name==='cbim_validation_run'&&this.deliveryOwner||name==='cbim_delivery_prepare'&&!this.deliveryOwner)fail('MANIFEST_BUSY','完整产物复核尚未就绪或存在其它调用');
    const version=this.context.current()?.version,limited=AbortSignal.any([this.controller.signal,signal,AbortSignal.timeout(artifactScopeLimits.readMs)]);
    const check=()=>{limited.throwIfAborted();this.context.assertReadingReady(name);if(this.context.current()?.version!==version||version===undefined||!equal(this.select(record.manifest.manifestId,version),record))fail('MANIFEST_PROGRESS_CHANGED','完整复核期间进度或原清单发生变化')};
    this.reading=true;
    try{
      check();await this.port.assertCurrentKnowledge();check();const observed=await this.port.capture(structuredClone(this.scopes),limited);check();const observedHash=outputManifestHash(observed),expectedHash=record.manifest.manifestHash;
      assertCompleteOutputCurrent(record.manifest.snapshot,{state:observedHash===expectedHash?'matches':'changed',expectedHash,observedHash,observed});await this.port.assertCurrentKnowledge();check();
    }finally{this.reading=false}
  }
  private async capture(input:OutputManifestInput,id:string):Promise<OutputManifestStaged>{
    const reserved=this.reserved;if(!reserved||reserved.id!==id||reserved.consumed||!equal(reserved.input,input))fail('MANIFEST_CALL','完整采集必须来自已授权的一次性调用');reserved.consumed=true;
    const check=()=>{this.controller.signal.throwIfAborted();this.context.assertReady(id);if(this.context.current()?.version!==input.expectedTaskProgressVersion)fail('MANIFEST_PROGRESS_CHANGED','执行计划已变化，请重新读取后采集')};
    check();if(this.events.filter(event=>event.type==='artifact.manifest_captured').length>=artifactScopeLimits.captures)fail('MANIFEST_LIMIT','本轮最多保存8份完整清单，失败暂存也占用历史容量');
    const lastEffectSeq=this.events.reduce((seq,event)=>artifactEventChangesFiles(event)?event.seq:seq,0);
    await this.port.assertCurrentKnowledge();check();const snapshot=outputManifestSnapshotSchema.parse(await this.port.capture(structuredClone(this.scopes),this.controller.signal));check();
    if(!equal(snapshot.scopes,this.scopes))fail('MANIFEST_SCOPE_CHANGED','文件端口未完整返回原冻结范围');
    await this.port.assertCurrentKnowledge();check();if(lastEffectSeq!==this.events.reduce((seq,event)=>artifactEventChangesFiles(event)?event.seq:seq,0))fail('MANIFEST_EFFECT_CHANGED','采集期间出现新的副作用');
    const files=snapshot.entries.filter(entry=>entry.kind==='file'),manifest=outputManifestStagedSchema.parse({version:1,manifestId:randomUUID(),captureToolCallId:id,binding:this.binding,scopeHash:outputManifestScopeHash(this.scopes),manifestHash:outputManifestHash(snapshot),knowledgeRevision:this.port.knowledgeRevision,progressVersion:input.expectedTaskProgressVersion,capturedAt:new Date().toISOString(),lastEffectSeq,entryCount:snapshot.entries.length,fileCount:files.length,byteLength:files.reduce((sum,file)=>sum+file.byteLength,0),scopes:this.scopes,snapshot});
    await this.context.save(manifest);check();return manifest;
  }
}
