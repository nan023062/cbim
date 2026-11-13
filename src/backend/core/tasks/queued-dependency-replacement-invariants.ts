/**
 * 替换边保留可选审阅要求；旧日志按原字段核验，实际领取仍核精确候选批准。
 * 作用定位：校验前置替换的原子审计，以及所有依赖边变更的持久化边界。
 * 设计原因：服务核实证据后仍须防止通用事务绕过换边协议；追加边只能消费先前完整不变量核实的本批许可，退役边与历史审计不可复活。
 * 职责边界：纯状态约束不读取模型日志；canonical 证据与当前知识由提交服务在同一存储屏障内核实。
 * 机制边界：对象递归排序由 utility 提供，本模块保留历史比较器、字段省略和业务指纹规则。
 */
import {orderJsonValue} from '../foundation/utility';
import {fail} from '../foundation/errors';
import type {DispatchState,DispatchMutation,DispatchCommand} from '../dispatch/dispatch-storage';
import type {TaskNode} from './graph-types';
import {dependencyReplacementSchema,type DependencyReplacement} from './queued-dependency-replacement';
import {queuedDependencyReplacementSelection} from './queued-dependency-replacement-rules';

/** 保留本模块历史键排序与 undefined 规则；utility 只提供递归复制机制。 */
const ordered=(value:unknown):unknown=>orderJsonValue(value,{compareKeys:(a,b)=>a.localeCompare(b),omitUndefinedProperties:true});
const equal=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
function valid(value:unknown,message:string):asserts value{if(!value)fail('GRAPH_INPUT_INVALID',message)}

/** 替换审计须对应唯一四项图变更；新增/退役许可只由统一提交入口完整校验追加或多边修订后提供，不能来自请求或回执。 */
export function validateQueuedDependencyReplacement(previous:DispatchState,next:DispatchState,mutation:DispatchMutation,command:DispatchCommand,addedEdges:ReadonlySet<string>=new Set(),retiredEdges:ReadonlySet<string>=new Set()):void{
  const additions:{task:TaskNode;record:DependencyReplacement}[]=[];
  for(const graph of next.graphs)for(const task of graph.tasks){
    const old=previous.graphs.find(value=>value.identity.rootSessionId===graph.identity.rootSessionId)?.tasks.find(value=>value.taskId===task.taskId),history=old?.dependencyReplacements??[],records=task.dependencyReplacements??[];
    valid(records.length>=history.length&&records.length<=history.length+1&&records.length<=32&&history.every((record,index)=>equal(record,records[index])),'前置替换审计只能逐次追加，不能改删历史');
    if(records.length>history.length){valid(old,'不能在新任务上补造历史依赖替换');additions.push({task,record:records.at(-1)!})}
    for(const record of records){
      valid(dependencyReplacementSchema.safeParse(record).success&&record.scopeId===task.scopeId,'前置替换审计身份无效');
      valid(!next.runs?.some(run=>run.binding.runId===record.mainRunId),'替换审计不能冒用成员运行身份');
    }
  }
  valid(additions.length<=1,'单次事务只能替换一个任务的一条前置');
  const addition=additions[0];
  if(addition){
    const {task,record}=addition;
    const selected=queuedDependencyReplacementSelection(previous,task.identity,record.scopeId,{expectedGraphCursor:record.graphCursor,expectedGoalRevision:record.goalRevision,target:{taskId:task.taskId,expectedRevision:record.previousTaskRevision,expectedPlanRevision:record.targetPlanRevision},replace:{edgeId:record.retired.edgeId,expectedRevision:record.retired.revision},with:{taskId:record.replacement.sourceTaskId,expectedRevision:record.replacement.sourceTaskRevision,expectedPlanRevision:record.replacement.sourcePlanRevision,runId:record.replacement.runId,resultId:record.replacement.resultId},reason:record.reason});
    const {graph,scope,target,source,replacement,edge,tasks,members,status}=selected,batch=mutation.batch;
    valid(batch&&batch.cause==='dependency.changed'&&batch.commandId===command.commandId&&record.commandId===command.commandId,'换边必须由同一主调度命令原子提交');
    valid(scope.runTracking?.mainRunIds.includes(record.mainRunId),'替换主运行没有登记在本周期，旧周期不能补造审计');
    valid(record.goalPlanRevision===scope.goal!.plan!.revision&&record.knowledgeRevision===scope.goal!.plan!.knowledgeRevision,'换边目标计划或知识版本不一致');
    valid(equal(record.retired,{edgeId:edge.edgeId,revision:edge.revision,sourceTaskId:source.taskId,sourcePlanRevision:source.planRevision,...(edge.condition.resultId?{resultId:edge.condition.resultId}:{})}),'退役依赖审计与原边不一致');
    valid(!graph.edges.some(value=>value.edgeId===record.replacement.edgeId)&&record.replacement.edgeId!==record.retired.edgeId,'新依赖必须具有全新身份');
    valid(equal(record.trackedTaskIds,tasks.map(value=>value.taskId)),'必须记录目标及全部未启动依赖后继，不能遗漏或扩大');
    valid(Date.parse(record.replacedAt)>=Date.parse(target.updatedAt)&&Date.parse(record.replacedAt)<=Date.parse(batch.committedAt),'换边时间不能早于任务或晚于提交');
    valid(equal(task,{...target,revision:target.revision+1,status,updatedAt:record.replacedAt,waitReason:status==='waiting'?'等待其余前置任务的有效结果':undefined,dependencyReplacements:[...(target.dependencyReplacements??[]),record]}),'换边只能更新目标版本、等待状态与审计，不能修改计划或执行身份');
    valid(!mutation.scopes?.length&&!mutation.sessions?.length&&!mutation.runs?.length&&!mutation.messages?.length&&mutation.members?.length===1&&batch.changes.length===4,'换边不得顺带改写周期、信封、运行或其他成员');
    const member=members.find(value=>value.agentInstanceId===target.assignee.agentInstanceId)!,view=graph.agents.find(value=>value.agentInstanceId===member.agentInstanceId)!;
    valid(equal(mutation.members[0],{...member,activity:status==='waiting'?'waiting':'idle',waitingTaskIds:status==='waiting'?[target.taskId]:[]}),'换边只能重算目标成员的本任务等待状态');
    const changes=batch.changes;
    valid(changes.some(value=>value.type==='task.upserted'&&equal(value.task,task)),'换边缺少同批目标节点');
    valid(changes.some(value=>value.type==='agent.upserted'&&equal(value.agent,{...view,revision:view.revision+1,state:status==='waiting'?'waiting':'idle',runningTaskId:undefined,waitingTaskIds:status==='waiting'?[target.taskId]:[]})),'换边缺少同批目标成员投影');
    valid(changes.some(value=>value.type==='edge.upserted'&&equal(value.edge,{...edge,revision:edge.revision+1,enabled:false})),'原边必须原样退役，不能删除或改写门禁');
    valid(changes.some(value=>value.type==='edge.upserted'&&equal(value.edge,{edgeId:record.replacement.edgeId,identity:graph.identity,kind:'dependency',fromNodeId:replacement.nodeId,toNodeId:target.nodeId,revision:1,enabled:true,condition:{kind:'result_ready',planRevision:replacement.planRevision,resultId:replacement.result!.resultId,...(value.edge.kind==='dependency'&&value.edge.condition.reviewRequired?{reviewRequired:true}:{})}})),'新边必须锁定真实候选的计划与结果身份');
  }
  // 所有普通图事务也经过此门禁。创建新任务可设初始依赖；已有依赖仅允许正式换边或真实首次领取固定候选。
  const batch=mutation.batch;if(!batch)return;
  const graph=previous.graphs.find(value=>value.identity.rootSessionId===batch.identity.rootSessionId);if(!graph)return;
  for(const change of batch.changes){
    if(change.type!=='edge.upserted'||change.edge.kind!=='dependency')continue;
    const edge=change.edge,old=graph.edges.find(value=>value.edgeId===edge.edgeId);
    if(!old){
      const target=graph.tasks.find(value=>value.nodeId===edge.toNodeId);
      valid(!target||addition?.record.replacement.edgeId===edge.edgeId||addedEdges.has(edge.edgeId),'既有任务增加依赖必须通过已完整核实的追加或替换审计');
      continue;
    }
    valid(old.kind==='dependency'&&old.enabled,'退役依赖已封存，不能重新启用或修改');
    if(!edge.enabled){valid(addition?.record.retired.edgeId===edge.edgeId||retiredEdges.has(edge.edgeId),'禁用依赖必须同时提交完整替换或修订审计');continue}
    const target=graph.tasks.find(value=>value.nodeId===edge.toNodeId),source=graph.tasks.find(value=>value.nodeId===edge.fromNodeId);
    const run=mutation.runs?.find(value=>value.binding.taskId===target?.taskId&&value.binding.rootSessionId===graph.identity.rootSessionId&&!previous.runs?.some(prior=>prior.binding.runId===value.binding.runId));
    valid(target&&source?.result&&run?.status==='starting'&&mutation.messages?.some(value=>value.kind==='assignment'&&value.taskId===target.taskId&&value.delivery==='claimed'&&value.claim?.runId===run.binding.runId),'普通依赖更新仅允许首次领取原子固定前置候选');
    valid(equal(edge,{...old,revision:old.revision+1,condition:{...old.condition,resultId:source.result.resultId}}),'领取不能更改前置计划、端点或启用状态');
  }
}
