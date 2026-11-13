import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {hash,json} from '../src/core/platform/node/serialization';
import type {DispatchStore} from '../src/logic/dispatch/rules/dispatch-storage';
import {EffectObservationService} from '../src/backend/scheduler-engine/evidence/effect-observation-service';
import type {KnowledgeTransactionObservation} from '../src/logic/knowledge/rules/knowledge-write-observation';
import {originalKnowledgeWrite,originalKnowledgeIdentity,type KnowledgeWriteReference} from '../src/logic/knowledge/rules/knowledge-write-input';
import {reportFixture,reportIdentity} from './command-verification-fixture';
import {effectObservationBasis} from '../src/logic/tasks/rules/effect-observation-rules';
import {effectObservationReportSchema} from '../src/logic/tasks/rules/effect-observation';
import {effectReport} from './effect-core-fixture';

const input={workspaceId:reportIdentity.workspaceId,instanceId:randomUUID(),revision:'original-revision',requestId:randomUUID(),changes:[{path:'.cbim/README.md',text:'PRIVATE_ORIGINAL_TEXT'}]};
function fixture(name='cbim_knowledge_commit',raw:unknown=input){
 const f=reportFixture(name,raw);f.state.scopes![0].status='closed';f.state.scopes![0].outcome='failed';f.state.scopes![0].closedAt=f.state.scopes![0].createdAt;
 f.summary.status='interrupted';f.summary.events[2].data.effects=['knowledge-write'];f.summary.events[2].data.scope={kind:'knowledge',workspaceId:reportIdentity.workspaceId};for(const receipt of f.summary.toolReceipts!){receipt.effects=['knowledge-write'];receipt.scope={kind:'knowledge',workspaceId:reportIdentity.workspaceId}}
 f.summary.events.push({...f.summary.events[0],seq:5,type:'run.interrupted',data:{reason:'original failure'}});
 const reference=originalKnowledgeWrite(name,raw),original=reference?originalKnowledgeIdentity(reference):{workspaceId:input.workspaceId,instanceId:input.instanceId,requestId:input.requestId};
 const fact:KnowledgeTransactionObservation={identity:original,state:'committed',requestHash:hash(json(input)),evidenceHash:hash('verified original journal'),revision:'original-commit',changedCount:1};
 const observeKnowledge=vi.fn(async(_reference:KnowledgeWriteReference,_signal?:AbortSignal)=>structuredClone(fact)),observeFiles=vi.fn(),acquireRead=vi.fn(),transact=vi.fn(),store={read:f.read,commandReceipt:vi.fn(),transact} as unknown as DispatchStore;
 const service=new EffectObservationService(f.owner,store,f.service,{inspectMember:vi.fn(),normalizePath:value=>value,observeFiles,acquireRead,observeKnowledge});
 const selection={workspaceId:reportIdentity.workspaceId,rootSessionId:reportIdentity.rootSessionId,subject:{kind:'main_run' as const,runId:reportIdentity.runId,toolCallIds:[reportIdentity.toolCallId]}};
 return {...f,service,selection,observeKnowledge,observeFiles,acquireRead,transact,fact};
}
it('原工具 failed 与原知识 committed 分开，实际解析的原请求被核实两次且不观察文件',async()=>{
 const f=fixture(),summary=structuredClone(f.summary),report=await f.service.observe(f.selection);
 expect(report.calls[0]).toMatchObject({outcome:'failed',coverage:'knowledge_transaction',knowledge:{state:'committed',identity:{requestId:input.requestId}}});expect(f.observeKnowledge).toHaveBeenCalledTimes(2);expect(f.observeKnowledge.mock.calls[0][0]).toEqual(originalKnowledgeWrite('cbim_knowledge_commit',input));expect(f.observeFiles).not.toHaveBeenCalled();expect(f.acquireRead).not.toHaveBeenCalled();expect(f.summary).toEqual(summary);expect(JSON.stringify(report)).not.toContain('PRIVATE_ORIGINAL_TEXT');expect(JSON.stringify(report)).not.toContain('.cbim/README.md');expect(effectObservationBasis(effectObservationReportSchema.parse(report))).toBe(report.basis);
});
it('刷新只接受可信授权v2与原空变更请求，模型同名字段不能让旧调用取得新证据',async()=>{
 const raw={workspaceId:input.workspaceId,instanceId:input.instanceId,revision:input.revision,requestId:input.requestId,contractVersion:2};
 for(const version of [undefined,1,3,'2']){const f=fixture('cbim_knowledge_refresh',raw);f.summary.events[2].data.contractVersion=version;expect((await f.service.observe(f.selection)).calls[0].coverage).toBe('unsupported');expect(f.observeKnowledge).not.toHaveBeenCalled()}
 const f=fixture('cbim_knowledge_refresh',raw);f.summary.events[2].data.contractVersion=2;const reference=originalKnowledgeWrite('cbim_knowledge_refresh',raw,2)!;expect(reference.kind).toBe('request');if(reference.kind!=='request')throw Error('Missing request');f.fact.requestHash=hash(json(reference.request));const report=await f.service.observe(f.selection);expect(report.calls[0]).toMatchObject({outcome:'failed',coverage:'knowledge_transaction',knowledge:{state:'committed'}});expect(f.observeKnowledge).toHaveBeenCalledTimes(2);expect(f.observeKnowledge.mock.calls[0][0]).toEqual({kind:'request',request:{workspaceId:input.workspaceId,instanceId:input.instanceId,revision:input.revision,requestId:input.requestId,changes:[]}});
 f.fact.requestHash=hash(json({...reference.request,changes:[{path:'.cbim/README.md',text:'other'}]}));expect((await f.service.observe(f.selection)).calls[0].knowledge?.state).toBe('unverifiable');
});
it.each(['scope','effects','missing-authorization','bad-tail','foreign-input','unsupported-refresh'] as const)('%s 不触发知识查询',async mode=>{
 const f=fixture(mode==='unsupported-refresh'?'cbim_knowledge_refresh':undefined,mode==='foreign-input'?{...input,workspaceId:'foreign'}:input);
 if(mode==='scope')f.summary.events[2].data.scope={kind:'workspace',workspaceId:input.workspaceId};if(mode==='effects')f.summary.events[2].data.effects=['maintenance'];if(mode==='missing-authorization')f.summary.events=f.summary.events.filter(e=>e.type!=='tool.allowed').map((e,i)=>({...e,seq:i+1}));if(mode==='bad-tail')f.summary.logIntegrity={partialTail:true};
 const report=await f.service.observe(f.selection);expect(report.calls[0].coverage).toBe('unsupported');expect(f.observeKnowledge).not.toHaveBeenCalled();expect(f.observeFiles).not.toHaveBeenCalled();
});
it('错回执身份、错原请求摘要、坏返回和读取错误都保留不可核实，不拿错证据替代',async()=>{
 for(const mode of ['identity','hash','bad','error']){const f=fixture();if(mode==='identity')f.fact.identity.instanceId=randomUUID();if(mode==='hash')f.fact.requestHash=hash('other request');if(mode==='bad')delete f.fact.revision;if(mode==='error')f.observeKnowledge.mockRejectedValue(Error('PRIVATE_BACKEND_PATH'));const report=await f.service.observe(f.selection);expect(report.calls[0].knowledge).toMatchObject({identity:{instanceId:input.instanceId},state:'unverifiable',reason:'query_unavailable'});expect(JSON.stringify(report)).not.toContain('PRIVATE_BACKEND_PATH')}
});
it('两次观察原阶段变化使依据失效，原处置不提交；停止拒绝继续查询',async()=>{
 const f=fixture();f.observeKnowledge.mockResolvedValueOnce({...f.fact,state:'prepared',revision:undefined,changedCount:undefined});const report=await f.service.observe(f.selection);expect(report.consistency).toBe('changed_during_read');
 const g=fixture(),stable=await g.service.observe(g.selection);g.observeKnowledge.mockResolvedValueOnce({...g.fact,state:'prepared',revision:undefined,changedCount:undefined});await expect(g.service.record({...g.selection,commandId:randomUUID(),expectedBasis:stable.basis,expectedRevision:0,decision:'inspect_more',reason:'核实原知识事务'},{kind:'local_desktop',interaction:'explicit_submit'})).rejects.toMatchObject({code:'EFFECT_PREACCEPT_BASIS_STALE'});expect(g.transact).not.toHaveBeenCalled();
 const stop=new AbortController();stop.abort(Error('explicit stop'));await expect(f.service.observe(f.selection,stop.signal)).rejects.toThrow('explicit stop');expect(f.observeKnowledge).toHaveBeenCalledTimes(2);
});
it('原对象 planId 来自输入，附带清理限制；旧报告不增加知识字段或改变 basis',async()=>{
 const object={workspaceId:input.workspaceId,instanceId:input.instanceId,planId:randomUUID()},f=fixture('cbim_object_commit',object);const report=await f.service.observe(f.selection);expect(f.observeKnowledge.mock.calls[0][0]).toEqual({kind:'object_plan',...object});expect(report.calls[0].limitations.join('')).toContain('修剪');
 const old=effectReport(),parsed=effectObservationReportSchema.parse(old);expect(parsed).toEqual(old);expect(parsed.calls[0]).not.toHaveProperty('knowledge');expect(effectObservationBasis(parsed)).toBe(old.basis);
 const bad=structuredClone(report);bad.calls[0].scope={kind:'workspace',workspaceId:input.workspaceId};expect(effectObservationReportSchema.safeParse(bad).success).toBe(false);
});
