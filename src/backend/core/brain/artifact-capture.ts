/**
 * 作用定位：成员运行的短时文件采集门闩，绑定真实授权、进度、知识基线与 canonical 事件。
 * 设计原因：采集跨多个异步文件读取；必须先阻止其它工具/审批进入，并在保存前复核停止与版本，不能接受模型路径或哈希。
 * 职责边界：向工具包装冻结完整成员身份与知识版本；坏回包不自动重采，暂存须有成功回执才可引用，短门闩仅由真实工具结束释放。
 */
import {randomUUID} from 'node:crypto';
import {fail} from '../foundation/errors';
import {ArtifactTools,artifactCaptureToolName} from '../tasks/artifact-tools';
import {artifactCaptureInputSchema,artifactBaselineStagedSchema,artifactFileFactSchema,artifactLimits,type ArtifactCaptureInput,type ArtifactFileFact,type ArtifactCapturedFile,type ArtifactBaselineStaged,type ArtifactBaselineRef} from '../tasks/artifact-baseline';
import {artifactSources,verifyArtifactBaselines} from '../tasks/artifact-evidence';
import type {TaskProgress} from '../tasks/progress';
import type {MemberRunBinding} from './member-run';
import type {StoredEvent} from './types';

/** 仅可信成员装配提供；知识复核是实时端口，不能拿冻结字符串冒充当前版本一致。 */
export interface ArtifactCapturePort {
  knowledgeRevision:string;
  /** 与文件端口相同的纯路径归一化；只匹配来源引用，不执行文件读取。 */
  normalizePath(raw:string):string;
  assertCurrentKnowledge():Promise<void>;
  captureFiles(paths:readonly string[],signal:AbortSignal):Promise<ArtifactFileFact[]>;
}
/** 每个运行独立拥有；门闩直到本工具结束或拒绝才释放，bridge丢失结束事件时保留阻断直到收尾。 */
export class RunArtifactCapture {
  readonly tools:ArtifactTools;
  private events:StoredEvent[]=[];
  private reserved?:{id:string;input:ArtifactCaptureInput;consumed:boolean};
  private controller=new AbortController();
  constructor(private readonly binding:MemberRunBinding,private readonly port:ArtifactCapturePort,private readonly context:{
    current():TaskProgress|undefined;
    assertReady(toolCallId:string):void;
    save(baseline:ArtifactBaselineStaged):Promise<void>;
  }){this.binding=Object.freeze(structuredClone(binding));this.tools=new ArtifactTools(this.binding,{knowledgeRevision:port.knowledgeRevision,capture:(input,id)=>this.capture(input,id)})}
  /** beforeTool 的同步入口；在其它操作进入异步审批之前预占，不能等待写入结束后偷偷补采。 */
  guard(name:string,id:string,input:unknown,activeIds:readonly string[]):string|undefined{
    if(this.reserved)return '正在采集文件基线，请等待本次采集结束后再调用工具';
    if(name!==artifactCaptureToolName)return;
    if(this.controller.signal.aborted)return '运行已停止，不能采集文件基线';
    const parsed=artifactCaptureInputSchema.safeParse(input);if(!parsed.success)return '文件基线参数不符合结构约定';
    if(activeIds.length)return '仍有工具或审批未结束，不能采集文件基线';
    this.reserved={id,input:parsed.data,consumed:false};
  }
  /** 只有已持久化的事件进入采集事实；不保留消息或推理正文的第二份副本。 */
  observed(event:StoredEvent){
    if(event.type==='run.started'||event.type.startsWith('tool.')||event.type==='task.updated'||event.type==='artifact.baseline_captured'||event.type==='run.stop_requested')this.events.push(event);
    if((event.type==='tool.finished'||event.type==='tool.denied')&&event.data.id===this.reserved?.id)this.reserved=undefined;
  }
  stop(){this.controller.abort(Error('运行已停止，文件采集取消'))}
  /** 进度查询只返回已确认基线引用；旧进度、新副作用和后续修订不会改写历史字节记录。 */
  refs():ArtifactBaselineRef[]{return verifyArtifactBaselines(this.events,this.binding,this.port.knowledgeRevision,this.port.normalizePath).refs}
  private async capture(input:ArtifactCaptureInput,id:string):Promise<ArtifactBaselineStaged>{
    const reserved=this.reserved;
    if(!reserved||reserved.id!==id||reserved.consumed||JSON.stringify(reserved.input)!==JSON.stringify(input))fail('ARTIFACT_CALL','文件采集必须来自已授权的一次性调用');
    reserved.consumed=true;
    const check=()=>{this.controller.signal.throwIfAborted();this.context.assertReady(id);if(this.context.current()?.version!==input.expectedTaskProgressVersion)fail('ARTIFACT_PROGRESS_CHANGED','任务进度已变化，请重新读取后采集')};
    check();if(this.refs().length>=artifactLimits.baselines)fail('ARTIFACT_LIMIT','本轮最多保存 8 份成功文件基线');
    const facts=artifactSources(this.events,this.binding,input.sourceToolCallIds),lastEffectSeq=facts.lastEffectSeq;
    await this.port.assertCurrentKnowledge();check();
    const returned=await this.port.captureFiles(facts.sources.map(source=>source.path),this.controller.signal);check();
    if(returned.length!==facts.sources.length)fail('ARTIFACT_FILES_INVALID','文件端口未返回完整对应结果');
    const files=new Map<string,ArtifactCapturedFile>();
    returned.forEach((raw,index)=>{
      const fact=artifactFileFactSchema.parse(raw),sourceId=facts.sources[index].toolCallId,old=files.get(fact.relativePath);
      if(this.port.normalizePath(fact.relativePath)!==this.port.normalizePath(facts.sources[index].path))fail('ARTIFACT_FILES_INVALID','文件端口返回了不属于原调用的路径');
      if(old){if(old.byteLength!==fact.byteLength||old.sha256!==fact.sha256)fail('ARTIFACT_CHANGED','重复文件在读取期间发生变化');old.sourceToolCallIds.push(sourceId)}
      else files.set(fact.relativePath,{...fact,sourceToolCallIds:[sourceId]});
    });
    await this.port.assertCurrentKnowledge();check();
    if(artifactSources(this.events,this.binding,input.sourceToolCallIds).lastEffectSeq!==lastEffectSeq)fail('ARTIFACT_EFFECT_CHANGED','采集期间出现了新的副作用');
    const baseline=artifactBaselineStagedSchema.parse({version:1,baselineId:randomUUID(),captureToolCallId:id,binding:this.binding,knowledgeRevision:this.port.knowledgeRevision,progressVersion:input.expectedTaskProgressVersion,capturedAt:new Date().toISOString(),lastEffectSeq,sourceCalls:facts.sources.map(({path:_path,...source})=>source),files:[...files.values()]});
    await this.context.save(baseline);check();return baseline;
  }
}
