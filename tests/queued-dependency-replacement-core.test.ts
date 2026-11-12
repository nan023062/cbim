import {expect,it} from 'vitest';
import {applyGraphBatch} from '../src/backend/core/tasks/graph-reducer';
import {validateGraph} from '../src/backend/core/tasks/graph-rules';
import {validateDispatchExecution} from '../src/backend/core/tasks/dispatch-invariants';
import {queuedDependencyReplacementSelection} from '../src/backend/core/tasks/queued-dependency-replacement-rules';
import {validateQueuedDependencyReplacement} from '../src/backend/core/tasks/queued-dependency-replacement-invariants';
import {dependencyReplacementSchema,replaceQueuedDependencyInputSchema,type DependencyReplacement,type ReplaceQueuedDependencyInput} from '../src/backend/core/tasks/queued-dependency-replacement';
import type {DispatchMutation,DispatchState} from '../src/backend/core/dispatch/dispatch-storage';
import type {DispatchRun} from '../src/backend/core/tasks/dispatch-execution';
import type {AgentRef,GraphEdge,GraphEventBatch,TaskNode} from '../src/backend/core/tasks/graph-types';

const identity={workspaceId:'workspace',rootSessionId:'root'},scopeId='scope',stamp='2026-11-07T00:00:00.000Z',later='2026-11-07T00:00:01.000Z';
const main:AgentRef={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主调度'};
const ref=(id:string):AgentRef=>({agentId:'executor',agentInstanceId:'instance-'+id,agentSessionId:'session-'+id,name:'执行者'});
function task(id:string,status:TaskNode['status']):TaskNode{return {kind:'task',nodeId:'task:'+id,taskId:id,identity,scopeId,requester:main,assignee:ref(id),modules:[{moduleId:'module',name:'模块',knowledgeRevision:'knowledge',maintenanceBindingId:'maintain',maintainerPersonIds:['owner'],workflow:{kind:'general',id:'cbim:general',version:'1',reason:'通用'}}],goal:'执行 '+id,acceptance:[{id:'check',text:'真实证据'}],revision:1,planRevision:1,status,awaitedChildren:[],runIds:[],createdAt:stamp,updatedAt:stamp}}
function fixture(){
  const a=task('a','failed'),b=task('b','waiting'),c=task('c','waiting'),a2=task('a2','result_ready');a.runIds=['run-a'];a2.runIds=['run-a2'];a2.result={resultId:'result-a2',runId:'run-a2',planRevision:1,summary:'有效候选',evidenceRefs:['read-1'],limitations:[],acceptance:'not_evaluated'};
  const tasks=[a,b,c,a2],edges:GraphEdge[]=tasks.map(value=>({edgeId:'dispatch-'+value.taskId,identity,kind:'dispatch',fromNodeId:'session:root',toNodeId:value.nodeId,revision:1,enabled:true}));
  edges.push({edgeId:'a-b',identity,kind:'dependency',fromNodeId:a.nodeId,toNodeId:b.nodeId,revision:1,enabled:true,condition:{kind:'result_ready',planRevision:1}},{edgeId:'b-c',identity,kind:'dependency',fromNodeId:b.nodeId,toNodeId:c.nodeId,revision:1,enabled:true,condition:{kind:'result_ready',planRevision:1}});
  const state:DispatchState={workspaceId:identity.workspaceId,members:tasks.map(value=>({workspaceId:identity.workspaceId,teamId:'team',agentId:'executor',agentInstanceId:value.assignee.agentInstanceId,executionScopeId:scopeId,executionTaskId:value.taskId,lifecycle:'active',leaseEpoch:value.runIds.length,configurationRevision:'knowledge',agentSessionIds:[value.assignee.agentSessionId],activity:value.status==='waiting'?'waiting':'idle',waitingTaskIds:value.status==='waiting'?[value.taskId]:[],communicatingMessageIds:[]})),sessions:tasks.map(value=>({workspaceId:identity.workspaceId,teamId:'team',agentId:'executor',agentInstanceId:value.assignee.agentInstanceId,agentSessionId:value.assignee.agentSessionId,rootSessionId:'root'})),graphs:[{version:1,identity,cursor:{...identity,streamId:'stream',seq:5},root:{kind:'session-root',nodeId:'session:root',identity,agent:main,revision:1,createdAt:stamp},tasks,edges,agents:[{...main,revision:1,state:'idle',waitingTaskIds:[]},...tasks.map(value=>({agentInstanceId:value.assignee.agentInstanceId,agentId:'executor',name:'执行者',revision:1,state:value.status==='waiting'?'waiting' as const:'idle' as const,waitingTaskIds:value.status==='waiting'?[value.taskId]:[]}))].map(({agentSessionId:_,...value}:any)=>value)}],outbox:tasks.map(value=>({messageId:'assignment-'+value.taskId,commandId:'dispatch-'+value.taskId,identity,kind:'assignment',from:main,to:value.assignee,taskId:value.taskId,planRevision:1,createdAt:stamp,delivery:value.runIds.length?'processed':'pending',...(value.runIds.length?{claim:{runId:value.runIds[0],leaseEpoch:1}}:{})})),runs:[],scopes:[{scopeId,...identity,status:'active',createdAt:stamp,runTracking:{version:1,mainRunIds:['main-run']},goal:{revision:2,input:{message:'目标',attachmentIds:[]},plan:{revision:2,runId:'main-run',recordedAt:stamp,knowledgeRevision:'knowledge',graphCursor:{streamId:'stream',seq:1},objective:'目标',constraints:[],criteria:[{id:'check',kind:'evidence',text:'真实证据'}],assignments:[{agentId:'executor',agentName:'执行者',teamId:'team',moduleIds:['module'],moduleNames:['模块'],criterionIds:['check'],reason:'分工'}],reason:'按图派发'}}}]};
  // 本组只验证纯存储约束；canonical 内容由服务和真实 Pi 测试独立核实，不能把这些结构 fixture 当执行证据。
  state.runs=[a,a2].map(value=>({binding:{...identity,teamId:'team',agentId:'executor',agentInstanceId:value.assignee.agentInstanceId,agentSessionId:value.assignee.agentSessionId,taskId:value.taskId,runId:value.runIds[0],leaseEpoch:1,planRevision:1},assignmentMessageId:'assignment-'+value.taskId,status:value.status==='failed'?'failed':'completed',prepared:{knowledgeRevision:'knowledge'},model:{},permission:'read',session:{nativeSessionId:'native-'+value.taskId},createdAt:stamp,startedAt:stamp,settledAt:stamp} as DispatchRun));
  const input:ReplaceQueuedDependencyInput={expectedGraphCursor:{streamId:'stream',seq:5},expectedGoalRevision:2,target:{taskId:'b',expectedRevision:1,expectedPlanRevision:1},replace:{edgeId:'a-b',expectedRevision:1},with:{taskId:'a2',expectedRevision:1,expectedPlanRevision:1,runId:'run-a2',resultId:'result-a2'},reason:'替代原失败前置'};
  return {state,input};
}
function mutation(state:DispatchState,input:ReplaceQueuedDependencyInput):DispatchMutation{
  const selected=queuedDependencyReplacementSelection(state,identity,scopeId,input),{target,source,replacement,edge,graph,status}=selected;
  const record:DependencyReplacement={commandId:'replace',scopeId,mainRunId:'main-run',replacedAt:later,reason:input.reason,graphCursor:input.expectedGraphCursor,goalRevision:2,goalPlanRevision:2,knowledgeRevision:'knowledge',previousTaskRevision:target.revision,targetPlanRevision:target.planRevision,retired:{edgeId:edge.edgeId,revision:edge.revision,sourceTaskId:source.taskId,sourcePlanRevision:1},replacement:{edgeId:'new-edge',sourceTaskId:replacement.taskId,sourceTaskRevision:replacement.revision,sourcePlanRevision:1,runId:'run-a2',resultId:'result-a2'},trackedTaskIds:selected.tasks.map(value=>value.taskId)};
  const updated={...target,revision:target.revision+1,status,updatedAt:later,waitReason:status==='waiting'?'等待其余前置任务的有效结果':undefined,dependencyReplacements:[...(target.dependencyReplacements??[]),record]},member=selected.members[0],view=graph.agents.find(value=>value.agentInstanceId===member.agentInstanceId)!;
  return {members:[{...member,activity:status==='waiting'?'waiting':'idle',waitingTaskIds:status==='waiting'?[target.taskId]:[]}],batch:{version:1,identity,streamId:'stream',seq:6,eventId:'event-replace',commandId:'replace',cause:'dependency.changed',committedAt:later,changes:[{type:'edge.upserted',edge:{...edge,revision:2,enabled:false}},{type:'edge.upserted',edge:{edgeId:'new-edge',identity,kind:'dependency',fromNodeId:replacement.nodeId,toNodeId:target.nodeId,revision:1,enabled:true,condition:{kind:'result_ready',planRevision:1,resultId:'result-a2'}}},{type:'task.upserted',task:updated},{type:'agent.upserted',agent:{...view,revision:view.revision+1,state:status==='waiting'?'waiting':'idle',waitingTaskIds:status==='waiting'?[target.taskId]:[]}}]},receipt:true};
}
function apply(state:DispatchState,change:DispatchMutation){const next=structuredClone(state);if(change.batch)next.graphs[0]=applyGraphBatch(state.graphs[0],change.batch);for(const value of change.members??[])next.members[next.members.findIndex(item=>item.agentInstanceId===value.agentInstanceId)]=value;return next}
const validate=(state:DispatchState,change:DispatchMutation)=>{const next=apply(state,change);validateDispatchExecution(state,next,change,{commandId:'replace',fingerprint:'replace'});return next};

it('原子换边保留 B/C 身份与计划，旧 A 仍失败，全部后继进入跟踪并保持 C 等待',()=>{
  const {state,input}=fixture(),before=structuredClone(state),change=mutation(state,input),next=validate(state,change);validateGraph(next.graphs[0]);
  expect(state).toEqual(before);expect(next.graphs[0].tasks[1]).toMatchObject({taskId:'b',status:'queued',revision:2,planRevision:1,assignee:state.graphs[0].tasks[1].assignee,runIds:[],dependencyReplacements:[{trackedTaskIds:['b','c']}]});
  for(const index of [0,2,3])expect(next.graphs[0].tasks[index]).toEqual(state.graphs[0].tasks[index]);expect(next.outbox).toEqual(state.outbox);expect(next.sessions).toEqual(state.sessions);expect(next.runs).toEqual(state.runs);expect(next.scopes).toEqual(state.scopes);
});
it('模型输入和审计严格拒绝伪造身份、未知字段、非法 ID 与重复后继',()=>{
  const {state,input}=fixture();expect(replaceQueuedDependencyInputSchema.safeParse(input).success).toBe(true);
  for(const invalid of [{...input,scopeId:'forged'},{...input,with:{...input.with,runId:'../bad'}},{...input,target:{...input.target,goal:'扩大'}},{...input,reason:' '},{...input,expectedGraphCursor:{...input.expectedGraphCursor,seq:1.5}}])expect(replaceQueuedDependencyInputSchema.safeParse(invalid).success).toBe(false);
  const record=mutation(state,input).batch!.changes.find(change=>change.type==='task.upserted')!;if(record.type!=='task.upserted')throw Error();expect(dependencyReplacementSchema.safeParse({...record.task.dependencyReplacements![0],trackedTaskIds:['b','b']}).success).toBe(false);
});
it('过期版本、跨周期、失败候选和旧知识不能修订前置',()=>{
  const cases:Array<(state:DispatchState,input:ReplaceQueuedDependencyInput)=>void>=[
    (_s,i)=>{i.expectedGraphCursor.seq--},(_s,i)=>{i.expectedGoalRevision++},(_s,i)=>{i.target.expectedRevision++},(_s,i)=>{i.with.expectedPlanRevision++},(_s,i)=>{i.replace.expectedRevision++},
    s=>{s.scopes![0].status='waiting'},s=>{s.graphs[0].tasks[1].scopeId='other'},s=>{s.graphs[0].tasks[3].status='failed'},s=>{s.graphs[0].tasks[0].status='interrupted'},s=>{s.runs![0].status='interrupted'},s=>{s.graphs[0].tasks[3].modules[0].moduleId='other'},s=>{s.runs![1].prepared.knowledgeRevision='old'},s=>{s.members[2].configurationRevision='old'},s=>{s.scopes![0].goal!.inputRevision=2},
  ];for(const alter of cases){const {state,input}=fixture();alter(state,input);expect(()=>queuedDependencyReplacementSelection(state,identity,scopeId,input)).toThrow()}
});
it('已领取或已执行后继、别的成员活动和不匹配目标分工整批拒绝',()=>{
  const cases:Array<(state:DispatchState)=>void>=[s=>{s.graphs[0].tasks[2].runIds=['run-c']},s=>{s.graphs[0].tasks[2].status='cancelled'},s=>{s.graphs[0].tasks[2].scopeId='other'},s=>{s.outbox[2].claim={runId:'claimed',leaseEpoch:1}},s=>{s.members[2].communicatingMessageIds=['busy']},s=>{s.members[2].lifecycle='released'},s=>{s.scopes![0].goal!.plan!.assignments[0].moduleIds=['other']}];
  for(const alter of cases){const {state,input}=fixture();alter(state);expect(()=>queuedDependencyReplacementSelection(state,identity,scopeId,input)).toThrow()}
});
it('目标计划改选 Workflow 后不能重新启用原默认待办，后继选择也必须逐项匹配',()=>{
  const {state,input}=fixture(),assignment=state.scopes![0].goal!.plan!.assignments[0];assignment.workflowSelections=[{moduleId:'module',workflowId:'explicit'}];
  const before=structuredClone(state);expect(()=>queuedDependencyReplacementSelection(state,identity,scopeId,input)).toThrow(expect.objectContaining({code:'DEPENDENCY_KNOWLEDGE_STALE'}));expect(state).toEqual(before);
  for(const task of state.graphs[0].tasks.slice(1,3)){task.workflowSelections=structuredClone(assignment.workflowSelections);task.modules[0].workflow={kind:'module',id:'explicit',version:'1'}}
  expect(queuedDependencyReplacementSelection(state,identity,scopeId,input).tasks.map(task=>task.taskId)).toEqual(['b','c']);
  state.graphs[0].tasks[2].workflowSelections=[{moduleId:'module',workflowId:'other'}];expect(()=>queuedDependencyReplacementSelection(state,identity,scopeId,input)).toThrow();
});
it('检测重复前置和后继候选造成的环，其余未满足前置不会被单条替换移除',()=>{
  for(const kind of ['duplicate','cycle'] as const){const {state,input}=fixture();state.graphs[0].edges.push({edgeId:'extra',identity,kind:'dependency',fromNodeId:kind==='duplicate'?'task:a2':'task:c',toNodeId:kind==='duplicate'?'task:b':'task:a2',revision:1,enabled:true,condition:{kind:'result_ready',planRevision:1}});expect(()=>queuedDependencyReplacementSelection(state,identity,scopeId,input)).toThrow()}
  const {state,input}=fixture(),x=task('x','queued');state.graphs[0].tasks.push(x);state.graphs[0].edges.push({edgeId:'x-b',identity,kind:'dependency',fromNodeId:x.nodeId,toNodeId:'task:b',revision:1,enabled:true,condition:{kind:'result_ready',planRevision:1}});expect(queuedDependencyReplacementSelection(state,identity,scopeId,input).status).toBe('waiting');
});
it('直接事务不能删除门禁、漏记后继或夹带目标/信封/成员/计划变更',()=>{
  const alters:Array<(change:DispatchMutation)=>void>=[change=>{change.batch!.changes=change.batch!.changes.filter(value=>value.type!=='task.upserted')},change=>{const value=change.batch!.changes.find(item=>item.type==='task.upserted')!;if(value.type==='task.upserted')value.task.dependencyReplacements![0].trackedTaskIds=['b']},change=>{const value=change.batch!.changes.find(item=>item.type==='task.upserted')!;if(value.type==='task.upserted'){value.task.goal='改目标';value.task.planRevision++}},change=>{change.messages=[fixture().state.outbox[1]]},change=>{change.members![0].leaseEpoch++},change=>{const value=change.batch!.changes.find(item=>item.type==='task.upserted')!;if(value.type==='task.upserted')value.task.dependencyReplacements![0].mainRunId='unknown-main'}];
  for(const alter of alters){const {state,input}=fixture(),change=mutation(state,input);alter(change);expect(()=>validate(state,change)).toThrow()}
  const {state,input}=fixture(),change=mutation(state,input);delete state.scopes![0].runTracking;expect(()=>validate(state,change)).toThrow();
});
it('通用 edge 更新不能加新前置、取消已有前置或伪造领取，初始新任务依赖仍允许',()=>{
  const {state}=fixture(),base=state.graphs[0].edges.find(value=>value.edgeId==='a-b')!;
  const edit=(edge:GraphEdge):DispatchMutation=>({batch:{version:1,identity,streamId:'stream',seq:6,eventId:'event',commandId:'replace',cause:'dependency.changed',committedAt:later,changes:[{type:'edge.upserted',edge}]},receipt:true});
  for(const edge of [{...base,revision:2,enabled:false},{...base,revision:2},{...base,edgeId:'forged',revision:1,fromNodeId:'task:a2'}])expect(()=>validateQueuedDependencyReplacement(state,state,edit(edge),{commandId:'replace',fingerprint:'x'})).toThrow();
  expect(()=>validateQueuedDependencyReplacement(state,state,edit({...base,edgeId:'initial',revision:1,toNodeId:'task:new'}),{commandId:'replace',fingerprint:'x'})).not.toThrow();
});
it('真实首次领取可固定已审计候选，重复同一候选也不被误认为另一次换边',()=>{
  const {state,input}=fixture(),next=validate(state,mutation(state,input)),edge=next.graphs[0].edges.find(value=>value.edgeId==='new-edge')!,run={...next.runs![1],binding:{...next.runs![1].binding,taskId:'b',runId:'run-b'},status:'starting' as const};
  const change:DispatchMutation={batch:{version:1,identity,streamId:'stream',seq:7,eventId:'claim',commandId:'claim',cause:'task.started',committedAt:later,changes:[{type:'edge.upserted',edge:{...edge,revision:2}}]},runs:[run],messages:[{...next.outbox[1],delivery:'claimed',claim:{runId:'run-b',leaseEpoch:1}}],receipt:true};
  expect(()=>validateQueuedDependencyReplacement(next,next,change,{commandId:'claim',fingerprint:'claim'})).not.toThrow();
  const changed=structuredClone(change);if(changed.batch!.changes[0].type==='edge.upserted'&&changed.batch!.changes[0].edge.kind==='dependency')changed.batch!.changes[0].edge.condition.resultId='forged';expect(()=>validateQueuedDependencyReplacement(next,next,changed,{commandId:'claim',fingerprint:'claim'})).toThrow();
});
it('历史审计不可改删，退役边不可重启；后续状态推进保留同一历史',()=>{
  const {state,input}=fixture(),next=validate(state,mutation(state,input)),graph=next.graphs[0],b=graph.tasks[1],old=graph.edges.find(value=>value.edgeId==='a-b')!;
  const event=(changes:GraphEventBatch['changes']):GraphEventBatch=>({version:1,identity,streamId:'stream',seq:7,eventId:'later',commandId:'later',cause:'task.revised',committedAt:later,changes});
  expect(()=>applyGraphBatch(graph,event([{type:'edge.upserted',edge:{...old,revision:3,enabled:true}}]))).toThrow();
  for(const history of [undefined,[{...b.dependencyReplacements![0],reason:'改写'}]])expect(()=>applyGraphBatch(graph,event([{type:'task.upserted',task:{...b,revision:3,dependencyReplacements:history}}]))).toThrow();
  const advanced=applyGraphBatch(graph,event([{type:'task.upserted',task:{...b,revision:3,status:'blocked',waitReason:'后续正常状态'}}]));expect(advanced.tasks[1].dependencyReplacements).toEqual(b.dependencyReplacements);
});
