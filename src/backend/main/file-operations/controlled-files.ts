/**
 * 目录归属：backend/main/file-operations；受控操作与原资源核实服务。
 * 自动兜底运行使用自身冻结身份计算受控写指纹，仍经原授权、文件事务与审计端口。
 * 作用定位：已打开工作区的受控写入与桌面补偿服务，连接运行许可、私有备份、独占子进程和唯一 DispatchStore。
 * 设计原因：文件 IO 永不进入 Store 回调；prepared/executing 的可靠保存先于写入，保存未知不重做。运行解除待核实屏障只接受原 not_applied 与进程退出，不凭错误码或查无推断。
 * 受控文件平台的禁止边界包含独立 R/E 缓存，避免业务文件工具修改下一次将执行的签名程序。
 * 机制边界：utility 仅跟踪在途 Promise；停止接单、取消、物理退出核实与占用释放仍由本模块决定。
 */
import {InFlightOperations} from '../../../core/utility';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {fail} from '../../core/foundation/errors';
import {hash} from '../../core/foundation/serialization';
import type {Workspace} from '../workspace/workspace';
import type {DispatchStore,DispatchState} from '../../core/dispatch/dispatch-storage';
import type {DispatchRun} from '../../core/tasks/dispatch-execution';
import type {RunSummary} from '../../core/execution/types';
import type {ControlledFileRunPort} from '../../core/execution/capabilities/run-controlled-file';
import {controlledFileWriteToolName,controlledFileLimits,controlledFileWriteInputSchema,controlledFileReportInputSchema,controlledFileReportSchema,fileCompensationPreviewInputSchema,fileCompensationPreviewSchema,fileCompensationInputSchema,fileCompensationLookupSchema,fileCompensationReceiptSchema,type ControlledFileWriteInput,type ControlledFileContentFact,type FileCompensationPreview,type FileCompensationInput} from '../../core/file-operations/controlled-file-operation';
import {controlledFileOriginSchema,type ControlledFileOrigin,type ControlledFileChange,type ControlledFileIntent,type ControlledFileOperation,type ControlledWritePrepared,type FileCompensationPrepared} from '../../core/file-operations/controlled-file-event';
import {controlledFileOperationId,controlledFileOwnerBindingHash,controlledFileRequestFingerprint,controlledFileIntentHash,controlledFileChangeHash,controlledFilePhaseCommand,controlledFilePhaseReceipt,controlledFileOperation,fileCompensationId,fileCompensationRequestFingerprint,fileCompensationRevision,fileCompensationBasis,summarizeControlledFileOperation,controlledFileWriteApplied,summarizeFileCompensation,fileCompensationReceipt} from '../../core/file-operations/controlled-file-rules';
import {projectControlledFileMutation} from '../../core/file-operations/controlled-file-invariants';
import {ControlledFileBlobs} from '../platform/files/controlled-file-blobs';
import type {ControlledFileTransport,ExclusiveControlledFile} from '../platform/files/controlled-file-protocol';
import type {WorkspaceExecutionLease} from '../../scheduler-engine/admission/workspace-lease';

const now=()=>new Date().toISOString();
const fact=(bytes:Uint8Array):ControlledFileContentFact=>({byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const content=(v:ControlledFileContentFact):ControlledFileContentFact=>({byteLength:v.byteLength,sha256:v.sha256});
const code=(e:unknown)=>{const value=(e as {code?:unknown})?.code;return typeof value==='string'&&/^[A-Z0-9_]{1,80}$/.test(value)?value:'CONTROLLED_IO_FAILED'};
const publicValue=<T>(value:T):T=>{if(Buffer.byteLength(JSON.stringify(value),'utf8')>controlledFileLimits.outputBytes)fail('CONTROLLED_OUTPUT_LIMIT','回包超过有界上限');return value};
/** 仅 Main 实际装配实例；没有 utility 传输时查询历史仍可用，新写和补偿明确拒绝。 */
export class ControlledFiles {
  private blobs:ControlledFileBlobs;private closed=false;private operations=new InFlightOperations();private controllers=new Set<AbortController>();
  private heldReleases=new Set<()=>void>();
  constructor(private readonly owner:Workspace,private readonly store:DispatchStore,private readonly lease:WorkspaceExecutionLease,private readonly transport:ControlledFileTransport|undefined,private readonly inspect:(run:DispatchRun)=>Promise<RunSummary>,private readonly isCurrent:()=>boolean){this.blobs=new ControlledFileBlobs(path.join(owner.paths.project(owner.entry.id),'controlled-files','blobs'))}
  private assert(identity?:{workspaceId:string;instanceId:string}){this.owner.assert(identity);if(this.closed||!this.isCurrent())fail('CONTROLLED_UNAVAILABLE','工作区正在关闭，不能开始文件操作')}
  private platform(){if(!this.transport)fail('CONTROLLED_PLATFORM_UNSUPPORTED','当前宿主没有受控文件 utility 传输');return this.transport}
  private protectedRoots(){return [this.owner.paths.userRoot,this.owner.paths.installRoot,...(this.owner.paths.protectedRoots??[])]}
  private tracked<T>(signal:AbortSignal|undefined,use:(signal:AbortSignal)=>Promise<T>):Promise<T>{const controller=new AbortController();this.controllers.add(controller);const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;const result=use(combined);this.operations.track(result);void result.finally(()=>{this.controllers.delete(controller)}).catch(()=>{});return result}
  /** 工厂冻结真实已领取上下文；以后岗位变化不替换原运行配置，写前仍核原 run/lease 和停止。 */
  forRun(run:DispatchRun,scopeId:string):ControlledFileRunPort|undefined{
    if(!this.transport)return;const saved=structuredClone(run);if(!saved.prepared.memberContext&&!saved.prepared.fallbackBinding)return;
    return {scopeId,write:(input,authorization,signal,assertCurrent)=>this.write(saved,scopeId,input,authorization,signal,assertCurrent),confirmNotApplied:async authorization=>{
      await this.platform().drain(this.owner.entry.path);
      const head=controlledFileOperation(await this.store.read(),controlledFileOperationId(saved.binding,authorization.toolCallId));
      if(head?.phase!=='not_applied'||head.intent.kind!=='member_write')return false;
      const origin=head.intent.origin;
      return equal(origin.binding,saved.binding)&&origin.scopeId===scopeId&&origin.workspaceInstanceId===this.owner.instanceId&&origin.toolCallId===authorization.toolCallId&&origin.inputHash===authorization.inputHash&&origin.allowedSeq===authorization.allowedSeq;
    },drain:()=>this.platform().drain(this.owner.entry.path)};
  }
  /** Runtime 的一次性授权是唯一入口；重复 operation 先查询原记录，不再读取或改写业务文件。 */
  write(run:DispatchRun,scopeId:string,input:ControlledFileWriteInput,authorization:{toolCallId:string;inputHash:string;allowedSeq:number},signal:AbortSignal,assertCurrent:()=>void){
    const frozen=controlledFileWriteInputSchema.parse(structuredClone(input)),origin=controlledFileOriginSchema.parse({kind:'member_tool',workspaceInstanceId:this.owner.instanceId,scopeId,binding:run.binding,ownerBindingHash:controlledFileOwnerBindingHash((run.prepared.memberContext?.binding??run.prepared.fallbackBinding)!),knowledgeRevision:run.prepared.knowledgeRevision,toolName:controlledFileWriteToolName,...authorization,permission:run.permission});
    return this.tracked(signal,async active=>{
      const operationId=controlledFileOperationId(origin.binding,origin.toolCallId),request={relativePath:frozen.path,expectedBefore:frozen.expectedBefore,after:fact(Buffer.from(frozen.content,'utf8'))},fingerprint=controlledFileRequestFingerprint(origin,request),prior=controlledFileOperation(await this.store.read(),operationId);
      if(prior){if(prior.intent.kind!=='member_write'||prior.intent.requestFingerprint!==fingerprint)fail('CONTROLLED_COMMAND_CONFLICT','原调用已经绑定不同请求');return controlledFileWriteApplied(prior)}
      const alive=()=>{active.throwIfAborted();this.assert();assertCurrent()};alive();
      return this.platform().withExclusiveExisting(this.owner.entry.path,frozen.path,this.protectedRoots(),active,async file=>{
        const before=await file.readBefore();alive();if(!equal(before.fact,request.expectedBefore))fail('CONTROLLED_BEFORE_CHANGED','当前文件已经偏离 expectedBefore，未写入');
        const pair=await this.blobs.savePair(operationId,before.bytes,Buffer.from(frozen.content,'utf8'));alive();
        const at=now(),intent:ControlledWritePrepared={version:1,kind:'member_write',operationId,origin,request,requestFingerprint:fingerprint,fileIdentity:before.identity,...pair,preparedAt:at};
        await this.phase({version:1,operationId,phase:'prepared',revision:1,previousRevision:0,intent,recordedAt:at},alive);
        const head=await this.execute(intent,file,Buffer.from(frozen.content,'utf8'),alive);return controlledFileWriteApplied(head);
      });
    });
  }
  private async phase(change:ControlledFileChange,assertCurrent?:()=>void){const command=controlledFilePhaseCommand(change);await this.store.transact(command,async state=>{assertCurrent?.();const mutation={controlledFileChanges:[change],receipt:controlledFilePhaseReceipt(change)};projectControlledFileMutation(state,mutation,command);return mutation})}
  /** prepared 保存未知不进入此处；executing 保存失败也不发送写。已发送后的任何错误只追加 unknown，不回滚。 */
  private async execute(intent:ControlledFileIntent,file:ExclusiveControlledFile,bytes:Uint8Array,alive:()=>void):Promise<ControlledFileOperation>{
    const operationId=intent.operationId,intentHash=controlledFileIntentHash(intent);let executing=false;
    try{alive();const checked=await file.recheckIdentity();alive();if(!equal(checked.identity,intent.fileIdentity)||!equal(checked.fact,content(intent.before)))fail('CONTROLLED_BEFORE_CHANGED','写入前文件身份或字节发生变化')}
    catch(error){await this.phase({version:1,operationId,phase:'not_applied',revision:2,previousRevision:1,intentHash,reasonCode:code(error),confirmation:'write_not_issued',recordedAt:now()});throw error}
    await this.phase({version:1,operationId,phase:'executing',revision:2,previousRevision:1,intentHash,recordedAt:now()},alive);executing=true;
    let observed:Awaited<ReturnType<ExclusiveControlledFile['replaceAndFlush']>>;
    try{alive();observed=await file.replaceAndFlush(bytes)}catch(error){await this.phase(file.writeIssued?{version:1,operationId,phase:'unknown',revision:3,previousRevision:2,intentHash,reasonCode:code(error),recordedAt:now()}:{version:1,operationId,phase:'not_applied',revision:3,previousRevision:2,intentHash,reasonCode:code(error),confirmation:'write_not_issued',recordedAt:now()});throw error}
    // 平台已返回可靠 flush/readback；终态持久失败不落 unknown 第二命令，更不能反向恢复文件。
    if(executing)await this.phase({version:1,operationId,phase:'applied',revision:3,previousRevision:2,intentHash,observedAfter:observed.fact,fileIdentity:observed.identity,recordedAt:now()});
    return controlledFileOperation(await this.store.read(),operationId)!;
  }
  private original(state:DispatchState,id:string,identity:{workspaceId:string;rootSessionId:string}){const value=controlledFileOperation(state,id);if(!value||value.intent.kind!=='member_write'||value.intent.origin.binding.workspaceId!==identity.workspaceId||value.intent.origin.binding.rootSessionId!==identity.rootSessionId)fail('CONTROLLED_FILE_NOT_FOUND','没有当前会话的原受控写入');return value as ControlledFileOperation&{intent:ControlledWritePrepared}}
  private settled(state:DispatchState,original:ControlledFileOperation&{intent:ControlledWritePrepared}){const b=original.intent.origin.binding,run=state.runs?.find(r=>r.binding.runId===b.runId),scope=state.scopes?.find(s=>s.scopeId===original.intent.origin.scopeId);return !!run&&equal(run.binding,b)&&scope?.status==='closed'&&!['starting','running'].includes(run.status)&&!state.members.some(m=>m.activeRunId===b.runId)}
  private available(state:DispatchState,original:ControlledFileOperation&{intent:ControlledWritePrepared}){return original.phase==='applied'&&this.settled(state,original)&&(state.controlledFileChanges??[]).filter(c=>c.phase==='prepared'&&c.intent.kind==='desktop_compensation'&&c.intent.original.operationId===original.intent.operationId).every(c=>controlledFileOperation(state,c.operationId)?.phase==='not_applied')&&fileCompensationRevision(state,original.intent.operationId)<controlledFileLimits.compensations}
  /** 原 canonical 授权和持久化附录分别核对；没有记录不能据此声称原工具没有副作用。 */
  async report(raw:unknown){const input=controlledFileReportInputSchema.parse(raw);this.owner.assert();if(input.workspaceId!==this.owner.entry.id)fail('CONTROLLED_FILE_IDENTITY','工作区身份不一致');const state=await this.store.read(),run=state.runs?.find(r=>r.binding.runId===input.runId&&r.binding.taskId===input.taskId&&r.binding.rootSessionId===input.rootSessionId&&r.binding.workspaceId===input.workspaceId);let verified=false,origin:ControlledFileOrigin|undefined;
    const head=run?controlledFileOperation(state,controlledFileOperationId(run.binding,input.toolCallId)):undefined;
    try{if(run){const log=await this.inspect(run),allowed=log.events.filter(e=>e.type==='tool.allowed'&&e.data.id===input.toolCallId),proposed=log.events.filter(e=>e.type==='tool.proposed'&&e.data.id===input.toolCallId);const a=allowed[0];verified=log.logIntegrity?.partialTail===false&&log.runId===input.runId&&log.task.workspaceId===input.workspaceId&&log.task.taskId===input.taskId&&log.task.root===this.owner.entry.path&&equal(log.memberBinding,run.binding)&&equal(log.task.ownerBinding,run.prepared.memberContext?.binding)&&log.events[0]?.type==='run.started'&&log.events.filter(e=>e.type==='run.started').length===1&&log.events.every((e,index)=>e.seq===index+1&&e.runId===input.runId&&e.workspaceId===input.workspaceId&&e.taskId===input.taskId)&&allowed.length===1&&proposed.length===1&&proposed[0].seq<a.seq&&equal(proposed[0].data.input,a.data.input)&&a.data.name===controlledFileWriteToolName&&Array.isArray(a.data.effects)&&equal(a.data.effects,['business-write'])&&(a.data.scope as {kind?:string;workspaceId?:string})?.kind==='workspace'&&(a.data.scope as {workspaceId?:string}).workspaceId===input.workspaceId&&controlledFileWriteInputSchema.safeParse(a.data.input).success;if(head?.intent.kind==='member_write'){origin=head.intent.origin;verified=verified&&equal(origin.binding,run.binding)&&origin.allowedSeq===a?.seq&&origin.inputHash===hash(JSON.stringify(a?.data.input))}const again=await this.inspect(run);if(!equal(log.events,again.events)||again.logIntegrity?.partialTail!==false)verified=false}}catch{verified=false}
    const latest=await this.store.read();if(!equal(head,run?controlledFileOperation(latest,controlledFileOperationId(run.binding,input.toolCallId)):undefined))verified=false;
    const ledger=verified&&head?.intent.kind==='member_write'?{state:'recorded' as const,operation:summarizeControlledFileOperation(head),originalExecution:!latest.runs?.some(r=>r.binding.runId===input.runId)?'unavailable' as const:latest.runs.some(r=>r.binding.runId===input.runId&&['starting','running'].includes(r.status))?'in_flight' as const:'settled' as const,compensationRevision:fileCompensationRevision(latest,head.intent.operationId),compensations:(latest.controlledFileChanges??[]).filter(c=>c.phase==='prepared'&&c.intent.kind==='desktop_compensation'&&c.intent.original.operationId===head.intent.operationId).map(c=>summarizeFileCompensation(controlledFileOperation(latest,c.operationId)!))}:{state:verified?'absent' as const:'unverifiable' as const,issues:[{code:verified?'CONTROLLED_RECORD_ABSENT':'CONTROLLED_SOURCE_UNVERIFIABLE',message:verified?'没有已保存受控记录；这不证明原调用没有执行':'原调用或读取一致性无法核实'}]};
    return publicValue(controlledFileReportSchema.parse({version:1,identity:input,checkedAt:now(),ledger,readOnly:true,acceptance:'not_evaluated'}));
  }
  /** 显式只读预览取得短租约与原文件句柄，核实备份及原 after；释放句柄后依据可能过期，不能代替实际提交再核。 */
  preview(raw:unknown):Promise<FileCompensationPreview>{return this.tracked(undefined,signal=>this.previewInternal(raw,signal))}
  private async previewInternal(raw:unknown,signal:AbortSignal):Promise<FileCompensationPreview>{
    const input=fileCompensationPreviewInputSchema.parse(raw);this.assert(input);const state=await this.store.read(),original=this.original(state,input.operationId,input),compensationRevision=fileCompensationRevision(state,input.operationId),source=summarizeControlledFileOperation(original),restore=content(original.intent.before),issues:{code:string;message:string}[]=[];let observed:FileCompensationPreview['observed']={state:'unverifiable'},basis:string|undefined;
    const release=this.lease.acquire('file-preview:'+randomUUID(),'read');this.heldReleases.add(release);try{
      if(!this.available(state,original))fail('FILE_COMPENSATION_SOURCE','原操作不符合补偿条件');await this.blobs.read(original.intent.before);await this.blobs.read(original.intent.intendedAfter);
      await this.platform().withExclusiveExisting(this.owner.entry.path,source.relativePath,this.protectedRoots(),signal,async file=>{const current=await file.readBefore();observed={state:equal(current.identity,original.intent.fileIdentity)&&equal(current.fact,source.intendedAfter)?'matches':'changed',fact:current.fact};this.assert(input);signal.throwIfAborted();const latest=await this.store.read();if(!equal(original,this.original(latest,input.operationId,input))||fileCompensationRevision(latest,input.operationId)!==compensationRevision||!this.available(latest,original))fail('FILE_COMPENSATION_CHANGED','预览期间原事实变化');if(observed.state==='matches')basis=fileCompensationBasis({original,compensationRevision,fileIdentity:current.identity,observedBefore:current.fact})});
    }catch(error){issues.push({code:code(error),message:'当前文件或原备份无法核实，不能据此补偿'});basis=undefined}finally{await this.transport?.drain(this.owner.entry.path);release();this.heldReleases.delete(release)}
    return publicValue(fileCompensationPreviewSchema.parse({version:1,identity:input,checkedAt:now(),eligible:!!basis,...(basis?{basis}:{}),operationRevision:original.revision,compensationRevision,source,observed,restore,issues,limitations:['仅恢复原文件默认数据流字节，不恢复元数据、外部副作用或业务验收','写入期间 IO 或进程退出可能留下部分字节；未知操作不会自动回滚'],readOnly:true,acceptance:'not_evaluated'}));
  }
  /** 已保存原命令优先于新实例/当前文件；新补偿只接受桌面明确来源，不由模型调用。 */
  compensate(raw:unknown){const parsed=fileCompensationInputSchema.safeParse(raw);if(!parsed.success)fail('FILE_COMPENSATION_PRE_ACCEPT_INPUT','补偿请求结构无效');const input=structuredClone(parsed.data),actor={kind:'local_desktop' as const,interaction:'explicit_submit' as const,instanceId:input.instanceId};return this.tracked(undefined,async signal=>{
    const operationId=fileCompensationId(input),fingerprint=fileCompensationRequestFingerprint(input,actor),state=await this.store.read(),prior=controlledFileOperation(state,operationId);
    if(prior){if(prior.intent.kind!=='desktop_compensation'||prior.intent.requestFingerprint!==fingerprint)fail('FILE_COMPENSATION_COMMAND_CONFLICT','原补偿命令绑定不同请求');return publicValue(fileCompensationReceiptSchema.parse(fileCompensationReceipt(prior)))}
    let release:(()=>void)|undefined,submitted=false;try{
      this.assert(input);signal.throwIfAborted();const original=this.original(state,input.operationId,input);if(!this.available(state,original))fail('FILE_COMPENSATION_SOURCE','原操作尚未可靠完成、已补偿或仍在途');if(original.revision!==input.expectedOperationRevision||fileCompensationRevision(state,input.operationId)!==input.expectedCompensationRevision)fail('FILE_COMPENSATION_CHANGED','补偿依据已变化');
      release=this.lease.acquire('file-compensation:'+operationId,'execute');this.heldReleases.add(release);const bytes=await this.blobs.read(original.intent.before);await this.blobs.read(original.intent.intendedAfter);
      return await this.platform().withExclusiveExisting(this.owner.entry.path,original.intent.request.relativePath,this.protectedRoots(),signal,async file=>{
        const current=await file.readBefore(),basis=fileCompensationBasis({original,compensationRevision:input.expectedCompensationRevision,fileIdentity:current.identity,observedBefore:current.fact});
        if(!equal(current.identity,original.intent.fileIdentity)||!equal(current.fact,content(original.intent.intendedAfter))||basis!==input.expectedBasis)fail('FILE_COMPENSATION_CHANGED','当前文件不再等于预览的原 after');
        const at=now(),intent:FileCompensationPrepared={version:1,kind:'desktop_compensation',operationId,request:input,actor,requestFingerprint:fingerprint,original:{operationId:original.intent.operationId,intentHash:controlledFileIntentHash(original.intent),appliedRevision:3,appliedEventHash:controlledFileChangeHash(original.change)},compensationRevision:input.expectedCompensationRevision+1,previewBasis:basis,relativePath:original.intent.request.relativePath,fileIdentity:current.identity,observedBefore:current.fact,before:original.intent.intendedAfter,intendedAfter:original.intent.before,preparedAt:at};
        const alive=()=>{signal.throwIfAborted();this.assert(input)};alive();submitted=true;await this.phase({version:1,operationId,phase:'prepared',revision:1,previousRevision:0,intent,recordedAt:at},alive);
        const head=await this.execute(intent,file,bytes,alive);return publicValue(fileCompensationReceiptSchema.parse(fileCompensationReceipt(head)));
      });
    }catch(error){if(!submitted&&code(error)!=='CONTROLLED_FILE_DRAIN_PENDING'){const known=['STALE_INSTANCE','CONTROLLED_UNAVAILABLE','CONTROLLED_FILE_NOT_FOUND','FILE_COMPENSATION_SOURCE','FILE_COMPENSATION_CHANGED','WORKSPACE_EXECUTION_BUSY','CONTROLLED_BEFORE_CHANGED','CONTROLLED_PLATFORM_UNSUPPORTED','CONTROLLED_BLOB_INVALID','CONTROLLED_BLOB_PATH'];if(known.includes(code(error)))fail('FILE_COMPENSATION_PRE_ACCEPT_REJECTED','尚未保存补偿意图，当前身份、文件或来源不符合条件')}throw error}
    finally{if(release){await this.transport?.drain(this.owner.entry.path);release();this.heldReleases.delete(release)}}
  })}
  /** 按稳定本机 commandId 只读原阶段；缺记录不证明未执行，也不创建子进程、补偿或第二个命令。 */
  async receipt(raw:unknown){const input=fileCompensationLookupSchema.parse(raw);this.owner.assert();if(input.workspaceId!==this.owner.entry.id)fail('CONTROLLED_FILE_IDENTITY','工作区身份不一致');const head=controlledFileOperation(await this.store.read(),fileCompensationId(input));if(!head)return undefined;if(head.intent.kind!=='desktop_compensation'||head.intent.request.rootSessionId!==input.rootSessionId)fail('CONTROLLED_FILE_IDENTITY','原补偿不属于当前会话');return publicValue(fileCompensationReceiptSchema.parse(fileCompensationReceipt(head)))}
  /** 停止后仅排空原操作；无法确认 child 退出时保留租约与服务实例，调用方不得继续关闭 Store。 */
  async close(){this.closed=true;for(const controller of this.controllers)controller.abort(Error('工作区关闭'));await this.operations.drain();await this.transport?.drain(this.owner.entry.path);for(const release of this.heldReleases)release();this.heldReleases.clear()}
}
