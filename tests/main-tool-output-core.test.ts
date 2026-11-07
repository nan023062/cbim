import {expect,test} from 'vitest';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {checkedJsonToolResult} from '../src/backend/core/tools/results';
import {mainToolOutputSchema,mainToolOutputSchemas,projectMainScope,type MainToolName,type MainToolOutputBinding} from '../src/backend/core/tasks/main-tool-output';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import type {GraphSnapshot,TaskNode} from '../src/backend/core/tasks/graph-types';
import type {GoalPlanInput,GoalReviewInput} from '../src/backend/core/tasks/scope-goal';
import type {ReplaceQueuedDependencyInput} from '../src/backend/core/tasks/queued-dependency-replacement';
import type {ResumeMemberInput} from '../src/backend/core/tasks/queued-member-resume';
import type {CancelQueuedTasksInput} from '../src/backend/core/tasks/queued-task-cancel';
import {humanDecisionCoverageLimitation} from '../src/backend/core/tasks/human-decisions';

const binding:MainToolOutputBinding={workspaceId:'workspace',rootSessionId:'root',scopeId:'scope',runId:'main-run'};
const identity={workspaceId:binding.workspaceId,rootSessionId:binding.rootSessionId};
const time='2026-11-07T10:00:00.000Z',commandId='trusted-command',digest='a'.repeat(64);
const main={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主调度'};
const member={agentId:'cbim:executor',agentInstanceId:'member-instance',agentSessionId:'member-session',name:'执行者'};
const graphCursor={streamId:'stream',seq:1};
const plan:GoalPlanInput={expectedRevision:1,objective:'交付可核实文件',constraints:['原目标不变'],criteria:[{id:'criterion',text:'真实读取文件',kind:'evidence'}],assignments:[{agentId:member.agentId,moduleIds:['app'],criterionIds:['criterion'],reason:'执行业务任务'}],reason:'根据模块分工'};
const review:GoalReviewInput={expectedRevision:2,decision:'complete',checks:[{criterionId:'criterion',outcome:'satisfied',reason:'已有真实知识回执',evidence:[{kind:'main-knowledge',toolCallIds:['real-call']}]}],superseded:[],gaps:[],reason:'提交完成申请'};
function scope():DispatchScope{return {...identity,scopeId:'scope',status:'active',createdAt:time,goal:{revision:1,input:{message:'原始目标',attachmentIds:[]}},runTracking:{version:1,mainRunIds:[binding.runId]}}}
function planned():DispatchScope{const value=scope(),{expectedRevision:_,...draft}=plan;value.goal={...value.goal!,revision:2,plan:{...draft,assignments:plan.assignments.map(item=>({...item,agentName:member.name,teamId:'team',moduleNames:['应用']})),revision:2,inputRevision:1,runId:binding.runId,recordedAt:time,knowledgeRevision:'knowledge',graphCursor:{...graphCursor}}};return value}
function reviewed():DispatchScope{const value=planned(),{expectedRevision:_,...draft}=review;value.goal={...value.goal!,revision:3,review:{...draft,revision:3,inputRevision:1,runId:binding.runId,recordedAt:time,knowledgeRevision:'knowledge',graphCursor,planRevision:2,observedSeq:8,lastEffectSeq:3}};return value}
function graph():GraphSnapshot{return {version:1,identity,cursor:{...identity,...graphCursor},root:{kind:'session-root',nodeId:'session:root',identity,agent:main,revision:1,createdAt:time},tasks:[],edges:[],agents:[{agentInstanceId:main.agentInstanceId,agentId:main.agentId,name:main.name,revision:1,state:'idle',waitingTaskIds:[]}]}}
function task():TaskNode{return {kind:'task',nodeId:'task:task',taskId:'task',identity,scopeId:'historical-scope',requester:main,assignee:member,modules:[{moduleId:'app',name:'应用',knowledgeRevision:'knowledge',maintenanceBindingId:'maintainer',maintainerPersonIds:['person'],workflow:{kind:'general',id:'general',version:'1',reason:'通用任务'}}],goal:'真实任务',acceptance:[{id:'criterion',text:'读取文件'}],revision:1,planRevision:1,status:'queued',awaitedChildren:[],runIds:[],createdAt:time,updatedAt:time}}
function graphWithTask():GraphSnapshot{const value=graph(),node=task();value.tasks.push(node);value.agents.push({agentInstanceId:member.agentInstanceId,agentId:member.agentId,name:member.name,revision:1,state:'idle',waitingTaskIds:[]});value.edges.push({kind:'dispatch',edgeId:'edge',identity,fromNodeId:value.root.nodeId,toNodeId:node.nodeId,revision:1,enabled:true});return value}
function result(name:MainToolName,value:unknown,input:unknown={},activeBinding=binding,expectedCommandId:string|undefined=commandId){return JSON.parse(checkedJsonToolResult(name,value,mainToolOutputSchema(name,{binding:activeBinding,input,expectedCommandId})).content[0].text)}
function rejects(name:MainToolName,value:unknown,input:unknown={},activeBinding=binding,expectedCommandId:string|undefined=commandId){expect(()=>result(name,value,input,activeBinding,expectedCommandId)).toThrowError(expect.objectContaining({code:'TOOL_OUTPUT_INVALID'}))}

test('nine actual output schemas describe strict structures and preserve legacy absence without defaults',()=>{
  expect(Object.keys(mainToolOutputSchemas)).toHaveLength(11);
  for(const schema of Object.values(mainToolOutputSchemas))expect(zodToJsonSchema(schema)).toBeTypeOf('object');
  const legacy={...identity,scopeId:'scope',status:'active' as const,createdAt:time};
  expect(result('cbim_goal_inspect',{scope:projectMainScope(legacy),graph:graph()})).toEqual({scope:legacy,graph:graph()});
  expect(projectMainScope(legacy)).not.toHaveProperty('goal');expect(projectMainScope(legacy)).not.toHaveProperty('continuations');
});
test('scope whitelist removes only private fresh context and retains recovery read restrictions and unknown source facts',()=>{
  const value=scope();value.scopeId='e4035ae5-1f63-4a1f-9c49-f69896f9cfbd';value.recovery={recoveryId:value.scopeId,acceptedAt:time,source:{scopeId:'source-scope',taskId:'source-task',runId:'source-run',reportBasis:digest,taskRevision:2,planRevision:1,scopeOutcome:'failed',reportExecution:'unknown',logState:'missing',unknownToolCount:1},operation:'inspect_effects',observation:{text:'只核实已发生的改动'},input:{message:value.goal!.input.message},options:{provider:'provider',model:'model',profileId:'70bf879b-f51f-4c46-8cb6-58b14197a69c',permission:'read'},context:{initialRunId:binding.runId,nativeSessionId:'6e7a687c-23fb-438e-9934-53c013b8f9d0',excludedRunIds:['bad-old-run']}};
  const before=structuredClone(value),output=projectMainScope(value);
  const {context:_,...visible}=value.recovery;
  expect(result('cbim_goal_inspect',{scope:output,graph:graph()},{},{...binding,scopeId:value.scopeId}).scope.recovery).toEqual(visible);
  expect(output.recovery).not.toHaveProperty('context');expect(value).toEqual(before);
  rejects('cbim_goal_inspect',{scope:value,graph:graph()},{},{...binding,scopeId:value.scopeId});
});
test('business replan proof keeps required modules and inherited human criteria while native context remains private',()=>{
  const value=scope();value.scopeId='e4035ae5-1f63-4a1f-9c49-f69896f9cfbd';value.replan={replanId:value.scopeId,acceptedAt:time,source:{inspectionScopeId:'inspection-scope',expectedBasis:digest,proof:{inspectionGoalRevision:3,inspectionPlanRevision:2,reviewRunId:'inspection-run',knowledgeRevision:'knowledge',sourceScopeId:'source-scope',sourceTaskId:'source-task',sourceRunId:'source-run',sourceReportBasis:digest,evidenceDigest:digest,requiredModules:[{moduleId:'app',name:'应用'}],inheritedHuman:[{id:'human',text:'人工验收',kind:'human',sourceScopeId:'source-scope',sourceGoalRevision:3}]}},operation:'business_replan',input:{message:value.goal!.input.message},options:{provider:'provider',model:'model',profileId:'70bf879b-f51f-4c46-8cb6-58b14197a69c',permission:'ask'},context:{initialRunId:binding.runId,nativeSessionId:'6e7a687c-23fb-438e-9934-53c013b8f9d0',excludedRunIds:['bad-old-run']}};
  const projected=projectMainScope(value),output=result('cbim_goal_inspect',{scope:projected,graph:graph()},{},{...binding,scopeId:value.scopeId});
  expect(output.scope.replan.source.proof).toEqual(value.replan.source.proof);expect(output.scope.replan.options.permission).toBe('ask');expect(output.scope.replan).not.toHaveProperty('context');
  const bad=structuredClone(projected);Object.assign(bad.replan!,{context:value.replan.context});rejects('cbim_goal_inspect',{scope:bad,graph:graph()},{},{...binding,scopeId:value.scopeId});
});
test('goal inspect rejects extra or missing fields, cross identity, malformed graph and scope-ahead cursor',()=>{
  const valid={scope:scope(),graph:graph()};
  expect(result('cbim_goal_inspect',valid)).toEqual(valid);
  for(const mutation of [
    (value:typeof valid)=>{Object.assign(value,{privateToken:'do-not-report'})},
    (value:typeof valid)=>{delete (value.scope as Partial<DispatchScope>).createdAt},
    (value:typeof valid)=>{value.scope.scopeId='other'},
    (value:typeof valid)=>{value.scope.workspaceId='other'},
    (value:typeof valid)=>{value.graph.root.identity={...identity,rootSessionId:'other'}},
    (value:typeof valid)=>{value.graph.edges.push({kind:'dispatch',edgeId:'bad',identity,fromNodeId:'missing',toNodeId:'missing-two',revision:1,enabled:true})},
    (value:typeof valid)=>{value.scope=planned();value.scope.goal!.plan!.graphCursor.seq=2},
    (value:typeof valid)=>{value.scope.runTracking!.mainRunIds=['different-run']},
  ]){const candidate=structuredClone(valid);mutation(candidate);rejects('cbim_goal_inspect',candidate)}
  for(const bad of [undefined,null,[],3])rejects('cbim_goal_plan',projectMainScope(bad as unknown as DispatchScope),plan);
  for(const key of ['recovery','replan'] as const)for(const malformed of [null,false,0,'',[]]){
    const value=Object.assign(scope(),{[key]:malformed}),projected=projectMainScope(value);
    expect(projected[key]).toEqual(malformed);rejects('cbim_goal_inspect',{scope:projected,graph:graph()});
  }
});
test('same root historical tasks remain inspectable but task, graph and request identities cannot be substituted',()=>{
  const value=graphWithTask();expect(result('cbim_dispatch_inspect',value)).toEqual(value);
  expect(result('cbim_dispatch_inspect',value.tasks[0],{taskId:'task'})).toEqual(value.tasks[0]);
  expect(result('cbim_goal_inspect',{scope:scope(),graph:value}).graph.tasks[0].scopeId).toBe('historical-scope');
  rejects('cbim_dispatch_inspect',value.tasks[0]);rejects('cbim_dispatch_inspect',value,{taskId:'task'});
  rejects('cbim_dispatch_inspect',value.tasks[0],{taskId:'another'});
  const cross=structuredClone(value.tasks[0]);cross.identity.rootSessionId='other';rejects('cbim_dispatch_inspect',cross,{taskId:'task'});
  const malformed=structuredClone(value.tasks[0]);malformed.status='result_ready';rejects('cbim_dispatch_inspect',malformed,{taskId:'task'});
});
test('single task uses the same local state rules as the full graph for checkpoint, cancellation and duplicate histories',()=>{
  for(const mutate of [
    (value:TaskNode)=>{value.status='checkpointed'},
    (value:TaskNode)=>{value.runIds=['member-run','member-run']},
    (value:TaskNode)=>{value.modules.push(structuredClone(value.modules[0]))},
    (value:TaskNode)=>{value.activeRunId='absent-run'},
    (value:TaskNode)=>{value.cancelledBeforeStart={commandId,scopeId:value.scopeId!,mainRunId:binding.runId,reason:'撤销',cancelledAt:time,previousRevision:1,graphCursor};value.revision=2;value.waitReason='撤销'},
  ]){const complete=graphWithTask();mutate(complete.tasks[0]);rejects('cbim_dispatch_inspect',complete.tasks[0],{taskId:'task'});rejects('cbim_dispatch_inspect',complete)}
});
test('plan output must match the saved version, actual main run and exact requested business subject',()=>{
  const value=planned();expect(result('cbim_goal_plan',value,plan)).toEqual(value);
  for(const mutation of [
    (item:DispatchScope)=>{item.goal!.plan!.runId='other-run'},
    (item:DispatchScope)=>{item.goal!.plan!.objective='another goal'},
    (item:DispatchScope)=>{item.goal!.plan!.assignments[0].moduleIds=['other-module']},
    (item:DispatchScope)=>{item.goal!.plan!.criteria[0].text='weaker criterion'},
    (item:DispatchScope)=>{item.status='closed';item.closedAt=time;item.outcome='completed'},
    (item:DispatchScope)=>{item.goal!.blocked={reason:'已阻塞',at:time}},
  ]){const candidate=structuredClone(value);mutation(candidate);rejects('cbim_goal_plan',candidate,plan)}
  rejects('cbim_goal_plan',value,{...plan,expectedRevision:2});
});
test('complete review remains active and must match this request; completion or a different result cannot be invented',()=>{
  const value=reviewed(),output=result('cbim_goal_review',value,review);expect(output.status).toBe('active');expect(output.goal.review.decision).toBe('complete');
  const closed=structuredClone(value);closed.status='closed';closed.closedAt=time;closed.outcome='completed';rejects('cbim_goal_review',closed,review);
  const wrong=structuredClone(value);wrong.goal!.review!.checks[0].evidence=[{kind:'main-knowledge',toolCallIds:['some-other-call']}];rejects('cbim_goal_review',wrong,review);
  rejects('cbim_goal_review',value,{...review,reason:'a different review'});
});
function waiting():DispatchScope{const value=reviewed();value.status='waiting';value.goal!.review={...value.goal!.review!,decision:'awaiting_user',checks:[{criterionId:'criterion',outcome:'unmet',reason:'需要补充',evidence:[]}],gaps:['用户补充'],reason:'需要补充'};value.wait={waitId:'wait',reason:'需要补充',createdAt:time,runId:binding.runId,goalRevision:3,graphCursor,knowledgeRevision:'knowledge',mainRunIds:[binding.runId]};return value}
test('waiting and both continuation sources remain facts without defaulting text or consuming the checkpoint',()=>{
  const parked=waiting();expect(result('cbim_goal_inspect',{scope:projectMainScope(parked),graph:graph()}).scope.wait).toEqual(parked.wait);
  const value=planned();value.goal={...value.goal!,revision:4,inputRevision:2};value.runTracking!.mainRunIds.push('continued-run');value.continuations=[{continuationId:'e4035ae5-1f63-4a1f-9c49-f69896f9cfbd',acceptedAt:time,wait:parked.wait!,inputRevision:2,runId:'continued-run',input:{message:'真实补充'},options:{provider:'provider',model:'model',profileId:'70bf879b-f51f-4c46-8cb6-58b14197a69c',permission:'read'}}];
  expect(result('cbim_goal_inspect',{scope:projectMainScope(value),graph:graph()},{},{...binding,runId:'continued-run'}).scope.continuations).toEqual(value.continuations);
  value.continuations=[{kind:'human_decisions',continuationId:'e4035ae5-1f63-4a1f-9c49-f69896f9cfbd',acceptedAt:time,wait:parked.wait!,inputRevision:2,runId:'continued-run',options:{provider:'provider',model:'model',profileId:'70bf879b-f51f-4c46-8cb6-58b14197a69c',permission:'read'},decisionRevision:1,decisionIds:['4556d9ab-9d93-4b56-a5a2-2ff13684bb51'],subject:{objective:plan.objective,constraints:plan.constraints,criteria:plan.criteria,assignments:plan.assignments.map(({agentId,moduleIds,criterionIds})=>({agentId,moduleIds,criterionIds}))},priorTaskIds:['old-candidate']}];
  const output=result('cbim_goal_inspect',{scope:projectMainScope(value),graph:graph()},{},{...binding,runId:'continued-run'});expect(output.scope.continuations).toEqual(value.continuations);expect(output.scope.continuations[0]).not.toHaveProperty('input');
  const bad=structuredClone(parked);bad.wait!.goalRevision=2;rejects('cbim_goal_inspect',{scope:bad,graph:graph()});
});
test('real human history and its exact source proof survive projection without becoming implicit acceptance',()=>{
  const value=waiting();value.humanDecisions={revision:1,records:[{decisionId:'4556d9ab-9d93-4b56-a5a2-2ff13684bb51',revision:1,recordedAt:time,actor:{kind:'local_desktop',interaction:'explicit_submit'},criterionId:'criterion',decision:'request_evidence',comment:'补充真实成果证据',basis:digest,baselines:[],proof:{identity:{...identity,scopeId:binding.scopeId},source:{waitId:'wait',goalRevision:3,inputRevision:1,planRevision:2,reviewRevision:3,reviewRunId:binding.runId,reviewLogHash:digest,knowledgeRevision:'knowledge',graphCursor,criterion:{id:'criterion',text:'人工验收',kind:'human'}},candidates:[{taskId:'task',taskRevision:3,runId:'member-run',resultId:'result',planRevision:1,logHash:digest,evidenceToolCallIds:['real-read']}],limitations:[humanDecisionCoverageLimitation],allowedDecisions:['request_evidence']}}]};
  const output=result('cbim_goal_inspect',{scope:projectMainScope(value),graph:graph()});expect(output.scope.humanDecisions).toEqual(value.humanDecisions);expect(output.scope.status).toBe('waiting');
  const bad=structuredClone(value);bad.humanDecisions!.records[0].proof.identity.scopeId='another';rejects('cbim_goal_inspect',{scope:bad,graph:graph()});
});
test('dispatch receipt binds the real command and root, and cannot claim execution completion',()=>{
  const value={commandId,taskId:'task',messageId:'assignment',cursor:{...identity,streamId:'stream',seq:2},disposition:'queued'};
  expect(result('cbim_dispatch_task',value)).toEqual(value);
  for(const bad of [{...value,commandId:'another-command'},{...value,disposition:'completed'},{...value,cursor:{...value.cursor,workspaceId:'other'}},{...value,runId:'invented-run'}])rejects('cbim_dispatch_task',bad);
  expect(()=>checkedJsonToolResult('cbim_dispatch_task',value,mainToolOutputSchema('cbim_dispatch_task',{binding,input:{}}))).toThrowError(expect.objectContaining({code:'TOOL_OUTPUT_INVALID'}));
});
test('cancel receipt must be the exact requested target set, current scope/run and next graph commit',()=>{
  const input:CancelQueuedTasksInput={expectedGraphCursor:graphCursor,targets:[{taskId:'task',expectedRevision:1},{taskId:'dependent',expectedRevision:1}],reason:'显式撤销'},value={...identity,scopeId:'scope',mainRunId:binding.runId,commandId,cancelledTaskIds:['dependent','task'],graphCursor:{...graphCursor,seq:2}};
  expect(result('cbim_dispatch_cancel',value,input)).toEqual(value);
  for(const bad of [{...value,cancelledTaskIds:['task']},{...value,cancelledTaskIds:['task','task']},{...value,scopeId:'another'},{...value,mainRunId:'other'},{...value,commandId:'other'},{...value,graphCursor:{...graphCursor,seq:3}}])rejects('cbim_dispatch_cancel',bad,input);
});
function replacement(){
  const input:ReplaceQueuedDependencyInput={expectedGraphCursor:graphCursor,expectedGoalRevision:2,target:{taskId:'task',expectedRevision:3,expectedPlanRevision:1},replace:{edgeId:'old-edge',expectedRevision:1},with:{taskId:'replacement',expectedRevision:4,expectedPlanRevision:1,runId:'replacement-run',resultId:'replacement-result'},reason:'真实新候选替代安全求助'};
  const value={...identity,scopeId:'scope',mainRunId:binding.runId,commandId,taskId:'task',status:'queued' as const,trackedTaskIds:['task','dependent'],replacement:{commandId,scopeId:'scope',mainRunId:binding.runId,replacedAt:time,reason:input.reason,graphCursor,goalRevision:2,goalPlanRevision:2,knowledgeRevision:'knowledge',previousTaskRevision:3,targetPlanRevision:1,retired:{edgeId:'old-edge',revision:1,sourceTaskId:'old-source',sourcePlanRevision:1},replacement:{edgeId:'new-edge',sourceTaskId:'replacement',sourceTaskRevision:4,sourcePlanRevision:1,runId:'replacement-run',resultId:'replacement-result'},trackedTaskIds:['task','dependent']},graphCursor:{...graphCursor,seq:2}};
  return {input,value};
}
test('dependency replacement receipt fixes the exact candidate and retired edge, not just a same-shaped success',()=>{
  const {input,value}=replacement();expect(result('cbim_dispatch_replace_dependency',value,input)).toEqual(value);
  for(const mutation of [
    (item:typeof value)=>{item.replacement.replacement.resultId='wrong-result'},
    (item:typeof value)=>{item.replacement.replacement.runId='wrong-run'},
    (item:typeof value)=>{item.replacement.retired.edgeId='wrong-edge'},
    (item:typeof value)=>{item.replacement.mainRunId='wrong-main'},
    (item:typeof value)=>{item.replacement.previousTaskRevision=2},
    (item:typeof value)=>{item.trackedTaskIds=['task']},
    (item:typeof value)=>{item.graphCursor.seq=4},
  ]){const candidate=structuredClone(value);mutation(candidate);rejects('cbim_dispatch_replace_dependency',candidate,input)}
});
test('resume receipt is a pending reservation for the exact task/checkpoint and cannot expose invented execution state',()=>{
  const input:ResumeMemberInput={expectedGraphCursor:graphCursor,expectedGoalRevision:2,taskId:'task',expectedRevision:3,checkpointId:'checkpoint',reason:'按保存检查点继续'},value={taskId:'task',checkpointId:'checkpoint',requestId:'request',trackedTaskIds:['task','dependent'],cursor:{...identity,...graphCursor,seq:2}};
  expect(result('cbim_dispatch_resume',value,input)).toEqual(value);
  for(const bad of [{...value,taskId:'other'},{...value,checkpointId:'old-checkpoint'},{...value,trackedTaskIds:['dependent','task']},{...value,cursor:{...value.cursor,rootSessionId:'other'}},{...value,runId:'pretend-running'},{...value,completed:true}])rejects('cbim_dispatch_resume',bad,input);
});
test('only one serialized snapshot is inspected; normalization, toJSON substitution and secrets never become accepted output',()=>{
  const value=planned();let serializations=0;
  const once={toJSON(){serializations++;return value}};expect(result('cbim_goal_plan',once,plan)).toEqual(value);expect(serializations).toBe(1);
  const substitution={toJSON(){return {...value,workspaceId:'another'}}};rejects('cbim_goal_plan',substitution,plan);
  const whitespace=graph();whitespace.root.agent.name=' 主调度 ';whitespace.agents[0].name=' 主调度 ';rejects('cbim_dispatch_inspect',whitespace);
  const secret={...value,apiKey:'SECRET_SHOULD_NOT_APPEAR'};
  try{result('cbim_goal_plan',secret,plan);throw new Error('expected rejection')}catch(error){expect(error).toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(String(error)).not.toContain(secret.apiKey)}
});
