import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,request} from './helpers';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import type {RunSummary} from '../src/backend/core/brain/types';
import {moduleGovernanceToolsProvider,moduleGovernanceToolsFixture as data,type ModuleGovernanceToolsMode} from './module-governance-tools-provider';
import {seedModuleGovernanceTools,moduleGovernanceToolsRecords,moduleGovernanceToolsLogBytes,moduleGovernanceToolsJournalBytes,moduleGovernanceToolsHistory} from './module-governance-tools-fixture';

it.each(['complete','invalid','lost-reply','stop'] as ModuleGovernanceToolsMode[])('real main Pi records bounded governance proposals without formal writes or repeat after uncertainty (%s)',async mode=>{
  const f=await fixture(),provider=await moduleGovernanceToolsProvider(mode);let app=f.app;
  try{
    const seeded=await seedModuleGovernanceTools(app,f.a,provider),workspace=app.workspace(seeded.entry.id),journals=await moduleGovernanceToolsJournalBytes(f.user,seeded.entry.id),realPropose=workspace.governance.proposeFromMain.bind(workspace.governance);
    // The actual proposal is reliably saved before this test discards its service reply. Recovery must query the original call, never replay it.
    const proposals=vi.spyOn(workspace.governance,'proposeFromMain').mockImplementation(async(...args)=>{const result=await realPropose(...args);if(mode==='lost-reply')throw Error('TEST_RESPONSE_LOST: saved governance proposal reply deliberately lost at test boundary');return result});
    const started=await app.dispatch('loop.chat',{id:seeded.entry.id,message:data.goal,options:{permission:mode==='invalid'?'ask':'read',turnTimeoutMs:60000}}),identity={workspaceId:seeded.entry.id,rootSessionId:started.taskId},records=()=>moduleGovernanceToolsRecords(f.user,seeded.entry.id),graph=()=>app.dispatch('dispatch.graphSnapshot',{identity});
    if(mode==='stop'){
      await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(provider.state.readyToPropose).toBe(true)},{timeout:30000,interval:30});
      await app.dispatch('loop.stop',{id:seeded.entry.id,taskId:started.taskId});
      await vi.waitFor(async()=>{expect((await records()).scopes[0].status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:30});provider.release();
    }
    await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0].status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:30});
    const saved=await records(),finished=await graph(),summary=await app.dispatch('loop.inspect',{id:seeded.entry.id,taskId:started.taskId,runId:started.runId}) as RunSummary,history=await moduleGovernanceToolsHistory(app,seeded.entry.id,provider.state.proposalReceipt?.record.proposalId);
    expect(saved.scopes[0].outcome).toBe(mode==='stop'?'cancelled':'completed');expect(finished.tasks).toEqual([]);expect(saved.runs).toEqual([]);expect(saved.members).toHaveLength(1);expect(summary.conversationBinding).toMatchObject({...identity,agentId:'cbim:main',agentInstanceId:finished.root.agent.agentInstanceId});expect(summary.unresolvedTools).toEqual([]);expect(await app.dispatch('loop.approvals',{id:seeded.entry.id,taskId:started.taskId})).toEqual([]);
    expect(history.observations).toHaveLength(1);expect(history.observations[0].origin).toEqual({kind:'main_agent',rootSessionId:started.taskId,agentInstanceId:finished.root.agent.agentInstanceId,agentSessionId:summary.conversationBinding!.agentSessionId,runId:started.runId,toolCallId:'governance-observe',toolName:'cbim_governance_observe'});
    for(const [id,effect]of [['governance-get','read'],['governance-observe','maintenance'],['governance-observation','read'],['governance-observe-receipt','read']])expect(summary.toolReceipts?.find(receipt=>receipt.toolCallId===id)).toMatchObject({outcome:'succeeded',effects:[effect],scope:{kind:'knowledge',workspaceId:seeded.entry.id}});
    if(mode==='stop'){expect(proposals).not.toHaveBeenCalled();expect(history.proposals).toEqual([]);expect(provider.requests).toHaveLength(5)}
    else{
      expect(proposals).toHaveBeenCalledTimes(1);expect(history.proposals).toHaveLength(1);expect(history.selected?.decisions).toEqual([]);expect(history.selected?.applications).toEqual([]);expect(history.selected?.proposal.change).toMatchObject({beforeText:seeded.original,afterText:seeded.proposed});expect(history.selected?.proposal.origin).toEqual({...history.observations[0].origin,toolCallId:'governance-propose',toolName:'cbim_governance_propose'});
      expect(provider.requests).toHaveLength(mode==='invalid'?10:8);expect(provider.state.proposalReceipt.record.proposalId).toBe(history.selected?.proposal.proposalId);
      expect(summary.toolReceipts?.find(receipt=>receipt.toolCallId==='governance-propose')).toMatchObject({outcome:mode==='lost-reply'?'failed':'succeeded',effects:['preview'],scope:{kind:'knowledge',workspaceId:seeded.entry.id}});expect(summary.toolReceipts?.find(receipt=>receipt.toolCallId==='governance-propose-receipt')?.outcome).toBe('succeeded');
      if(mode==='invalid')for(const id of ['governance-invalid-identity','governance-oversized'])expect(summary.toolReceipts?.find(receipt=>receipt.toolCallId===id)?.outcome).not.toBe('succeeded');
      const ledger=JSON.parse(await fs.readFile(path.join(f.user,seeded.entry.id,'governance','module-ledger.json'),'utf8')) as {commands:Array<{receipt:{action:string;commandId:string}}>};expect(ledger.commands.filter(command=>command.receipt.action==='propose')).toHaveLength(1);
    }
    expect((await workspace.snapshot()).files).toEqual(seeded.snapshot.files);expect(await moduleGovernanceToolsJournalBytes(f.user,seeded.entry.id)).toEqual(journals);
    await expect(workspace.commit(request(await workspace.snapshot(),[{path:seeded.overviewPath,text:seeded.proposed}]))).rejects.toMatchObject({code:'GOVERNANCE_PROTECTED'});expect(await moduleGovernanceToolsJournalBytes(f.user,seeded.entry.id)).toEqual(journals);
    const bytes=await moduleGovernanceToolsLogBytes(f.user,seeded.entry.id),count=provider.requests.length;vi.restoreAllMocks();await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect(await records()).toEqual(saved);expect(await graph()).toEqual(finished);expect(await moduleGovernanceToolsLogBytes(f.user,seeded.entry.id)).toEqual(bytes);expect(await moduleGovernanceToolsJournalBytes(f.user,seeded.entry.id)).toEqual(journals);expect((await app.workspace(seeded.entry.id).snapshot()).files).toEqual(seeded.snapshot.files);expect((await moduleGovernanceToolsHistory(app,seeded.entry.id,provider.state.proposalReceipt?.record.proposalId)).selected).toEqual(history.selected);expect(provider.requests).toHaveLength(count);expect(provider.errors).toEqual([]);
  }finally{provider.release();vi.restoreAllMocks();await app.shutdown();await f.cleanup();await provider.close()}
},90000);

it('actual executor Pi has none of the four main governance tools',async()=>{
  const f=await fixture(),provider=await moduleGovernanceToolsProvider('member');
  try{
    const seeded=await seedModuleGovernanceTools(f.app,f.a,provider),dispatch=f.app.memberDispatch(seeded.entry.id),members=f.app.memberExecution(seeded.entry.id),identity={workspaceId:seeded.entry.id,rootSessionId:'governance-member-probe'},scope=await dispatch.openScope(identity,'governance-member-probe-scope');
    const task=await dispatch.dispatchTask({...identity,commandId:'governance-member-probe-assign',expectedParentRevision:1,task:{assigneeAgentId:'cbim:executor',moduleIds:[data.moduleId],goal:'只核实执行者的实际工具清单，不实施业务',acceptance:[{id:'tools',text:'记录真实模型上下文中的工具清单'}],prerequisites:[]}},scope.scopeId),taskIdentity={...identity,taskId:task.taskId};
    const run=await members.start({...taskIdentity,commandId:'governance-member-probe-start',expectedRevision:1,options:{permission:'read',turnTimeoutMs:60000}});await members.waitForSettlement(taskIdentity);
    const summary=await new FileRunStorage().read(path.join(f.user,seeded.entry.id,'dispatch','runs','tasks',task.taskId,run.runId));expect(summary.status).toBe('completed');expect(summary.memberBinding?.agentId).toBe('cbim:executor');expect(summary.toolReceipts??[]).toEqual([]);expect(provider.requests).toHaveLength(1);expect(provider.errors).toEqual([]);expect((await moduleGovernanceToolsHistory(f.app,seeded.entry.id)).proposals).toEqual([]);expect((await f.app.workspace(seeded.entry.id).snapshot()).files).toEqual(seeded.snapshot.files);await dispatch.closeScope(identity,scope.scopeId,'cancelled');
  }finally{provider.release();await f.cleanup();await provider.close()}
},60000);
