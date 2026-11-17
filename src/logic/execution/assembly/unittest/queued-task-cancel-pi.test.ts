import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../../application/unittest/support/helpers';
import {queuedTaskCancelProvider,queuedTaskCancelFixture as data} from '../../../tasks/runtime/unittest/support/queued-task-cancel-provider';
import {seedQueuedTaskCancel,queuedTaskCancelRecords} from '../../../tasks/runtime/unittest/support/queued-task-cancel-fixture';
import {Application} from '../../../../bridge/server/application';
import {Paths} from '../../../workspace/service/paths';
import {FileRunStorage} from '../../storage/run-storage';
import {globalRuntimeLogBytes} from '../../../runtime/monitoring/unittest/support/global-runtime-fixture';
import type {PendingQuestion} from '../../../tools/rules/questions';

it.each(['complete','stop','cancel-not-success'] as const)('preserves sequential Agent cancellation and immutable history (%s)',async mode=>{
  const f=await fixture(),provider=await queuedTaskCancelProvider(mode);let app=f.app;
  try{
    const {entry}=await seedQueuedTaskCancel(app,f.a,provider),options={permission:'read' as const,turnTimeoutMs:30000};
    const started=await app.Dispatch('loop.chat',{id:entry.id,message:data.mainGoal,options});
    const identity={workspaceId:entry.id,rootSessionId:started.taskId};
    const records=()=>queuedTaskCancelRecords(f.user,entry.id);
    const questions=()=>app.Dispatch('loop.questions',{id:entry.id,taskId:started.taskId}) as Promise<PendingQuestion[]>;
    const root=()=>app.Execution(entry.id).Inspect(started.taskId,started.runId);
    const until=async(check:()=>Promise<void>|void)=>vi.waitFor(async()=>{expect(provider.errors).toEqual([]);await check()},{timeout:30000,interval:40});
    if(mode!=='cancel-not-success'){
      await until(async()=>expect(await questions()).toHaveLength(1));
      expect([...provider.children.keys()]).toEqual(['CHAIN_CHILD_0_OLD']);
      expect(provider.memberRequests).toHaveLength(1);
      const waiting=await root(),question=(await questions())[0];
      expect(waiting.events.some(event=>event.type==='tool.updated'&&event.data.agentCallState==='waiting')).toBe(true);
      expect(question.questions[0].question).toBe(data.question);
      // A awaits the original answer; B/C have neither an engine nor a fictitious cancelled graph node.
      expect((await app.Dispatch('dispatch.graphSnapshot',{identity})).tasks).toEqual([]);
      if(mode==='stop'){
        await app.Dispatch('loop.stop',{id:entry.id,taskId:started.taskId});
        await expect(app.Dispatch('loop.answerQuestion',{id:entry.id,taskId:started.taskId,questionId:question.id,answers:[{option:0,other:''}]})).rejects.toThrow();
      }else{
        await app.Dispatch('loop.answerQuestion',{id:entry.id,taskId:started.taskId,questionId:question.id,answers:[{option:0,other:''}]});
        await expect(app.Dispatch('loop.answerQuestion',{id:entry.id,taskId:started.taskId,questionId:question.id,answers:[{option:0,other:''}]})).rejects.toThrow();
      }
    }
    await until(async()=>{
      expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0);
      expect((await records()).scopes.every(scope=>scope.status==='closed')).toBe(true);
      expect((await root()).status).toBe(mode==='complete'?'completed':mode==='stop'?'cancelled':'interrupted');
    });
    const original=await root(),saved=await records(),storage=new FileRunStorage();
    const refs=new Map<string,{taskId:string;runId:string;callerTaskId:string;callerRunId:string;toolCallId:string}>();
    for(const event of original.events)if(event.type==='tool.updated'&&event.data.agentCall){
      const ref=event.data.agentCall as {taskId:string;runId:string;callerTaskId:string;callerRunId:string;toolCallId:string};refs.set(ref.toolCallId,ref);
    }
    expect([...refs.keys()]).toEqual(mode==='complete'?['old-0','old-1','old-2']:['old-0']);
    for(const [id,ref] of refs){
      expect(ref).toMatchObject({callerTaskId:started.taskId,callerRunId:started.runId,toolCallId:id});
      const child=await storage.Read(path.join(f.user,entry.id,'loop-engine','tasks',ref.taskId,ref.runId));
      expect(child.events.filter(event=>event.type==='run.started')).toHaveLength(1);
      expect(child.status).toBe(mode==='complete'?'completed':'cancelled');
      if(mode==='complete')expect(child.toolReceipts?.find(receipt=>receipt.toolName==='read')?.outcome).toBe('succeeded');
      else expect(child.toolReceipts?.some(receipt=>receipt.toolName==='read')).not.toBe(true);
    }
    expect(saved.scopes).toHaveLength(1);
    expect(saved.scopes[0].outcome).toBe(mode==='complete'?'completed':mode==='stop'?'cancelled':'interrupted');
    expect((await app.Dispatch('dispatch.graphSnapshot',{identity})).tasks).toEqual([]);
    expect(await questions()).toEqual([]);
    const counts=[provider.mainRequests.length,provider.memberRequests.length],bytes=await globalRuntimeLogBytes(f.user,entry.id);
    await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init();
    expect(await records()).toEqual(saved);expect(await globalRuntimeLogBytes(f.user,entry.id)).toEqual(bytes);
    expect([provider.mainRequests.length,provider.memberRequests.length]).toEqual(counts);
    if(mode!=='complete'){
      const next=await app.Dispatch('loop.resume',{id:entry.id,taskId:started.taskId,runId:started.runId,message:data.freshGoal,options});
      expect(next.runId).not.toBe(started.runId);
      await until(async()=>{expect((await records()).scopes).toHaveLength(2);expect((await records()).scopes.every(scope=>scope.status==='closed')).toBe(true)});
      expect((await app.Execution(entry.id).Inspect(started.taskId,next.runId)).status).toBe('completed');
      expect([...provider.children.keys()]).toEqual(['CHAIN_CHILD_0_OLD','CHAIN_CHILD_0_NEW','CHAIN_CHILD_1_NEW','CHAIN_CHILD_2_NEW']);
      expect((await records()).scopes[0]).toEqual(saved.scopes[0]);expect(await root()).toEqual(original);
      const finalBytes=await globalRuntimeLogBytes(f.user,entry.id);
      for(const [file,content] of Object.entries(bytes)){
        // Explicit resume appends to the same native conversation; canonical old run and child logs remain immutable.
        if(original.sessionFile&&path.resolve(f.user,entry.id,file)===path.resolve(original.sessionFile))expect(finalBytes[file].startsWith(content)).toBe(true);
        else expect(finalBytes[file]).toBe(content);
      }
    }
    for(let index=0;index<data.files.length;index++)expect(await fs.readFile(path.join(f.a,data.files[index]),'utf8')).toBe(data.facts[index]);
    expect(provider.errors).toEqual([]);
  }finally{await app.Shutdown();await provider.close();await f.cleanup()}
},120000);
