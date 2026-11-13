/**
 * 执行前 Schema 异常转换为可读字段说明并保留错误码；此转换不用于已经执行后的失败。
 * 目录归属：logic/execution/rules/execution/runtime；运行生命周期内核。

 * 连续同工具同参数三次失败按提出顺序熔断；记录 blocked 原因并沿原停止/排空收束为失败，有未决副作用仍保持 interrupted，不重放。
 * 冻结executionScope必须有真实端口；范围工具只消费自身可靠allowed，一切原生文件/命令被拒绝，物理资源未收束不释放租约。
 * 完整出口将原清单选择/重核端口注入任务与JSON工具；实际交付授权必须唯一，门闩覆盖候选保存和回包之间。
 * 删除/移动只交给冻结约定的专用端口；原阶段由可信 append 保存，失败屏障与实际进程排空同样参与终态。
 * 每个正式成员运行最多暂存一次检查点，可信剩余额度允许后续运行再次停泊，零额度仍保留正常交付。
 * 受控文件边界：自身 beforeTool 可靠保存 allowed 才签发一次许可；写入及冻结删除/移动未确认后整轮限制为读取/求助并按 interrupted 封存，原失败回执不改写。停止等待文件 child 退出，失败保留原占用。
 * 作用定位：LoopRuntime 持有任务租约、工具授权与终态；显式续聊由会话选择器核实原生恢复或无交互失败重试。
 * 能力边界：验证准备交给所属能力，工具集合由显式装配提供；本层继续持有授权、日志、在途操作及停止排空时序。
 * 设计原因：工具先分类与计划门禁再审批；每轮进度绑定真实 workspace/task/run，成员专属工具另绑定完整实例。完整集合观察、产物验证及交付复核各持短锁，异步读取前后核知识、计划与停止；坏回包保留事实，求助/检查点不解锁，采集/验证只随真实结束释放。
 * 插入边界：核对原 run、可信周期令牌和发送前停止信号；原生接受后返回真实日志序号，适配器不能伪造该令牌。终态等待在途记录排空，接受后的保存失败仍属未知，不自动重放。
 * 核实边界：历史 reconciledToolIds 仅保留可读；新请求不能据裸调用 ID 续接 unknown。授权记录中的契约版本只取可信工具描述，旧记录不补造版本。
 * 外部写同样受原未知文件影响屏障约束，不因写入 GitHub 而绕过运行内写入禁令。
 * 引擎切换：主会话由会话选择器核对原生绑定；无交互启动失败只转交公开输入，未决工具与损坏记录仍拒绝，成员恢复保持冻结引擎。
 */
import path from 'node:path';
import {selectEngineSession,type EngineSessionSelection} from '../engine-session';
import {randomUUID} from 'node:crypto';
import {safeId} from '../../ports/identity';
import type {RunStorage} from '../storage';
import {toolReceipt} from '../../../tools/rules/receipts';
import {TaskProgressTools} from '../../../evidence/rules/progress-tools';
import {MemberHelpTools} from '../../../tasks/rules/member-help-tools';
import {artifactCaptureToolName} from '../../../evidence/rules/artifact-tools';
import {memberCheckpointToolName} from '../../../tasks/rules/member-checkpoint-tools';
import {RunMemberCheckpoint} from '../capabilities/member-checkpoint';
import {memberCheckpointLimit} from '../../../tasks/rules/member-checkpoint';
import {verifyMemberCheckpoint} from '../../../tasks/rules/member-checkpoint-evidence';
import {hash,json} from '../../../../core/platform/node/serialization';
import {isDeepStrictEqual} from 'node:util';
import {RunArtifactCapture,type ArtifactCapturePort} from '../capabilities/artifact-capture';
import {RunCodeCheck,prepareCodeChecks} from '../capabilities/run-code-check';
import {codeCheckToolName,type CodeCheckPort} from '../../../evidence/rules/code-check';
import {RunOutputManifestCapture,type OutputManifestCapturePort} from '../capabilities/output-manifest-capture';
import {preparedArtifactScopes,preparedArtifactTransitions} from '../../../workspace/rules/artifact-scope';
import {outputManifestToolName,outputManifestInspectToolName} from '../../../evidence/rules/output-manifest';
import {completeOutputRequired} from '../../../evidence/rules/complete-output-evidence';
import {prepareRunValidation,type RunValidation,type ValidationFilePort} from '../capabilities/run-validation';
import {memberToolCapabilities} from '../capabilities/member-tool-capabilities';
import {RunScopedExecution,type ScopedExecutionPort} from '../capabilities/run-scoped-execution';
import {preparedExecutionScope} from '../../../workspace/rules/execution-scope';
import {scopedReadToolName,scopedNodeToolName} from '../../../file-operations/rules/scoped-execution';
import {RepeatedToolFailures} from '../repeated-tool-failures';
import {toolFailureResult,toolOutcome} from '../../../tools/rules/outcome';
import {nativeToolDescriptor} from '../../../tools/rules/native-tools';
import {RunControlledFile,type ControlledFileRunPort} from '../capabilities/run-controlled-file';
import {controlledFileWriteToolName} from '../../../file-operations/rules/controlled-file-operation';
import {RunArtifactTransition,type ArtifactTransitionRunPort} from '../capabilities/run-artifact-transition';
import {artifactTransitionToolName} from '../../../file-operations/rules/artifact-transition';
import {validationToolName} from '../../../evidence/rules/validation';
import {checkedMemberRunLaunch,type MemberRunLaunch} from '../member-run';
import {checkedRunInputSource,type RunInputSource} from '../input-source';
import {checkedConversationAgentBinding,type ConversationAgentBinding} from '../conversation-binding';
import type {AgentEngine,EngineEvent,RunSummary,StoredEvent,TaskSpec,ToolCall,ToolDecision} from '../types';
import type {RunToolDescriptor} from '../../../tools/rules/policy/tool-policy';
import type {WorkflowContractBinding} from '../../../tasks/rules/execution-context';
import {workflowHasEffects} from '../../../evidence/rules/workflow-evidence';
import {fail} from '../../../../core/errors';
import {toolInputError} from '../../../tools/rules/input-validation';
import {scopeActiveInputTokenSchema,type ScopeActiveInputToken,type ScopeActiveInputSendReceipt} from '../../../tasks/rules/scope-active-input';
import {scopedActiveInputHash} from '../../../tasks/rules/scope-active-input-rules';

/** 运行装配端口；可靠启动确认与只读事件观察分开，业务状态不能靠观察回调提交。 */
export interface RuntimeOptions {
  /** 应用注入的可靠存储；大脑不导入平台文件实现。 */
  storage:RunStorage;
  /** 本工作区的任务记录根目录，运行时按 taskId/runId 分层写入。 */
  directory:string;
  /** 由后端已登记主实例装配；只用于普通对话，不由模型或前端提供，不改写原生会话来源。 */
  conversationBinding?:ConversationAgentBinding;
  /** 成员专用的有界文件和实时知识复核端口；缺省不注册采集工具，不能仅靠角色名取得能力。 */
  artifacts?:ArtifactCapturePort;
  /** 完整范围观察独立于选定文件基线；声明 artifactScope 时缺端口拒绝启动，不悄悄降级。 */
  manifests?:OutputManifestCapturePort;
  /** 仅成员冻结 Workflow 含 JSON 要求时使用；平台同字节验证与交付前当前文件复核。 */
  validations?:ValidationFilePort;
  codeChecks?:CodeCheckPort;
  /** 仅已领取成员的实际桌面写入端口；缺省绝不注册工具。 */
  controlledFiles?:ControlledFileRunPort;
  /** 正式成员固定范围端口；缺失能力拒绝启动，不能回退原生工具。 */
  scopedExecution?:ScopedExecutionPort;
  /** 仅为原冻结删除/移动要求提供实际平台操作，不接受模型任意路径或恢复请求。 */
  artifactTransitions?:ArtifactTransitionRunPort;
  /** 仅正式成员的冻结模块约定；没有约定的旧运行保持原策略，存在约定必须装配可信分类端口。 */
  workflowContracts?:WorkflowContractBinding[];
  /** 纯分类与参数解析，不询问批准或运行工具；同一个描述继续交给授权端，避免两套 effects 判断。 */
  describeTool?(call:ToolCall):RunToolDescriptor;
  /** 可信适配器在日志与授权之前解析缺省参数；失败仍记录原请求并拒绝，不执行工具。 */
  normalizeToolInput?(call:ToolCall):ToolCall['input'];
  /** 仅已领取续执行注入；复核原日志、文件、知识和原生指纹，覆盖 Runtime 与 Pi 准备窗口，不接受公开路径。 */
  assertMemberResume?():Promise<void>;
  /** 可信工厂根据已提交检查点数给出的剩余额度；每个运行仍只暂存一次，零表示只能继续交付。缺省沿用旧首段许可。 */
  memberCheckpointAllowance?:number;
  /** 原生加载后最后发送前核原日志/知识/业务文件；不重复要求已合法追加配置的 native 字节仍等于旧指纹。 */
  assertMemberResumeInputs?():Promise<void>;
  /** 返回覆盖完整运行生命周期的跨进程任务租约释放函数；拒绝时不创建运行日志或引擎。 */
  acquireLease(task:TaskSpec):Promise<()=>void>;
  /** 每轮创建独立引擎，并以已确定的任务/运行身份装配工具；不接受模型指定身份。 */
  createEngine(context:{task:TaskSpec;runId:string}):AgentEngine;
  /** 复用此前纯分类结果授权或审批；没有约定的旧装配可缺 descriptor，不能在此重新解释已给分类。 */
  toolPolicy(call:ToolCall,descriptor?:RunToolDescriptor):Promise<ToolDecision>;
  /** 引擎成功准备后、模型生成前确认启动；nativeSessionId 取已落盘 session.bound，允许 Codex 首次绑定服务端分配的 ID。失败中断本轮。 */
  onEngineReady?(input:{taskId:string;runId:string;sessionFile?:string;nativeSessionId?:string}):Promise<void>;
  /** 接收已落盘事件；异常被隔离，不能借此回调阻断运行或替代可靠提交。 */
  onEvent?(event:StoredEvent):void;
}
/** 仅可信调度入口可注入；beforeRun 成功不代表模型已经启动，后续失败不得自动重放该意图。 */
export interface RunStartControl {
  /** 启动尚未进入 active 时也必须能取消；调用者负责在停止/退出时触发。 */
  signal:AbortSignal;
  /** 租约和旧运行绑定检查之后、任何新日志/引擎之前调用，runId 由本运行时生成。 */
  beforeRun?(input:{task:TaskSpec;runId:string}):Promise<void>;
}
/** 插入绑定用户选定的原主运行；停止信号只阻止发送前准备，不撤销已确认接收。 */
export interface RunSteerControl {expectedRunId:string;signal:AbortSignal;activeInput?:{token:ScopeActiveInputToken;attachmentIds?:string[]}}
/** 可信调度器专用的新主上下文入口；运行/原生身份及旧运行集合由大脑在租约内生成，公开请求不能提供。 */
export interface FreshMainStartControl {
  signal:AbortSignal;
  /** 可信调度日志中可能尚未创建文件的旧运行意图；租约内读取，与磁盘身份合并，不能由公开请求注入。 */
  knownRunIds?():Promise<string[]>;
  /** 在任何新日志、工具装配或模型之前可靠保存意图；失败不允许启动，成功后失败也不能重放同一意图。 */
  beforeRun(input:{task:TaskSpec;runId:string;nativeSessionId:string;excludedRunIds:string[]}):Promise<void>;
}
/** 管理任务级运行和日志；成员跨任务的互斥、通道复用及结果交接由外层调度负责。 */
export class LoopRuntime {
  /** taskId 为键；同任务在本运行时中只允许一个活动运行。 */
  private active=new Map<string,{runId:string;engine:AgentEngine;stop:()=>Promise<void>;done:Promise<RunSummary>;drain?:()=>Promise<void>}>();
  /** 原运行独占插入入口及在途记录；结算前排空，防止停止后的迟到确认写到终态之后。 */
  private injections=new Map<string,{runId:string;pending:Set<Promise<ScopeActiveInputSendReceipt|undefined>>;send:(message:string,images:import('../types').InputImage[],signal:AbortSignal,activeInput?:RunSteerControl['activeInput'])=>Promise<ScopeActiveInputSendReceipt|undefined>}>();
  /** 关闭时先等待启动注册完成，防止启动/关闭竞争泄漏子进程。 */
  private starting=new Set<Promise<{runId:string;done:Promise<RunSummary>}>>();
  private closing=false;
  constructor(private options:RuntimeOptions){}
  /** 新建运行或显式恢复；可信 source 仅允许接续安全完成的主对话，返回句柄后仍需等待 done。 */
  async start(task:TaskSpec,message=task.goal,resume?:{runId:string;reconciledToolIds?:string[]},source?:RunInputSource,control?:RunStartControl):Promise<{runId:string;done:Promise<RunSummary>}>{
    if(this.closing)throw Error('Loop Engine 正在关闭');
    const pending=this.startInternal(task,message,resume,undefined,source,control);this.starting.add(pending);
    try{return await pending}finally{this.starting.delete(pending)}
  }
  /**
   * 启动已可靠领取的成员任务。只接收新业务 taskId；调用方负责成员互斥及前一通道运行的安全核实。
   * 本入口不绕过任务租约、工具门禁或日志，也不自动重试已存在任务。可信停止信号覆盖尚未登记 active 的原生准备阶段。
   */
  async startMember(task:TaskSpec,message:string,launch:MemberRunLaunch,control?:Pick<RunStartControl,'signal'>):Promise<{runId:string;done:Promise<RunSummary>}>{
    if(this.closing)throw Error('Loop Engine 正在关闭');
    const prepared=checkedMemberRunLaunch(launch,task);
    const pending=this.startInternal(task,message,undefined,prepared,undefined,control);this.starting.add(pending);
    try{return await pending}finally{this.starting.delete(pending)}
  }
  /** 已领取的单次成员续执行；不放宽普通 start/resume，不移植旧工具证据或改换原生会话。 */
  async resumeMember(task:TaskSpec,message:string,launch:MemberRunLaunch,checkpoint:{checkpointId:string;runId:string;logHash:string},control?:Pick<RunStartControl,'signal'>):Promise<{runId:string;done:Promise<RunSummary>}>{
    if(this.closing)throw Error('Loop Engine 正在关闭');
    if(!this.options.artifacts||!this.options.assertMemberResume||!this.options.assertMemberResumeInputs)throw Error('成员续执行缺少可信基线核实端口');
    const prepared=checkedMemberRunLaunch(launch,task);
    const pending=this.startInternal(task,message,undefined,prepared,undefined,control,undefined,structuredClone(checkpoint));this.starting.add(pending);
    try{return await pending}finally{this.starting.delete(pending)}
  }
  /** 为已经登记的主会话建立新上下文；不读旧日志、不承接旧工具或任务进度，目录存在及身份/租约仍须核实。 */
  async startFreshMain(task:TaskSpec,message:string,control:FreshMainStartControl):Promise<{runId:string;done:Promise<RunSummary>}>{
    if(this.closing)throw Error('Loop Engine 正在关闭');
    if(!control?.signal||typeof control.beforeRun!=='function')throw Error('新主上下文必须提供可信意图提交与停止信号');
    const pending=this.startInternal(task,message,undefined,undefined,undefined,{signal:control.signal},control);this.starting.add(pending);
    try{return await pending}finally{this.starting.delete(pending)}
  }
  private async startInternal(task:TaskSpec,message:string,resume?:{runId:string;reconciledToolIds?:string[]},member?:MemberRunLaunch,source?:RunInputSource,control?:RunStartControl,fresh?:FreshMainStartControl,memberResume?:{checkpointId:string;runId:string;logHash:string}):Promise<{runId:string;done:Promise<RunSummary>}>{
    task=structuredClone(task);
    const workflows=structuredClone(this.options.workflowContracts??[]);
    if(workflows.length&&(!member||!this.options.describeTool))fail('WORKFLOW_GATE_UNAVAILABLE','带执行约定的 Workflow 必须通过正式成员及可信工具分类门禁');
    const preparedValidation=prepareRunValidation(workflows,member?.binding,this.options.artifacts,this.options.validations),validationRequired=preparedValidation.required;
    const executionScope=preparedExecutionScope(workflows);
    if(executionScope&&(!member||!this.options.scopedExecution||task.moduleIds.some(id=>!workflows.some(binding=>binding.moduleId===id))))fail('EXECUTION_SCOPE_UNAVAILABLE','范围任务缺少完整模块声明或实际平台端口');
    const codeChecksRequired=prepareCodeChecks(workflows,this.options.codeChecks);
    const manifestScopes=preparedArtifactScopes(workflows);
    if(manifestScopes.length&&(!member||!this.options.manifests))fail('MANIFEST_UNAVAILABLE','声明的完整产物范围缺少正式成员枚举端口');
    if(preparedArtifactTransitions(manifestScopes).length&&(!member||!this.options.artifactTransitions))fail('ARTIFACT_TRANSITION_UNAVAILABLE','冻结的删除/移动要求缺少真实受控平台端口');
    const conversationBinding=this.options.conversationBinding===undefined?undefined:checkedConversationAgentBinding(this.options.conversationBinding,task);
    if(fresh&&(task.mode!=='chat'||task.agentId!=='cbim:main'||!conversationBinding||resume||member||source))throw Error('新上下文仅限已经登记的主对话实例');
    if(source){source=checkedRunInputSource(source);if(task.mode!=='chat'||!resume||member)throw Error('可信接续只能用于已有主对话');}
    control?.signal.throwIfAborted();
    safeId(task.taskId);safeId(task.workspaceId);
    if(!task.goal.trim()||!message.trim())throw Error('任务目标和执行消息不能为空');
    if(this.active.has(task.taskId))throw Error('任务正在执行');
    const release=await this.options.acquireLease(task);
    let previous:RunSummary|undefined;
    let nativeSessionId=member?.session.nativeSessionId;
    let excludedRunIds:string[]|undefined;
    let preparedEngine:AgentEngine|undefined;
    try{
      if(memberResume){
        previous=await this.inspect(task.taskId,safeId(memberResume.runId));
        if(!member||!this.options.artifacts||!this.options.assertMemberResume||previous.status!=='completed'||previous.logIntegrity?.partialTail!==false||previous.unresolvedTools.length||hash(json(previous.events))!==memberResume.logHash||!isDeepStrictEqual(previous.task,task)||!previous.memberBinding||!previous.sessionFile||previous.sessionFile!==member.session.sessionFile)throw Error('成员检查点日志、目标或上下文不再匹配');
        const {runId:_oldRun,leaseEpoch:oldEpoch,...old}=previous.memberBinding,{runId:_newRun,leaseEpoch:newEpoch,...next}=member.binding;
        if(member.binding.runId===previous.runId||newEpoch!==oldEpoch+1||!isDeepStrictEqual(old,next))throw Error('续执行必须保留原成员任务身份并创建下一代租约的新运行');
        const proof=verifyMemberCheckpoint(previous.events,previous.memberBinding,this.options.artifacts.knowledgeRevision,this.options.artifacts.normalizePath);
        if(proof?.checkpoint.checkpointId!==memberResume.checkpointId||proof.logHash!==memberResume.logHash)throw Error('成员检查点未通过完整证据核验');
        await this.options.assertMemberResume();await this.options.artifacts.assertCurrentKnowledge();control?.signal.throwIfAborted();
      }else if(fresh){
        // 只枚举旧运行身份。坏历史仍保留；不能扫描“最新可读”记录来悄悄恢复旧上下文。
        const listed=await this.options.storage.list(path.join(this.options.directory,task.taskId)),known=await fresh.knownRunIds?.()??[];
        const all=[...new Set([...listed.map(safeId),...known.map(safeId)])];
        if(all.length>4096||new Set(listed).size!==listed.length)throw Error('主会话历史数量或身份异常，不能建立新上下文');
        excludedRunIds=all.sort();nativeSessionId=randomUUID();
      }else if(resume){
        previous=await this.inspect(task.taskId,resume.runId);
        if(previous.logIntegrity?.partialTail)throw Error('原运行日志尾行不完整，先核实执行记录；不能直接续接或重放');
        // 整话题补充在 beforeRun 再核原等待并原子消费；只额外接受已完整取消的主轮，失败/未知不获得续接权。
        if(source&&((previous.status!=='completed'&&!(source.kind==='user-continuation'&&source.interruptionId&&previous.status==='cancelled'))||previous.unresolvedTools.length))throw Error('主对话上轮未安全完成，不能接续目标或成员结果');
        if(previous.memberBinding)throw Error('成员任务不能通过普通对话恢复；请先由调度核实上次执行');
        // 已绑定历史不得改换或丢失登记身份；旧未绑定历史可在明确续聊时首次绑定，不重写旧记录。
        if(previous.conversationBinding&&(!conversationBinding||Object.entries(previous.conversationBinding).some(([key,value])=>conversationBinding[key as keyof ConversationAgentBinding]!==value)))throw Error('恢复必须使用原主对话实例与通道身份');
        if(previous.task.workspaceId!==task.workspaceId||previous.task.root!==task.root||JSON.stringify(previous.task)!==JSON.stringify(task))throw Error('恢复必须使用原任务定义与工作区');
        if(previous.unresolvedTools.length)fail('RECOVERY_INSPECTION_REQUIRED','原运行存在未确认工具结果，请显式创建新的只读核实；勾选调用 ID 不能续接原生上下文');
        // 目标引擎文件及 ID 由 selectEngineSession 一起核实；只有完整无交互的启动失败可转交输入后新建。
        // 成功历史缺少文件、损坏身份和未决工具不会因此降级；旧 Pi 文件缺少原生 ID 仍由适配器拒绝。
      }else{
        await this.options.storage.reserveTask(this.options.directory,task.taskId); // 已存在任务只能经显式恢复入口继续。
      }
      const runId=member?.binding.runId??randomUUID(),directory=path.join(this.options.directory,safeId(task.taskId),runId);
      control?.signal.throwIfAborted();
      if(fresh)await fresh.beforeRun({task:structuredClone(task),runId,nativeSessionId:nativeSessionId!,excludedRunIds:[...excludedRunIds!]});
      await control?.beforeRun?.({task:structuredClone(task),runId});
      control?.signal.throwIfAborted();
      // 先创建尚未启动的适配器，工具装配失败不留下空运行日志。init 成功后必须写入头和真实取消终态，不能直接抛取消而破坏整条会话读取。
      const engine=preparedEngine=this.options.createEngine({task:structuredClone(task),runId});
      const engineSession:EngineSessionSelection=previous&&!member?await selectEngineSession(engine.kind,previous,id=>this.inspect(task.taskId,id)):{sessionFile:member?.session.sessionFile};
      const journal=this.options.storage.createJournal(directory,task,runId);await journal.init();
      let boundSessionFile:string|undefined,boundNativeSessionId:string|undefined;
      const pendingTools=new Set<string>();
      const repeatedFailures=new RepeatedToolFailures();
      // 包含尚在等待策略/人工审批的调用；只看 tool.allowed 会遗漏尚未获得授权的并发写入。
      const activeCalls=new Set<string>();
      const calls=new Map<string,{call:ToolCall;decision:ToolDecision;generation:number;overlappedEffect?:boolean;effect?:boolean}>();
      // 仅声明 Workflow 的运行启用：重叠读取仍记录真实回执，但不能证明副作用结束后的产物。
      const effectsInFlight=new Set<string>();
      const assertDeliveryReady=()=>{controlledFile?.assertVerified();artifactTransition?.assertVerified();if(effectsInFlight.size)fail('WORKFLOW_EFFECT_PENDING','仍有未结束的副作用，不能准备交付；结束后须重新读取并验证')};
      const identity={workspaceId:task.workspaceId,taskId:task.taskId,runId};
      let artifactCapture:RunArtifactCapture|undefined;
      let manifestCapture:RunOutputManifestCapture|undefined;
      let checkpointTools:RunMemberCheckpoint|undefined;
      let validation:RunValidation|undefined;
      let codeChecks:RunCodeCheck|undefined;
      let controlledFile:RunControlledFile|undefined;
      let artifactTransition:RunArtifactTransition|undefined;
      let scopedExecution:RunScopedExecution|undefined;
      const taskTools=new TaskProgressTools(previous?.taskProgress,async state=>{await emit({type:'task.updated',data:{progress:state}})},{identity,assertDeliveryReady,codeChecks:{records:()=>codeChecks?.records()??[]},artifacts:()=>artifactCapture?.refs()??[],...(completeOutputRequired(workflows)?{manifests:{select:(id,version)=>{if(!manifestCapture)fail('MANIFEST_UNAVAILABLE','本轮完整产物端口尚未就绪');return manifestCapture.select(id,version)},verifyCurrent:async record=>{if(!manifestCapture)fail('MANIFEST_UNAVAILABLE','本轮完整产物端口尚未就绪');await manifestCapture.verifyCurrent(record,'cbim_delivery_prepare')}}}:{}),...(validationRequired?{validations:{records:()=>validation?.records()??[],verifyCurrent:async records=>{if(!validation)fail('VALIDATION_UNAVAILABLE','本轮验证端口尚未就绪');await validation.verifyCurrent(records)}}}:{}),...(workflows.length?{workflow:{bindings:workflows,task:{goal:task.goal,acceptance:task.acceptance},identity}}:{})});
      const emit=async(event:EngineEvent,trustedArtifact=false)=>{
        // 契约版本来自真实描述和授权；模型/引擎事件不能给旧调用补造新协议来源。
        if(!trustedArtifact&&event.data.contractVersion!==undefined){const {contractVersion:_,...data}=event.data;event={...event,data}}
        if(event.type==='tool.allowed'&&[controlledFileWriteToolName,artifactTransitionToolName,scopedReadToolName,scopedNodeToolName].includes(String(event.data.name))&&!trustedArtifact)fail('CONTROLLED_FILE_AUTHORIZATION','受控文件授权只能由本轮策略可靠保存');
        if(event.type==='engine.status'&&event.data.activeInput!==undefined&&!trustedArtifact)throw Error('目标补充身份只能由可信插入端口保存');
        if((['artifact.baseline_captured','artifact.manifest_captured','task.checkpoint_requested','validation.checked','code.validation_checked'].includes(event.type)||event.type.startsWith('artifact.transition_'))&&!trustedArtifact)throw Error('产物、原操作、产物验证与检查点只能由本轮可信端口保存');
        if(event.type==='tool.finished'){
          const known=calls.get(String(event.data.id));
          const {receipt:_untrustedReceipt,...data}=event.data;
          // 被拒绝调用也可能收到 Pi 的失败结束事件；不能覆盖为成功，也不接受无 gate 的伪造回执。
          if(known){
            if(data.name!==undefined&&data.name!==known.call.name)throw Error('工具结果名称与已授权调用不一致');
            event={...event,data:{...data,receipt:toolReceipt(identity,known.call,known.decision,!known.decision.allow?'denied':data.isError?'failed':'succeeded',data.result)}};
          }else event={...event,data};
        }
        if((event.type==='tool.finished'||event.type==='tool.denied')&&calls.has(String(event.data.id))){
          const status=event.type==='tool.denied'?'rejected':event.data.isError?'unknown':'returned';
          event={...event,data:{...event.data,outcome:toolOutcome(status)}};
        }
        const saved=await journal.append(event);
        artifactCapture?.observed(saved);
        manifestCapture?.observed(saved);
        checkpointTools?.observed(saved);
        validation?.observed(saved);codeChecks?.observed(saved);
        controlledFile?.observed(saved.type,saved.data.id,saved.data.isError===true);
        artifactTransition?.observed(saved);
        scopedExecution?.observed(saved.type,saved.data.id);
        if(event.type==='session.bound'){
          if(typeof event.data.sessionFile==='string')boundSessionFile=event.data.sessionFile;
          if(typeof event.data.sessionId==='string')boundNativeSessionId=event.data.sessionId;
        }
        if(event.type==='tool.finished'&&event.data.receipt){
          const known=calls.get(String(event.data.id))!;
          if(!workflows.length||known.effect||!known.overlappedEffect&&!effectsInFlight.size)taskTools.record(event.data.receipt as import('../../../tools/rules/types').ToolReceipt,known.generation);
        }
        if(event.type==='tool.allowed')pendingTools.add(String(event.data.id));
        if(event.type==='tool.finished'||event.type==='tool.denied'){pendingTools.delete(String(event.data.id));activeCalls.delete(String(event.data.id));effectsInFlight.delete(String(event.data.id))}
        if(event.type==='tool.finished'||event.type==='tool.denied'){
          const blocked=repeatedFailures.settled(String(event.data.id),event.type==='tool.denied'||event.data.isError===true);
          if(blocked){
            await emit({type:'engine.status',data:{state:'blocked',...blocked,message:'同一工具同参数连续失败三次，已停止本轮；请核实原结果并修正原因。'}});
            // 不在工具回调内等待引擎自身退出，避免自等待；收尾仍排空原在途工作。
            void stop().catch(()=>{});
          }
        }
        try{void Promise.resolve(this.options.onEvent?.(saved)).catch(()=>{})}catch{/* observers cannot change durable execution */}
        return saved;
      };
      let stopping=false;
      let stopFailure:unknown;
      const memberHelpTools=member?new MemberHelpTools(member.binding,{
        save:async help=>{await emit({type:'task.help_requested',data:{help}})},
        assertReady:(id,attempted)=>{
          if(stopping||calls.get(id)?.decision.allow!==true||!pendingTools.has(id))throw Error('求助调用已停止或未获得授权');
          if([...activeCalls].some(other=>other!==id)||[...pendingTools].some(other=>other!==id))throw Error('仍有未结束工具，不能交接求助');
          if(attempted.some(other=>other===id||!calls.has(other)||activeCalls.has(other)))throw Error('求助引用了本轮不存在或未结束的工具调用');
        },
      }):undefined;
      if(member&&this.options.artifacts)artifactCapture=new RunArtifactCapture(member.binding,this.options.artifacts,{
        current:()=>taskTools.current(),
        assertReady:id=>{
          if(stopping||calls.get(id)?.decision.allow!==true||!pendingTools.has(id))throw Error('文件采集已停止或未获得当前调用授权');
          if([...activeCalls].some(other=>other!==id)||[...pendingTools].some(other=>other!==id))throw Error('存在其它在途工具或审批，不能采集文件基线');
        },
        save:async baseline=>{await emit({type:'artifact.baseline_captured',data:{baseline}},true)},
      });
      if(member&&manifestScopes.length&&this.options.manifests)manifestCapture=new RunOutputManifestCapture(member.binding,manifestScopes,this.options.manifests,{
        bindings:workflows,
        current:()=>taskTools.current(),
        assertReady:id=>{
          if(stopping||calls.get(id)?.decision.allow!==true||!pendingTools.has(id)||[...activeCalls].some(other=>other!==id)||[...pendingTools].some(other=>other!==id))fail('MANIFEST_CALL','完整产物采集已停止、未获准或仍有其它在途工具');
        },
        assertReadingReady:name=>{
          const ids=[...activeCalls];if(stopping||ids.length!==1||pendingTools.size!==1||!pendingTools.has(ids[0])||calls.get(ids[0])?.decision.allow!==true||calls.get(ids[0])?.call.name!==name)fail('MANIFEST_CALL','完整产物复核已停止、未获准或仍有其它在途工具');
          controlledFile?.assertVerified();artifactTransition?.assertVerified();
        },
        save:async manifest=>{await emit({type:'artifact.manifest_captured',data:{manifest}},true)},
      });
      const checkpointAllowance=this.options.memberCheckpointAllowance??(memberResume?0:1);
      if(!Number.isInteger(checkpointAllowance)||checkpointAllowance<0||checkpointAllowance>memberCheckpointLimit)throw Error('成员检查点剩余额度无效');
      if(member&&this.options.artifacts&&checkpointAllowance>0)checkpointTools=new RunMemberCheckpoint(member.binding,this.options.artifacts,{
        current:()=>taskTools.current(),assertReady:id=>{
          if(stopping||calls.get(id)?.decision.allow!==true||!pendingTools.has(id)||[...activeCalls].some(other=>other!==id)||[...pendingTools].some(other=>other!==id))throw Error('检查点调用已停止、未获准或仍有其他在途操作');
        },save:async checkpoint=>{await emit({type:'task.checkpoint_requested',data:{checkpoint}},true)},
      });
      if(codeChecksRequired&&member&&this.options.codeChecks&&this.options.manifests)codeChecks=new RunCodeCheck(workflows,identity,this.options.manifests.knowledgeRevision,this.options.codeChecks,{
        currentVersion:()=>taskTools.current()?.version,generation:()=>taskTools.generation,
        assertReady:id=>{if(stopping||calls.get(id)?.decision.allow!==true||!pendingTools.has(id)||[...activeCalls].some(other=>other!==id)||[...pendingTools].some(other=>other!==id))fail('CODE_CHECK_CALL','检查未授权或有其它在途工具')},
        assertKnowledge:()=>this.options.manifests!.assertCurrentKnowledge(),
        save:async codeCheck=>{await emit({type:'code.validation_checked',data:{codeCheck}},true)},
      });
      validation=preparedValidation.create({
        current:()=>taskTools.current(),generation:()=>taskTools.generation,
        assertReady:id=>{if(stopping||calls.get(id)?.decision.allow!==true||!pendingTools.has(id)||[...activeCalls].some(other=>other!==id)||[...pendingTools].some(other=>other!==id))fail('VALIDATION_CALL','产物验证已停止、未获准或仍有其他在途操作')},
        assertDeliveryReady:()=>{if(stopping||[...activeCalls].some(id=>calls.get(id)?.call.name!=='cbim_delivery_prepare')||[...pendingTools].some(id=>calls.get(id)?.call.name!=='cbim_delivery_prepare')||activeCalls.size>1)fail('VALIDATION_BUSY','仍有其他工具或审批未结束，不能读取 JSON 交付证据');assertDeliveryReady()},
        verifyManifest:async(record,signal)=>{if(!manifestCapture)fail('MANIFEST_UNAVAILABLE','本轮完整产物端口尚未就绪');await manifestCapture.verifyCurrent(record,'cbim_validation_run',signal)},
        save:async value=>{await emit({type:'validation.checked',data:{validation:value}},true)},
      });
      if(executionScope&&this.options.scopedExecution)scopedExecution=new RunScopedExecution(executionScope,this.options.scopedExecution,id=>{
        if(stopping||calls.get(id)?.decision.allow!==true||!pendingTools.has(id)||[...activeCalls].some(other=>other!==id)||[...pendingTools].some(other=>other!==id))fail('EXECUTION_SCOPE_CALL','范围调用已停止、未获准或仍有其它工具');
      });
      let finishing=false;
      if(member&&this.options.controlledFiles)controlledFile=new RunControlledFile(member.binding,this.options.controlledFiles,id=>{
        if(stopping||calls.get(id)?.decision.allow!==true||!pendingTools.has(id)||[...activeCalls].some(other=>other!==id)||[...pendingTools].some(other=>other!==id))fail('CONTROLLED_FILE_CALL','受控写已停止、未获准或有其他在途工具');
      });
      if(member&&preparedArtifactTransitions(manifestScopes).length&&this.options.manifests&&this.options.artifactTransitions)artifactTransition=new RunArtifactTransition(member.binding,manifestScopes,this.options.manifests,this.options.artifactTransitions,{
        version:()=>taskTools.current()?.version,
        assertReady:id=>{if(stopping||calls.get(id)?.decision.allow!==true||!pendingTools.has(id)||[...activeCalls].some(other=>other!==id)||[...pendingTools].some(other=>other!==id))fail('ARTIFACT_TRANSITION_CALL','删除/移动已停止、未获准或仍有其它调用');controlledFile?.assertVerified()},
        save:event=>emit(event,true),
      });
      const injection={runId,pending:new Set<Promise<ScopeActiveInputSendReceipt|undefined>>(),send:async(message:string,images:import('../types').InputImage[],signal:AbortSignal,activeInput?:RunSteerControl['activeInput'])=>{
        const assertReady=()=>{
          if(stopping||this.closing||signal.aborted)fail('QUEUE_INSERT_STOPPED','当前运行已停止插入，原消息仍保留在队列');
          if(finishing||task.mode!=='chat'||task.agentId!=='cbim:main'||!engine.steer)fail('QUEUE_INSERT_STALE','原主运行已结束或不支持插入，原消息仍保留在队列');
        };
        assertReady();
        const token=activeInput?scopeActiveInputTokenSchema.parse(structuredClone(activeInput.token)):undefined;
        if(token&&(token.runId!==runId||token.inputHash!==scopedActiveInputHash({message,...(activeInput?.attachmentIds?{attachmentIds:activeInput.attachmentIds}:{})})))fail('QUEUE_INSERT_STALE','原插入快照与准备记录不一致，原消息仍保留在队列');
        const requested=await emit({type:'engine.status',data:{metric:'insertion',state:'requested',message,...(token?{activeInput:token}:{}),label:'正在插入用户补充'}},true);
        let nativeAccepted=false;
        try{
          assertReady();await engine.steer!(message,images,signal);
          nativeAccepted=true;
          // queued 已由原生确认；迟到停止不抹去接受事实，持久化失败仍交由上层保留未知。
          const accepted=await emit({type:'engine.status',data:{metric:'insertion',state:'accepted',message,...(token?{activeInput:token}:{}),label:'已插入，当前动作完成后处理'}},true);
          return token?{...token,requestedSeq:requested.seq,acceptedSeq:accepted.seq}:undefined;
        }catch(error){
          const rejected=!nativeAccepted&&['QUEUE_INSERT_STOPPED','QUEUE_INSERT_STALE'].includes((error as {code?:string})?.code??'');
          try{await emit({type:'engine.status',data:{metric:'insertion',state:'failed',message,...(token?{activeInput:token}:{}),label:rejected?'插入未发送，原消息保留在队列':'插入未确认，请核实后继续'}},true)}catch{fail('QUEUE_INSERT_UNKNOWN','插入结果未确认，请先核实原运行记录，勿重复发送')}
          if(rejected)throw error;
          fail('QUEUE_INSERT_UNKNOWN','插入结果未确认，请先核实原运行记录，勿重复发送');
        }
      }};
      this.injections.set(task.taskId,injection);
      // 保存输入及可信来源；显式补充仍是用户消息，成员结果不能在界面或原生上下文中冒充用户授权。
      await emit({type:'run.started',data:{task,message,engine:engine.kind,resumeFrom:resume?.runId,reconciledToolIds:resume?.reconciledToolIds??[],...(workflows.length?{workflowContracts:workflows}:{}),...(memberResume?{memberResume:{checkpointId:memberResume.checkpointId,runId:memberResume.runId}}:{}),...(conversationBinding?{conversationBinding}:{}),...(source?{source}:{}),...(member?{memberBinding:member.binding,nativeSessionId:member.session.nativeSessionId}:{}),...(fresh?{freshMain:{nativeSessionId,excludedRunIds}}:{})}});
      await taskTools.invalidate('新一轮执行需要重新核实产物与证据');
      const stop=async()=>{
        if(stopping)return;stopping=true;artifactCapture?.stop();manifestCapture?.stop();checkpointTools?.stop();validation?.stop();codeChecks?.stop();controlledFile?.stop();artifactTransition?.stop();scopedExecution?.stop();
        try{await emit({type:'run.stop_requested',data:{}})}catch(error){stopFailure=error}
        // 记录失败不能阻止实际 abort；失败事实在收尾按 interrupted 保留，不把无日志停止写成正常求助。
        try{await engine.stop()}catch(error){stopFailure??=error}
        if(stopFailure)throw stopFailure;
      };
      const abort=()=>{void stop().catch(()=>{})};
      control?.signal.addEventListener('abort',abort,{once:true});
      const done=(async()=>{
        let result:{status:'completed'|'cancelled'|'failed';error?:string}|undefined;
        let failure:unknown;
        try{
          if(control?.signal.aborted)await stop();
          if(!stopping)await engine.start({task,runId,directory,sessionFile:engineSession.sessionFile,engineHandoff:engineSession.handoff,nativeSessionId:previous&&!member?engineSession.nativeSessionId:nativeSessionId,memberBinding:member?.binding,conversationBinding:conversationBinding?structuredClone(conversationBinding):undefined,source:source?structuredClone(source):undefined,capabilities:memberToolCapabilities({codeCheckTools:codeChecks,taskTools,memberHelpTools,artifactTools:artifactCapture?.tools,manifestTools:manifestCapture?.tools,memberCheckpointTools:checkpointTools?.tools,validationTools:validation?.tools,controlledFileTools:controlledFile,artifactTransitionTools:artifactTransition,scopedExecutionTools:scopedExecution}),assertMemberResume:memberResume?this.options.assertMemberResume:undefined,emit:async event=>{await emit(event)},beforeTool:async call=>{
            call=structuredClone(call);
            if(calls.has(call.id))return {allow:false,reason:'同一运行不能重复使用工具调用 ID'};
            const originalInput=structuredClone(call.input);let normalizationError:unknown;
            try{if(this.options.normalizeToolInput)call.input=structuredClone(this.options.normalizeToolInput(structuredClone(call)))}catch(error){normalizationError=error}
            repeatedFailures.proposed(call);
            // 验证、采集与停泊先同步预占，再进入策略；短读锁不会绕过求助/检查点的本轮结束门闩。
            const scopedReason=executionScope&&nativeToolDescriptor(call.name)?'EXECUTION_SCOPE_NATIVE: 冻结范围任务禁止原生文件与命令工具':scopedExecution?.guard(call.name,call.id,call.input,[...activeCalls])??(!scopedExecution&&call.name.startsWith('cbim_scoped_')?'本轮未提供范围执行能力':undefined);
            const transitionReason=scopedReason??artifactTransition?.guard(call.name,call.id,call.input,[...activeCalls])??(!artifactTransition&&call.name===artifactTransitionToolName?'本轮未提供冻结删除/移动能力':undefined);
            const controlledReason=transitionReason??controlledFile?.guard(call.name,call.id,call.input,[...activeCalls])??(!controlledFile&&call.name===controlledFileWriteToolName?'本轮未提供受控文件工具':undefined);
            const validationReason=controlledReason??codeChecks?.guard(call.name,call.id,call.input,[...activeCalls])??(!codeChecks&&call.name===codeCheckToolName?'本轮未装配代码检查':undefined)??validation?.guard(call.name,call.id,call.input,[...activeCalls])??(!validation&&call.name===validationToolName?'本轮未提供冻结要求的 JSON/CSV/PNG 产物验证工具':undefined);
            const checkpointReason=validationReason??checkpointTools?.guard(call.name,call.id,call.input,[...activeCalls])??(!checkpointTools&&call.name===memberCheckpointToolName?'本轮没有剩余检查点额度或未装配可信检查点能力':undefined);
            const artifactReason=checkpointReason??artifactCapture?.guard(call.name,call.id,call.input,[...activeCalls])??(!artifactCapture&&call.name===artifactCaptureToolName?'本轮未提供成员文件基线采集能力':undefined);
            const manifestReason=artifactReason??manifestCapture?.guard(call.name,call.id,call.input,[...activeCalls])??(!manifestCapture&&[outputManifestToolName,outputManifestInspectToolName].includes(call.name)?'本轮未提供冻结完整范围的枚举能力':undefined);
            const helpReason=manifestReason??memberHelpTools?.guard(call.name,call.id,call.input,[...activeCalls])??(!memberHelpTools&&call.name==='cbim_task_help'?'仅正式执行成员可提交求助':undefined);
            // 门闩明确拒绝的调用只记录拒绝事实，绝无执行机会，不能反过来阻塞已经获准的求助。
            if(!helpReason&&!stopping)activeCalls.add(call.id);
            calls.set(call.id,{call,decision:{allow:false},generation:taskTools.generation,overlappedEffect:workflows.length>0&&effectsInFlight.size>0});
            await emit({type:'tool.proposed',data:{...call,...(!isDeepStrictEqual(originalInput,call.input)?{originalInput}:{})}});
            let decision:ToolDecision,descriptor:RunToolDescriptor|undefined,planVersion:number|undefined,inputFailure:unknown;
            try{
              if(normalizationError)throw normalizationError;
              if(repeatedFailures.blocked)decision={allow:false,reason:'TOOL_REPEAT_BLOCKED: 同一工具同参数连续失败三次，请核实原结果并修正原因'};
              else if(stopping)decision={allow:false,reason:'任务正在停止'};
              else if(helpReason)decision={allow:false,reason:helpReason};
              else{
                if(workflows.length&&call.name==='cbim_delivery_prepare')assertDeliveryReady();
                descriptor=this.options.describeTool?.(structuredClone(call));
                if(descriptor&&workflowHasEffects(descriptor.effects))planVersion=taskTools.beforeEffects();
                decision=descriptor?await this.options.toolPolicy(structuredClone(call),structuredClone(descriptor)):await this.options.toolPolicy(structuredClone(call));
              }
            }catch(error){inputFailure=toolInputError(error);error=inputFailure;const code=(error as {code?:string})?.code;decision={allow:false,reason:(code?.startsWith('WORKFLOW_')?code+': ':'')+(error instanceof Error?error.message:String(error)),...(descriptor?{effects:descriptor.effects}:{})}}
            if(stopping){inputFailure=undefined;decision={...decision,allow:false,reason:'任务正在停止'}};
            // Workflow 首片仅约束业务副作用；知识提交仍沿用原来的证据失效规则，不能因分类拆分保留旧证据。
            if(decision.allow&&((descriptor?.effects??decision.effects)?.some(effect=>['business-write','knowledge-write','external-write','command'].includes(effect))||(!descriptor&&['write','edit','bash'].includes(call.name)))){
              if(workflows.length){
                effectsInFlight.add(call.id);calls.get(call.id)!.effect=true;
                for(const [id,known] of calls)if(id!==call.id&&activeCalls.has(id)&&!known.effect)known.overlappedEffect=true;
              }
              try{await taskTools.invalidate('即将执行可能改变产物的操作，需要重新验证',planVersion)}catch(error){const code=(error as {code?:string})?.code;decision={...decision,allow:false,reason:(code?.startsWith('WORKFLOW_')?code+': ':'')+(error instanceof Error?error.message:String(error))}}
            }
            calls.set(call.id,{...calls.get(call.id)!,call,decision,generation:taskTools.generation});
            if(!decision.allow)decision={...decision,reason:(toolFailureResult(inputFailure??decision.reason??'未获授权',true).content[0] as {text:string}).text};
            const authorization=await emit({type:decision.allow?'tool.allowed':'tool.denied',data:{id:call.id,name:call.name,input:call.input,...decision,...(Number.isSafeInteger(descriptor?.contractVersion)&&descriptor!.contractVersion!>0?{contractVersion:descriptor!.contractVersion}:{}),...(!decision.allow?{receipt:toolReceipt(identity,call,decision,'denied')}: {})}},true);
            if(stopping&&decision.allow){
              decision={...decision,allow:false,reason:'任务正在停止'};calls.set(call.id,{...calls.get(call.id)!,call,decision,generation:taskTools.generation});
              await emit({type:'tool.denied',data:{...call,...decision,receipt:toolReceipt(identity,call,decision,'denied')}});
            }
            if(decision.allow)scopedExecution?.authorize(call.id,authorization.seq);
            if(decision.allow)controlledFile?.authorize(call.id,authorization.seq);
            if(decision.allow)artifactTransition?.authorize(call.id,authorization.seq);
            if(!decision.allow)memberHelpTools?.denied(call.id);
            return decision;
          }});
          if(control?.signal.aborted)await stop();
          if(!stopping)await this.options.onEngineReady?.({taskId:task.taskId,runId,sessionFile:boundSessionFile,...(boundNativeSessionId?{nativeSessionId:boundNativeSessionId}:{})});
          if(!stopping&&memberResume)await this.options.assertMemberResumeInputs!();
          if(control?.signal.aborted)await stop();
          result=stopping?{status:'cancelled' as const}:await engine.run(message);
        }catch(error){
          failure=error;
        }finally{
          finishing=true;
          control?.signal.removeEventListener('abort',abort);
          artifactCapture?.stop();
          manifestCapture?.stop();
          checkpointTools?.stop();
          validation?.stop();controlledFile?.stop();artifactTransition?.stop();scopedExecution?.stop();
          try{await engine.close()}catch(error){failure??=error}
          // 只重试原收尾屏障，不重试文件写。首次退出未确认保留 active；再次 close 可确认原 child 后完成日志收尾。
          let draining:Promise<void>|undefined;
          const drain=()=>draining??=(async()=>{
            await scopedExecution?.drain();
            await controlledFile?.drain();
            await artifactTransition?.drain();
            await Promise.allSettled([...injection.pending]);
            failure??=stopFailure;
            try{
            const unverifiedControlledCalls=[...controlledFile?.unverifiedCallIds??[],...artifactTransition?.unverifiedCallIds??[]];
            if(failure||pendingTools.size||unverifiedControlledCalls.length)await emit({type:'run.interrupted',data:{error:failure instanceof Error?failure.message:String(failure||(unverifiedControlledCalls.length?'CONTROLLED_FILE_REVIEW_REQUIRED: 原受控文件操作结果待核实，本轮不能安全交接':'工具结果未确认')),unresolvedTools:[...pendingTools],...(unverifiedControlledCalls.length?{unverifiedControlledCalls}:{}),receipts:[...pendingTools].map(id=>{const item=calls.get(id)!;return toolReceipt(identity,item.call,item.decision,'unknown')})}});
            // close 仍属于本轮生命周期：在排空引擎期间收到停止，不能把已暂存的 completed 写成正常交接。
            else await emit({type:'run.settled',data:{...(repeatedFailures.blocked?{status:'failed' as const,blocked:repeatedFailures.blocked,error:'TOOL_REPEAT_BLOCKED: 同一工具同参数连续失败三次，请核实原结果并修正原因。'}:stopping&&result?.status==='completed'?{status:'cancelled' as const}:result),acceptance:'not_evaluated'}});
            await journal.flush();
            }finally{this.active.delete(task.taskId);this.injections.delete(task.taskId);release()}
          })().catch(error=>{draining=undefined;throw error});
          const current=this.active.get(task.taskId);if(current)current.drain=drain;await drain();
        }
        return this.options.storage.read(directory);
      })();
      this.active.set(task.taskId,{runId,engine,stop,done});void done.catch(()=>{});
      return {runId,done};
    }catch(error){this.injections.delete(task.taskId);try{await preparedEngine?.close()}finally{release()}throw error}
  }
  /** 读取指定轮次日志；本进程仍持有该轮次时将尚无终态的摘要呈现为 running，不触发恢复。 */
  async inspect(taskId:string,runId:string){
    const summary=await this.options.storage.read(path.join(this.options.directory,safeId(taskId),safeId(runId)));
    if(this.active.get(taskId)?.runId===runId&&summary.status==='interrupted')return {...summary,status:'running' as const};
    return summary;
  }
  /** 请求当前轮次停止；不存在活动运行时为空操作，最终状态仍须等待启动句柄的 done。 */
  async stop(taskId:string){await this.active.get(taskId)?.stop()}
  /** 只向明确选定的原活动运行注入；当前新轮不能代收迟到请求，未知结果不自动重放。 */
  async steer(taskId:string,message:string,images:import('../types').InputImage[],control:RunSteerControl){
    if(this.closing||control?.signal?.aborted)fail('QUEUE_INSERT_STOPPED','当前运行已停止插入，原消息仍保留在队列');
    const inject=this.injections.get(taskId);
    if(!control?.signal||!control.expectedRunId||this.active.get(taskId)?.runId!==control.expectedRunId||inject?.runId!==control.expectedRunId)fail('QUEUE_INSERT_STALE','原主运行已变化，原消息仍保留在队列');
    const pending=inject.send(message,images,control.signal,control.activeInput?structuredClone(control.activeInput):undefined);inject.pending.add(pending);
    try{return await pending}finally{inject.pending.delete(pending)}
  }
  /** 禁止新启动，等待在途注册后停止并收束活动运行；逐项失败不会阻止其余资源释放。 */
  async close(){this.closing=true;await Promise.allSettled([...this.starting]);const active=[...this.active.values()];await Promise.allSettled(active.map(x=>x.stop()));await Promise.allSettled(active.map(x=>x.done));const drains=await Promise.allSettled([...this.active.values()].map(x=>x.drain?.()));const failed=drains.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason}
}
