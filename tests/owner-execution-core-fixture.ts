import {randomUUID} from 'node:crypto';
import {hash} from '../src/backend/core/foundation/serialization';
import type {DispatchState,DispatchMutation,DispatchCommand,AssignmentMessage} from '../src/backend/core/tasks/dispatch-storage';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import type {DispatchRun} from '../src/backend/core/tasks/dispatch-execution';
import type {TaskNode,AgentRef,GraphEventBatch} from '../src/backend/core/tasks/graph-types';
import type {AgentInstance,AgentSessionBinding} from '../src/backend/core/team/agent-types';
import type {WorkspaceMember,WorkspaceMemberChange,WorkspaceMemberChangeInput,WorkspaceMemberModelSnapshot} from '../src/backend/core/team/workspace-member';
import {summarizeWorkspaceMember} from '../src/backend/core/team/workspace-member';
import {workspaceMemberCapabilityHash,workspaceMemberModelHash,workspaceMemberHash,workspaceMemberCommand,workspaceMemberPreviewBasis,workspaceMemberProposed,workspaceMemberReceipt} from '../src/backend/core/team/workspace-member-rules';
import type {ModuleOwnershipChange,ModuleOwnershipChangeInput} from '../src/backend/core/workspace/module-ownership';
import {moduleOwnershipBasis,moduleOwnershipCommand,moduleOwnershipHash,moduleOwnershipReceipt} from '../src/backend/core/workspace/module-ownership-rules';
import {moduleOwnershipImpact} from '../src/backend/core/tasks/module-ownership-invariants';
import {knowledgeSourceSelection,createKnowledgeSourceCapture,knowledgeSourceRef} from '../src/backend/core/workspace/knowledge-source-rules';
import {projectKnowledgeSourceMutation} from '../src/backend/core/tasks/knowledge-source-invariants';
import {projectWorkspaceMemberMutation} from '../src/backend/core/tasks/workspace-member-invariants';
import {projectModuleOwnershipMutation} from '../src/backend/core/tasks/module-ownership-invariants';
import {ownerExecutionSelectionFor,type OwnerExecutionBinding} from '../src/backend/core/team/member-execution-binding';
import {resolveOwnerExecutionSelection} from '../src/backend/core/team/member-execution-rules';
import {dispatchKnowledgeFingerprint,type PreparedDispatchKnowledge} from '../src/backend/core/tasks/execution-context';

export const ws='owner-core',identity={workspaceId:ws,rootSessionId:'root'},at='2026-11-08T08:00:00.000Z',later='2026-11-08T08:00:01.000Z',scopeId='scope',knowledge='knowledge-1';
export const agentId='.cbim/team/dev',moduleId='.cbim/workspace/game',instanceId=randomUUID();
export const model:WorkspaceMemberModelSnapshot={id:randomUUID(),name:'Local',api:'openai-completions',baseUrl:'http://127.0.0.1:1/v1',auth:'none',model:'member-model',contextWindow:32000,maxTokens:1000,reasoning:false};
export const configuration={workspaceId:ws,teamId:'.cbim/team',agentId,name:'Developer',source:'workspace' as const,knowledgeRevision:knowledge,principles:'Check actual results',effectiveSkills:[{skillId:'.cbim/team/check',ownerId:'.cbim/team',inherited:true,content:'Keep verification evidence'}]};
export const empty=():DispatchState=>({workspaceId:ws,members:[],sessions:[],graphs:[],outbox:[],runs:[],scopes:[]});
const actor={kind:'local_desktop' as const,interaction:'explicit_submit' as const};
const observation={knowledgeRevision:knowledge,definitionHash:hash('definition'),visible:true as const};
export function memberEvent(state:DispatchState,input?:WorkspaceMemberChangeInput,publicModel=model){
  const ws=state.workspaceId;const capability={...structuredClone(configuration),workspaceId:ws};
  const old=input&&input.kind!=='register'?state.workspaceMembers!.find(member=>member.memberId===input.memberId):undefined;
  const change:WorkspaceMemberChangeInput=input??{kind:'register',agentId,name:'Implementation',position:'Implement module',adaptation:{instructions:'Project adaptation',references:[]},runtimePolicy:{profileId:publicModel.id,modelId:publicModel.model},reason:'Register job'};
  const changeId=randomUUID(),selected=change.kind==='register'||change.kind==='adopt'&&change.target==='capability';
  const selection=selected?knowledgeSourceSelection(state,{kind:'agent',sourceId:agentId},observation):undefined;
  const capture=selection?.kind==='workspace'&&!selection.expectedRef?createKnowledgeSourceCapture(state,selection,{changeId:randomUUID(),generationId:randomUUID(),streamId:randomUUID(),recordedAt:at,consumer:{kind:'workspace_member',changeId}}):undefined;
  const ref=selection?.kind==='workspace'?selection.expectedRef??(capture?knowledgeSourceRef(capture.generation):undefined):undefined;
  const policy={profileId:publicModel.id,modelId:publicModel.model,snapshot:structuredClone(publicModel),configurationHash:workspaceMemberModelHash(publicModel)};
  const next:WorkspaceMember=old?structuredClone(old):{workspaceId:ws,memberId:randomUUID(),revision:1,name:'Implementation',position:'Implement module',adaptation:{instructions:'Project adaptation',references:[]},state:'active',adoption:{captureId:randomUUID(),capturedAt:at,knowledgeRevision:knowledge,capabilityHash:workspaceMemberCapabilityHash(capability),configuration:structuredClone(capability)},runtimePolicy:policy,createdAt:at,updatedAt:at};
  if(change.kind==='register'){next.name=change.name;next.position=change.position;next.adaptation=structuredClone(change.adaptation)}
  if(old){next.revision++;if(change.kind==='state')next.state=change.nextState;if(change.kind==='update')Object.assign(next,change.patch);if(change.kind==='adopt'&&change.target==='model')next.runtimePolicy=policy;}
  if(selected)next.adoption={captureId:randomUUID(),capturedAt:at,knowledgeRevision:knowledge,capabilityHash:workspaceMemberCapabilityHash(capability),configuration:structuredClone(capability),sourceRef:ref!};
  const request={workspaceId:ws,instanceId,commandId:randomUUID(),change,expectedRegistryCursor:state.registryCursor??null,expectedBasis:workspaceMemberPreviewBasis({workspaceId:ws,change,registryCursor:state.registryCursor??null,previousMember:old,proposed:workspaceMemberProposed(next),...(selection?{sourceSelection:selection}:{})})};
  const event:WorkspaceMemberChange={version:1,request,changeId,registryCursor:{kind:'workspace_registry',workspaceId:ws,streamId:state.registryCursor?.streamId??randomUUID(),seq:(state.registryCursor?.seq??0)+1},previousRevision:old?.revision??0,previousMemberHash:old?workspaceMemberHash(old):null,next,actor,committedAt:at,...(selection?{sourceSelection:selection}:{})};
  return {event,command:workspaceMemberCommand(request),mutation:{workspaceMemberChanges:[event],...(capture?{knowledgeSourceChanges:[capture]}:{}),receipt:workspaceMemberReceipt(event)} as DispatchMutation};
}
export function ownershipEvent(state:DispatchState,ownerMemberId=state.workspaceMembers![0].memberId,selectedModule=moduleId){
  const ws=state.workspaceId;
  const previous=state.moduleOwnerships?.find(owner=>owner.moduleId===selectedModule)??null,owner=state.workspaceMembers!.find(member=>member.memberId===ownerMemberId)!,changeId=randomUUID();
  const input:ModuleOwnershipChangeInput={moduleId:selectedModule,expectedBinding:previous?{bindingId:previous.bindingId,revision:previous.revision,ownerMemberId:previous.ownerMemberId}:null,nextOwner:{memberId:owner.memberId,expectedRevision:owner.revision},reason:'Assign owner'};
  const selection=knowledgeSourceSelection(state,{kind:'module',sourceId:selectedModule},observation);if(selection.kind!=='workspace')throw Error('workspace source expected');const capture=!selection.expectedRef?createKnowledgeSourceCapture(state,selection,{changeId:randomUUID(),generationId:randomUUID(),streamId:randomUUID(),recordedAt:at,consumer:{kind:'module_ownership',changeId}}):undefined;
  const sourceRef=selection.expectedRef??knowledgeSourceRef(capture!.generation),observedModule={knowledgeRevision:knowledge,definitionHash:observation.definitionHash,observedAt:at},impact=moduleOwnershipImpact(state,selectedModule);
  const previousOwner=previous?.ownerMemberId?state.workspaceMembers!.find(member=>member.memberId===previous.ownerMemberId):undefined;
  const event:ModuleOwnershipChange={version:1,request:{workspaceId:ws,instanceId,commandId:randomUUID(),change:input,expectedOwnershipCursor:state.ownershipCursor??null,expectedBasis:moduleOwnershipBasis({workspaceId:ws,change:input,ownershipCursor:state.ownershipCursor??null,previous,...(previousOwner?{previousOwner:summarizeWorkspaceMember(previousOwner)}:{}),nextOwner:summarizeWorkspaceMember(owner),observedModule,sourceSelection:selection,impact})},actor,changeId,ownershipCursor:{kind:'module_ownership',workspaceId:ws,streamId:state.ownershipCursor?.streamId??randomUUID(),seq:(state.ownershipCursor?.seq??0)+1},previousRevision:previous?.revision??0,previousBindingHash:previous?moduleOwnershipHash(previous):null,sourceSelection:selection,next:{workspaceId:ws,bindingId:previous?.bindingId??randomUUID(),moduleId:selectedModule,revision:(previous?.revision??0)+1,ownerMemberId:owner.memberId,observedModule,sourceRef,createdAt:previous?.createdAt??at,updatedAt:at,lastChangeId:changeId},impact,committedAt:at};
  return {event,command:moduleOwnershipCommand(event.request,actor),mutation:{ownershipChanges:[event],...(capture?{knowledgeSourceChanges:[capture]}:{}),receipt:moduleOwnershipReceipt(event)} as DispatchMutation};
}
export function registryApply(state:DispatchState,record:{command:DispatchCommand;mutation:DispatchMutation}):DispatchState{
  const source=projectKnowledgeSourceMutation(state,record.mutation,record.command);return {...state,...projectWorkspaceMemberMutation(state,record.mutation,record.command,source.permit),...projectModuleOwnershipMutation(state,record.mutation,record.command,source.permit),...source.projection};
}
export function registry(){let state=empty();const member=memberEvent(state);state=registryApply(state,member);const owner=ownershipEvent(state);state=registryApply(state,owner);return {state,member,owner,binding:bindingFor(state)}}
export function bindingFor(state:DispatchState,modules=[moduleId]):OwnerExecutionBinding{
  const member=state.workspaceMembers!.find(member=>member.memberId===state.moduleOwnerships!.find(owner=>owner.moduleId===modules[0])!.ownerMemberId)!;
  return resolveOwnerExecutionSelection(state,{version:1,memberId:member.memberId,expectedMemberRevision:member.revision,expectedCapabilityHash:member.adoption.capabilityHash,expectedConfigurationHash:member.runtimePolicy.configurationHash,expectedOwners:modules.map(id=>{const o=state.moduleOwnerships!.find(owner=>owner.moduleId===id)!;return {moduleId:id,bindingId:o.bindingId,revision:o.revision,ownerMemberId:member.memberId}})},modules);
}
export const main:AgentRef={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-channel',name:'Main'};
export const dev:AgentRef={agentId,agentInstanceId:'member-instance',agentSessionId:'member-channel',name:'Developer'};
const member=(ref:AgentRef):AgentInstance=>({workspaceId:ws,teamId:'.cbim/team',agentId:ref.agentId,agentInstanceId:ref.agentInstanceId,leaseEpoch:0,configurationRevision:knowledge,agentSessionIds:[ref.agentSessionId],activity:'idle',waitingTaskIds:[],communicatingMessageIds:[]});
const session=(ref:AgentRef):AgentSessionBinding=>({...identity,teamId:'.cbim/team',agentId:ref.agentId,agentInstanceId:ref.agentInstanceId,agentSessionId:ref.agentSessionId});
export const command=(commandId:string)=>({commandId,fingerprint:commandId});
export const batch=(commandId:string,seq:number,changes:GraphEventBatch['changes'],cause:GraphEventBatch['cause']='task.dispatched'):GraphEventBatch=>({version:1,identity,streamId:'stream',seq,eventId:'event-'+seq,commandId,cause,committedAt:at,changes});
export function rootMutation():DispatchMutation{return {members:[member(main)],sessions:[session(main)],batch:batch('root',1,[{type:'root.upserted',root:{kind:'session-root',nodeId:'session:root',identity,agent:main,revision:1,createdAt:at}},{type:'agent.upserted',agent:{agentInstanceId:main.agentInstanceId,agentId:main.agentId,name:main.name,revision:1,state:'idle',waitingTaskIds:[]}}],'graph.created'),receipt:'root'}}
export const initialScope=():DispatchScope=>({...identity,scopeId,status:'active',createdAt:at,goal:{revision:1,input:{message:'Build',attachmentIds:[]}}});
export function plannedScope(binding?:OwnerExecutionBinding):DispatchScope{return {...initialScope(),goal:{revision:2,input:{message:'Build',attachmentIds:[]},plan:{revision:2,runId:'main-run',recordedAt:at,knowledgeRevision:knowledge,graphCursor:{streamId:'stream',seq:1},objective:'Build',constraints:[],criteria:[{id:'done',text:'Works',kind:'evidence'}],assignments:[{agentId,agentName:binding?'Implementation':dev.name,teamId:'.cbim/team',moduleIds:[moduleId],moduleNames:['Game'],criterionIds:['done'],reason:'Own module',...(binding?{ownerSelection:ownerExecutionSelectionFor(binding),ownerBinding:binding}:{})}],reason:'Implement'}}}}
export function task(binding?:OwnerExecutionBinding,scoped=true):TaskNode{return {kind:'task',nodeId:'task:task',taskId:'task',identity,requester:main,assignee:{...dev,name:binding?'Implementation':dev.name},...(scoped?{scopeId}:{}),...(binding?{ownerBinding:binding}:{}),modules:[{moduleId,name:'Game',knowledgeRevision:knowledge,maintenanceBindingId:'maintenance',maintainerPersonIds:['person'],workflow:{kind:'general',id:'cbim:general',version:'1',reason:'General'}}],goal:'Build module',acceptance:[{id:'done',text:'Works'}],revision:1,planRevision:1,status:'queued',awaitedChildren:[],runIds:[],createdAt:at,updatedAt:at}}
export function taskMutation(binding?:OwnerExecutionBinding,scoped=true):DispatchMutation{return {members:[{...member(dev),...(scoped?{executionScopeId:scopeId,executionTaskId:'task',lifecycle:'active' as const}:{})}],sessions:[session(dev)],batch:batch('dispatch',2,[{type:'task.upserted',task:task(binding,scoped)},{type:'edge.upserted',edge:{edgeId:'dispatch-edge',identity,kind:'dispatch',fromNodeId:'session:root',toNodeId:'task:task',revision:1,enabled:true}},{type:'agent.upserted',agent:{agentInstanceId:dev.agentInstanceId,agentId,name:dev.name,revision:1,state:'idle',waitingTaskIds:[]}}]),messages:[{kind:'assignment',messageId:'assignment',commandId:'dispatch',identity,from:main,to:dev,taskId:'task',planRevision:1,createdAt:at,delivery:'pending'}],receipt:'dispatch'}}
export function prepared(binding?:OwnerExecutionBinding):PreparedDispatchKnowledge{
  const value={version:1 as const,workspaceId:ws,knowledgeRevision:knowledge,agent:structuredClone(configuration),agentDefinition:{name:dev.name},modules:task(binding).modules.map(binding=>({binding,definition:{id:moduleId},overview:'Build',workflowText:'business-execution'})),standards:['business-execution','common-rules'].map(id=>({id,text:id,version:hash(id)})),...(binding?{memberContext:{binding,name:'Implementation',position:'Implement module',adaptation:{instructions:'Project adaptation',references:[]}}}:{})};return {...value,fingerprint:dispatchKnowledgeFingerprint(value)};
}
export function claimMutation(state:DispatchState):DispatchMutation{
  const current=state.graphs[0].tasks[0],m=state.members.find(m=>m.agentInstanceId===dev.agentInstanceId)!,view=state.graphs[0].agents.find(a=>a.agentInstanceId===dev.agentInstanceId)!;
  const run:DispatchRun={binding:{...identity,teamId:'.cbim/team',agentId,agentInstanceId:dev.agentInstanceId,agentSessionId:dev.agentSessionId,taskId:'task',runId:'run',leaseEpoch:0,planRevision:1},assignmentMessageId:'assignment',status:'starting',prepared:prepared(current.ownerBinding),model,permission:'read',session:{nativeSessionId:'native'},createdAt:at};
  return {members:[{...m,activity:'communicating',activeTaskId:'task',activeRunId:'run'}],sessions:[{...state.sessions.find(s=>s.agentSessionId===dev.agentSessionId)!,nativeSessionId:'native'}],runs:[run],messages:[{...state.outbox[0] as AssignmentMessage,delivery:'claimed',claim:{runId:'run',leaseEpoch:0}}],batch:batch('claim',state.graphs[0].cursor.seq+1,[{type:'task.upserted',task:{...current,revision:current.revision+1,activeRunId:'run',runIds:['run']}},{type:'agent.upserted',agent:{...view,revision:view.revision+1,state:'communicating'}}],'message.accepted'),receipt:'claim'};
}
export function cancelClaimMutation(state:DispatchState):DispatchMutation{
  const t=state.graphs[0].tasks[0],m=state.members.find(m=>m.agentInstanceId===dev.agentInstanceId)!,v=state.graphs[0].agents.find(a=>a.agentInstanceId===dev.agentInstanceId)!;
  const {activeRunId:_,...rest}=t,{activeRunId:__,activeTaskId:___,...mr}=m;
  return {members:[{...mr,activity:'idle'}],runs:[{...state.runs![0],status:'cancelled',settledAt:later}],messages:[{...state.outbox[0],delivery:'processed'}],batch:batch('settle',state.graphs[0].cursor.seq+1,[{type:'task.upserted',task:{...rest,status:'cancelled',revision:t.revision+1}},{type:'agent.upserted',agent:{...v,state:'idle',revision:v.revision+1}}],'task.cancelled'),receipt:'settled'};
}
