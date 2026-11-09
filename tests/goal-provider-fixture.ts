import assert from 'node:assert/strict';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';

/** Local provider helpers produce real goal-tool calls; they never mutate scheduler state or invent result identities. */
export interface GoalFixturePlan {objective:string;agentId:string;moduleIds:string[];acceptance:string[];ownerSelection?:OwnerExecutionSelection}
export interface GoalFixtureRequest {messages:{role:string;content:unknown;tool_call_id?:string}[]}

export function goalPlanArguments(plan:GoalFixturePlan,expectedRevision=1){
  const criteria=plan.acceptance.map((text,index)=>({id:'goal-criterion-'+index,text,kind:'evidence' as const}));
  return {expectedRevision,objective:plan.objective,constraints:['只处理授权目标，业务验收仍需核实'],criteria,assignments:[{agentId:plan.agentId,moduleIds:[...plan.moduleIds],...(plan.ownerSelection?{ownerSelection:structuredClone(plan.ownerSelection)}:{}),criterionIds:criteria.map(item=>item.id),reason:'由实际团队角色核实目标模块并提交可追溯证据'}],reason:'先保存总体目标及证据要求，再派发独立执行成员'};
}

/** The selected call must have a real tool response in Pi's model history; errors or missing results fail the fixture. */
export function goalInspection(request:GoalFixtureRequest,callId:string){
  const message=request.messages.find(item=>item.role==='tool'&&item.tool_call_id===callId);
  assert.ok(message,'模型上下文缺少目标检查工具的真实响应：'+callId);
  const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.map(item=>typeof item==='object'&&item&&'text' in item?String(item.text):'').join(''):'';
  let value=JSON.parse(text);
  if(!value.scope&&Array.isArray(value.content))value=JSON.parse(value.content.filter((item:{type:string})=>item.type==='text').map((item:{text:string})=>item.text).join(''));
  assert.equal(typeof value.scope?.scopeId,'string');assert.ok(Number.isSafeInteger(value.scope?.goal?.revision));
  assert.ok(Array.isArray(value.scope.goal.plan?.criteria),'目标检查没有真实持久化计划');assert.ok(Array.isArray(value.graph?.tasks));
  return value as {scope:{scopeId:string;goal:{revision:number;plan:{criteria:{id:string;text:string;kind:'evidence'|'human'}[]}}};graph:GraphSnapshot};
}

export function goalCompleteArguments(request:GoalFixtureRequest,callId:string){
  const {scope,graph}=goalInspection(request,callId),tasks=graph.tasks.filter(task=>task.scopeId===scope.scopeId);
  assert.ok(tasks.length,'完成审阅必须包含本周期真实成员任务');
  const evidence=tasks.map(task=>{
    assert.equal(task.status,'result_ready');assert.ok(task.result);assert.ok(task.result.evidenceRefs.length);
    return {kind:'member-result' as const,taskId:task.taskId,runId:task.result.runId,resultId:task.result.resultId,planRevision:task.result.planRevision,toolCallIds:[...task.result.evidenceRefs]};
  });
  return {expectedRevision:scope.goal.revision,decision:'complete' as const,checks:scope.goal.plan.criteria.map(criterion=>{
    assert.equal(criterion.kind,'evidence','测试不能用模型代替人工验收');
    return {criterionId:criterion.id,outcome:'satisfied' as const,reason:'核对本周期真实任务、结果版本和读取回执；不宣称人工业务验收',evidence};
  }),superseded:[],gaps:[],reason:'已对照当前目标条件核对独立执行者的真实证据'};
}
