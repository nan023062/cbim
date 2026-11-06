/**
 * 作用定位：工作区的成员注册、主对话实例绑定、主会话派发及任务图增量查询服务。
 * 设计原因：知识核验和任务/邮箱/事件在串行事务内关联；周期冻结本轮用户输入，幂等回执也不能被用于改绑目标。初始化只恢复事实，桌面与自动协调共用服务，不自行覆盖图状态。
 * 职责边界：本模块负责可靠入队，由独立 MemberExecutionManager 消费执行；新增派发不能覆盖已有活动占用，排队不等于任务完成。
 */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {Snapshot} from '../../core/knowledge/types';
import type {ConversationAgentBinding} from '../../core/brain/conversation-binding';
import type {DispatchStore,DispatchState,DispatchMessage} from '../../core/tasks/dispatch-storage';
import {dispatchScopeInputSchema,type DispatchScope,type DispatchScopeOutcome,type DispatchScopeInput,type DispatchScopeGoal} from '../../core/tasks/dispatch-scope';
import type {AgentInstance} from '../../core/team/agent-types';
import type {TaskSpec} from '../../core/tasks/types';
import type {RunSummary} from '../../core/brain/types';
import {ScopeGoalService,type ScopeGoalPorts} from './scope-goal-service';
import {openGraphInput,createMemberInput,dispatchTaskInput,graphIdentityInput} from '../../core/tasks/dispatch-commands';
import type {OpenGraphReceipt,CreateMemberReceipt,DispatchReceipt} from '../../core/tasks/dispatch-commands';
import type {GraphIdentity,GraphCursor,GraphSnapshot,GraphChange,GraphEventBatch,AgentGraphView,GraphEdge,TaskNode} from '../../core/tasks/graph-types';
import {resolveConversationAgent,resolveDispatchAgent,resolveDispatchModules} from '../context/dispatch-context';
import {prepareMember} from './agent-manager';

/** 只需工作区状态与知识快照，不依赖桌面或具体文件存储。 */
type DispatchWorkspace=Pick<KnowledgeWorkspace,'entry'|'instanceId'|'assert'|'snapshot'|'read'>;
const scopeIdentityInput=graphIdentityInput.extend({scopeId:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/)}).strict();

export class WorkspaceDispatchService {
  private closed=false;
  /** 目标计划与审阅复用派发事务；日志证据由应用只读端口注入，不从模型参数接受。 */
  readonly goals:ScopeGoalService;
  constructor(private readonly owner:DispatchWorkspace,private readonly store:DispatchStore,goalPorts?:ScopeGoalPorts){
    this.goals=new ScopeGoalService(owner,store,goalPorts);
  }

  /** 工作区启动时恢复事务存储，触发存储观察者的基线；不创建成员、不消费任务。 */
  async initialize(){this.check(this.owner.entry.id);await this.store.read()}

  /**
   * 主用户任务开始时冻结本轮正文与附件身份；跨模型回合复用同一周期，不从旧 TaskSpec 推断本轮输入。
   * 第三参数缺省仅兼容旧调用；同 scope 重发必须保持输入，不能通过命中幂等回执绕过校验。
   */
  async openScope(identity:GraphIdentity,scopeId:string,rawInput?:DispatchScopeInput):Promise<DispatchScope>{
    const input=this.parse(scopeIdentityInput,{...identity,scopeId});this.check(input.workspaceId);
    // 在第一次 await 前校验并复制，调用者之后修改原对象不能改变正在保存的输入。
    const parsed=rawInput===undefined?undefined:this.parse(dispatchScopeInputSchema,rawInput);
    const goal:DispatchScopeGoal|undefined=parsed?{revision:1,input:{message:parsed.message,attachmentIds:[...(parsed.attachmentIds??[])]}}:undefined;
    const verifyGoal=(scope:DispatchScope)=>{
      if((scope.goal===undefined)!==(goal===undefined)||scope.goal?.input.message!==goal?.input.message||JSON.stringify(scope.goal?.input.attachmentIds)!==JSON.stringify(goal?.input.attachmentIds))fail('DISPATCH_SCOPE_INPUT_CONFLICT','同一调度周期不能重新绑定用户正文或附件');
    };
    await this.openGraph({...identity,commandId:'scope-root-'+hash(json(input))});
    // 命令键保持身份稳定，输入进入指纹；无 goal 的旧调用保留原指纹以读取历史回执。
    const command={...input,commandId:'scope-open-'+hash(json(input)),...(goal?{goal}:{})};
    await this.store.transact(this.command('scope.open',command),async state=>{
      this.check(input.workspaceId);this.graph(state,input.rootSessionId);
      const previous=state.scopes?.find(scope=>scope.scopeId===scopeId);
      if(previous){if(previous.rootSessionId!==input.rootSessionId)fail('DISPATCH_SCOPE_IDENTITY','调度周期属于其他主会话');verifyGoal(previous);if(previous.status!=='active')fail('DISPATCH_SCOPE_CLOSED','调度周期已结束');return {receipt:previous}}
      if(state.scopes?.some(scope=>scope.rootSessionId===input.rootSessionId&&scope.status==='active'))fail('DISPATCH_SCOPE_BUSY','当前主会话还有未结束的用户任务周期');
      const scope:DispatchScope={...input,status:'active',createdAt:new Date().toISOString(),...(goal?{goal}:{})};return {scopes:[scope],receipt:scope};
    });
    const scope=(await this.store.read()).scopes?.find(value=>value.scopeId===scopeId);
    if(!scope||scope.workspaceId!==input.workspaceId||scope.rootSessionId!==input.rootSessionId)fail('DISPATCH_SCOPE_IDENTITY','调度周期不属于当前主会话');
    verifyGoal(scope);
    if(scope.status!=='active')fail('DISPATCH_SCOPE_CLOSED','调度周期已结束，不能重新打开');
    return scope;
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
      const tasks=graph.tasks.filter(task=>task.scopeId===scopeId),taskIds=new Set(tasks.map(task=>task.taskId));
      // 普通问答只关闭生命周期；一旦规划或派工，必须引用同周期主轮结束事实及显式审阅。
      // 在同一派发事务内复核，避免工具中申请完成后又出现新任务，提前释放成员。
      const recordedWork=mainSummary?.toolReceipts?.some(receipt=>receipt.effects.includes('knowledge-write')||['cbim_goal_plan','cbim_goal_review','cbim_dispatch_task'].includes(receipt.toolName));
      if(outcome==='completed'&&scope.goal&&(scope.goal.plan||tasks.length||recordedWork)){
        if(!mainSummary)fail('GOAL_REVIEW_REQUIRED','业务任务需要主调度的结构化目标审阅，不能直接标为完成');
        await this.goals.validateCompletion(state,scope,mainSummary);
      }
      if(state.runs?.some(run=>taskIds.has(run.binding.taskId)&&['starting','running'].includes(run.status)))fail('DISPATCH_SCOPE_BUSY','调度周期仍有未结算运行，请先停止并等待成员结束');
      const now=new Date().toISOString(),changes:GraphChange[]=[],messages:DispatchMessage[]=[],members:AgentInstance[]=[];
      for(const task of tasks)if(!task.runIds.length&&['planned','queued','waiting','blocked'].includes(task.status)){
        const cancelled:TaskNode={...task,status:'cancelled',revision:task.revision+1,updatedAt:now,waitReason:'所属用户任务周期已结束，未启动任务已取消'};
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

  /** 应用重启先由成员管理器结算旧 starting/running，再调用本方法中断旧周期；不重放模型或任务。 */
  async recoverScopes():Promise<void>{
    this.check(this.owner.entry.id);const state=await this.store.read();
    for(const scope of state.scopes??[])if(scope.status==='active')await this.closeScope({workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId},scope.scopeId,'interrupted');
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
    return {commandId:input.commandId,fingerprint:hash(json({operation,actor:'desktop-local-user',input}))};
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
  async dispatchTask(raw:unknown,trustedScopeId?:string):Promise<DispatchReceipt>{
    const input=this.parse(dispatchTaskInput,raw);this.check(input.workspaceId);
    if(input.task.assigneeAgentId==='cbim:main')fail('AGENT_NOT_EXECUTABLE','主 Agent 不直接执行业务，请指定执行 Agent 或默认执行角色');
    if(new Set(input.task.moduleIds).size!==input.task.moduleIds.length||new Set(input.task.acceptance.map(a=>a.id)).size!==input.task.acceptance.length||new Set(input.task.prerequisites.map(p=>p.taskId)).size!==input.task.prerequisites.length)fail('GRAPH_INPUT_INVALID','模块、验收条目和前置任务不能重复');
    return this.store.transact(this.command('dispatch',trustedScopeId===undefined?input:{...input,scopeId:trustedScopeId}),async state=>{
      this.check(input.workspaceId);const graph=this.graph(state,input.rootSessionId);
      if(trustedScopeId!==undefined){
        const scope=state.scopes?.find(value=>value.scopeId===trustedScopeId);
        if(!scope||scope.rootSessionId!==input.rootSessionId)fail('DISPATCH_SCOPE_IDENTITY','任务调度周期不属于当前主会话');
        if(scope.status!=='active')fail('DISPATCH_SCOPE_CLOSED','调度周期已结束，不能继续派发');
        // 关闭需在一个不超过 1000 变更的图批次里取消任务并释放实例；每任务最多两条关闭变更。
        if(graph.tasks.filter(task=>task.scopeId===trustedScopeId).length>=500)fail('DISPATCH_SCOPE_LIMIT','本次用户任务已达到 500 个派发节点，请结束本周期后继续');
      }
      if(graph.root.revision!==input.expectedParentRevision)fail('GRAPH_REVISION_CONFLICT','主会话根版本已变化');
      const snapshot=await this.owner.snapshot();
      if(trustedScopeId!==undefined){
        const scope=state.scopes!.find(value=>value.scopeId===trustedScopeId)!;
        if(scope.goal)this.goals.validateDispatch(state,scope,input.task,snapshot.revision);
      }
      const taskId=randomUUID();
      const prepared=prepareMember(state,await resolveDispatchAgent(snapshot,input.task.assigneeAgentId),input.rootSessionId,'task',trustedScopeId===undefined?undefined:{scopeId:trustedScopeId,taskId});
      const modules=await resolveDispatchModules(snapshot,input.task.moduleIds);
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
      const task:TaskNode={kind:'task',nodeId:'task:'+taskId,taskId,...(trustedScopeId===undefined?{}:{scopeId:trustedScopeId}),identity:graph.identity,requester:graph.root.agent,assignee:prepared.agent,modules,goal:input.task.goal,acceptance:input.task.acceptance,revision:1,planRevision:1,status:waiting?'waiting':'queued',awaitedChildren:[],runIds:[],createdAt:now,updatedAt:now,...(waiting?{waitReason:'等待前置任务的有效结果'}:{})};
      const previous=graph.agents.find(a=>a.agentInstanceId===prepared.member.agentInstanceId);
      const waitingTaskIds=[...(previous?.waitingTaskIds??[]),...(waiting?[taskId]:[])];
      // 新派发不能覆盖成员正在其他任务中的占用；图只保留本图已经确认的活动任务。
      const localRunning=previous?.runningTaskId;
      const agent:AgentGraphView={agentInstanceId:prepared.member.agentInstanceId,agentId:prepared.member.agentId,name:prepared.agent.name,revision:(previous?.revision??0)+1,state:localRunning?'working':previous?.state==='communicating'?'communicating':waitingTaskIds.length?'waiting':'idle',runningTaskId:localRunning,waitingTaskIds};
      if(waiting){prepared.member.waitingTaskIds.push(taskId);if(!prepared.member.activeRunId)prepared.member.activity='waiting'}
      const batch=this.batch(graph.identity,input.commandId,'task.dispatched',[{type:'task.upserted',task},...edges.map(edge=>({type:'edge.upserted' as const,edge})),{type:'agent.upserted',agent}],graph);
      const messageId=randomUUID();
      await this.recheck(snapshot);
      return {members:[prepared.member],sessions:[prepared.session],batch,messages:[{kind:'assignment',messageId,commandId:input.commandId,identity:graph.identity,from:graph.root.agent,to:prepared.agent,taskId,planRevision:1,createdAt:now,delivery:'pending'}],receipt:{commandId:input.commandId,taskId,messageId,cursor:this.cursor(batch),disposition:waiting?'waiting':'queued'}};
    });
  }

  /** 首次只读不会创建任务图；公开查询不包含成员其他 Session、邮箱和模型凭据。 */
  snapshot(raw:unknown){const identity=this.parse(graphIdentityInput,raw);this.check(identity.workspaceId);return this.store.snapshot(identity)}
  /** 无变化返回 noop，读取内存游标与已提交批次，不重复回读知识或整份日志。 */
  delta(raw:unknown,cursor?:GraphCursor,limit?:number){const identity=this.parse(graphIdentityInput,raw);this.check(identity.workspaceId);return this.store.delta(identity,cursor,limit)}
  /** 先阻止新请求，再等待已经入队的事务；由应用在释放工作区锁前调用。 */
  async close(){this.closed=true;await this.store.close()}
}
