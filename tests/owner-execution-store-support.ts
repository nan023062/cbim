import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';
import type {GraphIdentity} from '../src/logic/tasks/rules/graph-types';
import type {DispatchScope} from '../src/logic/tasks/rules/dispatch-scope';
import type {WorkspaceMemberModelSnapshot} from '../src/logic/team/rules/workspace-member';
import {ownerExecutionSelectionFor} from '../src/logic/team/rules/member-execution-binding';
import {memberEvent,ownershipEvent,bindingFor,model as defaultModel,agentId,moduleId,knowledge} from './owner-execution-core-fixture';

/** 旧 Store 行为测试经真实 source+岗位+责任审计建立当前协议前置，不注入或跳过生产校验。 */
export async function seedExecutionOwner(store:FileDispatchStore,identity:GraphIdentity,name:string,at:string,model:WorkspaceMemberModelSnapshot=defaultModel){
  const member=memberEvent(await store.Read(),{kind:'register',agentId,name,position:'Implement module',adaptation:{instructions:'Project adaptation',references:[]},runtimePolicy:{profileId:model.id,modelId:model.model},reason:'Current execution fixture'},model);await store.Transact(member.command,async()=>member.mutation);
  const ownership=ownershipEvent(await store.Read());await store.Transact(ownership.command,async()=>ownership.mutation);const binding=bindingFor(await store.Read()),scopeId='owner-scope';
  const initial:DispatchScope={...identity,scopeId,status:'active',createdAt:at,goal:{revision:1,input:{message:'Implement',attachmentIds:[]}}};
  await store.Transact({commandId:'owner-scope',fingerprint:'owner-scope'},async()=>({scopes:[initial],receipt:scopeId}));
  const graph=await store.Snapshot(identity),scope:DispatchScope={...initial,goal:{...initial.goal!,revision:2,plan:{revision:2,runId:'owner-main-run',recordedAt:at,knowledgeRevision:knowledge,graphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},objective:'Implement',constraints:[],criteria:[{id:'verify',text:'Verify',kind:'evidence'}],assignments:[{agentId,agentName:name,teamId:'.cbim/team',moduleIds:[moduleId],moduleNames:['Module'],criterionIds:['verify'],reason:'Assigned owner',ownerSelection:ownerExecutionSelectionFor(binding),ownerBinding:binding}],reason:'Current plan'}}};
  await store.Transact({commandId:'owner-plan',fingerprint:'owner-plan'},async()=>({scopes:[scope],receipt:'planned'}));return {binding,scopeId,member:member.event.next};
}
