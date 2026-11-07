import {it,expect,vi} from 'vitest';
import path from 'node:path';
import {fixture,request} from './helpers';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import type {RunSummary} from '../src/backend/core/brain/types';
import {moduleOwnershipProvider,moduleOwnershipToolNames,type ModuleOwnershipMode} from './module-ownership-provider';
import {seedModuleOwnership,moduleOwnershipFixture as data,moduleOwnershipDetail,moduleOwnershipJournal,moduleOwnershipKnowledgeEvidence,moduleOwnershipRunRecords,moduleOwnershipNativeBytes} from './module-ownership-fixture';

it.each(['read','ask-deny','ask-approve','execute','bad-wire','stop'] as ModuleOwnershipMode[])('real main Pi discovers registered positions and controls ownership through actual authorization without business execution (%s)',async mode=>{
  const f=await fixture(),provider=await moduleOwnershipProvider(mode);let app=f.app;
  try{
    const seeded=await seedModuleOwnership(app,f.temp,provider.url),id=seeded.entry.id;provider.bindModule(seeded.moduleId);
    const service=app.workspaceOwnerships(id),realCommit=service.commit.bind(service),knowledge=await moduleOwnershipKnowledgeEvidence(app,f.user,id);
    // Mutation is real and durable before this test alters the returned clone. No production hook, rollback, or fake acceptance.
    const committed=vi.spyOn(service,'commit').mockImplementation(async(...args)=>{const value=await realCommit(...args);return mode==='bad-wire'?{...value,identity:{...value.identity,workspaceId:'wrong-test-output-identity'}}:value});
    const permission=mode==='read'?'read':mode.startsWith('ask-')?'ask':'execute';
    const started=await app.dispatch('loop.chat',{id,message:data.goal,options:{profileId:seeded.profileId,model:data.model,permission,turnTimeoutMs:60000}}) as {taskId:string;runId:string},root={workspaceId:id,rootSessionId:started.taskId};
    if(mode.startsWith('ask-')){
      await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await app.dispatch('loop.approvals',{id,taskId:started.taskId})).length).toBe(1)},{timeout:30000,interval:25});
      const approvals=await app.dispatch('loop.approvals',{id,taskId:started.taskId});expect(approvals[0].name).toBe('cbim_module_owner_change_commit');expect(committed).not.toHaveBeenCalled();expect((await moduleOwnershipDetail(app,id,seeded.moduleId)).history.total).toBe(0);
      await app.dispatch('loop.approve',{id,taskId:started.taskId,approvalId:approvals[0].id,allow:mode==='ask-approve'});
    }
    if(mode==='stop'){
      await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(provider.state.readyToCommit).toBe(true)},{timeout:30000,interval:25});await app.dispatch('loop.stop',{id,taskId:started.taskId});provider.release();
    }
    await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await moduleOwnershipRunRecords(f.user,id)).scopes[0]?.status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:45000,interval:30});
    const saved=await moduleOwnershipRunRecords(f.user,id),graph=await app.dispatch('dispatch.graphSnapshot',{identity:root}),summary=await app.dispatch('loop.inspect',{id,taskId:started.taskId,runId:started.runId}) as RunSummary,ownership=await moduleOwnershipDetail(app,id,seeded.moduleId);
    expect(saved.scopes[0].outcome).toBe(mode==='stop'?'cancelled':'completed');expect(saved.scopes[0].goal?.plan).toBeUndefined();expect(graph.tasks).toEqual([]);expect(saved.runs).toEqual([]);expect(saved.members).toHaveLength(1);expect(summary.conversationBinding).toMatchObject({...root,agentId:'cbim:main',agentInstanceId:graph.root.agent.agentInstanceId});expect(summary.unresolvedTools).toEqual([]);expect(await app.dispatch('loop.approvals',{id,taskId:started.taskId})).toEqual([]);
    expect(provider.state.selected.memberId).toBe(seeded.first.receipt.memberId);expect(provider.state.discovered.memberPage.items.map((member:{memberId:string})=>member.memberId)).toEqual([seeded.first.receipt.memberId,seeded.second.receipt.memberId]);
    for(const callId of ['owner-members','owner-inspect','owner-preview'])expect(summary.toolReceipts?.find(receipt=>receipt.toolCallId===callId)?.outcome).toBe('succeeded');
    const allowed=mode==='ask-approve'||mode==='execute'||mode==='bad-wire',writes=summary.toolReceipts?.filter(receipt=>receipt.toolName==='cbim_module_owner_change_commit')??[];
    if(allowed){
      expect(committed).toHaveBeenCalledTimes(1);expect(ownership.history.total).toBe(1);expect(ownership.view.binding?.ownerMemberId).toBe(seeded.first.receipt.memberId);
      const receipt=provider.state.recovered.receipt;expect(receipt.identity).toEqual({workspaceId:id,instanceId:app.workspace(id).instanceId});expect(receipt.actor).toEqual({kind:'main_agent',rootSessionId:started.taskId,scopeId:saved.scopes[0].scopeId,agentInstanceId:graph.root.agent.agentInstanceId,agentSessionId:summary.conversationBinding!.agentSessionId,runId:started.runId,toolCallId:'owner-commit',toolName:'cbim_module_owner_change_commit'});
      expect(ownership.history.items[0].actor).toEqual(receipt.actor);expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({outcome:mode==='bad-wire'?'failed':'succeeded',effects:['knowledge-write'],scope:{kind:'knowledge',workspaceId:id}});expect(summary.toolReceipts?.find(value=>value.toolCallId==='owner-receipt')?.outcome).toBe('succeeded');expect(provider.requests).toHaveLength(6);
      if(mode==='bad-wire')expect(String(provider.state.commitReply.error)).toContain(receipt.commandId);
      const bytes=(await moduleOwnershipJournal(f.user,id)).bytes;expect(await app.dispatch('workspace.ownerships.receipt',{workspaceId:id,commandId:receipt.commandId})).toEqual(receipt);expect((await moduleOwnershipJournal(f.user,id)).bytes).toEqual(bytes);
    }else{
      expect(committed).not.toHaveBeenCalled();expect(ownership.history.total).toBe(0);expect(ownership.view.binding).toBeNull();if(mode==='stop'){expect(writes).toEqual([]);expect(provider.requests).toHaveLength(4)}else{expect(writes).toHaveLength(1);expect(writes[0].outcome).toBe('denied');expect(provider.requests).toHaveLength(5)}
    }
    expect(await moduleOwnershipKnowledgeEvidence(app,f.user,id)).toEqual(knowledge);const bytes=await moduleOwnershipNativeBytes(f.user,id,summary),journal=await moduleOwnershipJournal(f.user,id),count=provider.requests.length;
    vi.restoreAllMocks();await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect(await moduleOwnershipRunRecords(f.user,id)).toEqual(saved);expect(await app.dispatch('dispatch.graphSnapshot',{identity:root})).toEqual(graph);expect((await moduleOwnershipDetail(app,id,seeded.moduleId)).view).toEqual(ownership.view);expect((await moduleOwnershipDetail(app,id,seeded.moduleId)).history).toEqual(ownership.history);expect(await moduleOwnershipNativeBytes(f.user,id,await app.dispatch('loop.inspect',{id,taskId:started.taskId,runId:started.runId}) as RunSummary)).toEqual(bytes);expect((await moduleOwnershipJournal(f.user,id)).bytes).toEqual(journal.bytes);expect(await moduleOwnershipKnowledgeEvidence(app,f.user,id)).toEqual(knowledge);expect(provider.requests).toHaveLength(count);expect(provider.errors).toEqual([]);
  }finally{provider.release();vi.restoreAllMocks();await app.shutdown();await f.cleanup();await provider.close()}
},90000);

it('actual executor Pi has none of the four ownership-control tools despite registered positions',async()=>{
  const f=await fixture(),provider=await moduleOwnershipProvider('member');
  try{
    const seeded=await seedModuleOwnership(f.app,f.temp,provider.url),id=seeded.entry.id,dispatch=f.app.memberDispatch(id),members=f.app.memberExecution(id),identity={workspaceId:id,rootSessionId:'ownership-member-probe'};
    // Tool discovery still requires a genuinely dispatchable module; responsibility registration does not grant maintainer confirmation.
    const workspace=f.app.workspace(id),snapshot=await workspace.snapshot(),modulePath=seeded.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
    definition.maintenance={bindingId:'ownership-probe-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'ownership-probe-review',source:'local_user',confirmedAt:new Date().toISOString()}};
    await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
    const scope=await dispatch.openScope(identity,'ownership-member-probe-scope'),assigned=await dispatch.dispatchTask({...identity,commandId:'ownership-member-assign',expectedParentRevision:1,task:{assigneeAgentId:'cbim:executor',moduleIds:[seeded.moduleId],goal:'仅核实执行者实际工具目录，不进行业务交付',acceptance:[{id:'tools',text:'真实工具目录没有主责任控制入口'}],prerequisites:[]}},scope.scopeId),taskIdentity={...identity,taskId:assigned.taskId};
    const run=await members.start({...taskIdentity,commandId:'ownership-member-start',expectedRevision:1,options:{profileId:seeded.profileId,permission:'read',turnTimeoutMs:60000}});await members.waitForSettlement(taskIdentity);
    const summary=await new FileRunStorage().read(path.join(f.user,id,'dispatch','runs','tasks',assigned.taskId,run.runId));expect(summary.status).toBe('completed');expect(summary.memberBinding?.agentId).toBe('cbim:executor');expect(summary.toolReceipts??[]).toEqual([]);expect(provider.requests).toHaveLength(1);expect(provider.errors).toEqual([]);expect(provider.requests[0].tools?.some(tool=>moduleOwnershipToolNames.includes(tool.function.name))).toBe(false);expect((await moduleOwnershipDetail(f.app,id,seeded.moduleId)).history.total).toBe(0);await dispatch.closeScope(identity,scope.scopeId,'cancelled');
  }finally{provider.release();await f.cleanup();await provider.close()}
},60000);
