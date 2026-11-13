import {governanceCommandReceipts} from '../src/bridge/contracts/ipc-governance';
import {required} from './support/assertions';
import type {GovernanceIpcResponses} from '../src/bridge/contracts/ipc-governance';
import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {seedModuleGovernance,moduleGovernanceFixture as data} from './module-governance-fixture';
import {moduleGovernanceProposalBasis} from '../src/backend/core/governance/module-governance-rules';

const feedback={kind:'evidence_request',focus:'invariant',expectedResponse:'说明职责不变量及其具体依据。'};
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {promise,resolve}};
async function setup(){const f=await fixture();try{
  const seeded=await seedModuleGovernance(f.app,f.a),ws=f.app.workspace(seeded.entry.id),identity=seeded.identity;
  const call=<A extends "list"|"receipt"|"register"|"observe"|"propose"|"decide"|"apply">(action:A,input:object)=>f.app.dispatch(`governance.${action}`,{...identity,...input});
  const protection=(await call('register',{commandId:randomUUID(),moduleId:data.moduleId,expectedKnowledgeRevision:seeded.snapshot.revision})).record;
  const propose=async(respondsToDecisionIds?:string[],text=seeded.proposed)=>{
    const observation=(await call('observe',{commandId:randomUUID(),protectionId:protection.protectionId,expectedProtectionRevision:1,expectedKnowledgeRevision:seeded.snapshot.revision,statement:'当前真实模块说明需要补充职责与风险依据'})).record;
    return call('propose',{commandId:randomUUID(),protectionId:protection.protectionId,expectedProtectionRevision:1,expectedKnowledgeRevision:seeded.snapshot.revision,observationId:observation.observationId,newOverviewText:text,reason:data.reason,alternatives:[data.alternative],invariants:[data.invariant],rollbackNotes:data.recovery,...(respondsToDecisionIds?{respondsToDecisionIds}:{})});
  };
  const proposal=(await propose()).record;
  const decide=(value:any,expectedDecisionRevision:number,extra:object)=>call('decide',{commandId:randomUUID(),proposalId:value.proposalId,expectedBasis:value.basis,expectedDecisionRevision,decision:'defer',comment:'需要真实补证后再审阅',revisitCondition:'收到精确修订方案后复查',...extra});
  const source=(await decide(proposal,0,{feedback})).record;
  const applyInput=(p:any,d:any)=>({...identity,commandId:randomUUID(),proposalId:p.proposalId,decisionId:d.decisionId,expectedBasis:p.basis});
  const selected=(proposalId:string)=>call('list',{moduleId:data.moduleId,proposalId});
  return {...f,...seeded,ws,identity,call,protection,proposal,source,propose,decide,applyInput,selected,ledger:path.join(f.user,seeded.entry.id,'governance','module-ledger.json')};
}catch(error){await f.cleanup();throw error}}

it('回应冻结精确决定并入basis；批准不造评价，已提交后来源替代只改变当前视图',async()=>{
  const f=await setup();try{
    const revised=(await f.propose([f.source.decisionId])).record;
    expect(revised.respondsTo).toEqual([{decisionId:f.source.decisionId,proposalId:f.proposal.proposalId,basis:f.proposal.basis,decisionRevision:1}]);expect(revised.basis).toBe(moduleGovernanceProposalBasis(revised));
    expect(required((await f.selected(revised.proposalId)).selected).responseStates).toEqual([{reference:required(revised.respondsTo)[0],state:'current',latestDecisionId:f.source.decisionId,latestDecisionRevision:1,feedback,comment:f.source.comment}]);
    const approved=(await f.decide(revised,0,{decision:'approve',comment:'仅批准精确正文，未评价回应'})).record;expect(approved.assessments).toBeUndefined();
    const input=f.applyInput(revised,approved),applied=await f.app.dispatch('governance.apply',input);expect(applied.record.state).toBe('committed');
    const latest=(await f.decide(f.proposal,1,{feedback:{...feedback,expectedResponse:'新的核对问题'}})).record;
    const view=await f.selected(revised.proposalId);expect(required(required(view.selected).responseStates)[0]).toMatchObject({state:'superseded',latestDecisionId:latest.decisionId,latestDecisionRevision:2});expect(required(view.selected).decisions[0]).toEqual(approved);expect(required(view.selected).proposal).toEqual(revised);
    expect(await f.app.dispatch('governance.apply',input)).toEqual(applied);expect(await fs.readFile(path.join(f.a,f.overviewPath),'utf8')).toBe(f.proposed);
    const bytes=await fs.readFile(f.ledger);await f.app.open(f.entry.id,true);expect(await f.app.dispatch('governance.receipt',{workspaceId:f.entry.id,commandId:input.commandId})).toEqual(applied);expect(await fs.readFile(f.ledger)).toEqual(bytes);
  }finally{await f.cleanup()}
});

it('逐项评价只针对冻结引用，可部分评价且不强制全部addressed',async()=>{
  const f=await setup();try{
    const second=(await f.propose(undefined,f.proposed+'\n\n另一种可比较的精确说明。')).record,other=(await f.decide(second,0,{decision:'reject',feedback:{kind:'objection',focus:'risk',expectedResponse:'说明替代方案的剩余风险'}})).record;
    const revised=(await f.propose([f.source.decisionId,other.decisionId],f.proposed+'\n\n补充风险说明，不改变模块边界。')).record;
    await expect(f.decide(revised,0,{decision:'approve',assessments:[{decisionId:randomUUID(),outcome:'addressed',explanation:'伪造引用'}]})).rejects.toMatchObject({code:'GOVERNANCE_ASSESSMENT'});
    const assessments=[{decisionId:f.source.decisionId,outcome:'needs_evidence',explanation:'本机明确仍需进一步依据，未宣称已理解。'}],approved=(await f.decide(revised,0,{decision:'approve',assessments})).record;
    expect(approved.assessments).toEqual(assessments);expect(approved.assessments).toHaveLength(1);expect((await f.app.dispatch('governance.apply',f.applyInput(revised,approved))).record.state).toBe('committed');
  }finally{await f.cleanup()}
});

it('源意见被替代后新提案、批准和评价拒绝；不评价旧源的否定决定仍可保存',async()=>{
  const f=await setup();try{
    const revised=(await f.propose([f.source.decisionId])).record;await f.decide(f.proposal,1,{feedback:{...feedback,expectedResponse:'取代旧意见的新要求'}});
    await expect(f.propose([f.source.decisionId])).rejects.toMatchObject({code:'GOVERNANCE_FEEDBACK_STALE'});
    await expect(f.decide(revised,0,{decision:'approve'})).rejects.toMatchObject({code:'GOVERNANCE_FEEDBACK_STALE'});
    await expect(f.decide(revised,0,{decision:'reject',assessments:[{decisionId:f.source.decisionId,outcome:'disputed',explanation:'不能用否定标签评价过期来源'}]})).rejects.toMatchObject({code:'GOVERNANCE_FEEDBACK_STALE'});
    const rejected=(await f.decide(revised,0,{decision:'reject',comment:'停止审阅这份基于旧意见的方案'})).record;expect(rejected.assessments).toBeUndefined();expect(rejected.feedback).toBeUndefined();
    const view=await f.selected(revised.proposalId);expect(required(view.selected).proposal).toEqual(revised);expect(required(required(view.selected).responseStates)[0].state).toBe('superseded');expect((await f.ws.snapshot()).revision).toBe(f.snapshot.revision);
  }finally{await f.cleanup()}
});

it('批准后来源改变在新apply受理前拒绝，不创建意图或知识日志',async()=>{
  const f=await setup();try{
    const revised=(await f.propose([f.source.decisionId])).record,approved=(await f.decide(revised,0,{decision:'approve'})).record,input=f.applyInput(revised,approved);
    await f.decide(f.proposal,1,{decision:'reject',feedback:{kind:'objection',focus:'risk',expectedResponse:'新的阻断意见'}});const before=await fs.readFile(f.ledger);
    await expect(f.app.dispatch('governance.apply',input)).rejects.toMatchObject({code:'GOVERNANCE_FEEDBACK_STALE'});expect(await fs.readFile(f.ledger)).toEqual(before);
    expect(await f.app.dispatch('governance.receipt',{workspaceId:f.entry.id,commandId:input.commandId})).toBeUndefined();await expect(fs.stat(path.join(f.user,f.entry.id,'transactions',input.commandId+'.json'))).rejects.toMatchObject({code:'ENOENT'});
  }finally{await f.cleanup()}
});

it('最终知识事务门禁也复核待实施意图的来源，不能凭旧批准绕过服务预检',async()=>{
  const f=await setup();try{
    const revised=(await f.propose([f.source.decisionId])).record,approved=(await f.decide(revised,0,{decision:'approve'})).record,input=f.applyInput(revised,approved);
    const unavailable=vi.spyOn(f.ws.governance,'request').mockRejectedValueOnce(Error('before journal'));
    await expect(f.app.dispatch('governance.apply',input)).rejects.toMatchObject({code:'GOVERNANCE_APPLY_UNKNOWN'});unavailable.mockRestore();
    await f.decide(f.proposal,1,{feedback:{...feedback,expectedResponse:'旧意图保存后新的意见'}});
    await expect(f.ws.governed(tx=>tx.apply(input.commandId))).rejects.toMatchObject({code:'GOVERNANCE_FEEDBACK_STALE'});expect((await f.ws.snapshot()).revision).toBe(f.snapshot.revision);
    await expect(fs.stat(path.join(f.user,f.entry.id,'transactions',input.commandId+'.json'))).rejects.toMatchObject({code:'ENOENT'});await f.app.open(f.entry.id,true);
    expect(governanceCommandReceipts.apply.parse((await f.app.dispatch('governance.receipt',{workspaceId:f.entry.id,commandId:input.commandId}))).record.state).toBe('not_applied');
  }finally{vi.restoreAllMocks();await f.cleanup()}
});

it('同串行队列的实施先进入后反馈等待，合法历史不被后来意见倒推回滚',async()=>{
  const f=await setup(),entered=deferred(),release=deferred();try{
    const revised=(await f.propose([f.source.decisionId])).record,approved=(await f.decide(revised,0,{decision:'approve'})).record,input=f.applyInput(revised,approved),store=(f.ws as any).knowledge,draft=store.draft.bind(store);let first=true;
    const spy=vi.spyOn(store,'draft').mockImplementation(async(...args:any[])=>{const value=await draft(...args);if(first){first=false;entered.resolve();await release.promise}return value});
    const applying=f.app.dispatch('governance.apply',input);await entered.promise;const replacing=f.decide(f.proposal,1,{feedback:{...feedback,expectedResponse:'排在原实施后面的意见'}});release.resolve();
    expect((await applying).record.state).toBe('committed');await replacing;spy.mockRestore();expect(required(required((await f.selected(revised.proposalId)).selected).responseStates)[0].state).toBe('superseded');
    await f.app.open(f.entry.id,true);expect(governanceCommandReceipts.apply.parse((await f.app.dispatch('governance.receipt',{workspaceId:f.entry.id,commandId:input.commandId}))).record.state).toBe('committed');
  }finally{release.resolve();vi.restoreAllMocks();await f.cleanup()}
});
