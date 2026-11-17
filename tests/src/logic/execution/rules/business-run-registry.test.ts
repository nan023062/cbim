import {expect,it} from 'vitest';
import {baseState,writeIntent,phases,append,compensationIntent} from '../../file-operations/rules/support/controlled-file-core-fixture';
import {createScopeRunTracking} from '../../../../../src/logic/tasks/rules/scope-run-tracking';
import {agentBusinessRunCommand,projectAgentBusinessRuns} from '../../../../../src/logic/execution/rules/business-run-invariants';
import type {AgentBusinessRun} from '../../../../../src/logic/execution/rules/business-run';
import type {DispatchState} from '../../../../../src/logic/dispatch/rules/dispatch-storage';

function fixture(){
 const state=baseState(),old=state.runs![0],binding={...old.binding,taskId:'recursive-task',runId:'recursive-run'};
 state.scopes![0].runTracking=createScopeRunTracking('root-run');
 const parent={version:1 as const,workspaceId:state.workspaceId,callerTaskId:binding.rootSessionId,callerRunId:'root-run',toolCallId:'call',taskId:binding.taskId,runId:binding.runId};
 const run:AgentBusinessRun={protocol:'agent-tools-v1',binding,scopeId:state.scopes![0].scopeId,parent,lineage:[parent],prepared:old.prepared,permission:'execute',status:'active',createdAt:old.createdAt};
 const apply=(state:DispatchState,value:AgentBusinessRun)=>({...state,...projectAgentBusinessRuns(state,{agentBusinessRuns:[value],receipt:value},agentBusinessRunCommand(value))});
 return {state,run,apply};
}
it('registers a recursive identity without dispatching or changing a graph, then closes only that identity',()=>{
 const {state,run,apply}=fixture(),next=apply(state,run);expect(next.graphs).toEqual(state.graphs);expect(next.runs).toEqual(state.runs);
 expect(next.agentBusinessRuns).toEqual([run]);
 const closed={...run,status:'closed' as const,closedAt:run.createdAt},done=apply(next,closed);
 expect(done.agentBusinessRuns).toEqual([closed]);
 expect(()=>apply(done,run)).toThrow();
 expect(projectAgentBusinessRuns(done,{receipt:null},{commandId:'other',fingerprint:'other'})).toEqual({agentBusinessRuns:[closed]});
});
it.each(['parent','scope','knowledge','duplicate-call','mixed','closed-parent'] as const)('rejects invalid recursive registration (%s)',kind=>{
 const {state,run,apply}=fixture();let value=structuredClone(run),before=state;
 if(kind==='parent')value.lineage[0].callerRunId='foreign';
 if(kind==='scope')value.scopeId='foreign';
 if(kind==='knowledge')value.prepared.knowledgeRevision='foreign';
 if(kind==='closed-parent')before.scopes![0].status='closed';
 if(kind==='duplicate-call'){before=apply(state,run);value.binding.runId='second-run';value.binding.taskId='second-task';value.parent={...value.parent,runId:'second-run',taskId:'second-task'};value.lineage=[value.parent]}
 if(kind==='mixed')expect(()=>projectAgentBusinessRuns(state,{agentBusinessRuns:[run],scopes:[],receipt:run},agentBusinessRunCommand(run))).toThrow();
 else expect(()=>apply(before,value)).toThrow();
});
it('keeps recursive file phase and compensation guards on the original frozen run',()=>{
 const {state,run,apply}=fixture();let next=apply(state,run);
 // Build the original tool intent from the same frozen permission/owner, then give it the actual new binding.
 const original=writeIntent({...state,runs:[{...state.runs![0],binding:run.binding}]});
 for(const event of phases(original))next=append(next,event);
 expect(next.controlledFileChanges?.map(e=>e.phase)).toEqual(['prepared','executing','applied']);
 expect(()=>append(next,phases(compensationIntent(next,original.operationId))[0])).toThrow();
 next=apply(next,{...run,status:'closed',closedAt:run.createdAt});
 next.scopes![0]={...next.scopes![0],status:'closed',outcome:'cancelled',closedAt:run.createdAt};
 const compensation=compensationIntent(next,original.operationId);
 expect(append(next,phases(compensation)[0]).controlledFileChanges).toHaveLength(4);
 expect(()=>append(next,phases(writeIntent({...state,runs:[{...state.runs![0],binding:run.binding}]},'second-write'))[0])).toThrow();
});

it('refuses closing a business ancestor while an indirect business descendant remains active',()=>{
 const {state,run,apply}=fixture();let next=apply(state,run);
 const middle={...run.parent,callerTaskId:run.binding.taskId,callerRunId:run.binding.runId,toolCallId:'middle-call',taskId:'middle',runId:'middle-run'};
 const parent={...run.parent,callerTaskId:'middle',callerRunId:'middle-run',toolCallId:'grandchild-call',taskId:'grandchild',runId:'grandchild-run'};
 const child:AgentBusinessRun={...run,binding:{...run.binding,taskId:'grandchild',runId:'grandchild-run'},parent,lineage:[parent,middle,run.parent]};
 next=apply(next,child);expect(()=>apply(next,{...run,status:'closed',closedAt:run.createdAt})).toThrow();
 next=apply(next,{...child,status:'closed',closedAt:child.createdAt});expect(apply(next,{...run,status:'closed',closedAt:run.createdAt}).agentBusinessRuns?.every(r=>r.status==='closed')).toBe(true);
});

it.each(['read','ask','execute','legacy'] as const)('enforces the recursive inspection permission at the persisted registration boundary (%s)',mode=>{
 const {state,run,apply}=fixture(),time=run.createdAt;
 state.scopes![0].recovery={recoveryId:'00000000-0000-4000-8000-000000000001',acceptedAt:time,source:{kind:'member_run',executionModel:'agent-tools-v1',scopeId:'original',taskId:'original-task',runId:'original-run',toolCallIds:['original-write'],reportBasis:'a'.repeat(64),scopeOutcome:'interrupted',reportExecution:'unknown',logState:'verified',unknownToolCount:1},operation:'inspect_effects',observation:{text:'Inspect actual effects'},input:{message:'Read only'},options:{provider:'fixture',profileId:'00000000-0000-4000-8000-000000000002',model:'fixture',permission:'read'},context:{initialRunId:'root-run',nativeSessionId:'fresh-native',excludedRunIds:['original-run']}};
 if(mode==='legacy')state.scopes![0].recovery!.source={kind:'member_run',scopeId:'original',taskId:'original-task',runId:'original-run',toolCallIds:['original-write'],reportBasis:'a'.repeat(64),scopeOutcome:'interrupted',reportExecution:'unknown',logState:'verified',unknownToolCount:1,taskRevision:1,planRevision:1};
 const value={...run,permission:mode==='legacy'?'read' as const:mode};
 if(mode==='read')expect(apply(state,value).agentBusinessRuns).toEqual([value]);
 else expect(()=>apply(state,value)).toThrow(/只读递归核实/);
});

it.each(['valid','missing-request','dropped-acceptance','outside-module'] as const)('preserves recursive replan constraints at registration (%s)',mode=>{
 const {state,run,apply}=fixture();run.request={message:'new work',acceptance:['keep original requirement']};
 state.scopes![0].replan={replanId:'00000000-0000-4000-8000-000000000001',acceptedAt:run.createdAt,operation:'business_replan',input:{message:'new work'},options:{provider:'fixture',profileId:'00000000-0000-4000-8000-000000000002',model:'fixture',permission:'execute'},context:{initialRunId:'root-run',nativeSessionId:'new-native',excludedRunIds:['inspection-run']},source:{inspectionScopeId:'inspection',expectedBasis:'a'.repeat(64),proof:{executionModel:'agent-tools-v1',kind:'member_run',inspectionRunId:'inspection-run',inspectionGoalRevision:1,knowledgeRevision:run.prepared.knowledgeRevision,sourceScopeId:'source',sourceTaskId:'source-task',sourceRunId:'source-run',sourceToolCallIds:['write'],sourceReportBasis:'b'.repeat(64),evidenceDigest:'c'.repeat(64),requiredModules:run.prepared.modules.map(module=>({moduleId:module.binding.moduleId,name:'module'})),inheritedHuman:[],sourceAcceptance:['keep original requirement']}}};
 if(mode==='missing-request')delete run.request;
 if(mode==='dropped-acceptance')run.request!.acceptance=[];
 if(mode==='outside-module')state.scopes![0].replan!.source.proof.requiredModules=[{moduleId:'outside',name:'outside'}];
 if(mode==='valid'){
  const next=apply(state,run);expect(next.agentBusinessRuns![0].request).toEqual(run.request);
  expect(()=>apply(next,{...run,status:'closed',closedAt:run.createdAt,request:{message:'rewritten',acceptance:[]}})).toThrow();
 }else expect(()=>apply(state,run)).toThrow();
});
