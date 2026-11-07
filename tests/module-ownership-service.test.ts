import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture,request} from './helpers';
import {seedModuleOwnership,moduleOwnershipChange,commitModuleOwnership,moduleOwnershipJournal} from './module-ownership-fixture';
import {commitWorkspaceMember} from './workspace-member-fixture';
import type {ModuleOwnershipChangeInput,ModuleOwnershipPreview} from '../src/backend/core/workspace/module-ownership';

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const cleanup of cleanups.splice(0).reverse())await cleanup()});
async function setup(){
  const f=await fixture();cleanups.push(f.cleanup);const seed=await seedModuleOwnership(f.app,f.temp,'http://127.0.0.1:9/v1');
  const workspace=f.app.workspace(seed.entry.id),service=f.app.workspaceOwnerships(seed.entry.id),identity={workspaceId:seed.entry.id,instanceId:workspace.instanceId};
  const change=(memberId=seed.first.receipt.memberId):ModuleOwnershipChangeInput=>({moduleId:seed.moduleId,expectedBinding:null,nextOwner:{memberId,expectedRevision:1},reason:'Explicit ownership test'});
  const preview=(value:ModuleOwnershipChangeInput=change())=>service.preview({...identity,change:value});
  const command=(p:ModuleOwnershipPreview)=>({...identity,change:p.change,commandId:randomUUID(),expectedBasis:p.basis,expectedOwnershipCursor:p.ownershipCursor});
  const commit=(value:ReturnType<typeof command>)=>service.commit(value,{kind:'local_desktop',interaction:'explicit_submit'});
  return {...f,...seed,workspace,service,identity,change,preview,command,commit};
}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {promise,resolve}}

it('two explicit commits from one preview append only one ownership change',async()=>{
  const f=await setup(),p=await f.preview(),a=f.command(p),b=f.command(p),results=await Promise.allSettled([f.commit(a),f.commit(b)]);
  expect(results.filter(value=>value.status==='fulfilled')).toHaveLength(1);expect(results.find(value=>value.status==='rejected')).toMatchObject({reason:{code:'OWNERSHIP_REGISTRY_STALE'}});
  expect((await f.service.get({...f.identity,moduleId:f.moduleId})).history.total).toBe(1);
});

it('original command lookup precedes retired instance and failed sources without replay',async()=>{
  const f=await setup(),command=f.command(await f.preview()),receipt=await f.commit(command);await f.app.open(f.identity.workspaceId,true);
  const current=f.app.workspaceOwnerships(f.identity.workspaceId),snapshot=vi.spyOn(f.app.workspace(f.identity.workspaceId),'snapshot').mockRejectedValue(Error('no source read'));
  expect(await current.commit(command,{kind:'local_desktop',interaction:'explicit_submit'})).toEqual(receipt);
  expect(await current.receipt({workspaceId:f.identity.workspaceId,commandId:command.commandId})).toEqual(receipt);
  await expect(current.commit({...command,commandId:randomUUID()},{kind:'local_desktop',interaction:'explicit_submit'})).rejects.toMatchObject({code:'OWNERSHIP_IDENTITY'});
  await expect(current.commit({...command,change:{...command.change,reason:'changed request'}},{kind:'local_desktop',interaction:'explicit_submit'})).rejects.toMatchObject({code:'OWNERSHIP_COMMAND_CONFLICT'});expect(snapshot).not.toHaveBeenCalled();
});

it('both adopted member revision and actual knowledge changes invalidate a new commit',async()=>{
  const f=await setup(),command=f.command(await f.preview());
  await commitWorkspaceMember(f.app,f.identity.workspaceId,{kind:'update',memberId:f.first.receipt.memberId,expectedRevision:1,patch:{name:'changed position'},reason:'metadata changed'});
  await expect(f.commit(command)).rejects.toMatchObject({code:'OWNERSHIP_MEMBER_CHANGED'});
  const next={...f.change(),nextOwner:{memberId:f.first.receipt.memberId,expectedRevision:2}},second=f.command(await f.preview(next)),s=await f.workspace.snapshot();
  await f.workspace.commit(request(s,[{path:'.cbim/README.md',text:'# Explicit changed knowledge'}]));
  await expect(f.commit(second)).rejects.toMatchObject({code:'OWNERSHIP_BASIS_STALE'});
  expect((await f.service.get({...f.identity,moduleId:f.moduleId})).view.binding).toBeNull();
});

it('knowledge changing after the captured snapshot is rejected before the shared journal append',async()=>{
  const f=await setup(),command=f.command(await f.preview()),original=f.workspace.snapshot.bind(f.workspace);
  vi.spyOn(f.workspace,'snapshot').mockImplementationOnce(async()=>{const s=await original();await f.workspace.commit(request(s,[{path:'.cbim/README.md',text:'# Changed during ownership capture'}]));return s});
  await expect(f.commit(command)).rejects.toMatchObject({code:'OWNERSHIP_SOURCE_CHANGED'});
  expect(await f.service.receipt({workspaceId:f.identity.workspaceId,commandId:command.commandId})).toBeUndefined();
});

it('workspace stop during source capture prevents new registration and drains the same store',async()=>{
  const f=await setup(),command=f.command(await f.preview()),entered=deferred(),release=deferred(),original=f.workspace.snapshot.bind(f.workspace);
  vi.spyOn(f.workspace,'snapshot').mockImplementationOnce(async()=>{const s=await original();entered.resolve();await release.promise;return s});
  const pending=f.commit(command),checked=expect(pending).rejects.toMatchObject({code:'OWNERSHIP_UNAVAILABLE'});await entered.promise;
  const stopped=f.app.stop(f.identity.workspaceId);release.resolve();await checked;await stopped;await f.app.open(f.identity.workspaceId);
  expect(await f.app.workspaceOwnerships(f.identity.workspaceId).receipt({workspaceId:f.identity.workspaceId,commandId:command.commandId})).toBeUndefined();
});

it('releasing responsibility uses only its original binding even when knowledge is unavailable',async()=>{
  const f=await setup(),assigned=await commitModuleOwnership(f.app,f.identity.workspaceId,f.change()),value=await moduleOwnershipChange(f.app,f.identity.workspaceId,f.moduleId,null);
  const snapshot=vi.spyOn(f.workspace,'snapshot').mockRejectedValue(Error('missing source'));
  const receipt=await f.commit(f.command(await f.preview(value)));expect(receipt).toMatchObject({bindingId:assigned.receipt.bindingId,action:'unassign',revision:2});expect(snapshot).not.toHaveBeenCalled();
});

it('read basis includes member and knowledge changes even while the ownership cursor remains unchanged',async()=>{
  const f=await setup(),page=await f.service.list({...f.identity,limit:1});
  await commitWorkspaceMember(f.app,f.identity.workspaceId,{kind:'update',memberId:f.first.receipt.memberId,expectedRevision:1,patch:{name:'new name'},reason:'changes displayed source'});
  await expect(f.service.list({...f.identity,offset:1,expectedReadBasis:page.basis})).rejects.toMatchObject({code:'OWNERSHIP_REGISTRY_STALE'});
  const next=await f.service.list({...f.identity,limit:1}),s=await f.workspace.snapshot();await f.workspace.commit(request(s,[{path:'.cbim/README.md',text:'# new version'}]));
  await expect(f.service.list({...f.identity,offset:1,expectedReadBasis:next.basis})).rejects.toMatchObject({code:'OWNERSHIP_REGISTRY_STALE'});
  expect(next.basis.ownershipCursor).toBeNull();
});

it('a real newly queued related task invalidates the preview impact without changing its owner',async()=>{
  const f=await setup(),s=await f.workspace.snapshot(),modulePath=f.moduleId+'/module.json',definition=JSON.parse(s.files.find(item=>item.path===modulePath)!.text);
  definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'explicit-test',source:'local_user',confirmedAt:'2026-11-07T00:00:00.000Z'}};
  await f.workspace.commit(request(s,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'Owner',team:'.cbim/team'}]})}]));
  const command=f.command(await f.preview()),dispatch=f.app.memberDispatch(f.identity.workspaceId),identity={workspaceId:f.identity.workspaceId,rootSessionId:'ownership-related-root'};
  await dispatch.openGraph({...identity,commandId:randomUUID()});const graph=await dispatch.snapshot(identity);
  await dispatch.dispatchTask({...identity,commandId:randomUUID(),expectedParentRevision:graph.root.revision,task:{assigneeAgentId:f.team.input.agentId,moduleIds:[f.moduleId],goal:'a real queued task',acceptance:[{id:'evidence',text:'evidence'}],prerequisites:[]}});
  await expect(f.commit(command)).rejects.toMatchObject({code:'OWNERSHIP_BASIS_STALE'});
  const preview=await f.preview();expect(preview.impact).toMatchObject({total:1,counts:{unclaimed:1}});expect(preview.basis).not.toBe(command.expectedBasis);
  const records=(await moduleOwnershipJournal(f.user,f.identity.workspaceId)).records;expect(records.filter(record=>record.body.command.commandId.startsWith('module-ownership-'))).toHaveLength(0);
});
