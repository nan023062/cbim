import {randomUUID} from 'node:crypto';
import type {DispatchMutation,DispatchState} from '../src/logic/dispatch/rules/dispatch-storage';
import type {DispatchScope} from '../src/logic/tasks/rules/dispatch-scope';
import type {EffectObservationReport,EffectDispositionRecord} from '../src/logic/tasks/rules/effect-observation';
import {effectObservationBasis} from '../src/logic/tasks/rules/effect-observation-rules';
import {applyGraphBatch} from '../src/logic/tasks/rules/graph-reducer';

export const effectIdentity={workspaceId:'workspace',rootSessionId:'root'},effectTime='2026-11-08T10:00:00.000Z';
export function effectRootMutation():DispatchMutation {
  const member={...effectIdentity,teamId:'team',agentId:'cbim:main',agentInstanceId:'main-instance',mainRootSessionId:'root',leaseEpoch:0,configurationRevision:'knowledge',agentSessionIds:['mailbox','conversation'],activity:'idle' as const,waitingTaskIds:[],communicatingMessageIds:[]};
  const {rootSessionId:_,...persistedMember}=member;
  const agent={agentId:member.agentId,agentInstanceId:member.agentInstanceId,agentSessionId:'mailbox',name:'主调度'};
  return {members:[persistedMember],sessions:['mailbox','conversation'].map(agentSessionId=>({...effectIdentity,teamId:'team',agentId:member.agentId,agentInstanceId:member.agentInstanceId,agentSessionId,...(agentSessionId==='conversation'?{purpose:'conversation' as const}:{})})),batch:{version:1,identity:effectIdentity,streamId:'stream',seq:1,eventId:'open-event',commandId:'open',cause:'graph.created',committedAt:effectTime,changes:[{type:'root.upserted',root:{kind:'session-root',nodeId:'session:root',identity:effectIdentity,agent,revision:1,createdAt:effectTime}},{type:'agent.upserted',agent:{agentId:agent.agentId,agentInstanceId:agent.agentInstanceId,name:agent.name,revision:1,state:'idle',waitingTaskIds:[]}}]},receipt:{opened:true}};
}
export function effectScope():DispatchScope{return {...effectIdentity,scopeId:'source',status:'active',createdAt:effectTime,goal:{revision:1,input:{message:'原业务输入',attachmentIds:[]}},runTracking:{version:1,mainRunIds:['main-run']}}}
/** 纯规则 fixture 只表达已经交给 Store 的领域事实；不冒充 canonical IO 核实。 */
export function effectState():DispatchState{const m=effectRootMutation();return {workspaceId:effectIdentity.workspaceId,members:m.members!,sessions:m.sessions!,graphs:[applyGraphBatch(undefined,m.batch!)],outbox:[],runs:[],scopes:[{...effectScope(),status:'closed',outcome:'failed',closedAt:effectTime}]}}
export function effectReport(revision=0):EffectObservationReport {
  const value:EffectObservationReport={version:1,identity:{...effectIdentity,subject:{kind:'main_run',runId:'main-run',toolCallIds:['write-call']}},checkedAt:effectTime,basis:'0'.repeat(64),dispositionRevision:revision,consistency:'stable',source:{state:'verified',scopeId:'source',scopeStatus:'closed',scopeOutcome:'failed',execution:'unknown',logState:'verified',logPrefixHash:'a'.repeat(64),throughSeq:5,unknownToolCount:1,goalRevision:1,inputRevision:1},calls:[{toolCallId:'write-call',toolName:'write',outcome:'unknown',coverage:'selected_files_now',inputHash:'b'.repeat(64),proposedSeq:2,allowedSeq:3,scope:{kind:'workspace',workspaceId:effectIdentity.workspaceId},effects:['business-write'],file:{relativePath:'result.json',state:'present',byteLength:2,sha256:'c'.repeat(64)},limitations:['当前字节不证明原调用成功']}],limitations:['不自动重放或恢复'],readOnly:true,acceptance:'not_evaluated'};
  value.basis=effectObservationBasis(value);return value;
}
export function effectRecord(revision=0,decision:EffectDispositionRecord['request']['decision']='inspect_more'):EffectDispositionRecord{const observation=effectReport(revision),commandId=randomUUID();return {version:1,dispositionId:commandId,request:{...observation.identity,commandId,expectedBasis:observation.basis,expectedRevision:revision,decision,reason:'仅核实已选择的真实字节'},revision:revision+1,recordedAt:effectTime,actor:{kind:'local_desktop',interaction:'explicit_submit'},observation}}
