/**
 * 作用定位：工作区的成员注册、主会话派发及任务图增量查询服务。
 * 设计原因：知识核验和任务/邮箱/事件在串行事务内关联；初始化只恢复登记事实，供全局监管装配；桌面入口不自行签发成员身份或覆盖图状态。
 * 职责边界：本阶段可靠入队，不消费邮箱、不启动模型，也不把排队等同于执行或验收完成。
 */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {Snapshot} from '../../core/knowledge/types';
import type {DispatchStore,DispatchState} from '../../core/tasks/dispatch-storage';
import {openGraphInput,createMemberInput,dispatchTaskInput,graphIdentityInput} from '../../core/tasks/dispatch-commands';
import type {OpenGraphReceipt,CreateMemberReceipt,DispatchReceipt} from '../../core/tasks/dispatch-commands';
import type {GraphIdentity,GraphCursor,GraphSnapshot,GraphChange,GraphEventBatch,AgentGraphView,GraphEdge,TaskNode} from '../../core/tasks/graph-types';
import {resolveDispatchAgent,resolveDispatchModules} from '../context/dispatch-context';
import {prepareMember} from './agent-manager';

/** 只需工作区状态与知识快照，不依赖桌面或具体文件存储。 */
type DispatchWorkspace=Pick<KnowledgeWorkspace,'entry'|'instanceId'|'assert'|'snapshot'|'read'>;

export class WorkspaceDispatchService {
  private closed=false;
  constructor(private readonly owner:DispatchWorkspace,private readonly store:DispatchStore){}

  /** 工作区启动时恢复事务存储，触发存储观察者的基线；不创建成员、不消费任务。 */
  async initialize(){this.check(this.owner.entry.id);await this.store.read()}

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
  private command(operation:string,input:{commandId:string}){
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
      const prepared=prepareMember(state,await resolveDispatchAgent(snapshot,'cbim:main'),input.rootSessionId);
      const identity={workspaceId:input.workspaceId,rootSessionId:input.rootSessionId};
      const batch=this.batch(identity,input.commandId,'graph.created',[
        {type:'root.upserted',root:{kind:'session-root',nodeId:'session:'+input.rootSessionId,identity,agent:prepared.agent,revision:1,createdAt:new Date().toISOString()}},
        {type:'agent.upserted',agent:{agentInstanceId:prepared.agent.agentInstanceId,agentId:prepared.agent.agentId,name:prepared.agent.name,revision:1,state:'idle',waitingTaskIds:[]}},
      ]);
      await this.recheck(snapshot);
      return {members:[prepared.member],sessions:[prepared.session],batch,receipt:{agent:prepared.agent,cursor:this.cursor(batch)}};
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

  /** 本机用户从主会话派发任务；身份从根取得。本阶段不接受模型冒充别的成员递归派发。 */
  async dispatchTask(raw:unknown):Promise<DispatchReceipt>{
    const input=this.parse(dispatchTaskInput,raw);this.check(input.workspaceId);
    if(new Set(input.task.moduleIds).size!==input.task.moduleIds.length||new Set(input.task.acceptance.map(a=>a.id)).size!==input.task.acceptance.length||new Set(input.task.prerequisites.map(p=>p.taskId)).size!==input.task.prerequisites.length)fail('GRAPH_INPUT_INVALID','模块、验收条目和前置任务不能重复');
    return this.store.transact(this.command('dispatch',input),async state=>{
      this.check(input.workspaceId);const graph=this.graph(state,input.rootSessionId);
      if(graph.root.revision!==input.expectedParentRevision)fail('GRAPH_REVISION_CONFLICT','主会话根版本已变化');
      const snapshot=await this.owner.snapshot();
      const prepared=prepareMember(state,await resolveDispatchAgent(snapshot,input.task.assigneeAgentId),input.rootSessionId);
      const modules=await resolveDispatchModules(snapshot,input.task.moduleIds);
      const taskId=randomUUID(),now=new Date().toISOString();
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
      const task:TaskNode={kind:'task',nodeId:'task:'+taskId,taskId,identity:graph.identity,requester:graph.root.agent,assignee:prepared.agent,modules,goal:input.task.goal,acceptance:input.task.acceptance,revision:1,planRevision:1,status:waiting?'waiting':'queued',awaitedChildren:[],runIds:[],createdAt:now,updatedAt:now,...(waiting?{waitReason:'等待前置任务的有效结果'}:{})};
      const previous=graph.agents.find(a=>a.agentInstanceId===prepared.member.agentInstanceId);
      const waitingTaskIds=[...(previous?.waitingTaskIds??[]),...(waiting?[taskId]:[])];
      const agent:AgentGraphView={agentInstanceId:prepared.member.agentInstanceId,agentId:prepared.member.agentId,name:prepared.agent.name,revision:(previous?.revision??0)+1,state:waitingTaskIds.length?'waiting':'idle',waitingTaskIds};
      if(waiting){prepared.member.waitingTaskIds.push(taskId);prepared.member.activity='waiting'}
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
