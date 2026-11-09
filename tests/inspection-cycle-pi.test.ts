import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {seedExecutionReport} from './execution-report-fixture';
import {inspectionCycleProvider,inspectionFixture as data} from './inspection-cycle-provider';
import {corruptInspectionHistory,inspectionScopes} from './inspection-cycle-fixture';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {RecoveryRequest,RecoveryReceipt} from '../src/backend/core/tasks/scope-recovery';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import type {ConversationThreadView} from '../src/backend/core/brain/types';

it.each(['complete-restart','stop','again'] as const)('starts a new read-only Pi inspection without replaying damaged old history (%s)',async mode=>{
  const f=await fixture(),provider=await inspectionCycleProvider({holdFresh:true,holdOld:true,again:mode==='again'});let app=f.app;
  let repeated:{request:RecoveryRequest;receipt:RecoveryReceipt}|undefined;
  try{
    const {entry}=await seedExecutionReport(app,f.a,provider),profileId=(await app.models.list()).selectedId!;
    const started=await app.dispatch('loop.chat',{id:entry.id,message:data.oldGoal,options:{permission:'execute',turnTimeoutMs:30000}}) as {taskId:string;runId:string};
    const identity={workspaceId:entry.id,rootSessionId:started.taskId},graph=async()=>await app.dispatch('dispatch.graphSnapshot',{identity}) as GraphSnapshot,scopes=()=>inspectionScopes(f.user,entry.id);
    await vi.waitFor(()=>expect(provider.memberRequests).toHaveLength(3),{timeout:30000,interval:30});
    await app.dispatch('loop.enqueue',{id:entry.id,taskId:started.taskId,message:'保留排队消息，不作为核实或重试授权',options:{permission:'read'}});provider.releaseOld();
    await vi.waitFor(async()=>{expect((await scopes())[0]).toMatchObject({status:'closed',outcome:'failed'});expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:30});
    const oldScope=(await scopes())[0],originalGraph=await graph(),oldTask=originalGraph.tasks[0],oldRun=oldTask.runIds[0],marker=path.join(f.a,data.marker),markerStat=await fs.stat(marker),queue=()=>app.dispatch('loop.queue',{id:entry.id,taskId:started.taskId}),queued=await queue();expect(queued).toHaveLength(1);expect(queued[0].status).toBe('paused');
    expect(await fs.readFile(marker,'utf8')).toBe(data.markerLine);expect(provider.mainRequests).toHaveLength(6);expect(provider.memberRequests).toHaveLength(3);
    const query={...identity,taskId:oldTask.taskId,runId:oldRun},verified=await app.dispatch('dispatch.executionReport',query);expect(verified.log.state).toBe('verified');
    const corrupt=await corruptInspectionHistory(f.user,entry.id,started.taskId,oldTask.taskId,oldRun);
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    const beforeView=await app.dispatch('loop.threadView',{id:entry.id,taskId:started.taskId});expect(beforeView.runs).toEqual([]);expect(beforeView.issues).toHaveLength(corrupt.oldIds.length);expect(beforeView.resumeRunId).toBeUndefined();
    const report=await app.dispatch('dispatch.executionReport',query);expect(report.log.state).toBe('invalid');expect(report.execution).toBe('unknown');
    const req:RecoveryRequest={...identity,commandId:randomUUID(),source:{scopeId:oldScope.scopeId,taskId:oldTask.taskId,runId:oldRun,reportBasis:report.basis.key},operation:'inspect_effects',observation:{text:data.observation},input:{message:data.newGoal},options:{provider:'cbim-'+profileId,model:'report-fixture',profileId,permission:'read',turnTimeoutMs:30000}};
    const lookup={...identity,commandId:req.commandId};expect(await app.dispatch('loop.recoveryReceipt',lookup)).toBeUndefined();
    await expect(app.dispatch('loop.recoveryStart',{...req,source:{...req.source,reportBasis:verified.basis.key}})).rejects.toMatchObject({code:'RECOVERY_REPORT_STALE'});
    await expect(app.dispatch('loop.recoveryStart',{...req,options:{...req.options,permission:'execute'}} as any)).rejects.toThrow();
    expect(await scopes()).toEqual([oldScope]);expect(provider.mainRequests).toHaveLength(6);
    const [receipt,duplicate]=await Promise.all([app.dispatch('loop.recoveryStart',req),app.dispatch('loop.recoveryStart',req)]) as RecoveryReceipt[];
    expect(duplicate.recovery).toEqual(receipt.recovery);expect(receipt).toMatchObject({...identity,scopeId:req.commandId,scopeStatus:'active',recovery:{recoveryId:req.commandId,input:req.input,observation:req.observation,options:req.options,source:{...req.source,logState:'invalid',reportExecution:'unknown'}}});expect(JSON.stringify(receipt)).not.toContain('excludedRunIds');
    await vi.waitFor(()=>expect(provider.mainRequests).toHaveLength(7),{timeout:20000,interval:30});
    expect((await scopes())[0]).toEqual(oldScope);const fresh=(await scopes())[1];expect(fresh.goal?.input).toEqual({message:data.newGoal,attachmentIds:[]});expect(fresh.recovery?.context.excludedRunIds.sort()).toEqual(corrupt.oldIds.sort());expect((await graph()).root.agent).toEqual(originalGraph.root.agent);
    expect((await app.dispatch('loop.recoveryStart',req)).recovery).toEqual(receipt.recovery);expect((await app.dispatch('loop.recoveryReceipt',lookup)).recovery).toEqual(receipt.recovery);
    await expect(app.dispatch('loop.recoveryStart',{...req,input:{message:'changed'}})).rejects.toMatchObject({code:'RECOVERY_COMMAND_CONFLICT'});
    await expect(app.dispatch('loop.recoveryStart',{...req,commandId:randomUUID()})).rejects.toMatchObject({code:'RECOVERY_BUSY'});
    if(mode==='stop'||mode==='again'){
      await app.dispatch('loop.stop',{id:entry.id,taskId:started.taskId});
      await vi.waitFor(async()=>{expect((await scopes())[1]).toMatchObject({status:'closed',outcome:'cancelled'});expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:20000,interval:30});
      expect(provider.memberRequests).toHaveLength(3);expect((await graph()).tasks).toEqual(originalGraph.tasks);
      if(mode==='again'){
        const firstClosed=(await scopes())[1],closedReceipt=await app.dispatch('loop.recoveryReceipt',lookup) as RecoveryReceipt;
        expect(closedReceipt.scopeStatus).toBe('closed');expect(closedReceipt.recovery).toEqual(receipt.recovery);
        const firstLog=path.join(f.user,entry.id,'loop-engine','tasks',started.taskId,receipt.recovery.runId,'events.jsonl'),firstBytes=await fs.readFile(firstLog,'utf8');
        const freshReport=await app.dispatch('dispatch.executionReport',query),next:RecoveryRequest={...req,commandId:randomUUID(),source:{...req.source,reportBasis:freshReport.basis.key}};
        provider.releaseFresh();const nextReceipt=await app.dispatch('loop.recoveryStart',next) as RecoveryReceipt;repeated={request:next,receipt:nextReceipt};
        expect(nextReceipt.scopeId).not.toBe(receipt.scopeId);expect(nextReceipt.recovery.runId).not.toBe(receipt.recovery.runId);expect('kind' in nextReceipt.recovery.source).toBe(false);if('kind' in nextReceipt.recovery.source)throw Error('旧请求不可自动升级来源协议');expect(nextReceipt.recovery.source.taskId).toBe(oldTask.taskId);
        await vi.waitFor(async()=>{expect((await scopes())[2]).toMatchObject({status:'closed',outcome:'completed'});expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:30});
        const second=(await scopes())[2],after=await graph(),newTask=after.tasks.find(task=>task.scopeId===second.scopeId)!;
        expect((await scopes()).slice(0,2)).toEqual([oldScope,firstClosed]);expect(await fs.readFile(firstLog,'utf8')).toBe(firstBytes);expect(after.root.agent).toEqual(originalGraph.root.agent);
        expect(second.recovery!.context.nativeSessionId).not.toBe(fresh.recovery!.context.nativeSessionId);expect(second.recovery!.context.excludedRunIds.sort()).toEqual([...corrupt.oldIds,receipt.recovery.runId].sort());expect(newTask.assignee.agentInstanceId).not.toBe(oldTask.assignee.agentInstanceId);
        expect((await app.dispatch('loop.recoveryStart',req)).recovery).toEqual(receipt.recovery);expect((await app.dispatch('loop.recoveryStart',next)).recovery).toEqual(nextReceipt.recovery);expect((await app.dispatch('loop.recoveryReceipt',{...identity,commandId:next.commandId})).recovery).toEqual(nextReceipt.recovery);
        expect(provider.mainRequests).toHaveLength(13);expect(provider.memberRequests).toHaveLength(8);
        const view=await app.dispatch('loop.threadView',{id:entry.id,taskId:started.taskId}) as ConversationThreadView;expect(view.runs).toHaveLength(3);expect(view.issues).toHaveLength(corrupt.oldIds.length);expect(view.runs.filter(run=>run.events[0].data.freshMain)).toHaveLength(2);
      }
    }else{
      provider.releaseFresh();
      await vi.waitFor(async()=>{expect((await scopes())[1]).toMatchObject({status:'closed',outcome:'completed'});expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:30});
      expect(provider.mainRequests).toHaveLength(12);expect(provider.memberRequests).toHaveLength(8);
      const after=await graph(),task=after.tasks.find(t=>t.scopeId===fresh.scopeId)!;expect(task).toBeDefined();expect(task.assignee.agentInstanceId).not.toBe(oldTask.assignee.agentInstanceId);expect(task.assignee.agentSessionId).not.toBe(oldTask.assignee.agentSessionId);expect(task.assignee.agentId).toBe(oldTask.assignee.agentId);expect(after.tasks.find(t=>t.taskId===oldTask.taskId)).toEqual(oldTask);
      const view=await app.dispatch('loop.threadView',{id:entry.id,taskId:started.taskId}) as ConversationThreadView;expect(view.runs).toHaveLength(2);expect(view.issues.map(item=>item.runId).sort()).toEqual(corrupt.oldIds.sort());expect(view.resumeRunId).toBe(view.runs[1].runId);
      const initial=view.runs.find(run=>run.runId===receipt.recovery.runId)!;expect(initial.events[0].data.freshMain).toEqual({nativeSessionId:fresh.recovery!.context.nativeSessionId,excludedRunIds:fresh.recovery!.context.excludedRunIds});expect(initial.conversationBinding?.agentInstanceId).toBe(originalGraph.root.agent.agentInstanceId);expect(initial.source).toBeUndefined();expect(view.runs[1].source?.kind).toBe('member-results');
      // A later malformed current-epoch record cannot silently fall back to its earlier readable sibling.
      const latest=path.join(f.user,entry.id,'loop-engine','tasks',started.taskId,view.runs[1].runId,'events.jsonl'),bytes=await fs.readFile(latest,'utf8');await fs.appendFile(latest,'{"current_tail":');
      try{
        expect((await app.dispatch('loop.threadView',{id:entry.id,taskId:started.taskId})).resumeRunId).toBeUndefined();
        await expect(app.dispatch('loop.resume',{id:entry.id,taskId:started.taskId,runId:initial.runId,message:'不能回退到当前上下文早期的可读轮次',options:{permission:'read'}})).rejects.toThrow();
        expect(provider.mainRequests).toHaveLength(12);
      }finally{await fs.writeFile(latest,bytes)}
    }
    const finalScopes=await scopes(),counts=[provider.mainRequests.length,provider.memberRequests.length];await corrupt.unchanged();expect(await fs.readFile(marker,'utf8')).toBe(data.markerLine);expect((await fs.stat(marker)).mtimeMs).toBe(markerStat.mtimeMs);expect(provider.errors).toEqual([]);expect((await queue())[0]).toMatchObject({id:queued[0].id,message:queued[0].message,status:'paused'});
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect(await scopes()).toEqual(finalScopes);expect((await app.dispatch('loop.recoveryReceipt',lookup)).scopeStatus).toBe('closed');expect((await app.dispatch('loop.recoveryStart',req)).recovery).toEqual(receipt.recovery);expect([provider.mainRequests.length,provider.memberRequests.length]).toEqual(counts);expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);await corrupt.unchanged();
    if(repeated){expect((await app.dispatch('loop.recoveryReceipt',{...identity,commandId:repeated.request.commandId})).recovery).toEqual(repeated.receipt.recovery);expect((await app.dispatch('loop.recoveryStart',repeated.request)).recovery).toEqual(repeated.receipt.recovery);expect([provider.mainRequests.length,provider.memberRequests.length]).toEqual(counts)}
  }finally{provider.releaseOld();provider.releaseFresh();await app.shutdown();await f.cleanup();await provider.close()}
},120000);
