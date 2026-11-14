/**
 * 目录归属：logic/execution/rules/execution/capabilities；成员运行能力与短期门闩。
 * 范围模式只读核实仍可通过cbim_scoped_read；未知删除/移动继续阻止命令、写入和交付。
 * 作用定位：正式成员删除/移动工具的唯一授权、写前核实和可靠阶段记录，平台副作用只通过此运行端口。
 * 设计原因：模型只选冻结要求和原清单；先保存 prepared/executing 再操作，未知结果保持本轮读/求助屏障。
 * 职责边界：不自动回滚或重发，保存成功仍须真实工具结束后才能形成证明；停止排空实际文件工人。
 * 机制边界：utility 仅跟踪在途 Promise；停止接单、取消、物理退出核实与占用释放仍由本模块决定。
 */
import {InFlightOperations} from '../../../../core/utility';
import {isDeepStrictEqual as equal} from 'node:util';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {hash} from '../../../../core/platform/node/serialization';
import {fail} from '../../../../core/errors';
import {checkedJsonToolResult} from '../../../tools/rules/results';
import {artifactScopeLimits,preparedArtifactTransitions,type ArtifactScopeBinding,type ArtifactTransitionDefinition} from '../../../workspace/rules/artifact-scope';
import {artifactTransitionToolName,artifactTransitionInputSchema,artifactTransitionPreparedSchema,artifactTransitionOutputSchema,type ArtifactTransitionInput,type ArtifactTransitionPrepared,type ArtifactTransitionApplied,type ArtifactTransitionToolPort} from '../../../file-operations/rules/artifact-transition';
import {artifactTransitionOperationId,artifactTransitionAppliedValue,expectedArtifactTransitionSnapshot} from '../../../file-operations/rules/artifact-transition-evidence';
import {verifyOutputManifests,outputManifestHash,outputManifestScopeHash} from '../../../evidence/rules/output-manifest-evidence';
import type {OutputManifestRecord} from '../../../evidence/rules/output-manifest';
import type {OutputManifestCapturePort} from './output-manifest-capture';
import type {MemberRunBinding} from '../member-run';
import type {EngineEvent,StoredEvent} from '../types';

/** 平台句柄留在 Main；readBefore 来自真实独占文件，apply 只能执行打开时固定的原操作一次。 */
export interface ArtifactTransitionFile {
  readBefore():Promise<{identity:ArtifactTransitionPrepared['fileIdentity'];fact:ArtifactTransitionPrepared['before']}>;
  apply():Promise<{identity:ArtifactTransitionPrepared['fileIdentity'];fact:ArtifactTransitionPrepared['before'];operation:ArtifactTransitionDefinition;sourceMissing:true}>;
}
/** withExclusive 返回或抛错前应确认工人退出；无法退出时 drain 必须继续失败并保留运行占用。 */
export interface ArtifactTransitionRunPort {
  withExclusive<T>(operation:ArtifactTransitionDefinition,signal:AbortSignal,use:(file:ArtifactTransitionFile)=>Promise<T>):Promise<T>;
  drain():Promise<void>;
}
export class RunArtifactTransition implements ArtifactTransitionToolPort {
  private readonly events:StoredEvent[]=[];
  private readonly controller=new AbortController();
  private readonly pending=new InFlightOperations();
  /** 与在途门闩独立；失败工具已返回也不能换调用 ID 继续写入或交付。 */
  private readonly unverified=new Set<string>();
  private reserved?:{id:string;input:ArtifactTransitionInput;inputHash:string;before:OutputManifestRecord;operation:ArtifactTransitionDefinition;allowedSeq?:number;result?:ArtifactTransitionApplied;consumed:boolean;settled:boolean;validated:boolean;finished:boolean;badFinish:boolean};
  constructor(private readonly binding:MemberRunBinding,private readonly scopes:readonly ArtifactScopeBinding[],private readonly manifests:OutputManifestCapturePort,private readonly port:ArtifactTransitionRunPort,private readonly context:{version():number|undefined;assertReady(id:string):void;save(event:EngineEvent):Promise<StoredEvent>}){this.binding=structuredClone(binding);this.scopes=structuredClone(scopes)}
  /** 同步预占先于任何审批与进度失效；此时保留原有效写前清单，不从已发生副作用之后倒推 before。 */
  guard(name:string,id:string,raw:unknown,active:readonly string[]):string|undefined{
    if(this.reserved)return '原删除/移动尚未结束，请等待实际操作和回执';
    if(this.unverified.size&&!['read','grep','find','ls','cbim_scoped_read','cbim_task_inspect','cbim_task_help'].includes(name))return 'ARTIFACT_TRANSITION_REVIEW_REQUIRED: 原删除/移动待核实，本轮仅可读取或求助，不能重试、交付或停泊';
    if(name!==artifactTransitionToolName)return;
    if(this.controller.signal.aborted)return '运行已停止删除/移动';
    const parsed=artifactTransitionInputSchema.safeParse(raw);if(!parsed.success)return '删除/移动参数不符合冻结操作选择协议';
    const input=parsed.data,requirement=preparedArtifactTransitions(this.scopes).find(item=>item.moduleId===input.moduleId&&item.operationIndex===input.operationIndex);
    if(!requirement||active.length||this.context.version()!==input.expectedTaskProgressVersion)return '冻结操作、执行计划或唯一调用状态已变化';
    const prepared=this.events.filter(e=>e.type==='artifact.transition_prepared');
    if(prepared.length>=artifactScopeLimits.transitions||prepared.some(e=>{const p=e.data.prepared as ArtifactTransitionPrepared;return p?.moduleId===input.moduleId&&p?.operationIndex===input.operationIndex}))return '本轮原操作已登记，不能再次发出同一删除/移动';
    const evidence=verifyOutputManifests(this.events,this.binding,this.manifests.knowledgeRevision,this.scopes),before=evidence.records.find(item=>item.manifest.manifestId===input.beforeManifestId),ref=evidence.refs.find(item=>item.manifestId===input.beforeManifestId);
    if(!before||!ref||ref.invalidated||before.manifest.progressVersion>input.expectedTaskProgressVersion)return '请明确选择本轮未失效的真实写前完整清单';
    try{expectedArtifactTransitionSnapshot(before.manifest.snapshot,requirement.operation)}catch{return '写前清单没有所需源文件、目标已存在或范围不完整'}
    this.reserved={id,input:structuredClone(input),inputHash:hash(JSON.stringify(raw)),before:structuredClone(before),operation:requirement.operation,consumed:false,settled:false,validated:false,finished:false,badFinish:false};
  }
  /** 仅 Runtime 的可靠 allowed append 返回值可签发，观察到同名引擎事件不产生许可。 */
  authorize(id:string,seq:number){if(this.reserved?.id===id&&!this.controller.signal.aborted)this.reserved.allowedSeq=seq}
  observed(event:StoredEvent){
    if(event.type==='run.started'||event.type.startsWith('tool.')||event.type.startsWith('artifact.')||['task.updated','run.stop_requested','run.interrupted'].includes(event.type))this.events.push(event);
    const current=this.reserved;if(!current||event.data.id!==current.id)return;
    if(event.type==='tool.denied'&&!current.consumed){this.reserved=undefined;return}
    if(event.type==='tool.finished'){
      current.finished=true;current.badFinish ||= event.data.isError===true||!current.settled||!current.validated;
      // 平台已操作不代表引擎回包可信；缺失、改写或提前结束必须保留整轮屏障。
      try{const content=(event.data.result as {content?:Array<{type?:unknown;text?:unknown}>})?.content;if(content?.length!==1||content[0].type!=='text'||typeof content[0].text!=='string'||!equal(artifactTransitionOutputSchema.parse(JSON.parse(content[0].text)).operation,current.result))current.badFinish=true}catch{current.badFinish=true}
      this.release();
    }
  }
  private release(){const current=this.reserved;if(!current?.settled||!current.finished)return;if(current.validated&&!current.badFinish)this.unverified.delete(current.id);else this.unverified.add(current.id);this.reserved=undefined}
  get unverifiedCallIds(){return [...this.unverified]}
  /** 供实际交付与终态复核，不能以成功模型回合解除未知副作用。 */
  assertVerified(){if(this.unverified.size)fail('ARTIFACT_TRANSITION_REVIEW_REQUIRED','原删除/移动结果待核实，不能交付或安全交接')}
  stop(){this.controller.abort(Error('运行已停止删除/移动'))}
  async drain(){await this.pending.drain();await this.port.drain()}
  async list(){return [{name:artifactTransitionToolName,version:1,effects:['business-write'] as const,description:'按冻结 artifactScope.transitions 的模块和序号执行一个真实文件删除或不覆盖移动。必须显式引用本轮有效写前完整清单；只支持本机 NTFS 普通 UTF-8 文件，先可靠保存阶段再操作，完成后须重新采集完整清单。失败/未知不能换调用重试，不提供自动恢复。',inputSchema:zodToJsonSchema(artifactTransitionInputSchema),outputSchema:zodToJsonSchema(artifactTransitionOutputSchema),cancellation:{mode:'preflight_only' as const,description:'停止可阻止发出操作；已经发出的结果须按原阶段核实。'},recovery:{mode:'inspect_before_retry' as const,description:'只查询原操作事实；工具不自动重发或恢复，原成功链才可用于完整验收。'}}]}
  async call(name:string,raw:unknown,id?:string,signal?:AbortSignal){
    const input=artifactTransitionInputSchema.parse(raw),current=this.reserved;
    if(name!==artifactTransitionToolName||!id||!current||current.id!==id||current.consumed||!current.allowedSeq||!equal(current.input,input)||current.inputHash!==hash(JSON.stringify(raw)))fail('ARTIFACT_TRANSITION_AUTHORIZATION','删除/移动缺少本轮原参数的一次性可靠授权');
    current.consumed=true;this.unverified.add(id);const active=AbortSignal.any([this.controller.signal,...(signal?[signal]:[]),AbortSignal.timeout(60000)]),version=this.context.version();
    const check=()=>{active.throwIfAborted();this.context.assertReady(id);if(this.context.version()!==version)fail('ARTIFACT_TRANSITION_CHANGED','删除/移动期间计划发生变化')};
    const work=(async():Promise<ArtifactTransitionApplied>=>{
      check();await this.manifests.assertCurrentKnowledge();check();const before=await this.manifests.capture(this.scopes,active);check();if(!equal(before,current.before.manifest.snapshot))fail('ARTIFACT_TRANSITION_BEFORE_CHANGED','原写前完整集合已变化，请重新核实');
      let prepared!:ArtifactTransitionPrepared,preparedSeq=0,executingSeq=0;
      await this.port.withExclusive(current.operation,active,async file=>{
        check();const actual=await file.readBefore();check();const source=current.operation.kind==='delete'?current.operation.path:current.operation.from,entry=before.entries.find(item=>item.relativePath===source);
        if(entry?.kind!=='file'||entry.byteLength!==actual.fact.byteLength||entry.sha256!==actual.fact.sha256)fail('ARTIFACT_TRANSITION_BEFORE_CHANGED','原文件句柄字节与写前完整清单不一致');
        prepared=artifactTransitionPreparedSchema.parse({version:1,operationId:artifactTransitionOperationId(this.binding,id),toolCallId:id,binding:this.binding,moduleId:input.moduleId,operationIndex:input.operationIndex,operation:current.operation,knowledgeRevision:this.manifests.knowledgeRevision,scopeHash:outputManifestScopeHash(this.scopes),beforeManifestId:input.beforeManifestId,beforeManifestHash:current.before.manifest.manifestHash,before:actual.fact,inputHash:current.inputHash,progressVersion:input.expectedTaskProgressVersion,allowedSeq:current.allowedSeq,fileIdentity:actual.identity,preparedAt:new Date().toISOString()});
        preparedSeq=(await this.context.save({type:'artifact.transition_prepared',data:{prepared}})).seq;check();await this.manifests.assertCurrentKnowledge();check();
        executingSeq=(await this.context.save({type:'artifact.transition_executing',data:{operationId:prepared.operationId,preparedSeq}})).seq;check();const result=await file.apply();
        if(!equal(result.identity,actual.identity)||!equal(result.fact,actual.fact)||!equal(result.operation,current.operation)||result.sourceMissing!==true)fail('ARTIFACT_TRANSITION_RESULT_INVALID','原删除/移动的平台结果无法核实');
      });
      check();const afterSnapshot=await this.manifests.capture(this.scopes,active);check();if(!equal(afterSnapshot,expectedArtifactTransitionSnapshot(before,current.operation)))fail('ARTIFACT_TRANSITION_AFTER_CHANGED','操作后的完整集合或移动两端不符合原操作，保留阶段等待核实');
      await this.manifests.assertCurrentKnowledge();check();const after={afterManifestHash:outputManifestHash(afterSnapshot),appliedAt:new Date().toISOString()},appliedSeq=(await this.context.save({type:'artifact.transition_applied',data:{operationId:prepared.operationId,executingSeq,afterSnapshot,...after}})).seq;check();
      return artifactTransitionAppliedValue(prepared,{preparedSeq,executingSeq,appliedSeq},after);
    })();this.pending.track(work);
    try{const operation=await work,result=checkedJsonToolResult(name,{state:'applied',operation},artifactTransitionOutputSchema);current.result=structuredClone(operation);current.validated=true;return result}
    finally{current.settled=true;this.release()}
  }
}
