import {it,expect} from 'vitest';
import path from 'node:path';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import {moduleOwnershipPageSchema} from '../src/backend/core/workspace/module-ownership';
import {workspaceMemberDetailSchema} from '../src/backend/core/team/workspace-member';
import {fixture} from './helpers';
import {commitWorkspaceMember} from './workspace-member-fixture';
import {seedModuleOwnership,moduleOwnershipDetail,moduleOwnershipChange,commitModuleOwnership,deleteOwnershipFixtureModule,moduleOwnershipHttpProbe,moduleOwnershipKnowledgeEvidence,moduleOwnershipRuntimeEvidence,moduleOwnershipJournal,moduleOwnershipRunFiles} from './module-ownership-fixture';

it('actual Application preserves one binding through A to B to none to A, blocks referenced retirement and releases a missing source without model execution',async()=>{
  const f=await fixture(),probe=await moduleOwnershipHttpProbe();let app=f.app;
  try{
    const seeded=await seedModuleOwnership(app,f.temp,probe.url),id=seeded.entry.id,a=seeded.first.receipt.memberId,b=seeded.second.receipt.memberId,ids=[id,seeded.other.id];
    const identity=()=>({workspaceId:id,instanceId:app.workspace(id).instanceId});
    const get=()=>moduleOwnershipDetail(app,id,seeded.moduleId);
    const byMember=async(memberId:string)=>moduleOwnershipPageSchema.parse(await app.dispatch('workspace.ownerships.byMember',{...identity(),memberId}));
    const member=async(memberId:string)=>workspaceMemberDetailSchema.parse(await app.dispatch('workspace.members.get',{...identity(),memberId})).member;
    const runtimeBefore=await moduleOwnershipRuntimeEvidence(app,ids);let knowledgeBefore=await moduleOwnershipKnowledgeEvidence(app,f.user,id);
    const unchanged=async()=>{expect(await moduleOwnershipKnowledgeEvidence(app,f.user,id)).toEqual(knowledgeBefore);expect(await moduleOwnershipRuntimeEvidence(app,ids)).toEqual(runtimeBefore);expect(await moduleOwnershipRunFiles(f.user,ids)).toEqual([]);expect(probe.requests).toEqual([])};
    const initial=await get();expect(initial.view.binding).toBeNull();expect(initial.view.status).toBe('unassigned');expect(initial.view.source.status).toBe('observed');expect(initial.history.total).toBe(0);expect((await byMember(a)).items).toEqual([]);
    const assigned=await commitModuleOwnership(app,id,await moduleOwnershipChange(app,id,seeded.moduleId,{memberId:a,expectedRevision:1})),bindingId=assigned.receipt.bindingId;
    expect(assigned.receipt).toMatchObject({action:'assign',revision:1,ownerMemberId:a,actor:{kind:'local_desktop',interaction:'explicit_submit'}});expect(assigned.preview.impact).toMatchObject({coverage:'dispatch_graph_tasks_with_module',total:0});expect((await byMember(a)).items.map(item=>item.moduleId)).toEqual([seeded.moduleId]);expect((await byMember(b)).items).toEqual([]);await unchanged();
    const bindingBeforeRename=(await get()).view.binding;
    await commitWorkspaceMember(app,id,{kind:'update',memberId:a,expectedRevision:1,patch:{name:'岗位 A 改名仍同身份'},reason:'只改岗位名称，不重新绑定模块。'});
    expect((await get()).view.binding).toEqual(bindingBeforeRename);expect((await get()).view.owner?.name).toBe('岗位 A 改名仍同身份');
    const replaced=await commitModuleOwnership(app,id,await moduleOwnershipChange(app,id,seeded.moduleId,{memberId:b,expectedRevision:1}));expect(replaced.receipt).toMatchObject({bindingId,revision:2,action:'replace',previousOwnerMemberId:a,ownerMemberId:b});expect((await byMember(a)).items).toEqual([]);expect((await byMember(b)).items.map(item=>item.moduleId)).toEqual([seeded.moduleId]);
    const unassigned=await commitModuleOwnership(app,id,await moduleOwnershipChange(app,id,seeded.moduleId,null));expect(unassigned.receipt).toMatchObject({bindingId,revision:3,action:'unassign',ownerMemberId:null});expect((await byMember(b)).items).toEqual([]);
    const restored=await commitModuleOwnership(app,id,await moduleOwnershipChange(app,id,seeded.moduleId,{memberId:a,expectedRevision:2}));expect(restored.receipt).toMatchObject({bindingId,revision:4,action:'assign',ownerMemberId:a});
    const history=(await get()).history;expect(history.items.map(item=>item.ownerMemberId)).toEqual([a,b,null,a]);expect(history.items.every(item=>item.bindingId===bindingId)).toBe(true);expect(history.total).toBe(4);expect(history.truncated).toBe(false);await unchanged();

    const paused=await commitWorkspaceMember(app,id,{kind:'state',memberId:a,expectedRevision:2,nextState:'suspended',reason:'暂停保留模块责任，显式报告岗位状态。'});
    const pausedBinding=(await get()).view.binding;expect((await get()).view.status).toBe('owner_suspended');expect((await byMember(a)).total).toBe(1);
    const beforeRefused=(await moduleOwnershipJournal(f.user,id)).bytes;
    await expect(commitWorkspaceMember(app,id,{kind:'state',memberId:a,expectedRevision:paused.receipt.memberRevision,nextState:'retired',reason:'仍被模块引用时不得退休。'})).rejects.toMatchObject({code:'MEMBER_OWNERSHIP_ACTIVE'});
    expect((await moduleOwnershipJournal(f.user,id)).bytes).toEqual(beforeRefused);expect((await get()).view.binding).toEqual(pausedBinding);expect((await member(a)).state).toBe('suspended');
    await commitModuleOwnership(app,id,await moduleOwnershipChange(app,id,seeded.moduleId,null));await commitWorkspaceMember(app,id,{kind:'state',memberId:a,expectedRevision:paused.receipt.memberRevision,nextState:'retired',reason:'所有当前责任已明确解除后退休。'});expect((await member(a)).state).toBe('retired');await unchanged();

    const leaf=await commitModuleOwnership(app,id,await moduleOwnershipChange(app,id,seeded.missingModuleId,{memberId:b,expectedRevision:1})),leafBefore=(await moduleOwnershipDetail(app,id,seeded.missingModuleId)).view.binding!;
    await deleteOwnershipFixtureModule(app,seeded);knowledgeBefore=await moduleOwnershipKnowledgeEvidence(app,f.user,id);
    const missing=await moduleOwnershipDetail(app,id,seeded.missingModuleId);expect(missing.view.source.status).toBe('missing');expect(missing.view.binding).toEqual(leafBefore);expect((await byMember(b)).items.map(item=>item.moduleId)).toEqual([seeded.missingModuleId]);
    const released=await commitModuleOwnership(app,id,await moduleOwnershipChange(app,id,seeded.missingModuleId,null));expect(released.preview.observedModule).toBeUndefined();expect(released.receipt).toMatchObject({bindingId:leaf.receipt.bindingId,revision:2,ownerMemberId:null});expect((await moduleOwnershipDetail(app,id,seeded.missingModuleId)).view.binding?.observedModule).toEqual(leafBefore.observedModule);expect((await byMember(b)).items).toEqual([]);await unchanged();
    const final=await get(),leafFinal=await moduleOwnershipDetail(app,id,seeded.missingModuleId),journal=await moduleOwnershipJournal(f.user,id),count=journal.records.flatMap(record=>(record.body.mutation.ownershipChanges??[]) as unknown[]).length;expect(count).toBe(7);
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect((await get()).view).toEqual(final.view);expect((await get()).history).toEqual(final.history);expect((await moduleOwnershipDetail(app,id,seeded.missingModuleId)).view).toEqual(leafFinal.view);expect(await app.dispatch('workspace.ownerships.receipt',{workspaceId:id,commandId:assigned.input.commandId})).toEqual(assigned.receipt);expect(await app.dispatch('workspace.ownerships.commit',assigned.input)).toEqual(assigned.receipt);expect((await moduleOwnershipJournal(f.user,id)).bytes).toEqual(journal.bytes);await unchanged();
  }finally{await app.shutdown();await probe.close();await f.cleanup()}
},90000);
