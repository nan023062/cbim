// logic/dispatch/storage: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {scopeBudgetPolicySchema,createScopeBudget,evaluateScopeBudget,type ScopeBudgetObservation,type ScopeBudgetPolicy,type ScopeBudgetAdmission} from '../../../../../src/logic/budget/rules/scope-budget';
import {validateScopeBudgets} from '../../../../../src/logic/budget/rules/scope-budget-invariants';
import {validateDispatchScopes} from '../../../../../src/logic/tasks/rules/dispatch-scope-invariants';
import {emptyScopeSnapshot,summarizeScope,applyScopeBatch,validateScopeSnapshot,readScopeDetail} from '../../../../../src/logic/tasks/rules/scope-view';
import type {DispatchScope} from '../../../../../src/logic/tasks/rules/dispatch-scope';
import type {DispatchState,DispatchMutation} from '../../../../../src/logic/dispatch/rules/dispatch-storage';
import type {DispatchRun} from '../../../../../src/logic/tasks/rules/dispatch-execution';
import type {TaskNode} from '../../../../../src/logic/tasks/rules/graph-types';
import {fixture} from '../../application/support/helpers';
import {FileDispatchStore} from '../../../../../src/logic/dispatch/storage/dispatch-store';
import {WorkspaceDispatchService} from '../../../../../src/logic/dispatch/runtime/dispatch-service';

const at='2026-11-07T10:00:00.000Z';
const policy:ScopeBudgetPolicy={revision:3,enabled:true,limits:{tokens:100}};
const observed=(patch:Partial<ScopeBudgetObservation>={}):ScopeBudgetObservation=>({basis:'basis',observedAt:at,registeredRuns:1,coverage:'tracked',consistency:'stable',liveRunIds:[],tokens:20,tokensComplete:true,estimatedCostUsd:0.02,costComplete:true,unknownRunIds:[],...patch});
const proof=(runId='main-1',observation=observed({registeredRuns:0,tokens:0,estimatedCostUsd:0,tokensComplete:false,costComplete:false})):ScopeBudgetAdmission=>({runId,kind:'main',taskId:'root',policyRevision:3,observation});
const scope=():DispatchScope=>({workspaceId:'workspace',rootSessionId:'root',scopeId:'scope',status:'active',createdAt:at,goal:{revision:1,input:{message:'原目标',attachmentIds:[]}},runTracking:{version:1,mainRunIds:['main-1']},budget:{...createScopeBudget(policy),lastAdmission:proof()}});
function state(scopes:DispatchScope[],runs:DispatchRun[]=[]):DispatchState{return {workspaceId:'workspace',members:[],sessions:[],outbox:[],runs,scopes,graphs:[{version:1,identity:{workspaceId:'workspace',rootSessionId:'root'},cursor:{workspaceId:'workspace',rootSessionId:'root',streamId:'stream',seq:1},root:{kind:'session-root',nodeId:'session:root',identity:{workspaceId:'workspace',rootSessionId:'root'},agent:{agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主'},revision:1,createdAt:at},tasks:[],edges:[],agents:[]}]}}
function transition(before:DispatchScope[],after:DispatchScope[],mutation:DispatchMutation={scopes:after,receipt:true}){validateDispatchScopes(state(before),state(after),mutation)}
function parked():DispatchScope {
  const base=scope(),stamp={runId:'main-1',recordedAt:at,knowledgeRevision:'knowledge',graphCursor:{streamId:'stream',seq:1}};
  const plan={...stamp,revision:2,objective:'原目标',constraints:[],criteria:[{id:'human',text:'用户补充',kind:'human' as const}],assignments:[{agentId:'cbim:main',agentName:'主',teamId:'.cbim/team',moduleIds:[],moduleNames:[],criterionIds:['human'],reason:'等待补充'}],reason:'规划'};
  const review={...stamp,revision:3,planRevision:2,decision:'awaiting_user' as const,checks:[{criterionId:'human',outcome:'needs_human' as const,reason:'等待输入',evidence:[]}],superseded:[],gaps:['补充'],reason:'待补充',observedSeq:1,lastEffectSeq:0};
  return {...base,status:'waiting',goal:{...base.goal!,revision:3,plan,review},wait:{waitId:randomUUID(),reason:'待补充',createdAt:at,runId:'main-1',goalRevision:3,graphCursor:stamp.graphCursor,knowledgeRevision:stamp.knowledgeRevision,mainRunIds:['main-1']}};
}

it('真实事务重开保留冻结额度和拒绝，预算独立增量不推进任务图',async()=>{
  const f=await fixture();let writer:FileDispatchStore|undefined,reader:FileDispatchStore|undefined;
  try{
    const entry=await f.app.Dispatch('add',{path:f.a}),owner=f.app.Workspace(entry.id),directory=path.join(f.user,'budget-scopes');writer=new FileDispatchStore(directory,entry.id);const dispatch=new WorkspaceDispatchService(owner,writer),identity={workspaceId:entry.id,rootSessionId:'root'};await dispatch.OpenGraph({...identity,commandId:'graph'});
    const first={...scope(),...identity,createdAt:new Date().toISOString()};await writer.Transact({commandId:'first',fingerprint:'first'},async()=>({scopes:[first],receipt:true}));const graph=(await writer.Snapshot(identity)).cursor;
    const blocked={...first,budget:{...first.budget!,blocked:{decisionId:'denied',policyRevision:3,reason:'token_limit' as const,observation:observed({tokens:100})}}};
    await writer.Transact({commandId:'block',fingerprint:'block'},async()=>({scopes:[blocked],receipt:true}));expect((await writer.Snapshot(identity)).cursor).toEqual(graph);
    const view=await writer.SessionRead({identity});expect(view.scopes.mode==='reset'&&view.scopes.snapshot.scopes[0].budget?.blocked?.reason).toBe('token_limit');
    await dispatch.CloseScope(identity,'scope','cancelled');const expected=await writer.Read();await writer.Close();writer=undefined;
    reader=new FileDispatchStore(directory,entry.id);expect(await reader.Read()).toEqual(expected);
  }finally{await reader?.Close();await writer?.Close();await f.cleanup()}
});
