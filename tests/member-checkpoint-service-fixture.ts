import {runtimeToolGroup} from './runtime-tool-group';
import fs from 'node:fs/promises';
import path from 'node:path';
import {expect,vi} from 'vitest';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import {jsonToolResult} from '../src/backend/core/tools/results';
import type {EngineContext,AgentEngine} from '../src/backend/core/execution/types';
import type {DispatchRun} from '../src/backend/core/tasks/dispatch-execution';
import {LoopRuntime} from '../src/backend/core/execution/runtime/runtime';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';
import {ArtifactFiles,normalizeArtifactPath} from '../src/backend/main/platform/files/artifact-files';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/dispatch/dispatch-service';
import {MemberExecutionManager,type MemberExecutionPorts} from '../src/backend/scheduler-engine/members/member-execution';
import {WorkspaceExecutionLease} from '../src/backend/scheduler-engine/admission/workspace-lease';
import {recheckDispatchExecutionContext} from '../src/backend/scheduler-engine/context/execution-context';
import {verifyMemberCheckpointProof,verifyMemberCheckpointInputs} from '../src/backend/scheduler-engine/members/member-checkpoint-verifier';
import {registerServiceOwner} from './owner-service-fixture';
import {memberCheckpointLimit} from '../src/backend/core/tasks/member-checkpoint';

export function gate(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve}}
export async function checkpointServiceFixture(options:{checkpointCount?:number;paths?:Array<string|string[]>;writeOnRun?:number}={}){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace);
  const snapshot=await workspace.snapshot(),moduleId=team.input.moduleId,definition=JSON.parse(snapshot.files.find(file=>file.path===moduleId+'/module.json')!.text);
  definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
  await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:moduleId+'/module.json',text:json(definition)}]));await fs.writeFile(path.join(f.a,'checkpoint.txt'),'captured bytes');
  const {model}=await registerServiceOwner(f.app,workspace,'.cbim/team/dev',[moduleId]);
  const store=workspace.dispatchStore,directory=store.directory,logs=path.join(f.user,'member-logs'),storage=new FileRunStorage(),lease=new WorkspaceExecutionLease(),files=new ArtifactFiles(f.a,()=>workspace.assert());
  const read=(run:DispatchRun)=>storage.read(path.join(logs,run.binding.taskId,run.binding.runId)),inspect=vi.fn(read),native=vi.fn(async()=>({byteLength:128,sha256:'a'.repeat(64)})),checkFiles=vi.fn(files.checkFiles.bind(files));
  const service=new WorkspaceDispatchService(workspace,store,{inspectMember:inspect,inspectMain:async()=>{throw Error('Fixture must not inspect main')},normalizeValidationPath:raw=>normalizeArtifactPath(f.a,raw)},undefined,undefined,f.app.models,{inspect,normalizePath:raw=>normalizeArtifactPath(f.a,raw)}),identity={workspaceId:entry.id,rootSessionId:'checkpoint-root'},scopeId='checkpoint-scope',mainRunId='main-one';
  await service.openScope(identity,scopeId,{message:'继续同一成员任务'},mainRunId);
  const ownerSelection=(await service.owners.discover([moduleId])).groups[0].selection!;
  await service.goals.plan(identity,scopeId,mainRunId,'plan',{expectedRevision:1,objective:'核实目标',constraints:[],criteria:[{id:'c1',text:'实际证据',kind:'evidence'}],assignments:[{agentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,criterionIds:['c1'],reason:'原执行者'}],reason:'派发'});
  for(const name of (options.paths??[]).flat())if(name!=='checkpoint.txt')await fs.writeFile(path.join(f.a,name),'captured '+name);
  let starts=0,beforeCreate=async()=>{},checkpointNewRuns=true;
  const prepare=vi.fn<()=>Awaited<ReturnType<MemberExecutionPorts['prepare']>>>(()=>({model,create:async(run,_task,hooks)=>{
    await beforeCreate();const checkpointState=await store.read(),previous=run.resumeFrom?checkpointState.runs!.find(old=>old.binding.runId===run.resumeFrom!.runId):undefined;
    let context!:EngineContext;const engine:AgentEngine={kind:'checkpoint-fixture',start:async c=>{starts++;context=c;await c.emit({type:'session.bound',data:{sessionId:c.nativeSessionId,sessionFile:c.sessionFile??path.join(logs,'native-'+c.nativeSessionId+'.jsonl')}})},stop:async()=>{},close:async()=>{},run:async()=>{
      let seq=0;const invoke=async(name:string,input:Record<string,unknown>)=>{const id='call-'+(++seq),decision=await context.beforeTool({name,id,input});expect(decision.allow).toBe(true);const result=name==='read'?jsonToolResult(name,{text:await fs.readFile(path.join(f.a,String(input.path)),'utf8')}):name==='write'?jsonToolResult(name,{written:await fs.writeFile(path.join(f.a,String(input.path)),String(input.content)).then(()=>true)}):name==='cbim_task_artifact_capture'?await runtimeToolGroup(context,'artifacts')!.call(name,input,id):name==='cbim_task_checkpoint'?await runtimeToolGroup(context,'member-checkpoint')!.call(name,input,id):await runtimeToolGroup(context,'task-progress')!.call(name,input);await context.emit({type:'tool.finished',data:{name,id,result,isError:false}});return {id,body:JSON.parse(result.content[0].text)}};
      const index=_task.runIds.length-1,paths=[options.paths?.[index]??'checkpoint.txt'].flat(),file=paths[0];let version=1;
      if(!run.resumeFrom)await invoke('cbim_task_plan',{expectedVersion:0,goal:context.task.goal,acceptance:context.task.acceptance,reason:'执行',steps:[{id:'check',title:'核实',owner:'当前成员'}]});
      else{const progress=(await invoke('cbim_task_inspect',{})).body;expect(progress.evidence).toEqual([]);version=progress.plan.version}
      const sources:string[]=[];if(options.writeOnRun===index)sources.push((await invoke('write',{path:file,content:'legitimate new bytes'})).id);
      const reads=[];for(const name of paths){const read=await invoke('read',{path:name});sources.push(read.id);reads.push(read)}const read=reads.at(-1)!;
      if(options.writeOnRun===index)version=(await invoke('cbim_task_inspect',{})).body.plan.version;
      if(index>=memberCheckpointLimit)expect(runtimeToolGroup(context,'member-checkpoint')).toBeUndefined();
      if(checkpointNewRuns&&index<(options.checkpointCount??1)){const baseline=await invoke('cbim_task_artifact_capture',{expectedTaskProgressVersion:version,sourceToolCallIds:sources});await invoke('cbim_task_checkpoint',{expectedTaskProgressVersion:version,baselineId:baseline.body.baseline.baselineId,reason:'保存第 '+(index+1)+' 段等待主调度'})}
      else{await invoke('cbim_task_step',{expectedVersion:version,id:'check',state:'reported_done',evidenceIds:[read.id]});await invoke('cbim_delivery_prepare',{expectedVersion:version+1,summary:'新轮实际核实',limitations:[]})}return {status:'completed'};
    }};
    const checkpointPorts={inspect,normalizePath:(raw:string)=>normalizeArtifactPath(f.a,raw),checkFiles,nativeFingerprint:native};
    return new LoopRuntime({memberCheckpointAllowance:memberCheckpointLimit-(_task.checkpoints?.length??0),storage,directory:logs,createEngine:()=>engine,acquireLease:async()=>()=>{},onEvent:hooks.onEvent,onEngineReady:hooks.onEngineReady,artifacts:{knowledgeRevision:run.prepared.knowledgeRevision,normalizePath:raw=>normalizeArtifactPath(f.a,raw),assertCurrentKnowledge:()=>recheckDispatchExecutionContext(workspace,run.prepared),captureFiles:(paths,signal)=>files.captureFiles(paths,signal)},assertMemberResume:previous?async()=>{await verifyMemberCheckpointProof(workspace,_task,previous,checkpointPorts,()=>{},previous.checkpointProof,checkpointState.runs)}:undefined,assertMemberResumeInputs:previous?()=>verifyMemberCheckpointInputs(workspace,_task,previous,checkpointPorts,()=>{},previous.checkpointProof!,checkpointState.runs):undefined,toolPolicy:async call=>({allow:true,effects:[call.name==='read'?'read':call.name==='write'?'business-write':'maintenance'],scope:{kind:'workspace',workspaceId:entry.id}})});
  }}));
  const ports:MemberExecutionPorts={acquire:(key,permission,agent)=>lease.acquire(key,permission,agent),prepare:async()=>prepare(),owners:service.owners,withEngineConfiguration:(reference,_options,use)=>f.app.models.withRuntimeConfiguration(reference,configuration=>use({model:configuration.profile,prepare})),inspect,artifacts:{normalizePath:raw=>normalizeArtifactPath(f.a,raw),checkFiles,acquireRead:()=>()=>{}},checkpoints:{nativeFingerprint:native}};
  const members=new MemberExecutionManager(workspace,store,ports);await members.initialize();
  const assigned=await service.dispatchTask({...identity,commandId:'assign',expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,goal:'核实原文件',acceptance:[{id:'c1',text:'新轮真实证据'}]}},scopeId);
  const taskId=assigned.taskId;
  await members.start({...identity,taskId,commandId:'start',expectedRevision:1,options:{permission:options.writeOnRun===undefined?'read':'execute'}});await members.waitForSettlement({...identity,taskId});
  const graph=await service.snapshot(identity),task=graph.tasks.find(t=>t.taskId===taskId)!;expect(task.status).toBe('checkpointed');
  const input={expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:2,taskId,expectedRevision:task.revision,checkpointId:task.checkpoints![0].checkpointId,reason:'继续原任务'};
  const reserve=(commandId='resume-one',assertCurrent=()=>{})=>members.requestResume(identity,scopeId,mainRunId,commandId,input,assertCurrent);
  const wait={scopeId,isCurrent:()=>true,onReady:()=>{},registerWithdraw:()=>{}};
  const resume=async()=>{const graph=await service.snapshot(identity),task=graph.tasks.find(t=>t.taskId===taskId)!;return members.resume({...identity,taskId,commandId:'claim-resume',expectedRevision:task.revision,options:{permission:'execute'}},wait)};
  return {...f,entry,workspace,directory,logs,store,storage,lease,files,service,members,identity,scopeId,mainRunId,taskId,input,task,read,inspect,native,checkFiles,model,prepare,ports,reserve,resume,wait,setCreateGate:(value:()=>Promise<void>)=>{beforeCreate=value},finishNewTasks:()=>{checkpointNewRuns=false},get starts(){return starts},cleanup:async()=>{await members.close();await store.close();await f.cleanup()}};
}
