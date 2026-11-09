import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {Snapshot} from '../src/backend/core/knowledge/types';
import {fixture,request} from './helpers';
import {seedWorkspaceMembers,commitWorkspaceMember,changeWorkspaceMemberCapability} from './workspace-member-fixture';
import type {WorkspaceMemberChangeInput,WorkspaceMemberCommitInput,WorkspaceMemberPreview} from '../src/backend/core/team/workspace-member';

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const cleanup of cleanups.splice(0).reverse())await cleanup()});
async function setup(){
  const f=await fixture();cleanups.push(f.cleanup);
  const seed=await seedWorkspaceMembers(f.app,f.temp,'http://127.0.0.1:9/v1');
  const workspace=f.app.workspace(seed.entry.id),service=f.app.workspaceMembers(seed.entry.id),identity={workspaceId:seed.entry.id,instanceId:workspace.instanceId};
  const preview=(change:WorkspaceMemberChangeInput)=>service.preview({...identity,change});
  const command=(value:WorkspaceMemberPreview):WorkspaceMemberCommitInput=>({...identity,change:value.change,commandId:randomUUID(),expectedBasis:value.basis,expectedRegistryCursor:value.registryCursor});
  const commit=(value:WorkspaceMemberCommitInput)=>service.commit(value,{kind:'local_desktop',interaction:'explicit_submit'});
  return {...f,...seed,workspace,service,identity,preview,command,commit};
}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {promise,resolve}}

it('concurrent fresh commands from one preview commit exactly one registry revision',async()=>{
  const f=await setup(),p=await f.preview(f.register()),a=f.command(p),b=f.command(p);
  const results=await Promise.allSettled([f.commit(a),f.commit(b)]);
  expect(results.filter(item=>item.status==='fulfilled')).toHaveLength(1);
  const rejected=results.find(item=>item.status==='rejected');expect(rejected).toMatchObject({reason:{code:'MEMBER_REGISTRY_STALE'}});
  expect(await f.service.list(f.identity)).toMatchObject({total:1,registryCursor:{seq:1}});
  expect(await f.service.receipt({workspaceId:f.identity.workspaceId,commandId:a.commandId})).toBeDefined();
  expect(await f.service.receipt({workspaceId:f.identity.workspaceId,commandId:b.commandId})).toBeUndefined();
});

it('the original receipt wins over retired instance and unavailable source without any read or resolve',async()=>{
  const f=await setup(),p=await f.preview(f.register()),command=f.command(p),receipt=await f.commit(command);
  await f.app.open(f.identity.workspaceId,true);
  const service=f.app.workspaceMembers(f.identity.workspaceId),workspace=f.app.workspace(f.identity.workspaceId);
  const snapshot=vi.spyOn(workspace,'snapshot').mockRejectedValue(Error('must not reread knowledge'));
  const models=vi.spyOn(f.app.models,'configuration').mockRejectedValue(Error('must not reread profile'));
  expect(await service.commit(command,{kind:'local_desktop',interaction:'explicit_submit'})).toEqual(receipt);
  expect(await service.receipt({workspaceId:f.identity.workspaceId,commandId:command.commandId})).toEqual(receipt);
  await expect(service.commit({...command,change:{...command.change,reason:'different request'}},{kind:'local_desktop',interaction:'explicit_submit'})).rejects.toMatchObject({code:'MEMBER_COMMAND_CONFLICT'});
  await expect(service.commit({...command,commandId:randomUUID()},{kind:'local_desktop',interaction:'explicit_submit'})).rejects.toMatchObject({code:'MEMBER_IDENTITY'});
  expect(snapshot).not.toHaveBeenCalled();expect(models).not.toHaveBeenCalled();
});

it('unrelated knowledge changes keep the same preview basis while new registration records the actual capture revision',async()=>{
  const f=await setup(),p=await f.preview(f.register()),command=f.command(p),snapshot=await f.workspace.snapshot();
  const unrelated=snapshot.files.find(file=>file.path==='.cbim/README.md')!;
  await f.workspace.commit(request(snapshot,[{path:unrelated.path,text:unrelated.text+'\n'}]));
  const next=await f.preview(f.register());expect(next.basis).toBe(p.basis);
  expect(next.proposed.capability.configuration.knowledgeRevision).not.toBe(p.proposed.capability.configuration.knowledgeRevision);
  const receipt=await f.commit(command),detail=await f.service.get({...f.identity,memberId:receipt.memberId});
  expect(detail.member.adoption.knowledgeRevision).toBe(next.proposed.capability.configuration.knowledgeRevision);
});

it('changed adopted content invalidates a prepared commit without writing a registry record',async()=>{
  const f=await setup(),p=await f.preview(f.register()),command=f.command(p);
  await changeWorkspaceMemberCapability(f.app,f.identity.workspaceId,f.team.input.agentId,f.team.shared);
  await expect(f.commit(command)).rejects.toMatchObject({code:'MEMBER_BASIS_STALE'});
  expect(await f.service.receipt({workspaceId:f.identity.workspaceId,commandId:command.commandId})).toBeUndefined();
  expect(await f.service.list(f.identity)).toMatchObject({total:0,registryCursor:null});
});

it('knowledge changing while public model preparation awaits is rejected before the shared journal is appended',async()=>{
  const f=await setup(),p=await f.preview(f.register()),command=f.command(p),original=f.app.models.configuration.bind(f.app.models);
  vi.spyOn(f.app.models,'configuration').mockImplementationOnce(async(...args)=>{
    const value=await original(...args);
    // 采纳已持知识串行锁；外部文件变化仍可能发生，不能在同锁回调中排队并等待另一知识提交。
    await fs.writeFile(path.join(f.workspace.entry.path,f.team.input.agentId,'principles.md'),'# Changed externally during model configuration');
    return value;
  });
  await expect(f.commit(command)).rejects.toMatchObject({code:'MEMBER_SOURCE_CHANGED'});
  expect(await f.service.list(f.identity)).toMatchObject({total:0});
});

it('public model changes during preparation are caught by the final source reread',async()=>{
  const f=await setup(),p=await f.preview(f.register()),command=f.command(p),original=f.app.models.configuration.bind(f.app.models);
  vi.spyOn(f.app.models,'configuration').mockImplementationOnce(async(...args)=>{
    const value=await original(...args);
    await f.app.models.save({id:f.profileId,profile:{...f.definition,name:'changed after selected snapshot'}});
    return value;
  });
  await expect(f.commit(command)).rejects.toMatchObject({code:'MEMBER_SOURCE_CHANGED'});
  expect(await f.service.list(f.identity)).toMatchObject({total:0});
});

it('workspace retirement while a real source read awaits rejects new registration and drains without creating runtime state',async()=>{
  const f=await setup(),p=await f.preview(f.register()),command=f.command(p),entered=deferred(),release=deferred(),original=f.workspace.withSourceSnapshot.bind(f.workspace);
  vi.spyOn(f.workspace,'withSourceSnapshot').mockImplementationOnce(<T>(operation:(s:Snapshot)=>Promise<T>)=>original(async value=>{entered.resolve();await release.promise;return operation(value)}));
  const pending=f.commit(command);await entered.promise;
  const stopped=f.app.stop(f.identity.workspaceId);release.resolve();
  await expect(pending).rejects.toMatchObject({code:'MEMBER_UNAVAILABLE'});await stopped;
  await f.app.open(f.identity.workspaceId);
  expect(await f.app.workspaceMembers(f.identity.workspaceId).receipt({workspaceId:f.identity.workspaceId,commandId:command.commandId})).toBeUndefined();
  expect(await f.app.workspaceMembers(f.identity.workspaceId).list({workspaceId:f.identity.workspaceId,instanceId:f.app.workspace(f.identity.workspaceId).instanceId})).toMatchObject({total:0});
});

it('metadata edits and registration state changes preserve adopted snapshots even when both current sources are unavailable',async()=>{
  const f=await setup(),created=await commitWorkspaceMember(f.app,f.identity.workspaceId,f.register());
  const before=(await f.service.get({...f.identity,memberId:created.receipt.memberId})).member;
  vi.spyOn(f.workspace,'snapshot').mockRejectedValue(Error('source is unavailable'));
  vi.spyOn(f.app.models,'configuration').mockRejectedValue(Error('model is unavailable'));
  const updated=await f.commit(f.command(await f.preview({kind:'update',memberId:before.memberId,expectedRevision:1,patch:{name:'renamed without adoption'},reason:'edit metadata only'})));
  const suspended=await f.commit(f.command(await f.preview({kind:'state',memberId:before.memberId,expectedRevision:updated.memberRevision,nextState:'suspended',reason:'pause registration'})));
  await f.commit(f.command(await f.preview({kind:'state',memberId:before.memberId,expectedRevision:suspended.memberRevision,nextState:'active',reason:'restore registration only'})));
  const detail=await f.service.get({...f.identity,memberId:before.memberId});
  expect(detail.member.state).toBe('active');expect(detail.member.adoption).toEqual(before.adoption);expect(detail.member.runtimePolicy).toEqual(before.runtimePolicy);
  expect(detail.currentDiff.capability.status).toBe('invalid');expect(detail.currentDiff.model.status).toBe('invalid');
});

it('same model reference cannot implicitly adopt changed configuration and retired positions remain terminal',async()=>{
  const f=await setup(),created=await commitWorkspaceMember(f.app,f.identity.workspaceId,f.register()),memberId=created.receipt.memberId;
  await f.app.models.save({id:f.profileId,profile:{...f.definition,name:'current model has changed'}});
  await expect(f.preview({kind:'update',memberId,expectedRevision:1,patch:{runtimePolicy:{profileId:f.profileId,modelId:f.modelId}},reason:'must use adoption'})).rejects.toMatchObject({code:'MEMBER_NO_CHANGE'});
  const retired=await f.commit(f.command(await f.preview({kind:'state',memberId,expectedRevision:1,nextState:'retired',reason:'retire explicitly'})));
  await expect(f.preview({kind:'state',memberId,expectedRevision:retired.memberRevision,nextState:'active',reason:'cannot revive'})).rejects.toMatchObject({code:'MEMBER_RETIRED'});
  await expect(f.preview({kind:'adopt',memberId,expectedRevision:retired.memberRevision,target:'model',reason:'cannot modify retired'})).rejects.toMatchObject({code:'MEMBER_RETIRED'});
});

it('pagination freezes registration order and current diff is not cached behind the unchanged registry cursor',async()=>{
  const f=await setup(),first=await commitWorkspaceMember(f.app,f.identity.workspaceId,f.register()),second=await commitWorkspaceMember(f.app,f.identity.workspaceId,f.register('second position'));
  const page=await f.service.list({...f.identity,limit:1});expect(page.items[0].memberId).toBe(first.receipt.memberId);
  const detail=await f.service.get({...f.identity,memberId:first.receipt.memberId});
  await f.app.models.save({id:f.profileId,profile:{...f.definition,name:'changed without registry mutation'}});
  const changed=await f.service.get({...f.identity,memberId:first.receipt.memberId});
  expect(changed.registryCursor).toEqual(detail.registryCursor);expect(changed.currentDiff.model.status).toBe('changed');
  expect((await f.service.list({...f.identity,offset:1,expectedRegistryCursor:page.registryCursor!})).items[0].memberId).toBe(second.receipt.memberId);
  await commitWorkspaceMember(f.app,f.identity.workspaceId,{kind:'update',memberId:second.receipt.memberId,expectedRevision:1,patch:{name:'second renamed'},reason:'update metadata'});
  await expect(f.service.list({...f.identity,offset:1,expectedRegistryCursor:page.registryCursor!})).rejects.toMatchObject({code:'MEMBER_REGISTRY_STALE'});
  await expect(f.service.list({...f.identity,offset:1})).rejects.toMatchObject({code:'MEMBER_INPUT_INVALID'});
});
