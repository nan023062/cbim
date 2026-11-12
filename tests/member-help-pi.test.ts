import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {memberHelpProvider,memberHelpFixture as data} from './member-help-provider';
import {seedMemberHelp,memberHelpRecords} from './member-help-fixture';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import {WorkspaceExecutionLease} from '../src/backend/scheduler-engine/admission/workspace-lease';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import type {MemberExecutionView} from '../src/backend/core/tasks/member-commands';

it.each(['complete','waiting','stop','unknown-log'] as const)('hands member help to the coordinator only after safe normal settlement (%s)',async mode=>{
  const f=await fixture(),provider=await memberHelpProvider({waiting:mode==='waiting',holdHelp:true,effectful:mode==='complete',unknownHelp:mode==='unknown-log'});let app=f.app;
  const held=new Set<string>(),leases:{kind:'acquire'|'release';key:string;instance?:string}[]=[],originalAcquire=WorkspaceExecutionLease.prototype.acquire;
  const leaseSpy=vi.spyOn(WorkspaceExecutionLease.prototype,'acquire').mockImplementation(function(this:WorkspaceExecutionLease,...args:Parameters<typeof originalAcquire>){const release=originalAcquire.apply(this,args);held.add(args[0]);leases.push({kind:'acquire',key:args[0],instance:args[2]});return ()=>{release();held.delete(args[0]);leases.push({kind:'release',key:args[0],instance:args[2]})}});
  try{
    const {entry}=await seedMemberHelp(app,f.a,provider),started=await app.dispatch('loop.chat',{id:entry.id,message:data.mainGoal,options:{permission:mode==='complete'?'execute':'read',turnTimeoutMs:30000}}) as {taskId:string;runId:string};
    const identity={workspaceId:entry.id,rootSessionId:started.taskId},records=()=>memberHelpRecords(f.user,entry.id),graph=()=>app.dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>;
    await vi.waitFor(()=>expect(provider.memberRequests).toHaveLength(4),{timeout:25000,interval:30});
    const before=await graph(),original=before.tasks[0],taskIdentity={...identity,taskId:original.taskId},runId=original.runIds[0],log=path.join(f.user,entry.id,'dispatch','runs','tasks',original.taskId,runId,'events.jsonl'),marker=path.join(f.a,data.marker),markerStat=mode==='complete'?await fs.stat(marker):undefined;
    expect(original.status).toBe('running');expect(original.help).toBeUndefined();expect(original.result).toBeUndefined();expect((await records()).messages.filter(message=>message.kind==='help')).toEqual([]);expect(provider.mainRequests).toHaveLength(3);expect(held.size).toBe(1);
    const stagedEvents=(await fs.readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect(stagedEvents.some(event=>event.type==='task.help_requested')).toBe(true);expect(stagedEvents.some(event=>event.type==='run.completed')).toBe(false);
    if(mode==='stop')await app.dispatch('loop.stop',{id:entry.id,taskId:started.taskId});
    else{if(mode==='unknown-log')await fs.appendFile(log,'{"isolated_test_incomplete_help_tail":');provider.releaseHelp()}
    await vi.waitFor(async()=>{expect((await records()).scopes[0].status).toBe(mode==='waiting'?'waiting':'closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);expect(held.size).toBe(0)},{timeout:30000,interval:30});
    const settled=await records(),scope=settled.scopes[0],finishedGraph=await graph(),first=finishedGraph.tasks.find(task=>task.taskId===original.taskId)!,view=await app.dispatch('dispatch.executionInspect',taskIdentity) as MemberExecutionView;
    expect(scope.goal?.input).toEqual({message:data.mainGoal,attachmentIds:[]});expect(finishedGraph.root.agent).toEqual(before.root.agent);
    if(mode==='stop'||mode==='unknown-log'){
      expect(scope.outcome).toBe(mode==='stop'?'cancelled':'failed');expect(first.help).toBeUndefined();expect(first.result).toBeUndefined();expect(settled.messages.filter(message=>message.kind==='help')).toEqual([]);expect(finishedGraph.tasks).toHaveLength(1);expect(provider.mainRequests).toHaveLength(mode==='stop'?3:6);expect(provider.memberRequests).toHaveLength(4);
      if(mode==='stop')expect(view.runs[0].status).toBe('cancelled');else{const report=await app.dispatch('dispatch.executionReport',{...taskIdentity,runId});expect(report.execution).toBe('unknown');expect(['invalid','incomplete']).toContain(report.log.state)}
    }else{
      expect(first).toMatchObject({status:'blocked',help:{toolCallId:'help-request',binding:{...identity,taskId:original.taskId,runId},input:{kind:'missing_input',reason:data.reason,question:data.question,attemptedToolCallIds:mode==='complete'?['help-original-effect','help-read-source']:['help-read-source']}}});expect(first.result).toBeUndefined();expect(first.activeRunId).toBeUndefined();expect(view.runs[0].status).toBe('completed');
      expect(first.help!.requestedSeq).toBeLessThan(first.help!.finishedSeq);expect(first.help!.lastEffectSeq).toBeLessThan(first.help!.requestedSeq);
      const helpMessages=settled.messages.filter(message=>message.kind==='help');expect(helpMessages).toHaveLength(1);expect(helpMessages[0]).toMatchObject({helpId:first.help!.helpId,runId,taskId:first.taskId,delivery:'processed',to:before.root.agent});
      const thread=await app.execution(entry.id).thread(started.taskId);expect(thread[1].source).toMatchObject({kind:'member-results',messageIds:[helpMessages[0].messageId],taskIds:[first.taskId]});expect(thread.every(run=>run.status==='completed')).toBe(true);
      const releasedAt=leases.findIndex(event=>event.kind==='release'&&event.instance===original.assignee.agentInstanceId),nextMain=leases.findIndex((event,index)=>index>releasedAt&&event.kind==='acquire'&&event.instance===before.root.agent.agentInstanceId);expect(releasedAt).toBeGreaterThan(-1);expect(nextMain).toBeGreaterThan(releasedAt);
      if(mode==='waiting'){
        expect(scope.wait).toBeDefined();expect(scope.goal?.review?.decision).toBe('awaiting_user');expect(finishedGraph.tasks).toHaveLength(1);expect(provider.mainRequests).toHaveLength(6);expect(provider.memberRequests).toHaveLength(4);
        await app.dispatch('loop.enqueue',{id:entry.id,taskId:started.taskId,message:'同意',options:{permission:'read'}});await expect(app.dispatch('loop.queueContinue',{id:entry.id,taskId:started.taskId})).rejects.toThrow();expect((await records()).scopes).toEqual([scope]);expect(provider.mainRequests).toHaveLength(6);
      }else{
        expect(scope.outcome).toBe('completed');expect(scope.goal?.plan?.revision).toBe(3);expect(finishedGraph.tasks).toHaveLength(2);const replacement=finishedGraph.tasks.find(task=>task.taskId!==first.taskId)!;
        expect(replacement.status).toBe('result_ready');expect(replacement.assignee.agentInstanceId).not.toBe(first.assignee.agentInstanceId);expect(replacement.assignee.agentSessionId).not.toBe(first.assignee.agentSessionId);expect(replacement.result?.evidenceRefs).toEqual(['replacement-source','replacement-supplement']);expect(scope.goal?.review?.superseded).toEqual([{taskId:first.taskId,replacementTaskIds:[replacement.taskId],reason:expect.any(String)}]);expect(provider.mainRequests).toHaveLength(10);expect(provider.memberRequests).toHaveLength(10);
      }
    }
    expect(await fs.readFile(path.join(f.a,data.source),'utf8')).toBe(data.sourceText);expect(await fs.readFile(path.join(f.a,data.supplement),'utf8')).toBe(data.supplementText);expect(provider.errors).toEqual([]);
    const counts=[provider.mainRequests.length,provider.memberRequests.length],snapshot=await records();await app.shutdown();expect(held.size).toBe(0);app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect(await records()).toEqual(snapshot);expect(await graph()).toEqual(finishedGraph);expect([provider.mainRequests.length,provider.memberRequests.length]).toEqual(counts);expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);if(markerStat){expect(await fs.readFile(marker,'utf8')).toBe(data.markerText);expect((await fs.stat(marker)).mtimeMs).toBe(markerStat.mtimeMs)}
    if(mode==='waiting'){await app.dispatch('loop.stop',{id:entry.id,taskId:started.taskId});expect((await records()).scopes[0]).toMatchObject({status:'closed',outcome:'cancelled',wait:scope.wait});expect((await graph()).tasks[0].help).toEqual(first.help);expect([provider.mainRequests.length,provider.memberRequests.length]).toEqual(counts)}
  }finally{provider.releaseHelp();await app.shutdown();leaseSpy.mockRestore();await f.cleanup();await provider.close()}
},120000);
