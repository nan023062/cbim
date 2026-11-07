import type {MainToolOutputBinding} from '../src/backend/core/tasks/main-tool-output';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import type {GoalPlanInput,GoalReviewInput} from '../src/backend/core/tasks/scope-goal';
import type {GraphSnapshot,TaskNode} from '../src/backend/core/tasks/graph-types';
import type {ReplaceQueuedDependencyInput,ReplaceQueuedDependencyReceipt} from '../src/backend/core/tasks/queued-dependency-replacement';

export const mainToolBinding:MainToolOutputBinding={workspaceId:'workspace',rootSessionId:'root',scopeId:'bound-scope',runId:'e5f28867-d117-451e-826e-b5bb4f7962c0'};
export const mainToolTime='2026-11-07T00:00:00.000Z';
export function mainToolGraph(binding=mainToolBinding):GraphSnapshot{
  const identity={workspaceId:binding.workspaceId,rootSessionId:binding.rootSessionId},agent={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'Main'};
  return {version:1,identity,cursor:{...identity,streamId:'stream',seq:1},root:{kind:'session-root',identity,nodeId:'session:'+binding.rootSessionId,agent,revision:1,createdAt:mainToolTime},tasks:[],edges:[],agents:[{agentInstanceId:agent.agentInstanceId,agentId:agent.agentId,name:agent.name,revision:1,state:'idle',waitingTaskIds:[]}]};
}
export function mainToolTask(binding=mainToolBinding,taskId='task'):TaskNode{
  const graph=mainToolGraph(binding);
  return {kind:'task',nodeId:'task:'+taskId,taskId,identity:graph.identity,scopeId:binding.scopeId,requester:graph.root.agent,assignee:{agentId:'cbim:executor',agentInstanceId:'member-instance',agentSessionId:'member-session',name:'Member'},modules:[{moduleId:'.cbim/workspace/client',name:'Client',knowledgeRevision:'knowledge',maintenanceBindingId:'maintenance',maintainerPersonIds:['owner'],workflow:{kind:'general',id:'general',version:'v1',reason:'general'}}],goal:'Actual task',acceptance:[{id:'verified',text:'Actual evidence'}],revision:2,planRevision:1,status:'result_ready',awaitedChildren:[],runIds:['member-run'],result:{resultId:'member-result',runId:'member-run',planRevision:1,summary:'Actual candidate',evidenceRefs:['read-one'],limitations:[],acceptance:'not_evaluated'},createdAt:mainToolTime,updatedAt:mainToolTime};
}
export function mainToolScope(binding:MainToolOutputBinding,plan?:GoalPlanInput,review?:GoalReviewInput):DispatchScope{
  const scope:DispatchScope={scopeId:binding.scopeId,workspaceId:binding.workspaceId,rootSessionId:binding.rootSessionId,status:'active',createdAt:mainToolTime,goal:{revision:1,inputRevision:1,input:{message:'Original user goal',attachmentIds:[]}}};
  const stamp={runId:binding.runId,recordedAt:mainToolTime,knowledgeRevision:'knowledge',graphCursor:{streamId:'stream',seq:1},inputRevision:1};
  if(plan){const {expectedRevision,...body}=plan;scope.goal!.revision=expectedRevision+1;scope.goal!.plan={...body,...stamp,revision:expectedRevision+1,assignments:body.assignments.map(item=>({...item,agentName:'Executor',teamId:'.cbim/team',moduleNames:item.moduleIds.map(()=>'Module')}))}}
  if(review){const {expectedRevision,...body}=review;scope.goal!.revision=expectedRevision+1;scope.goal!.review={...body,...stamp,revision:expectedRevision+1,planRevision:scope.goal!.plan!.revision,observedSeq:4,lastEffectSeq:0}}
  return scope;
}
export function mainToolReplacement(binding:MainToolOutputBinding,commandId:string,input:ReplaceQueuedDependencyInput):ReplaceQueuedDependencyReceipt{
  const trackedTaskIds=[input.target.taskId];
  return {workspaceId:binding.workspaceId,rootSessionId:binding.rootSessionId,scopeId:binding.scopeId,mainRunId:binding.runId,commandId,taskId:input.target.taskId,status:'queued',trackedTaskIds,graphCursor:{streamId:input.expectedGraphCursor.streamId,seq:input.expectedGraphCursor.seq+1},replacement:{commandId,scopeId:binding.scopeId,mainRunId:binding.runId,reason:input.reason,replacedAt:mainToolTime,graphCursor:{...input.expectedGraphCursor},goalRevision:input.expectedGoalRevision,goalPlanRevision:input.expectedGoalRevision,knowledgeRevision:'knowledge',previousTaskRevision:input.target.expectedRevision,targetPlanRevision:input.target.expectedPlanRevision,trackedTaskIds,retired:{edgeId:input.replace.edgeId,revision:input.replace.expectedRevision,sourceTaskId:'A',sourcePlanRevision:1},replacement:{edgeId:'new-edge',sourceTaskId:input.with.taskId,sourceTaskRevision:input.with.expectedRevision,sourcePlanRevision:input.with.expectedPlanRevision,runId:input.with.runId,resultId:input.with.resultId}}};
}
