import {expect,it} from 'vitest';
import {queuedDependencyRevisionSelection as select} from '../src/backend/core/tasks/queued-dependency-revision-rules';
import {reviseQueuedDependenciesInputSchema,type ReviseQueuedDependenciesInput} from '../src/backend/core/tasks/queued-dependency-revision';
import type {DispatchState} from '../src/backend/core/dispatch/dispatch-storage';
import type {AgentRef,TaskNode,GraphEdge} from '../src/backend/core/tasks/graph-types';
const identity={workspaceId:'workspace',rootSessionId:'root'},scopeId='scope',stamp='2026-11-07T00:00:00.000Z',later='2026-11-07T00:00:01.000Z';
const main:AgentRef={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主调度'};
const ref=(id:string):AgentRef=>({agentId:'executor',agentInstanceId:'instance-'+id,agentSessionId:'session-'+id,name:'执行者'});
function task(id:string,status:TaskNode['status']='queued'):TaskNode{return {kind:'task',nodeId:'task:'+id,taskId:id,identity,scopeId,requester:main,assignee:ref(id),modules:[{moduleId:'module',name:'模块',knowledgeRevision:'knowledge',maintenanceBindingId:'maintain',maintainerPersonIds:['owner'],workflow:{kind:'general',id:'cbim:general',version:'1',reason:'通用'}}],goal:'执行 '+id,acceptance:[{id:'check',text:'真实证据'}],revision:1,planRevision:1,status,awaitedChildren:[],runIds:[],createdAt:stamp,updatedAt:stamp}}
function fixture(ids=['b','c','a']){
  const tasks=ids.map(id=>task(id,id==='c'?'waiting':'queued')),edges:GraphEdge[]=tasks.map(value=>({edgeId:'dispatch-'+value.taskId,identity,kind:'dispatch',fromNodeId:'session:root',toNodeId:value.nodeId,revision:1,enabled:true}));
  if(ids.includes('b')&&ids.includes('c'))edges.push(edge('b','c'));
  const state:DispatchState={workspaceId:identity.workspaceId,members:tasks.map(value=>({workspaceId:identity.workspaceId,teamId:'team',agentId:'executor',agentInstanceId:value.assignee.agentInstanceId,executionScopeId:scopeId,executionTaskId:value.taskId,lifecycle:'active',leaseEpoch:0,configurationRevision:'knowledge',agentSessionIds:[value.assignee.agentSessionId],activity:value.status==='waiting'?'waiting':'idle',waitingTaskIds:value.status==='waiting'?[value.taskId]:[],communicatingMessageIds:[]})),sessions:tasks.map(value=>({workspaceId:identity.workspaceId,teamId:'team',agentId:'executor',agentInstanceId:value.assignee.agentInstanceId,agentSessionId:value.assignee.agentSessionId,rootSessionId:'root'})),graphs:[{version:1,identity,cursor:{...identity,streamId:'stream',seq:5},root:{kind:'session-root',nodeId:'session:root',identity,agent:main,revision:1,createdAt:stamp},tasks,edges,agents:[{agentId:main.agentId,agentInstanceId:main.agentInstanceId,name:main.name,revision:1,state:'idle',waitingTaskIds:[]},...tasks.map(value=>({agentInstanceId:value.assignee.agentInstanceId,agentId:'executor',name:'执行者',revision:1,state:value.status==='waiting'?'waiting' as const:'idle' as const,waitingTaskIds:value.status==='waiting'?[value.taskId]:[]}))]}],outbox:tasks.map(value=>({messageId:'assignment-'+value.taskId,commandId:'dispatch-'+value.taskId,identity,kind:'assignment',from:main,to:value.assignee,taskId:value.taskId,planRevision:1,createdAt:stamp,delivery:'pending'})),runs:[],scopes:[{scopeId,...identity,status:'active',createdAt:stamp,runTracking:{version:1,mainRunIds:['main-run']},goal:{revision:2,input:{message:'目标',attachmentIds:[]},plan:{revision:2,runId:'main-run',recordedAt:stamp,knowledgeRevision:'knowledge',graphCursor:{streamId:'stream',seq:1},objective:'目标',constraints:[],criteria:[{id:'check',kind:'evidence',text:'真实证据'}],assignments:[{agentId:'executor',agentName:'执行者',teamId:'team',moduleIds:['module'],moduleNames:['模块'],criterionIds:['check'],reason:'分工'}],reason:'按图派发'}}}]};
  state.graphs[0].edges.push(edge('a','b'));node(state,'b').status='waiting';state.members[0].activity='waiting';state.members[0].waitingTaskIds=['b'];state.graphs[0].agents[1].state='waiting';state.graphs[0].agents[1].waitingTaskIds=['b'];
  const input:ReviseQueuedDependenciesInput={expectedGraphCursor:{streamId:'stream',seq:5},expectedGoalRevision:2,target:{taskId:'b',expectedRevision:1,expectedPlanRevision:1},remove:[{edgeId:'a-b',expectedRevision:1}],add:[],reason:'移除尚未执行的前置'};
  return {state,input};
}
function edge(from:string,to:string):GraphEdge{return {edgeId:from+'-'+to,identity,kind:'dependency',fromNodeId:'task:'+from,toNodeId:'task:'+to,revision:1,enabled:true,condition:{kind:'result_ready',planRevision:1}}}
const node=(state:DispatchState,id:string)=>state.graphs[0].tasks.find(value=>value.taskId===id)!;
const selection=(state:DispatchState,input:ReviseQueuedDependenciesInput)=>select(state,identity,scopeId,'main-run',input);
it('删除最后前置重算排队，保留两端后继闭包，不修改传入状态',()=>{
 const {state,input}=fixture(),before=structuredClone(state),value=selection(state,input);
 expect(value.status).toBe('queued');expect(value.tasks.map(t=>t.taskId)).toEqual(['b','c','a']);expect(value.removed.map(e=>e.edgeId)).toEqual(['a-b']);expect(state).toEqual(before);
});
it('组合增删用完整新图判环，保留原图和新图受影响来源后继',()=>{
 const {state,input}=fixture(['b','c','a','d','outside']);state.graphs[0].edges.push(edge('d','a'),edge('outside','d'));input.add=[{taskId:'d',expectedRevision:1,expectedPlanRevision:1}];
 expect(selection(state,input).tasks.map(t=>t.taskId)).toEqual(['b','c','a','d']);expect(selection(state,input).status).toBe('waiting');
 input.add=[{taskId:'c',expectedRevision:1,expectedPlanRevision:1}];expect(()=>selection(state,input)).toThrow(expect.objectContaining({code:'GRAPH_CYCLE'}));
});
it('未更改的反向前置可已完成，剩余真实候选决定排队或等待',()=>{
 const {state,input}=fixture(['b','c','a','outside']),source=node(state,'outside');state.graphs[0].edges.push(edge('outside','b'));
 expect(selection(state,input).status).toBe('waiting');source.status='result_ready';source.runIds=['outside-run'];source.result={resultId:'outside-result',runId:'outside-run',planRevision:1,summary:'verified',evidenceRefs:['read'],limitations:[],acceptance:'not_evaluated'};
 expect(selection(state,input).tasks.map(t=>t.taskId)).toEqual(['b','c','a']);expect(selection(state,input).status).toBe('queued');
 source.result.planRevision=2;expect(selection(state,input).status).toBe('waiting');
});
it('严格拒绝空/重复/伪身份请求、原边重复加入、旧版本与不属于目标的边',()=>{
 const {input}=fixture();for(const bad of [{...input,remove:[]},{...input,remove:[...input.remove,...input.remove]},{...input,add:[input.target,input.target]},{...input,scopeId:'model'},{...input,add:[{...input.target,resultId:'forged'}]},{...input,reason:' '}])expect(reviseQueuedDependenciesInputSchema.safeParse(bad).success).toBe(false);
 const changes:Array<(s:DispatchState,i:ReviseQueuedDependenciesInput)=>void>=[(_s,i)=>i.expectedGraphCursor.seq--,(_s,i)=>i.expectedGoalRevision++,(_s,i)=>i.target.expectedRevision++,(_s,i)=>i.target.expectedPlanRevision++,(_s,i)=>i.remove[0].expectedRevision++,(_s,i)=>i.remove[0].edgeId='b-c',(_s,i)=>i.add=[{taskId:'a',expectedRevision:1,expectedPlanRevision:1}],(_s,i)=>i.add=[{...i.target}],s=>{s.scopes![0].runTracking!.mainRunIds.push('later-main')}];
 for(const change of changes){const {state,input}=fixture();change(state,input);expect(()=>selection(state,input)).toThrow()}
 const stale=fixture();node(stale.state,'a').planRevision=2;expect(()=>selection(stale.state,stale.input)).toThrow(expect.objectContaining({code:'DEPENDENCY_TASK_STALE'}));
});
it('删除也不能忽略已执行来源、被领取后继、过期计划或未知输入',()=>{
 const changes:Array<(s:DispatchState,id:string)=>void>=[(s,id)=>node(s,id).runIds.push('run'),(s,id)=>{node(s,id).status='interrupted'},(s,id)=>{node(s,id).checkpoints=[]},(s,id)=>{s.outbox.find(x=>x.taskId===id)!.delivery='claimed'},(s,id)=>{s.outbox.find(x=>x.taskId===id)!.claim={runId:'claim',leaseEpoch:1}},(s,id)=>{s.members.find(m=>m.executionTaskId===id)!.activity='working'},(s,id)=>{node(s,id).modules[0].knowledgeRevision='old'}];
 for(const id of ['a','b','c'])for(const change of changes){const {state,input}=fixture();change(state,id);expect(()=>selection(state,input)).toThrow()}
 const {state,input}=fixture();state.scopes![0].goal!.inputRevision=2;expect(()=>selection(state,input)).toThrow();
});
