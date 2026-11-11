/**
 * 内部 MainStartup 在真实周期建立后、模型启动前绑定身份和准备首任务；取消贯穿准备，不是公开运行选项。
 * IPC 单独校验 collaborationMode；协作选项不参与 read/ask/execute 权限推导。
 * 作用定位：工作区主对话管理，负责普通 chat、目标周期接续、多轮历史和消息队列；旧直接团队业务入口拒绝新执行，业务成员统一经岗位派发领取。
 * 设计原因：原命令先查回执；等待补充的附件一次准备，图片仅留本轮。容量准入先于意图，beforeRun 核额度、停止与清单后登记运行；人工决定仍走独立系统来源，当前坏历史不能回退旧头。
 * 插入边界：先查原 scope/run/queue 回执再领取和读附件；绑定明确的原主 run，停止信号先于串行清理。周期输入接收落盘后才移除队列，未知结果同时阻止内存自动推进。
 * 执行选项接受明确引擎并随本轮准备、排队与后续调用传递；具体适配器仍由可信工厂选择。
 * 读取边界：团队与模块查询统一经 knowledge/read-models 公开入口，主对话生命周期与写操作仍由现有调度服务管理。
 */
import {MessageQueue,type QueueCounts} from '../conversation/message-queue';
import {ApprovalQueue} from '../conversation/approvals';
import {QuestionQueue} from '../conversation/questions';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mainAgentId} from '../conversation/main-agent';
import {z} from 'zod';
import {loopEngineSchema} from '../../core/brain/llm/engine';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import {fail,Fault} from '../../core/foundation/errors';
import {safeId} from '../../core/foundation/identity';
import type {RunStorage} from '../../core/brain/storage';
import type {StoredEvent,TaskSpec} from '../../core/brain';
import type {RunInputSource,RunSummary,ConversationThreadView} from '../../core/brain/types';
import {checkedRunInputSource} from '../../core/brain/input-source';
import type {createWorkspaceLoop,WorkspaceLoopOptions} from './loop-engine';
import {prepareTeamTask,type TeamTaskInput} from '../context/team-workflow';
import {Team,BusinessWorkspace} from '../../core/knowledge/read-models';

import {goalContinuationRequestSchema,type GoalContinuationRequest,type GoalContinuationReceipt} from '../../core/tasks/scope-continuation';
import type {DispatchScopeWait} from '../../core/tasks/dispatch-scope';
import type {ScopeActiveInput,ScopeActiveInputPayload,ScopeActiveInputToken,ScopeActiveInputSendReceipt} from '../../core/tasks/scope-active-input';
import {scopedActiveInputHash} from '../../core/tasks/scope-active-input-rules';
import {sameGoalValue} from '../../core/tasks/scope-goal';
import {hash,json} from '../../core/foundation/serialization';
import {assertContinuationAttachmentManifest,type ContinuationAttachmentManifest,type TrustedContinuationInput} from '../../core/tasks/scope-continuation-attachments';
import {recoveryRequestSchema,recoveryRequestSource,type RecoveryRequest,type RecoveryLookup,type RecoveryReceipt} from '../../core/tasks/scope-recovery';
import type {FreshContext} from '../../core/tasks/fresh-context';
import type {ExecutionAdmissionWait,ExecutionLaunchContext} from './admission-wait';
import {replanRequestSchema,type ReplanRequest,type ReplanLookup,type ReplanReceipt} from '../../core/tasks/scope-replan';
import {humanContinuationRequestSchema,type HumanContinuationRequest,type HumanContinuationLookup,type HumanContinuationReceipt} from '../../core/tasks/human-continue';

/** IPC 允许的模型运行配置；不接受任意子进程命令或环境变量。 */
export const executionOptions=z.object({engine:loopEngineSchema.optional(),provider:z.string().trim().min(1),model:z.string().trim().min(1),profileId:z.string().uuid().optional(),attachmentIds:z.array(z.string().uuid()).max(12).optional(),allowNativeExecution:z.boolean().default(false),permission:z.enum(['read','ask','execute']).optional(),collaborationMode:z.enum(['auto','team']).optional(),turnTimeoutMs:z.number().int().min(1000).max(3600000).optional()}).strict();
type Options=z.infer<typeof executionOptions>;
/** Main 装配方在真实周期建立后、模型启动前持久绑定或准备首个任务；不接受 IPC/模型提供的回调。 */
export interface MainStartup {signal:AbortSignal;prepare(input:{task:TaskSpec;runId:string;signal:AbortSignal}):Promise<void>}
/** 由可信工作区装配一次；回调只登记或唤醒协调器，不在 settled 内等待成员执行。 */
export interface ExecutionCollaboration {
  /** 原插入结果先查，不依赖队列仍存在；未知结果不得再次获取发送权。 */
  activeInputReceipt?(rootSessionId:string,runId:string,queueId:string):Promise<ScopeActiveInput|undefined>;
  /** 整个准备/发送/结算加入周期在途操作；回调不重入 Manager.serial，停止先发给原引擎。 */
  insertActiveInput?(rootSessionId:string,runId:string,queueId:string,input:ScopeActiveInputPayload,signal:AbortSignal,send:(token?:ScopeActiveInputToken)=>Promise<ScopeActiveInputSendReceipt|undefined>):Promise<void>;
  /** 人工接续有独立意图和系统来源；查询不核实或启动，只有 beforeRun 可消费当前等待。 */
  humanContinuationReceipt?(query:HumanContinuationLookup):Promise<HumanContinuationReceipt|undefined>;
  humanContinuationPreflight?(request:HumanContinuationRequest):Promise<{wait:DispatchScopeWait;message:string}>;
  acceptHumanContinuation?(request:HumanContinuationRequest,task:TaskSpec,runId:string,signal:AbortSignal):Promise<void>;
  /** 正式业务重规划只读取原命令回执；查询不授予第二次启动资格。 */
  replanReceipt?(query:ReplanLookup):Promise<ReplanReceipt|undefined>;
  /** 核实已完成只读周期的真实证据、模块和人工约束，启动意图提交前还要重新核验。 */
  replanPreflight?(request:ReplanRequest):Promise<void>;
  /** 只接受运行时生成的新上下文，原子保存业务目标、明确权限及证据基线后才登记活动周期。 */
  acceptReplan?(request:ReplanRequest,task:TaskSpec,context:{runId:string;nativeSessionId:string;excludedRunIds:string[];signal?:AbortSignal}):Promise<void>;
  /** 只查询已接收的新周期；不得因为回执已存在而再次创建模型。 */
  recoveryReceipt?(query:RecoveryLookup):Promise<RecoveryReceipt|undefined>;
  /** 在工厂准备前核实来源、只读配置和关闭状态；可靠意图提交时仍须再次核验。 */
  recoveryPreflight?(request:RecoveryRequest):Promise<void>;
  /** 只接受运行时生成的上下文边界；必须先持久提交新周期，再绑定活动调度。 */
  acceptRecovery?(request:RecoveryRequest,task:TaskSpec,context:{runId:string;nativeSessionId:string;excludedRunIds:string[];signal?:AbortSignal}):Promise<void>;
  /** 核实或业务重规划的最新可靠上下文按持久提交顺序返回；不是“最新可读日志”。 */
  recoveryContext?(rootSessionId:string):Promise<FreshContext|undefined>;
  /** 可能没有运行目录的可靠旧意图也要冻结在新上下文边界中。 */
  recoveryRunIds?(rootSessionId:string):Promise<string[]>;
  /** 只读持久意图；重试必须先核对回执，不依据 active Map 缺项推断从未执行。 */
  continuationReceipt?(query:{workspaceId:string;rootSessionId:string;scopeId:string;commandId:string}):Promise<GoalContinuationReceipt|undefined>;
  /** 读取当前安全检查点，旧等待、已关闭目标以及跨身份请求不能进入启动准备。 */
  continuationCheckpoint?(request:GoalContinuationRequest):Promise<DispatchScopeWait>;
  /** 取得真实 runId 后原子消费等待；只有新提交可转入本进程的活动周期。 */
  acceptContinuation?(request:GoalContinuationRequest,task:TaskSpec,runId:string,trusted?:TrustedContinuationInput):Promise<void>;
  /** 工厂准备完成、启动模型之前打开或续接周期；message 是本轮原文而非首次 goal，source 表示可信结果回注，不创建新目标。 */
  /** Runtime在日志/引擎之前给出真实runId；缺省仅供旧独立装配兼容，不能补造完整归属。 */
  starting?(task:TaskSpec,options:Options,source:RunInputSource|undefined,message:string,runId?:string):Promise<void>;
  /** 覆盖持久登记至日志/引擎关闭的真实主运行窗口；仅可信装配使用，不从历史推测在途。 */
  holdMain?(runId:string):()=>void;
  /** 启动未成功时清理已经打开的周期；成员结果遇到暂时占用可保留原周期等待。 */
  startFailed?(task:TaskSpec,source:RunInputSource|undefined,error:unknown):Promise<void>;
  /** 当前主会话仍有协作批次时，用户消息留在原队列，不抢占成员执行资源。 */
  busy(taskId:string):boolean;
  /** 可信等待检查点已经提交且没有活动模型；仅用于阻止普通队列解除等待，不授予验收或恢复权。 */
  waiting?(taskId:string):boolean;
  /** 只在运行和工作区占用已清理后同步通知；undefined 表示收尾或日志未能核实。 */
  settled(task:TaskSpec,options:Options,summary?:RunSummary):void;
  /** 必须先标记该会话停止自动调度，再等待成员收尾；不在管理器串行事务内调用。 */
  stop(taskId:string):Promise<void>;
}
export class WorkspaceExecutionManager {
  private collaboration?:ExecutionCollaboration;
  /** 用户停止后的迟到结果与自动队列不能重启模型；显式新用户轮次或继续队列才清除此屏障。 */
  private resultContinuationStopped=new Set<string>();
  /** 插入结果未知/队列落盘失败只暂停普通队列，不能误停仍正常工作的成员结果回注。 */
  private queueAdvanceStopped=new Set<string>();
  /** 捕获工厂/周期准备期间的用户停止；不能在 await 返回后误清除新收到的停止请求。 */
  private stopVersions=new Map<string,number>();
  /** 工厂、意图提交及日志初始化尚未进入 active 时仍可立即收到停止信号。 */
  private pendingLaunches=new Map<string,AbortController>();
  /** 包含等待串行入口的插入；停止必须在 claim/附件/RPC 等待返回之前可撤销。 */
  private pendingInsertions=new Map<AbortController,string>();
  private insertionsClosed=false;
  private cancelInsertions(taskId?:string){for(const [controller,id] of this.pendingInsertions)if(taskId===undefined||taskId===id)controller.abort()}
  /** 可信应用/协调器关闭时使用；只终止在途启动，不清除持久等待或批准任何操作。 */
  cancelPendingLaunches(){this.insertionsClosed=true;this.cancelInsertions();for(const controller of this.pendingLaunches.values())controller.abort(Object.assign(Error('启动期间已收到停止请求'),{code:'COLLABORATION_STOPPED'}))}
  /** 仅供可信装配层接入，不能通过公开 IPC 提供回调或替换正在使用的协调器。 */
  attachCollaboration(hooks:ExecutionCollaboration){if(this.closing||this.collaboration)throw Error('协作调度已装配或工作区正在关闭');this.collaboration=hooks}
  private messageQueue?:MessageQueue;
  private queueSubscriptions=new Set<()=>void>();
  private queueSource(){return this.messageQueue??=new MessageQueue(path.join(this.workspace.paths.project(this.workspace.entry.id),'loop-engine','pending-messages.json'))}
  private async queue(){const q=this.queueSource();await q.load();return q}
  /** 全工作区队列的只读负载订阅；应在初始化前注册，首次恢复与保存之后发布，不暴露消息正文。 */
  observeQueue(listener:(counts:QueueCounts)=>void,failed?:(error:Error)=>void){
    if(this.closing)throw Error('工作区执行管理正在关闭');
    const release=this.queueSource().subscribe(listener,failed);
    this.queueSubscriptions.add(release);
    return ()=>{release();this.queueSubscriptions.delete(release)};
  }
  /** 不创建任务或启动模型；串行载入已有队列，恢复出的消息保持暂停状态。 */
  initializeQueueMonitoring():Promise<void>{return this.serial(async()=>{await this.queue()})}
  queued(taskId:string){return this.serial(async()=>{safeId(taskId);return (await this.queue()).list(taskId)})}
  /** 队列游标与变更共享串行边界，只发布已提交快照；保留 queued 供兼容和诊断使用。 */
  queueDelta(taskId:string,cursor?:unknown){return this.serial(async()=>{safeId(taskId);return (await this.queue()).delta(taskId,cursor)})}
  enqueue(taskId:string,message:string,options:Options){return this.serial(async()=>{safeId(taskId);if(!message.trim())throw Error('消息不能为空');await this.thread(taskId);const q=await this.queue();const entry=await q.add(taskId,message,executionOptions.parse(options));if(this.collaboration?.waiting?.(taskId))await q.pause(taskId,'当前目标等待用户补充，后续消息保留在队列');await this.pump(taskId);return entry})}
  changeQueued(taskId:string,id:string,action:unknown){return this.serial(async()=>{await (await this.queue()).change(taskId,id,z.enum(['first','up','down','remove']).parse(action))})}
  editQueued(taskId:string,id:string,message:string,expected:string){return this.serial(async()=>{await (await this.queue()).edit(taskId,id,message,expected)})}
  moveQueued(taskId:string,id:string,beforeId?:string){return this.serial(async()=>{await (await this.queue()).move(taskId,id,beforeId)})}
  /** 插入只使用选定原主轮的模型/权限；queued 后不反悔，失败留原项且禁止自动重放。 */
  insertQueued(taskId:string,id:string,expectedRunId:string){
    const stopVersion=this.stopVersions.get(taskId)??0,controller=new AbortController();
    this.pendingInsertions.set(controller,taskId);
    const pending=this.serial(async()=>{
      safeId(taskId);
      try{if(typeof expectedRunId!=='string')throw Error('missing');safeId(expectedRunId)}catch{fail('QUEUE_INSERT_STALE','缺少有效的原主运行标识，原消息仍保留在队列')}
      const original=await this.collaboration?.activeInputReceipt?.(taskId,expectedRunId,id);
      if(original){
        const queue=await this.queue(),entry=queue.list(taskId).find(item=>item.id===id);
        if(entry&&scopedActiveInputHash({message:entry.message,...(entry.options.attachmentIds?{attachmentIds:entry.options.attachmentIds}:{})})!==original.inputHash)fail('GOAL_ACTIVE_INPUT_CONFLICT','原队列身份已绑定不同输入快照，不能重新发送');
        if(original.status==='accepted'){if(entry)await queue.complete(id);return}
        if(original.status==='rejected')fail('QUEUE_INSERT_STOPPED','原插入已明确未发送，消息仍保留在队列；请核实后编辑或另行发送');
        fail('QUEUE_INSERT_UNKNOWN','插入结果未确认，队列保持暂停，请先核实原运行记录，勿重复发送');
      }
      const active=this.active.get(taskId);
      const assertCurrent=()=>{
        if(this.closing||this.insertionsClosed||controller.signal.aborted||(this.stopVersions.get(taskId)??0)!==stopVersion||this.resultContinuationStopped.has(taskId))fail('QUEUE_INSERT_STOPPED','当前运行已停止插入，原消息仍保留在队列');
        this.workspace.assert();
        if(!active?.isMain||active.runId!==expectedRunId||this.active.get(taskId)!==active||this.collaboration?.waiting?.(taskId))fail('QUEUE_INSERT_STALE','原主运行已结束或变化，原消息仍保留在队列');
      };
      assertCurrent();const q=await this.queue();assertCurrent();
      let claimed=false,enteredRuntime=false;
      try{
        const entry=await q.claim(taskId,id);claimed=true;assertCurrent();
        const images=await this.inputImages(entry.options.attachmentIds);assertCurrent();
        enteredRuntime=true;
        const input={message:entry.message,...(entry.options.attachmentIds?{attachmentIds:[...entry.options.attachmentIds]}:{})};
        const send=(token?:ScopeActiveInputToken)=>active!.loop.runtime.steer(taskId,entry.message,images,{expectedRunId,signal:controller.signal,...(token?{activeInput:{token,attachmentIds:input.attachmentIds}}:{})});
        if(this.collaboration?.insertActiveInput)await this.collaboration.insertActiveInput(taskId,expectedRunId,id,input,controller.signal,send);
        else await send();
        // 原生 queued 和接受日志均已确认。这里不再按迟到 stop 撤销消费，保存失败只能保持未知。
        await q.complete(id);
      }catch(error){
        const rejected=['QUEUE_INSERT_STOPPED','QUEUE_INSERT_STALE'].includes((error as {code?:string})?.code??'');
        const unknown=enteredRuntime&&!rejected;
        if(claimed){
          // 即便暂停落盘失败，settled/pump 也不能把已发送或已确认的旧消息自动再执行。
          this.queueAdvanceStopped.add(taskId);
          try{await q.pause(taskId,unknown?'插入结果未确认，请先核实原运行记录，勿重复发送':rejected?'本次插入未发送，原消息仍保留在队列':'插入准备失败，原消息保留在队列，请核实后继续')}
          catch{fail('QUEUE_INSERT_UNKNOWN','插入或队列保存结果未确认，自动推进已停止，请先核实原运行记录，勿重复发送')}
        }
        if(unknown)fail('QUEUE_INSERT_UNKNOWN','插入结果未确认，队列已暂停，请先核实原运行记录，勿重复发送');
        throw error;
      }
    });
    return pending.finally(()=>this.pendingInsertions.delete(controller));
  }
  continueQueue(taskId:string){return this.serial(async()=>{safeId(taskId);if(this.collaboration?.waiting?.(taskId))fail('GOAL_WAITING','当前目标正在等待补充，继续队列不能恢复或验收该目标');this.resultContinuationStopped.delete(taskId);await (await this.queue()).resume(taskId);this.queueAdvanceStopped.delete(taskId);await this.pump(taskId)})}
  /** 成功结束才自动续接；异常和未核实工具保留队列，等待用户显式处理。 */
  private async pump(taskId:string){
    if(this.closing||this.resultContinuationStopped.has(taskId)||this.queueAdvanceStopped.has(taskId)||this.active.has(taskId)||this.collaboration?.busy(taskId))return;const q=await this.queue();if(!q.list(taskId).length)return;
    const prior=(await this.thread(taskId)).at(-1);if(!prior?.sessionFile||prior.unresolvedTools.length||prior.status==='interrupted'||prior.status==='running'){await q.pause(taskId,'请先核实上一轮执行状态');return}
    if(prior.task.mode!=='chat'){await q.pause(taskId,'队列仅支持普通对话');return}
    const next=await q.take(taskId);if(!next)return;
    try{await this.launch(prior.task,executionOptions.parse(next.options),next.message,{runId:prior.runId},undefined,true);await q.complete(next.id)}catch(e:any){await q.pause(taskId,e.message)}
  }
  private active=new Map<string,{runId:string;isMain:boolean;loop:Awaited<ReturnType<typeof createWorkspaceLoop>>}>();
  private pending:Promise<unknown>=Promise.resolve();
  private closing=false;
  private listeners=new Set<(event:StoredEvent)=>void>();
  private questions=new QuestionQueue();
  pendingQuestions(taskId:string){safeId(taskId);return this.questions.list(taskId)}
  answerQuestion(taskId:string,id:string,answers:unknown){safeId(taskId);this.questions.answer(taskId,id,answers)}
  private approvalQueue=new ApprovalQueue();
  pendingApprovals(taskId:string){safeId(taskId);return this.approvalQueue.list(taskId)}
  answerApproval(taskId:string,id:string,allow:boolean,allowAll=false){this.approvalQueue.answer(taskId,id,allow,allowAll)}
  private cancelApprovals(taskId?:string){this.approvalQueue.cancel(taskId);this.questions.cancel(taskId)}
  /** 运行工厂由装配方注入，调度层不创建 main 的进程锁或具体工作区实例。 */
  constructor(readonly workspace:KnowledgeWorkspace,private storage:RunStorage,private factory:(options:WorkspaceLoopOptions,task:TaskSpec,context:ExecutionLaunchContext)=>ReturnType<typeof createWorkspaceLoop>,private inputImages:(ids?:string[])=>Promise<import('../../core/brain/types').InputImage[]>=async()=>[],
    /** Main 只在首次未受理的附件补充调用；旧装配缺省仍支持文本，不冒造文件或视觉输入。 */
    private prepareContinuationInput?:(input:GoalContinuationRequest['input'],signal:AbortSignal)=>Promise<{message:string;images:import('../../core/brain/types').InputImage[];manifest:ContinuationAttachmentManifest}>){}
  /** 观察者只收到已落盘事件；监听错误不能改变执行结果。 */
  subscribe(listener:(event:StoredEvent)=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener)}}
  private serial<T>(work:()=>Promise<T>):Promise<T>{
    if(this.closing)return Promise.reject(Error('工作区执行管理正在关闭'));
    const next=this.pending.then(()=>{this.workspace.assert();return work()});this.pending=next.catch(()=>{});return next;
  }
  prepare(input:TeamTaskInput){return this.serial(()=>prepareTeamTask(this.workspace,input))}
  /** 对话选择器只返回模块和角色；people 固定为空兼容旧消费者，正式上下文仍在启动时校验并冻结。 */
  async choices(){
    const snapshot=await this.workspace.snapshot(),business=new BusinessWorkspace(snapshot),team=new Team(snapshot);
    const registry=await business.modules(),agents=await team.agents();
    const modules=await Promise.all(registry.modules.map(async(m:any)=>{const detail=await business.module(m.id);return {id:m.id,name:detail.definition.name,workflows:detail.workflows.map((w:any)=>({id:w.id,name:w.name}))}}));
    return {modules,agents:agents.groups.flatMap((g:any)=>g.agents.map((a:any)=>({id:a.id,name:a.name}))),people:[],structural:snapshot.validation?.structural};
  }
  /** 执行预检只读取当前上下文；旧运行仅可由可靠新周期明确排除，当前坏日志与缺失初始运行仍阻断。 */
  async thread(taskId:string){
    const root=path.join(this.directory(),safeId(taskId));const runs=await this.storage.list(root);
    const context=await this.collaboration?.recoveryContext?.(taskId),excluded=new Set(context?.excludedRunIds??[]);
    const current=runs.filter(id=>!excluded.has(id));
    if(context&&!current.includes(context.initialRunId))fail('MAIN_CONTEXT_INCOMPLETE','新上下文启动记录缺失，请核实该周期，不能退回旧运行');
    const summaries=await Promise.all(current.map(runId=>this.inspect(taskId,safeId(runId))));
    return this.checkedCurrentHistory(current,summaries,context);
  }
  /** 新上下文按实际 resumeFrom 链组织，不用系统时钟或“最新可读”猜测；这里只核实已读取事实。 */
  private checkedCurrentHistory(ids:string[],summaries:RunSummary[],context?:FreshContext){
    if(ids.length!==summaries.length||new Set(ids).size!==ids.length)fail('MAIN_CONTEXT_INCOMPLETE','当前上下文存在无法读取的运行，不能回退');
    if(context&&!ids.includes(context.initialRunId))fail('MAIN_CONTEXT_INCOMPLETE','新上下文启动记录缺失，不能退回旧运行');
    for(const summary of summaries){
      if(summary.logIntegrity?.partialTail)fail('MAIN_CONTEXT_INCOMPLETE','当前上下文存在不完整日志，不能续接或回退');
      if(context){
        const native=summary.events.find(event=>event.type==='session.bound')?.data.sessionId;
        if(native!==undefined&&native!==context.nativeSessionId)fail('MAIN_CONTEXT_IDENTITY','当前运行不属于已登记的新上下文');
        if(summary.runId===context.initialRunId){
          const initial=summary.events[0]?.data.freshMain as {nativeSessionId?:unknown;excludedRunIds?:unknown}|undefined;
          if(!initial||initial.nativeSessionId!==context.nativeSessionId||!sameGoalValue(initial.excludedRunIds,context.excludedRunIds))fail('MAIN_CONTEXT_IDENTITY','新上下文初始运行与可靠意图不一致');
        }
      }
    }
    if(context){
      const first=summaries.find(run=>run.runId===context.initialRunId)!;
      const ordered=[first],remaining=new Set(summaries.filter(run=>run!==first));
      while(remaining.size){
        const successors=[...remaining].filter(run=>run.events[0]?.data.resumeFrom===ordered.at(-1)!.runId);
        if(successors.length!==1)fail('MAIN_CONTEXT_IDENTITY','新上下文运行链存在缺口或分叉，不能猜测续接头');
        const next=successors[0];
        if(!sameGoalValue(next.task,first.task)||!sameGoalValue(next.conversationBinding,first.conversationBinding))fail('MAIN_CONTEXT_IDENTITY','新上下文运行链改变了主任务或实例绑定');
        remaining.delete(next);ordered.push(next);
      }
      return ordered;
    }
    return summaries.sort((a,b)=>a.events[0].time.localeCompare(b.events[0].time));
  }
  /** 全部历史的只读投影；坏记录独立显示，不补造终态、不修复源文件，且不会把较早可读记录当作最新执行。 */
  async threadView(taskId:string):Promise<ConversationThreadView>{
    const ids=await this.storage.list(path.join(this.directory(),safeId(taskId))),view:ConversationThreadView={runs:[],issues:[]};
    for(const runId of ids){try{
      const run=await this.inspect(taskId,safeId(runId));view.runs.push(run);
      if(run.logIntegrity?.partialTail)view.issues.push({runId,code:'RUN_LOG_INCOMPLETE',message:'这条运行记录尾行不完整，不能作为续跑或验收依据；原文件保持不变。'});
    }catch(error){view.issues.push({runId,code:typeof (error as {code?:unknown})?.code==='string'?(error as {code:string}).code:'RUN_LOG_UNAVAILABLE',message:'这条历史运行暂时无法核实，原记录保留；不能据此判定没有发生操作。'});}}
    view.runs.sort((a,b)=>a.events[0].time.localeCompare(b.events[0].time));
    try{
      const context=await this.collaboration?.recoveryContext?.(taskId),excluded=new Set(context?.excludedRunIds??[]),current=ids.filter(id=>!excluded.has(id));
      view.resumeRunId=this.checkedCurrentHistory(current,view.runs.filter(run=>current.includes(run.runId)),context).at(-1)?.runId;
    }catch{/* 显示历史与执行预检分别处理；任何当前缺口都不提供回退头，不重复读取全部日志。 */}
    return view;
  }
  /** 新任务重新准备上下文，不接收调用方伪造的知识正文或任务身份。 */
  start(_input:TeamTaskInput,_options:Options):Promise<{workspaceId:string;taskId:string;runId:string}>{return Promise.reject(new Fault('OWNER_DISPATCH_REQUIRED','新业务必须由主调度按模块负责人正式派发；旧任务和历史记录保持可读'))}
  /** 普通对话由内置主 Agent 接待，不依赖团队注册表或知识结构通过校验。 */
  chat(message:string,options:Options,startup?:MainStartup){return this.serial(async()=>{
    const goal=z.string().trim().min(1).parse(message);
    return this.launch({mode:'chat',taskId:randomUUID(),workspaceId:this.workspace.entry.id,root:this.workspace.entry.path,goal,agentId:mainAgentId,moduleIds:[],acceptance:[]},executionOptions.parse(options),message,undefined,undefined,false,undefined,undefined,undefined,undefined,undefined,startup);
  })}
  /** 自动队列与结果回注在工厂等待前后都复核停止屏障，防止停止协作期间重新唤起旧消息。 */
  private async launch(task:TaskSpec,options:Options,message=task.goal,resume?:{runId:string;reconciledToolIds?:string[]},source?:RunInputSource,automaticQueue=false,continuation?:GoalContinuationRequest,recovery?:RecoveryRequest,replan?:ReplanRequest,admissionWait?:ExecutionAdmissionWait,human?:HumanContinuationRequest,startup?:MainStartup){
    if(task.mode!=='chat')fail('OWNER_DISPATCH_REQUIRED','旧直接业务入口不能创建新执行轮，请由主调度重新规划派发');
    if(recovery&&replan)fail('FRESH_MAIN_CONFLICT','同一启动不能混合只读核实和业务重规划');
    const fresh=Boolean(recovery||replan);
    if(this.active.has(task.taskId))fail('TASK_RUNNING','任务正在执行');
    if((source?.kind==='member-results'||automaticQueue)&&this.resultContinuationStopped.has(task.taskId))fail('COLLABORATION_STOPPED','本会话已停止自动协作，请显式继续对话');
    const stopVersion=this.stopVersions.get(task.taskId)??0;
    const controller=new AbortController();this.pendingLaunches.set(task.taskId,controller);
    const cancelStartup=()=>controller.abort(startup?.signal.reason);startup?.signal.addEventListener('abort',cancelStartup,{once:true});if(startup?.signal.aborted)cancelStartup();
    let loop:Awaited<ReturnType<typeof createWorkspaceLoop>>|undefined;
    let accepted=false,preparingScope=false,releaseBudget:(()=>void)|undefined;
    try{
      let preparedInput:Awaited<ReturnType<NonNullable<WorkspaceExecutionManager['prepareContinuationInput']>>>|undefined;
      if(continuation?.input.attachmentIds?.length){
        if(!this.prepareContinuationInput)fail('GOAL_ATTACHMENT_UNAVAILABLE','当前运行未装配附件补充，请保留原请求并使用支持的工作区入口');
        preparedInput=structuredClone(await this.prepareContinuationInput(structuredClone(continuation.input),controller.signal));controller.signal.throwIfAborted();
        assertContinuationAttachmentManifest(continuation.input,preparedInput.manifest);
        if(typeof preparedInput.message!=='string'||hash(preparedInput.message)!==preparedInput.manifest.expandedMessageHash||Buffer.byteLength(preparedInput.message,'utf8')!==preparedInput.manifest.expandedMessageBytes||source?.kind!=='user-continuation')fail('GOAL_ATTACHMENT_MANIFEST','附件正文与准备清单不一致，未消费等待');
        message=preparedInput.message;source={...source,attachmentManifestHash:hash(json(preparedInput.manifest))};
      }
      controller.signal.throwIfAborted();
      if((this.stopVersions.get(task.taskId)??0)!==stopVersion)fail('COLLABORATION_STOPPED','附件准备期间已收到停止请求');
      loop=await this.factory({...options,allowNativeExecution:options.permission?options.permission!=='read':options.allowNativeExecution,mode:task.mode,requestQuestion:(args,signal)=>this.questions.ask(task.taskId,args,signal),requestApproval:call=>this.approvalQueue.request(task.taskId,call),onEvent:event=>{for(const listener of this.listeners)try{listener(event)}catch{/* observers are not transactions */}}},structuredClone(task),{requestId:source?.kind==='member-results'?source.continuationId:randomUUID(),scopeId:admissionWait?.scopeId??human?.scopeId??continuation?.scopeId??recovery?.commandId??replan?.commandId,wait:admissionWait,signal:controller.signal,...(preparedInput?{preparedInputImages:preparedInput.images}:{})});
      controller.signal.throwIfAborted();
      if((this.stopVersions.get(task.taskId)??0)!==stopVersion)fail('COLLABORATION_STOPPED','启动期间已收到停止请求');
      if((source?.kind==='member-results'||automaticQueue)&&this.resultContinuationStopped.has(task.taskId))fail('COLLABORATION_STOPPED','本会话已停止自动协作，请显式继续对话');
      if(automaticQueue&&this.queueAdvanceStopped.has(task.taskId))fail('QUEUE_INSERT_UNKNOWN','旧队列插入或保存结果未确认，请先核实原运行记录，勿自动重发');
      if(!source&&!automaticQueue&&!fresh)this.resultContinuationStopped.delete(task.taskId);
      if(this.closing||(this.stopVersions.get(task.taskId)??0)!==stopVersion)fail('COLLABORATION_STOPPED','启动期间已收到停止请求');
      const run=fresh?await loop.runtime.startFreshMain(task,message,{signal:controller.signal,knownRunIds:()=>this.collaboration?.recoveryRunIds?.(task.taskId)??Promise.resolve([]),beforeRun:async context=>{
        controller.signal.throwIfAborted();
        releaseBudget=this.collaboration?.holdMain?.(context.runId);
        if(recovery){
          if(!this.collaboration?.acceptRecovery)fail('RECOVERY_UNAVAILABLE','当前工作区未装配新核实周期');
          await this.collaboration.acceptRecovery(recovery,task,{...context,signal:controller.signal});
        }else{
          if(!replan||!this.collaboration?.acceptReplan)fail('REPLAN_UNAVAILABLE','当前工作区未装配正式业务重规划');
          await this.collaboration.acceptReplan(replan,task,{...context,signal:controller.signal});
        }
        accepted=true;
        controller.signal.throwIfAborted();
        await (await this.queue()).pause(task.taskId,recovery?'已创建只读核实周期；原排队消息保留暂停，核实结束后可明确继续':'已创建新的业务目标；原排队消息保留暂停，目标结束后可明确继续');
        controller.signal.throwIfAborted();this.resultContinuationStopped.delete(task.taskId);
      }}):await loop.runtime.start(task,message,resume,source,{signal:controller.signal,beforeRun:async({runId}:{runId:string})=>{
        // Runtime 已取得全局及工作区租约；此刻才打开普通目标，容量拒绝不会留下假的失败周期。
        controller.signal.throwIfAborted();
        releaseBudget=this.collaboration?.holdMain?.(runId);
        preparingScope=true;
        await this.collaboration?.starting?.(task,options,source,message,runId);
        if(startup){controller.signal.throwIfAborted();await startup.prepare({task:structuredClone(task),runId,signal:controller.signal});controller.signal.throwIfAborted()}
        if(human){
          controller.signal.throwIfAborted();if(!this.collaboration?.acceptHumanContinuation)fail('HUMAN_CONTINUATION_UNAVAILABLE','当前工作区未装配人工决定接续');
          await this.collaboration.acceptHumanContinuation(human,task,runId,controller.signal);accepted=true;controller.signal.throwIfAborted();
          await (await this.queue()).pause(task.taskId,'已按保存的人工决定继续原目标；原排队消息保持暂停');controller.signal.throwIfAborted();this.resultContinuationStopped.delete(task.taskId);
        }
        if(continuation){
        controller.signal.throwIfAborted();
        if(!this.collaboration?.acceptContinuation)fail('GOAL_CONTINUATION_UNAVAILABLE','当前工作区未装配目标恢复');
        await this.collaboration.acceptContinuation(continuation,task,runId,{signal:controller.signal,...(preparedInput?{attachmentManifest:structuredClone(preparedInput.manifest)}:{})});accepted=true;
        controller.signal.throwIfAborted();
        await (await this.queue()).pause(task.taskId,'原目标已接收补充，后续消息仍暂停；目标结束后可继续队列');
        controller.signal.throwIfAborted();
        this.resultContinuationStopped.delete(task.taskId);
        }
      }});
      this.active.set(task.taskId,{runId:run.runId,isMain:task.mode==='chat'&&task.agentId===mainAgentId,loop});
      const runningLoop=loop;
      void run.done.catch(()=>undefined).then(async summary=>{
        this.cancelApprovals(task.taskId);
        try{await runningLoop.runtime.close()}catch{summary=undefined}
        releaseBudget?.();releaseBudget=undefined;
        if(this.active.get(task.taskId)?.runId===run.runId)this.active.delete(task.taskId);
        if(!this.closing)await this.serial(async()=>{
          try{this.collaboration?.settled(structuredClone(task),structuredClone(options),summary)}catch{await (await this.queue()).pause(task.taskId,'协作结算未能确认，请核实后继续');return}
          if(summary?.status==='completed')await this.pump(task.taskId);else await (await this.queue()).pause(task.taskId,'上一轮已停止或失败，请确认后继续队列');
        });
      }).catch(()=>{});
      return {workspaceId:task.workspaceId,taskId:task.taskId,runId:run.runId};
    }catch(error){try{await loop?.runtime.close()}finally{releaseBudget?.();releaseBudget=undefined}const code=(error as {code?:string})?.code;if(((!continuation&&!human&&!fresh)||accepted)&&(accepted||preparingScope||code!=='CAPACITY_WAITING'&&code!=='CAPACITY_BUSY'))await this.collaboration?.startFailed?.(task,source,error);throw error}
    finally{startup?.signal.removeEventListener('abort',cancelStartup);if(this.pendingLaunches.get(task.taskId)===controller)this.pendingLaunches.delete(task.taskId)}
  }
  /** 用户明确提交一个新只读核实目标；旧源记录不恢复，观察只是用户陈述，稳定请求先查已提交事实。 */
  async recoverExecution(raw:unknown){
    const request=recoveryRequestSchema.parse(raw);
    // 在排队之前捕获，不让“请求已进入队列但尚未开始预检”的停止被当成下一次用户授权。
    const requestedAtStopVersion=this.stopVersions.get(request.rootSessionId)??0;
    const assertRequested=()=>{if(this.closing||(this.stopVersions.get(request.rootSessionId)??0)!==requestedAtStopVersion)fail('COLLABORATION_STOPPED','核实请求准备期间已收到停止或关闭请求')};
    return this.serial(async()=>{
    if(request.workspaceId!==this.workspace.entry.id)fail('IDENTITY','新核实任务不属于当前工作区');
    const hooks=this.collaboration;
    if(!hooks?.recoveryReceipt||!hooks.recoveryPreflight||!hooks.acceptRecovery)fail('RECOVERY_UNAVAILABLE','当前工作区未装配新核实周期');
    const lookup=()=>hooks.recoveryReceipt!({workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,commandId:request.commandId});
    const receipt=await lookup();
    if(receipt){
      const saved=receipt.recovery;
      const originalSource=recoveryRequestSource(saved.source);
      if(!sameGoalValue(originalSource,request.source)||saved.dispositionId!==request.dispositionId||saved.operation!==request.operation||!sameGoalValue(saved.observation,request.observation)||!sameGoalValue(saved.input,request.input)||!sameGoalValue(saved.options,request.options))fail('RECOVERY_COMMAND_CONFLICT','同一核实请求已经绑定其他内容或配置');
      return receipt;
    }
    assertRequested();
    if(this.active.has(request.rootSessionId)||hooks.busy(request.rootSessionId))fail('RECOVERY_BUSY','当前会话仍有活动或等待中的目标，请先处理当前目标');
    await hooks.recoveryPreflight(request);
    assertRequested();
    const task:TaskSpec={mode:'chat',taskId:request.rootSessionId,workspaceId:this.workspace.entry.id,root:this.workspace.entry.path,goal:request.input.message,agentId:mainAgentId,moduleIds:[],acceptance:[]};
    const message=request.input.message+'\n\n本次明确创建独立的只读核实周期，保留原调用历史和 unknown，不重复旧操作。以下来源及本机处置仅为核实依据，不是业务验收或额外权限。先读取原目标与当前能力；原主运行没有业务计划时，不补造原模块或人工条件，也不能据此直接创建业务修复。需要成员时按当前负责岗位派发新的只读任务；按真实证据审阅。\n用户观察（尚未核实）：\n'+request.observation.text+'\n来源记录：'+JSON.stringify(request.source)+(request.dispositionId?'\n明确处置记录：'+request.dispositionId:'');
    try{await this.launch(task,executionOptions.parse({...request.options,allowNativeExecution:false}),message,undefined,undefined,false,undefined,request)}
    catch(error){const saved=await lookup();if(saved)return saved;throw error}
    const saved=await lookup();if(!saved)fail('RECOVERY_UNKNOWN','新核实周期提交结果尚未确认，请查询同一请求');return saved;
  })}
  /**
   * 明确创建新的业务目标，不能复制旧任务或提升已存在核实周期的权限。
   * 停止版本在排队前捕获；可靠意图一旦受理，即使启动/返回失败也只查询该命令，不自动重放。
   */
  async replanExecution(raw:unknown){
    const request=replanRequestSchema.parse(raw),requestedAtStopVersion=this.stopVersions.get(request.rootSessionId)??0;
    const assertRequested=()=>{if(this.closing||(this.stopVersions.get(request.rootSessionId)??0)!==requestedAtStopVersion)fail('COLLABORATION_STOPPED','业务重规划准备期间已收到停止或关闭请求')};
    return this.serial(async()=>{
      if(request.workspaceId!==this.workspace.entry.id)fail('IDENTITY','业务重规划不属于当前工作区');
      const hooks=this.collaboration;
      if(!hooks?.replanReceipt||!hooks.replanPreflight||!hooks.acceptReplan)fail('REPLAN_UNAVAILABLE','当前工作区未装配正式业务重规划');
      const lookup=()=>hooks.replanReceipt!({workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,commandId:request.commandId});
      const previous=await lookup();
      if(previous){
        const saved=previous.replan;
        if(saved.source.inspectionScopeId!==request.source.inspectionScopeId||saved.source.expectedBasis!==request.source.expectedBasis||saved.dispositionId!==request.dispositionId||!sameGoalValue(saved.input,request.input)||!sameGoalValue(saved.options,request.options))fail('REPLAN_COMMAND_CONFLICT','同一业务重规划命令已经绑定其他内容、证据或权限');
        return previous;
      }
      assertRequested();
      if(this.active.has(request.rootSessionId)||hooks.busy(request.rootSessionId))fail('REPLAN_BUSY','当前会话仍有未结束的目标，请先处理当前目标');
      await hooks.replanPreflight(request);assertRequested();
      const task:TaskSpec={mode:'chat',taskId:request.rootSessionId,workspaceId:this.workspace.entry.id,root:this.workspace.entry.path,goal:request.input.message,agentId:mainAgentId,moduleIds:[],acceptance:[]};
      const message=request.input.message+'\n\n本次明确创建新的业务重规划周期。先调用 cbim_goal_inspect 读取已核实模块范围与继承的人工验收约束，再匹配团队能力、保存新计划并派发新的执行任务。主 Agent 可直接执行未配置自定义负责岗位的模块；已配置岗位仍按真实绑定委派。旧核实是规划依据，不是新业务完成证据；不得复制旧工具操作、抹去旧未知结果或把权限选择当作人工验收。\n来源核实周期：'+request.source.inspectionScopeId;
      try{await this.launch(task,executionOptions.parse({...request.options,allowNativeExecution:true}),message,undefined,undefined,false,undefined,undefined,request)}
      catch(error){const saved=await lookup();if(saved)return saved;throw error}
      const saved=await lookup();if(!saved)fail('REPLAN_UNKNOWN','新业务周期提交结果尚未确认，请查询同一命令');return saved;
    });
  }
  /** 用户显式补充原等待目标；稳定请求只消费一次。回执只证明受理，不保证已启动、执行成功或人工验收。 */
  async continueGoal(raw:unknown){
    const request=goalContinuationRequestSchema.parse(raw);
    const requestedAtStopVersion=this.stopVersions.get(request.rootSessionId)??0;
    const assertRequested=()=>{if(this.closing||(this.stopVersions.get(request.rootSessionId)??0)!==requestedAtStopVersion)fail('COLLABORATION_STOPPED','补充目标准备期间已收到停止或关闭请求')};
    return this.serial(async()=>{
    if(request.workspaceId!==this.workspace.entry.id)fail('IDENTITY','目标补充不属于当前工作区');
    const hooks=this.collaboration;if(!hooks?.continuationReceipt||!hooks.continuationCheckpoint||!hooks.acceptContinuation)fail('GOAL_CONTINUATION_UNAVAILABLE','当前工作区未装配目标恢复');
    const lookup=()=>hooks.continuationReceipt!({workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,scopeId:request.scopeId,commandId:request.commandId});
    const previousReceipt=await lookup();
    if(previousReceipt){
      const saved=previousReceipt.continuation;
      if(saved.wait.waitId!==request.waitId||saved.wait.goalRevision!==request.expectedGoalRevision||saved.inputRevision!==request.expectedInputRevision+1||!sameGoalValue(saved.input,request.input)||!sameGoalValue(saved.options,request.options))fail('CONTINUATION_CONFLICT','同一补充标识已经绑定其他内容、版本或配置');
      return previousReceipt;
    }
    assertRequested();
    const wait=await hooks.continuationCheckpoint(request);
    const history=await this.thread(request.rootSessionId),prior=history.at(-1);
    assertRequested();
    if(!prior||prior.runId!==wait.runId||prior.task.mode!=='chat'||prior.status!=='completed'||prior.unresolvedTools.length||!prior.sessionFile)fail('CONTINUATION_NOT_READY','等待目标对应的主运行尚未安全结算或已有更新，请核实后继续');
    const source:RunInputSource={kind:'user-continuation',continuationId:request.commandId,scopeId:request.scopeId,waitId:request.waitId,inputRevision:request.expectedInputRevision+1};
    try{await this.launch(prior.task,executionOptions.parse({...request.options,allowNativeExecution:request.options.permission!=='read'}),request.input.message,{runId:prior.runId},source,false,request)}
    catch(error){const receipt=await lookup();if(receipt)return receipt;throw error}
    const receipt=await lookup();if(!receipt)fail('CONTINUATION_UNKNOWN','目标补充已尝试提交，但尚无法确认持久回执；请查询同一请求');return receipt;
  })}
  /** 专门处理已保存的人工决定；不接自由正文，系统转交与普通补充、排队消息严格分离。 */
  async continueFromHumanDecisions(raw:unknown){
    const parsed=humanContinuationRequestSchema.safeParse(raw);if(!parsed.success)fail('HUMAN_CONTINUATION_INPUT','人工决定接续参数无效');const request=parsed.data,version=this.stopVersions.get(request.rootSessionId)??0;
    const assertRequested=()=>{if(this.closing||(this.stopVersions.get(request.rootSessionId)??0)!==version)fail('COLLABORATION_STOPPED','人工接续准备期间已收到停止或关闭请求')};
    return this.serial(async()=>{
      if(request.workspaceId!==this.workspace.entry.id)fail('HUMAN_CONTINUATION_IDENTITY','人工接续不属于当前工作区');const hooks=this.collaboration;
      if(!hooks?.humanContinuationReceipt||!hooks.humanContinuationPreflight||!hooks.acceptHumanContinuation)fail('HUMAN_CONTINUATION_UNAVAILABLE','当前工作区未装配人工接续');
      const lookup=()=>hooks.humanContinuationReceipt!({workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,scopeId:request.scopeId,commandId:request.commandId}),existing=await lookup();
      if(existing){const saved=existing.continuation;if(saved.wait.waitId!==request.waitId||saved.wait.goalRevision!==request.expectedGoalRevision||saved.inputRevision!==request.expectedInputRevision+1||saved.decisionRevision!==request.expectedDecisionRevision||!sameGoalValue([...saved.decisionIds].sort(),[...request.decisionIds].sort())||!sameGoalValue(saved.options,request.options))fail('HUMAN_CONTINUATION_CONFLICT','此命令已绑定其他等待、决定或配置');return existing}
      assertRequested();const preflight=await hooks.humanContinuationPreflight(request),history=await this.thread(request.rootSessionId),prior=history.at(-1);assertRequested();
      if(!prior||prior.runId!==preflight.wait.runId||prior.task.mode!=='chat'||prior.status!=='completed'||prior.unresolvedTools.length||!prior.sessionFile)fail('HUMAN_CONTINUATION_NOT_READY','人工决定对应的主运行尚未完整结算或已有更新');
      const source:RunInputSource={kind:'human_decisions',continuationId:request.commandId,scopeId:request.scopeId,waitId:request.waitId,inputRevision:request.expectedInputRevision+1,decisionRevision:request.expectedDecisionRevision,decisionIds:[...request.decisionIds]};
      try{await this.launch(prior.task,executionOptions.parse({...request.options,allowNativeExecution:request.options.permission!=='read'}),preflight.message,{runId:prior.runId},source,false,undefined,undefined,undefined,undefined,request)}
      catch(error){const receipt=await lookup();if(receipt)return receipt;throw error}
      const receipt=await lookup();if(!receipt)fail('HUMAN_CONTINUATION_UNKNOWN','人工接续受理结果尚未确认，请查询原命令');return receipt;
    });
  }
  /** 安全普通对话可续聊；未知工具仅允许独立核实，旧裸 ID 字段不授予原 native 恢复许可。 */
  resume(taskId:string,runId:string,message:string,options:Options,reconciledToolIds:string[]=[]){return this.serial(async()=>{
    if(!message?.trim())fail('MESSAGE','恢复说明不能为空');
    const prior=await this.inspect(taskId,runId);
    if(prior.task.mode!=='chat')fail('OWNER_DISPATCH_REQUIRED','旧业务任务不能直接续执行，请按模块负责人重新派发；原历史保持不变');
    if(prior.unresolvedTools.length)fail('RECOVERY_INSPECTION_REQUIRED','原运行仍有未确认工具结果，请创建新的只读核实；调用 ID 确认不能恢复旧上下文');
    const history=await this.thread(taskId);if(history.at(-1)?.runId!==runId)fail('STALE_RUN','已有更新的对话轮次，请刷新后继续');
    const parsed=executionOptions.parse(options);
    if(prior.task.mode==='chat'&&this.collaboration?.busy(taskId)){
      if(reconciledToolIds.length)fail('COLLABORATION_BUSY','协作期间不能排队未决工具核实，请先停止并核实当前任务');
      const queue=await this.queue(),entry=await queue.add(taskId,message,parsed);
      if(this.collaboration?.waiting?.(taskId))await queue.pause(taskId,'当前目标等待用户补充，后续消息保留在队列');
      return {workspaceId:prior.task.workspaceId,taskId,runId,queued:true as const,queueId:entry.id};
    }
    if(prior.task.mode!=='chat'){
      if(!prior.task.workflowContext)fail('TASK_CONTEXT','旧任务缺少团队工作流上下文，请新建团队任务');
      if((await this.workspace.read()).revision!==prior.task.workflowContext.revision)fail('CONFLICT','知识版本已变化，请核对后创建新任务');
    }
    return this.launch(prior.task,parsed,message,{runId,reconciledToolIds});
  })}
  /** 可信协调器回注已核实的成员终态；来源只允许在同线程消费一次，不经过可编辑的用户队列。 */
  continueFromResults(taskId:string,message:string,options:Options,rawSource:RunInputSource,wait?:ExecutionAdmissionWait){return this.serial(async()=>{
    safeId(taskId);const source=checkedRunInputSource(rawSource);
    if(source.kind!=='member-results')fail('CONTINUATION_SOURCE','成员回注不能提交用户补充来源');
    if(!message.trim())fail('MESSAGE','成员结果内容不能为空');
    const history=await this.thread(taskId);
    const same=history.find(run=>run.source?.continuationId===source.continuationId);
    if(same){
      const equalSet=(a:string[],b:string[])=>a.length===b.length&&a.every(id=>b.includes(id));
      if(same.source?.kind!=='member-results'||!equalSet(same.source.messageIds,source.messageIds)||!equalSet(same.source.taskIds,source.taskIds)||same.events[0]?.data.message!==message)fail('CONTINUATION_CONFLICT','同一回传标识已经绑定其他成员结果或内容');
      return {workspaceId:same.task.workspaceId,taskId,runId:same.runId};
    }
    if(history.some(run=>run.source?.kind==='member-results'&&run.source.messageIds.some(id=>source.messageIds.includes(id))))fail('RESULT_ALREADY_CONSUMED','部分成员结果已进入本会话，不能换回传标识重复续跑');
    const prior=history.at(-1);
    if(!prior||prior.task.mode!=='chat'||prior.status!=='completed'||prior.unresolvedTools.length||!prior.sessionFile)fail('CONTINUATION_NOT_READY','主会话上轮未安全完成，请先核实后继续对话');
    return this.launch(prior.task,executionOptions.parse(options),message,{runId:prior.runId},source,false,undefined,undefined,undefined,wait);
  })}
  /** 协作批次结束后尝试原用户队列；不会解除用户停止或重启留下的暂停状态。 */
  collaborationReady(taskId:string){return this.serial(async()=>{safeId(taskId);await this.pump(taskId)})}
  /** 协作事实无法核实时立即建立停止屏障，再持久化队列暂停；拦住已进入串行事务但尚未启动的旧消息。 */
  pauseCollaboration(taskId:string,reason:string){safeId(taskId);this.resultContinuationStopped.add(taskId);this.cancelInsertions(taskId);return this.serial(async()=>{await (await this.queue()).pause(taskId,reason)})}
  async stop(taskId:string){
    safeId(taskId);this.stopVersions.set(taskId,(this.stopVersions.get(taskId)??0)+1);this.resultContinuationStopped.add(taskId);
    this.cancelInsertions(taskId);this.cancelApprovals(taskId);
    this.pendingLaunches.get(taskId)?.abort(Object.assign(Error('启动期间已收到停止请求'),{code:'COLLABORATION_STOPPED'}));
    // 不排在可能等待附件或 RPC 的插入事务之后；立即发停止，仍等待真实收尾并报告失败。
    const active=this.active.get(taskId),stopped=active?.loop.runtime.stop(taskId).then(()=>undefined,error=>error);
    let collaborationError:unknown;
    try{await this.collaboration?.stop(taskId)}catch(error){collaborationError=error}
    try{await this.serial(async()=>{await (await this.queue()).pause(taskId,'已暂停，请点击继续队列')})}
    finally{
      // 只收束停止开始时捕获的运行；当时未登记的启动已有 controller，不能补扫并停止后来显式新建的一轮。
      const error=await stopped;if(error)throw error;
    }
    if(collaborationError)throw collaborationError;
  }
  private directory(){return path.join(this.workspace.paths.project(this.workspace.entry.id),'loop-engine','tasks')}
  async inspect(taskId:string,runId:string){
    const active=this.active.get(taskId);
    const result=active?.runId===runId?await active.loop.runtime.inspect(taskId,runId):await this.storage.read(path.join(this.directory(),safeId(taskId),safeId(runId)));
    if(result.task.workspaceId!==this.workspace.entry.id||result.task.root!==this.workspace.entry.path||result.task.taskId!==taskId||result.runId!==runId)fail('IDENTITY','执行记录属于其他工作区、会话或运行');
    return result;
  }
  /** 历史从日志读取，重启后仍可查看；损坏日志返回错误，不伪装成完成。 */
  async list(){
    let tasks:string[];try{tasks=await this.storage.list(this.directory())}catch(e:any){if(e.code==='ENOENT')return [];throw e}
    const records=[];
    for(const taskId of tasks)for(const runId of await this.storage.list(path.join(this.directory(),safeId(taskId)))){
      try{const {events,...summary}=await this.inspect(taskId,runId);records.push({...summary,eventCount:events.length})}
      catch(e:any){records.push({taskId,runId,status:'unreadable' as const,error:e instanceof Error?e.message:String(e)})}
    }
    return records;
  }
  /** 禁止新任务，等待启动登记完成，然后停止并排空所有运行。 */
  async close(){
    this.closing=true;this.cancelPendingLaunches();this.cancelApprovals();
    const active=[...this.active.values()],closing=Promise.allSettled(active.map(x=>x.loop.runtime.close()));
    await this.pending;
    const results=[...await closing,...await Promise.allSettled([...this.active.values()].filter(x=>!active.includes(x)).map(x=>x.loop.runtime.close()))];
    this.active.clear();this.listeners.clear();for(const release of this.queueSubscriptions)release();this.queueSubscriptions.clear();
    const failure=results.find((result):result is PromiseRejectedResult=>result.status==='rejected');if(failure)throw failure.reason;
  }
}
