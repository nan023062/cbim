import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {moduleGovernanceReceiptSchema,moduleGovernanceListSchema,type ModuleGovernanceReceipt} from '../src/logic/governance/rules/module-governance';
import {seedModuleGovernance,moduleGovernanceFixture as data,moduleGovernanceRunFiles} from './module-governance-fixture';

it.each(['approve','reject','defer'] as const)('actual Application separates protected module proposal, local decision and exact implementation (%s)',async decision=>{
  const f=await fixture();let app=f.app;
  try{
    const seeded=await seedModuleGovernance(app,f.a),workspace=app.workspace(seeded.entry.id),identity=seeded.identity;
    const act=async<A extends ModuleGovernanceReceipt['action']>(action:A,input:unknown)=>{const receipt=moduleGovernanceReceiptSchema.parse(await app.dispatch('governance.'+action,input));expect(receipt.action).toBe(action);return receipt as Extract<ModuleGovernanceReceipt,{action:A}>};
    const read=async(proposalId?:string)=>moduleGovernanceListSchema.parse(await app.dispatch('governance.list',{workspaceId:seeded.entry.id,instanceId:app.workspace(seeded.entry.id).instanceId,moduleId:data.moduleId,...(proposalId?{proposalId}:{})}));
    const initial=await read();expect(initial.protection).toBeUndefined();
    const registration=await act('register',{...identity,commandId:randomUUID(),moduleId:data.moduleId,expectedKnowledgeRevision:seeded.snapshot.revision}),protection=registration.record;
    expect(protection).toMatchObject({workspaceId:seeded.entry.id,moduleId:data.moduleId,revision:1,overview:{path:seeded.overviewPath},actor:{kind:'local_desktop',interaction:'explicit_submit'}});expect((await workspace.snapshot()).revision).toBe(seeded.snapshot.revision);
    const observed=await act('observe',{...identity,commandId:randomUUID(),protectionId:protection.protectionId,expectedProtectionRevision:protection.revision,expectedKnowledgeRevision:seeded.snapshot.revision,statement:data.observation});expect(observed.record.overview).toMatchObject({path:seeded.overviewPath,text:seeded.original});expect(observed.record.validation.structural).toBe(true);
    const proposed=await act('propose',{...identity,commandId:randomUUID(),protectionId:protection.protectionId,observationId:observed.record.observationId,expectedProtectionRevision:protection.revision,expectedKnowledgeRevision:seeded.snapshot.revision,newOverviewText:seeded.proposed,reason:data.reason,alternatives:[data.alternative],invariants:[data.invariant],rollbackNotes:data.recovery}),proposal=proposed.record;
    expect(proposal.change).toMatchObject({path:seeded.overviewPath,beforeText:seeded.original,afterText:seeded.proposed});expect((await workspace.snapshot()).revision).toBe(seeded.snapshot.revision);
    await expect(workspace.commit(request(await workspace.snapshot(),[{path:seeded.overviewPath,text:seeded.proposed}]))).rejects.toMatchObject({code:'GOVERNANCE_PROTECTED'});
    const objectBypass=async()=>{const before=await workspace.snapshot(),plan=await seeded.call('cbim_object_preview',{revision:before.revision,operations:[{kind:'module',action:'update',id:data.moduleId,data:{},body:seeded.proposed}]});return seeded.call('cbim_object_commit',{planId:plan.planId},true)};
    await expect(objectBypass()).rejects.toMatchObject({code:'GOVERNANCE_PROTECTED'});expect(await fs.readFile(path.join(f.a,seeded.overviewPath),'utf8')).toBe(seeded.original);
    const decisionRequest={...identity,commandId:randomUUID(),proposalId:proposal.proposalId,expectedDecisionRevision:0,expectedBasis:proposal.basis,decision,comment:decision==='approve'?data.comment:'当前证据仍不足，保留原知识供后续评估。',...(decision==='defer'?{revisitCondition:'获得维护人的补充依据后再评估同一问题。'}:{})},decided=await act('decide',decisionRequest);
    expect(decided.record.decision).toBe(decision);expect(decided.record.actor).toEqual({kind:'local_desktop',interaction:'explicit_submit'});expect(await act('decide',decisionRequest)).toEqual(decided);expect((await workspace.snapshot()).revision).toBe(seeded.snapshot.revision);expect(await fs.readFile(path.join(f.a,seeded.overviewPath),'utf8')).toBe(seeded.original);
    const applyRequest={...identity,commandId:randomUUID(),proposalId:proposal.proposalId,decisionId:decided.record.decisionId,expectedBasis:proposal.basis};let applied:Extract<ModuleGovernanceReceipt,{action:'apply'}>|undefined;
    if(decision==='approve'){
      applied=await act('apply',applyRequest);expect(applied.record.state).toBe('committed');if(applied.record.state!=='committed')throw Error('真实实施未返回知识事务回执');expect(applied.record.result.changed).toContain(seeded.overviewPath);expect(await fs.readFile(path.join(f.a,seeded.overviewPath),'utf8')).toBe(seeded.proposed);expect(await act('apply',applyRequest)).toEqual(applied);expect(await app.dispatch('governance.receipt',{workspaceId:seeded.entry.id,commandId:applyRequest.commandId})).toEqual(applied);
      const journals=await fs.readdir(path.join(f.user,seeded.entry.id,'transactions'));expect(journals.filter(name=>name===applied!.record.requestId+'.json')).toHaveLength(1);expect((await read(proposal.proposalId)).protection?.revision).toBe(2);
    }else{
      await expect(act('apply',applyRequest)).rejects.toMatchObject({code:'GOVERNANCE_DECISION'});expect(await fs.readFile(path.join(f.a,seeded.overviewPath),'utf8')).toBe(seeded.original);expect((await read(proposal.proposalId)).selected?.applications).toEqual([]);
    }
    expect(JSON.parse(await fs.readFile(path.join(f.a,data.moduleId,'module.json'),'utf8'))).toEqual(seeded.definition);
    const freeBefore=await workspace.snapshot(),freePath=data.unprotectedId+'/module.md',freeBody=freeBefore.files.find(file=>file.path===freePath)!.text+'\n未登记模块仍可使用普通知识流程。\n';await workspace.commit(request(freeBefore,[{path:freePath,text:freeBody}]));expect(await fs.readFile(path.join(f.a,freePath),'utf8')).toBe(freeBody);
    const history=await read(proposal.proposalId),files=(await workspace.snapshot()).files;expect(history.selected?.decisions).toHaveLength(1);expect(history.selected?.proposal).toEqual(proposal);expect(await moduleGovernanceRunFiles(f.user,[seeded.entry.id])).toEqual([]);expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();const restored=await read(proposal.proposalId);expect(restored.protection).toEqual(history.protection);expect(restored.selected).toEqual(history.selected);expect((await app.workspace(seeded.entry.id).snapshot()).files).toEqual(files);expect(await app.dispatch('governance.receipt',{workspaceId:seeded.entry.id,commandId:decisionRequest.commandId})).toEqual(decided);if(applied)expect(await app.dispatch('governance.receipt',{workspaceId:seeded.entry.id,commandId:applyRequest.commandId})).toEqual(applied);expect(await moduleGovernanceRunFiles(f.user,[seeded.entry.id])).toEqual([]);expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);
  }finally{await app.shutdown();await f.cleanup()}
},60000);
