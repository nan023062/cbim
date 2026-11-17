// view/tasks: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,test} from 'vitest';
import {applyGraphBatch,readGraphDelta} from '../../../logic/tasks/rules/graph-reducer';
import {validateGraph} from '../../../logic/tasks/rules/graph-rules';
import {validateTaskNode} from '../../../logic/tasks/rules/graph-rules';
import {memberReviewStage} from '../member-review-state';
import {dependenciesReady} from '../../../logic/team/runtime/member-state';
import type {AgentRef,GraphChange,GraphEventBatch,GraphSnapshot,TaskNode} from '../../../logic/tasks/rules/graph-types';

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
