/**
 * 全项目隐式模块只允许与匹配的 no_modules 兜底绑定并存；真实模块仍须核实岗位责任与流程。
 * 作用定位：任务图的纯领域校验，完整图与单项公开查询共用节点状态规则，并检查身份、派发父关系及依赖/等待无环。
 * 设计原因：存储重放与新提交共用局部结构规则；多段检查点和预约按原运行顺序核对，依赖增删保留原版本与退役边，不以创建顺序代替防环。
 * 职责边界：结构通过不等于任务已获授权，调度层仍需核实来源。
 * 历史维护字段仅兼容原记录；新执行资格不再依赖真人，岗位责任和冻结身份校验继续生效。
 */
import {automaticExecutionBindingSchema,automaticExecutionBindingMatches} from '../team/automatic-execution';
import {z} from 'zod';
import {queuedTaskCancellationSchema} from './queued-task-cancel';
import {fail} from '../foundation/errors';
import type {AgentRef,GraphEventBatch,GraphIdentity,GraphSnapshot,TaskNode} from './graph-types';
import {memberHelpRecordSchema} from './member-help';
import {dependencyReplacementSchema} from './queued-dependency-replacement';
import {dependencyAdditionSchema} from './queued-dependency-addition';
import {dependencyRevisionSchema} from './queued-dependency-revision';
import {memberCheckpointRecordSchema,memberCheckpointLimit} from './member-checkpoint';
import {validMemberCheckpointChain,memberResumeRequests,currentMemberResumeRequest} from './member-checkpoint-chain';
import {memberResumeRequestSchema} from './queued-member-resume';
import {checkpointAbandonmentSchema} from './checkpoint-handoff';
import {workflowSelectionsSchema,validateTaskWorkflowSelections} from './workflow-selection';
import {ownerExecutionBindingSchema,ownerExecutionBindingMatches} from '../team/member-execution-binding';

const text=z.string().trim().min(1).max(100000);
const id=z.string().min(1).max(512).refine(s=>s.trim()===s&&!/[\x00-\x1f]/.test(s));
const revision=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sequence=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const time=z.string().datetime();
const identity=z.object({workspaceId:id,rootSessionId:id}).strict();
const agent=z.object({agentId:id,agentInstanceId:id,agentSessionId:id,name:text}).strict();
const moduleBinding=z.object({moduleId:id,name:text,knowledgeRevision:id,maintenanceBindingId:id.optional(),
  maintainerPersonIds:z.array(id).optional(),workflow:z.discriminatedUnion('kind',[
    z.object({kind:z.literal('module'),id,version:id}).strict(),
    z.object({kind:z.literal('general'),id,version:id,reason:text}).strict(),
  ])}).strict();
const root=z.object({kind:z.literal('session-root'),nodeId:id,identity,agent,revision,createdAt:time}).strict();
const task=z.object({kind:z.literal('task'),nodeId:id,taskId:id,identity,scopeId:id.optional(),parentTaskId:id.optional(),requester:agent,assignee:agent,
  modules:z.array(moduleBinding).min(1),workflowSelections:workflowSelectionsSchema.optional(),ownerBinding:ownerExecutionBindingSchema.optional(),fallbackBinding:automaticExecutionBindingSchema.optional(),goal:text,acceptance:z.array(z.object({id,text}).strict()).min(1),
  revision,planRevision:revision,status:z.enum(['planned','queued','running','waiting','result_ready','blocked','failed','cancelled','interrupted','checkpointed']),
  awaitedChildren:z.array(z.object({taskId:id,planRevision:revision}).strict()),waitReason:text.optional(),runIds:z.array(id),activeRunId:id.optional(),
  result:z.object({resultId:id,runId:id,planRevision:revision,summary:text,evidenceRefs:z.array(id),limitations:z.array(text),acceptance:z.literal('not_evaluated')}).strict().optional(),
  help:memberHelpRecordSchema.optional(),
  checkpoints:z.array(memberCheckpointRecordSchema).min(1).max(memberCheckpointLimit).optional(),resumeRequest:memberResumeRequestSchema.optional(),resumeHistory:z.array(memberResumeRequestSchema).min(1).max(memberCheckpointLimit-1).optional(),
  checkpointAbandonment:checkpointAbandonmentSchema.optional(),
  cancelledBeforeStart:queuedTaskCancellationSchema.optional(),
  dependencyReplacements:z.array(dependencyReplacementSchema).min(1).max(32).optional(),
  dependencyAdditions:z.array(dependencyAdditionSchema).min(1).max(32).optional(),
  dependencyRevisions:z.array(dependencyRevisionSchema).min(1).max(32).optional(),
  createdAt:time,updatedAt:time}).strict();
const edgeBase={edgeId:id,identity,fromNodeId:id,toNodeId:id,revision,enabled:z.boolean()};
const edge=z.discriminatedUnion('kind',[
  z.object({...edgeBase,kind:z.literal('dispatch')}).strict(),
  z.object({...edgeBase,kind:z.literal('dependency'),condition:z.object({kind:z.literal('result_ready'),planRevision:revision,resultId:id.optional()}).strict()}).strict(),
]);
const agentView=z.object({agentInstanceId:id,agentId:id,name:text,revision,state:z.enum(['idle','working','waiting','communicating']),runningTaskId:id.optional(),waitingTaskIds:z.array(id)}).strict();
const cursor=z.object({workspaceId:id,rootSessionId:id,streamId:id,seq:sequence}).strict();
const change=z.discriminatedUnion('type',[
  z.object({type:z.literal('root.upserted'),root}).strict(),
  z.object({type:z.literal('task.upserted'),task}).strict(),
  z.object({type:z.literal('edge.upserted'),edge}).strict(),
  z.object({type:z.literal('agent.upserted'),agent:agentView}).strict(),
]);
const batch=z.object({version:z.literal(1),identity,streamId:id,seq:revision,eventId:id,commandId:id,
  cause:z.enum(['graph.created','task.created','task.dispatched','task.started','task.waiting','task.result_ready','task.blocked','task.failed','task.cancelled','task.interrupted','task.revised','task.reconciled','dependency.changed','message.accepted','message.processed','agent.state_changed','task.checkpointed','task.resume_requested']),
  committedAt:time,changes:z.array(change).min(1).max(1000)}).strict();
const snapshot=z.object({version:z.literal(1),identity,cursor,root,tasks:z.array(task),edges:z.array(edge),agents:z.array(agentView)}).strict();

/** 主调度公开输出复用真实图字段，避免输出边界另造一套会漂移的任务协议。 */
export const taskNodeSchema=task.superRefine((value,context)=>{try{validateTaskNode(value)}catch{context.addIssue({code:'custom',message:'任务节点局部关系无效'})}});
/** Schema 检查字段；完整图的身份、引用和 DAG 规则仍由 validateGraph 统一校验。 */
export const graphSnapshotSchema=snapshot;
export const graphCursorSchema=cursor;

function shape(schema:z.ZodTypeAny,value:unknown){const result=schema.safeParse(value);if(!result.success)fail('GRAPH_INPUT_INVALID',`任务图字段无效：${result.error.issues[0]?.path.join('.')??''}`)}
/** 严格校验公开身份，不允许空串、未知字段或隐式工作区切换。 */
export function validateGraphIdentity(value:GraphIdentity){shape(identity,value)}
/** 在批次进入持久化或 reducer 前检查协议版本和数据形状。 */
export function validateGraphBatch(value:GraphEventBatch){
  if(value?.version!==1)fail('GRAPH_VERSION_UNSUPPORTED','不支持的任务图事件版本');
  shape(batch,value);
}
/** delta 的身份必须先匹配，不能借 reset 切换会话。 */
export function assertGraphIdentity(expected:GraphIdentity,actual:GraphIdentity){
  validateGraphIdentity(expected);validateGraphIdentity({workspaceId:actual.workspaceId,rootSessionId:actual.rootSessionId});
  if(expected.workspaceId!==actual.workspaceId||expected.rootSessionId!==actual.rootSessionId)fail('GRAPH_IDENTITY_MISMATCH','任务图工作区或主会话身份不匹配');
}
/** 校验外部游标形状；seq=0 仅表示当前流的空前缀。 */
export function validateGraphCursor(value:unknown){shape(cursor,value)}
function unique(values:string[],label:string){if(new Set(values).size!==values.length)fail('GRAPH_INPUT_INVALID',`${label}出现重复身份`)}
function sameMember(left:AgentRef,right:AgentRef){return left.agentId===right.agentId&&left.agentInstanceId===right.agentInstanceId&&left.agentSessionId===right.agentSessionId}
function acyclic(nodes:string[],edges:[string,string][],code:string){
  const incoming=new Map(nodes.map(n=>[n,0])),outgoing=new Map<string,string[]>();
  for(const [from,to] of edges){incoming.set(to,(incoming.get(to)??0)+1);outgoing.set(from,[...(outgoing.get(from)??[]),to])}
  const queue=nodes.filter(n=>incoming.get(n)===0);let seen=0;
  for(let i=0;i<queue.length;i++){const from=queue[i];seen++;for(const to of outgoing.get(from)??[]){const n=incoming.get(to)!-1;incoming.set(to,n);if(n===0)queue.push(to)}}
  if(seen!==nodes.length)fail(code,code==='GRAPH_WAIT_CYCLE'?'任务等待关系形成互等':'任务派发与依赖形成循环');
}
/** 仅当前计划的真实候选可满足前置；有固定 resultId 时不能换用其它结果。 */
export function usableResult(task:TaskNode,planRevision:number,resultId?:string){return task.status==='result_ready'&&task.result?.planRevision===planRevision&&task.planRevision===planRevision&&(!resultId||task.result.resultId===resultId)}

/** 单项查询与完整图共用节点自身可核实的不变量；跨节点、图流及边关系仍由 validateGraph 核验。 */
export function validateTaskNode(t:TaskNode):void {
  shape(task,t);
  if(t.nodeId!==`task:${t.taskId}`)fail('GRAPH_INPUT_INVALID','任务 ID 与节点 ID 不一致');
  unique(t.modules.map(m=>m.moduleId),'任务模块');unique(t.acceptance.map(a=>a.id),'验收要求');unique(t.runIds,'执行轮次');unique(t.awaitedChildren.map(c=>c.taskId),'等待子任务');
  validateTaskWorkflowSelections(t.workflowSelections,t.modules);
  if(t.ownerBinding&&!ownerExecutionBindingMatches(t.ownerBinding,t.identity.workspaceId,t.assignee.agentId,t.modules.map(module=>module.moduleId)))fail('GRAPH_INPUT_INVALID','任务的冻结负责人不属于其工作区、角色或模块');
  if(t.fallbackBinding&&(t.ownerBinding||!automaticExecutionBindingMatches(t.fallbackBinding,t.identity.workspaceId,t.scopeId,t.assignee.agentId,t.modules.map(m=>m.moduleId))))fail('GRAPH_INPUT_INVALID','自动执行任务身份或模块不一致');
  if(t.activeRunId&&!t.runIds.includes(t.activeRunId))fail('GRAPH_INPUT_INVALID','活动轮次不属于该任务');
  if(t.result&&(t.result.planRevision!==t.planRevision||!t.runIds.includes(t.result.runId)||t.status!=='result_ready'))fail('GRAPH_INPUT_INVALID','任务候选结果已失效或不属于该执行');
  if(t.status==='result_ready'&&!t.result)fail('GRAPH_INPUT_INVALID','可交接任务缺少真实候选结果');
  if(t.help){const binding=t.help.binding;if(t.result||t.status!=='blocked'||t.activeRunId||!t.scopeId||binding.workspaceId!==t.identity.workspaceId||binding.rootSessionId!==t.identity.rootSessionId||binding.taskId!==t.taskId||binding.planRevision!==t.planRevision||!t.runIds.includes(binding.runId)||binding.agentId!==t.assignee.agentId||binding.agentInstanceId!==t.assignee.agentInstanceId||binding.agentSessionId!==t.assignee.agentSessionId)fail('GRAPH_INPUT_INVALID','成员求助必须绑定本周期已结束的执行任务，且不能作为成功候选')}
  if(!validMemberCheckpointChain(t))fail('GRAPH_INPUT_INVALID','检查点与预约必须形成有界、无重复且连续的原运行链');
  const checkpoint=t.checkpoints?.at(-1),request=currentMemberResumeRequest(t);
  for(const record of t.checkpoints??[]){const binding=record.binding;if(!t.scopeId||t.help?.binding.runId===binding.runId||t.cancelledBeforeStart||binding.workspaceId!==t.identity.workspaceId||binding.rootSessionId!==t.identity.rootSessionId||binding.taskId!==t.taskId||binding.planRevision!==t.planRevision||!sameMember(t.assignee,{...binding,name:''})||t.result?.runId===binding.runId)fail('GRAPH_INPUT_INVALID','检查点必须保留同任务原实例，不能替代交付')}
  if(t.status==='checkpointed'&&(!checkpoint||t.runIds.at(-1)!==checkpoint.binding.runId||t.activeRunId||t.result||request))fail('GRAPH_INPUT_INVALID','当前检查点必须是尚未预约的最新完成段');
  for(const reserved of memberResumeRequests(t))if(reserved.scopeId!==t.scopeId||reserved.previousTaskRevision>=t.revision||reserved.trackedTaskIds[0]!==t.taskId||Date.parse(reserved.requestedAt)>Date.parse(t.updatedAt))fail('GRAPH_INPUT_INVALID','续执行预约缺少固定任务或有效版本');
  if(checkpoint&&(t.activeRunId&&t.activeRunId!==t.runIds.at(-1)||t.result&&t.result.runId!==t.runIds.at(-1)||t.help&&t.help.binding.runId!==t.runIds.at(-1)))fail('GRAPH_INPUT_INVALID','活动、交付或求助只能属于检查点链末段');
  if(t.checkpointAbandonment){const record=t.checkpointAbandonment;if(t.status!=='cancelled'||!checkpoint||t.runIds.at(-1)!==checkpoint.binding.runId||t.activeRunId||t.result||t.help||t.cancelledBeforeStart||t.awaitedChildren.length||record.scopeId!==t.scopeId||record.checkpointId!==checkpoint.checkpointId||record.sourceRunId!==checkpoint.binding.runId||record.resumeRequestId!==(request?.requestId??null)||record.planRevision!==t.planRevision||record.previousTaskRevision+1!==t.revision||record.previousLeaseEpoch!==checkpoint.binding.leaseEpoch||record.abandonedAt!==t.updatedAt||t.waitReason!==record.reason)fail('GRAPH_INPUT_INVALID','交接放弃必须保留最新检查点、任务版本和租约来源')}
  if(t.cancelledBeforeStart){const record=t.cancelledBeforeStart;if(t.status!=='cancelled'||t.runIds.length||t.activeRunId||t.result||t.help||t.awaitedChildren.length||!t.scopeId||record.scopeId!==t.scopeId||record.previousRevision+1!==t.revision||record.cancelledAt!==t.updatedAt||t.waitReason!==record.reason)fail('GRAPH_INPUT_INVALID','未启动撤销记录与任务终态、版本不一致')}
  const replacements=t.dependencyReplacements??[];unique(replacements.map(record=>record.commandId),'前置替换命令');unique(replacements.map(record=>record.retired.edgeId),'退役依赖');
  for(let index=0;index<replacements.length;index++){
    const record=replacements[index],prior=replacements[index-1];
    if(record.scopeId!==t.scopeId||record.targetPlanRevision>t.planRevision||record.previousTaskRevision>=t.revision||record.trackedTaskIds[0]!==t.taskId||Date.parse(record.replacedAt)>Date.parse(t.updatedAt)||prior&&(prior.previousTaskRevision>=record.previousTaskRevision||prior.graphCursor.seq>=record.graphCursor.seq))fail('GRAPH_INPUT_INVALID','前置替换历史与任务版本不一致');
  }
  const additions=t.dependencyAdditions??[];unique([...replacements,...additions].map(record=>record.commandId),'前置修订命令');unique([...replacements,...additions].map(record=>String(record.previousTaskRevision)),'前置修订任务版本');unique(additions.map(record=>record.dependency.edgeId),'追加依赖');
  for(let index=0;index<additions.length;index++){
    const record=additions[index],prior=additions[index-1];
    if(record.scopeId!==t.scopeId||record.targetPlanRevision>t.planRevision||record.previousTaskRevision>=t.revision||record.dependency.sourceTaskId===t.taskId||!record.trackedTaskIds.includes(t.taskId)||!record.trackedTaskIds.includes(record.dependency.sourceTaskId)||Date.parse(record.addedAt)<Date.parse(t.createdAt)||Date.parse(record.addedAt)>Date.parse(t.updatedAt)||prior&&(prior.previousTaskRevision>=record.previousTaskRevision||prior.graphCursor.seq>=record.graphCursor.seq))fail('GRAPH_INPUT_INVALID','前置追加历史与任务版本或闭包身份不一致');
  }
  const revisions=t.dependencyRevisions??[];
  unique([...replacements,...additions,...revisions].map(r=>r.commandId),'前置变更命令');
  unique([...replacements,...additions].map(r=>String(r.previousTaskRevision)).concat(revisions.map(r=>String(r.request.target.expectedRevision))),'前置变更版本');
  unique([...replacements.map(r=>r.retired.edgeId),...revisions.flatMap(r=>r.removed.map(e=>e.edgeId))],'前置退役边');
  unique([...additions.map(r=>r.dependency.edgeId),...replacements.map(r=>r.replacement.edgeId),...revisions.flatMap(r=>r.added.map(e=>e.edgeId))],'前置新增边');
  for(let i=0;i<revisions.length;i++){
    const r=revisions[i],q=r.request,p=revisions[i-1];
    if(r.scopeId!==t.scopeId||q.target.taskId!==t.taskId||q.target.expectedRevision>=t.revision||q.target.expectedPlanRevision>t.planRevision||r.goalPlanRevision!==q.expectedGoalRevision||!r.trackedTaskIds.includes(t.taskId)||[...r.removed,...r.added].some(e=>e.sourceTaskId===t.taskId||!r.trackedTaskIds.includes(e.sourceTaskId))||Date.parse(r.revisedAt)<Date.parse(t.createdAt)||Date.parse(r.revisedAt)>Date.parse(t.updatedAt)||p&&(p.request.target.expectedRevision>=q.target.expectedRevision||p.request.expectedGraphCursor.seq>=q.expectedGraphCursor.seq))fail('GRAPH_INPUT_INVALID','前置修订历史与原任务或图版本不一致');
    if(r.removed.length!==q.remove.length||r.added.length!==q.add.length||r.removed.some((e,i)=>e.edgeId!==q.remove[i].edgeId||e.edgeRevision!==q.remove[i].expectedRevision)||r.added.some((e,i)=>e.sourceTaskId!==q.add[i].taskId||e.sourceTaskRevision!==q.add[i].expectedRevision||e.sourcePlanRevision!==q.add[i].expectedPlanRevision))fail('GRAPH_INPUT_INVALID','修订审计与原增删请求不一致');
  }
}

/**
 * 验证完整的已提交投影；允许端点在同批创建后一起验证，不读取文件或修改传入对象。
 * 这里只检验结构事实，不实现未来结果提交、取消或执行状态机。
 */
export function validateGraph(value:GraphSnapshot):void {
  if(value?.version!==1)fail('GRAPH_VERSION_UNSUPPORTED','不支持的任务图版本');
  shape(snapshot,value);assertGraphIdentity(value.identity,value.cursor);assertGraphIdentity(value.identity,value.root.identity);
  if(value.cursor.seq<1||value.root.nodeId!==`session:${value.identity.rootSessionId}`||value.root.agent.agentId!=='cbim:main')fail('GRAPH_INPUT_INVALID','任务图必须具有主 Agent 会话根和已提交游标');
  unique(value.tasks.map(t=>t.taskId),'任务');unique(value.tasks.map(t=>t.nodeId),'节点');unique(value.edges.map(e=>e.edgeId),'连线');unique(value.agents.map(a=>a.agentInstanceId),'成员');
  const tasks=new Map(value.tasks.map(t=>[t.taskId,t])),byNode=new Map(value.tasks.map(t=>[t.nodeId,t]));
  const agentViews=new Map(value.agents.map(a=>[a.agentInstanceId,a]));
  const nodes=[value.root.nodeId,...value.tasks.map(t=>t.nodeId)];unique(nodes,'图节点');
  const dispatchCounts=new Map<string,number>(),activeLinks:string[]=[],waits:[string,string][]=[];
  const checkAgent=(ref:AgentRef)=>{if(agentViews.get(ref.agentInstanceId)?.agentId!==ref.agentId)fail('GRAPH_INPUT_INVALID','任务引用了未注册或不一致的成员投影')};
  checkAgent(value.root.agent);
  for(const t of value.tasks){
    assertGraphIdentity(value.identity,t.identity);
    validateTaskNode(t);checkAgent(t.requester);checkAgent(t.assignee);
    const parent=t.parentTaskId?tasks.get(t.parentTaskId):undefined;
    if(t.parentTaskId&&!parent)fail('GRAPH_INPUT_INVALID','派发父任务不存在');
    if(!sameMember(t.requester,parent?.assignee??value.root.agent))fail('GRAPH_INPUT_INVALID','任务请求人不是父节点的责任成员');
    for(const request of memberResumeRequests(t))if(request.graphCursor.streamId!==value.cursor.streamId||request.graphCursor.seq>=value.cursor.seq||request.trackedTaskIds.some(id=>tasks.get(id)?.scopeId!==t.scopeId))fail('GRAPH_INPUT_INVALID','续执行预约不属于当前图历史或后继集合');
    if(t.cancelledBeforeStart){const record=t.cancelledBeforeStart;if(record.graphCursor.streamId!==value.cursor.streamId||record.graphCursor.seq>=value.cursor.seq)fail('GRAPH_INPUT_INVALID','未启动撤销记录与图基线不一致')}
    if(t.checkpointAbandonment){const record=t.checkpointAbandonment;if(record.graphCursor.streamId!==value.cursor.streamId||record.graphCursor.seq>=value.cursor.seq)fail('GRAPH_INPUT_INVALID','检查点放弃不属于当前图历史')}
    const replacements=t.dependencyReplacements??[];
    for(let index=0;index<replacements.length;index++){
      const record=replacements[index],retired=value.edges.find(edge=>edge.edgeId===record.retired.edgeId),fresh=value.edges.find(edge=>edge.edgeId===record.replacement.edgeId);
      if(record.graphCursor.streamId!==value.cursor.streamId||record.graphCursor.seq>=value.cursor.seq||record.trackedTaskIds.some(id=>tasks.get(id)?.scopeId!==t.scopeId))fail('GRAPH_INPUT_INVALID','前置替换历史与后继或图基线不一致');
      if(retired?.kind!=='dependency'||retired.enabled||retired.revision!==record.retired.revision+1||retired.fromNodeId!==`task:${record.retired.sourceTaskId}`||retired.toNodeId!==t.nodeId||retired.condition.planRevision!==record.retired.sourcePlanRevision||retired.condition.resultId!==record.retired.resultId)fail('GRAPH_INPUT_INVALID','退役边与不可变替换审计不一致');
      if(fresh?.kind!=='dependency'||fresh.fromNodeId!==`task:${record.replacement.sourceTaskId}`||fresh.toNodeId!==t.nodeId||fresh.condition.planRevision!==record.replacement.sourcePlanRevision||fresh.condition.resultId!==record.replacement.resultId)fail('GRAPH_INPUT_INVALID','替代边与固定候选审计不一致');
    }
    for(const record of t.dependencyAdditions??[]){
      const source=tasks.get(record.dependency.sourceTaskId),edge=value.edges.find(item=>item.edgeId===record.dependency.edgeId);
      if(record.graphCursor.streamId!==value.cursor.streamId||record.graphCursor.seq>=value.cursor.seq||record.trackedTaskIds.some(id=>tasks.get(id)?.scopeId!==t.scopeId)||!source||source.scopeId!==t.scopeId||source.revision<record.dependency.sourceTaskRevision||source.planRevision<record.dependency.sourcePlanRevision)fail('GRAPH_INPUT_INVALID','前置追加历史不属于当前图或原任务基线');
      if(edge?.kind!=='dependency'||edge.fromNodeId!==source.nodeId||edge.toNodeId!==t.nodeId||edge.condition.planRevision!==record.dependency.sourcePlanRevision)fail('GRAPH_INPUT_INVALID','新增前置与不可变追加审计不一致');
      // 首次领取可 pin 真结果，后续正式替换可退役；不能要求新增边永远未消费或始终启用。
      if(!edge.enabled&&!replacements.some(item=>item.retired.edgeId===edge.edgeId)&&!t.dependencyRevisions?.some(r=>r.removed.some(e=>e.edgeId===edge.edgeId)))fail('GRAPH_INPUT_INVALID','追加的依赖缺少真实退役审计');
    }
    for(const r of t.dependencyRevisions??[]){
      const cursor=r.request.expectedGraphCursor;
      if(cursor.streamId!==value.cursor.streamId||cursor.seq>=value.cursor.seq||r.trackedTaskIds.some(id=>tasks.get(id)?.scopeId!==t.scopeId))fail('GRAPH_INPUT_INVALID','修订历史不属于当前图或原闭包');
      for(const e of [...r.removed,...r.added]){
        const edge=value.edges.find(item=>item.edgeId===e.edgeId),source=tasks.get(e.sourceTaskId);
        if(!source||source.scopeId!==t.scopeId||source.revision<e.sourceTaskRevision||source.planRevision<e.sourcePlanRevision||edge?.kind!=='dependency'||edge.fromNodeId!==source.nodeId||edge.toNodeId!==t.nodeId||edge.condition.planRevision!==e.sourcePlanRevision)fail('GRAPH_INPUT_INVALID','修订边不属于原来源或目标');
        if('edgeRevision' in e){if(typeof e.edgeRevision!=='number'||edge.enabled||edge.revision!==e.edgeRevision+1||edge.condition.resultId)fail('GRAPH_INPUT_INVALID','修订退役边必须保持原未消费状态')}
        else if(!edge.enabled&&!replacements.some(item=>item.retired.edgeId===edge.edgeId)&&!t.dependencyRevisions?.some(later=>later.request.target.expectedRevision>r.request.target.expectedRevision&&later.removed.some(item=>item.edgeId===edge.edgeId)))fail('GRAPH_INPUT_INVALID','修订新增边缺少后续退役审计');
      }
    }
    for(const awaited of t.awaitedChildren){const child=tasks.get(awaited.taskId);if(!child||child.parentTaskId!==t.taskId)fail('GRAPH_INPUT_INVALID','等待的不是当前任务直接派发的子任务');if(!usableResult(child,awaited.planRevision))waits.push([t.nodeId,child.nodeId])}
  }
  for(const e of value.edges){
    assertGraphIdentity(value.identity,e.identity);
    if(!nodes.includes(e.fromNodeId)||!nodes.includes(e.toNodeId)||e.fromNodeId===e.toNodeId)fail('GRAPH_INPUT_INVALID','连线端点缺失或指向自身');
    if(e.kind==='dispatch'){
      const target=byNode.get(e.toNodeId);
      if(!target||!e.enabled||e.fromNodeId!==(target.parentTaskId?`task:${target.parentTaskId}`:value.root.nodeId))fail('GRAPH_INPUT_INVALID','派发边与固定父任务不一致');
      dispatchCounts.set(target.taskId,(dispatchCounts.get(target.taskId)??0)+1);
    }else{
      const from=byNode.get(e.fromNodeId),to=byNode.get(e.toNodeId);
      if(!from||!to)fail('GRAPH_INPUT_INVALID','前置依赖只能连接业务任务');
      if(e.enabled&&!usableResult(from,e.condition.planRevision,e.condition.resultId))waits.push([to.nodeId,from.nodeId]);
    }
    if(e.enabled)activeLinks.push(`${e.kind}:${e.fromNodeId}\0${e.toNodeId}`);
  }
  unique(activeLinks,'启用连线');
  for(const t of value.tasks)if(dispatchCounts.get(t.taskId)!==1)fail('GRAPH_INPUT_INVALID','每个任务必须恰有一条派发入边');
  for(const a of value.agents){
    unique(a.waitingTaskIds,'成员等待任务');
    const owned=(taskId:string)=>tasks.get(taskId)?.assignee.agentInstanceId===a.agentInstanceId;
    if(a.runningTaskId&&(!owned(a.runningTaskId)||tasks.get(a.runningTaskId)?.status!=='running'))fail('GRAPH_INPUT_INVALID','成员活动任务不属于当前图或不是执行中');
    if(a.waitingTaskIds.some(t=>!owned(t)||tasks.get(t)?.status!=='waiting'))fail('GRAPH_INPUT_INVALID','成员等待任务不属于当前图或不是等待中');
  }
  acyclic(nodes,value.edges.filter(e=>e.enabled).map(e=>[e.fromNodeId,e.toNodeId]),'GRAPH_CYCLE');
  acyclic(value.tasks.map(t=>t.nodeId),waits,'GRAPH_WAIT_CYCLE');
}
