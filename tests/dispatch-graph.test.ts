import {expect,test} from 'vitest';
import {applyGraphBatch,readGraphDelta} from '../src/backend/core/tasks/graph-reducer';
import {validateGraph} from '../src/backend/core/tasks/graph-rules';
import {validateTaskNode} from '../src/backend/core/tasks/graph-rules';
import {memberReviewStage} from '../src/frontend/tasks/member-review-state';
import {dependenciesReady} from '../src/backend/scheduler-engine/members/member-state';
import type {AgentRef,GraphChange,GraphEventBatch,GraphSnapshot,TaskNode} from '../src/backend/core/tasks/graph-types';

const identity={workspaceId:'workspace-1',rootSessionId:'conversation-1'};
const agent:AgentRef={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主 Agent'};
const stamp='2026-11-06T12:00:00.000Z';
function batch(seq:number,changes:GraphChange[]):GraphEventBatch{return {version:1,identity,streamId:'stream-1',seq,eventId:`event-${seq}`,commandId:`command-${seq}`,cause:seq===1?'graph.created':'task.dispatched',committedAt:stamp,changes}}
function initial(){return applyGraphBatch(undefined,batch(1,[
  {type:'root.upserted',root:{kind:'session-root',nodeId:'session:conversation-1',identity,agent,revision:1,createdAt:stamp}},
  {type:'agent.upserted',agent:{agentInstanceId:agent.agentInstanceId,agentId:agent.agentId,name:agent.name,revision:1,state:'idle',waitingTaskIds:[]}},
]))}
function task(id:string,parentTaskId?:string):TaskNode{return {kind:'task',nodeId:`task:${id}`,taskId:id,identity,...(parentTaskId?{parentTaskId}:{}),requester:agent,assignee:agent,
  modules:[{moduleId:'game',name:'玩法',knowledgeRevision:'knowledge-1',maintenanceBindingId:'maintenance-1',maintainerPersonIds:['person-1'],workflow:{kind:'general',id:'basic',version:'1',reason:'该模块没有专属流程'}}],
  goal:'交付可验证的玩法',acceptance:[{id:'playable',text:'真实浏览器可运行'}],revision:1,planRevision:1,status:'queued',awaitedChildren:[],runIds:[],createdAt:stamp,updatedAt:stamp}}
function dispatch(id:string,parentTaskId?:string):GraphChange[]{return [
  {type:'task.upserted',task:task(id,parentTaskId)},
  {type:'edge.upserted',edge:{kind:'dispatch',edgeId:`dispatch-${id}`,identity,fromNodeId:parentTaskId?`task:${parentTaskId}`:'session:conversation-1',toNodeId:`task:${id}`,revision:1,enabled:true}},
]}
function errorCode(action:()=>unknown){try{action();return undefined}catch(e){return (e as {code:string}).code}}

test('审阅展示完整阶段且门禁只接受同版本同结果；旧依赖保持既有语义',()=>{
  const source=task('source'),target=task('target');source.status='result_ready';source.runIds=['run'];
  source.result={resultId:'result',runId:'run',planRevision:1,summary:'候选',evidenceRefs:['tool'],limitations:[],acceptance:'not_evaluated'};
  const graph={...initial(),tasks:[source,target],edges:[{kind:'dependency' as const,edgeId:'edge',identity,fromNodeId:source.nodeId,toNodeId:target.nodeId,revision:1,enabled:true,condition:{kind:'result_ready' as const,planRevision:1,reviewRequired:true as const}}]};
  expect(dependenciesReady(graph,target)).toBe(false);
  expect(memberReviewStage(source)?.description).toContain('整体集成审阅');expect(memberReviewStage(source)?.description).toContain('用户验收');
  expect(memberReviewStage(source,[{...target,activeRunId:'active'}])?.description).toContain('等待当前成员运行结束');
  source.candidateReview={resultId:'result',runId:'run',planRevision:1,mainRunId:'main',decision:'accept',reason:'逐项核对',recordedAt:stamp};
  expect(dependenciesReady(graph,target)).toBe(true);expect(memberReviewStage(source)?.label).toBe('主 Agent 已审阅通过');validateTaskNode(source);
  source.candidateReview.resultId='old';expect(dependenciesReady(graph,target)).toBe(false);expect(errorCode(()=>validateTaskNode(source))).toBe('GRAPH_INPUT_INVALID');
  expect(memberReviewStage(source)?.label).toBe('交付待主 Agent 审阅');
  source.candidateReview.resultId='result';source.candidateReview.decision='reject';
  expect(memberReviewStage(source)?.description).toContain('逐项核对');expect(dependenciesReady(graph,target)).toBe(false);
  delete source.candidateReview;const legacy=structuredClone(graph);delete (legacy.edges[0].condition as {reviewRequired?:true}).reviewRequired;
  expect(dependenciesReady(legacy,legacy.tasks[1])).toBe(true);
});

test('a committed dispatch applies its task and edge together without mutating previous state',()=>{
  const first=initial(),event=batch(2,dispatch('a'));
  const next=applyGraphBatch(first,event);
  expect(first.tasks).toEqual([]);expect(first.cursor.seq).toBe(1);
  expect(next.tasks[0]).toMatchObject({taskId:'a',status:'queued',runIds:[]});
  expect(next.edges[0].toNodeId).toBe(next.tasks[0].nodeId);expect(next.cursor.seq).toBe(2);
  expect(next.root).toBe(first.root);expect(next.agents[0]).toBe(first.agents[0]);
  if(event.changes[0].type==='task.upserted')event.changes[0].task.goal='外部修改';
  expect(next.tasks[0].goal).toBe('交付可验证的玩法');
});
test('duplicates are idempotent only with matching committed content; gaps and conflicting repeats fail',()=>{
  const first=initial(),event=batch(2,dispatch('a')),next=applyGraphBatch(first,event);
  expect(applyGraphBatch(next,structuredClone(event))).toBe(next);
  expect(errorCode(()=>applyGraphBatch(next,{...event,eventId:'different-event'}))).toBe('GRAPH_EVENT_CONFLICT');
  expect(errorCode(()=>applyGraphBatch(next,batch(4,dispatch('b'))))).toBe('GRAPH_SEQUENCE_GAP');
  expect(errorCode(()=>applyGraphBatch(structuredClone(next),event))).toBe('GRAPH_EVENT_CONFLICT');
  expect(errorCode(()=>applyGraphBatch(first,{...event,identity:{...identity,workspaceId:'another'}}))).toBe('GRAPH_IDENTITY_MISMATCH');
});
test('graph rejects missing dispatch endpoints, empty module ownership and forged requester',()=>{
  const first=initial();
  expect(errorCode(()=>applyGraphBatch(first,batch(2,[{type:'task.upserted',task:task('a')}])))).toBe('GRAPH_INPUT_INVALID');
  for(const mutation of [
    (t:TaskNode)=>{t.modules=[]},
    (t:TaskNode)=>{t.modules[0].moduleId=''},
    (t:TaskNode)=>{t.requester={...agent,agentSessionId:'someone-else'}},
    (t:TaskNode)=>{t.modules[0].workflow={kind:'general',id:'basic',version:'1',reason:''}},
  ]){const changes=dispatch('a');if(changes[0].type==='task.upserted')mutation(changes[0].task);expect(errorCode(()=>applyGraphBatch(first,batch(2,changes)))).toBe('GRAPH_INPUT_INVALID')}
  expect(first.cursor.seq).toBe(1);
});
test('new tasks omit human maintenance and historical empty declarations remain readable',()=>{
  for(const legacy of [false,true]){
    const changes=dispatch('retired');
    if(changes[0].type==='task.upserted'){
      const binding=changes[0].task.modules[0];
      if(legacy)binding.maintainerPersonIds=[];
      else{delete binding.maintenanceBindingId;delete binding.maintainerPersonIds}
    }
    const graph=applyGraphBatch(initial(),batch(2,changes));
    expect(()=>validateGraph(JSON.parse(JSON.stringify(graph)))).not.toThrow();
    expect(graph.tasks[0].modules[0]).toMatchObject({moduleId:'game',workflow:{kind:'general'}});
  }
});
test('dispatch and prerequisite edges are checked together and retained projections remain intact on rejection',()=>{
  const first=initial(),next=applyGraphBatch(first,batch(2,[...dispatch('a'),...dispatch('b','a')]));
  const edge:GraphChange={type:'edge.upserted',edge:{kind:'dependency',edgeId:'reverse',identity,fromNodeId:'task:b',toNodeId:'task:a',revision:1,enabled:true,condition:{kind:'result_ready',planRevision:1}}};
  expect(errorCode(()=>applyGraphBatch(next,batch(3,[edge])))).toBe('GRAPH_CYCLE');
  expect(next.edges).toHaveLength(2);
});
test('an acyclic visible graph cannot introduce parent-child mutual waiting',()=>{
  const graph=applyGraphBatch(initial(),batch(2,[...dispatch('a'),...dispatch('b','a')]));
  const parent={...graph.tasks[0],revision:2,status:'waiting' as const,awaitedChildren:[{taskId:'b',planRevision:1}]};
  const changes:GraphChange[]=[
    {type:'task.upserted',task:parent},
    {type:'edge.upserted',edge:{kind:'dependency',edgeId:'a-needed-by-b',identity,fromNodeId:'task:a',toNodeId:'task:b',revision:1,enabled:true,condition:{kind:'result_ready',planRevision:1}}},
  ];
  expect(errorCode(()=>applyGraphBatch(graph,batch(3,changes)))).toBe('GRAPH_WAIT_CYCLE');
});
test('node revisions cannot skip or silently change the task plan or historical parent',()=>{
  const graph=applyGraphBatch(initial(),batch(2,dispatch('a'))),old=graph.tasks[0];
  expect(errorCode(()=>applyGraphBatch(graph,batch(3,[{type:'task.upserted',task:{...old,revision:3}}])))).toBe('GRAPH_REVISION_CONFLICT');
  expect(errorCode(()=>applyGraphBatch(graph,batch(3,[{type:'task.upserted',task:{...old,revision:2,goal:'扩大范围'}}])))).toBe('GRAPH_REVISION_CONFLICT');
  const revised=applyGraphBatch(graph,batch(3,[{type:'task.upserted',task:{...old,revision:2,planRevision:2,goal:'扩大范围'}}]));
  expect(revised.tasks[0].planRevision).toBe(2);
  expect(errorCode(()=>applyGraphBatch(graph,batch(3,[{type:'task.upserted',task:{...old,revision:2,parentTaskId:'other'}}])))).toBe('GRAPH_INPUT_INVALID');
});
test('incremental reads preserve empty references and return complete contiguous pages and reset reasons',()=>{
  const first=initial(),second=batch(2,dispatch('a')),third=batch(3,dispatch('b'));
  const graph=applyGraphBatch(applyGraphBatch(first,second),third),history=[second,third];
  expect(readGraphDelta(graph,history)).toMatchObject({mode:'reset',reason:'initial'});
  const delta=readGraphDelta(graph,history,first.cursor,1);
  expect(delta).toMatchObject({mode:'delta',cursor:{seq:2},hasMore:true,batches:[{seq:2}]});
  if(delta.mode!=='delta')throw Error('expected delta');
  expect(delta.batches[0].changes).toHaveLength(2);
  expect(readGraphDelta(graph,history,delta.cursor)).toMatchObject({mode:'delta',cursor:{seq:3},hasMore:false});
  const noop=readGraphDelta(graph,history,graph.cursor);expect(noop).toEqual({mode:'noop',cursor:graph.cursor});expect(noop.cursor).toBe(graph.cursor);
  expect(readGraphDelta(graph,history,{...graph.cursor,streamId:'old'})).toMatchObject({mode:'reset',reason:'stream_changed'});
  expect(readGraphDelta(graph,history,{...graph.cursor,seq:10})).toMatchObject({mode:'reset',reason:'cursor_ahead'});
  expect(readGraphDelta(graph,[third],first.cursor)).toMatchObject({mode:'reset',reason:'history_compacted'});
  expect(errorCode(()=>readGraphDelta(graph,history,{...first.cursor,rootSessionId:'other'}))).toBe('GRAPH_IDENTITY_MISMATCH');
  expect(errorCode(()=>readGraphDelta(graph,history,first.cursor,0))).toBe('GRAPH_INPUT_INVALID');
  expect(errorCode(()=>readGraphDelta(graph,[second],first.cursor))).toBe('GRAPH_LOG_CORRUPT');
});
test('snapshot validation rejects cross-graph references and falsely completed business results',()=>{
  const graph:GraphSnapshot=applyGraphBatch(initial(),batch(2,dispatch('a')));
  const foreign=structuredClone(graph);foreign.tasks[0].identity.rootSessionId='other';
  expect(errorCode(()=>validateGraph(foreign))).toBe('GRAPH_IDENTITY_MISMATCH');
  const complete=structuredClone(graph);complete.tasks[0].status='result_ready';
  expect(errorCode(()=>validateGraph(complete))).toBe('GRAPH_INPUT_INVALID');
});
