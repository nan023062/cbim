import {vi} from 'vitest';
import type {DispatchState,DispatchCommandEvidence} from '../src/logic/dispatch/rules/dispatch-storage';
import type {RunSummary,StoredEvent} from '../src/logic/execution/rules/types';
import type {GoalPlanInput,GoalReviewInput} from '../src/logic/tasks/rules/scope-goal';
import type {VerifiableMainToolName} from '../src/logic/tasks/rules/command-verification';
import {hash,json} from '../src/core/platform/node/serialization';
import {toolReceipt} from '../src/logic/tools/rules/receipts';
import {jsonToolResult} from '../src/logic/tools/rules/results';
import {CommandVerificationService} from '../src/logic/evidence/runtime/command-verification-service';
import {mainToolBinding,mainToolGraph,mainToolScope,mainToolReplacement,mainToolTime,mainToolTask} from './main-tool-output-fixture';

export const reportBinding={...mainToolBinding,runId:'main-run'},reportIdentity={workspaceId:reportBinding.workspaceId,rootSessionId:reportBinding.rootSessionId,runId:reportBinding.runId,toolCallId:'original-call'};
export const reportPlan:GoalPlanInput={expectedRevision:1,objective:' 原目标 ',constraints:[],criteria:[{id:'c',text:' 原验收 ',kind:'evidence'}],assignments:[{agentId:'cbim:executor',moduleIds:['app'],criterionIds:['c'],reason:' 原分工 '}],reason:' 原理由 '};
const cursor={streamId:'stream',seq:1},target={taskId:'target',expectedRevision:2,expectedPlanRevision:1},source={taskId:'source',expectedRevision:1,expectedPlanRevision:1};
export function reportInputs():Array<{name:VerifiableMainToolName;input:unknown}>{return [
  {name:'cbim_goal_plan',input:reportPlan},
  {name:'cbim_goal_review',input:{expectedRevision:2,decision:'blocked',checks:[{criterionId:'c',outcome:'unmet',reason:' 缺事实 ',evidence:[]}],superseded:[],gaps:[' 缺证据 '],reason:' 暂停 '}},
  {name:'cbim_dispatch_task',input:{moduleIds:['app'],goal:' 原任务 ',acceptance:[{id:'c',text:' 原验收 '}]}},
  {name:'cbim_dispatch_cancel',input:{expectedGraphCursor:cursor,targets:[{taskId:'target',expectedRevision:2}],reason:' 明确取消 '}},
  {name:'cbim_dispatch_replace_dependency',input:{expectedGraphCursor:cursor,expectedGoalRevision:2,target,replace:{edgeId:'old-edge',expectedRevision:1},with:{...source,runId:'source-run',resultId:'source-result'},reason:' 明确换边 '}},
  {name:'cbim_dispatch_add_dependency',input:{expectedGraphCursor:cursor,expectedGoalRevision:2,source,target,reason:' 明确加边 '}},
  {name:'cbim_dispatch_resume',input:{expectedGraphCursor:cursor,expectedGoalRevision:2,taskId:'target',expectedRevision:2,checkpointId:'checkpoint',reason:' 明确预约 '}},
  {name:'cbim_dispatch_abandon_checkpoint',input:{expectedGraphCursor:cursor,expectedGoalRevision:2,taskId:'target',expectedRevision:2,expectedPlanRevision:1,checkpointId:'checkpoint',expectedResumeRequestId:null,reason:'明确放弃'}},
  {name:'cbim_dispatch_revise_dependencies',input:{expectedGraphCursor:cursor,expectedGoalRevision:2,target,remove:[{edgeId:'old-edge',expectedRevision:1}],add:[source],reason:' 原子修订 '}},
]}
/** 这是只读适配器的已校验端口样本，不写入 Store 或制造新的执行资格。 */
export function reportReceipt(name:VerifiableMainToolName,input:any,commandId:string):unknown{
  const identity={workspaceId:reportBinding.workspaceId,rootSessionId:reportBinding.rootSessionId},context={...identity,scopeId:reportBinding.scopeId,mainRunId:reportBinding.runId,commandId},nextCursor={...cursor,seq:2};
  if(name==='cbim_goal_plan')return mainToolScope(reportBinding,input);
  if(name==='cbim_goal_review')return mainToolScope(reportBinding,{...reportPlan,objective:reportPlan.objective.trim(),criteria:[{id:'c',text:'原验收',kind:'evidence'}],assignments:[{agentId:'cbim:executor',moduleIds:['app'],criterionIds:['c'],reason:'原分工'}],reason:'原理由'},input as GoalReviewInput);
  if(name==='cbim_dispatch_task')return {commandId,taskId:'target',messageId:'assignment',cursor:{...identity,...nextCursor},disposition:'queued'};
  if(name==='cbim_dispatch_cancel')return {...context,cancelledTaskIds:['target'],graphCursor:nextCursor};
  if(name==='cbim_dispatch_replace_dependency')return mainToolReplacement(reportBinding,commandId,input);
  if(name==='cbim_dispatch_add_dependency')return {...context,taskId:'target',status:'waiting',trackedTaskIds:['source','target'],graphCursor:nextCursor,addition:{commandId,scopeId:reportBinding.scopeId,mainRunId:reportBinding.runId,reason:input.reason,graphCursor:cursor,goalRevision:2,goalPlanRevision:2,knowledgeRevision:'knowledge',previousTaskRevision:2,targetPlanRevision:1,trackedTaskIds:['source','target'],addedAt:mainToolTime,dependency:{edgeId:'new-edge',sourceTaskId:'source',sourceTaskRevision:1,sourcePlanRevision:1}}};
  if(name==='cbim_dispatch_resume')return {taskId:'target',checkpointId:'checkpoint',requestId:'resume-message',trackedTaskIds:['target'],cursor:{...identity,...nextCursor}};
  if(name==='cbim_dispatch_revise_dependencies')return {...context,taskId:'target',status:'waiting',trackedTaskIds:['target','old-source','source'],graphCursor:nextCursor,revision:{commandId,scopeId:context.scopeId,mainRunId:context.mainRunId,revisedAt:mainToolTime,request:input,goalPlanRevision:2,knowledgeRevision:'knowledge',removed:[{edgeId:'old-edge',edgeRevision:1,sourceTaskId:'old-source',sourceTaskRevision:1,sourcePlanRevision:1}],added:[{edgeId:'new-edge',sourceTaskId:'source',sourceTaskRevision:1,sourcePlanRevision:1}],trackedTaskIds:['target','old-source','source']}};
  return {...context,taskId:'target',status:'cancelled',graphCursor:nextCursor,abandonment:{kind:'abandoned_by_handoff',commandId,scopeId:reportBinding.scopeId,mainRunId:reportBinding.runId,graphCursor:cursor,goalRevision:2,previousTaskRevision:2,planRevision:1,checkpointId:'checkpoint',sourceRunId:'source-run',resumeRequestId:null,previousLeaseEpoch:1,nextLeaseEpoch:2,reason:input.reason,abandonedAt:mainToolTime}};
}
export function reportFixture(name:string,input:unknown,evidence?:DispatchCommandEvidence){
  const graph=mainToolGraph(reportBinding),scope=mainToolScope(reportBinding);scope.runTracking={version:1,mainRunIds:[reportBinding.runId]};
  const binding={workspaceId:reportIdentity.workspaceId,teamId:'team',agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'conversation-session',rootSessionId:reportIdentity.rootSessionId};
  const task={workspaceId:reportIdentity.workspaceId,taskId:reportIdentity.rootSessionId,mode:'chat' as const,agentId:'cbim:main',root:'/isolated',moduleIds:[],goal:'原用户目标',acceptance:[]};
  const event=(type:StoredEvent['type'],data:StoredEvent['data'],seq:number):StoredEvent=>({version:1,type,data,seq,workspaceId:reportIdentity.workspaceId,taskId:task.taskId,runId:reportIdentity.runId,time:mainToolTime});
  const call={id:reportIdentity.toolCallId,name,input:input as Record<string,unknown>},decision={allow:true as const,effects:['maintenance' as const],scope:{kind:'workspace' as const,workspaceId:reportIdentity.workspaceId}},result=jsonToolResult(name,{error:'TOOL_OUTPUT_INVALID'}),receipt=toolReceipt({workspaceId:reportIdentity.workspaceId,taskId:task.taskId,runId:reportIdentity.runId},call,decision,'failed',result);
  const summary:RunSummary={task,runId:reportIdentity.runId,status:'running',acceptance:'not_evaluated',conversationBinding:binding,unresolvedTools:[],toolReceipts:[receipt],logIntegrity:{partialTail:false},events:[event('run.started',{task,conversationBinding:binding},1),event('tool.proposed',call,2),event('tool.allowed',{...call,effects:decision.effects,scope:decision.scope},3),event('tool.finished',{...call,isError:true,result,receipt},4)]};
  const state:DispatchState={workspaceId:reportIdentity.workspaceId,graphs:[graph],scopes:[scope],members:[{workspaceId:binding.workspaceId,teamId:binding.teamId,agentId:binding.agentId,agentInstanceId:binding.agentInstanceId,mainRootSessionId:binding.rootSessionId,leaseEpoch:0,configurationRevision:'knowledge',agentSessionIds:[binding.agentSessionId,graph.root.agent.agentSessionId],activity:'idle',waitingTaskIds:[],communicatingMessageIds:[]}],sessions:[{...binding,purpose:'conversation'},{...binding,agentSessionId:graph.root.agent.agentSessionId,purpose:'task'}],outbox:[],runs:[]};
  if(name==='cbim_dispatch_task'&&evidence){const receipt=evidence.receipt as {commandId:string};const task=mainToolTask(reportBinding,'target');graph.tasks.push(task);state.outbox.push({kind:'assignment',messageId:'assignment',commandId:receipt.commandId,identity:graph.identity,from:task.requester,to:task.assignee,taskId:task.taskId,planRevision:task.planRevision,createdAt:mainToolTime,delivery:'processed'})}
  const read=vi.fn(async()=>structuredClone(state)),commandEvidence=vi.fn(async()=>structuredClone(evidence)),inspectMain=vi.fn(async()=>structuredClone(summary)),owner={entry:{id:reportIdentity.workspaceId,path:'/isolated',name:'Fixture'},assert:vi.fn()};
  const service=new CommandVerificationService(owner,{read,commandEvidence},{inspectMain});
  return {service,summary,state,read,commandEvidence,inspectMain,owner};
}
export function evidenceFor(name:VerifiableMainToolName,input:unknown,commandId:string,fingerprint:string):DispatchCommandEvidence{
  return {fingerprint,receipt:reportReceipt(name,input,commandId),commit:{transactionSeq:3,checksum:hash('verified durable transaction'),executionProtocol:'legacy'},...(!name.startsWith('cbim_goal_')?{graph:{identity:{workspaceId:reportIdentity.workspaceId,rootSessionId:reportIdentity.rootSessionId},before:{cursor:{workspaceId:reportIdentity.workspaceId,rootSessionId:reportIdentity.rootSessionId,...cursor},rootRevision:7},afterCursor:{workspaceId:reportIdentity.workspaceId,rootSessionId:reportIdentity.rootSessionId,streamId:'stream',seq:2},cause:name==='cbim_dispatch_task'?'task.dispatched' as const:name==='cbim_dispatch_cancel'||name==='cbim_dispatch_abandon_checkpoint'?'task.cancelled' as const:name==='cbim_dispatch_resume'?'task.resume_requested' as const:'dependency.changed' as const}}:{})};
}
export const rawInputHash=(input:unknown)=>hash(JSON.stringify(input));
export const parsedFingerprint=(value:unknown)=>hash(json(value));
