// view/tasks: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {afterEach,expect,test,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FileDispatchStore} from '../../../logic/dispatch/storage/dispatch-store';
import {effectDispositionCommand,effectDispositionReceipt} from '../../../logic/tasks/rules/effect-observation-rules';
import {effectIdentity,effectRootMutation,effectScope,effectRecord,effectTime,effectState} from '../../../logic/evidence/rules/unittest/support/effect-core-fixture';
import {emptyScopeSnapshot,readScopeDetail,summarizeScope,type DispatchSessionRead} from '../../../logic/tasks/rules/scope-view';
import {projectMainScope,publicDispatchScopeSchema} from '../../../logic/tasks/rules/scope-public';
import type {DispatchScope} from '../../../logic/tasks/rules/dispatch-scope';
import type {ScopeRecovery} from '../../../logic/tasks/rules/scope-recovery';
import {recoveryRequestSource,recoverySourceSelection} from '../../../logic/tasks/rules/scope-recovery';
import {SessionReadProjection,scopeGoalView,type ScopeGoalState} from '../scope-state';
import {useScopeReplan,type ScopeReplanView} from '../useScopeReplan';

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
  const summary=projection.Selected()!,view=scopeGoalView(summary,projection.graph);
  return {scopes:projection.scopes!,selectedScopeId:summary.scopeId,selectedScope:projection.Detail(),graph:projection.graph,selectedGoalView:view,currentGoalView:view,loading:false,detailLoading:false,error:'',selectScope:()=>{}};
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
    await store.Transact({commandId:'open',fingerprint:'open'},async()=>effectRootMutation());
    await store.Transact({commandId:'source',fingerprint:'source'},async()=>({scopes:[effectScope()],receipt:true}));
    await store.Transact({commandId:'close-source',fingerprint:'close-source'},async()=>({scopes:[{...effectScope(),status:'closed',outcome:'failed',closedAt:effectTime}],receipt:true}));
    const record=effectRecord();await store.Transact(effectDispositionCommand(record.request),async()=>({effectDispositions:[record],receipt:effectDispositionReceipt(record)}));
    let scope=inspection(undefined,record.dispositionId);
    await store.Transact({commandId:'inspect',fingerprint:'inspect'},async()=>({scopes:[scope],receipt:true}));
    // 本测试只检查真实 Store 与展示链，不把这些结构性记录冒充 canonical 的业务验收。
    const stamp={runId:'inspection-run',recordedAt:effectTime,knowledgeRevision:'knowledge',graphCursor:{streamId:'stream',seq:1}};
    scope={...scope,goal:{...scope.goal!,revision:2,plan:{...stamp,revision:2,objective:'核对记录',constraints:[],criteria:[{id:'c',kind:'evidence',text:'读取记录'}],assignments:[{agentId:'cbim:main',agentName:'主调度',teamId:'team',moduleIds:[],moduleNames:[],criterionIds:['c'],reason:'只读治理'}],reason:'核实'}}};
    await store.Transact({commandId:'inspect-plan',fingerprint:'inspect-plan'},async()=>({scopes:[scope],receipt:true}));
    scope={...scope,goal:{...scope.goal!,revision:3,review:{...stamp,revision:3,planRevision:2,observedSeq:5,lastEffectSeq:0,decision:'complete',checks:[{criterionId:'c',outcome:'satisfied',reason:'记录已核对',evidence:[{kind:'main-knowledge',toolCallIds:['inspect-call']}]}],superseded:[],gaps:[],reason:'核实完成'}}};
    await store.Transact({commandId:'inspect-review',fingerprint:'inspect-review'},async()=>({scopes:[scope],receipt:true}));
    scope={...scope,status:'closed',outcome:'completed',closedAt:effectTime};
    await store.Transact({commandId:'inspect-close',fingerprint:'inspect-close'},async()=>({scopes:[scope],receipt:true}));
    const bytes=await fs.readFile(path.join(directory,'dispatch.jsonl')),response=await store.SessionRead({identity:effectIdentity,selectedScopeId:scope.scopeId});
    expect(response.detail.mode).toBe('updated');if(response.detail.mode!=='updated')throw Error('missing detail');
    expect(response.detail.scope.recovery?.source).toEqual(scope.recovery!.source);expect(response.detail.scope.recovery?.dispositionId).toBe(record.dispositionId);noPrivate(response);
    const projection=new SessionReadProjection(effectIdentity);projection.Apply(response,scope.scopeId);const view=hook(viewState(projection));
    expect(view.visible).toBe(true);expect(view.effectSource).toEqual({...effectIdentity,subject:{kind:'main_run',runId:'main-run',toolCallIds:['write-call']}});expect(view.reason).toContain('明确选择');expect(view.canSubmit).toBe(false);
    const repeated=await store.SessionRead({identity:effectIdentity,selectedScopeId:scope.scopeId,graphCursor:projection.graphCursor,scopeCursor:projection.scopeCursor,detailStamp:projection.DetailStamp(scope.scopeId)});
    expect(repeated.detail.mode).toBe('noop');projection.Apply(repeated,scope.scopeId);expect(projection.Detail()?.recovery?.dispositionId).toBe(record.dispositionId);
    response.detail.scope.recovery!.input.message='changed response';expect((await store.Read()).scopes!.at(-1)!.recovery!.input.message).toBe('读取实际文件');expect((await store.Read()).scopes!.at(-1)!.recovery!.context).toEqual(scope.recovery!.context);expect(await fs.readFile(path.join(directory,'dispatch.jsonl'))).toEqual(bytes);
  }finally{await store.Close();if(!path.resolve(directory).startsWith(path.join(os.tmpdir(),'cbim-scope-public-')))throw Error('unsafe temporary path');await fs.rm(directory,{recursive:true,force:true})}
});
