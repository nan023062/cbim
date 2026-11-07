/**
 * 作用定位：让已派发任务在独立成员会话中执行，提交领取、启动、结果、中断及一次安全停泊/续执行事实。
 * 设计原因：全局准入及本地租约先同步领取，容量等待不创建 run 或 claim；Workflow 必需工具按真实能力先核，候选结算重读 canonical 条件。已释放实例、已关闭或安全等待的周期不能执行，占用持续到终态事务完成。
 * 职责边界：本成员 Loop 不递归派发或继承批准；求助在关闭后单向交接。检查点须完整关闭及复核后释放占用；主调度预约一次原任务新轮，失败、停止和重启不复活旧实例。只读报告不触发续执行，候选及匹配哈希不等于验收。
 */
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {LoopRuntime} from '../../core/brain/runtime';
import type {ResolvedLlm} from '../../core/brain/llm/ports';
import type {RunSummary,StoredEvent,ToolCall,ToolDecision,ChatPermission} from '../../core/brain/types';
import type {DispatchRun} from '../../core/tasks/dispatch-execution';
import type {DispatchStore,DispatchState,DispatchMessage} from '../../core/tasks/dispatch-storage';
import type {TaskNode} from '../../core/tasks/graph-types';
import {memberStartInput,memberTaskInput,memberMessageInput,memberAcknowledgeInput,type MemberStartOptions,type MemberStartReceipt,type MemberExecutionView} from '../../core/tasks/member-commands';
import {prepareDispatchExecutionContext,recheckDispatchExecutionContext} from '../context/execution-context';
import {ApprovalQueue} from '../conversation/approvals';
import {QuestionQueue} from '../conversation/questions';
import {memberTask,memberBatch,memberView,dependenciesReady,memberCandidate,memberHelpCandidate,hasMemberHelp} from './member-state';
import type {MemberHelpRecord} from '../../core/tasks/member-help';
import {memberEventsInput,type MemberEventsRead} from '../../core/tasks/member-events';
import {MemberEventStreams,memberPublicTask} from './member-events';
import {ExecutionReportService} from './execution-report-service';
import {ArtifactReportService,type ArtifactReportPorts} from './artifact-report-service';
import type {ArtifactReport} from '../../core/tasks/artifact-baseline';
import type {ExecutionReport} from '../../core/tasks/execution-report';
import type {ExecutionAdmissionWait} from './admission-wait';
import {rejectBudget,type ScopeBudgetService,type ScopeBudgetRejected} from './scope-budget-service';
import {verifyMemberCheckpointProof,type MemberCheckpointVerificationPorts} from './member-checkpoint-verifier';
import type {MemberCheckpointProof,MemberCheckpointRecord} from '../../core/tasks/member-checkpoint';
import {MemberResumeService} from './member-resume-service';
import type {ResumeMemberInput,ResumeMemberReceipt} from '../../core/tasks/queued-member-resume';
import {goalNeedsReplan} from '../../core/tasks/scope-goal';
import {preparedWorkflowContracts} from '../../core/tasks/execution-context';
import {validateMemberWorkflow} from './member-workflow';

/** 装配主进程提供模型与磁盘能力，调度层不解密密钥或导入平台实现。 */
export interface MemberExecutionPorts {
  /** 独立只读文件复核能力，不隐式采集旧日志或运行模型。 */
  artifacts?:Omit<ArtifactReportPorts,'inspect'>;
  /** 真实关闭后读取受管原生文件；只供检查点结算与一次续执行，不向模型提供任意路径端口。 */
  checkpoints?:Pick<MemberCheckpointVerificationPorts,'nativeFingerprint'>;
  /** 同一派发事务内读取 canonical 用量；拒绝事实先保存，绝不借查询接口发放许可。 */
  budgets?:ScopeBudgetService;
  /** 工作区装配代际仍有效；退役时先失效，即使管理器 close 尚在等待协调收尾也不得继续启动。 */
  isCurrent?():boolean;
  /** 装配退役立即中断原生启动窗口，不能只等待 manager.close 才停止尚未进入 active 的模型。 */
  signal?:AbortSignal;
  /** 同时领取工作区及明确执行实例的占用，阻止同实例重复启动；释放须晚于终态事务提交。 */
  acquire(key:string,permission:ChatPermission,agentInstanceId?:string,context?:{task:TaskNode;commandId:string;wait?:ExecutionAdmissionWait}):()=>void;
  /** 仅新命令解析一次模型；公开参数落盘，凭据只由 create 闭包持有，不进入图或日志。 */
  prepare(options:MemberStartOptions):Promise<{
    model:ResolvedLlm['profile'];
    /** 与本轮实际引擎注册参数一致的工具清单；仅能力预检，不能替代权限或批准。 */
    availableTools?:readonly string[];
    create(run:DispatchRun,task:TaskNode,hooks:{onEvent(event:StoredEvent):void;onEngineReady(input:{taskId:string;runId:string;sessionFile?:string}):Promise<void>;requestApproval(call:ToolCall):Promise<ToolDecision>;requestQuestion(args:unknown,signal:AbortSignal):Promise<unknown>}):Promise<LoopRuntime>;
  }>;
  /** 读取指定 run 的真实日志，校验通道安全续接；不得用最新运行或内存猜测替代。 */
  inspect(run:DispatchRun):Promise<RunSummary>;
}
type PreparedEngine=Awaited<ReturnType<MemberExecutionPorts['prepare']>>;
/** 一个业务任务当前的进程句柄；done 包含运行关闭和终态事务，失败时句柄保留以阻止再次领取。 */
type Handle={binding:DispatchRun['binding'];runtime?:LoopRuntime;stopping:boolean;isCurrent():boolean;controller:AbortController;done:Promise<void>};
const activeRun=(run:DispatchRun)=>run.status==='starting'||run.status==='running';

/** 每个活动工作区一个执行管理器，与派发服务共享 store；调用方须先关闭本管理器再关闭存储。 */
export class MemberExecutionManager {
  private closing=false;
  /** 恢复只执行一次；恢复失败保留拒绝态，须重建工作区实例核实，不能带着半次恢复启动新任务。 */
  private initialized?:Promise<void>;
  /** 按本工作区业务 taskId 索引，跨主会话身份另由存储检查；不使用原生会话 ID 作为键。 */
  private handles=new Map<string,Handle>();
  /** 仅保存已核实归属、尚在领取准备中的请求；停止先写内存屏障，不排在准备事务后面。 */
  private pendingStarts=new Map<string,{workspaceId:string;rootSessionId:string;stopping:boolean}>();
  /** 已进入领取流程但尚未返回启动回执的调用；close 先等待它们，避免遗漏刚登记的进程。 */
  private launches=new Set<Promise<MemberStartReceipt>>();
  private listeners=new Set<(event:StoredEvent)=>void>();
  private approvals=new ApprovalQueue();
  private questions=new QuestionQueue();
  private eventStreams:MemberEventStreams;
  constructor(private owner:KnowledgeWorkspace,private store:DispatchStore,private ports:MemberExecutionPorts){this.eventStreams=new MemberEventStreams(run=>ports.inspect(run))}
  /** 手动只读核实指定任务/轮次；不调用 initialize，不恢复、启动、确认消息或重写异常日志。 */
  async report(raw:unknown):Promise<ExecutionReport>{this.owner.assert();return new ExecutionReportService(this.owner,this.store,run=>this.ports.inspect(run)).read(raw)}
  /** 必须明确指定运行；不传 baselineId 时只列举，不能猜测最近一份或启动采集。 */
  async artifactReport(raw:unknown):Promise<ArtifactReport>{this.owner.assert();if(!this.ports.artifacts)fail('ARTIFACT_UNAVAILABLE','文件基线复核服务未装配');return new ArtifactReportService(this.owner,this.store,{...this.ports.artifacts,inspect:run=>this.ports.inspect(run)}).read(raw)}
  private checkpointPorts():MemberCheckpointVerificationPorts{if(!this.ports.artifacts||!this.ports.checkpoints)fail('MEMBER_CHECKPOINT_UNAVAILABLE','本工作区未装配成员检查点核实能力');return {...this.ports.artifacts,...this.ports.checkpoints,inspect:run=>this.ports.inspect(run)}}
  /** 当前主轮只预约，真正领取须在主轮结束后；不直接创建引擎或消费检查点。 */
  requestResume(identity:{workspaceId:string;rootSessionId:string},scopeId:string,mainRunId:string,commandId:string,input:ResumeMemberInput,assertCurrent:()=>void):Promise<ResumeMemberReceipt>{this.check(identity.workspaceId);return new MemberResumeService(this.owner,this.store,this.checkpointPorts()).request(identity,scopeId,mainRunId,commandId,input,assertCurrent)}
  private check(workspaceId:string){
    if(this.closing)fail('MEMBER_EXECUTION_CLOSED','成员执行服务正在关闭');
    this.owner.assert();if(workspaceId!==this.owner.entry.id)fail('GRAPH_IDENTITY_MISMATCH','成员任务不属于当前工作区');
  }
  private parse<S extends z.ZodTypeAny>(schema:S,input:unknown):z.output<S>{const result=schema.safeParse(input);if(!result.success)fail('MEMBER_INPUT_INVALID','成员执行参数无效：'+result.error.issues[0]?.path.join('.'));this.check(result.data.workspaceId);return result.data}
  private command(operation:string,input:{commandId:string}){return {commandId:input.commandId,fingerprint:hash(json({operation,actor:'desktop-local-user',input}))}}
  /** 观察已经落盘的大脑事实；回调失败不能阻止运行日志或扩大权限。 */
  subscribe(listener:(event:StoredEvent)=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener)}}
  private emit(event:StoredEvent){for(const listener of this.listeners)try{listener(structuredClone(event))}catch{/* 监控不参与事务 */}}

  /** 重启只将未结束的领取标为中断并增加租约代际，绝不自动调用模型或工具。 */
  initialize(){return this.initialized??=(async()=>{
    const state=await this.store.read();
    for(const run of state.runs??[])if(activeRun(run))await this.settle(run,undefined,'interrupted','应用关闭前未确认执行终态，请核实产物后重新派发',true);
  })()}

  /**
   * 领取前同事务核实软限额；在途等待不占名额，拒绝先保存独立预算事实且不创建运行。
   * 返回已提交的领取回执，不等待模型开始或任务结束；后续状态由 inspect/events 查询。
   * 重复 commandId 返回原回执，不重新解析模型、不重复启动进程；首次入口拒绝已有 run，检查点另走严格 resume 领取。
   */
  async start(raw:unknown,wait?:ExecutionAdmissionWait):Promise<MemberStartReceipt>{
    const input=this.parse(memberStartInput,raw);await this.initialize();this.check(input.workspaceId);
    const pending=this.startInternal(input,wait);this.launches.add(pending);
    try{return await pending}finally{this.launches.delete(pending)}
  }
  /** 专用续执行领取；不会放宽普通首次启动，等待准入时检查点与待领信封保持不消费。 */
  async resume(raw:unknown,wait:ExecutionAdmissionWait):Promise<MemberStartReceipt>{
    const input=this.parse(memberStartInput,raw);await this.initialize();this.check(input.workspaceId);
    const pending=this.startInternal(input,wait,true);this.launches.add(pending);
    try{return await pending}finally{this.launches.delete(pending)}
  }
  private async startInternal(input:z.infer<typeof memberStartInput>,wait?:ExecutionAdmissionWait,resuming=false):Promise<MemberStartReceipt>{
    let release:(()=>void)|undefined,launch:{run:DispatchRun;task:TaskNode;engine:PreparedEngine}|undefined;
    const pending={workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,stopping:false};
    const isCurrent=()=>!this.closing&&!pending.stopping&&!this.ports.signal?.aborted&&this.ports.isCurrent?.()!==false&&(!wait||wait.isCurrent());
    const assertCurrent=()=>{if(!isCurrent())fail('COLLABORATION_STOPPED','成员启动所属工作区或协作批次已停止')};
    try{
      const receipt=await this.store.transact<MemberStartReceipt|ScopeBudgetRejected>(this.command(resuming?'member.resume':'member.start',input),async state=>{
        this.check(input.workspaceId);
        const {graph,task,member,session}=memberTask(state,input.rootSessionId,input.taskId);
        if(state.scopes?.some(scope=>scope.rootSessionId===input.rootSessionId&&scope.status==='waiting'))fail('GOAL_WAITING','当前主会话目标处于安全等待，不能从历史任务启动执行');
        // 主实例只承担调度；即便旧图保留曾经的 self 任务，也不能再启动为业务执行者。
        if(member.agentId==='cbim:main')fail('AGENT_NOT_EXECUTABLE','主 Agent 不直接执行业务，请使用执行 Agent');
        if(member.lifecycle==='released')fail('MEMBER_RELEASED','执行实例已随调度周期释放，不能再次启动');
        if(task.scopeId&&!state.scopes?.some(scope=>scope.scopeId===task.scopeId&&scope.workspaceId===input.workspaceId&&scope.rootSessionId===input.rootSessionId&&scope.status==='active'))fail('DISPATCH_SCOPE_CLOSED','任务调度周期已结束，不能启动执行实例');
        if(state.scopes?.some(scope=>scope.scopeId===task.scopeId&&scope.recovery)&&input.options.permission!=='read')fail('RECOVERY_READONLY','只读核实周期的成员不能提升权限执行业务写入、知识写入或命令');
        if(task.revision!==input.expectedRevision)fail('GRAPH_REVISION_CONFLICT','任务版本已变化，请刷新后启动');
        if(task.activeRunId||!['queued','waiting'].includes(task.status)||(!resuming&&task.runIds.length))fail('TASK_NOT_STARTABLE','当前任务不能重新执行，请核实已有运行后重新派发');
        if(resuming&&(!task.resumeRequest||task.runIds.length!==1||task.checkpoints?.length!==1||task.help||task.result))fail('MEMBER_RESUME_NOT_ALLOWED','当前任务没有唯一尚未消费的续执行预约');
        if(!dependenciesReady(graph,task))fail('TASK_DEPENDENCY_PENDING','前置任务尚未提供当前版本的交付候选');
        if(member.activeRunId)fail('MEMBER_BUSY','该成员正在处理另一项任务');
        const assignment=state.outbox.find(m=>m.kind==='assignment'&&m.taskId===task.taskId&&m.identity.rootSessionId===input.rootSessionId&&m.delivery==='pending'&&!!m.resumeFrom===resuming);
        if(!assignment)fail('ASSIGNMENT_UNAVAILABLE','任务缺少可领取的派发信封');
        this.pendingStarts.set(task.taskId,pending);
        const previous=(state.runs??[]).filter(r=>r.binding.agentSessionId===session.agentSessionId).at(-1);
        if(resuming&&(!previous||!previous.checkpointProof||assignment.kind!=='assignment'||assignment.resumeFrom?.runId!==previous.binding.runId||assignment.resumeFrom.checkpointId!==previous.checkpointProof.checkpoint.checkpointId||assignment.messageId!==task.resumeRequest!.requestId||session.lastRunId!==previous.binding.runId))fail('MEMBER_RESUME_NOT_ALLOWED','续执行预约、检查点或原生通道已经失效');
        if(previous){
          if(previous.status!=='completed')fail('MEMBER_SESSION_REVIEW_REQUIRED','该成员通道上次运行未安全结束，请先核实；本阶段不自动续接异常通道');
          const summary=await this.ports.inspect(previous);
          if(summary.status!=='completed'||summary.unresolvedTools.length||!summary.sessionFile||json(summary.memberBinding)!==json(previous.binding)||summary.task.workspaceId!==input.workspaceId||summary.task.root!==this.owner.entry.path||summary.task.taskId!==previous.binding.taskId||summary.task.agentId!==previous.binding.agentId||summary.runId!==previous.binding.runId||summary.sessionFile!==previous.session.sessionFile)fail('MEMBER_SESSION_REVIEW_REQUIRED','成员通道历史未通过核实，不能自动续接');
        }
        // 等待只由仍活动的自动协作批次授权；公开手动启动缺少该回调，容量不足明确拒绝而不假排队。
        assertCurrent();
        if(wait&&wait.scopeId!==task.scopeId)fail('COLLABORATION_STOPPED','成员启动所属协作批次周期不匹配');
        const runId=randomUUID(),scope=state.scopes?.find(value=>value.scopeId===task.scopeId);
        if(resuming&&(!scope?.goal||scope.goal.revision!==task.resumeRequest!.goalRevision||scope.goal.review||scope.goal.blocked||goalNeedsReplan(scope.goal)))fail('MEMBER_RESUME_STALE','预约后的目标计划已变化，不能消费原续执行请求');
        const admitted=scope?await this.ports.budgets?.admit(state,scope,{kind:'member',taskId:task.taskId,runId}):undefined;
        assertCurrent();
        if(admitted?.rejected)return {scopes:[admitted.scope],receipt:admitted.rejected};
        const options:MemberStartOptions=resuming?{profileId:previous!.model.id,model:previous!.model.model,permission:previous!.permission,turnTimeoutMs:previous!.turnTimeoutMs}:input.options;
        release=this.ports.acquire(runId,options.permission,member.agentInstanceId,{task,commandId:input.commandId,wait});
        // 取得名额不代表后续 await 期间仍获准启动；停止不能等到 claim 后才生效。
        const prepared=await prepareDispatchExecutionContext(this.owner,task);assertCurrent();
        const engine=await this.ports.prepare(options);assertCurrent();
        const workflows=preparedWorkflowContracts(prepared);
        if(workflows.length){
          if(!engine.availableTools)fail('WORKFLOW_CAPABILITIES_UNAVAILABLE','本次引擎未提供可信工具能力清单，不能执行带约定的 Workflow');
          const missing=[...new Set(workflows.flatMap(binding=>binding.contract.delivery?.requiredToolEvidence.map(item=>item.toolName)??[]))].filter(name=>!engine.availableTools!.includes(name));
          if(missing.length)fail('WORKFLOW_TOOL_UNAVAILABLE','当前权限或引擎未提供 Workflow 必需工具：'+missing.join('、'));
        }
        if(member.configurationRevision!==prepared.knowledgeRevision)fail('DISPATCH_CONTEXT_CHANGED','成员配置版本已变化，请重新登记派发');
        const prerequisites=graph.edges.filter(edge=>edge.enabled&&edge.kind==='dependency'&&edge.toNodeId===task.nodeId).map(edge=>{
          const source=graph.tasks.find(t=>t.nodeId===edge.fromNodeId)!;
          return {taskId:source.taskId,planRevision:source.planRevision,result:structuredClone(source.result!)};
        });
        if(resuming){
          // 模型解析保留显式 undefined 可选项，磁盘 JSON 会省略它们；比较实际可持久化快照，不能把缺省字段当配置变化。
          if(!isDeepStrictEqual(JSON.parse(json(engine.model)),previous!.model))fail('MEMBER_RESUME_CHANGED','原模型配置已经变化，不能沿旧上下文续执行');
          if(!isDeepStrictEqual(prepared,previous!.prepared))fail('MEMBER_RESUME_CHANGED','原知识工作流已经变化，不能沿旧上下文续执行');
          if(!isDeepStrictEqual(prerequisites,previous!.prerequisites??[]))fail('MEMBER_RESUME_CHANGED','原前置候选已经变化，不能沿旧上下文续执行');
          await verifyMemberCheckpointProof(this.owner,task,previous!,this.checkpointPorts(),assertCurrent,previous!.checkpointProof);assertCurrent();
        }
        const leaseEpoch=member.leaseEpoch+(resuming?1:0);
        const run:DispatchRun={binding:{workspaceId:input.workspaceId,teamId:member.teamId,agentId:member.agentId,agentInstanceId:member.agentInstanceId,agentSessionId:session.agentSessionId,rootSessionId:input.rootSessionId,taskId:task.taskId,runId,leaseEpoch,planRevision:task.planRevision},assignmentMessageId:assignment.messageId,status:'starting',prepared:resuming?structuredClone(previous!.prepared):prepared,prerequisites,model:engine.model,permission:options.permission,turnTimeoutMs:options.turnTimeoutMs,session:{nativeSessionId:session.nativeSessionId??session.agentSessionId,...(previous?{sessionFile:previous.session.sessionFile}:{})},createdAt:new Date().toISOString(),...(resuming?{resumeFrom:{checkpointId:task.checkpoints![0].checkpointId,runId:previous!.binding.runId}}:{})};
        const updated={...task,status:'queued' as const,waitReason:undefined,revision:task.revision+1,activeRunId:runId,runIds:[...task.runIds,runId],updatedAt:run.createdAt};
        const occupied={...member,leaseEpoch,activity:'communicating' as const,activeTaskId:task.taskId,activeRunId:runId,waitingTaskIds:member.waitingTaskIds.filter(id=>id!==task.taskId),communicatingMessageIds:[assignment.messageId]};
        const dependencies=(resuming?[]:graph.edges.filter(edge=>edge.enabled&&edge.kind==='dependency'&&edge.toNodeId===task.nodeId)).map(edge=>{
          if(edge.kind!=='dependency')throw Error('invalid dependency');
          const source=graph.tasks.find(t=>t.nodeId===edge.fromNodeId)!;
          return {type:'edge.upserted' as const,edge:{...edge,revision:edge.revision+1,condition:{...edge.condition,resultId:source.result!.resultId}}};
        });
        const batch=memberBatch(graph,input.commandId,'message.accepted',[{type:'task.upserted',task:updated},{type:'agent.upserted',agent:memberView(graph,occupied,updated)},...dependencies]);
        await recheckDispatchExecutionContext(this.owner,prepared);this.check(input.workspaceId);assertCurrent();
        launch={run,task:updated,engine};
        return {scopes:admitted&&admitted.scope!==scope?[admitted.scope]:undefined,runs:[run],members:[occupied],messages:[{...assignment,delivery:'claimed' as const,claim:{runId,leaseEpoch}}],batch,receipt:{taskId:task.taskId,runId,cursor:{...graph.identity,streamId:batch.streamId,seq:batch.seq}}};
      });
      if('budgetRejected' in receipt)rejectBudget(receipt);
      if(launch){
        const {run,task,engine}=launch;
        // 磁盘提交本身不可撤回；若提交期间停止，保留真实意图但只结算取消，不创建大脑。
        const handle:Handle={binding:run.binding,stopping:!isCurrent(),isCurrent,controller:new AbortController(),done:Promise.resolve()};
        this.handles.set(task.taskId,handle);
        handle.done=this.execute(run,task,engine,handle,release!);
        // 结算失败保留活动占用并阻止后续任务；不能吞掉失败后伪装空闲。
        void handle.done.catch(()=>{});release=undefined;
      }
      return receipt;
    }finally{if(this.pendingStarts.get(input.taskId)===pending)this.pendingStarts.delete(input.taskId);release?.()}
  }
  private async execute(run:DispatchRun,task:TaskNode,engine:PreparedEngine,handle:Handle,release:()=>void){
    let summary:RunSummary|undefined,error:string|undefined;
    const retired=()=>{handle.stopping=true;handle.controller.abort(Error('工作区执行代际已退役'))};
    this.ports.signal?.addEventListener('abort',retired,{once:true});if(this.ports.signal?.aborted)retired();
    const spec=memberPublicTask(task,this.owner.entry.path);this.eventStreams.begin(run,spec);
    try{
      if(handle.stopping||!handle.isCurrent()){handle.stopping=true;await this.settle(run,undefined,'cancelled');return}
      await recheckDispatchExecutionContext(this.owner,run.prepared);
      if(handle.stopping||!handle.isCurrent()){handle.stopping=true;await this.settle(run,undefined,'cancelled');return}
      handle.runtime=await engine.create(run,task,{
        onEvent:event=>{this.eventStreams.append(run,spec,event);this.emit(event)},onEngineReady:input=>this.ready(run,input.sessionFile),
        requestApproval:call=>this.approvals.request(task.taskId,call),requestQuestion:(args,signal)=>this.questions.ask(task.taskId,args,signal),
      });
      if(handle.stopping||!handle.isCurrent()){handle.stopping=true;await this.settle(run,undefined,'cancelled');return}
      const previous=run.resumeFrom?(await this.store.read()).runs?.find(old=>old.binding.runId===run.resumeFrom!.runId):undefined;
      if(run.resumeFrom&&!previous?.checkpointProof)fail('MEMBER_CHECKPOINT_INVALID','续执行原检查点证明丢失');
      const started=run.resumeFrom?await handle.runtime.resumeMember(spec,'继续原任务；原检查点不是交付证据。本轮只允许新验证产生交付，请先读取当前任务计划。\n'+task.goal,{binding:run.binding,session:run.session},{...run.resumeFrom,logHash:previous!.checkpointProof!.logHash},{signal:handle.controller.signal}):await handle.runtime.startMember(spec,task.goal,{binding:run.binding,session:run.session},{signal:handle.controller.signal});
      if(handle.stopping)await handle.runtime.stop(task.taskId);
      summary=await started.done;
    }catch{error='成员执行未能正常结束，请检查该运行日志并核实产物'}
    finally{
      this.ports.signal?.removeEventListener('abort',retired);
      this.approvals.cancel(task.taskId);this.questions.cancel(task.taskId);
      try{await handle.runtime?.close()}catch{error='成员进程未能正常关闭，请核实运行日志';summary=undefined}
      try{
        if(summary||error)await this.settle(run,summary,summary&&handle.stopping&&hasMemberHelp(summary)?'cancelled':summary?.status==='running'?'interrupted':summary?.status??'interrupted',error);
        this.handles.delete(task.taskId);release();
      }catch{
        // 保留占用直到应用关闭；下一次启动从持久化的 starting/running 恢复为 interrupted。
        fail('MEMBER_SETTLEMENT_FAILED','成员执行结束但状态提交失败，请关闭并重新打开应用后核实任务');
      }
    }
  }
  /** 引擎已建立原生会话，但尚未生成；提交失败向上传播，由大脑关闭引擎并保留中断证据。 */
  private async ready(original:DispatchRun,sessionFile?:string){
    if(!sessionFile)fail('MEMBER_SESSION_INVALID','引擎没有提供可核实的原生会话');
    const command={commandId:'ready-'+original.binding.runId,fingerprint:hash(json({binding:original.binding,sessionFile}))};
    await this.store.transact(command,async state=>{
      const run=this.currentRun(state,original),{graph,task,member,session}=memberTask(state,run.binding.rootSessionId,run.binding.taskId);
      await recheckDispatchExecutionContext(this.owner,run.prepared);
      const now=new Date().toISOString(),updated={...task,status:'running' as const,revision:task.revision+1,updatedAt:now},occupied={...member,activity:'working' as const,communicatingMessageIds:[]};
      return {runs:[{...run,status:'running',startedAt:now,session:{...run.session,sessionFile}}],members:[occupied],sessions:[{...session,nativeSessionId:run.session.nativeSessionId,lastTaskId:task.taskId,lastRunId:run.binding.runId}],batch:memberBatch(graph,command.commandId,'task.started',[{type:'task.upserted',task:updated},{type:'agent.upserted',agent:memberView(graph,occupied,updated)}]),receipt:true};
    });
  }
  /** 运行与租约都必须匹配；旧进程的迟到完成不能覆盖新成员占用。 */
  private currentRun(state:DispatchState,original:DispatchRun){
    const run=state.runs?.find(r=>r.binding.runId===original.binding.runId);
    const member=state.members.find(m=>m.agentInstanceId===original.binding.agentInstanceId);
    if(!run||!activeRun(run)||member?.activeRunId!==run.binding.runId||member.leaseEpoch!==run.binding.leaseEpoch)fail('STALE_MEMBER_RUN','成员执行租约已失效');
    return run;
  }
  /** 同一事务结算运行、任务、成员占用和信封；求助/检查点重读 canonical，检查点还核文件与已关闭原生历史，重启只登记中断。 */
  private async settle(original:DispatchRun,summary:RunSummary|undefined,status:Exclude<DispatchRun['status'],'starting'|'running'>,error?:string,recovery=false){
    const command={commandId:(recovery?'recover-':'settle-')+original.binding.runId,fingerprint:hash(json({binding:original.binding,status,recovery}))};
    await this.store.transact(command,async state=>{
      const run=this.currentRun(state,original),{graph,task,member,session}=memberTask(state,run.binding.rootSessionId,run.binding.taskId);
      if(summary&&(json(summary.memberBinding)!==json(run.binding)||summary.task.taskId!==task.taskId||summary.runId!==run.binding.runId))fail('MEMBER_RUN_MISMATCH','执行摘要身份不一致');
      let result=status==='completed'&&summary?memberCandidate(task,summary):undefined,help:MemberHelpRecord|undefined,checkpoint:MemberCheckpointRecord|undefined,checkpointProof:MemberCheckpointProof|undefined;
      if(result&&preparedWorkflowContracts(run.prepared).length)try{const canonical=await this.ports.inspect(run);validateMemberWorkflow(task,run,canonical,this.owner.entry.path);result=memberCandidate(task,canonical)}catch(problem){result=undefined;error='Workflow 交付条件未通过可信运行核实：'+(problem instanceof Error?problem.message:String(problem))}
      if(!recovery&&status==='completed'&&summary?.events.some(event=>event.type==='task.checkpoint_requested')){
        result=undefined;
        try{
          if(task.checkpoints?.length||run.resumeFrom||!task.scopeId||!state.scopes?.some(scope=>scope.scopeId===task.scopeId&&scope.status==='active'))fail('MEMBER_CHECKPOINT_LIMIT','每任务仅支持一次检查点与一次续执行');
          checkpointProof=await verifyMemberCheckpointProof(this.owner,task,run,this.checkpointPorts(),()=>{if(this.handles.get(task.taskId)?.stopping||this.ports.isCurrent?.()===false||this.ports.signal?.aborted)fail('COLLABORATION_STOPPED','检查点交接已停止')});
          checkpoint=checkpointProof.checkpoint;
        }catch{error='成员检查点未通过完整日志、文件、知识或原生上下文核实，不能续执行'}
      }
      if(!recovery&&status==='completed'&&summary&&hasMemberHelp(summary)){
        try{help=memberHelpCandidate(task,run,await this.ports.inspect(run))}catch{error='求助记录未通过完整运行、授权回执和工具结束检查，请核实后重新安排任务'}
        if(!help)error??='求助缺少可核实的完整记录，请核实后重新安排任务';
      }
      if(result)try{await recheckDispatchExecutionContext(this.owner,run.prepared)}catch{result=undefined;error='执行期间知识基线变化，交付候选需要重新核实'}
      // canonical 重读期间用户仍可能停止；在没有进一步 await 的提交准备末端再次核对，不能发布迟到安全交接。
      if((help||checkpoint)&&this.handles.get(task.taskId)?.stopping){help=undefined;checkpoint=undefined;checkpointProof=undefined;status='cancelled';error='用户停止了本次运行'}
      const now=new Date().toISOString(),taskStatus=checkpoint?'checkpointed' as const:result?'result_ready' as const:status==='completed'?'blocked' as const:status;
      const updated:TaskNode={...task,revision:task.revision+1,status:taskStatus,activeRunId:undefined,result,help,...(checkpoint?{checkpoints:[checkpoint]}:{}),updatedAt:now,waitReason:checkpoint?'成员已安全停泊，等待主调度决定是否沿原任务续执行一次':result?undefined:help?'本轮执行结束，待主调度新安排：'+help.input.reason:error??(status==='completed'?'本轮未提交与派发目标一致的有效计划和交付证据':status==='cancelled'?'用户停止了本次运行':'执行未正常结束，请核实产物')};
      const waitingTaskIds=member.waitingTaskIds.filter(id=>id!==task.taskId);
      const released={...member,leaseEpoch:member.leaseEpoch+(recovery?1:0),activity:waitingTaskIds.length?'waiting' as const:'idle' as const,activeTaskId:undefined,activeRunId:undefined,waitingTaskIds,communicatingMessageIds:[]};
      const assignment=state.outbox.find(m=>m.messageId===run.assignmentMessageId)!;
      const messages:DispatchMessage[]=[{...assignment,delivery:'processed'}];
      if(result)messages.push({kind:'result',messageId:randomUUID(),commandId:command.commandId,identity:graph.identity,from:task.assignee,to:task.requester,taskId:task.taskId,planRevision:task.planRevision,createdAt:now,delivery:'pending',replyTo:assignment.messageId,resultId:result.resultId,runId:run.binding.runId});
      if(help)messages.push({kind:'help',messageId:randomUUID(),commandId:command.commandId,identity:graph.identity,from:task.assignee,to:task.requester,taskId:task.taskId,planRevision:task.planRevision,createdAt:now,delivery:'pending',replyTo:assignment.messageId,helpId:help.helpId,runId:run.binding.runId});
      if(checkpoint)messages.push({kind:'checkpoint',messageId:randomUUID(),commandId:command.commandId,identity:graph.identity,from:task.assignee,to:task.requester,taskId:task.taskId,planRevision:task.planRevision,createdAt:now,delivery:'pending',replyTo:assignment.messageId,checkpointId:checkpoint.checkpointId,runId:run.binding.runId});
      return {runs:[{...run,status,settledAt:now,error:updated.waitReason,...(checkpointProof?{checkpointProof}:{})}],members:[released],sessions:[{...session,lastTaskId:task.taskId,lastRunId:run.binding.runId}],messages,batch:memberBatch(graph,command.commandId,('task.'+taskStatus) as 'task.blocked',[{type:'task.upserted',task:updated},{type:'agent.upserted',agent:memberView(graph,released,updated)}]),receipt:true};
    });
  }
  /** 停止请求不直接宣称 cancelled；真实引擎收尾后才提交终态。 */
  async stop(raw:unknown){
    const input=this.parse(memberTaskInput,raw),handle=this.handles.get(input.taskId);
    if(!handle){
      const pending=this.pendingStarts.get(input.taskId);
      if(pending){
        if(pending.workspaceId!==input.workspaceId||pending.rootSessionId!==input.rootSessionId)fail('TASK_NOT_FOUND','当前主会话没有此派发任务');
        pending.stopping=true;return {requested:true};
      }
      memberTask(await this.store.read(),input.rootSessionId,input.taskId);return {requested:false};
    }
    // 活动绑定已由领取事务冻结；先验证本请求再标记停止，避免被正在重读 canonical 的结算事务挡住。
    if(handle.binding.workspaceId!==input.workspaceId||handle.binding.rootSessionId!==input.rootSessionId)fail('TASK_NOT_FOUND','当前主会话没有此派发任务');
    handle.stopping=true;handle.controller.abort(Error('用户停止了本次成员运行'));const stopping=handle.runtime?.stop(input.taskId);this.approvals.cancel(input.taskId);this.questions.cancel(input.taskId);await stopping;return {requested:true};
  }
  /** 内部协调端等待进程关闭、终态提交及占用释放；不触发启动或重放，结算异常向调用方保留。 */
  async waitForSettlement(raw:unknown){
    const input=this.parse(memberTaskInput,raw);memberTask(await this.store.read(),input.rootSessionId,input.taskId);
    await this.handles.get(input.taskId)?.done;
  }
  /** 读取本图指定任务和安全运行摘要，不暴露内部模型凭据或会话文件。 */
  async inspect(raw:unknown):Promise<MemberExecutionView>{
    const input=this.parse(memberTaskInput,raw),state=await this.store.read(),{task}=memberTask(state,input.rootSessionId,input.taskId);
    return {task,runs:(state.runs??[]).filter(r=>r.binding.taskId===task.taskId&&r.binding.rootSessionId===input.rootSessionId&&r.binding.workspaceId===input.workspaceId).map(r=>({binding:r.binding,status:r.status,permission:r.permission,model:r.model.model,createdAt:r.createdAt,startedAt:r.startedAt,settledAt:r.settledAt,error:r.error}))};
  }
  /** 只读取已派发任务的指定轮次；图身份、run 归属和游标一致后才访问缓存或日志。 */
  async events(raw:unknown):Promise<MemberEventsRead>{
    const input=this.parse(memberEventsInput,raw),state=await this.store.read(),{task}=memberTask(state,input.rootSessionId,input.taskId);
    const run=state.runs?.find(run=>run.binding.runId===input.runId&&run.binding.taskId===input.taskId&&run.binding.rootSessionId===input.rootSessionId&&run.binding.workspaceId===input.workspaceId);
    if(!run||!task.runIds.includes(input.runId))fail('MEMBER_RUN_NOT_FOUND','当前任务没有此成员运行');
    if(input.cursor&&input.cursor.runId!==input.runId)fail('MEMBER_EVENT_IDENTITY_MISMATCH','事件游标属于其他成员运行');
    const result=await this.eventStreams.read(run,memberPublicTask(task,this.owner.entry.path),input.cursor,input.limit);this.check(input.workspaceId);return result;
  }
  /** 返回当前收件人的待处理信封；结果或求助正文通过同图 task.result/task.help 获取。 */
  async messages(raw:unknown){const input=this.parse(memberMessageInput,raw),state=await this.store.read();this.assertRecipient(state,input.rootSessionId,input.agentSessionId);return state.outbox.filter(m=>m.identity.rootSessionId===input.rootSessionId&&m.to.agentSessionId===input.agentSessionId&&m.delivery==='pending')}
  private assertRecipient(state:DispatchState,rootSessionId:string,agentSessionId:string){if(!state.sessions.some(s=>s.agentSessionId===agentSessionId&&s.rootSessionId===rootSessionId))fail('MESSAGE_RECIPIENT_INVALID','收件人不属于当前主会话')}
  /** 显式收件确认只消费 result/help，不领取任务、不恢复旧成员，也不签发业务验收或用户批准。 */
  async acknowledge(raw:unknown){const input=this.parse(memberAcknowledgeInput,raw);return this.store.transact(this.command('member.ack',input),async state=>{
    this.assertRecipient(state,input.rootSessionId,input.agentSessionId);
    const message=state.outbox.find(m=>m.messageId===input.messageId&&m.identity.rootSessionId===input.rootSessionId&&m.to.agentSessionId===input.agentSessionId);
    if(!message||message.kind==='assignment')fail('MESSAGE_NOT_FOUND','当前收件人没有此结果或求助信封');
    return {messages:message.delivery==='processed'?[]:[{...message,delivery:'processed' as const}],receipt:{messageId:message.messageId,delivery:'processed' as const}};
  })}
  private async interaction(raw:unknown){const input=this.parse(memberTaskInput,raw);memberTask(await this.store.read(),input.rootSessionId,input.taskId);return input.taskId}
  /** 工具请求只归当前任务；调用方须展示具体参数，读取本身不授权。 */
  async pendingApprovals(raw:unknown){return this.approvals.list(await this.interaction(raw))}
  /** 可信用户决定仅作用于该任务当前运行；过期或其他任务的审批拒绝。 */
  async answerApproval(raw:unknown,id:string,allow:boolean,allowAll=false){return this.approvals.answer(await this.interaction(raw),id,allow,allowAll)}
  /** 返回尚未提交答案的问题，停止会清除等待。 */
  async pendingQuestions(raw:unknown){return this.questions.list(await this.interaction(raw))}
  /** 答案按问题结构一次性校验和消费；不能因此提升工具权限。 */
  async answerQuestion(raw:unknown,id:string,answers:unknown){return this.questions.answer(await this.interaction(raw),id,answers)}
  /**
   * 拒绝新请求，等待已接收的启动、停止及结算尝试后清理观察缓存；调用方随后关闭共享 DispatchStore。
   * 收尾错误不从 close 重抛；未成功结算的持久化活动记录留给下次 initialize 标记中断。
   */
  async close(){this.closing=true;await Promise.allSettled([...this.launches]);const handles=[...this.handles.entries()];await Promise.allSettled(handles.map(async([taskId,handle])=>{handle.stopping=true;handle.controller.abort(Error('成员执行服务正在关闭'));const stopping=handle.runtime?.stop(taskId);this.approvals.cancel(taskId);this.questions.cancel(taskId);await stopping}));await Promise.allSettled(handles.map(([,h])=>h.done));this.listeners.clear();this.eventStreams.clear()}
}
