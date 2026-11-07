/**
 * 作用定位：大脑 执行层：LoopRuntime：任务租约、前置工具策略、运行终态与显式恢复。
 * 设计原因：工具先纯分类，成员 Workflow 计划条件先于审批；批准后核计划版本，重叠副作用期间的读回执不作交付证据。求助和检查点封住后续操作，文件采集绑定真实回执和知识；续执行复核原证明，不将坏历史伪装成恢复。
 */
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {safeId} from '../foundation/identity';
import type {RunStorage} from './storage';
import {toolReceipt} from '../tools/receipts';
import {TaskProgressTools} from '../tasks/progress-tools';
import {MemberHelpTools} from '../tasks/member-help-tools';
import {artifactCaptureToolName} from '../tasks/artifact-tools';
import {memberCheckpointToolName} from '../tasks/member-checkpoint-tools';
import {RunMemberCheckpoint} from './member-checkpoint';
import {verifyMemberCheckpoint} from '../tasks/member-checkpoint-evidence';
import {hash,json} from '../foundation/serialization';
import {isDeepStrictEqual} from 'node:util';
import {RunArtifactCapture,type ArtifactCapturePort} from './artifact-capture';
import {checkedMemberRunLaunch,type MemberRunLaunch} from './member-run';
import {checkedRunInputSource,type RunInputSource} from './input-source';
import {checkedConversationAgentBinding,type ConversationAgentBinding} from './conversation-binding';
import type {AgentEngine,EngineEvent,RunSummary,StoredEvent,TaskSpec,ToolCall,ToolDecision} from './types';
import type {RunToolDescriptor} from '../policy/tool-policy';
import type {WorkflowContractBinding} from '../tasks/execution-context';
import {workflowHasEffects} from '../tasks/workflow-evidence';
import {fail} from '../foundation/errors';

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
  /** 仅正式成员的冻结模块约定；没有约定的旧运行保持原策略，存在约定必须装配可信分类端口。 */
  workflowContracts?:WorkflowContractBinding[];
  /** 纯分类与参数解析，不询问批准或运行工具；同一个描述继续交给授权端，避免两套 effects 判断。 */
  describeTool?(call:ToolCall):RunToolDescriptor;
  /** 仅已领取续执行注入；复核原日志、文件、知识和原生指纹，覆盖 Runtime 与 Pi 准备窗口，不接受公开路径。 */
  assertMemberResume?():Promise<void>;
  /** 原生加载后最后发送前核原日志/知识/业务文件；不重复要求已合法追加配置的 native 字节仍等于旧指纹。 */
  assertMemberResumeInputs?():Promise<void>;
  /** 返回覆盖完整运行生命周期的跨进程任务租约释放函数；拒绝时不创建运行日志或引擎。 */
  acquireLease(task:TaskSpec):Promise<()=>void>;
  /** 每轮创建独立引擎，并以已确定的任务/运行身份装配工具；不接受模型指定身份。 */
  createEngine(context:{task:TaskSpec;runId:string}):AgentEngine;
  /** 复用此前纯分类结果授权或审批；没有约定的旧装配可缺 descriptor，不能在此重新解释已给分类。 */
  toolPolicy(call:ToolCall,descriptor?:RunToolDescriptor):Promise<ToolDecision>;
  /** 引擎成功准备、模型生成前必须完成的可靠启动确认；失败中断本轮，不能由只读观察者代替。 */
  onEngineReady?(input:{taskId:string;runId:string;sessionFile?:string}):Promise<void>;
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
  private active=new Map<string,{runId:string;engine:AgentEngine;stop:()=>Promise<void>;done:Promise<RunSummary>}>();
  /** 绑定活动运行的持久化入口；插入回执保存在同一运行，关闭时一并清理。 */
  private injections=new Map<string,(message:string,images:import('./types').InputImage[])=>Promise<void>>();
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
        if(source&&(previous.status!=='completed'||previous.unresolvedTools.length))throw Error('主对话上轮未安全完成，不能接续目标或成员结果');
        if(previous.memberBinding)throw Error('成员任务不能通过普通对话恢复；请先由调度核实上次执行');
        // 已绑定历史不得改换或丢失登记身份；旧未绑定历史可在明确续聊时首次绑定，不重写旧记录。
        if(previous.conversationBinding&&(!conversationBinding||Object.entries(previous.conversationBinding).some(([key,value])=>conversationBinding[key as keyof ConversationAgentBinding]!==value)))throw Error('恢复必须使用原主对话实例与通道身份');
        if(previous.task.workspaceId!==task.workspaceId||previous.task.root!==task.root||JSON.stringify(previous.task)!==JSON.stringify(task))throw Error('恢复必须使用原任务定义与工作区');
        if(previous.unresolvedTools.some(id=>!resume.reconciledToolIds?.includes(id)))throw Error('存在结果未确认的工具操作，先核实产物再显式确认恢复');
        if(!previous.sessionFile)throw Error('缺少原生会话记录，不能伪装成恢复');
        // 文件位置与原生身份必须来自同一次可靠绑定；不能以逻辑 agentSessionId 或聊天 taskId 猜测旧原生 ID。
        const bound=[...previous.events].reverse().find(event=>event.type==='session.bound');
        if(bound?.data.sessionId!==undefined){
          if(typeof bound.data.sessionId!=='string'||bound.data.sessionFile!==previous.sessionFile)throw Error('原生会话身份记录与恢复文件不一致');
          nativeSessionId=safeId(bound.data.sessionId);
        }
        // 旧日志缺少原生 ID 时不补造；适配器决定是否支持无身份的历史，Pi 明确拒绝这种恢复。
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
      const journal=this.options.storage.createJournal(directory,task,runId);await journal.init();
      let boundSessionFile:string|undefined;
      const pendingTools=new Set<string>();
      // 包含尚在等待策略/人工审批的调用；只看 tool.allowed 会遗漏尚未获得授权的并发写入。
      const activeCalls=new Set<string>();
      const calls=new Map<string,{call:ToolCall;decision:ToolDecision;generation:number;overlappedEffect?:boolean;effect?:boolean}>();
      // 仅声明 Workflow 的运行启用：重叠读取仍记录真实回执，但不能证明副作用结束后的产物。
      const effectsInFlight=new Set<string>();
      const assertDeliveryReady=()=>{if(effectsInFlight.size)fail('WORKFLOW_EFFECT_PENDING','仍有未结束的副作用，不能准备交付；结束后须重新读取并验证')};
      const identity={workspaceId:task.workspaceId,taskId:task.taskId,runId};
      let artifactCapture:RunArtifactCapture|undefined;
      let checkpointTools:RunMemberCheckpoint|undefined;
      const taskTools=new TaskProgressTools(previous?.taskProgress,async state=>{await emit({type:'task.updated',data:{progress:state}})},{artifacts:()=>artifactCapture?.refs()??[],...(workflows.length?{workflow:{bindings:workflows,task:{goal:task.goal,acceptance:task.acceptance},identity},assertDeliveryReady}:{})});
      const emit=async(event:EngineEvent,trustedArtifact=false)=>{
        if((event.type==='artifact.baseline_captured'||event.type==='task.checkpoint_requested')&&!trustedArtifact)throw Error('产物和检查点只能由本轮可信端口保存');
        if(event.type==='tool.finished'){
          const known=calls.get(String(event.data.id));
          const {receipt:_untrustedReceipt,...data}=event.data;
          // 被拒绝调用也可能收到 Pi 的失败结束事件；不能覆盖为成功，也不接受无 gate 的伪造回执。
          if(known){
            if(data.name!==undefined&&data.name!==known.call.name)throw Error('工具结果名称与已授权调用不一致');
            event={...event,data:{...data,receipt:toolReceipt(identity,known.call,known.decision,!known.decision.allow?'denied':data.isError?'failed':'succeeded',data.result)}};
          }else event={...event,data};
        }
        const saved=await journal.append(event);
        artifactCapture?.observed(saved);
        checkpointTools?.observed(saved);
        if(event.type==='session.bound'&&typeof event.data.sessionFile==='string')boundSessionFile=event.data.sessionFile;
        if(event.type==='tool.finished'&&event.data.receipt){
          const known=calls.get(String(event.data.id))!;
          if(!workflows.length||known.effect||!known.overlappedEffect&&!effectsInFlight.size)taskTools.record(event.data.receipt as import('../tools/types').ToolReceipt,known.generation);
        }
        if(event.type==='tool.allowed')pendingTools.add(String(event.data.id));
        if(event.type==='tool.finished'||event.type==='tool.denied'){pendingTools.delete(String(event.data.id));activeCalls.delete(String(event.data.id));effectsInFlight.delete(String(event.data.id))}
        try{void Promise.resolve(this.options.onEvent?.(saved)).catch(()=>{})}catch{/* observers cannot change durable execution */}
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
      if(member&&this.options.artifacts&&!memberResume)checkpointTools=new RunMemberCheckpoint(member.binding,this.options.artifacts,{
        current:()=>taskTools.current(),assertReady:id=>{
          if(stopping||calls.get(id)?.decision.allow!==true||!pendingTools.has(id)||[...activeCalls].some(other=>other!==id)||[...pendingTools].some(other=>other!==id))throw Error('检查点调用已停止、未获准或仍有其他在途操作');
        },save:async checkpoint=>{await emit({type:'task.checkpoint_requested',data:{checkpoint}},true)},
      });
      this.injections.set(task.taskId,async(message,images)=>{
        if(stopping||!engine.steer)throw Error('当前执行不支持插入消息');
        await emit({type:'engine.status',data:{metric:'insertion',state:'requested',message,label:'正在插入用户补充'}});
        try{await engine.steer(message,images);await emit({type:'engine.status',data:{metric:'insertion',state:'accepted',message,label:'已插入，当前动作完成后处理'}})}
        catch(error){await emit({type:'engine.status',data:{metric:'insertion',state:'failed',message,label:'插入未确认，请核实后继续'}});throw error}
      });
      // 保存输入及可信来源；显式补充仍是用户消息，成员结果不能在界面或原生上下文中冒充用户授权。
      await emit({type:'run.started',data:{task,message,engine:engine.kind,resumeFrom:resume?.runId,reconciledToolIds:resume?.reconciledToolIds??[],...(workflows.length?{workflowContracts:workflows}:{}),...(memberResume?{memberResume:{checkpointId:memberResume.checkpointId,runId:memberResume.runId}}:{}),...(conversationBinding?{conversationBinding}:{}),...(source?{source}:{}),...(member?{memberBinding:member.binding,nativeSessionId:member.session.nativeSessionId}:{}),...(fresh?{freshMain:{nativeSessionId,excludedRunIds}}:{})}});
      await taskTools.invalidate('新一轮执行需要重新核实产物与证据');
      const stop=async()=>{
        if(stopping)return;stopping=true;artifactCapture?.stop();checkpointTools?.stop();
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
          if(!stopping)await engine.start({task,runId,directory,sessionFile:member?.session.sessionFile??previous?.sessionFile,nativeSessionId,memberBinding:member?.binding,conversationBinding:conversationBinding?structuredClone(conversationBinding):undefined,source:source?structuredClone(source):undefined,taskTools,memberHelpTools,artifactTools:artifactCapture?.tools,memberCheckpointTools:checkpointTools?.tools,assertMemberResume:memberResume?this.options.assertMemberResume:undefined,emit:event=>emit(event),beforeTool:async call=>{
            call=structuredClone(call);
            if(calls.has(call.id))return {allow:false,reason:'同一运行不能重复使用工具调用 ID'};
            // 同步预占求助边界，先于任何 await；主 Agent 即便伪造工具名也不能取得成员求助能力。
            const checkpointReason=checkpointTools?.guard(call.name,call.id,call.input,[...activeCalls])??(!checkpointTools&&call.name===memberCheckpointToolName?'本任务最多一次检查点和一次续执行，本轮不能再申请停泊':undefined);
            const artifactReason=checkpointReason??artifactCapture?.guard(call.name,call.id,call.input,[...activeCalls])??(!artifactCapture&&call.name===artifactCaptureToolName?'本轮未提供成员文件基线采集能力':undefined);
            const helpReason=artifactReason??memberHelpTools?.guard(call.name,call.id,call.input,[...activeCalls])??(!memberHelpTools&&call.name==='cbim_task_help'?'仅正式执行成员可提交求助':undefined);
            // 门闩明确拒绝的调用只记录拒绝事实，绝无执行机会，不能反过来阻塞已经获准的求助。
            if(!helpReason&&!stopping)activeCalls.add(call.id);
            calls.set(call.id,{call,decision:{allow:false},generation:taskTools.generation,overlappedEffect:workflows.length>0&&effectsInFlight.size>0});
            await emit({type:'tool.proposed',data:{...call}});
            let decision:ToolDecision,descriptor:RunToolDescriptor|undefined,planVersion:number|undefined;
            try{
              if(stopping)decision={allow:false,reason:'任务正在停止'};
              else if(helpReason)decision={allow:false,reason:helpReason};
              else{
                if(workflows.length&&call.name==='cbim_delivery_prepare')assertDeliveryReady();
                descriptor=this.options.describeTool?.(structuredClone(call));
                if(descriptor&&workflowHasEffects(descriptor.effects))planVersion=taskTools.beforeEffects();
                decision=descriptor?await this.options.toolPolicy(structuredClone(call),structuredClone(descriptor)):await this.options.toolPolicy(structuredClone(call));
              }
            }catch(error){const code=(error as {code?:string})?.code;decision={allow:false,reason:(code?.startsWith('WORKFLOW_')?code+': ':'')+(error instanceof Error?error.message:String(error)),...(descriptor?{effects:descriptor.effects}:{})}}
            if(stopping)decision={...decision,allow:false,reason:'任务正在停止'};
            // Workflow 首片仅约束业务副作用；知识提交仍沿用原来的证据失效规则，不能因分类拆分保留旧证据。
            if(decision.allow&&((descriptor?.effects??decision.effects)?.some(effect=>['business-write','knowledge-write','command'].includes(effect))||(!descriptor&&['write','edit','bash'].includes(call.name)))){
              if(workflows.length){
                effectsInFlight.add(call.id);calls.get(call.id)!.effect=true;
                for(const [id,known] of calls)if(id!==call.id&&activeCalls.has(id)&&!known.effect)known.overlappedEffect=true;
              }
              try{await taskTools.invalidate('即将执行可能改变产物的操作，需要重新验证',planVersion)}catch(error){const code=(error as {code?:string})?.code;decision={...decision,allow:false,reason:(code?.startsWith('WORKFLOW_')?code+': ':'')+(error instanceof Error?error.message:String(error))}}
            }
            calls.set(call.id,{...calls.get(call.id)!,call,decision,generation:taskTools.generation});
            await emit({type:decision.allow?'tool.allowed':'tool.denied',data:{...call,...decision,...(!decision.allow?{receipt:toolReceipt(identity,call,decision,'denied')}: {})}});
            if(stopping&&decision.allow){
              decision={...decision,allow:false,reason:'任务正在停止'};calls.set(call.id,{...calls.get(call.id)!,call,decision,generation:taskTools.generation});
              await emit({type:'tool.denied',data:{...call,...decision,receipt:toolReceipt(identity,call,decision,'denied')}});
            }
            if(!decision.allow)memberHelpTools?.denied(call.id);
            return decision;
          }});
          if(control?.signal.aborted)await stop();
          if(!stopping)await this.options.onEngineReady?.({taskId:task.taskId,runId,sessionFile:boundSessionFile});
          if(!stopping&&memberResume)await this.options.assertMemberResumeInputs!();
          if(control?.signal.aborted)await stop();
          result=stopping?{status:'cancelled' as const}:await engine.run(message);
        }catch(error){
          failure=error;
        }finally{
          control?.signal.removeEventListener('abort',abort);
          artifactCapture?.stop();
          checkpointTools?.stop();
          try{await engine.close()}catch(error){failure??=error}
          failure??=stopFailure;
          try{
            if(failure||pendingTools.size)await emit({type:'run.interrupted',data:{error:failure instanceof Error?failure.message:String(failure||'工具结果未确认'),unresolvedTools:[...pendingTools],receipts:[...pendingTools].map(id=>{const item=calls.get(id)!;return toolReceipt(identity,item.call,item.decision,'unknown')})}});
            // close 仍属于本轮生命周期：在排空引擎期间收到停止，不能把已暂存的 completed 写成正常交接。
            else await emit({type:'run.settled',data:{...(stopping&&result?.status==='completed'?{status:'cancelled' as const}:result),acceptance:'not_evaluated'}});
            await journal.flush();
          }finally{this.active.delete(task.taskId);this.injections.delete(task.taskId);release()}
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
  /** 只向当前活动运行注入；调用者负责按会话串行化，失败不得自动重放。 */
  async steer(taskId:string,message:string,images:import('./types').InputImage[]=[]){
    const inject=this.injections.get(taskId);if(!this.active.has(taskId)||!inject)throw Error('任务已结束，请继续队列');
    await inject(message,images);
  }
  /** 禁止新启动，等待在途注册后停止并收束活动运行；逐项失败不会阻止其余资源释放。 */
  async close(){this.closing=true;await Promise.allSettled([...this.starting]);const active=[...this.active.values()];await Promise.allSettled(active.map(x=>x.stop()));await Promise.allSettled(active.map(x=>x.done))}
}
