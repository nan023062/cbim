import type {IpcAction} from '../src/bridge/contracts/ipc-call';
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import {knowledgeSourceRefSchema,knowledgeSourceChangeSchema,type KnowledgeSourceChange} from '../src/logic/workspace/rules/knowledge-source';
import {workspaceMemberDetailSchema} from '../src/logic/team/rules/workspace-member';
import {moduleOwnershipDetailSchema} from '../src/logic/workspace/rules/module-ownership';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedKnowledgeSource,knowledgeSourceFixture as data,knowledgeSourceObjectChange,knowledgeSourceMemberChange,knowledgeSourceOwnershipChange,knowledgeSourceDiskEvidence,knowledgeSourceHttpProbe,knowledgeSourceRuntimeEvidence,knowledgeSourceArchitecturePackage} from './knowledge-source-lifecycle-fixture';
import {createKnowledgeSourceLegacyFixture,knowledgeSourceLegacyExecutable} from './knowledge-source-legacy-fixture';

const member=async(app:Application,id:string,memberId:string)=>workspaceMemberDetailSchema.parse(await app.dispatch('workspace.members.get',{workspaceId:id,instanceId:app.workspace(id).instanceId,memberId}));
const ownership=async(app:Application,id:string)=>moduleOwnershipDetailSchema.parse(await app.dispatch('workspace.ownerships.get',{workspaceId:id,instanceId:app.workspace(id).instanceId,moduleId:data.moduleId}));
const journals=(value:Awaited<ReturnType<typeof knowledgeSourceDiskEvidence>>)=>value.journals.map(item=>({name:item.name,sha256:item.sha256}));
const sourceEvents=(bytes:Buffer):KnowledgeSourceChange[]=>bytes.toString('utf8').split('\n').filter(Boolean).flatMap(line=>(JSON.parse(line).body.mutation.knowledgeSourceChanges??[]).map((item:unknown)=>knowledgeSourceChangeSchema.parse(item)));
const expectedBinding=(binding:NonNullable<ReturnType<typeof moduleOwnershipDetailSchema.parse>['view']['binding']>)=>({bindingId:binding.bindingId,revision:binding.revision,ownerMemberId:binding.ownerMemberId});

it('actual ObjectCrud preserves an edited Agent generation but same-path same-byte recreation requires explicit capability adoption',async()=>{
  const f=await fixture(),probe=await knowledgeSourceHttpProbe();let app=f.app;
  try{
    const call=<A extends IpcAction>(action:A,input?:unknown)=>app.dispatch(action,input),seeded=await seedKnowledgeSource(call,f.temp,probe.url),id=seeded.entry.id,memberId=seeded.registered.receipt.memberId;
    const original=await member(app,id,memberId),originalRef=knowledgeSourceRefSchema.parse(original.member.adoption.sourceRef),originalOwner=await ownership(app,id),runtime=await knowledgeSourceRuntimeEvidence(app,[id,seeded.other.id]);
    expect(original.sourceStatus).toEqual({status:'current',ref:originalRef});
    await knowledgeSourceObjectChange(call,id,[{kind:'agent',action:'update',id:data.agentId,body:data.changedPrinciples}]);
    const edited=await member(app,id,memberId);expect(edited.sourceStatus).toEqual({status:'current',ref:originalRef});expect(edited.member.adoption).toEqual(original.member.adoption);expect(edited.currentDiff.capability.status).toBe('changed');
    const adopted=await knowledgeSourceMemberChange(call,id,{kind:'adopt',memberId,expectedRevision:edited.member.revision,target:'capability',reason:data.reason});
    const beforeDeletion=await member(app,id,memberId),definition=(await app.workspace(id).snapshot()).files.find(file=>file.path===data.agentId+'/agent.json')!.text;
    expect(beforeDeletion.member.adoption.sourceRef).toEqual(originalRef);expect(beforeDeletion.member.adoption.configuration.principles).toBe(data.changedPrinciples);
    await knowledgeSourceObjectChange(call,id,[{kind:'agent',action:'delete',id:data.agentId}]);
    expect((await member(app,id,memberId)).member.adoption).toEqual(beforeDeletion.member.adoption);
    await knowledgeSourceObjectChange(call,id,[{kind:'agent',action:'create',parentId:'.cbim/team',slug:'source_worker',data:{name:data.agentName,summary:JSON.parse(definition).summary,capabilities:['核实']},body:data.changedPrinciples}]);
    const recreated=await member(app,id,memberId),snapshot=await app.workspace(id).snapshot();
    expect(snapshot.files.find(file=>file.path===data.agentId+'/agent.json')!.text).toBe(definition);expect(snapshot.files.find(file=>file.path===data.agentId+'/principles.md')!.text).toBe(data.changedPrinciples);
    expect(recreated.member.adoption).toEqual(beforeDeletion.member.adoption);expect(recreated.sourceStatus?.status).toBe('retired');
    if(recreated.sourceStatus?.status!=='retired')throw Error('Actual retired source was not surfaced');const currentRef=knowledgeSourceRefSchema.parse(recreated.sourceStatus.currentRef);expect(currentRef.generationId).not.toBe(originalRef.generationId);
    const second=await knowledgeSourceMemberChange(call,id,{kind:'adopt',memberId,expectedRevision:recreated.member.revision,target:'capability',reason:data.reason});
    const final=await member(app,id,memberId);expect(final.member.adoption.sourceRef).toEqual(currentRef);expect(final.sourceStatus).toEqual({status:'current',ref:currentRef});
    expect((await ownership(app,id)).view.binding).toEqual(originalOwner.view.binding);expect(await knowledgeSourceRuntimeEvidence(app,[id,seeded.other.id])).toEqual(runtime);expect(probe.requests).toEqual([]);
    for(const saved of [seeded.registered,adopted,second])expect(await call('workspace.members.receipt',{workspaceId:id,commandId:saved.request.commandId})).toEqual(saved.receipt);
    const disk=await knowledgeSourceDiskEvidence(f.user,id);await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect((await member(app,id,memberId)).member).toEqual(final.member);expect((await knowledgeSourceDiskEvidence(f.user,id)).dispatchBytes).toEqual(disk.dispatchBytes);expect(journals(await knowledgeSourceDiskEvidence(f.user,id))).toEqual(journals(disk));expect(probe.requests).toEqual([]);
  }finally{await app.shutdown();await f.cleanup();await probe.close()}
},90000);

it('actual architecture replace resets a same-byte target generation while a changed sibling supplies a genuine nonempty package transaction',async()=>{
  const f=await fixture(),probe=await knowledgeSourceHttpProbe();
  try{
    const app=f.app,call=<A extends IpcAction>(action:A,input?:unknown)=>app.dispatch(action,input),seeded=await seedKnowledgeSource(call,f.temp,probe.url),id=seeded.entry.id;
    // 当前应用不再创建真人维护字段，模块定义可以直接发布；仍以真实兄弟正文变化触发替换事务。
    const initial=await app.workspace(id).snapshot();
    for(const file of initial.files.filter(file=>[data.moduleId+'/module.json',data.siblingId+'/module.json'].includes(file.path)))expect(JSON.parse(file.text)).not.toHaveProperty('maintenance');
    const pack=await knowledgeSourceArchitecturePackage(app,id,path.join(f.temp,'source-package-repository')),before=await app.workspace(id).snapshot();
    const old=await ownership(app,id),oldRef=knowledgeSourceRefSchema.parse(old.view.binding!.sourceRef),oldMember=await member(app,id,seeded.registered.receipt.memberId);
    const sibling=before.files.find(file=>file.path===data.siblingId+'/module.md')!;await app.workspace(id).commit(request(before,[{path:sibling.path,text:sibling.text+'\n\n仅兄弟正文形成实际替换差异。\n'}]));
    const targetBefore=(await app.workspace(id).snapshot()).files.filter(file=>file.path.startsWith(data.moduleId+'/'));
    const preview=await pack.preview();expect(preview.validation.structural).toBe(true);expect(preview.changes.some(change=>change.path===sibling.path)).toBe(true);
    const committed=await pack.commit(preview.planId);expect(committed.state).toBe('committed');
    const after=await app.workspace(id).snapshot();expect(after.files.filter(file=>file.path.startsWith(data.moduleId+'/'))).toEqual(targetBefore);
    const changed=await ownership(app,id);expect(changed.view.binding).toEqual(old.view.binding);expect(changed.view.sourceStatus?.status).toBe('retired');
    if(changed.view.sourceStatus?.status!=='retired')throw Error('Actual package replacement did not retire the prior source');expect(changed.view.sourceStatus.currentRef?.generationId).not.toBe(oldRef.generationId);
    expect((await member(app,id,seeded.registered.receipt.memberId)).member).toEqual(oldMember.member);
    const disk=await knowledgeSourceDiskEvidence(f.user,id);expect(await pack.commit(preview.planId)).toEqual(committed);expect((await knowledgeSourceDiskEvidence(f.user,id)).dispatchBytes).toEqual(disk.dispatchBytes);expect(journals(await knowledgeSourceDiskEvidence(f.user,id))).toEqual(journals(disk));
    const adopted=await knowledgeSourceOwnershipChange(call,id,{kind:'adopt_source',moduleId:data.moduleId,expectedBinding:expectedBinding(changed.view.binding!),reason:data.reason}),final=await ownership(app,id);
    expect(adopted.receipt.action).toBe('adopt_source');expect(final.view.binding!.bindingId).toBe(old.view.binding!.bindingId);expect(final.view.binding!.ownerMemberId).toBe(old.view.binding!.ownerMemberId);expect(final.view.binding!.revision).toBe(old.view.binding!.revision+1);expect(final.view.binding!.sourceRef).toEqual(changed.view.sourceStatus.currentRef);expect(final.view.sourceStatus?.status).toBe('current');
    expect(await call('workspace.ownerships.receipt',{workspaceId:id,commandId:seeded.assigned.request.commandId})).toEqual(seeded.assigned.receipt);expect(probe.requests).toEqual([]);
  }finally{await f.cleanup();await probe.close()}
},90000);

it.skipIf(!existsSync(knowledgeSourceLegacyExecutable()))('actual fixed pre-source EXE records reopen without automatic refs or writes, then only explicit capability adoption starts observed-existing tracking',async()=>{
  const legacy=await createKnowledgeSourceLegacyFixture();let app:Application|undefined,passed=false;
  try{
    app=new Application(new Paths(legacy.user,path.resolve('.')),path.resolve('design'));await app.init();const current=app,id=legacy.seeded.entry.id,memberId=legacy.seeded.registered.receipt.memberId;
    const call=<A extends IpcAction>(action:A,input?:unknown)=>current.dispatch(action,input),old=await member(current,id,memberId),owner=await ownership(current,id);
    expect(old.member).toEqual(legacy.evidence.member.member);expect(owner.view.binding).toEqual(legacy.evidence.ownership.view.binding);expect(old.member.adoption.sourceRef).toBeUndefined();expect(owner.view.binding!.sourceRef).toBeUndefined();expect(old.sourceStatus?.status).toBe('untracked');expect(owner.view.sourceStatus?.status).toBe('untracked');
    expect((await knowledgeSourceDiskEvidence(legacy.user,id)).dispatchBytes).toEqual(legacy.disk.dispatchBytes);expect(journals(await knowledgeSourceDiskEvidence(legacy.user,id))).toEqual(journals(legacy.disk));
    await knowledgeSourceMemberChange(call,id,{kind:'update',memberId,expectedRevision:old.member.revision,patch:{name:old.member.name+'（只改名称）'},reason:'旧岗位改名不补造来源'});
    const renamed=await member(current,id,memberId);expect(renamed.member.adoption).toEqual(old.member.adoption);
    await knowledgeSourceMemberChange(call,id,{kind:'state',memberId,expectedRevision:renamed.member.revision,nextState:'suspended',reason:'旧岗位暂停不补造来源'});
    const paused=await member(current,id,memberId);expect(paused.member.adoption).toEqual(old.member.adoption);
    await call('models.save',{id:legacy.seeded.profileId,profile:{...legacy.seeded.definition,name:legacy.seeded.definition.name+'（真实模型配置编辑）'}});
    await knowledgeSourceMemberChange(call,id,{kind:'adopt',memberId,expectedRevision:paused.member.revision,target:'model',reason:'只重新采纳模型，不补造能力来源'});
    const modelAdopted=await member(current,id,memberId);expect(modelAdopted.member.adoption).toEqual(old.member.adoption);expect(sourceEvents((await knowledgeSourceDiskEvidence(legacy.user,id)).dispatchBytes)).toEqual([]);
    await knowledgeSourceMemberChange(call,id,{kind:'adopt',memberId,expectedRevision:modelAdopted.member.revision,target:'capability',reason:data.reason});
    const adopted=await member(current,id,memberId);knowledgeSourceRefSchema.parse(adopted.member.adoption.sourceRef);expect(adopted.sourceStatus?.status).toBe('current');expect((await ownership(current,id)).view.binding!.sourceRef).toBeUndefined();
    await knowledgeSourceMemberChange(call,id,{kind:'state',memberId,expectedRevision:adopted.member.revision,nextState:'active',reason:'明确重新启用岗位以采纳同负责人模块来源'});
    await knowledgeSourceOwnershipChange(call,id,{kind:'adopt_source',moduleId:data.moduleId,expectedBinding:expectedBinding(owner.view.binding!),reason:data.reason});
    const finalMember=await member(current,id,memberId),finalOwner=await ownership(current,id);expect(finalOwner.view.binding!.bindingId).toBe(owner.view.binding!.bindingId);expect(finalOwner.view.binding!.ownerMemberId).toBe(memberId);knowledgeSourceRefSchema.parse(finalOwner.view.binding!.sourceRef);expect(finalOwner.view.sourceStatus?.status).toBe('current');
    const captures=sourceEvents((await knowledgeSourceDiskEvidence(legacy.user,id)).dispatchBytes);expect(captures).toHaveLength(2);expect(captures.map(event=>event.kind)).toEqual(['capture','capture']);for(const event of captures){if(event.kind!=='capture')throw Error('Unexpected source event before explicit adoption');expect(event.generation.origin).toBe('observed_existing')}
    expect(await call('workspace.members.receipt',{workspaceId:id,commandId:legacy.seeded.registered.request.commandId})).toEqual(legacy.seeded.registered.receipt);expect(await call('workspace.ownerships.receipt',{workspaceId:id,commandId:legacy.seeded.assigned.request.commandId})).toEqual(legacy.seeded.assigned.receipt);
    const disk=await knowledgeSourceDiskEvidence(legacy.user,id);await app.shutdown();app=new Application(new Paths(legacy.user,path.resolve('.')),path.resolve('design'));await app.init();expect((await member(app,id,memberId)).member).toEqual(finalMember.member);expect((await ownership(app,id)).view.binding).toEqual(finalOwner.view.binding);expect((await knowledgeSourceDiskEvidence(legacy.user,id)).dispatchBytes).toEqual(disk.dispatchBytes);expect(legacy.probe.requests).toEqual([]);passed=true;
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/knowledge-source-legacy-application-failure.json',JSON.stringify({...legacy.evidence,error:String(error),retained:true},null,2));throw error}
  finally{if(app)await app.shutdown();await legacy.cleanup(passed)}
},120000);
