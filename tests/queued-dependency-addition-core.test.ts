import {expect,it} from 'vitest';
import {applyGraphBatch} from '../src/backend/core/tasks/graph-reducer';
import {validateGraph,validateTaskNode,taskNodeSchema} from '../src/backend/core/tasks/graph-rules';
import {validateDispatchExecution} from '../src/backend/core/tasks/dispatch-invariants';
import {validateDispatchScopes} from '../src/backend/core/tasks/dispatch-scope-invariants';
import {validateQueuedDependencyAddition} from '../src/backend/core/tasks/queued-dependency-addition-invariants';
import {validateQueuedDependencyReplacement} from '../src/backend/core/tasks/queued-dependency-replacement-invariants';
import {queuedDependencyAdditionSelection} from '../src/backend/core/tasks/queued-dependency-addition-rules';
import {addQueuedDependencyInputSchema,dependencyAdditionSchema,type AddQueuedDependencyInput,type DependencyAddition,type AddQueuedDependencyReceipt} from '../src/backend/core/tasks/queued-dependency-addition';
import {mainToolOutputSchema} from '../src/backend/core/tasks/main-tool-output';
import {checkedJsonToolResult} from '../src/backend/core/tools/results';
import type {DispatchState,DispatchMutation} from '../src/backend/core/dispatch/dispatch-storage';
import type {DispatchRun} from '../src/backend/core/tasks/dispatch-execution';
import type {AgentRef,TaskNode,GraphEdge,GraphEventBatch} from '../src/backend/core/tasks/graph-types';

const identity={workspaceId:'workspace',rootSessionId:'root'},scopeId='scope',stamp='2026-11-07T00:00:00.000Z',later='2026-11-07T00:00:01.000Z';
const main:AgentRef={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主调度'};
const ref=(id:string):AgentRef=>({agentId:'executor',agentInstanceId:'instance-'+id,agentSessionId:'session-'+id,name:'执行者'});
function task(id:string,status:TaskNode['status']='queued'):TaskNode{return {kind:'task',nodeId:'task:'+id,taskId:id,identity,scopeId,requester:main,assignee:ref(id),modules:[{moduleId:'module',name:'模块',knowledgeRevision:'knowledge',maintenanceBindingId:'maintain',maintainerPersonIds:['owner'],workflow:{kind:'general',id:'cbim:general',version:'1',reason:'通用'}}],goal:'执行 '+id,acceptance:[{id:'check',text:'真实证据'}],revision:1,planRevision:1,status,awaitedChildren:[],runIds:[],createdAt:stamp,updatedAt:stamp}}
function fixture(ids=['b','c','a']){
  const tasks=ids.map(id=>task(id,id==='c'?'waiting':'queued')),edges:GraphEdge[]=tasks.map(value=>({edgeId:'dispatch-'+value.taskId,identity,kind:'dispatch',fromNodeId:'session:root',toNodeId:value.nodeId,revision:1,enabled:true}));
  if(ids.includes('b')&&ids.includes('c'))edges.push(edge('b','c'));
  const state:DispatchState={workspaceId:identity.workspaceId,members:tasks.map(value=>({workspaceId:identity.workspaceId,teamId:'team',agentId:'executor',agentInstanceId:value.assignee.agentInstanceId,executionScopeId:scopeId,executionTaskId:value.taskId,lifecycle:'active',leaseEpoch:0,configurationRevision:'knowledge',agentSessionIds:[value.assignee.agentSessionId],activity:value.status==='waiting'?'waiting':'idle',waitingTaskIds:value.status==='waiting'?[value.taskId]:[],communicatingMessageIds:[]})),sessions:tasks.map(value=>({workspaceId:identity.workspaceId,teamId:'team',agentId:'executor',agentInstanceId:value.assignee.agentInstanceId,agentSessionId:value.assignee.agentSessionId,rootSessionId:'root'})),graphs:[{version:1,identity,cursor:{...identity,streamId:'stream',seq:5},root:{kind:'session-root',nodeId:'session:root',identity,agent:main,revision:1,createdAt:stamp},tasks,edges,agents:[{agentId:main.agentId,agentInstanceId:main.agentInstanceId,name:main.name,revision:1,state:'idle',waitingTaskIds:[]},...tasks.map(value=>({agentInstanceId:value.assignee.agentInstanceId,agentId:'executor',name:'执行者',revision:1,state:value.status==='waiting'?'waiting' as const:'idle' as const,waitingTaskIds:value.status==='waiting'?[value.taskId]:[]}))]}],outbox:tasks.map(value=>({messageId:'assignment-'+value.taskId,commandId:'dispatch-'+value.taskId,identity,kind:'assignment',from:main,to:value.assignee,taskId:value.taskId,planRevision:1,createdAt:stamp,delivery:'pending'})),runs:[],scopes:[{scopeId,...identity,status:'active',createdAt:stamp,runTracking:{version:1,mainRunIds:['main-run']},goal:{revision:2,input:{message:'目标',attachmentIds:[]},plan:{revision:2,runId:'main-run',recordedAt:stamp,knowledgeRevision:'knowledge',graphCursor:{streamId:'stream',seq:1},objective:'目标',constraints:[],criteria:[{id:'check',kind:'evidence',text:'真实证据'}],assignments:[{agentId:'executor',agentName:'执行者',teamId:'team',moduleIds:['module'],moduleNames:['模块'],criterionIds:['check'],reason:'分工'}],reason:'按图派发'}}}]};
  const input:AddQueuedDependencyInput={expectedGraphCursor:{streamId:'stream',seq:5},expectedGoalRevision:2,source:{taskId:'a',expectedRevision:1,expectedPlanRevision:1},target:{taskId:'b',expectedRevision:1,expectedPlanRevision:1},reason:'新增实际前置'};
  return {state,input};
}
function edge(from:string,to:string):GraphEdge{return {edgeId:from+'-'+to,identity,kind:'dependency',fromNodeId:'task:'+from,toNodeId:'task:'+to,revision:1,enabled:true,condition:{kind:'result_ready',planRevision:1}}}
const node=(state:DispatchState,id:string)=>state.graphs[0].tasks.find(value=>value.taskId===id)!;
function mutation(state:DispatchState,input:AddQueuedDependencyInput):DispatchMutation{
  const selected=queuedDependencyAdditionSelection(state,identity,scopeId,'main-run',input),{graph,scope,source,target,tasks,members}=selected;
  const record:DependencyAddition={commandId:'add',scopeId,mainRunId:'main-run',addedAt:later,reason:input.reason,graphCursor:input.expectedGraphCursor,goalRevision:scope.goal!.revision,goalPlanRevision:scope.goal!.plan!.revision,knowledgeRevision:'knowledge',previousTaskRevision:target.revision,targetPlanRevision:target.planRevision,dependency:{edgeId:'new-edge',sourceTaskId:source.taskId,sourceTaskRevision:source.revision,sourcePlanRevision:source.planRevision},trackedTaskIds:tasks.map(value=>value.taskId)};
  const member=members.find(value=>value.agentInstanceId===target.assignee.agentInstanceId)!,view=graph.agents.find(value=>value.agentInstanceId===member.agentInstanceId)!;
  return {members:[{...member,activity:'waiting',waitingTaskIds:[target.taskId]}],batch:{version:1,identity,streamId:'stream',seq:graph.cursor.seq+1,eventId:'event-add',commandId:'add',cause:'dependency.changed',committedAt:later,changes:[{type:'edge.upserted',edge:{...edge(source.taskId,target.taskId),edgeId:'new-edge'}},{type:'task.upserted',task:{...target,revision:target.revision+1,status:'waiting',updatedAt:later,waitReason:'等待新增前置任务的有效结果',dependencyAdditions:[...(target.dependencyAdditions??[]),record]}},{type:'agent.upserted',agent:{...view,revision:view.revision+1,state:'waiting',runningTaskId:undefined,waitingTaskIds:[target.taskId]}}]},receipt:true};
}
function apply(state:DispatchState,change:DispatchMutation){const next=structuredClone(state);if(change.batch)next.graphs[0]=applyGraphBatch(state.graphs[0],change.batch);for(const value of change.members??[])next.members[next.members.findIndex(item=>item.agentInstanceId===value.agentInstanceId)]=value;return next}
function validate(state:DispatchState,change:DispatchMutation){const next=apply(state,change);validateDispatchExecution(state,next,change,{commandId:'add',fingerprint:'add'});validateDispatchScopes(state,next,change);return next}
const changedTask=(change:DispatchMutation)=>{const found=change.batch!.changes.find(value=>value.type==='task.upserted');if(found?.type!=='task.upserted')throw Error('missing task');return found.task};
const audit=(change:DispatchMutation)=>changedTask(change).dependencyAdditions!.at(-1)!;

it('B/C 先创建、A 后创建仍可追加 A→B：仅 B 版本/等待和审计改变，闭包按图持久顺序',()=>{
  const {state,input}=fixture(),before=structuredClone(state);validateGraph(state.graphs[0]);
  validateDispatchExecution(state,state,{receipt:true},{commandId:'read',fingerprint:'read'});validateDispatchScopes(state,state,{receipt:true});
  const change=mutation(state,input),next=validate(state,change),b=node(next,'b');
  expect(state).toEqual(before);expect(b).toMatchObject({taskId:'b',revision:2,planRevision:1,status:'waiting',runIds:[],assignee:node(state,'b').assignee,dependencyAdditions:[{trackedTaskIds:['b','c','a']}]});
  expect(next.graphs[0].edges.at(-1)).toMatchObject({edgeId:'new-edge',fromNodeId:'task:a',toNodeId:'task:b',condition:{kind:'result_ready',planRevision:1}});expect((next.graphs[0].edges.at(-1) as any).condition.resultId).toBeUndefined();
  for(const id of ['a','c'])expect(node(next,id)).toEqual(node(state,id));for(const key of ['outbox','runs','sessions','scopes'] as const)expect(next[key]).toEqual(state[key]);
  expect(next.members[0]).toMatchObject({activity:'waiting',waitingTaskIds:['b'],leaseEpoch:0});
});
it('两端已启用后继的并集精确去重，不漏来源分支、不扩大到反向前置',()=>{
  const {state,input}=fixture(['b','c','a','d','e','outside']);state.graphs[0].edges.push(edge('a','d'),edge('c','e'),edge('d','e'),edge('outside','a'));
  expect(queuedDependencyAdditionSelection(state,identity,scopeId,'main-run',input).tasks.map(value=>value.taskId)).toEqual(['b','c','a','d','e']);
  const next=validate(state,mutation(state,input));expect(node(next,'b').dependencyAdditions![0].trackedTaskIds).toEqual(['b','c','a','d','e']);expect(node(next,'outside')).toEqual(node(state,'outside'));
});
it('输入严格拒绝身份和未知字段，沿现有图 ID 128 字符域，不收窄成文件名 100 字符',()=>{
  const {input}=fixture();expect(addQueuedDependencyInputSchema.safeParse(input).success).toBe(true);
  expect(addQueuedDependencyInputSchema.safeParse({...input,source:{...input.source,taskId:'a'.repeat(128)}}).success).toBe(true);
  for(const bad of [{...input,scopeId:'forged'},{...input,source:{...input.source,taskId:'../escape'}},{...input,target:{...input.target,resultId:'fake'}},{...input,expectedGoalRevision:0},{...input,expectedGraphCursor:{streamId:'stream',seq:0.5}},{...input,source:{...input.source,taskId:'a'.repeat(129)}},{...input,reason:' '}])expect(addQueuedDependencyInputSchema.safeParse(bad).success).toBe(false);
  const record=audit(mutation(fixture().state,input));expect(dependencyAdditionSchema.safeParse({...record,trackedTaskIds:['b','b']}).success).toBe(false);
});
it('图、目标、两端任务/计划版本及主运行 CAS 保守拒绝，不能借旧主身份写新审计',()=>{
  const cases:Array<(state:DispatchState,input:AddQueuedDependencyInput)=>void>=[(_s,i)=>i.expectedGraphCursor.seq--,(_s,i)=>i.expectedGoalRevision++,(_s,i)=>i.source.expectedRevision++,(_s,i)=>i.source.expectedPlanRevision++,(_s,i)=>i.target.expectedRevision++,(_s,i)=>i.target.expectedPlanRevision++,s=>{s.scopes![0].runTracking!.mainRunIds.push('new-main')},s=>{delete s.scopes![0].runTracking},s=>{s.scopes![0].status='waiting'},s=>{node(s,'a').scopeId='other'},s=>{s.workspaceId='other'}];
  for(const change of cases){const {state,input}=fixture(),before=structuredClone(state);change(state,input);expect(()=>queuedDependencyAdditionSelection(state,identity,scopeId,'main-run',input)).toThrow();expect(before.graphs[0].cursor.seq).toBe(5)}
});
it('self、重复和长环拒绝：通用图校验也独立拒绝新增边造成的非相邻环',()=>{
  const {state,input}=fixture(['b','c','d','e','a']);state.graphs[0].edges.push(edge('c','d'),edge('d','e'),edge('e','a'));
  expect(()=>queuedDependencyAdditionSelection(state,identity,scopeId,'main-run',input)).toThrow(expect.objectContaining({code:'GRAPH_CYCLE'}));
  const graph=structuredClone(state.graphs[0]);graph.edges.push(edge('a','b'));expect(()=>validateGraph(graph)).toThrow(expect.objectContaining({code:'GRAPH_CYCLE'}));
  const self=fixture();self.input.source={...self.input.target};expect(()=>mutation(self.state,self.input)).toThrow(expect.objectContaining({code:'DEPENDENCY_EDGE_INVALID'}));
  const duplicate=fixture();duplicate.state.graphs[0].edges.push(edge('a','b'));expect(()=>mutation(duplicate.state,duplicate.input)).toThrow(expect.objectContaining({code:'DEPENDENCY_EDGE_DUPLICATE'}));
});
it('两端与任一后继已经领取、运行、终态、检查点、活动实例或非待领信封均拒绝',()=>{
  const cases:Array<(state:DispatchState,id:string)=>void>=[(s,id)=>{node(s,id).runIds=['prior-run']},(s,id)=>{node(s,id).activeRunId='active'},(s,id)=>{node(s,id).status='result_ready'},(s,id)=>{node(s,id).status='planned'},(s,id)=>{node(s,id).status='cancelled'},(s,id)=>{node(s,id).checkpoints=[]},(s,id)=>{node(s,id).awaitedChildren=[{taskId:'child',planRevision:1}]},(s,id)=>{s.outbox.find(value=>value.taskId===id)!.claim={runId:'claim',leaseEpoch:1}},(s,id)=>{s.outbox.find(value=>value.taskId===id)!.delivery='processed'},(s,id)=>{s.members.find(value=>value.executionTaskId===id)!.activity='working'},(s,id)=>{s.members.find(value=>value.executionTaskId===id)!.communicatingMessageIds=['message']},(s,id)=>{s.members.find(value=>value.executionTaskId===id)!.lifecycle='released'},(s,id)=>{s.runs!.push({binding:{taskId:id,rootSessionId:'root'}} as DispatchRun)}];
  for(const id of ['a','b','c'])for(const change of cases){const {state,input}=fixture();change(state,id);expect(()=>mutation(state,input)).toThrow()}
});
it('Workflow/知识和当前目标分工必须仍匹配，接收新输入后旧计划不能追加依赖',()=>{
  const cases:Array<(state:DispatchState)=>void>=[s=>{node(s,'c').modules[0].knowledgeRevision='old'},s=>{s.members[2].configurationRevision='old'},s=>{s.scopes![0].goal!.plan!.assignments[0].moduleIds=['different']},s=>{s.scopes![0].goal!.plan!.assignments[0].workflowSelections=[{moduleId:'module',workflowId:'chosen'}]},s=>{s.scopes![0].goal!.inputRevision=2}];
  for(const change of cases){const {state,input}=fixture();change(state);expect(()=>mutation(state,input)).toThrow()}
  for(const status of ['pending','unknown'] as const){const {state,input}=fixture();const base={insertionId:'a'.repeat(64),inputHash:'b'.repeat(64),queueId:'queued-input',runId:'main-run',preparedAt:stamp,baseGoalRevision:2,baseInputRevision:1,messageBytes:1,messageCharacters:1};state.scopes![0].activeInputs=[status==='pending'?{...base,status}:{...base,status,resolvedAt:later,reason:'response lost'}];expect(()=>mutation(state,input)).toThrow(expect.objectContaining({code:'GOAL_ACTIVE_INPUT_UNRESOLVED'}))}
});
it('审计不是普通图写入许可证：无审计或改 cause、漏闭包、伪造结果及夹带变更均拒绝',()=>{
  const changes:Array<(change:DispatchMutation)=>void>=[change=>{delete changedTask(change).dependencyAdditions},change=>{change.batch!.cause='task.created'},change=>{audit(change).trackedTaskIds=['b','a']},change=>{audit(change).dependency.sourceTaskRevision++},change=>{audit(change).mainRunId='old-main'},change=>{audit(change).goalPlanRevision++},change=>{audit(change).knowledgeRevision='stale'},change=>{const item=change.batch!.changes[0];if(item.type==='edge.upserted'&&item.edge.kind==='dependency')item.edge.condition.resultId='forged'},change=>{changedTask(change).goal='different';changedTask(change).planRevision++},change=>{change.members![0].leaseEpoch++},change=>{change.messages=[fixture().state.outbox[0]]},change=>{change.scopes=fixture().state.scopes},change=>{change.batch!.changes.push({type:'agent.upserted',agent:fixture().state.graphs[0].agents[0]})}];
  for(const change of changes){const {state,input}=fixture(),value=mutation(state,input);change(value);expect(()=>validate(state,value)).toThrow()}
  const {state}=fixture(),raw:DispatchMutation={batch:{version:1,identity,streamId:'stream',seq:6,eventId:'plain',commandId:'add',cause:'dependency.changed',committedAt:later,changes:[{type:'edge.upserted',edge:edge('a','b')}]},receipt:true};
  expect(()=>validate(state,raw)).toThrow();
});
it('精确许可只来自完整 Core 校验，不能顺带放行第二条边或更改旧边',()=>{
  const {state,input}=fixture(),change=mutation(state,input),next=apply(state,change),command={commandId:'add',fingerprint:'add'};
  const permit=validateQueuedDependencyAddition(state,next,change,command);expect([...permit]).toEqual(['new-edge']);
  expect(()=>validateQueuedDependencyReplacement(state,next,change,command)).toThrow();expect(()=>validateQueuedDependencyReplacement(state,next,change,command,permit)).not.toThrow();
  const extra=structuredClone(change);extra.batch!.changes.push({type:'edge.upserted',edge:edge('a','c')});expect(()=>validateQueuedDependencyAddition(state,next,extra,command)).toThrow();
});
it('领取先提交就拒绝追加，追加先提交后仍能按旧领取规则 pin 真实结果而不更改审计',()=>{
  const {state,input}=fixture(),next=validate(state,mutation(state,input)),b=node(next,'b'),a=node(next,'a'),base=next.graphs[0].edges.find(value=>value.edgeId==='new-edge')!;if(base.kind!=='dependency')throw Error('dependency expected');
  a.status='result_ready';a.runIds=['run-a'];a.result={resultId:'result-a',runId:'run-a',planRevision:1,summary:'read result',evidenceRefs:['read'],limitations:[],acceptance:'not_evaluated'};
  const run={binding:{...identity,taskId:'b',runId:'run-b'},status:'starting'} as DispatchRun;
  const claim:DispatchMutation={batch:{version:1,identity,streamId:'stream',seq:7,eventId:'claim',commandId:'claim',cause:'task.started',committedAt:later,changes:[{type:'edge.upserted',edge:{...base,revision:2,condition:{kind:'result_ready',planRevision:1,resultId:'result-a'}}}]},runs:[run],messages:[{...next.outbox[0],delivery:'claimed',claim:{runId:'run-b',leaseEpoch:1}}],receipt:true};
  expect(()=>validateQueuedDependencyReplacement(next,next,claim,{commandId:'claim',fingerprint:'claim'})).not.toThrow();
  const graph=applyGraphBatch(next.graphs[0],claim.batch!);expect(graph.tasks[0].dependencyAdditions).toEqual(b.dependencyAdditions);
  next.outbox[0].delivery='claimed';next.outbox[0].claim={runId:'run-b',leaseEpoch:1};expect(()=>queuedDependencyAdditionSelection(next,identity,scopeId,'main-run',{...input,expectedGraphCursor:{streamId:'stream',seq:6},target:{...input.target,expectedRevision:2}})).toThrow();
});
it('审计历史不可改删，后续主轮不使旧审计失效；两类修订同一任务版本不可重复',()=>{
  const {state,input}=fixture(),next=validate(state,mutation(state,input)),b=node(next,'b');next.scopes![0].runTracking!.mainRunIds.push('later-main');
  expect(()=>validateQueuedDependencyAddition(next,next,{receipt:true},{commandId:'read',fingerprint:'read'})).not.toThrow();
  const event=(task:TaskNode):GraphEventBatch=>({version:1,identity,streamId:'stream',seq:7,eventId:'later',commandId:'later',cause:'task.revised',committedAt:later,changes:[{type:'task.upserted',task}]});
  for(const history of [undefined,[{...b.dependencyAdditions![0],reason:'rewrite'}]])expect(()=>applyGraphBatch(next.graphs[0],event({...b,revision:3,dependencyAdditions:history}))).toThrow();
  const audit=b.dependencyAdditions![0],mixed={...b,revision:3,dependencyReplacements:[{commandId:'replace',scopeId,mainRunId:'main-run',replacedAt:later,reason:'replacement',graphCursor:{streamId:'stream',seq:6},goalRevision:2,goalPlanRevision:2,knowledgeRevision:'knowledge',previousTaskRevision:1,targetPlanRevision:1,retired:{edgeId:'new-edge',revision:1,sourceTaskId:'a',sourcePlanRevision:1},replacement:{edgeId:'replacement-edge',sourceTaskId:'a2',sourceTaskRevision:2,sourcePlanRevision:1,runId:'run-a2',resultId:'result-a2'},trackedTaskIds:['b','c']}]};
  expect(()=>validateTaskNode(mixed)).toThrow();mixed.dependencyReplacements[0].previousTaskRevision=2;expect(()=>validateTaskNode(mixed)).not.toThrow();
  expect(taskNodeSchema.safeParse({...b,dependencyAdditions:[{...audit,extra:true}]}).success).toBe(false);
});
it('图级追加历史允许正式替换退役且保留审计，不能直接禁用或重启退役边',()=>{
  const {state,input}=fixture(),next=validate(state,mutation(state,input)),graph=next.graphs[0],b=node(next,'b'),base=graph.edges.find(value=>value.edgeId==='new-edge')!;
  const bad=structuredClone(graph);bad.edges.find(value=>value.edgeId==='new-edge')!.enabled=false;expect(()=>validateGraph(bad)).toThrow();
  const a=node(next,'a');a.status='failed';a.runIds=['run-a'];const candidate=task('a2','result_ready');candidate.revision=2;candidate.runIds=['run-a2'];candidate.result={resultId:'result-a2',runId:'run-a2',planRevision:1,summary:'candidate',evidenceRefs:['read'],limitations:[],acceptance:'not_evaluated'};graph.tasks.push(candidate);graph.agents.push({agentId:'executor',agentInstanceId:candidate.assignee.agentInstanceId,name:'执行者',revision:1,state:'idle',waitingTaskIds:[]});graph.edges.push({edgeId:'dispatch-a2',identity,kind:'dispatch',fromNodeId:'session:root',toNodeId:candidate.nodeId,revision:1,enabled:true});graph.cursor.seq=7;
  b.revision=3;b.dependencyReplacements=[{commandId:'replace',scopeId,mainRunId:'main-run',replacedAt:later,reason:'replace failed source',graphCursor:{streamId:'stream',seq:6},goalRevision:2,goalPlanRevision:2,knowledgeRevision:'knowledge',previousTaskRevision:2,targetPlanRevision:1,retired:{edgeId:'new-edge',revision:1,sourceTaskId:'a',sourcePlanRevision:1},replacement:{edgeId:'replacement-edge',sourceTaskId:'a2',sourceTaskRevision:2,sourcePlanRevision:1,runId:'run-a2',resultId:'result-a2'},trackedTaskIds:['b','c']}];
  base.enabled=false;base.revision=2;graph.edges.push({edgeId:'replacement-edge',identity,kind:'dependency',fromNodeId:'task:a2',toNodeId:'task:b',revision:1,enabled:true,condition:{kind:'result_ready',planRevision:1,resultId:'result-a2'}});expect(()=>validateGraph(graph)).not.toThrow();
  base.enabled=true;expect(()=>validateGraph(graph)).toThrow();
});
it('第九工具唯一 wire 精确核归属、版本和闭包，不默认补字段或把已保存等待说成完成',()=>{
  const {state,input}=fixture(),change=mutation(state,input),record=audit(change),receipt:AddQueuedDependencyReceipt={...identity,scopeId,mainRunId:'main-run',commandId:'add',taskId:'b',status:'waiting',trackedTaskIds:record.trackedTaskIds,addition:record,graphCursor:{streamId:'stream',seq:6}};
  const schema=mainToolOutputSchema('cbim_dispatch_add_dependency',{binding:{...identity,scopeId,runId:'main-run'},input,expectedCommandId:'add'});expect(schema.safeParse(receipt).success).toBe(true);
  for(const value of [null,{...receipt,workspaceId:'other'},{...receipt,status:'completed'},{...receipt,mainRunId:'wrong'},{...receipt,scopeId:'wrong'},{...receipt,extra:true},{...receipt,graphCursor:{streamId:'stream',seq:7}},{...receipt,trackedTaskIds:['a','b']},{...receipt,addition:{...record,dependency:{...record.dependency,sourcePlanRevision:2}}},{...receipt,addition:{...record,previousTaskRevision:2}}])expect(()=>checkedJsonToolResult('cbim_dispatch_add_dependency',value,schema)).toThrow(expect.objectContaining({code:'TOOL_OUTPUT_INVALID'}));
  expect(node(state,'b').dependencyAdditions).toBeUndefined();expect(taskNodeSchema.safeParse(node(state,'b')).success).toBe(true);
});
