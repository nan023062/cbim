import {afterEach,expect,test,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import {effectDispositionCommand,effectDispositionReceipt} from '../src/logic/tasks/rules/effect-observation-rules';
import {effectIdentity,effectRootMutation,effectScope,effectRecord,effectTime,effectState} from './effect-core-fixture';
import {emptyScopeSnapshot,readScopeDetail,summarizeScope,type DispatchSessionRead} from '../src/logic/tasks/rules/scope-view';
import {projectMainScope,publicDispatchScopeSchema} from '../src/logic/tasks/rules/scope-public';
import type {DispatchScope} from '../src/logic/tasks/rules/dispatch-scope';
import type {ScopeRecovery} from '../src/logic/tasks/rules/scope-recovery';
import {recoveryRequestSource,recoverySourceSelection} from '../src/logic/tasks/rules/scope-recovery';
import {SessionReadProjection,scopeGoalView,type ScopeGoalState} from '../src/frontend/tasks/scope-state';
import {useScopeReplan,type ScopeReplanView} from '../src/frontend/tasks/useScopeReplan';

afterEach(()=>vi.unstubAllGlobals());
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
function viewState(projection:SessionReadProjection):ScopeGoalState {
  const summary=projection.selected()!,view=scopeGoalView(summary,projection.graph);
  return {scopes:projection.scopes!,selectedScopeId:summary.scopeId,selectedScope:projection.detail(),graph:projection.graph,selectedGoalView:view,currentGoalView:view,loading:false,detailLoading:false,error:'',selectScope:()=>{}};
}
function hook(state:ScopeGoalState){
  const values=new Map<string,string>();vi.stubGlobal('window',{localStorage:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)},cbim:{call:vi.fn(()=>{throw Error('render must not query')})}});
  let result!:ScopeReplanView;
  function Probe(){result=useScopeReplan(effectIdentity.workspaceId,effectIdentity.rootSessionId,state,undefined,()=>{},()=>{});return null}
  renderToStaticMarkup(createElement(Probe));return result;
}

test('真实Store详情进入前端重规划Hook：保留主来源和处置ID、原私有上下文仍仅存在存储',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-scope-public-')),store=new FileDispatchStore(directory,effectIdentity.workspaceId);
  try{
    await store.transact({commandId:'open',fingerprint:'open'},async()=>effectRootMutation());
    await store.transact({commandId:'source',fingerprint:'source'},async()=>({scopes:[effectScope()],receipt:true}));
    await store.transact({commandId:'close-source',fingerprint:'close-source'},async()=>({scopes:[{...effectScope(),status:'closed',outcome:'failed',closedAt:effectTime}],receipt:true}));
    const record=effectRecord();await store.transact(effectDispositionCommand(record.request),async()=>({effectDispositions:[record],receipt:effectDispositionReceipt(record)}));
    let scope=inspection(undefined,record.dispositionId);
    await store.transact({commandId:'inspect',fingerprint:'inspect'},async()=>({scopes:[scope],receipt:true}));
    // 本测试只检查真实 Store 与展示链，不把这些结构性记录冒充 canonical 的业务验收。
    const stamp={runId:'inspection-run',recordedAt:effectTime,knowledgeRevision:'knowledge',graphCursor:{streamId:'stream',seq:1}};
    scope={...scope,goal:{...scope.goal!,revision:2,plan:{...stamp,revision:2,objective:'核对记录',constraints:[],criteria:[{id:'c',kind:'evidence',text:'读取记录'}],assignments:[{agentId:'cbim:main',agentName:'主调度',teamId:'team',moduleIds:[],moduleNames:[],criterionIds:['c'],reason:'只读治理'}],reason:'核实'}}};
    await store.transact({commandId:'inspect-plan',fingerprint:'inspect-plan'},async()=>({scopes:[scope],receipt:true}));
    scope={...scope,goal:{...scope.goal!,revision:3,review:{...stamp,revision:3,planRevision:2,observedSeq:5,lastEffectSeq:0,decision:'complete',checks:[{criterionId:'c',outcome:'satisfied',reason:'记录已核对',evidence:[{kind:'main-knowledge',toolCallIds:['inspect-call']}]}],superseded:[],gaps:[],reason:'核实完成'}}};
    await store.transact({commandId:'inspect-review',fingerprint:'inspect-review'},async()=>({scopes:[scope],receipt:true}));
    scope={...scope,status:'closed',outcome:'completed',closedAt:effectTime};
    await store.transact({commandId:'inspect-close',fingerprint:'inspect-close'},async()=>({scopes:[scope],receipt:true}));
    const bytes=await fs.readFile(path.join(directory,'dispatch.jsonl')),response=await store.sessionRead({identity:effectIdentity,selectedScopeId:scope.scopeId});
    expect(response.detail.mode).toBe('updated');if(response.detail.mode!=='updated')throw Error('missing detail');
    expect(response.detail.scope.recovery?.source).toEqual(scope.recovery!.source);expect(response.detail.scope.recovery?.dispositionId).toBe(record.dispositionId);noPrivate(response);
    const projection=new SessionReadProjection(effectIdentity);projection.apply(response,scope.scopeId);const view=hook(viewState(projection));
    expect(view.visible).toBe(true);expect(view.effectSource).toEqual({...effectIdentity,subject:{kind:'main_run',runId:'main-run',toolCallIds:['write-call']}});expect(view.reason).toContain('明确选择');expect(view.canSubmit).toBe(false);
    const repeated=await store.sessionRead({identity:effectIdentity,selectedScopeId:scope.scopeId,graphCursor:projection.graphCursor,scopeCursor:projection.scopeCursor,detailStamp:projection.detailStamp(scope.scopeId)});
    expect(repeated.detail.mode).toBe('noop');projection.apply(repeated,scope.scopeId);expect(projection.detail()?.recovery?.dispositionId).toBe(record.dispositionId);
    response.detail.scope.recovery!.input.message='changed response';expect((await store.read()).scopes!.at(-1)!.recovery!.input.message).toBe('读取实际文件');expect((await store.read()).scopes!.at(-1)!.recovery!.context).toEqual(scope.recovery!.context);expect(await fs.readFile(path.join(directory,'dispatch.jsonl'))).toEqual(bytes);
  }finally{await store.close();if(!path.resolve(directory).startsWith(path.join(os.tmpdir(),'cbim-scope-public-')))throw Error('unsafe temporary path');await fs.rm(directory,{recursive:true,force:true})}
});

test('真实详情投影区分新成员与legacy来源，未配置旧字段不补造kind或处置',()=>{
  const legacy:ScopeRecovery['source']={scopeId:'source',taskId:'member',runId:'member-run',reportBasis:'a'.repeat(64),taskRevision:2,planRevision:1,scopeOutcome:'failed',reportExecution:'unknown',logState:'verified',unknownToolCount:1};
  for(const source of [legacy,{...legacy,kind:'member_run' as const,toolCallIds:['write-call']}]){
    const scope=inspection(source),response=projectedResponse(scope),projection=new SessionReadProjection(effectIdentity);projection.apply(response);
    const detail=projection.detail()!;expect(detail.recovery!.source).toEqual(source);expect(recoverySourceSelection(recoveryRequestSource(detail.recovery!.source))).toEqual('kind' in source?{kind:'member_run',taskId:'member',runId:'member-run',toolCallIds:['write-call']}:{scopeId:'source',taskId:'member',runId:'member-run'});expect(detail.recovery).not.toHaveProperty('dispositionId');noPrivate(detail);
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
