/**
 * 候选审阅只允许当前主运行按原版本追加；领取新依赖时必须匹配同结果的接受决定。
 * 每个私有检查点证明和交接信封都绑定自己的原运行，逐段记录不能借用第一段证明。
 * 作用定位：在派发事务提交和日志恢复时校验成员执行、任务图和邮箱的联合约束。
 * 设计原因：仅验证每条记录形状不能防止半次领取、重复占用或旧 run 回调；把跨对象约束集中在 Core，磁盘适配器只负责可靠提交。
 * 职责边界：不启动模型、不访问文件、不签发权限；依赖追加与检查点放弃须完整核验后才给通用门禁精确许可，人工保存与显式接续不能冒充完成或自行消费等待。
 * 执行模型允许可选 engine，并核对 Claude Code/Codex 的协议要求；缺省字段不回写旧记录。
 * 机制边界：对象递归排序由 utility 提供，本模块保留历史比较器、字段省略和业务指纹规则。
 */
import {orderJsonValue} from '../../../core/utility';
import {z} from 'zod';
import {candidateAccepted} from './candidate-review';
import {hash,json} from '../../../core/platform/node/serialization';
import {fail} from '../../../core/errors';
import {connectionSchema,modelSchema} from '../../models';
import {loopEngineSchema} from '../../models';
import {validatePreparedDispatchKnowledge} from './execution-context';
import type {DispatchCommand,DispatchMutation,DispatchState,DispatchMessage} from '../../dispatch/rules/dispatch-storage';
import type {DispatchRun} from './dispatch-execution';
import type {AgentRef,GraphIdentity} from './graph-types';
import {validateQueuedTaskCancellation} from './queued-task-cancel-rules';
import {validateQueuedDependencyReplacement} from './queued-dependency-replacement-invariants';
import {validateQueuedDependencyAddition} from './queued-dependency-addition-invariants';
import {validateQueuedDependencyRevision} from './queued-dependency-revision-invariants';
import {memberCheckpointProofSchema,memberResumeFromSchema} from './member-checkpoint';
import {validateMemberCheckpoints} from './member-checkpoint-invariants';
import {validateCheckpointAbandonment} from './checkpoint-handoff-invariants';
import {validateHumanDecisionCommand} from './human-decision-invariants';
import {validateHumanContinuationCommand} from './human-continuation-invariants';

const id=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
const time=z.string().datetime();
const identity=z.object({workspaceId:id,rootSessionId:id}).strict();
const agent=z.object({agentId:id,agentInstanceId:id,agentSessionId:id,name:z.string().min(1)}).strict();
const claim=z.object({runId:id,leaseEpoch:z.number().int().nonnegative().safe()}).strict();
const messageBase=z.object({messageId:id,commandId:id,identity,from:agent,to:agent,taskId:id,planRevision:z.number().int().positive().safe(),createdAt:time,delivery:z.enum(['pending','claimed','processed']),claim:claim.optional()});
const messageShape=z.discriminatedUnion('kind',[
  messageBase.extend({kind:z.literal('assignment'),resumeFrom:memberResumeFromSchema.optional()}).strict(),
  messageBase.extend({kind:z.literal('result'),replyTo:id,resultId:id,runId:id}).strict(),
  messageBase.extend({kind:z.literal('help'),replyTo:id,helpId:id,runId:id}).strict(),
  messageBase.extend({kind:z.literal('checkpoint'),replyTo:id,checkpointId:id,runId:id}).strict(),
]);
const resultShape=z.object({resultId:id,runId:id,planRevision:z.number().int().positive().safe(),summary:z.string().trim().min(1).max(100000),evidenceRefs:z.array(id),limitations:z.array(z.string().trim().min(1).max(100000)),acceptance:z.literal('not_evaluated')}).strict();
const runShape=z.object({binding:z.object({workspaceId:id,teamId:id,agentId:id,agentInstanceId:id,agentSessionId:id,rootSessionId:id,taskId:id,runId:id,leaseEpoch:z.number().int().nonnegative().safe(),planRevision:z.number().int().positive().safe()}).strict(),assignmentMessageId:id,
  resumeFrom:memberResumeFromSchema.optional(),checkpointProof:memberCheckpointProofSchema.optional(),
  status:z.enum(['starting','running','completed','failed','cancelled','interrupted']),prepared:z.unknown(),model:z.record(z.unknown()),permission:z.enum(['read','ask','execute']),
  prerequisites:z.array(z.object({taskId:id,planRevision:z.number().int().positive().safe(),result:resultShape}).strict()).optional(),
  turnTimeoutMs:z.number().int().positive().safe().optional(),session:z.object({nativeSessionId:id,sessionFile:z.string().min(1).max(32768).optional()}).strict(),
  createdAt:time,startedAt:time.optional(),settledAt:time.optional(),error:z.string().min(1).max(10000).optional(),
}).strict();
const active=(run:DispatchRun)=>run.status==='starting'||run.status==='running';
const sameGraph=(a:GraphIdentity,b:GraphIdentity)=>a.workspaceId===b.workspaceId&&a.rootSessionId===b.rootSessionId;
const sameAgent=(a:AgentRef,b:AgentRef)=>a.agentId===b.agentId&&a.agentInstanceId===b.agentInstanceId&&a.agentSessionId===b.agentSessionId;
/** JSON 属性顺序不影响身份；数组顺序仍是冻结输入的一部分。 */
/** 保留本模块历史键排序与 undefined 规则；utility 只提供递归复制机制。 */
const ordered=(value:unknown):unknown=>orderJsonValue(value,{compareKeys:(a,b)=>a.localeCompare(b),omitUndefinedProperties:false});
const equal=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
function valid(condition:unknown,message:string):asserts condition {if(!condition)fail('GRAPH_INPUT_INVALID',message)}
function lookupTask(state:DispatchState,ref:GraphIdentity,taskId:string){return state.graphs.find(graph=>sameGraph(graph.identity,ref))?.tasks.find(task=>task.taskId===taskId)}
function changedTask(mutation:DispatchMutation,ref:GraphIdentity,taskId:string){return mutation.batch&&sameGraph(mutation.batch.identity,ref)&&mutation.batch.changes.some(change=>change.type==='task.upserted'&&change.task.taskId===taskId)}

/** 使用模型现有规则校验可持久化参数，显式拒绝 apiKey 及其他非公开字段。 */
function validateModel(model:DispatchRun['model']){
  valid(Object.keys(model).every(key=>['engine','id','model','name','api','baseUrl','auth','contextWindow','maxTokens','reasoning','vision','outputLimit','thinkingLevel','workingContextWindow','compactionPercent','pricing'].includes(key)),'执行模型参数包含非公开字段');
  // 缺省 Pi 保留旧日志；明确引擎只能选支持的实现，并与协议能力一致。
  valid(model.engine===undefined||loopEngineSchema.safeParse(model.engine).success,'执行引擎无效');
  valid(model.engine!=='claude-code'||model.api==='anthropic-messages','Claude Code 模型协议无效');
  valid(model.engine!=='codex'||model.api==='openai-responses','Codex 模型协议无效');
  const {engine:_engine,name,api,baseUrl,auth,id:profileId,model:modelId,...options}=model;
  valid(typeof profileId==='string'&&profileId.trim()&&typeof modelId==='string'&&modelId.trim(),'执行模型缺少供应商或模型身份');
  valid(connectionSchema.strict().safeParse({name,api,baseUrl,auth}).success&&modelSchema.safeParse({id:modelId,name:modelId,enabled:true,...options}).success,'执行模型参数无效或包含非公开字段');
}

/** 校验单次运行固定输入和状态迁移；历史终态不得被迟到回调改写。 */
function validateRun(previous:DispatchRun|undefined,run:DispatchRun,state:DispatchState,mutation:DispatchMutation){
  valid(runShape.safeParse(run).success,'成员运行记录结构无效');
  validatePreparedDispatchKnowledge(run.prepared);validateModel(run.model);
  const binding=run.binding,member=state.members.find(item=>item.agentInstanceId===binding.agentInstanceId);
  const session=state.sessions.find(item=>item.agentSessionId===binding.agentSessionId);
  const task=lookupTask(state,binding,binding.taskId);
  valid(binding.workspaceId===state.workspaceId&&member&&member.teamId===binding.teamId&&member.agentId===binding.agentId,'成员运行绑定与工作区角色不一致');
  valid(session&&session.agentInstanceId===binding.agentInstanceId&&session.rootSessionId===binding.rootSessionId,'成员运行没有对应的独立通道');
  valid(task&&task.runIds.includes(binding.runId),'运行必须与任务的执行历史一起保存');
  valid(changedTask(mutation,binding,binding.taskId),'运行变化必须与同一任务节点原子提交');
  valid(run.prepared.workspaceId===binding.workspaceId&&run.prepared.agent.teamId===binding.teamId&&run.prepared.agent.agentId===binding.agentId,'运行知识快照属于其他角色');
  valid(task.planRevision===binding.planRevision&&sameAgent(task.assignee,{...binding,name:''})&&equal(task.modules,run.prepared.modules.map(module=>module.binding)),'执行计划、模块或责任成员与冻结快照不一致');
  const assignment=state.outbox.find(message=>message.messageId===run.assignmentMessageId);
  valid(assignment?.kind==='assignment'&&sameGraph(assignment.identity,binding)&&assignment.taskId===binding.taskId&&assignment.planRevision===binding.planRevision&&sameAgent(assignment.to,{...binding,name:''}),'运行必须领取自己的派发信封');
  valid(assignment.claim?.runId===binding.runId&&assignment.claim.leaseEpoch===binding.leaseEpoch,'信封领取与运行租约不一致');
  valid(session.nativeSessionId===undefined||session.nativeSessionId===run.session.nativeSessionId,'原生会话身份与成员通道不一致');
  if(previous){
    const firstCodexBinding=previous.model.engine==='codex'&&previous.status==='starting'&&run.status==='running'&&!previous.resumeFrom&&!previous.session.sessionFile&&previous.session.nativeSessionId===binding.agentSessionId;
    if(firstCodexBinding)valid(!state.runs?.some(other=>other.binding.agentSessionId!==binding.agentSessionId&&other.session.nativeSessionId===run.session.nativeSessionId),'Codex 原生身份已属于另一成员通道');
    const fixed=(item:DispatchRun)=>{const {status:_,startedAt:__,settledAt:___,error:____,session:sessionValue,checkpointProof:_proof,...rest}=item;return {...rest,session:{nativeSessionId:sessionValue.nativeSessionId}}};
    valid(equal(fixed(firstCodexBinding?{...previous,session:{...previous.session,nativeSessionId:run.session.nativeSessionId}}:previous),fixed(run)),'不能修改运行的固定输入或身份');
    valid(!previous.session.sessionFile||previous.session.sessionFile===run.session.sessionFile,'不能改绑已知的原生会话文件');
    valid(!previous.startedAt||previous.startedAt===run.startedAt,'不能改写实际启动时间');
    if(!active(previous))valid(equal(previous,run),'已结算运行不能由迟到回调修改');
    else if(previous.status==='running')valid(run.status!=='starting','运行不能退回启动意图');
    else valid(run.status!=='completed','尚无真实启动事实的执行不能直接完成');
  }else{
    valid(run.status==='starting'&&!run.startedAt&&!run.settledAt,'新运行必须从未启动的领取意图开始');
    valid(member.leaseEpoch===binding.leaseEpoch&&member.configurationRevision===run.prepared.knowledgeRevision,'领取时的成员代际或知识基线已过期');
    const graph=state.graphs.find(item=>sameGraph(item.identity,binding))!;
    const dependencies=graph.edges.filter(edge=>edge.enabled&&edge.kind==='dependency'&&edge.toNodeId===task.nodeId),prerequisites=run.prerequisites??[];
    valid(prerequisites.length===dependencies.length&&new Set(prerequisites.map(item=>item.taskId)).size===prerequisites.length,'冻结前置候选须完整对应任务入向依赖');
    for(const edge of dependencies){
      if(edge.kind!=='dependency')continue;
      const source=graph.tasks.find(item=>item.nodeId===edge.fromNodeId),frozen=prerequisites.find(item=>item.taskId===source?.taskId);
      valid(source?.status==='result_ready'&&frozen&&frozen.planRevision===source.planRevision&&frozen.planRevision===edge.condition.planRevision&&frozen.result.resultId===edge.condition.resultId&&equal(frozen.result,source.result),'领取时须锁定当前计划下的前置候选及结果内容');
      if(edge.condition.reviewRequired)valid(candidateAccepted(source),'领取时前置候选尚未通过主 Agent 审阅');
    }
  }
  for(const prerequisite of run.prerequisites??[])valid(prerequisite.result.planRevision===prerequisite.planRevision,'冻结前置候选的计划版本不一致');
  valid(!run.startedAt||Date.parse(run.startedAt)>=Date.parse(run.createdAt),'实际启动时间不能早于领取意图');
  if(active(run)){
    valid(!run.settledAt&&!run.error,'活动运行不能包含结算信息');
    valid(member.leaseEpoch===binding.leaseEpoch&&member.activeRunId===binding.runId&&member.activeTaskId===binding.taskId,'活动运行必须占用当前成员租约');
    valid(task.activeRunId===binding.runId&&assignment.delivery==='claimed','活动运行必须占用任务并持有已领取信封');
    valid(run.status==='starting'?task.status==='queued'&&member.activity==='communicating':task.status==='running'&&member.activity==='working'&&Boolean(run.startedAt),'领取意图与真实运行状态不一致');
  }else{
    valid(run.settledAt&&Date.parse(run.settledAt)>=Date.parse(run.startedAt??run.createdAt),'终态缺少有效结算时间');
    valid(member.leaseEpoch>=binding.leaseEpoch&&member.activeRunId!==binding.runId&&task.activeRunId!==binding.runId&&assignment.delivery==='processed','终态必须释放成员、任务和信封');
    // 旧检查点轮次可靠结束后保留原状；当前节点可处于续执行或封存，不能反向改写该历史轮次。
    if(run.checkpointProof)valid(run.status==='completed'&&task.checkpoints?.some(cp=>cp.binding.runId===binding.runId),'检查点证明只能属于原已完成轮次');
    else{
      const expected=run.status==='completed'?['result_ready','blocked']:[run.status];
      valid(expected.includes(task.status),'运行终态与任务事实不一致');
      if(task.result)valid(run.status==='completed'&&task.result.runId===binding.runId,'候选结果必须来自本次完成的运行');
      if(task.help)valid(run.status==='completed'&&equal(task.help.binding,binding),'求助必须来自本次正常结束的固定执行身份');
    }
  }
}

/** 校验消息更新的固定信封、单向投递进度及与运行/结果的对应关系。 */
function validateMessage(previous:DispatchMessage|undefined,message:DispatchMessage,state:DispatchState,mutation:DispatchMutation,command:DispatchCommand){
  valid(messageShape.safeParse(message).success,'派发消息结构无效');
  if(message.identity.workspaceId!==state.workspaceId)fail('GRAPH_IDENTITY_MISMATCH','消息不属于当前工作区');
  const task=lookupTask(state,message.identity,message.taskId);
  valid(task,'消息对应的任务不存在');
  if(previous){
    const fixed=(item:DispatchMessage)=>{const {delivery:_,claim:__,...rest}=item;return rest};
    valid(equal(fixed(previous),fixed(message)),'同一消息标识只能更新投递与领取状态');
    valid(previous.delivery!=='processed'||message.delivery==='processed','已消费消息不能重新入队');
    valid(previous.delivery!=='claimed'||message.delivery!=='pending','已领取消息不能退回待投递');
    valid(!previous.claim||equal(previous.claim,message.claim),'已领取消息必须保留原运行与租约');
  }else valid(message.delivery==='pending'&&!message.claim&&message.commandId===command.commandId,'新消息只能是当前命令的待投递信封');
  if(message.kind==='assignment'){
    // 更新历史投递状态时仍需当前计划匹配；旧计划应被显式取消，而非重新领取。
    valid(task.planRevision===message.planRevision&&sameAgent(task.requester,message.from)&&sameAgent(task.assignee,message.to),'信封来源、接收方或计划版本与任务不一致');
    valid(changedTask(mutation,message.identity,message.taskId),'任务信封变化须与任务节点同批提交');
    if(message.delivery==='pending')valid(!message.claim,'待投递信封不能预置领取者');
    else if(message.claim){
      const run=(state.runs??[]).find(item=>item.binding.runId===message.claim!.runId);
      valid(run&&run.assignmentMessageId===message.messageId&&run.binding.leaseEpoch===message.claim.leaseEpoch,'领取信封缺少对应运行');
      valid(message.delivery==='claimed'?active(run):!active(run),'信封消费状态与运行生命周期不一致');
      if(previous?.delivery==='pending')valid(mutation.runs?.some(item=>item.binding.runId===run.binding.runId&&item.status==='starting'),'领取与 starting 意图必须原子提交');
    }else valid(message.delivery==='processed'&&task.status==='cancelled','没有领取的任务信封只能随取消消费');
  }else{
    valid(!message.claim&&message.delivery!=='claimed','结果或求助确认不创建业务运行或领取租约');
    const assignment=state.outbox.find(item=>item.messageId===message.replyTo);
    const run=(state.runs??[]).find(item=>item.binding.runId===message.runId);
    valid(assignment?.kind==='assignment'&&sameGraph(assignment.identity,message.identity)&&assignment.taskId===message.taskId&&sameAgent(assignment.from,message.to)&&sameAgent(assignment.to,message.from),'结果必须返回同一图中原始发送方');
    valid(run&&run.assignmentMessageId===message.replyTo&&run.status==='completed'&&run.binding.planRevision===message.planRevision,'结果消息缺少对应的完成运行');
    if(message.kind==='help')valid(task.help?.helpId===message.helpId&&task.status==='blocked'&&task.help.binding.runId===message.runId&&task.planRevision===message.planRevision,'求助信封只能引用自己的冻结求助记录');
    if(message.kind==='checkpoint')valid(task.checkpoints?.some(cp=>cp.checkpointId===message.checkpointId&&cp.binding.runId===message.runId)&&task.planRevision===message.planRevision,'检查点信封只能引用本任务冻结的可靠交接');
    if(!previous){
      valid(changedTask(mutation,message.identity,message.taskId)&&mutation.runs?.some(item=>item.binding.runId===message.runId&&item.status==='completed'),'交接信封须与正常完成运行原子提交');
      if(message.kind==='result')valid(task.status==='result_ready'&&task.result?.resultId===message.resultId&&task.result.runId===message.runId&&task.result.planRevision===message.planRevision,'结果信封须与候选结果原子提交');
    }
  }
}

/**
 * 对完整候选状态检查活动槽，对变更对象检查不可变字段与生命周期。
 * 旧日志没有 runs 时等同空集合；恢复只验证事实，不自动重发任务或启动执行。
 */
export function validateDispatchExecution(previous:DispatchState,next:DispatchState,mutation:DispatchMutation,command:DispatchCommand):void{
  for(const change of mutation.batch?.changes??[]){
    if(change.type!=='task.upserted')continue;
    const task=change.task,old=lookupTask(previous,task.identity,task.taskId),review=task.candidateReview;
    if(!review||equal(old?.candidateReview,review))continue;
    const scope=previous.scopes?.find(s=>s.scopeId===task.scopeId&&s.rootSessionId===task.identity.rootSessionId&&s.workspaceId===task.identity.workspaceId);
    valid(old?.status==='result_ready'&&!old.activeRunId&&!old.candidateReview&&equal(old.result,task.result)&&task.revision===old.revision+1&&task.planRevision===old.planRevision,'审阅只能追加到未审阅的可靠原候选');
    valid(scope?.status==='active'&&scope.runTracking?.mainRunIds.at(-1)===review.mainRunId&&command.commandId.startsWith('candidate-review-')&&mutation.batch?.cause==='task.revised','审阅只能由当前主运行登记');
    valid(equal({...task,revision:old!.revision,updatedAt:old!.updatedAt,candidateReview:undefined},{...old,candidateReview:undefined})&&review.recordedAt===task.updatedAt,'审阅不能顺带改写任务或候选');
    const input={taskId:task.taskId,expectedRevision:old!.revision,resultId:review.resultId,decision:review.decision,reason:review.reason};
    valid(command.fingerprint===hash(json({identity:task.identity,scopeId:task.scopeId,runId:review.mainRunId,input})),'审阅命令必须匹配当前任务与主运行');
  }
  validateHumanDecisionCommand(previous,mutation,command);
  validateHumanContinuationCommand(previous,mutation,command);
  validateQueuedTaskCancellation(previous,next,mutation,command);
  // 新边和退役许可只能由完整事务校验生成；cause 或审计存在本身不授予变更许可。
  const addedEdges=validateQueuedDependencyAddition(previous,next,mutation,command);
  const revised=validateQueuedDependencyRevision(previous,next,mutation,command);
  validateQueuedDependencyReplacement(previous,next,mutation,command,new Set([...addedEdges,...revised.added]),revised.retired);
  const abandoned=validateCheckpointAbandonment(previous,next,mutation,command);
  validateMemberCheckpoints(previous,next,mutation,command,abandoned);
  const runs=next.runs??[];
  for(const run of mutation.runs??[])validateRun((previous.runs??[]).find(item=>item.binding.runId===run.binding.runId),run,next,mutation);
  for(const message of mutation.messages??[])validateMessage(previous.outbox.find(item=>item.messageId===message.messageId),message,next,mutation,command);
  const occupied=new Set<string>();
  for(const run of runs.filter(active)){
    valid(!occupied.has(run.binding.agentInstanceId),'同一成员不能同时执行多个任务');occupied.add(run.binding.agentInstanceId);
    const member=next.members.find(item=>item.agentInstanceId===run.binding.agentInstanceId),task=lookupTask(next,run.binding,run.binding.taskId);
    valid(member?.activeRunId===run.binding.runId&&member.activeTaskId===run.binding.taskId&&member.leaseEpoch===run.binding.leaseEpoch&&task?.activeRunId===run.binding.runId,'事务不能绕开运行记录改写活动占用');
    valid(task.planRevision===run.binding.planRevision&&sameAgent(task.assignee,{...run.binding,name:''})&&equal(task.modules,run.prepared.modules.map(module=>module.binding)),'活动运行不能修改计划或责任成员');
    valid(run.status==='starting'?task.status==='queued'&&member.activity==='communicating':task.status==='running'&&member.activity==='working','活动任务与成员状态必须和运行阶段一致');
  }
  for(const member of next.members){
    valid(Boolean(member.activeTaskId)===Boolean(member.activeRunId),'成员活动任务与运行必须同时绑定或释放');
    if(member.activeRunId)valid(runs.some(run=>active(run)&&run.binding.runId===member.activeRunId&&run.binding.agentInstanceId===member.agentInstanceId),'成员占用没有对应的活动运行');
    if(member.activity==='working')valid(Boolean(member.activeRunId),'工作中成员必须有真实运行占用');
  }
  const helpIds=new Set<string>(),helpRuns=new Set<string>();
  for(const graph of next.graphs)for(const task of graph.tasks){
    if(task.activeRunId)valid(runs.some(run=>active(run)&&run.binding.runId===task.activeRunId&&sameGraph(run.binding,graph.identity)&&run.binding.taskId===task.taskId),'任务占用没有对应的活动运行');
    if(task.status==='running')valid(Boolean(task.activeRunId),'执行中任务必须有真实运行占用');
    if(task.result&&!previous.graphs.find(item=>sameGraph(item.identity,graph.identity))?.tasks.some(old=>old.taskId===task.taskId&&equal(old.result,task.result))){
      valid((previous.runs??[]).some(run=>active(run)&&run.binding.runId===task.result!.runId),'候选结果只能由本次活动运行结算产生');
      valid(mutation.messages?.some(message=>message.kind==='result'&&!previous.outbox.some(old=>old.messageId===message.messageId)&&sameGraph(message.identity,graph.identity)&&message.taskId===task.taskId&&message.planRevision===task.planRevision&&message.resultId===task.result!.resultId&&message.runId===task.result!.runId),'候选结果必须原子新增对应的结果信封');
    }
    const old=lookupTask(previous,graph.identity,task.taskId);
    if(old?.help)valid(equal(old.help,task.help),'已经交接的求助不能移除、替换或改写');
    if(task.help){
      const help=task.help,run=runs.find(item=>item.binding.runId===help.binding.runId);
      valid(!helpIds.has(help.helpId)&&!helpRuns.has(help.binding.runId),'求助身份和运行不能重复交接');helpIds.add(help.helpId);helpRuns.add(help.binding.runId);
      valid(run?.status==='completed'&&equal(run.binding,help.binding)&&task.status==='blocked'&&!task.result&&!task.activeRunId,'求助须引用已正常结束并释放的同一运行');
      valid(next.outbox.filter(message=>message.kind==='help'&&message.helpId===help.helpId&&message.runId===help.binding.runId&&message.taskId===task.taskId&&sameGraph(message.identity,graph.identity)).length===1,'同一求助必须且只能保留一个交接信封');
      if(!old?.help){
        valid((previous.runs??[]).some(item=>item.status==='running'&&equal(item.binding,help.binding)),'求助只能由当前运行正常结算产生，不能从旧终态补造');
        valid(mutation.messages?.filter(message=>message.kind==='help'&&!previous.outbox.some(prior=>prior.messageId===message.messageId)&&sameGraph(message.identity,graph.identity)&&message.taskId===task.taskId&&message.planRevision===task.planRevision&&message.helpId===help.helpId&&message.runId===help.binding.runId).length===1,'求助必须原子新增唯一的返回信封');
      }
    }
  }
}
