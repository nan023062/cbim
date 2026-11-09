import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {DispatchStore} from '../src/backend/core/tasks/dispatch-storage';
import {EffectObservationService} from '../src/backend/scheduler-engine/execution/effect-observation-service';
import {persistentWriteEffects,persistentWriteObservationSchema,type PersistentWriteObservation,type PersistentWriteName} from '../src/backend/core/tasks/persistent-write-observation';
import {originalPersistentWrite,persistentWriteIdentity,persistentWriteSourceHash,type PersistentWriteReference} from '../src/backend/core/tasks/persistent-write-input';
import {reportFixture,reportIdentity} from './command-verification-fixture';
import {effectObservationBasis} from '../src/backend/core/tasks/effect-observation-rules';
import {effectObservationReportSchema} from '../src/backend/core/tasks/effect-observation';
import {effectReport} from './effect-core-fixture';
import {governanceToolEffects} from '../src/backend/core/governance/module-governance-tools';
import {moduleOwnershipToolEffects} from '../src/backend/core/workspace/module-ownership-tool-policy';

const observe={protectionId:randomUUID(),expectedProtectionRevision:1,expectedKnowledgeRevision:'a'.repeat(64),statement:'PRIVATE_ORIGINAL_STATEMENT'};
const inputs={cbim_governance_observe:observe,cbim_governance_propose:{protectionId:observe.protectionId,observationId:randomUUID(),expectedProtectionRevision:1,expectedKnowledgeRevision:observe.expectedKnowledgeRevision,newOverviewText:'PRIVATE_ORIGINAL_BODY',reason:'原提案',alternatives:['保留'],invariants:['边界'],rollbackNotes:'另行核实'},cbim_module_owner_change_commit:{change:{moduleId:'.cbim/workspace/module',expectedBinding:null,nextOwner:{memberId:randomUUID(),expectedRevision:1},reason:'PRIVATE_ORIGINAL_REASON'},expectedOwnershipCursor:null,expectedBasis:'b'.repeat(64)}};
function fixture(name:PersistentWriteName='cbim_governance_observe',raw:unknown=inputs[name]){
 const f=reportFixture(name,raw);f.state.scopes![0].status='closed';f.state.scopes![0].outcome='failed';f.state.scopes![0].closedAt=f.state.scopes![0].createdAt;
 f.summary.status='interrupted';f.summary.events[2].data.effects=[persistentWriteEffects[name]];f.summary.events[2].data.scope={kind:'knowledge',workspaceId:reportIdentity.workspaceId};for(const receipt of f.summary.toolReceipts!){receipt.effects=[persistentWriteEffects[name]];receipt.scope={kind:'knowledge',workspaceId:reportIdentity.workspaceId}}
 f.summary.events.push({...f.summary.events[0],seq:5,type:'run.interrupted',data:{reason:'original failure'}});
 const binding={workspaceId:reportIdentity.workspaceId,rootSessionId:reportIdentity.rootSessionId,scopeId:f.state.scopes![0].scopeId,runId:reportIdentity.runId,agentInstanceId:f.summary.conversationBinding!.agentInstanceId,agentSessionId:f.summary.conversationBinding!.agentSessionId,toolCallId:reportIdentity.toolCallId};
 const reference=originalPersistentWrite(name,inputs[name],binding)!,identity=persistentWriteIdentity(reference),instanceId=randomUUID(),recordedAt=new Date().toISOString();
 const fact:PersistentWriteObservation={identity,sourceHash:persistentWriteSourceHash(reference),state:'recorded',requestHash:'a'.repeat(64),evidenceHash:'b'.repeat(64),record:name==='cbim_module_owner_change_commit'?{kind:'ownership',recordId:randomUUID(),instanceId,recordedAt,action:'assign',revision:1}:{kind:name==='cbim_governance_observe'?'observation':'proposal',recordId:identity.commandId,instanceId,recordedAt}};
 const observePersistent=vi.fn(async(_reference:PersistentWriteReference,_signal?:AbortSignal)=>structuredClone(fact)),observeFiles=vi.fn(),acquireRead=vi.fn(),transact=vi.fn(),store={read:f.read,commandReceipt:vi.fn(),transact} as unknown as DispatchStore;
 const service=new EffectObservationService(f.owner,store,f.service,{inspectMember:vi.fn(),normalizePath:value=>value,observeFiles,acquireRead,observePersistent});
 const selection={workspaceId:reportIdentity.workspaceId,rootSessionId:reportIdentity.rootSessionId,subject:{kind:'main_run' as const,runId:reportIdentity.runId,toolCallIds:[reportIdentity.toolCallId]}};
 return {...f,service,selection,binding,reference,observePersistent,observeFiles,acquireRead,transact,fact};
}
it.each(Object.keys(inputs) as PersistentWriteName[])('%s 保存事实与原失败分开，严格原参数及真实主身份查询两次',async name=>{
 const f=fixture(name),summary=structuredClone(f.summary),report=await f.service.observe(f.selection);
 expect(report.calls[0]).toMatchObject({outcome:'failed',coverage:'persistent_record',persistent:f.fact});expect(f.observePersistent).toHaveBeenCalledTimes(2);expect(f.observePersistent.mock.calls[0][0]).toEqual(f.reference);expect(f.observeFiles).not.toHaveBeenCalled();expect(f.acquireRead).not.toHaveBeenCalled();expect(f.transact).not.toHaveBeenCalled();expect(f.summary).toEqual(summary);expect(JSON.stringify(report)).not.toContain('PRIVATE_ORIGINAL');expect(JSON.stringify(report)).not.toContain('.cbim/workspace/module');expect(effectObservationBasis(effectObservationReportSchema.parse(report))).toBe(report.basis);
 expect(persistentWriteEffects[name]).toBe(name==='cbim_module_owner_change_commit'?moduleOwnershipToolEffects[name]:governanceToolEffects[name]);
});
it.each(['scope','effects','missing-authorization','bad-tail','extra-identity','bad-input','missing-binding'] as const)('%s 不触发原保存查询',async mode=>{
 const f=fixture('cbim_governance_observe',mode==='extra-identity'?{...observe,commandId:randomUUID()}:mode==='bad-input'?{}:observe);
 if(mode==='scope')f.summary.events[2].data.scope={kind:'workspace',workspaceId:reportIdentity.workspaceId};if(mode==='effects')f.summary.events[2].data.effects=['knowledge-write'];if(mode==='missing-authorization')f.summary.events=f.summary.events.filter(e=>e.type!=='tool.allowed').map((e,i)=>({...e,seq:i+1}));if(mode==='bad-tail')f.summary.logIntegrity={partialTail:true};if(mode==='missing-binding')delete f.summary.conversationBinding;
 const report=await f.service.observe(f.selection);expect(report.calls[0].coverage).toBe('unsupported');expect(f.observePersistent).not.toHaveBeenCalled();
});
it('错命令/来源摘要、坏回执与查询错误不代替原事实，额外私有字段不进入报告',async()=>{
 for(const mode of ['identity','hash','bad','extra','error']){const f=fixture();if(mode==='identity')f.fact.identity.commandId=randomUUID();if(mode==='hash')f.fact.sourceHash='c'.repeat(64);if(mode==='bad')delete f.fact.record;if(mode==='extra')Object.assign(f.fact,{privatePath:'PRIVATE_BACKEND_PATH'});if(mode==='error')f.observePersistent.mockRejectedValue(Error('PRIVATE_BACKEND_PATH'));const report=await f.service.observe(f.selection);expect(report.calls[0].persistent).toMatchObject({identity:persistentWriteIdentity(f.reference),state:'unverifiable',reason:'query_unavailable'});expect(JSON.stringify(report)).not.toContain('PRIVATE_BACKEND_PATH')}
});
it('读取变化使处置过期，停止不查询；旧报告不增加字段或改变 basis',async()=>{
 const f=fixture(),absent={identity:f.fact.identity,sourceHash:f.fact.sourceHash,state:'absent' as const};f.observePersistent.mockResolvedValueOnce(absent);expect((await f.service.observe(f.selection)).consistency).toBe('changed_during_read');
 const stable=await f.service.observe(f.selection);f.observePersistent.mockResolvedValueOnce(absent);await expect(f.service.record({...f.selection,commandId:randomUUID(),expectedBasis:stable.basis,expectedRevision:0,decision:'inspect_more',reason:'核实原记录'},{kind:'local_desktop',interaction:'explicit_submit'})).rejects.toMatchObject({code:'EFFECT_PREACCEPT_BASIS_STALE'});expect(f.transact).not.toHaveBeenCalled();
 const count=f.observePersistent.mock.calls.length,stop=new AbortController();stop.abort(Error('explicit stop'));await expect(f.service.observe(f.selection,stop.signal)).rejects.toThrow('explicit stop');expect(f.observePersistent).toHaveBeenCalledTimes(count);
 const old=effectReport();expect(effectObservationReportSchema.parse(old)).toEqual(old);expect(effectObservationBasis(old)).toBe(old.basis);expect(old.calls[0]).not.toHaveProperty('persistent');
 for(const altered of [{...f.fact,state:'absent'},{...f.fact,state:'unverifiable'},{...f.fact,record:{...f.fact.record,kind:'proposal'}}])expect(persistentWriteObservationSchema.safeParse(altered).success).toBe(false);
 for(const change of [(v:typeof stable)=>{v.identity.rootSessionId='other'},(v:typeof stable)=>{v.calls[0].scope={kind:'workspace',workspaceId:reportIdentity.workspaceId}},(v:typeof stable)=>{v.calls[0].persistent!.identity.toolCallId='other'}]){const bad=structuredClone(stable);change(bad);expect(effectObservationReportSchema.safeParse(bad).success).toBe(false)}
});
