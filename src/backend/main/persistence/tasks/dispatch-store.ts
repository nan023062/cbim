/**
 * 作用定位：将岗位、模块责任和来源代次审计，以及执行实例、会话、任务图和信封可靠保存到同一工作区日志。
 * 设计原因：追加日志是唯一权威记录，fsync 后才发布；原命令前态与回执由同次 publish/load 派生，旧前缀只回放不重写，控制面不得夹带执行，旧在途按原事实结算。
 * 职责边界：应用须先持有工作区唯一写入锁；本类串行化该实例内的事务，不启动大脑、不消费 outbox。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fail} from '../../../core/foundation/errors';
import {hash} from '../../../core/foundation/serialization';
import {applyGraphBatch, readGraphDelta} from '../../../core/tasks/graph-reducer';
import {validateDispatchExecution} from '../../../core/tasks/dispatch-invariants';
import {validateDispatchScopes} from '../../../core/tasks/dispatch-scope-invariants';
import {projectWorkspaceMemberMutation} from '../../../core/tasks/workspace-member-invariants';
import {projectModuleOwnershipMutation} from '../../../core/tasks/module-ownership-invariants';
import type {DispatchCommand, DispatchCommandEvidence, DispatchMutation, DispatchObserver, DispatchState, DispatchStore} from '../../../core/tasks/dispatch-storage';
import type {AgentRef, GraphCursor, GraphDelta, GraphEventBatch, GraphIdentity, GraphSnapshot} from '../../../core/tasks/graph-types';
import {applyScopeBatch,dispatchSessionReadInput,emptyScopeSnapshot,readScopeDelta,readScopeDetail,summarizeScope,scopeViewHistoryLimit,type DispatchSessionReadInput,type DispatchSessionRead,type ScopeSnapshot,type ScopeEventBatch} from '../../../core/tasks/scope-view';
import type {DispatchScope} from '../../../core/tasks/dispatch-scope';
import {projectKnowledgeSourceMutation} from '../../../core/tasks/knowledge-source-invariants';
import {validateOwnerExecutionMutation,type DispatchExecutionProtocol} from '../../../core/tasks/owner-execution-invariants';

/** transactionSeq 是工作区日志序号，与单张图的 batch.seq 分开。 */
interface TransactionBody {
  version: 1;
  /** 仅本 Store 写入；缺省只允许旧日志前缀，不能让新请求选择旧业务许可。 */
  executionProtocol?:'module_owner_v1';
  workspaceId: string;
  transactionSeq: number;
  previousHash: string;
  command: DispatchCommand;
  mutation: DispatchMutation;
}
interface TransactionRecord {body:TransactionBody;checksum:string}

const clone = <T>(value:T):T => structuredClone(value);
const sameGraph = (a:GraphIdentity,b:GraphIdentity) => a.workspaceId===b.workspaceId && a.rootSessionId===b.rootSessionId;
function text(value:unknown):value is string {return typeof value==='string' && value.trim().length>0}
function valid(condition:unknown,message:string):asserts condition {if(!condition)fail('GRAPH_INPUT_INVALID',message)}
function unique<T>(items:T[],key:(item:T)=>string,label:string){const ids=new Set<string>();for(const item of items){const id=key(item);valid(text(id)&&!ids.has(id),`${label}标识无效或重复`);ids.add(id)}}
function upsert<T>(old:T[],updates:T[],key:(item:T)=>string){const map=new Map(old.map(item=>[key(item),item]));for(const item of updates)map.set(key(item),item);return [...map.values()]}

/**
 * 每工作区一个实例，由应用锁保护跨进程所有权；close 后不得复用。
 * 日志中的完整换行是提交记录边界，哈希链检查完整行损坏与顺序；未完成尾部只在恢复时截断。
 */
export class FileDispatchStore implements DispatchStore {
  private readonly file:string;
  private state:DispatchState;
  /** commandId 在整个工作区内去重；指纹同时包含操作与主会话等输入，跨图复用同键也会冲突。 */
  private readonly commands=new Map<string,DispatchCommandEvidence>();
  /** 按 rootSessionId 保存已提交图批次；图序号独立于包含无图变更事务的 transactionSeq。 */
  private readonly events=new Map<string,GraphEventBatch[]>();
  /** 从 scopes 提交派生，每个主会话独立连续编号；正常重放恢复相同游标，不保存第二份日志。 */
  private readonly scopeViews=new Map<string,ScopeSnapshot>();
  private readonly scopeEvents=new Map<string,ScopeEventBatch[]>();
  private transactionSeq=0;
  private lastHash='';
  private ownerProtocolSeen=false;
  private initialization?:Promise<void>;
  private tail:Promise<void>=Promise.resolve();
  private closing=false;
  private closePromise?:Promise<void>;
  /** 可能已经落下完整记录但未能确认可靠提交时，禁止本实例继续写入或返回过时投影。 */
  private storageFailure?:Error;

  constructor(readonly directory:string,readonly workspaceId:string,private readonly observer?:DispatchObserver){
    valid(text(workspaceId),'存储必须绑定明确工作区');
    this.file=path.join(directory,'dispatch.jsonl');
    this.state={workspaceId,members:[],sessions:[],graphs:[],outbox:[],runs:[],scopes:[],workspaceMembers:[],workspaceMemberChanges:[],registryCursor:null,moduleOwnerships:[],ownershipChanges:[],ownershipCursor:null,knowledgeSourceGenerations:[],knowledgeSourceTransitions:[],knowledgeSourceChanges:[],sourceCursor:null};
  }

  private available(){
    if(this.closing)fail('GRAPH_STORE_CLOSED','任务派发存储正在关闭或已关闭');
    if(this.storageFailure)throw this.storageFailure;
  }
  private init(){return this.initialization??=this.load().then(()=>this.observe(()=>this.observer?.loaded(clone(this.state)))).catch(error=>{this.observationFailed(error);throw error})}
  /** 观察端异常与存储事务分离；失败处理自身也不能破坏已确认提交的回执。 */
  private observationFailed(error:unknown){try{this.observer?.failed(error instanceof Error?error:Error(String(error)))}catch{/* 监控故障不改变权威存储 */}}
  private observe(notify:()=>void){try{notify()}catch(error){this.observationFailed(error)}}
  private checkIdentity(identity:GraphIdentity){
    if(!identity||identity.workspaceId!==this.workspaceId)fail('GRAPH_IDENTITY_MISMATCH','任务图不属于此工作区');
    valid(text(identity.rootSessionId),'缺少主会话身份');
  }
  private graph(identity:GraphIdentity){
    this.checkIdentity(identity);
    const graph=this.state.graphs.find(g=>sameGraph(g.identity,identity));
    if(!graph)fail('GRAPH_NOT_FOUND','当前主会话尚未创建任务派发图');
    return graph;
  }

  /** 内部管理快照；返回深拷贝，不允许调用方改写权威内存状态。 */
  async read():Promise<DispatchState>{this.available();await this.init();await this.tail;if(this.storageFailure)throw this.storageFailure;return clone(this.state)}
  /** 原命令查询只读日志恢复出的索引；不触发新事务，也不按当前知识或配置重算历史结果。 */
  async commandReceipt(commandId:string):Promise<{fingerprint:string;receipt:unknown}|undefined>{
    this.available();valid(text(commandId),'查询需要原命令身份');await this.init();await this.tail;this.available();
    const record=this.commands.get(commandId);
    return record?clone({fingerprint:record.fingerprint,receipt:record.receipt}):undefined;
  }
  /** 内部原命令证据不重算当前业务状态；没有记录不是未执行证明，完整回执不得原样公开。 */
  async commandEvidence(commandId:string):Promise<DispatchCommandEvidence|undefined>{
    this.available();valid(text(commandId),'查询需要原命令身份');
    if(!this.initialization)fail('GRAPH_STORE_NOT_READY','工作区尚未初始化，不能通过原命令查询触发恢复');
    await this.initialization;await this.tail;this.available();
    return clone(this.commands.get(commandId));
  }
  /** 只返回明确主会话的图，不暴露全工作区邮箱或其他会话正文。 */
  async snapshot(identity:GraphIdentity):Promise<GraphSnapshot>{this.available();await this.init();await this.tail;if(this.storageFailure)throw this.storageFailure;return clone(this.graph(identity))}
  /** 无变化时只生成游标响应；不重新打开日志或复制全部工作区状态。 */
  async delta(identity:GraphIdentity,cursor?:GraphCursor,limit?:number):Promise<GraphDelta>{
    this.available();await this.init();await this.tail;if(this.storageFailure)throw this.storageFailure;
    const graph=this.graph(identity);
    return clone(readGraphDelta(graph,this.events.get(identity.rootSessionId)??[],cursor,limit));
  }

  /** 图和周期在一个屏障内同步取值；无变化不复制目标正文，不回读知识或运行日志。 */
  async sessionRead(raw:DispatchSessionReadInput):Promise<DispatchSessionRead>{
    const parsed=dispatchSessionReadInput.safeParse(raw);valid(parsed.success,'主会话读取参数无效');
    const input=parsed.data;this.available();await this.init();await this.tail;if(this.storageFailure)throw this.storageFailure;
    const graph=this.graph(input.identity),root=input.identity.rootSessionId;
    const scopes=this.scopeViews.get(root)??emptyScopeSnapshot(graph.identity,graph.cursor.streamId);
    return clone({graph:readGraphDelta(graph,this.events.get(root)??[],input.graphCursor,input.limit),scopes:readScopeDelta(scopes,this.scopeEvents.get(root)??[],input.scopeCursor,input.limit),detail:readScopeDetail(scopes,this.state.scopes??[],input.selectedScopeId,input.detailStamp)});
  }

  /**
   * 工作区级幂等查找先于 prepare；同键重发不会重新查知识或生成成员/任务 ID。
   * prepare 或领域校验失败不污染后续事务；实际写入失败会封闭本实例，须重新打开核实日志。
   */
  transact<T>(command:DispatchCommand,prepare:(state:DispatchState)=>Promise<DispatchMutation<T>>):Promise<T>{
    try{this.available();valid(text(command?.commandId)&&text(command?.fingerprint),'缺少命令幂等键或指纹')}catch(error){return Promise.reject(error)}
    const fixedCommand=clone(command);
    const pending=this.tail.then(async()=>{
      await this.init();if(this.storageFailure)throw this.storageFailure;
      const committed=this.commands.get(fixedCommand.commandId);
      if(committed){
        if(committed.fingerprint!==fixedCommand.fingerprint)fail('COMMAND_ID_CONFLICT','相同命令 ID 已用于不同请求');
        return clone(committed.receipt) as T;
      }
      // JSON round-trip 固定实际落盘值；禁止 undefined 回执和不可序列化输入被静默省略。
      const proposed=await prepare(clone(this.state));
      valid(proposed&&Object.hasOwn(proposed,'receipt')&&proposed.receipt!==undefined,'事务必须返回可持久化回执');
      let mutation:DispatchMutation<T>;
      try{const serialized=JSON.stringify(proposed);valid(text(serialized),'事务无法序列化');mutation=JSON.parse(serialized)}catch{fail('GRAPH_INPUT_INVALID','事务必须是可序列化 JSON')}
      const next=this.project(mutation,fixedCommand,'module_owner_v1');
      const body:TransactionBody={version:1,executionProtocol:'module_owner_v1',workspaceId:this.workspaceId,transactionSeq:this.transactionSeq+1,previousHash:this.lastHash,command:fixedCommand,mutation};
      const checksum=hash(JSON.stringify(body));
      try{
        await fs.mkdir(this.directory,{recursive:true});
        const file=await fs.open(this.file,'a',0o600);
        try{await file.writeFile(JSON.stringify({body,checksum})+'\n');await file.sync()}finally{await file.close()}
      }catch{
        try{fail('GRAPH_STORAGE_FAILED','任务派发记录未能确认可靠保存；请重新打开工作区核实')}catch(error){this.storageFailure=error as Error}
        this.observationFailed(this.storageFailure);
        throw this.storageFailure;
      }
      this.publish(body,checksum,next);
      this.observe(()=>this.observer?.committed(clone(mutation)));
      return clone(mutation.receipt);
    });
    this.tail=pending.then(()=>{},()=>{});
    return pending;
  }

  /**
   * 停止接收新操作并等待已接受操作收尾；失败已由原调用报告，关闭仍应成功释放工作区生命周期。
   * 不在 close 重抛损坏/写入错误，避免应用无法释放工作区锁后重新打开核实日志。
   */
  close():Promise<void>{
    if(!this.closePromise){this.closing=true;this.closePromise=(async()=>{await this.tail;await this.initialization?.catch(()=>{})})()}
    return this.closePromise;
  }

  private publish(body:TransactionBody,checksum:string,next:DispatchState){
    // 必须先取原前态；实时 fsync 与已验证 load 共用此处，后来的根版本不能改变原命令依据。
    const batch=body.mutation.batch;
    const previousGraph=batch?this.state.graphs.find(graph=>sameGraph(graph.identity,batch.identity)):undefined;
    const evidence:DispatchCommandEvidence={fingerprint:body.command.fingerprint,receipt:body.mutation.receipt,commit:{transactionSeq:body.transactionSeq,checksum,executionProtocol:body.executionProtocol??'legacy'},...(batch?{graph:{identity:clone(batch.identity),...(previousGraph?{before:{cursor:clone(previousGraph.cursor),rootRevision:previousGraph.root.revision}}:{}),afterCursor:{...batch.identity,streamId:batch.streamId,seq:batch.seq},cause:batch.cause}}:{})};
    this.state=next;this.transactionSeq=body.transactionSeq;this.lastHash=checksum;
    if(body.executionProtocol==='module_owner_v1')this.ownerProtocolSeen=true;
    this.commands.set(body.command.commandId,evidence);
    if(batch){const events=this.events.get(batch.identity.rootSessionId)??[];events.push(batch);this.events.set(batch.identity.rootSessionId,events)}
    const groups=new Map<string,DispatchScope[]>();
    for(const scope of body.mutation.scopes??[]){const values=groups.get(scope.rootSessionId)??[];values.push(scope);groups.set(scope.rootSessionId,values)}
    for(const [root,updates] of groups){
      const graph=this.graph({workspaceId:this.workspaceId,rootSessionId:root});
      const previous=this.scopeViews.get(root)??emptyScopeSnapshot(graph.identity,graph.cursor.streamId),seq=previous.cursor.seq+1;
      const event:ScopeEventBatch={identity:graph.identity,streamId:previous.cursor.streamId,seq,scopes:updates.map(scope=>summarizeScope(scope,previous.cursor.streamId,seq))};
      this.scopeViews.set(root,applyScopeBatch(previous,event));
      const events=this.scopeEvents.get(root)??[];events.push(event);if(events.length>scopeViewHistoryLimit)events.shift();this.scopeEvents.set(root,events);
    }
  }

  /** 验证整次 mutation 后才返回候选投影；图、成员会话与信封引用在同一个候选状态内核对。 */
  private project(mutation:DispatchMutation,command:DispatchCommand,protocol:DispatchExecutionProtocol):DispatchState{
    valid(mutation&&typeof mutation==='object','无效调度事务');
    const source=projectKnowledgeSourceMutation(this.state,mutation,command);
    const registry=projectWorkspaceMemberMutation(this.state,mutation,command,source.permit);
    const ownership=projectModuleOwnershipMutation(this.state,mutation,command,source.permit);
    const members=mutation.members??[],sessions=mutation.sessions??[],messages=mutation.messages??[],runs=mutation.runs??[],scopes=mutation.scopes??[];
    valid(Array.isArray(members)&&Array.isArray(sessions)&&Array.isArray(messages)&&Array.isArray(runs)&&Array.isArray(scopes),'事务集合必须是数组');
    unique(members,m=>m.agentInstanceId,'成员');unique(sessions,s=>s.agentSessionId,'会话');unique(messages,m=>m.messageId,'消息');unique(runs,r=>r.binding?.runId,'运行');unique(scopes,s=>s.scopeId,'周期');
    // 旧 v1 日志没有 runs；按空集合投影且保留原校验和，不通过迁移重写历史。
    const next:DispatchState={workspaceId:this.workspaceId,members:upsert(this.state.members,members,m=>m.agentInstanceId),sessions:upsert(this.state.sessions,sessions,s=>s.agentSessionId),graphs:[...this.state.graphs],outbox:upsert(this.state.outbox,messages,m=>m.messageId),runs:upsert(this.state.runs??[],runs,r=>r.binding.runId),scopes:upsert(this.state.scopes??[],scopes,s=>s.scopeId),...registry,...ownership,...source.projection};
    unique(next.members,m=>JSON.stringify(m.agentId==='cbim:main'?['main',m.mainRootSessionId??null]:m.executionScopeId?['execution',m.executionScopeId,m.executionTaskId]:['legacy',m.agentId]),'主会话、周期任务或旧角色实例');unique(next.sessions,s=>s.agentSessionId,'会话');unique(next.outbox,m=>m.messageId,'消息');
    for(const member of members){
      valid(member.workspaceId===this.workspaceId&&text(member.teamId)&&text(member.agentId),'成员必须属于当前工作区的明确团队角色');
      valid(member.mainRootSessionId===undefined||(member.agentId==='cbim:main'&&text(member.mainRootSessionId)),'仅主实例可以固定所属主会话');
      valid(Number.isSafeInteger(member.leaseEpoch)&&member.leaseEpoch>=0&&text(member.configurationRevision),'成员代际或配置版本无效');
      valid(Array.isArray(member.agentSessionIds)&&new Set(member.agentSessionIds).size===member.agentSessionIds.length,'成员会话列表无效');
      valid(['idle','working','waiting','communicating'].includes(member.activity)&&Array.isArray(member.waitingTaskIds)&&Array.isArray(member.communicatingMessageIds),'成员活动状态无效');
      const previous=this.state.members.find(m=>m.agentInstanceId===member.agentInstanceId);
      if(previous)valid(previous.workspaceId===member.workspaceId&&previous.teamId===member.teamId&&previous.agentId===member.agentId&&previous.mainRootSessionId===member.mainRootSessionId&&previous.executionScopeId===member.executionScopeId&&previous.executionTaskId===member.executionTaskId&&member.leaseEpoch>=previous.leaseEpoch,'不能重绑定已有成员、主会话/执行周期范围或倒退租约代际');
    }
    for(const session of next.sessions){
      valid(Object.keys(session).every(key=>['workspaceId','teamId','agentId','agentInstanceId','agentSessionId','rootSessionId','purpose','nativeSessionId','lastTaskId','lastRunId'].includes(key)),'公开成员通道不能携带私有路径或未知字段');
      valid(session.purpose===undefined||session.purpose==='task'||(session.purpose==='conversation'&&session.agentId==='cbim:main'),'会话用途无效或不属于主角色');
      const member=next.members.find(m=>m.agentInstanceId===session.agentInstanceId);
      valid(session.workspaceId===this.workspaceId&&text(session.rootSessionId)&&member&&member.agentId===session.agentId&&member.teamId===session.teamId,'会话必须属于已有成员');
      valid(member.agentSessionIds.includes(session.agentSessionId),'成员未声明该会话');
      valid(!member.mainRootSessionId||member.mainRootSessionId===session.rootSessionId,'主实例通道必须属于其固定主会话');
      const previous=this.state.sessions.find(s=>s.agentSessionId===session.agentSessionId);
      if(previous)valid(previous.agentInstanceId===session.agentInstanceId&&previous.rootSessionId===session.rootSessionId&&(previous.purpose??'task')===(session.purpose??'task'),'不能将已有会话改绑至其它成员、主会话或用途');
      if(previous?.nativeSessionId)valid(previous.nativeSessionId===session.nativeSessionId,'不能改绑已知原生会话身份');
    }
    for(const member of next.members)for(const id of member.agentSessionIds)valid(next.sessions.some(s=>s.agentSessionId===id&&s.agentInstanceId===member.agentInstanceId),'成员引用的独立会话不存在');
    const batch=mutation.batch;
    if(batch){
      this.checkIdentity(batch.identity);valid(batch.commandId===command.commandId,'图批次与事务命令不一致');
      const old=this.state.graphs.find(g=>sameGraph(g.identity,batch.identity));
      const graph=applyGraphBatch(old,batch);
      next.graphs=upsert(next.graphs,[graph],g=>g.identity.rootSessionId);
    }
    const checkAgent=(agent:AgentRef,identity:GraphIdentity)=>{
      const session=next.sessions.find(s=>s.agentSessionId===agent.agentSessionId);
      valid(session&&session.agentId===agent.agentId&&session.agentInstanceId===agent.agentInstanceId&&session.rootSessionId===identity.rootSessionId&&(session.purpose??'task')==='task','图引用的成员任务通道与主会话不一致');
    };
    for(const graph of next.graphs){
      checkAgent(graph.root.agent,graph.identity);
      for(const task of graph.tasks){checkAgent(task.requester,graph.identity);checkAgent(task.assignee,graph.identity)}
      for(const view of graph.agents)valid(next.members.some(m=>m.agentInstanceId===view.agentInstanceId&&m.agentId===view.agentId),'图状态引用了未知成员');
    }
    validateDispatchScopes(this.state,next,mutation);
    validateDispatchExecution(this.state,next,mutation,command);
    validateOwnerExecutionMutation(this.state,next,mutation,protocol);
    if(batch)for(const change of batch.changes){
      if(change.type==='task.upserted'&&!this.state.graphs.find(g=>sameGraph(g.identity,batch.identity))?.tasks.some(t=>t.taskId===change.task.taskId)){
        valid(messages.some(m=>m.kind==='assignment'&&m.taskId===change.task.taskId),'新任务必须与待投递信封一起提交');
      }
    }
    return next;
  }

  private async load(){
    let bytes:Buffer;
    try{bytes=await fs.readFile(this.file)}catch(error:any){if(error.code==='ENOENT')return;throw error}
    const complete=bytes.lastIndexOf(10)+1;
    const lines=bytes.subarray(0,complete).toString('utf8').split('\n');lines.pop();
    for(const line of lines){
      try{
        const record=JSON.parse(line) as TransactionRecord;const body=record.body;
        if(body?.version!==1){
          if(Number.isInteger(body?.version))fail('GRAPH_VERSION_UNSUPPORTED','不支持此派发日志版本');
          fail('GRAPH_LOG_CORRUPT','派发日志缺少协议版本');
        }
        valid(body.workspaceId===this.workspaceId&&body.transactionSeq===this.transactionSeq+1&&body.previousHash===this.lastHash,'日志身份、序号或前序哈希不一致');
        valid(text(record.checksum)&&hash(JSON.stringify(body))===record.checksum,'日志校验和不匹配');
        valid(text(body.command?.commandId)&&text(body.command.fingerprint)&&!this.commands.has(body.command.commandId),'日志命令无效或重复');
        valid(body.mutation&&Object.hasOwn(body.mutation,'receipt'),'日志缺少命令回执');
        valid(body.executionProtocol===undefined||body.executionProtocol==='module_owner_v1','不支持的执行协议');
        valid(!this.ownerProtocolSeen||body.executionProtocol==='module_owner_v1','负责人执行协议开始后不能回退旧日志格式');
        const next=this.project(body.mutation,body.command,body.executionProtocol??'legacy');this.publish(body,record.checksum,next);
      }catch(error:any){
        if(error.code==='GRAPH_VERSION_UNSUPPORTED')throw error;
        fail('GRAPH_LOG_CORRUPT','任务派发日志损坏或不满足引用约束，不能继续派发');
      }
    }
    // 仅去掉无完整换行的崩溃尾部；中间空行、完整坏行及断序全部拒绝，不静默跳过。
    if(complete!==bytes.length){const file=await fs.open(this.file,'r+');try{await file.truncate(complete);await file.sync()}finally{await file.close()}}
  }
}
