/**
 * 目录归属：backend/scheduler-engine/dispatch；任务派发与协作协调。

 * 新周期可冻结用户 auto 选择；缺 ownerSelection 时由统一执行身份解析核兜底，计划和派发回执保留原因。
 * 持久成员等待沿原 wait 冻结清单；重启不恢复执行，用户继续须通过 memberPauses 的当前资格核验。
 * 作用定位：工作区的成员注册、主对话实例绑定、主会话派发及任务图查询；重启仅保留通过完整核实的待回传周期，其余中断封存。
 * 设计原因：新派发按知识→模型→Store 锁序核当前岗位、能力及责任，保存原 Workflow 选择与不可变执行绑定，同命令不能改选。周期冻结输入及软限额，关闭封存待办；旧回执不能重开周期。
 * 职责边界：负责可靠入队、未启动撤销及受审计的前置追加/替换/多边修订，由独立 MemberExecutionManager 执行；调度维护不停止活动运行或复活旧实例。
 * 关闭边界：Auto 无计划的直接工作与知识治理、普通聊天和纯负责人控制面不强造团队计划；仍核活动输入和真实工具终态。已有计划或派发必须审阅，未知输入只可失败或取消封存。
 * 交接边界：检查点放弃独立核原历史，IO 后短事务取消旧待办，不要求今日岗位仍可执行，也不改原运行或恢复证明。
 * 查询边界：原主命令报告只读本工作区已初始化 Store 与 canonical；不借查询进入事务、打开工作区或重新判断旧命令的当前执行资格。
 * 影响边界：主/成员原调用观察、明确处置附录及后续核实/修复引用共用唯一 Store；观察端口不包含模型或 native 恢复能力。
 */
import {resolveExecutionModules} from '../context/automatic-context';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import {dispatchCommand} from '../goals/main-command-request';
import {CommandVerificationService} from '../evidence/command-verification-service';
import {EffectObservationService,type EffectObservationPorts} from '../evidence/effect-observation-service';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {Snapshot} from '../../core/knowledge/types';
import type {ConversationAgentBinding} from '../../core/execution/conversation-binding';
import type {DispatchStore,DispatchState,DispatchMessage} from '../../core/dispatch/dispatch-storage';
import {dispatchScopeInputSchema,type DispatchScope,type DispatchScopeOutcome,type DispatchScopeInput,type DispatchScopeGoal} from '../../core/tasks/dispatch-scope';
import type {AgentInstance} from '../../core/team/agent-types';
import type {TaskSpec} from '../../core/tasks/types';
import type {RunSummary} from '../../core/execution/types';
import {ScopeGoalService,type ScopeGoalPorts} from '../goals/scope-goal-service';
import {ScopeContinuationService} from '../goals/scope-continuation-service';
import {ScopeActiveInputService} from '../goals/scope-active-input-service';
import {ScopeRecoveryService} from '../goals/scope-recovery-service';
import {ScopeReplanService} from '../goals/scope-replan-service';
import {ScopeHumanDecisionService,type HumanDecisionPorts} from '../goals/scope-human-decision-service';
import {ScopeHumanContinuationService} from '../goals/scope-human-continuation-service';
import {QueuedTaskCancelService} from '../goals/queued-task-cancel-service';
import {QueuedDependencyReplacementService} from '../goals/queued-dependency-replacement-service';
import {QueuedDependencyAdditionService} from '../goals/queued-dependency-addition-service';
import {QueuedDependencyRevisionService} from '../goals/queued-dependency-revision-service';
import type {ReviseQueuedDependenciesInput,ReviseQueuedDependenciesReceipt} from '../../core/tasks/queued-dependency-revision';
import {CheckpointAbandonmentService} from '../members/checkpoint-abandonment-service';
import type {MemberCheckpointHistoryPorts} from '../members/member-checkpoint-verifier';
import {MemberPauseService,type MemberPausePorts} from '../members/member-pause-service';
import type {AbandonCheckpointInput,AbandonCheckpointReceipt} from '../../core/tasks/checkpoint-handoff';
import type {AddQueuedDependencyInput,AddQueuedDependencyReceipt} from '../../core/tasks/queued-dependency-addition';
import type {ReplaceQueuedDependencyInput,ReplaceQueuedDependencyReceipt} from '../../core/tasks/queued-dependency-replacement';
import {isMemberCheckpointPending} from '../../core/tasks/member-checkpoint';
import {ScopeUsageService} from '../budget/scope-usage-service';
import {ScopeBudgetService,rejectBudget,type ScopeBudgetRejected} from '../budget/scope-budget-service';
import type {ScopeBudgetPolicy} from '../../core/budget/scope-budget';
import type {CancelQueuedTasksInput,CancelQueuedTasksReceipt} from '../../core/tasks/queued-task-cancel';
import {openGraphInput,createMemberInput,dispatchTaskInput,graphIdentityInput} from '../../core/tasks/dispatch-commands';
import type {OpenGraphReceipt,CreateMemberReceipt,DispatchReceipt} from '../../core/tasks/dispatch-commands';
import type {GraphIdentity,GraphCursor,GraphSnapshot,GraphChange,GraphEventBatch,AgentGraphView,GraphEdge,TaskNode} from '../../core/tasks/graph-types';
import {resolveConversationAgent,resolveDispatchAgent,resolveDispatchModules} from '../context/dispatch-context';
import {prepareMember} from '../members/agent-manager';
import {dispatchSessionReadInput} from '../../core/tasks/scope-view';
import {createScopeRunTracking,appendScopeMainRun} from '../../core/tasks/scope-run-tracking';
import {OwnerExecutionService,type OwnerExecutionModelPorts,type OwnerExecutionWorkspace} from './owner-execution-service';
import {AutomaticReturnService} from './automatic-return-service';

/** 只需工作区状态与知识快照，不依赖桌面或具体文件存储。 */
type DispatchWorkspace=OwnerExecutionWorkspace;
const scopeIdentityInput=graphIdentityInput.extend({scopeId:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/)}).strict();

export class WorkspaceDispatchService {
  private closed=false;
  /** 目标计划与审阅复用派发事务；日志证据由应用只读端口注入，不从模型参数接受。 */
  readonly goals:ScopeGoalService;
  /** 只恢复有持久原批次和完整未消费结果的周期；不领取历史成员任务。 */
  readonly automaticReturns:AutomaticReturnService;
  /** 岗位执行发现与短事务门禁，复用唯一知识、模型和 Store，不另建登记。 */
  readonly owners:OwnerExecutionService;
  /** 可信用户补充的消费与只读回执；启动和停止屏障仍由运行管理器掌管。 */
  readonly continuations:ScopeContinuationService;
  /** 原运行插入的准备与接收，不创建新运行或修改原始输入。 */
  readonly activeInputs:ScopeActiveInputService;
  /** 已关闭周期的显式只读核实；创建新周期与原生上下文意图，不复活或重放来源。 */
  readonly recoveries:ScopeRecoveryService;
  /** 独立业务新周期；来源必须是完整完成的只读核实，不放宽 recoveries 的只读边界。 */
  readonly replans:ScopeReplanService;
  /** 原调用影响与本机处置；仅当前字节和新周期关联，不修改原 unknown。 */
  readonly effects:EffectObservationService;
  /** 本机显式人工决定只追加等待周期记录，不消费等待、修改候选或授予运行许可。 */
  readonly humanDecisions:ScopeHumanDecisionService;
  /** 按已保存决定独立消费等待；普通文本补充不进入此来源。 */
  readonly humanContinuations:ScopeHumanContinuationService;
  /** 指定周期的按需统计；复用 canonical 日志端口，不影响运行许可或修复历史。 */
  readonly usage:ScopeUsageService;
  /** 运行间软限额门禁；证明与归属同事务，公开统计不能代替本入口。 */
  readonly budgets:ScopeBudgetService;
  private readonly queuedCancellation:QueuedTaskCancelService;
  private readonly queuedDependencyReplacement:QueuedDependencyReplacementService;
  private readonly queuedDependencyAddition:QueuedDependencyAdditionService;
  private readonly queuedDependencyRevision:QueuedDependencyRevisionService;
  private readonly checkpointAbandonment:CheckpointAbandonmentService;
  private readonly commandVerification:CommandVerificationService;
  /** 重启只恢复等待占位；本服务仅在显式审阅或用户继续时核实原成员。 */
  readonly memberPauses:MemberPauseService;
  constructor(private readonly owner:DispatchWorkspace,private readonly store:DispatchStore,goalPorts?:ScopeGoalPorts,budgetPolicy?:()=>ScopeBudgetPolicy,humanPorts?:HumanDecisionPorts,modelPorts?:OwnerExecutionModelPorts,checkpointHistory?:MemberCheckpointHistoryPorts,effectPorts?:EffectObservationPorts,memberPausePorts?:MemberPausePorts){
    this.owners=new OwnerExecutionService(owner,store,modelPorts);
    this.memberPauses=new MemberPauseService(owner,store,this.owners,memberPausePorts);
    this.goals=new ScopeGoalService(owner,store,goalPorts,humanPorts,this.owners,this.memberPauses);
    this.automaticReturns=new AutomaticReturnService(owner,store,this.goals,goalPorts,modelPorts);
    this.usage=new ScopeUsageService(owner,store,goalPorts);
    this.budgets=new ScopeBudgetService(this.usage,budgetPolicy);
    this.continuations=new ScopeContinuationService(owner,store,this.budgets,this.memberPauses);
    this.activeInputs=new ScopeActiveInputService(owner,store);
    this.commandVerification=new CommandVerificationService(owner,store,goalPorts?.inspectMain?{inspectMain:goalPorts.inspectMain}:undefined);
    this.effects=new EffectObservationService(owner,store,this.commandVerification,effectPorts);
    this.recoveries=new ScopeRecoveryService(owner,store,goalPorts,this.budgets,this.effects);
    this.replans=new ScopeReplanService(owner,store,this.goals,goalPorts,this.budgets,this.effects);
    this.humanDecisions=new ScopeHumanDecisionService(owner,store,this.goals,goalPorts,humanPorts,()=>this.check(owner.entry.id));
    this.humanContinuations=new ScopeHumanContinuationService(owner,store,this.goals,goalPorts,humanPorts,this.budgets);
    this.queuedCancellation=new QueuedTaskCancelService(owner,store);
    this.queuedDependencyReplacement=new QueuedDependencyReplacementService(owner,store,this.goals,this.owners);
    this.queuedDependencyAddition=new QueuedDependencyAdditionService(owner,store,this.goals,this.owners);
    this.queuedDependencyRevision=new QueuedDependencyRevisionService(owner,store,this.goals,this.owners);
    this.checkpointAbandonment=new CheckpointAbandonmentService(owner,store,checkpointHistory);
  }

  /** 原任务与当前岗位观察分开返回，不刷新或领取旧待办。 */
  ownerInspect(raw:unknown){return this.owners.inspectTask(raw)}
  /** 仅读原 canonical 与已提交命令，不打开工作区、不重放，也不改变原未知或验收状态。 */
  commandReport(raw:unknown,signal?:AbortSignal){this.check(this.owner.entry.id);return this.commandVerification.read(raw,signal)}

  /** 主调度显式撤销未领取的完整依赖集合；不停止活动运行、不把撤销当作完成。 */
  cancelQueued(identity:GraphIdentity,scopeId:string,runId:string,commandId:string,input:CancelQueuedTasksInput):Promise<CancelQueuedTasksReceipt>{this.check(identity.workspaceId);return this.queuedCancellation.cancel(identity,scopeId,runId,commandId,input)}
  /** 主轮显式修订未启动前置；停止检查覆盖证据读取前后，成功只返回待跟踪集合，不启动执行。 */
  replaceQueuedDependency(identity:GraphIdentity,scopeId:string,runId:string,commandId:string,input:ReplaceQueuedDependencyInput,assertCurrent?:()=>void):Promise<ReplaceQueuedDependencyReceipt>{return this.queuedDependencyReplacement.replace(identity,scopeId,runId,commandId,input,()=>{this.check(identity.workspaceId);assertCurrent?.()})}
  /** 只加强尚未领取待办的前置门禁；后继闭包、知识和停止均在提交内复核，不启动成员。 */
  addQueuedDependency(identity:GraphIdentity,scopeId:string,runId:string,commandId:string,input:AddQueuedDependencyInput,assertCurrent?:()=>void):Promise<AddQueuedDependencyReceipt>{return this.queuedDependencyAddition.add(identity,scopeId,runId,commandId,input,()=>{this.check(identity.workspaceId);assertCurrent?.()})}
  /** 同一未领取目标原子增删多条前置；完整闭包重新核实，成功不创建运行或改原信封。 */
  reviseQueuedDependencies(identity:GraphIdentity,scopeId:string,runId:string,commandId:string,input:ReviseQueuedDependenciesInput,assertCurrent?:()=>void):Promise<ReviseQueuedDependenciesReceipt>{return this.queuedDependencyRevision.revise(identity,scopeId,runId,commandId,input,()=>{this.check(identity.workspaceId);assertCurrent?.()})}
  /** 原回执优先；只明确封存未消费检查点，新执行仍由岗位派发与领取门禁决定。 */
  abandonCheckpoint(identity:GraphIdentity,scopeId:string,runId:string,commandId:string,input:AbandonCheckpointInput,assertCurrent:()=>void):Promise<AbandonCheckpointReceipt>{return this.checkpointAbandonment.abandon(identity,scopeId,runId,commandId,input,()=>{this.check(identity.workspaceId);assertCurrent()})}
  /** 回包损坏或停止后仅查原命令；不启动历史核验或重复处置事务。 */
  checkpointAbandonmentReceipt(identity:GraphIdentity,scopeId:string,runId:string,commandId:string,input:AbandonCheckpointInput){return this.checkpointAbandonment.receipt(identity,scopeId,runId,commandId,input)}

  /** 工作区启动时恢复事务存储，触发存储观察者的基线；不创建成员、不消费任务。 */
  async initialize(){this.check(this.owner.entry.id);await this.store.read()}

  /**
   * 主用户任务开始时冻结本轮正文与附件身份；跨模型回合复用同一周期，不从旧 TaskSpec 推断本轮输入。
   * 第三/四参数缺省仅兼容旧调用；有真实runId时原子创建完整清单。同 scope 重发须保持输入及首轮身份，不能通过幂等回执绕过校验。
   */
  async openScope(identity:GraphIdentity,scopeId:string,rawInput?:DispatchScopeInput,trustedRunId?:string,options?:{collaborationMode?:'auto'|'team';profileId?:string;model:string}):Promise<DispatchScope>{
    const input=this.parse(scopeIdentityInput,{...identity,scopeId});this.check(input.workspaceId);
    // 在第一次 await 前校验并复制，调用者之后修改原对象不能改变正在保存的输入。
    const parsed=rawInput===undefined?undefined:this.parse(dispatchScopeInputSchema,rawInput);
    const goal:DispatchScopeGoal|undefined=parsed?{revision:1,input:{message:parsed.message,attachmentIds:[...(parsed.attachmentIds??[])]}}:undefined;
    const executionPolicy=options?await this.owners.policy(options):undefined;
    const runTracking=trustedRunId===undefined?undefined:createScopeRunTracking(trustedRunId);
    const verifyGoal=(scope:DispatchScope)=>{
      if(json(scope.executionPolicy)!==json(executionPolicy))fail('DISPATCH_SCOPE_MODE_CONFLICT','当前目标不能更换协作模式或兜底模型');
      if((scope.goal===undefined)!==(goal===undefined)||scope.goal?.input.message!==goal?.input.message||JSON.stringify(scope.goal?.input.attachmentIds)!==JSON.stringify(goal?.input.attachmentIds))fail('DISPATCH_SCOPE_INPUT_CONFLICT','同一调度周期不能重新绑定用户正文或附件');
      if((scope.runTracking===undefined)!==(runTracking===undefined)||scope.runTracking?.mainRunIds[0]!==runTracking?.mainRunIds[0])fail('DISPATCH_SCOPE_RUN_CONFLICT','同一周期不能重新绑定首个主运行');
    };
    await this.openGraph({...identity,commandId:'scope-root-'+hash(json(input))});
    // 命令键保持身份稳定，输入进入指纹；无 goal 的旧调用保留原指纹以读取历史回执。
    const command={...input,commandId:'scope-open-'+hash(json(input)),...(goal?{goal}:{}),...(runTracking?{runTracking}:{}),...(executionPolicy?{executionPolicy}:{})};
    await this.store.transact(this.command('scope.open',command),async state=>{
      this.check(input.workspaceId);this.graph(state,input.rootSessionId);
      const previous=state.scopes?.find(scope=>scope.scopeId===scopeId);
      if(previous){if(previous.rootSessionId!==input.rootSessionId)fail('DISPATCH_SCOPE_IDENTITY','调度周期属于其他主会话');verifyGoal(previous);if(previous.status==='waiting')fail('DISPATCH_SCOPE_WAITING','调度周期正在安全等待，必须通过显式补充入口继续');if(previous.status!=='active')fail('DISPATCH_SCOPE_CLOSED','调度周期已结束');return {receipt:previous}}
      if(state.scopes?.some(scope=>scope.rootSessionId===input.rootSessionId&&scope.status!=='closed'))fail('DISPATCH_SCOPE_BUSY','当前主会话还有未结束或等待中的用户任务周期');
      let scope:DispatchScope={...input,status:'active',createdAt:new Date().toISOString(),...(goal?{goal}:{}),...(runTracking?{runTracking}:{}),...(executionPolicy?{executionPolicy}:{})};
      if(trustedRunId)scope=this.budgets.initialize(scope,{kind:'main',taskId:input.rootSessionId,runId:trustedRunId});
      return {scopes:[scope],receipt:scope};
    });
    const scope=(await this.store.read()).scopes?.find(value=>value.scopeId===scopeId);
    if(!scope||scope.workspaceId!==input.workspaceId||scope.rootSessionId!==input.rootSessionId)fail('DISPATCH_SCOPE_IDENTITY','调度周期不属于当前主会话');
    verifyGoal(scope);
    if(scope.status==='waiting')fail('DISPATCH_SCOPE_WAITING','调度周期正在安全等待，必须通过显式补充入口继续');
    if(scope.status!=='active')fail('DISPATCH_SCOPE_CLOSED','调度周期已结束，不能重新打开');
    return scope;
  }

  /** beforeRun 同事务核实软限额并登记回注轮次；拒绝先保存 blocked 再抛错，旧周期不补造清单或策略。 */
  async registerMainRun(identity:GraphIdentity,scopeId:string,runId:string):Promise<DispatchScope>{
    const input=this.parse(scopeIdentityInput,{...identity,scopeId}),checked=createScopeRunTracking(runId).mainRunIds[0];this.check(input.workspaceId);
    const command={...input,runId:checked,commandId:'scope-main-'+hash(json({...input,runId:checked}))};
    const receipt=await this.store.transact<true|ScopeBudgetRejected>(this.command('scope.main',command),async state=>{
      this.check(input.workspaceId);const scope=state.scopes?.find(value=>value.scopeId===scopeId&&value.rootSessionId===input.rootSessionId);
      if(!scope)fail('DISPATCH_SCOPE_IDENTITY','主运行不属于当前目标周期');
      if(scope.runTracking?.mainRunIds.includes(checked))return {receipt:true};
      const admitted=await this.budgets.admit(state,scope,{kind:'main',taskId:input.rootSessionId,runId:checked});
      if(admitted.rejected)return {scopes:[admitted.scope],receipt:admitted.rejected};
      const next=appendScopeMainRun(admitted.scope,checked);return {scopes:next===scope?undefined:[next],receipt:true};
    });
    if(receipt!==true)rejectBudget(receipt);
    const scope=(await this.store.read()).scopes?.find(value=>value.scopeId===scopeId&&value.rootSessionId===input.rootSessionId);
    if(!scope)fail('DISPATCH_SCOPE_IDENTITY','主运行所属目标周期不可读');return scope;
  }

  /**
   * 必须先等待本周期成员终态；业务成功要求主运行摘要与显式审阅通过同事务复核，不允许取消未完任务后伪装成功。
   * 失败/取消可原子取消未执行任务并释放执行实例；mainSummary 只能由可信运行结算传入，不能由模型或公开 IPC 伪造。
   * 同周期重复关闭返回已保存结果；已关闭实例不可复活，未确认运行不能通过关闭隐藏。
   */
  async closeScope(identity:GraphIdentity,scopeId:string,outcome:DispatchScopeOutcome,mainSummary?:RunSummary):Promise<DispatchScope>{
    const input=this.parse(scopeIdentityInput.extend({outcome:z.enum(['completed','failed','cancelled','interrupted'])}),{...identity,scopeId,outcome});this.check(input.workspaceId);
    const command={...input,commandId:'scope-close-'+hash(json(input))};
    return this.store.transact(this.command('scope.close',command),async state=>{
      this.check(input.workspaceId);const graph=this.graph(state,input.rootSessionId),scope=state.scopes?.find(value=>value.scopeId===scopeId);
      if(!scope||scope.rootSessionId!==input.rootSessionId)fail('DISPATCH_SCOPE_IDENTITY','调度周期不属于当前主会话');
      if(scope.status==='closed')return {receipt:scope};
      // 即使尚未建业务计划，也不能把未知插入当成普通对话顺利结束。
      if(outcome==='completed')await this.goals.validateActiveInputs(scope,mainSummary);
      if(scope.status==='waiting'&&outcome==='completed')fail('GOAL_WAITING','等待周期不能跳过目标完成复核，请保留或显式停止');
      const tasks=graph.tasks.filter(task=>task.scopeId===scopeId),taskIds=new Set(tasks.map(task=>task.taskId));
      // 普通问答只关闭生命周期；一旦规划或派工，必须引用同周期主轮结束事实及显式审阅。
      // 在同一派发事务内复核，避免工具中申请完成后又出现新任务，提前释放成员。
      // Auto 的独立知识沉淀和精确责任登记不强造团队计划；模式只读持久周期，已有计划、派发和全部副作用时序仍须验收。
      const recordedWork=mainSummary?.toolReceipts?.some(receipt=>['cbim_goal_plan','cbim_goal_review','cbim_dispatch_task'].includes(receipt.toolName));
      if(outcome==='completed'&&scope.goal&&(scope.goal.plan||tasks.length||recordedWork)){
        if(!mainSummary)fail('GOAL_REVIEW_REQUIRED','业务任务需要主调度的结构化目标审阅，不能直接标为完成');
        await this.goals.validateCompletion(state,scope,mainSummary);
      }
      if(state.runs?.some(run=>taskIds.has(run.binding.taskId)&&['starting','running'].includes(run.status)))fail('DISPATCH_SCOPE_BUSY','调度周期仍有未结算运行，请先停止并等待成员结束');
      const now=new Date().toISOString(),changes:GraphChange[]=[],messages:DispatchMessage[]=[],members:AgentInstance[]=[];
      for(const task of tasks)if(isMemberCheckpointPending(task)||!task.runIds.length&&['planned','queued','waiting','blocked'].includes(task.status)){
        const cancelled:TaskNode={...task,status:'cancelled',revision:task.revision+1,updatedAt:now,waitReason:isMemberCheckpointPending(task)?'所属周期已结束，检查点与未领取的续执行预约已封存':'所属用户任务周期已结束，未启动任务已取消'};
        changes.push({type:'task.upserted',task:cancelled});
        for(const message of state.outbox)if(message.kind==='assignment'&&message.taskId===task.taskId&&message.delivery==='pending')messages.push({...message,delivery:'processed'});
      }
      for(const member of state.members)if(member.executionScopeId===scopeId){
        if(member.agentId==='cbim:main'||member.activeRunId)fail('DISPATCH_SCOPE_BUSY','周期成员仍有活动占用或身份不一致');
        const released:AgentInstance={...member,lifecycle:'released',releasedAt:now,leaseEpoch:member.leaseEpoch+1,activity:'idle',activeTaskId:undefined,activeRunId:undefined,waitingTaskIds:[],communicatingMessageIds:[]};
        members.push(released);
        const view=graph.agents.find(agent=>agent.agentInstanceId===member.agentInstanceId);
        if(view)changes.push({type:'agent.upserted',agent:{...view,revision:view.revision+1,state:'idle',runningTaskId:undefined,waitingTaskIds:[]}});
      }
      const closed:DispatchScope={...scope,status:'closed',closedAt:now,outcome};
      return {scopes:[closed],members,messages,batch:changes.length?this.batch(graph.identity,command.commandId,'agent.state_changed',changes,graph):undefined,receipt:closed};
    });
  }

  /**
   * 可信协调器在主运行释放占用后请求停泊；与当前审阅、图及成员终态一起核实并提交，不关闭或释放执行实例。
   * mainRunIds 来自本周期真实运行集合，仅用于冻结预算；模型和公开 IPC 不提供此接口。
   */
  async parkScope(identity:GraphIdentity,scopeId:string,rawSummary:RunSummary,rawMainRunIds:string[]):Promise<DispatchScope>{
    const input=this.parse(scopeIdentityInput,{...identity,scopeId});this.check(input.workspaceId);
    const summary=structuredClone(rawSummary),mainRunIds=structuredClone(rawMainRunIds);
    // 同周期可以多次显式补充后再等待；幂等键绑定真实主运行，避免第二个检查点撞上第一次的提交。
    const command={...input,runId:summary.runId,mainRunIds,commandId:'scope-wait-'+hash(json({...input,runId:summary.runId}))};
    await this.store.transact(this.command('scope.wait',command),async state=>{
      this.check(input.workspaceId);const scope=state.scopes?.find(value=>value.scopeId===scopeId&&value.rootSessionId===input.rootSessionId);
      if(!scope)fail('DISPATCH_SCOPE_IDENTITY','调度周期不属于当前主会话');
      if(scope.status!=='active')fail(scope.status==='waiting'?'DISPATCH_SCOPE_WAITING':'DISPATCH_SCOPE_CLOSED','当前周期不能建立新的等待检查点');
      await this.goals.validateWaiting(state,scope,summary,mainRunIds);
      const review=scope.goal!.review!;
      const parked:DispatchScope={...scope,status:'waiting',wait:{waitId:randomUUID(),reason:review.reason,createdAt:new Date().toISOString(),runId:summary.runId,goalRevision:scope.goal!.revision,graphCursor:{...review.graphCursor},knowledgeRevision:review.knowledgeRevision,mainRunIds:[...mainRunIds],...(review.memberPause?{memberPause:structuredClone(review.memberPause)}:{})}};
      return {scopes:[parked],receipt:parked};
    });
    // 去重回执可能早于后续停止；不把旧 waiting 快照作为已关闭周期的当前状态返回。
    const current=(await this.store.read()).scopes?.find(scope=>scope.scopeId===scopeId&&scope.rootSessionId===input.rootSessionId);
    if(!current||current.status!=='waiting')fail('DISPATCH_SCOPE_CLOSED','等待周期已经结束，不能重新停泊');
    return current;
  }

  /** 应用恢复时只登记已保存的等待槽；不读取模型上下文、重放消息或自动续跑。 */
  async waitingScopes():Promise<DispatchScope[]>{this.check(this.owner.entry.id);return (await this.store.read()).scopes?.filter(scope=>scope.status==='waiting')??[]}

  /** 重启先结算旧运行；仅保留可核实的已完成待回传批次，其他 active 封存，waiting 不自动消费。 */
  async recoverScopes():Promise<void>{
    this.check(this.owner.entry.id);const state=await this.store.read();
    for(const scope of state.scopes??[])if(scope.status==='active'){
      try{if(await this.automaticReturns.inspect(scope))continue}
      catch(error){if(scope.automaticReturns?.length)await this.goals.block({workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId},scope.scopeId,'自动接收暂停：'+(error instanceof Error?error.message:String(error)))}
      await this.closeScope({workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId},scope.scopeId,'interrupted');
    }
  }

  private check(workspaceId:string){
    if(this.closed)fail('DISPATCH_CLOSED','成员调度服务已关闭');
    this.owner.assert();
    if(workspaceId!==this.owner.entry.id)fail('GRAPH_IDENTITY_MISMATCH','派发目标不属于当前工作区');
  }
  private parse<S extends z.ZodTypeAny>(schema:S,input:unknown):z.output<S>{
    const parsed=schema.safeParse(input);
    if(!parsed.success)fail('GRAPH_INPUT_INVALID',parsed.error.issues.map(i=>i.message).join('；'));
    return parsed.data;
  }
  private graph(state:DispatchState,rootSessionId:string){
    const graph=state.graphs.find(g=>g.identity.rootSessionId===rootSessionId);
    if(!graph)fail('GRAPH_NOT_FOUND','主会话尚未建立任务图');
    return graph;
  }
  private command<T extends {commandId:string}>(operation:string,input:T){
    // 保留旧命令指纹的盐值以兼容已保存回执；此字段不是认证主体，真实来源由入口和运行工具回执核验。
    return dispatchCommand(operation,input);
  }
  private batch(identity:GraphIdentity,commandId:string,cause:GraphEventBatch['cause'],changes:GraphChange[],graph?:GraphSnapshot):GraphEventBatch{
    return {version:1,identity,streamId:graph?.cursor.streamId??randomUUID(),seq:(graph?.cursor.seq??0)+1,eventId:randomUUID(),commandId,cause,committedAt:new Date().toISOString(),changes};
  }
  private cursor(batch:GraphEventBatch):GraphCursor{return {...batch.identity,streamId:batch.streamId,seq:batch.seq}}
  /** 读取之后再次核验知识版本；外部知识编辑不能在派发准备时静默换入另一基线。 */
  private async recheck(snapshot:Snapshot){
    this.check(snapshot.workspaceId);
    if((await this.owner.read()).revision!==snapshot.revision)fail('KNOWLEDGE_REVISION_CONFLICT','知识在派发准备期间变化，请重新读取后派发');
  }

  /** 创建主会话根及主成员通道；相同图的新请求复用根，重发原命令返回原回执。 */
  async openGraph(raw:unknown):Promise<OpenGraphReceipt>{
    const input=this.parse(openGraphInput,raw);this.check(input.workspaceId);
    return this.store.transact(this.command('open',input),async state=>{
      this.check(input.workspaceId);
      const existing=state.graphs.find(g=>g.identity.rootSessionId===input.rootSessionId);
      if(existing)return {receipt:{agent:existing.root.agent,cursor:existing.cursor}};
      const snapshot=await this.owner.snapshot();
      const prepared=prepareMember(state,resolveConversationAgent(snapshot),input.rootSessionId);
      const identity={workspaceId:input.workspaceId,rootSessionId:input.rootSessionId};
      const batch=this.batch(identity,input.commandId,'graph.created',[
        {type:'root.upserted',root:{kind:'session-root',nodeId:'session:'+input.rootSessionId,identity,agent:prepared.agent,revision:1,createdAt:new Date().toISOString()}},
        {type:'agent.upserted',agent:{agentInstanceId:prepared.agent.agentInstanceId,agentId:prepared.agent.agentId,name:prepared.agent.name,revision:1,state:'idle',waitingTaskIds:[]}},
      ]);
      await this.recheck(snapshot);
      return {members:[prepared.member],sessions:[prepared.session],batch,receipt:{agent:prepared.agent,cursor:this.cursor(batch)}};
    });
  }

  /**
   * 为普通主对话可靠取得当前根会话的主实例。先保存图根，再保存独立 conversation 通道；稳定命令键让并发调用和重启复用同一身份。
   * 不创建业务任务、不改活动状态、不改绑旧根或原生历史；主对话原生位置仍由执行层核对同根 Loop 日志。
   */
  async conversationBinding(task:TaskSpec):Promise<ConversationAgentBinding>{
    if(task?.mode!=='chat'||task.agentId!=='cbim:main'||task.root!==this.owner.entry.path)fail('CONVERSATION_IDENTITY','主对话绑定必须属于当前工作区的 cbim:main 普通对话');
    const identity=this.parse(graphIdentityInput,{workspaceId:task.workspaceId,rootSessionId:task.taskId});
    this.check(identity.workspaceId);
    const key=hash(json(identity));
    await this.openGraph({...identity,commandId:'conversation-open-'+key});
    const input={...identity,commandId:'conversation-binding-'+key};
    return this.store.transact(this.command('conversation.bind',input),async state=>{
      this.check(identity.workspaceId);const graph=this.graph(state,identity.rootSessionId);
      const snapshot=await this.owner.snapshot();
      const prepared=prepareMember(state,resolveConversationAgent(snapshot),identity.rootSessionId,'conversation');
      if(graph.root.agent.agentId!==prepared.agent.agentId||graph.root.agent.agentInstanceId!==prepared.agent.agentInstanceId)fail('CONVERSATION_IDENTITY','主对话实例与任务图根不一致');
      await this.recheck(snapshot);
      const binding:ConversationAgentBinding={...identity,teamId:prepared.member.teamId,agentId:prepared.member.agentId,agentInstanceId:prepared.member.agentInstanceId,agentSessionId:prepared.session.agentSessionId};
      return {members:[prepared.member],sessions:[prepared.session],receipt:binding};
    });
  }

  /** 为已建图注册角色与会话；只返回本次成员，不暴露其其他根会话通道。 */
  async createMember(raw:unknown):Promise<CreateMemberReceipt>{
    const input=this.parse(createMemberInput,raw);this.check(input.workspaceId);
    return this.store.transact(this.command('member',input),async state=>{
      this.check(input.workspaceId);const graph=this.graph(state,input.rootSessionId);
      const snapshot=await this.owner.snapshot(),prepared=prepareMember(state,await resolveDispatchAgent(snapshot,input.agentId),input.rootSessionId);
      const old=graph.agents.find(a=>a.agentInstanceId===prepared.member.agentInstanceId);
      const view:AgentGraphView=old?{...old,name:prepared.agent.name,revision:old.revision+1}:{agentInstanceId:prepared.member.agentInstanceId,agentId:input.agentId,name:prepared.agent.name,revision:1,state:'idle',waitingTaskIds:[]};
      const changed=!old||old.name!==prepared.agent.name;
      const batch=changed?this.batch(graph.identity,input.commandId,'agent.state_changed',[{type:'agent.upserted',agent:view}],graph):undefined;
      await this.recheck(snapshot);
      // 注册回执仅公开本图 Session；全局成员状态仍留在后端。
      const member={...prepared.member,agentSessionIds:[prepared.session.agentSessionId],activity:view.state,activeTaskId:view.runningTaskId,activeRunId:undefined,waitingTaskIds:[...view.waitingTaskIds],communicatingMessageIds:[]};
      return {members:[prepared.member],sessions:[prepared.session],batch,receipt:{member,session:prepared.session,agent:prepared.agent,cursor:batch?this.cursor(batch):graph.cursor}};
    });
  }

  /** 可信桌面或绑定主轮的协调器从主会话派发任务；身份从根取得，不接受模型冒充其他成员递归派发。 */
  async dispatchTask(raw:unknown,trustedScopeId?:string,assertCurrent?:()=>void):Promise<DispatchReceipt>{
    const input=this.parse(dispatchTaskInput,raw),command=this.command('dispatch',trustedScopeId===undefined?input:{...input,scopeId:trustedScopeId});
    const old=await this.owners.replay<DispatchReceipt>(command);if(old)return old.receipt;this.check(input.workspaceId);
    const alive=()=>{this.check(input.workspaceId);assertCurrent?.()};alive();
    if(!trustedScopeId)fail('DISPATCH_SCOPE_REQUIRED','新业务派发必须属于已有主调度周期，请重新规划后派发');
    if(input.task.assigneeAgentId==='cbim:main')fail('AGENT_NOT_EXECUTABLE','主 Agent 请在当前会话直接执行，不创建独立成员任务');
    if(new Set(input.task.moduleIds).size!==input.task.moduleIds.length||new Set(input.task.acceptance.map(a=>a.id)).size!==input.task.acceptance.length||new Set(input.task.prerequisites.map(p=>p.taskId)).size!==input.task.prerequisites.length)fail('GRAPH_INPUT_INVALID','模块、验收条目和前置任务不能重复');
    return this.owners.withContext(state=>[this.owners.selection(state,trustedScopeId,input.task.ownerSelection)],context=>this.store.transact(command,async state=>{
      alive();
      this.check(input.workspaceId);const graph=this.graph(state,input.rootSessionId);
      if(state.scopes?.some(scope=>scope.rootSessionId===input.rootSessionId&&scope.status==='waiting'))fail('DISPATCH_SCOPE_WAITING','当前主会话正在安全等待，不能派发新任务');
      if(trustedScopeId!==undefined){
        const scope=state.scopes?.find(value=>value.scopeId===trustedScopeId);
        if(!scope||scope.rootSessionId!==input.rootSessionId)fail('DISPATCH_SCOPE_IDENTITY','任务调度周期不属于当前主会话');
        if(scope.status!=='active')fail('DISPATCH_SCOPE_CLOSED','调度周期已结束，不能继续派发');
        // 关闭需在一个不超过 1000 变更的图批次里取消任务并释放实例；每任务最多两条关闭变更。
        if(graph.tasks.filter(task=>task.scopeId===trustedScopeId).length>=500)fail('DISPATCH_SCOPE_LIMIT','本次用户任务已达到 500 个派发节点，请结束本周期后继续');
      }
      if(graph.root.revision!==input.expectedParentRevision)fail('GRAPH_REVISION_CONFLICT','主会话根版本已变化');
      const snapshot=context.snapshot,{ownerBinding,fallbackBinding}=await this.owners.resolveExecution(state,context,trustedScopeId,input.task.ownerSelection,input.task.moduleIds,input.task.assigneeAgentId);
      const registered=ownerBinding?state.workspaceMembers!.find(member=>member.memberId===ownerBinding.memberId):undefined;
      if(trustedScopeId!==undefined){
        const scope=state.scopes!.find(value=>value.scopeId===trustedScopeId)!;
        this.goals.validateDispatch(state,scope,input.task,snapshot.revision,ownerBinding,fallbackBinding);
      }
      const taskId=randomUUID();
      const prepared=prepareMember(state,await resolveDispatchAgent(snapshot,input.task.assigneeAgentId),input.rootSessionId,'task',trustedScopeId===undefined?undefined:{scopeId:trustedScopeId,taskId});
      if(registered)prepared.agent.name=registered.name;
      const modules=await resolveExecutionModules(snapshot,input.task.moduleIds,input.task.workflowSelections,fallbackBinding);
      const now=new Date().toISOString();
      const edges:GraphEdge[]=[{edgeId:randomUUID(),identity:graph.identity,kind:'dispatch',fromNodeId:graph.root.nodeId,toNodeId:'task:'+taskId,revision:1,enabled:true}];
      let waiting=false;
      for(const prerequisite of input.task.prerequisites){
        const source=graph.tasks.find(t=>t.taskId===prerequisite.taskId);
        if(!source)fail('GRAPH_REFERENCE_INVALID','前置任务不在当前主会话图中');
        if(source.planRevision!==prerequisite.expectedPlanRevision)fail('GRAPH_REVISION_CONFLICT','前置任务计划版本已变化');
        const ready=source.status==='result_ready'&&source.result?.planRevision===source.planRevision;
        if(!ready)waiting=true;
        edges.push({edgeId:randomUUID(),identity:graph.identity,kind:'dependency',fromNodeId:source.nodeId,toNodeId:'task:'+taskId,revision:1,enabled:true,condition:{kind:'result_ready',planRevision:source.planRevision,...(ready?{resultId:source.result!.resultId}:{})}});
      }
      const task:TaskNode={kind:'task',nodeId:'task:'+taskId,taskId,scopeId:trustedScopeId,identity:graph.identity,requester:graph.root.agent,assignee:prepared.agent,...(ownerBinding?{ownerBinding}:{}),...(fallbackBinding?{fallbackBinding}:{}),modules,...(input.task.workflowSelections?{workflowSelections:input.task.workflowSelections}:{}),goal:input.task.goal,acceptance:input.task.acceptance,revision:1,planRevision:1,status:waiting?'waiting':'queued',awaitedChildren:[],runIds:[],createdAt:now,updatedAt:now,...(waiting?{waitReason:'等待前置任务的有效结果'}:{})};
      const previous=graph.agents.find(a=>a.agentInstanceId===prepared.member.agentInstanceId);
      const waitingTaskIds=[...(previous?.waitingTaskIds??[]),...(waiting?[taskId]:[])];
      // 新派发不能覆盖成员正在其他任务中的占用；图只保留本图已经确认的活动任务。
      const localRunning=previous?.runningTaskId;
      const agent:AgentGraphView={agentInstanceId:prepared.member.agentInstanceId,agentId:prepared.member.agentId,name:prepared.agent.name,revision:(previous?.revision??0)+1,state:localRunning?'working':previous?.state==='communicating'?'communicating':waitingTaskIds.length?'waiting':'idle',runningTaskId:localRunning,waitingTaskIds};
      if(waiting){prepared.member.waitingTaskIds.push(taskId);if(!prepared.member.activeRunId)prepared.member.activity='waiting'}
      const batch=this.batch(graph.identity,input.commandId,'task.dispatched',[{type:'task.upserted',task},...edges.map(edge=>({type:'edge.upserted' as const,edge})),{type:'agent.upserted',agent}],graph);
      const messageId=randomUUID();
      await this.recheck(snapshot);
      alive();
      return {members:[prepared.member],sessions:[prepared.session],batch,messages:[{kind:'assignment',messageId,commandId:input.commandId,identity:graph.identity,from:graph.root.agent,to:prepared.agent,taskId,planRevision:1,createdAt:now,delivery:'pending'}],receipt:{commandId:input.commandId,taskId,messageId,cursor:this.cursor(batch),disposition:waiting?'waiting':'queued',...(fallbackBinding?{fallbackBinding}:{})}};
    }),alive);
  }

  /** 首次只读不会创建任务图；公开查询不包含成员其他 Session、邮箱和模型凭据。 */
  snapshot(raw:unknown){const identity=this.parse(graphIdentityInput,raw);this.check(identity.workspaceId);return this.store.snapshot(identity)}
  /** 无变化返回 noop，读取内存游标与已提交批次，不重复回读知识或整份日志。 */
  delta(raw:unknown,cursor?:GraphCursor,limit?:number){const identity=this.parse(graphIdentityInput,raw);this.check(identity.workspaceId);return this.store.delta(identity,cursor,limit)}
  /** 同屏读取图、独立周期摘要与选中详情；读取不启动调度，周期变化不使审阅保存的图游标过期。 */
  sessionRead(raw:unknown){const input=this.parse(dispatchSessionReadInput,raw);this.check(input.identity.workspaceId);return this.store.sessionRead(input)}
  /** 先阻止新请求，再等待已经入队的事务；由应用在释放工作区锁前调用。 */
  async close(){this.closed=true;await this.store.close()}
}
