import {describe,expect,it} from 'vitest';
import {workflowSelectionSchema,workflowSelectionsSchema,validateWorkflowSelections,sameWorkflowSelectionsForModules,validateTaskWorkflowSelections} from '../src/backend/core/tasks/workflow-selection';
import {dispatchTaskInput} from '../src/backend/core/tasks/dispatch-commands';
import {goalPlanInputSchema,dispatchScopeGoalSchema} from '../src/backend/core/tasks/scope-goal';
import {humanContinuationSubject,humanContinuationSubjectSchema} from '../src/backend/core/tasks/human-continue';
import {taskNodeSchema,validateGraph} from '../src/backend/core/tasks/graph-rules';
import {applyGraphBatch} from '../src/backend/core/tasks/graph-reducer';
import {mainToolOutputSchema,projectMainScope} from '../src/backend/core/tasks/main-tool-output';
import {checkedJsonToolResult} from '../src/backend/core/tools/results';
import {mainToolBinding,mainToolScope,mainToolTask} from './main-tool-output-fixture';
import type {AgentRef,TaskNode,GraphChange,GraphEventBatch} from '../src/backend/core/tasks/graph-types';

const moduleId='.cbim/workspace/game',otherModule='.cbim/workspace/art',workflowId=moduleId+'/workflows/validate_json',selection={moduleId,workflowId};
const identity={workspaceId:'workspace',rootSessionId:'root'},at='2026-11-07T08:00:00.000Z';
const agent:AgentRef={agentId:'cbim:main',agentInstanceId:'main',agentSessionId:'main-session',name:'主调度'};
const plan={expectedRevision:1,objective:'交付 JSON',constraints:[],criteria:[{id:'check',text:'满足结构',kind:'evidence' as const}],assignments:[{agentId:'cbim:executor',moduleIds:[moduleId,otherModule],criterionIds:['check'],reason:'执行文件任务'}],reason:'明确分工'};
function task(explicit=true):TaskNode{return {kind:'task',taskId:'task',nodeId:'task:task',identity,requester:agent,assignee:agent,modules:[{moduleId,name:'游戏',knowledgeRevision:'knowledge',maintenanceBindingId:'maintenance',maintainerPersonIds:['owner'],workflow:{kind:'module',id:workflowId,version:'frozen-content'}}],...(explicit?{workflowSelections:[selection]}:{}),goal:'交付 JSON',acceptance:[{id:'check',text:'满足结构'}],revision:1,planRevision:1,status:'queued',awaitedChildren:[],runIds:[],createdAt:at,updatedAt:at}}
function batch(seq:number,changes:GraphChange[]):GraphEventBatch{return {version:1,identity,streamId:'stream',seq,eventId:'event-'+seq,commandId:'command-'+seq,cause:seq===1?'graph.created':'task.dispatched',committedAt:at,changes}}
function initial(){return applyGraphBatch(undefined,batch(1,[{type:'root.upserted',root:{kind:'session-root',nodeId:'session:root',identity,agent,revision:1,createdAt:at}},{type:'agent.upserted',agent:{agentInstanceId:agent.agentInstanceId,agentId:agent.agentId,name:agent.name,revision:1,state:'idle',waitingTaskIds:[]}}]))}
function assigned(explicit=true){return applyGraphBatch(initial(),batch(2,[{type:'task.upserted',task:task(explicit)},{type:'edge.upserted',edge:{kind:'dispatch',edgeId:'dispatch',identity,fromNodeId:'session:root',toNodeId:'task:task',revision:1,enabled:true}}]))}

describe('Workflow selection contracts',()=>{
  it('保留路径式知识 ID，拒绝伪造版本/正文、空列表、重复模块及超限',()=>{
    expect(workflowSelectionSchema.parse(selection)).toEqual(selection);
    for(const value of [{...selection,version:'forged'},{...selection,body:'text'},{...selection,workflowId:' '+workflowId}, {...selection,moduleId:'bad\u0000id'}])expect(workflowSelectionSchema.safeParse(value).success).toBe(false);
    for(const value of [[],[selection,selection],Array.from({length:51},(_,i)=>({moduleId:'module-'+i,workflowId:'workflow-'+i})),null])expect(workflowSelectionsSchema.safeParse(value).success).toBe(false);
    expect(()=>validateWorkflowSelections([moduleId,otherModule],[selection])).not.toThrow();expect(()=>validateWorkflowSelections([otherModule],[selection])).toThrow(expect.objectContaining({code:'WORKFLOW_SELECTION_INVALID'}));
    expect(()=>validateWorkflowSelections([],undefined)).not.toThrow();expect(()=>validateWorkflowSelections([moduleId,moduleId],undefined)).toThrow();
  });
  it('默认不是通配，部分模块按目标投影比较而不改变原子集匹配',()=>{
    expect(sameWorkflowSelectionsForModules(undefined,undefined,[moduleId])).toBe(true);
    expect(sameWorkflowSelectionsForModules([selection],undefined,[moduleId])).toBe(false);expect(sameWorkflowSelectionsForModules(undefined,[selection],[moduleId])).toBe(false);
    const extra={moduleId:otherModule,workflowId:otherModule+'/workflows/review'};
    expect(sameWorkflowSelectionsForModules([extra,selection],[selection],[moduleId])).toBe(true);
    expect(sameWorkflowSelectionsForModules([selection],undefined,[otherModule])).toBe(true);
    expect(sameWorkflowSelectionsForModules([extra,selection],[selection,extra],[moduleId,otherModule])).toBe(true);
    expect(sameWorkflowSelectionsForModules([selection],[{...selection,workflowId:'other'}],[moduleId])).toBe(false);
    expect(sameWorkflowSelectionsForModules([selection,selection],[selection],[moduleId])).toBe(false);
  });
  it('目标与派发拒绝跨模块选择，缺省输入和已存目标不补空字段',()=>{
    const draft=goalPlanInputSchema.parse(plan);expect(draft.assignments[0]).not.toHaveProperty('workflowSelections');
    expect(goalPlanInputSchema.safeParse({...plan,assignments:[{...plan.assignments[0],workflowSelections:[selection]}]}).success).toBe(true);
    expect(goalPlanInputSchema.safeParse({...plan,assignments:[{...plan.assignments[0],moduleIds:[otherModule],workflowSelections:[selection]}]}).success).toBe(false);
    const input={...identity,commandId:'assign',expectedParentRevision:1,task:{assigneeAgentId:'cbim:executor',moduleIds:[moduleId],goal:'交付 JSON',acceptance:[{id:'check',text:'满足结构'}],prerequisites:[]}};
    expect(dispatchTaskInput.parse(input).task).not.toHaveProperty('workflowSelections');expect(dispatchTaskInput.safeParse({...input,task:{...input.task,workflowSelections:[selection]}}).success).toBe(true);
    expect(dispatchTaskInput.safeParse({...input,task:{...input.task,moduleIds:[otherModule],workflowSelections:[selection]}}).success).toBe(false);
    const stored={revision:2,input:{message:'交付 JSON',attachmentIds:[]},plan:{objective:plan.objective,constraints:[],criteria:plan.criteria,assignments:[{...plan.assignments[0],agentName:'执行者',teamId:'team',moduleNames:['游戏','美术']}],reason:'分工',revision:2,runId:'main-run',recordedAt:at,knowledgeRevision:'knowledge',graphCursor:{streamId:'stream',seq:1}}};
    expect(dispatchScopeGoalSchema.parse(stored)).toEqual(stored);expect(dispatchScopeGoalSchema.safeParse({...stored,plan:{...stored.plan,assignments:[{...stored.plan.assignments[0],workflowSelections:[{moduleId:'foreign',workflowId}]}]}}).success).toBe(false);
  });
  it('主角色保留模块知识治理，但输入、持久目标、人工主体和严格输出不能声明执行业务流程',()=>{
    const governance={...plan,assignments:[{...plan.assignments[0],agentId:'cbim:main'}]},invalid={...governance,assignments:[{...governance.assignments[0],workflowSelections:[selection]}]};
    expect(goalPlanInputSchema.parse(governance).assignments[0]).not.toHaveProperty('workflowSelections');expect(goalPlanInputSchema.safeParse(invalid).success).toBe(false);
    const original=mainToolScope(mainToolBinding,governance),bad=mainToolScope(mainToolBinding,invalid);expect(dispatchScopeGoalSchema.safeParse(original.goal).success).toBe(true);expect(dispatchScopeGoalSchema.safeParse(bad.goal).success).toBe(false);
    const subject={objective:governance.objective,constraints:governance.constraints,criteria:governance.criteria,assignments:governance.assignments.map(({reason:_,...assignment})=>assignment)};
    expect(humanContinuationSubjectSchema.parse(subject)).toEqual(subject);expect(humanContinuationSubjectSchema.safeParse({...subject,assignments:[{...subject.assignments[0],workflowSelections:[selection]}]}).success).toBe(false);
    const output=(value:unknown,input:unknown)=>checkedJsonToolResult('cbim_goal_plan',value,mainToolOutputSchema('cbim_goal_plan',{binding:mainToolBinding,input}));
    expect(JSON.parse(output(projectMainScope(original),governance).content[0].text).goal.plan.assignments[0].moduleIds).toEqual(governance.assignments[0].moduleIds);
    expect(()=>output(projectMainScope(bad),invalid)).toThrow(expect.objectContaining({code:'TOOL_OUTPUT_INVALID'}));
  });
  it('单项和完整图都核显式 ID 与冻结模块，不接受 general 冒充专属流程',()=>{
    const valid=task();expect(taskNodeSchema.parse(valid)).toEqual(valid);validateGraph(assigned());
    for(const mutate of [(value:TaskNode)=>{value.modules[0].workflow={kind:'general',id:workflowId,version:'1',reason:'伪造'}},(value:TaskNode)=>{value.modules[0].workflow.id='other'},(value:TaskNode)=>{value.workflowSelections=[{moduleId:'foreign',workflowId}]}]){const invalid=task();mutate(invalid);expect(taskNodeSchema.safeParse(invalid).success).toBe(false);const graph=assigned();graph.tasks=[invalid];expect(()=>validateGraph(graph)).toThrow()}
    expect(()=>validateTaskWorkflowSelections(undefined,task().modules)).not.toThrow();expect(taskNodeSchema.parse(task(false))).not.toHaveProperty('workflowSelections');
  });
  it('图更新不能增删或改写已派发选择，即便同时提高计划版本或保持相同实际流程',()=>{
    const graph=assigned(),original=JSON.stringify(graph),old=graph.tasks[0];
    for(const selections of [undefined,[{...selection,workflowId:'other'}]]){const updated={...old,revision:2,planRevision:2,workflowSelections:selections};expect(()=>applyGraphBatch(graph,batch(3,[{type:'task.upserted',task:updated}]))).toThrow(expect.objectContaining({code:'GRAPH_INPUT_INVALID'}))}
    const legacy=assigned(false);expect(()=>applyGraphBatch(legacy,batch(3,[{type:'task.upserted',task:{...legacy.tasks[0],revision:2,workflowSelections:[selection]}}]))).toThrow();expect(JSON.stringify(graph)).toBe(original);
    const advanced=applyGraphBatch(graph,batch(3,[{type:'task.upserted',task:{...old,revision:2,waitReason:'等待主调度'}}]));expect(advanced.tasks[0].workflowSelections).toEqual([selection]);
    const reopened=JSON.parse(JSON.stringify(graph));validateGraph(reopened);expect(reopened.tasks[0].workflowSelections).toEqual([selection]);
  });
  it('人工主体保留旧 wire，明确流程排序稳定且改选不再等于原批准主体',()=>{
    const legacy={objective:plan.objective,constraints:[],criteria:plan.criteria,assignments:[{agentId:'cbim:executor',moduleIds:[moduleId],criterionIds:['check']}]};
    expect(humanContinuationSubject(legacy)).toEqual(legacy);expect(JSON.stringify(humanContinuationSubject(legacy))).toBe(JSON.stringify(legacy));
    const explicit={...legacy,assignments:[{...legacy.assignments[0],moduleIds:[moduleId,otherModule],workflowSelections:[{moduleId:otherModule,workflowId:'art-flow'},selection]}]};
    const canonical=humanContinuationSubject(explicit),reversed=structuredClone(explicit);reversed.assignments[0].workflowSelections.reverse();expect(humanContinuationSubject(reversed)).toEqual(canonical);
    expect(canonical.assignments[0].workflowSelections).toHaveLength(2);expect(humanContinuationSubject({...legacy,assignments:[{...legacy.assignments[0],workflowSelections:[selection]}]})).not.toEqual(legacy);
    expect(humanContinuationSubjectSchema.safeParse({...legacy,assignments:[{...legacy.assignments[0],workflowSelections:[{moduleId:'outside',workflowId}]}]}).success).toBe(false);
  });
  it('主工具唯一 wire 核验保留显式目标选择，不能漏回、补造或借单项查询绕过实际绑定',()=>{
    const input={...plan,assignments:[{...plan.assignments[0],workflowSelections:[selection]}]},saved=mainToolScope(mainToolBinding,input);
    const output=(value:unknown,request:unknown=input)=>checkedJsonToolResult('cbim_goal_plan',value,mainToolOutputSchema('cbim_goal_plan',{binding:mainToolBinding,input:request}));
    expect(JSON.parse(output(projectMainScope(saved)).content[0].text).goal.plan.assignments[0].workflowSelections).toEqual([selection]);
    const missing=structuredClone(saved);delete missing.goal!.plan!.assignments[0].workflowSelections;expect(()=>output(projectMainScope(missing))).toThrow(expect.objectContaining({code:'TOOL_OUTPUT_INVALID'}));
    expect(()=>output(projectMainScope(saved),plan)).toThrow(expect.objectContaining({code:'TOOL_OUTPUT_INVALID'}));
    expect(JSON.parse(output(projectMainScope(mainToolScope(mainToolBinding,plan)),plan).content[0].text).goal.plan.assignments[0]).not.toHaveProperty('workflowSelections');
    const node=mainToolTask();node.modules[0]={...node.modules[0],moduleId,workflow:{kind:'module',id:workflowId,version:'frozen'}};node.workflowSelections=[selection];
    const inspect=(value:unknown)=>checkedJsonToolResult('cbim_dispatch_inspect',value,mainToolOutputSchema('cbim_dispatch_inspect',{binding:mainToolBinding,input:{taskId:node.taskId}}));
    expect(JSON.parse(inspect(node).content[0].text).workflowSelections).toEqual([selection]);node.modules[0].workflow.id='wrong';expect(()=>inspect(node)).toThrow(expect.objectContaining({code:'TOOL_OUTPUT_INVALID'}));
  });
});
