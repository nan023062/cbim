import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {checkpointServiceFixture} from './member-checkpoint-service-fixture';
import {WorkspaceDispatchService} from '../src/logic/dispatch/runtime/dispatch-service';
import {RunJournal} from '../src/logic/execution/storage/run-journal';
import {normalizeArtifactPath} from '../src/logic/file-operations/platform/files/artifact-files';
import type {TaskSpec} from '../src/logic/execution/rules/types';
import type {MemberPause} from '../src/logic/tasks/rules/member-pause';
import type {GoalReviewInput} from '../src/logic/tasks/rules/scope-goal';
import type {GoalContinuationRequest} from '../src/logic/tasks/rules/scope-continuation';

/** Real Store, runtime, canonical logs and files; only the unit fixture native fingerprint is synthetic. */
export async function memberPauseServiceFixture(){
  const f=await checkpointServiceFixture(),journals=new Map<string,RunJournal>();let reads=0;
  const ports={Inspect:f.inspect,NormalizePath:(raw:string)=>normalizeArtifactPath(f.a,raw),CheckFiles:f.checkFiles,NativeFingerprint:f.native,AcquireRead:()=>{reads++;const release=f.lease.Acquire('pause-'+randomUUID(),'read');return()=>{reads--;release()}},AssertCurrent:()=>f.workspace.Assert()};
  const service=new WorkspaceDispatchService(f.workspace,f.store,{InspectMember:f.inspect,InspectMain:async(_root,run)=>RunJournal.Read(journals.get(run)!.directory),NormalizeValidationPath:ports.NormalizePath,CheckValidationFiles:f.checkFiles},undefined,undefined,f.app.engineModels,ports,undefined,ports);
  const main:TaskSpec={mode:'chat',workspaceId:f.entry.id,taskId:f.identity.rootSessionId,root:f.a,goal:'保留检查点等待明确继续',agentId:'cbim:main',moduleIds:[],acceptance:[]},binding=await service.ConversationBinding(main);
  const journal=async(runId:string)=>{const j=new RunJournal(path.join(f.user,'pause-main',runId),main,runId);await j.Init();await j.Append({type:'run.started',data:{task:main,conversationBinding:binding,message:'明确保留原任务'}});journals.set(runId,j);return j};
  const first=await journal(f.mainRunId),scope=await service.goals.Inspect(f.identity,f.scopeId),moduleId=f.task.modules[0].moduleId,ownerSelection=(await service.owners.Discover([moduleId])).groups[0].selection!;
  const graph=await service.Snapshot(f.identity),b=await service.DispatchTask({...f.identity,commandId:'pause-b',expectedParentRevision:graph.root.revision,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,goal:'等待A真实新候选',acceptance:[{id:'c1',text:'真实读取'}],prerequisites:[{taskId:f.taskId,expectedPlanRevision:f.task.planRevision}]}},f.scopeId);
  const current=await service.Snapshot(f.identity),pause:MemberPause={version:1,expectedGraphCursor:{streamId:current.cursor.streamId,seq:current.cursor.seq},tasks:current.tasks.map(task=>({taskId:task.taskId,expectedRevision:task.revision,expectedPlanRevision:task.planRevision,...(task.checkpoints?{kind:'checkpoint' as const,checkpointId:task.checkpoints[0].checkpointId}:{kind:'unstarted' as const})}))};
  const review:GoalReviewInput={expectedRevision:scope.goal!.revision,decision:'awaiting_user',checks:[{criterionId:'c1',outcome:'unmet',reason:'检查点和后继尚未完成',evidence:[]}],superseded:[],gaps:['用户明确继续后再核实执行'],reason:'保留原成员检查点和后继，等待用户继续',memberPause:pause};
  const park=async()=>{await service.goals.Review(f.identity,f.scopeId,f.mainRunId,'pause-review',review);await first.Append({type:'run.settled',data:{status:'completed'}});return service.ParkScope(f.identity,f.scopeId,await RunJournal.Read(first.directory),[f.mainRunId])};
  const input=async():Promise<GoalContinuationRequest>=>{const scope=await service.goals.Inspect(f.identity,f.scopeId);return {...f.identity,scopeId:f.scopeId,waitId:scope.wait!.waitId,expectedGoalRevision:scope.goal!.revision,expectedInputRevision:scope.goal!.inputRevision??1,commandId:randomUUID(),input:{message:'继续保留的原任务；沿原文件再次核实'},options:{provider:'fixture',model:f.model.model,profileId:f.model.id,permission:'execute'}}};
  return {...f,service,ports,journal,first,scope,b,pause,review,park,input,readCount:()=>reads};
}
