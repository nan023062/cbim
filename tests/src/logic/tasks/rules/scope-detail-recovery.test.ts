// logic/tasks/rules: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {FileDispatchStore} from '../../../../../src/logic/dispatch/storage/dispatch-store';
import {effectDispositionCommand,effectDispositionReceipt} from '../../../../../src/logic/tasks/rules/effect-observation-rules';
import {effectIdentity,effectRootMutation,effectScope,effectRecord,effectTime,effectState} from '../../evidence/rules/support/effect-core-fixture';
import {emptyScopeSnapshot,readScopeDetail,summarizeScope,type DispatchSessionRead} from '../../../../../src/logic/tasks/rules/scope-view';
import {projectMainScope,publicDispatchScopeSchema} from '../../../../../src/logic/tasks/rules/scope-public';
import type {DispatchScope} from '../../../../../src/logic/tasks/rules/dispatch-scope';
import type {ScopeRecovery} from '../../../../../src/logic/tasks/rules/scope-recovery';
import {recoveryRequestSource,recoverySourceSelection} from '../../../../../src/logic/tasks/rules/scope-recovery';


const profileId='11111111-1111-4111-8111-111111111111';
function inspection(source?:ScopeRecovery['source'],dispositionId?:string):DispatchScope {
  const scopeId=randomUUID();
  return {...effectIdentity,scopeId,status:'active',createdAt:effectTime,goal:{revision:1,input:{message:'读取实际文件',attachmentIds:[]}},runTracking:{version:1,mainRunIds:['inspection-run']},recovery:{recoveryId:scopeId,acceptedAt:effectTime,source:source??{kind:'main_run',runId:'main-run',toolCallIds:['write-call'],reportBasis:effectRecord().observation.basis,scopeId:'source',scopeOutcome:'failed',reportExecution:'unknown',logState:'verified',unknownToolCount:1,sourceGoalRevision:1,sourceInputRevision:1},operation:'inspect_effects',observation:{text:'请核实'},input:{message:'读取实际文件'},options:{permission:'read',profileId,provider:'fixture',model:'fixture'},context:{initialRunId:'inspection-run',nativeSessionId:randomUUID(),excludedRunIds:['main-run']},...(dispositionId?{dispositionId}:{})}};
}
function noPrivate(value:unknown){const wire=JSON.stringify(value);for(const key of ['context','nativeSessionId','sessionFile','excludedRunIds','initialRunId'])expect(wire).not.toContain('"'+key+'"')}
function projectedResponse(scope:DispatchScope):DispatchSessionRead {
  const graph=effectState().graphs[0],snapshot=emptyScopeSnapshot(effectIdentity,graph.cursor.streamId);snapshot.cursor.seq=1;snapshot.scopes=[summarizeScope(scope,snapshot.cursor.streamId,1)];
  return {graph:{mode:'reset',reason:'initial',snapshot:graph,cursor:graph.cursor},scopes:{mode:'reset',reason:'initial',snapshot,cursor:snapshot.cursor},detail:readScopeDetail(snapshot,[scope],scope.scopeId)};
}

test('真实详情投影区分新成员与legacy来源，未配置旧字段不补造kind或处置',()=>{
  const legacy:ScopeRecovery['source']={scopeId:'source',taskId:'member',runId:'member-run',reportBasis:'a'.repeat(64),taskRevision:2,planRevision:1,scopeOutcome:'failed',reportExecution:'unknown',logState:'verified',unknownToolCount:1};
  for(const source of [legacy,{...legacy,kind:'member_run' as const,toolCallIds:['write-call']}]){
    const scope=inspection(source),response=projectedResponse(scope);
    if(response.detail.mode!=='updated')throw Error('missing detail');const detail=response.detail.scope;expect(detail.recovery!.source).toEqual(source);expect(recoverySourceSelection(recoveryRequestSource(detail.recovery!.source))).toEqual('kind' in source?{kind:'member_run',taskId:'member',runId:'member-run',toolCallIds:['write-call']}:{scopeId:'source',taskId:'member',runId:'member-run'});expect(detail.recovery).not.toHaveProperty('dispositionId');noPrivate(detail);
  }
  const plain=projectedResponse(effectScope());expect(plain.detail.mode).toBe('updated');if(plain.detail.mode==='updated'){expect(plain.detail.scope).not.toHaveProperty('recovery');expect(plain.detail.scope).not.toHaveProperty('replan')}
});

test('重规划公开详情保留三类proof、人工约束和处置引用，同时剔除私有context',()=>{
  const common={inspectionGoalRevision:3,inspectionPlanRevision:2,reviewRunId:'inspection-run',knowledgeRevision:'knowledge',sourceScopeId:'source',sourceReportBasis:'b'.repeat(64),evidenceDigest:'c'.repeat(64),requiredModules:[{moduleId:'game',name:'游戏'}],inheritedHuman:[{id:'h',text:'人工视觉确认',kind:'human' as const,sourceScopeId:'source',sourceGoalRevision:2}]};
  for(const proof of [{...common,sourceTaskId:'member',sourceRunId:'member-run'},{...common,kind:'member_run' as const,sourceTaskId:'member',sourceRunId:'member-run',sourceToolCallIds:['write-call']},{...common,kind:'main_run' as const,sourceRunId:'main-run',sourceToolCallIds:['write-call'],sourceGoalRevision:2,sourceInputRevision:1,sourcePlanRevision:2}]){
    const id=randomUUID(),dispositionId=randomUUID(),scope:DispatchScope={...effectScope(),scopeId:id,replan:{replanId:id,acceptedAt:effectTime,source:{inspectionScopeId:'inspection',expectedBasis:'d'.repeat(64),proof},operation:'business_replan',input:{message:'新业务'},options:{permission:'ask',profileId,provider:'fixture',model:'fixture'},context:{initialRunId:'new-run',nativeSessionId:randomUUID(),excludedRunIds:['main-run','inspection-run']},...('kind' in proof?{dispositionId}:{})}};
    const response=projectedResponse(scope);if(response.detail.mode!=='updated')throw Error('missing detail');const actual=response.detail.scope;
    expect(actual.replan?.source.proof).toEqual(proof);expect(actual.replan?.dispositionId).toBe('kind' in proof?dispositionId:undefined);expect(publicDispatchScopeSchema.safeParse(actual).success).toBe(true);noPrivate(actual);
    expect(publicDispatchScopeSchema.safeParse({...actual,replan:{...actual.replan,context:scope.replan!.context}}).success).toBe(false);
  }
});

test('详情strict校验拒坏来源而非静默省略；公开协议不接context或私有顶层字段',()=>{
  for(const recovery of [null,false,0,{...inspection().recovery!,source:{...inspection().recovery!.source,nativeSessionId:'private'}}]){
    const scope={...effectScope(),recovery} as unknown as DispatchScope;expect(()=>projectedResponse(scope)).toThrow('公开详情字段无效');
  }
  const scope=inspection(),publicValue=projectMainScope(scope);
  expect(publicDispatchScopeSchema.safeParse({...publicValue,recovery:scope.recovery}).success).toBe(false);
  expect(publicDispatchScopeSchema.safeParse({...publicValue,sessionFile:'private'}).success).toBe(false);
});
