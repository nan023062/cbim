import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {GraphSnapshot,GraphDelta} from '../src/backend/core/tasks/graph-types';
import type {AddQueuedDependencyReceipt} from '../src/backend/core/tasks/queued-dependency-addition';
import type {DispatchMessage} from '../src/backend/core/dispatch/dispatch-storage';
import {dependencyAdditionProvider,dependencyAdditionData as data} from './queued-dependency-addition-provider';
import {seedDependencyAddition,additionRecords,additionWait,assertDependencyAddition,additionRunBytes,additionRunByteEvidence} from './queued-dependency-addition-fixture';

it.each(['complete','prepare-stop','submitted-stop','reply-lost'] as const)('adds a real late prerequisite without recreating queued tasks or replaying submission (%s)',async mode=>{
  const f=await fixture(),provider=await dependencyAdditionProvider({lostReply:mode==='reply-lost'});let app=f.app,restore=()=>{},release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve),arrived=new Promise<void>(resolve=>entered=resolve);let insideAddition=false,held=false,committed:AddQueuedDependencyReceipt|undefined,originalAssignments:DispatchMessage[]|undefined;
  try{
    const {entry,workspace}=await seedDependencyAddition(app,f.a,provider),service=app.memberDispatch(entry.id),original=service.addQueuedDependency.bind(service);let originalArgs:Parameters<typeof original>|undefined,invocations=0;
    const serviceSpy=vi.spyOn(service,'addQueuedDependency').mockImplementation(async(...args)=>{invocations++;originalArgs=args;originalAssignments=(await additionRecords(f.user,entry.id)).messages.filter(message=>message.kind==='assignment');insideAddition=true;try{const receipt=await original(...args);committed=receipt;if(mode==='reply-lost'&&invocations===1)throw Error('TEST_ADDITION_REPLY_LOST_AFTER_REAL_COMMIT');return receipt}finally{insideAddition=false}});
    const read=workspace.read.bind(workspace),readSpy=vi.spyOn(workspace,'read').mockImplementation(async(...args)=>{const result=await read(...args);if(mode==='prepare-stop'&&insideAddition&&!held){held=true;entered();await gate}return result});restore=()=>{serviceSpy.mockRestore();readSpy.mockRestore()};
    const start=await app.dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:'read',turnTimeoutMs:60000}}),identity={workspaceId:entry.id,rootSessionId:start.taskId},graph=()=>app.dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>,records=()=>additionRecords(f.user,entry.id);
    if(mode==='prepare-stop'){
      await arrived;expect(provider.state.before).toBeDefined();expect(provider.member).toHaveLength(0);const stopping=app.dispatch('loop.stop',{id:entry.id,taskId:start.taskId});await new Promise(resolve=>setTimeout(resolve,30));release();await stopping;provider.releaseMain();
    }else{
      await additionWait(async()=>provider.main.length===provider.heldTurn+1&&!!committed,'真实追加提交后保持主轮');expect(provider.errors).toEqual([]);expect(provider.member).toHaveLength(0);
      const receipt=committed!,before=provider.state.before!,saved=await graph(),nodes=assertDependencyAddition(saved,before,receipt,false),savedRecords=await records();expect(savedRecords.runs).toEqual([]);expect(savedRecords.scopes[0].status).toBe('active');
      expect(nodes.b.revision).toBe(before.tasks.find(task=>task.taskId===nodes.b.taskId)!.revision+1);expect(nodes.a).toEqual(before.tasks.find(task=>task.taskId===nodes.a.taskId));expect(nodes.c).toEqual(before.tasks.find(task=>task.taskId===nodes.c.taskId));
      expect(savedRecords.messages.filter(message=>message.kind==='assignment')).toHaveLength(3);expect(savedRecords.messages.filter(message=>message.kind==='assignment')).toEqual(originalAssignments);expect(new Set(receipt.trackedTaskIds).size).toBe(3);
      const delta=await app.dispatch('dispatch.graphDelta',{identity,cursor:before.cursor,limit:100}) as GraphDelta;expect(delta.mode).toBe('delta');if(delta.mode==='delta'){const batch=delta.batches.find(item=>item.commandId===receipt.commandId)!;expect(batch.cause).toBe('dependency.changed');expect(batch.changes).toContainEqual(expect.objectContaining({type:'edge.upserted',edge:expect.objectContaining({edgeId:receipt.addition.dependency.edgeId,enabled:true,condition:{kind:'result_ready',reviewRequired:true,planRevision:nodes.a.planRevision}})}))}
      // Same production entry and exact original command: real stored receipt, not a fabricated recovery response.
      restore();restore=()=>{};expect(await service.addQueuedDependency(...originalArgs!)).toEqual(receipt);expect(await graph()).toEqual(saved);expect(await records()).toEqual(savedRecords);
      const changed=[...originalArgs!] as Parameters<typeof original>;changed[4]={...changed[4],reason:'另一原因不能复用原命令'};await expect(service.addQueuedDependency(...changed)).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});expect(await graph()).toEqual(saved);expect(await records()).toEqual(savedRecords);expect(provider.member).toHaveLength(0);
      if(mode==='submitted-stop')await app.dispatch('loop.stop',{id:entry.id,taskId:start.taskId});provider.releaseMain();
    }
    await additionWait(async()=>(await records()).scopes[0].status==='closed'&&app.runtime.snapshot().pressure.activeRuns===0,'周期完成或停止并释放运行');restore();restore=()=>{};
    const finalRecords=await records(),scope=finalRecords.scopes[0],finished=await graph(),completed=mode==='complete'||mode==='reply-lost',before=provider.state.before!;expect(originalAssignments).toHaveLength(3);
    // Claim/consumption legitimately change delivery and claim; the original envelope identity and task reference do not.
    const finalAssignments=finalRecords.messages.filter(message=>message.kind==='assignment'),envelope=(message:DispatchMessage)=>{const {delivery,claim,...identity}=message;return identity};expect(finalAssignments.map(envelope)).toEqual(originalAssignments!.map(envelope));
    for(const message of finalAssignments){const run=finalRecords.runs.find(item=>item.assignmentMessageId===message.messageId);expect(message.delivery).toBe('processed');expect(message.claim).toEqual(run?{runId:run.binding.runId,leaseEpoch:run.binding.leaseEpoch}:undefined)}
    if(mode==='prepare-stop'){
      expect(scope.outcome).toBe('cancelled');expect(committed).toBeUndefined();expect(finalRecords.runs).toHaveLength(0);expect(finished.tasks.every(task=>!task.dependencyAdditions?.length&&task.runIds.length===0)).toBe(true);expect(finished.edges.filter(edge=>edge.kind==='dependency')).toEqual(before.edges.filter(edge=>edge.kind==='dependency'));expect(provider.main).toHaveLength(6);expect(provider.member).toHaveLength(0);
    }else{
      const nodes=assertDependencyAddition(finished,before,committed!,completed);expect(scope.goal?.input).toEqual({message:data.goal,attachmentIds:[]});
      if(completed){
        expect(scope.outcome).toBe('completed');expect(provider.main).toHaveLength(mode==='reply-lost'?17:16);expect(provider.member).toHaveLength(15);expect(finalRecords.runs.map(run=>run.binding.taskId)).toEqual([nodes.a.taskId,nodes.b.taskId,nodes.c.taskId]);
        const [aRun,bRun,cRun]=finalRecords.runs;expect(aRun.prerequisites).toEqual([]);expect(bRun.prerequisites).toEqual([{taskId:nodes.a.taskId,planRevision:nodes.a.planRevision,result:nodes.a.result}]);expect(cRun.prerequisites).toEqual([{taskId:nodes.b.taskId,planRevision:nodes.b.planRevision,result:nodes.b.result}]);
        for(const run of finalRecords.runs){const old=before.tasks.find(task=>task.taskId===run.binding.taskId)!;expect(run.binding.agentInstanceId).toBe(old.assignee.agentInstanceId);expect(run.binding.agentSessionId).toBe(old.assignee.agentSessionId)}
        const evidence=scope.goal?.review?.checks.flatMap(check=>check.evidence)??[];expect(evidence.every(item=>item.kind==='member-result')).toBe(true);expect(JSON.stringify(evidence)).not.toContain('addition-exact');
      }else{expect(scope.outcome).toBe('cancelled');expect(finalRecords.runs).toHaveLength(0);expect(provider.main).toHaveLength(7);expect(provider.member).toHaveLength(0)}
    }
    const thread=await app.execution(entry.id).thread(start.taskId),toolReceipt=thread[0].toolReceipts?.find(item=>item.toolCallId==='addition-exact');
    if(mode==='reply-lost'){expect(toolReceipt?.outcome).toBe('failed');expect(provider.state.recovered?.tasks.find(task=>task.goal===data.goals[1])?.dependencyAdditions).toEqual([committed!.addition])}
    else if(mode!=='prepare-stop')expect(toolReceipt?.outcome).toBe('succeeded');expect(provider.errors).toEqual([]);
    const runBytes=await additionRunBytes(f.user,entry.id,start.taskId,thread,finalRecords.runs),sequence=[...provider.sequence];await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await records()).toEqual(finalRecords);expect(await graph()).toEqual(finished);expect(await app.execution(entry.id).thread(start.taskId)).toEqual(thread);expect(await additionRunBytes(f.user,entry.id,start.taskId,await app.execution(entry.id).thread(start.taskId),finalRecords.runs)).toEqual(runBytes);expect(provider.sequence).toEqual(sequence);expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);
    for(let i=0;i<data.files.length;i++)expect(await fs.readFile(path.join(f.a,data.files[i]),'utf8')).toBe(data.facts[i]);await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/queued-dependency-addition-${mode}-pi-evidence.json`,JSON.stringify({mode,requests:{main:provider.main.length,member:provider.member.length},sequence,committed,scope,graph:finished,runs:finalRecords.runs,runBytes:additionRunByteEvidence(runBytes),toolReceipt,providerErrors:provider.errors,restartNoReplay:true},null,2));
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/queued-dependency-addition-${mode}-pi-failure.json`,JSON.stringify({error:String(error),main:provider.main,member:provider.member,sequence:provider.sequence,providerState:provider.state,providerErrors:provider.errors,committed,held},null,2));throw error}
  finally{release();restore();provider.releaseMain();await app.shutdown();await provider.close();await f.cleanup()}
},120000);
