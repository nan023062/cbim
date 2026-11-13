import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
import {fixture} from './helpers';
import {WorkspaceExecutionManager,type ExecutionCollaboration} from '../src/backend/scheduler-engine/conversation/execution-manager';
import type {WorkspaceLoopOptions} from '../src/backend/scheduler-engine/assembly/loop-engine';
import type {ExecutionLaunchContext} from '../src/backend/scheduler-engine/admission/admission-wait';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/dispatch/dispatch-service';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';
import {ChatInputs} from '../src/backend/main/materials/chat-inputs';
import {LoopRuntime} from '../src/logic/execution/rules/runtime/runtime';
import type {AgentEngine,TaskSpec} from '../src/logic/execution/rules/types';
import type {GoalContinuationRequest} from '../src/logic/tasks/rules/scope-continuation';
import {hash,json} from '../src/core/platform/node/serialization';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64');
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {promise,resolve}};
async function setup(){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),store=new FileDispatchStore(path.join(f.user,'attachments-dispatch'),entry.id),storage=new FileRunStorage(),inputs=new ChatInputs(workspace);
  let manager!:WorkspaceExecutionManager,leases=0;
  const dispatch=new WorkspaceDispatchService(workspace,store,{inspectMain:(root,run)=>manager.inspect(root,run),inspectMember:async()=>{throw Error('没有成员')}}),settled=vi.fn(),runs:{finish:()=>void;message?:string;launch:ExecutionLaunchContext;options:WorkspaceLoopOptions}[]=[];
  const factory=vi.fn(async(options:WorkspaceLoopOptions,task:TaskSpec,launch:ExecutionLaunchContext)=>{
    const completion=deferred(),record:{finish:()=>void;message?:string;launch:ExecutionLaunchContext;options:WorkspaceLoopOptions}={finish:completion.resolve,launch,options};runs.push(record);
    const engine:AgentEngine={kind:'controlled',start:async context=>{await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId??task.taskId,sessionFile:context.sessionFile??path.join(f.user,'attachment-native.jsonl')}})},run:async message=>{record.message=message;await completion.promise;return {status:'completed'}},stop:async()=>completion.resolve(),close:async()=>{}};
    return {runtime:new LoopRuntime({directory:path.join(workspace.paths.project(entry.id),'loop-engine','tasks'),storage,conversationBinding:await dispatch.conversationBinding(task),acquireLease:async()=>{launch.signal.throwIfAborted();leases++;return()=>{leases--}},toolPolicy:async()=>({allow:false}),createEngine:()=>engine,onEvent:options.onEvent})} as unknown as Awaited<ReturnType<ConstructorParameters<typeof WorkspaceExecutionManager>[2]>>;
  });
  const prepare=vi.fn((input:GoalContinuationRequest['input'],signal:AbortSignal)=>inputs.prepareContinuation(input.message,input.attachmentIds,signal));
  manager=new WorkspaceExecutionManager(workspace,storage,factory,undefined,prepare);
  const accept=vi.fn<NonNullable<ExecutionCollaboration['acceptContinuation']>>(async(request,_task,runId,trusted)=>{await dispatch.continuations.accept(request,runId,trusted)});
  manager.attachCollaboration({busy:()=>false,stop:async()=>{},settled,continuationReceipt:query=>dispatch.continuations.inspect(query),continuationCheckpoint:async request=>{const scope=await dispatch.goals.inspect({workspaceId:request.workspaceId,rootSessionId:request.rootSessionId},request.scopeId);if(!scope.wait)throw Error('没有等待');return scope.wait},acceptContinuation:accept});
  const options={provider:'fixture',model:'fixture',profileId:randomUUID(),permission:'ask' as const},initial=await manager.chat('原始目标', {...options,allowNativeExecution:true}),identity={workspaceId:entry.id,rootSessionId:initial.taskId},scopeId='attachment-scope';
  await dispatch.openScope(identity,scopeId,{message:'原始目标'},initial.runId);
  await dispatch.goals.plan(identity,scopeId,initial.runId,'plan',{expectedRevision:1,objective:'明确目标',constraints:[],criteria:[{id:'human',text:'需用户补充',kind:'human'}],assignments:[{agentId:'cbim:main',moduleIds:[],criterionIds:['human'],reason:'澄清'}],reason:'等待'});
  await dispatch.goals.review(identity,scopeId,initial.runId,'review',{expectedRevision:2,decision:'awaiting_user',checks:[{criterionId:'human',outcome:'needs_human',reason:'补充资料',evidence:[]}],superseded:[],gaps:['资料'],reason:'等待资料'});
  runs[0].finish();await vi.waitFor(()=>expect(settled).toHaveBeenCalledTimes(1));
  const parked=await dispatch.parkScope(identity,scopeId,await manager.inspect(initial.taskId,initial.runId),[initial.runId]);
  const file=path.join(f.a,'note.txt'),image=path.join(f.a,'pixel.png');await fs.writeFile(file,'ATTACHED_TEXT');await fs.writeFile(image,png);const attachments=[await inputs.path('file',file),await inputs.path('file',image)];
  const request:GoalContinuationRequest={...identity,scopeId,waitId:parked.wait!.waitId,expectedGoalRevision:parked.goal!.revision,expectedInputRevision:1,commandId:randomUUID(),input:{message:'请结合资料继续',attachmentIds:attachments.map(item=>item.id)},options};
  return {...f,entry,workspace,store,dispatch,manager,inputs,prepare,factory,accept,runs,settled,initial,request,attachments,get leases(){return leases},cleanup:async()=>{await manager.close();await dispatch.close();await f.cleanup()}};
}

it('同一准备的正文图片和清单沿原主会话受理，原命令查询在快照删除后仍不重新准备或启动',async()=>{
  const f=await setup();try{
    const original=structuredClone(f.request),receipt=await f.manager.continueGoal(f.request);await vi.waitFor(()=>expect(f.runs[1].message).toContain('ATTACHED_TEXT'));
    expect(receipt.continuation.input).toEqual(original.input);expect(receipt.continuation.attachmentManifest!.items.map(item=>item.attachmentId)).toEqual(original.input.attachmentIds);expect(f.runs[1].launch.preparedInputImages).toEqual([{type:'image',mimeType:'image/png',data:png.toString('base64')}]);expect(f.runs[1].options).not.toHaveProperty('attachmentIds');expect(f.prepare).toHaveBeenCalledTimes(1);expect(f.accept).toHaveBeenCalledTimes(1);
    const summary=await f.manager.inspect(f.initial.taskId,receipt.continuation.runId);expect(summary.source).toMatchObject({kind:'user-continuation',attachmentManifestHash:hash(json(receipt.continuation.attachmentManifest))});expect(summary.events[0].data.message).toBe(f.runs[1].message);expect(summary.task.goal).toBe('原始目标');
    for(const attachment of f.attachments)await fs.unlink(path.join(f.workspace.paths.project(f.entry.id),'chat-inputs',attachment.id+'.json'));
    expect(await f.manager.continueGoal(original)).toEqual(receipt);expect(f.prepare).toHaveBeenCalledTimes(1);expect(f.factory).toHaveBeenCalledTimes(2);
    await expect(f.manager.continueGoal({...original,input:{...original.input,attachmentIds:[...original.input.attachmentIds!].reverse()}})).rejects.toMatchObject({code:'CONTINUATION_CONFLICT'});
    f.runs[1].finish();await vi.waitFor(()=>expect(f.settled).toHaveBeenCalledTimes(2));
    await f.manager.continueFromResults(f.initial.taskId,'真实成员结果', {...original.options,allowNativeExecution:true},{kind:'member-results',continuationId:'member-result',messageIds:['result'],taskIds:['member']});
    expect(f.runs[2].launch.preparedInputImages).toBeUndefined();expect(f.runs[2].options).not.toHaveProperty('attachmentIds');expect(f.prepare).toHaveBeenCalledTimes(1);
  }finally{await f.cleanup()}
});

it('附件准备等待期间停止，不进入工厂或消费waiting，不把取消误报附件预受理错误',async()=>{
  const f=await setup(),entered=deferred(),release=deferred();try{
    const before=await f.store.read(),real=f.inputs.prepareContinuation.bind(f.inputs);f.prepare.mockImplementationOnce(async(input,signal)=>{entered.resolve();await release.promise;return real(input.message,input.attachmentIds,signal)});
    const attempt=f.manager.continueGoal(f.request),rejected=expect(attempt).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});await entered.promise;const stopping=f.manager.stop(f.initial.taskId);release.resolve();await rejected;await stopping;
    expect(await f.store.read()).toEqual(before);expect(f.factory).toHaveBeenCalledTimes(1);expect(f.accept).not.toHaveBeenCalled();expect(f.leases).toBe(0);
  }finally{release.resolve();await f.cleanup()}
});

it('首次缺失快照不消费，已提交后回复失败查询原receipt且只受理一次',async()=>{
  const f=await setup();try{
    const before=await f.store.read();await expect(f.manager.continueGoal({...f.request,input:{...f.request.input,attachmentIds:[randomUUID()]}})).rejects.toMatchObject({code:'GOAL_ATTACHMENT_MISSING'});expect(await f.store.read()).toEqual(before);expect(f.factory).toHaveBeenCalledTimes(1);
    f.accept.mockImplementationOnce(async(request,_task,runId,trusted)=>{await f.dispatch.continuations.accept(request,runId,trusted);throw Error('测试模拟：提交后的回复丢失')});
    const receipt=await f.manager.continueGoal(f.request);expect(receipt.continuation.input).toEqual(f.request.input);expect(f.accept).toHaveBeenCalledTimes(1);expect((await f.store.read()).scopes![0].continuations).toHaveLength(1);
    expect(await f.manager.continueGoal(f.request)).toEqual(receipt);expect(f.accept).toHaveBeenCalledTimes(1);expect(f.factory).toHaveBeenCalledTimes(2);expect(f.leases).toBe(0);
  }finally{await f.cleanup()}
});
