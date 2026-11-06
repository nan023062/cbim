/**
 * 作用定位：让已派发任务在独立成员会话中执行，提交领取、启动、结果及中断事实。
 * 设计原因：启动意图先落盘，模型工具只能在 running 确认后执行；主 Agent、已释放实例、已关闭或安全等待的主会话不能执行业务。等待限制也覆盖旧无 scope 任务，避免历史入口绕过检查点。执行占用持续到终态事务完成。
 * 职责边界：可信桌面或主会话协调器启动成员，本成员 Loop 不递归派发或继承免询问批准；只读异常核实不调用恢复，候选交付不等于业务验收。
 */
import {randomUUID} from 'node:crypto';
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
import {memberTask,memberBatch,memberView,dependenciesReady,memberCandidate} from './member-state';
import {memberEventsInput,type MemberEventsRead} from '../../core/tasks/member-events';
import {MemberEventStreams,memberPublicTask} from './member-events';
import {ExecutionReportService} from './execution-report-service';
import type {ExecutionReport} from '../../core/tasks/execution-report';

/** 装配主进程提供模型与磁盘能力，调度层不解密密钥或导入平台实现。 */
export interface MemberExecutionPorts {
  /** 同时领取工作区及明确执行实例的占用，阻止同实例重复启动；释放须晚于终态事务提交。 */
  acquire(key:string,permission:ChatPermission,agentInstanceId?:string):()=>void;
  /** 仅新命令解析一次模型；公开参数落盘，凭据只由 create 闭包持有，不进入图或日志。 */
  prepare(options:MemberStartOptions):Promise<{
    model:ResolvedLlm['profile'];
    create(run:DispatchRun,task:TaskNode,hooks:{onEvent(event:StoredEvent):void;onEngineReady(input:{taskId:string;runId:string;sessionFile?:string}):Promise<void>;requestApproval(call:ToolCall):Promise<ToolDecision>;requestQuestion(args:unknown,signal:AbortSignal):Promise<unknown>}):Promise<LoopRuntime>;
  }>;
  /** 读取指定 run 的真实日志，校验通道安全续接；不得用最新运行或内存猜测替代。 */
  inspect(run:DispatchRun):Promise<RunSummary>;
}
type PreparedEngine=Awaited<ReturnType<MemberExecutionPorts['prepare']>>;
/** 一个业务任务当前的进程句柄；done 包含运行关闭和终态事务，失败时句柄保留以阻止再次领取。 */
type Handle={runtime?:LoopRuntime;stopping:boolean;done:Promise<void>};
const activeRun=(run:DispatchRun)=>run.status==='starting'||run.status==='running';

/** 每个活动工作区一个执行管理器，与派发服务共享 store；调用方须先关闭本管理器再关闭存储。 */
export class MemberExecutionManager {
  private closing=false;
  /** 恢复只执行一次；恢复失败保留拒绝态，须重建工作区实例核实，不能带着半次恢复启动新任务。 */
  private initialized?:Promise<void>;
  /** 按本工作区业务 taskId 索引，跨主会话身份另由存储检查；不使用原生会话 ID 作为键。 */
  private handles=new Map<string,Handle>();
  /** 已进入领取流程但尚未返回启动回执的调用；close 先等待它们，避免遗漏刚登记的进程。 */
  private launches=new Set<Promise<MemberStartReceipt>>();
  private listeners=new Set<(event:StoredEvent)=>void>();
  private approvals=new ApprovalQueue();
  private questions=new QuestionQueue();
  private eventStreams:MemberEventStreams;
  constructor(private owner:KnowledgeWorkspace,private store:DispatchStore,private ports:MemberExecutionPorts){this.eventStreams=new MemberEventStreams(run=>ports.inspect(run))}
  /** 手动只读核实指定任务/轮次；不调用 initialize，不恢复、启动、确认消息或重写异常日志。 */
  async report(raw:unknown):Promise<ExecutionReport>{this.owner.assert();return new ExecutionReportService(this.owner,this.store,run=>this.ports.inspect(run)).read(raw)}
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
   * 返回已提交的领取回执，不等待模型开始或任务结束；后续状态由 inspect/events 查询。
   * 重复 commandId 返回原回执，不重新解析模型、不重复启动进程；同一任务已有 run 时不能换命令重跑。
   */
  async start(raw:unknown):Promise<MemberStartReceipt>{
    const input=this.parse(memberStartInput,raw);await this.initialize();this.check(input.workspaceId);
    const pending=this.startInternal(input);this.launches.add(pending);
    try{return await pending}finally{this.launches.delete(pending)}
  }
  private async startInternal(input:z.infer<typeof memberStartInput>):Promise<MemberStartReceipt>{
    let release:(()=>void)|undefined,launch:{run:DispatchRun;task:TaskNode;engine:PreparedEngine}|undefined;
    try{
      const receipt=await this.store.transact(this.command('member.start',input),async state=>{
        this.check(input.workspaceId);
        const {graph,task,member,session}=memberTask(state,input.rootSessionId,input.taskId);
        if(state.scopes?.some(scope=>scope.rootSessionId===input.rootSessionId&&scope.status==='waiting'))fail('GOAL_WAITING','当前主会话目标处于安全等待，不能从历史任务启动执行');
        // 主实例只承担调度；即便旧图保留曾经的 self 任务，也不能再启动为业务执行者。
        if(member.agentId==='cbim:main')fail('AGENT_NOT_EXECUTABLE','主 Agent 不直接执行业务，请使用执行 Agent');
        if(member.lifecycle==='released')fail('MEMBER_RELEASED','执行实例已随调度周期释放，不能再次启动');
        if(task.scopeId&&!state.scopes?.some(scope=>scope.scopeId===task.scopeId&&scope.workspaceId===input.workspaceId&&scope.rootSessionId===input.rootSessionId&&scope.status==='active'))fail('DISPATCH_SCOPE_CLOSED','任务调度周期已结束，不能启动执行实例');
        if(task.revision!==input.expectedRevision)fail('GRAPH_REVISION_CONFLICT','任务版本已变化，请刷新后启动');
        if(task.activeRunId||task.runIds.length||!['queued','waiting'].includes(task.status))fail('TASK_NOT_STARTABLE','当前任务不能重新执行，请核实已有运行后重新派发');
        if(!dependenciesReady(graph,task))fail('TASK_DEPENDENCY_PENDING','前置任务尚未提供当前版本的交付候选');
        if(member.activeRunId)fail('MEMBER_BUSY','该成员正在处理另一项任务');
        const assignment=state.outbox.find(m=>m.kind==='assignment'&&m.taskId===task.taskId&&m.identity.rootSessionId===input.rootSessionId&&m.delivery==='pending');
        if(!assignment)fail('ASSIGNMENT_UNAVAILABLE','任务缺少可领取的派发信封');
        const previous=(state.runs??[]).filter(r=>r.binding.agentSessionId===session.agentSessionId).at(-1);
        if(previous){
          if(previous.status!=='completed')fail('MEMBER_SESSION_REVIEW_REQUIRED','该成员通道上次运行未安全结束，请先核实；本阶段不自动续接异常通道');
          const summary=await this.ports.inspect(previous);
          if(summary.status!=='completed'||summary.unresolvedTools.length||!summary.sessionFile||json(summary.memberBinding)!==json(previous.binding)||summary.task.workspaceId!==input.workspaceId||summary.task.root!==this.owner.entry.path||summary.task.taskId!==previous.binding.taskId||summary.task.agentId!==previous.binding.agentId||summary.runId!==previous.binding.runId||summary.sessionFile!==previous.session.sessionFile)fail('MEMBER_SESSION_REVIEW_REQUIRED','成员通道历史未通过核实，不能自动续接');
        }
        const runId=randomUUID();release=this.ports.acquire(runId,input.options.permission,member.agentInstanceId);
        const prepared=await prepareDispatchExecutionContext(this.owner,task),engine=await this.ports.prepare(input.options);
        if(member.configurationRevision!==prepared.knowledgeRevision)fail('DISPATCH_CONTEXT_CHANGED','成员配置版本已变化，请重新登记派发');
        const prerequisites=graph.edges.filter(edge=>edge.enabled&&edge.kind==='dependency'&&edge.toNodeId===task.nodeId).map(edge=>{
          const source=graph.tasks.find(t=>t.nodeId===edge.fromNodeId)!;
          return {taskId:source.taskId,planRevision:source.planRevision,result:structuredClone(source.result!)};
        });
        const run:DispatchRun={binding:{workspaceId:input.workspaceId,teamId:member.teamId,agentId:member.agentId,agentInstanceId:member.agentInstanceId,agentSessionId:session.agentSessionId,rootSessionId:input.rootSessionId,taskId:task.taskId,runId,leaseEpoch:member.leaseEpoch,planRevision:task.planRevision},assignmentMessageId:assignment.messageId,status:'starting',prepared,prerequisites,model:engine.model,permission:input.options.permission,turnTimeoutMs:input.options.turnTimeoutMs,session:{nativeSessionId:session.nativeSessionId??session.agentSessionId,...(previous?{sessionFile:previous.session.sessionFile}:{})},createdAt:new Date().toISOString()};
        const updated={...task,status:'queued' as const,waitReason:undefined,revision:task.revision+1,activeRunId:runId,runIds:[...task.runIds,runId],updatedAt:run.createdAt};
        const occupied={...member,activity:'communicating' as const,activeTaskId:task.taskId,activeRunId:runId,waitingTaskIds:member.waitingTaskIds.filter(id=>id!==task.taskId),communicatingMessageIds:[assignment.messageId]};
        const dependencies=graph.edges.filter(edge=>edge.enabled&&edge.kind==='dependency'&&edge.toNodeId===task.nodeId).map(edge=>{
          if(edge.kind!=='dependency')throw Error('invalid dependency');
          const source=graph.tasks.find(t=>t.nodeId===edge.fromNodeId)!;
          return {type:'edge.upserted' as const,edge:{...edge,revision:edge.revision+1,condition:{...edge.condition,resultId:source.result!.resultId}}};
        });
        const batch=memberBatch(graph,input.commandId,'message.accepted',[{type:'task.upserted',task:updated},{type:'agent.upserted',agent:memberView(graph,occupied,updated)},...dependencies]);
        await recheckDispatchExecutionContext(this.owner,prepared);this.check(input.workspaceId);
        launch={run,task:updated,engine};
        return {runs:[run],members:[occupied],messages:[{...assignment,delivery:'claimed' as const,claim:{runId,leaseEpoch:member.leaseEpoch}}],batch,receipt:{taskId:task.taskId,runId,cursor:{...graph.identity,streamId:batch.streamId,seq:batch.seq}}};
      });
      if(launch){
        const {run,task,engine}=launch;
        const handle:Handle={stopping:this.closing,done:Promise.resolve()};
        this.handles.set(task.taskId,handle);
        handle.done=this.execute(run,task,engine,handle,release!);
        // 结算失败保留活动占用并阻止后续任务；不能吞掉失败后伪装空闲。
        void handle.done.catch(()=>{});release=undefined;
      }
      return receipt;
    }finally{release?.()}
  }
  private async execute(run:DispatchRun,task:TaskNode,engine:PreparedEngine,handle:Handle,release:()=>void){
    let summary:RunSummary|undefined,error:string|undefined;
    const spec=memberPublicTask(task,this.owner.entry.path);this.eventStreams.begin(run,spec);
    try{
      if(handle.stopping){await this.settle(run,undefined,'cancelled');return}
      await recheckDispatchExecutionContext(this.owner,run.prepared);
      handle.runtime=await engine.create(run,task,{
        onEvent:event=>{this.eventStreams.append(run,spec,event);this.emit(event)},onEngineReady:input=>this.ready(run,input.sessionFile),
        requestApproval:call=>this.approvals.request(task.taskId,call),requestQuestion:(args,signal)=>this.questions.ask(task.taskId,args,signal),
      });
      if(handle.stopping){await this.settle(run,undefined,'cancelled');return}
      const started=await handle.runtime.startMember(spec,task.goal,{binding:run.binding,session:run.session});
      if(handle.stopping)await handle.runtime.stop(task.taskId);
      summary=await started.done;
    }catch{error='成员执行未能正常结束，请检查该运行日志并核实产物'}
    finally{
      this.approvals.cancel(task.taskId);this.questions.cancel(task.taskId);
      try{await handle.runtime?.close()}catch{error='成员进程未能正常关闭，请核实运行日志';summary=undefined}
      try{
        if(summary||error)await this.settle(run,summary,summary?.status==='running'?'interrupted':summary?.status??'interrupted',error);
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
  /** 同一事务结算运行、任务、成员占用和信封；恢复额外提升租约代际，不重放旧模型或工具。 */
  private async settle(original:DispatchRun,summary:RunSummary|undefined,status:Exclude<DispatchRun['status'],'starting'|'running'>,error?:string,recovery=false){
    const command={commandId:(recovery?'recover-':'settle-')+original.binding.runId,fingerprint:hash(json({binding:original.binding,status,recovery}))};
    await this.store.transact(command,async state=>{
      const run=this.currentRun(state,original),{graph,task,member,session}=memberTask(state,run.binding.rootSessionId,run.binding.taskId);
      if(summary&&(json(summary.memberBinding)!==json(run.binding)||summary.task.taskId!==task.taskId||summary.runId!==run.binding.runId))fail('MEMBER_RUN_MISMATCH','执行摘要身份不一致');
      let result=summary?memberCandidate(task,summary):undefined;
      if(result)try{await recheckDispatchExecutionContext(this.owner,run.prepared)}catch{result=undefined;error='执行期间知识基线变化，交付候选需要重新核实'}
      const now=new Date().toISOString(),taskStatus=result?'result_ready' as const:status==='completed'?'blocked' as const:status;
      const updated:TaskNode={...task,revision:task.revision+1,status:taskStatus,activeRunId:undefined,result,updatedAt:now,waitReason:result?undefined:error??(status==='completed'?'本轮未提交与派发目标一致的有效计划和交付证据':status==='cancelled'?'用户停止了本次运行':'执行未正常结束，请核实产物')};
      const waitingTaskIds=member.waitingTaskIds.filter(id=>id!==task.taskId);
      const released={...member,leaseEpoch:member.leaseEpoch+(recovery?1:0),activity:waitingTaskIds.length?'waiting' as const:'idle' as const,activeTaskId:undefined,activeRunId:undefined,waitingTaskIds,communicatingMessageIds:[]};
      const assignment=state.outbox.find(m=>m.messageId===run.assignmentMessageId)!;
      const messages:DispatchMessage[]=[{...assignment,delivery:'processed'}];
      if(result)messages.push({kind:'result',messageId:randomUUID(),commandId:command.commandId,identity:graph.identity,from:task.assignee,to:task.requester,taskId:task.taskId,planRevision:task.planRevision,createdAt:now,delivery:'pending',replyTo:assignment.messageId,resultId:result.resultId,runId:run.binding.runId});
      return {runs:[{...run,status,settledAt:now,error:updated.waitReason}],members:[released],sessions:[{...session,lastTaskId:task.taskId,lastRunId:run.binding.runId}],messages,batch:memberBatch(graph,command.commandId,('task.'+taskStatus) as 'task.blocked',[{type:'task.upserted',task:updated},{type:'agent.upserted',agent:memberView(graph,released,updated)}]),receipt:true};
    });
  }
  /** 停止请求不直接宣称 cancelled；真实引擎收尾后才提交终态。 */
  async stop(raw:unknown){
    const input=this.parse(memberTaskInput,raw);const {task}=memberTask(await this.store.read(),input.rootSessionId,input.taskId);
    const handle=this.handles.get(task.taskId);if(!handle)return {requested:false};
    handle.stopping=true;const stopping=handle.runtime?.stop(task.taskId);this.approvals.cancel(task.taskId);this.questions.cancel(task.taskId);await stopping;return {requested:true};
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
  /** 返回当前收件人的待处理信封；结果正文通过同图 task.result 获取。 */
  async messages(raw:unknown){const input=this.parse(memberMessageInput,raw),state=await this.store.read();this.assertRecipient(state,input.rootSessionId,input.agentSessionId);return state.outbox.filter(m=>m.identity.rootSessionId===input.rootSessionId&&m.to.agentSessionId===input.agentSessionId&&m.delivery==='pending')}
  private assertRecipient(state:DispatchState,rootSessionId:string,agentSessionId:string){if(!state.sessions.some(s=>s.agentSessionId===agentSessionId&&s.rootSessionId===rootSessionId))fail('MESSAGE_RECIPIENT_INVALID','收件人不属于当前主会话')}
  /** 显式收件确认仅消费 result，不领取新的任务，也不签发业务验收。 */
  async acknowledge(raw:unknown){const input=this.parse(memberAcknowledgeInput,raw);return this.store.transact(this.command('member.ack',input),async state=>{
    this.assertRecipient(state,input.rootSessionId,input.agentSessionId);
    const message=state.outbox.find(m=>m.messageId===input.messageId&&m.identity.rootSessionId===input.rootSessionId&&m.to.agentSessionId===input.agentSessionId);
    if(!message||message.kind!=='result')fail('MESSAGE_NOT_FOUND','当前收件人没有此结果信封');
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
  async close(){this.closing=true;await Promise.allSettled([...this.launches]);const handles=[...this.handles.entries()];await Promise.allSettled(handles.map(async([taskId,handle])=>{handle.stopping=true;const stopping=handle.runtime?.stop(taskId);this.approvals.cancel(taskId);this.questions.cancel(taskId);await stopping}));await Promise.allSettled(handles.map(([,h])=>h.done));this.listeners.clear();this.eventStreams.clear()}
}
