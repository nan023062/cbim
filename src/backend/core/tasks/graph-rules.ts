/**
 * 作用定位：任务图的纯领域校验，检查序列化形状、身份、派发父关系及依赖/等待无环。
 * 设计原因：存储重放与新提交必须使用同一套规则，避免图上无环却发生成员互等。
 * 职责边界：结构通过不等于知识维护人已认证或任务已获授权，调度层仍需核实来源。
 */
import {z} from 'zod';
import {fail} from '../foundation/errors';
import type {AgentRef,GraphEventBatch,GraphIdentity,GraphSnapshot,TaskNode} from './graph-types';

const text=z.string().trim().min(1).max(100000);
const id=z.string().min(1).max(512).refine(s=>s.trim()===s&&!/[\x00-\x1f]/.test(s));
const revision=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sequence=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const time=z.string().datetime();
const identity=z.object({workspaceId:id,rootSessionId:id}).strict();
const agent=z.object({agentId:id,agentInstanceId:id,agentSessionId:id,name:text}).strict();
const moduleBinding=z.object({moduleId:id,name:text,knowledgeRevision:id,maintenanceBindingId:id,
  maintainerPersonIds:z.array(id).min(1),workflow:z.discriminatedUnion('kind',[
    z.object({kind:z.literal('module'),id,version:id}).strict(),
    z.object({kind:z.literal('general'),id,version:id,reason:text}).strict(),
  ])}).strict();
const root=z.object({kind:z.literal('session-root'),nodeId:id,identity,agent,revision,createdAt:time}).strict();
const task=z.object({kind:z.literal('task'),nodeId:id,taskId:id,identity,parentTaskId:id.optional(),requester:agent,assignee:agent,
  modules:z.array(moduleBinding).min(1),goal:text,acceptance:z.array(z.object({id,text}).strict()).min(1),
  revision,planRevision:revision,status:z.enum(['planned','queued','running','waiting','result_ready','blocked','failed','cancelled','interrupted']),
  awaitedChildren:z.array(z.object({taskId:id,planRevision:revision}).strict()),waitReason:text.optional(),runIds:z.array(id),activeRunId:id.optional(),
  result:z.object({resultId:id,runId:id,planRevision:revision,summary:text,evidenceRefs:z.array(id),limitations:z.array(text),acceptance:z.literal('not_evaluated')}).strict().optional(),
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
  cause:z.enum(['graph.created','task.created','task.dispatched','task.started','task.waiting','task.result_ready','task.blocked','task.failed','task.cancelled','task.interrupted','task.revised','task.reconciled','dependency.changed','message.accepted','message.processed','agent.state_changed']),
  committedAt:time,changes:z.array(change).min(1).max(1000)}).strict();
const snapshot=z.object({version:z.literal(1),identity,cursor,root,tasks:z.array(task),edges:z.array(edge),agents:z.array(agentView)}).strict();

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
function usableResult(task:TaskNode,planRevision:number,resultId?:string){return task.status==='result_ready'&&task.result?.planRevision===planRevision&&task.planRevision===planRevision&&(!resultId||task.result.resultId===resultId)}

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
    if(t.nodeId!==`task:${t.taskId}`)fail('GRAPH_INPUT_INVALID','任务 ID 与节点 ID 不一致');
    checkAgent(t.requester);checkAgent(t.assignee);unique(t.modules.map(m=>m.moduleId),'任务模块');unique(t.acceptance.map(a=>a.id),'验收要求');unique(t.runIds,'执行轮次');unique(t.awaitedChildren.map(c=>c.taskId),'等待子任务');
    for(const m of t.modules)unique(m.maintainerPersonIds,'模块维护人');
    const parent=t.parentTaskId?tasks.get(t.parentTaskId):undefined;
    if(t.parentTaskId&&!parent)fail('GRAPH_INPUT_INVALID','派发父任务不存在');
    if(!sameMember(t.requester,parent?.assignee??value.root.agent))fail('GRAPH_INPUT_INVALID','任务请求人不是父节点的责任成员');
    if(t.activeRunId&&!t.runIds.includes(t.activeRunId))fail('GRAPH_INPUT_INVALID','活动轮次不属于该任务');
    if(t.result&&(t.result.planRevision!==t.planRevision||!t.runIds.includes(t.result.runId)||t.status!=='result_ready'))fail('GRAPH_INPUT_INVALID','任务候选结果已失效或不属于该执行');
    if(t.status==='result_ready'&&!t.result)fail('GRAPH_INPUT_INVALID','可交接任务缺少真实候选结果');
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
