import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import {workspaceMemberDetailSchema,workspaceMemberListSchema,workspaceMemberPreviewSchema,workspaceMemberReceiptSchema} from '../src/backend/core/team/workspace-member';
import {fixture} from './helpers';
import {seedWorkspaceMembers,workspaceMemberFixture as data,workspaceMemberHttpProbe,workspaceMemberKnowledgeEvidence,workspaceMemberRuntimeEvidence,workspaceMemberRunFiles,commitWorkspaceMember,changeWorkspaceMemberCapability} from './workspace-member-fixture';

it('actual Application registers two independent positions and explicitly adopts changed capability/model without starting any execution',async()=>{
  const f=await fixture(),probe=await workspaceMemberHttpProbe();let app=f.app;
  try{
    const seeded=await seedWorkspaceMembers(app,f.temp,probe.url),id=seeded.entry.id,ids=[id,seeded.other.id];
    const identity=()=>({workspaceId:id,instanceId:app.workspace(id).instanceId});
    const list=async()=>workspaceMemberListSchema.parse(await app.dispatch('workspace.members.list',identity()));
    const get=async(memberId:string)=>workspaceMemberDetailSchema.parse(await app.dispatch('workspace.members.get',{...identity(),memberId}));
    const runtimeBefore=await workspaceMemberRuntimeEvidence(app,ids);let knowledgeBefore=await workspaceMemberKnowledgeEvidence(app,f.user,id);
    const unchanged=async()=>{expect(await workspaceMemberRuntimeEvidence(app,ids)).toEqual(runtimeBefore);expect(await workspaceMemberKnowledgeEvidence(app,f.user,id)).toEqual(knowledgeBefore);expect(await workspaceMemberRunFiles(f.user,ids)).toEqual([]);expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);expect(probe.requests).toEqual([])};
    expect(await list()).toMatchObject({total:0,registryCursor:null,items:[]});await unchanged();
    const first=await commitWorkspaceMember(app,id,seeded.register()),second=await commitWorkspaceMember(app,id,seeded.register(data.secondName));
    expect(first.receipt.memberId).not.toBe(second.receipt.memberId);expect(first.receipt.memberRevision).toBe(1);expect(second.receipt.memberRevision).toBe(1);
    const initialFirst=(await get(first.receipt.memberId)).member,initialSecond=(await get(second.receipt.memberId)).member;
    expect(initialFirst.adoption.configuration.agentId).toBe(seeded.team.input.agentId);expect(initialSecond.adoption.configuration.agentId).toBe(seeded.team.input.agentId);expect(initialFirst.adoption.captureId).not.toBe(initialSecond.adoption.captureId);
    expect(initialFirst.adoption.configuration.effectiveSkills).toEqual(expect.arrayContaining([expect.objectContaining({skillId:seeded.team.shared,inherited:true}),expect.objectContaining({skillId:seeded.team.own,inherited:false})]));
    expect(initialFirst.runtimePolicy).toMatchObject({profileId:seeded.profileId,modelId:seeded.modelId,snapshot:{id:seeded.profileId,model:seeded.modelId,auth:'none',baseUrl:probe.url}});
    expect(JSON.stringify(initialFirst)).not.toMatch(/apiKey|encryptedKey|hasKey/);expect((await list()).items.map(item=>item.memberId)).toEqual([first.receipt.memberId,second.receipt.memberId]);await unchanged();
    const page1=workspaceMemberListSchema.parse(await app.dispatch('workspace.members.list',{...identity(),limit:1}));expect(page1.nextOffset).toBe(1);expect(page1.registryCursor).not.toBeNull();
    const page2=workspaceMemberListSchema.parse(await app.dispatch('workspace.members.list',{...identity(),offset:page1.nextOffset,limit:1,expectedRegistryCursor:page1.registryCursor}));expect(page2.items.map(item=>item.memberId)).toEqual([second.receipt.memberId]);expect(page2.nextOffset).toBeUndefined();

    // These two source writes are explicit fixture actions, never effects of registering a position.
    await changeWorkspaceMemberCapability(app,id,seeded.team.input.agentId,seeded.team.shared);
    const changedDefinition={...seeded.definition,name:seeded.definition.name+'（配置更新）',models:seeded.definition.models.map(model=>model.id===seeded.modelId?{...model,maxTokens:3072}:model)};
    await app.models.save({id:seeded.profileId,profile:changedDefinition});knowledgeBefore=await workspaceMemberKnowledgeEvidence(app,f.user,id);
    const changed=await get(first.receipt.memberId);expect(changed.currentDiff.capability.status).toBe('changed');expect(changed.currentDiff.model.status).toBe('changed');expect(changed.member).toEqual(initialFirst);await unchanged();
    const rename=await commitWorkspaceMember(app,id,{kind:'update',memberId:first.receipt.memberId,expectedRevision:1,patch:{name:data.renamed},reason:'仅修改岗位名称，保留两项原采纳。'});
    const renamed=await get(first.receipt.memberId);expect(renamed.member.memberId).toBe(initialFirst.memberId);expect(renamed.member.adoption).toEqual(initialFirst.adoption);expect(renamed.member.runtimePolicy).toEqual(initialFirst.runtimePolicy);expect(renamed.currentDiff.capability.status).toBe('changed');expect(renamed.currentDiff.model.status).toBe('changed');
    await expect(app.dispatch('workspace.members.list',{...identity(),offset:1,limit:1,expectedRegistryCursor:page1.registryCursor})).rejects.toMatchObject({code:'MEMBER_REGISTRY_STALE'});
    const capability=await commitWorkspaceMember(app,id,{kind:'adopt',memberId:first.receipt.memberId,expectedRevision:rename.receipt.memberRevision,target:'capability',reason:'明确采纳当前原则与继承 Skill，不采纳模型变化。'});
    const adoptedCapability=await get(first.receipt.memberId);expect(adoptedCapability.currentDiff.capability.status).toBe('same');expect(adoptedCapability.currentDiff.model.status).toBe('changed');expect(adoptedCapability.member.runtimePolicy).toEqual(initialFirst.runtimePolicy);expect(adoptedCapability.member.adoption.captureId).not.toBe(initialFirst.adoption.captureId);expect(adoptedCapability.member.adoption.configuration.principles).toContain(data.changedPrinciples.trim());
    const model=await commitWorkspaceMember(app,id,{kind:'adopt',memberId:first.receipt.memberId,expectedRevision:capability.receipt.memberRevision,target:'model',reason:'单独明确采纳同一模型引用的新公开配置。'});
    const adoptedModel=await get(first.receipt.memberId);expect(adoptedModel.currentDiff.model.status).toBe('same');expect(adoptedModel.member.adoption).toEqual(adoptedCapability.member.adoption);expect(adoptedModel.member.runtimePolicy.snapshot.maxTokens).toBe(3072);expect((await get(second.receipt.memberId)).member).toEqual(initialSecond);await unchanged();

    const paused=await commitWorkspaceMember(app,id,{kind:'state',memberId:first.receipt.memberId,expectedRevision:model.receipt.memberRevision,nextState:'suspended',reason:'暂时暂停岗位登记，不启动或停止运行实例。'});
    const active=await commitWorkspaceMember(app,id,{kind:'state',memberId:first.receipt.memberId,expectedRevision:paused.receipt.memberRevision,nextState:'active',reason:'明确恢复岗位登记状态，不表示已经派工。'});
    // A missing current model cannot erase the adopted snapshot or block explicit retirement.
    await app.models.remove(seeded.profileId);const missing=await get(first.receipt.memberId);expect(missing.currentDiff.model.status).toBe('missing');expect(missing.member.runtimePolicy).toEqual(adoptedModel.member.runtimePolicy);
    const retired=await commitWorkspaceMember(app,id,{kind:'state',memberId:first.receipt.memberId,expectedRevision:active.receipt.memberRevision,nextState:'retired',reason:'当前来源缺失时仍显式退休，并保留原身份和采纳。'});
    const final=await get(first.receipt.memberId);expect(final.member.state).toBe('retired');expect(final.member.adoption).toEqual(adoptedModel.member.adoption);expect(final.member.runtimePolicy).toEqual(adoptedModel.member.runtimePolicy);await unchanged();
    await expect(commitWorkspaceMember(app,id,{kind:'state',memberId:first.receipt.memberId,expectedRevision:retired.receipt.memberRevision,nextState:'active',reason:'不得复活已退休岗位。'})).rejects.toMatchObject({code:'MEMBER_RETIRED'});
    const journalPath=path.join(f.user,id,'dispatch','dispatch.jsonl'),journal=await fs.readFile(journalPath);const finalList=await list();
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    const reopened=await get(first.receipt.memberId);expect(reopened.member).toEqual(final.member);expect((await list()).items).toEqual(finalList.items);expect((await list()).registryCursor).toEqual(finalList.registryCursor);
    expect(await app.dispatch('workspace.members.receipt',{workspaceId:id,commandId:first.input.commandId})).toEqual(first.receipt);expect(await app.dispatch('workspace.members.commit',first.input)).toEqual(first.receipt);expect(await fs.readFile(journalPath)).toEqual(journal);await unchanged();
  }finally{await app.shutdown();await probe.close();await f.cleanup()}
},90000);

it('actual accepted registration survives a deliberately lost caller reply, restart and exact retry without a second transaction',async()=>{
  const f=await fixture(),probe=await workspaceMemberHttpProbe();let app=f.app;
  try{
    const seeded=await seedWorkspaceMembers(app,f.temp,probe.url),id=seeded.entry.id,identity={workspaceId:id,instanceId:app.workspace(id).instanceId},ids=[id,seeded.other.id];
    const knowledge=await workspaceMemberKnowledgeEvidence(app,f.user,id),runtime=await workspaceMemberRuntimeEvidence(app,ids),change=seeded.register();
    const preview=workspaceMemberPreviewSchema.parse(await app.dispatch('workspace.members.preview',{...identity,change}));
    const input={...identity,change,commandId:randomUUID(),expectedRegistryCursor:preview.registryCursor,expectedBasis:preview.basis};
    let accepted:ReturnType<typeof workspaceMemberReceiptSchema.parse>|undefined,commitInvocations=0;
    const dropRealReply=async()=>{commitInvocations++;accepted=workspaceMemberReceiptSchema.parse(await app.dispatch('workspace.members.commit',input));throw Object.assign(Error('test-only response loss after actual persisted registration'),{code:'TEST_RESPONSE_LOST'})};
    await expect(dropRealReply()).rejects.toMatchObject({code:'TEST_RESPONSE_LOST'});expect(accepted).toBeDefined();
    const journalPath=path.join(f.user,id,'dispatch','dispatch.jsonl'),bytes=await fs.readFile(journalPath),records=bytes.toString('utf8').trim().split('\n').map(line=>JSON.parse(line) as {body:{command:{commandId:string};mutation:{workspaceMemberChanges?:unknown[]}}});
    expect(records.filter(record=>record.body.command.commandId==='workspace-member-'+input.commandId)).toHaveLength(1);expect(records.flatMap(record=>record.body.mutation.workspaceMemberChanges??[])).toHaveLength(1);
    expect(workspaceMemberListSchema.parse(await app.dispatch('workspace.members.list',identity)).total).toBe(1);expect(await app.dispatch('workspace.members.receipt',{workspaceId:id,commandId:randomUUID()})).toBeUndefined();
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect(app.workspace(id).instanceId).not.toBe(identity.instanceId);expect(await app.dispatch('workspace.members.receipt',{workspaceId:id,commandId:input.commandId})).toEqual(accepted);
    expect(await app.dispatch('workspace.members.commit',input)).toEqual(accepted);expect(await app.dispatch('workspace.members.commit',input)).toEqual(accepted);
    await expect(app.dispatch('workspace.members.commit',{...input,change:{...change,name:'不得复用原命令的其它名称'}})).rejects.toMatchObject({code:'MEMBER_COMMAND_CONFLICT'});
    expect(await fs.readFile(journalPath)).toEqual(bytes);expect(commitInvocations).toBe(1);expect(await workspaceMemberKnowledgeEvidence(app,f.user,id)).toEqual(knowledge);expect(await workspaceMemberRuntimeEvidence(app,ids)).toEqual(runtime);expect(await workspaceMemberRunFiles(f.user,ids)).toEqual([]);expect(probe.requests).toEqual([]);
    const restored=workspaceMemberListSchema.parse(await app.dispatch('workspace.members.list',{workspaceId:id,instanceId:app.workspace(id).instanceId}));expect(restored.total).toBe(1);expect(restored.items[0].memberId).toBe(accepted!.memberId);
  }finally{await app.shutdown();await probe.close();await f.cleanup()}
},60000);
