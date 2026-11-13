import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {checkpointServiceFixture} from './member-checkpoint-service-fixture';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/dispatch/dispatch-service';
import {RunJournal} from '../src/backend/main/run-storage/run-journal';
import {normalizeArtifactPath} from '../src/backend/main/platform/files/artifact-files';
import type {TaskSpec} from '../src/logic/execution/rules/types';
import type {MemberPause} from '../src/logic/tasks/rules/member-pause';
import type {GoalReviewInput} from '../src/logic/tasks/rules/scope-goal';
import type {GoalContinuationRequest} from '../src/logic/tasks/rules/scope-continuation';

/** Real Store, runtime, canonical logs and files; only the unit fixture native fingerprint is synthetic. */
export async function memberPauseServiceFixture(){
  const f=await checkpointServiceFixture(),journals=new Map<string,RunJournal>();let reads=0;
  const ports={inspect:f.inspect,normalizePath:(raw:string)=>normalizeArtifactPath(f.a,raw),checkFiles:f.checkFiles,nativeFingerprint:f.native,acquireRead:()=>{reads++;const release=f.lease.acquire('pause-'+randomUUID(),'read');return()=>{reads--;release()}},assertCurrent:()=>f.workspace.assert()};
  const service=new WorkspaceDispatchService(f.workspace,f.store,{inspectMember:f.inspect,inspectMain:async(_root,run)=>RunJournal.read(journals.get(run)!.directory),normalizeValidationPath:ports.normalizePath,checkValidationFiles:f.checkFiles},undefined,undefined,f.app.models,ports,undefined,ports);
  const main:TaskSpec={mode:'chat',workspaceId:f.entry.id,taskId:f.identity.rootSessionId,root:f.a,goal:'保留检查点等待明确继续',agentId:'cbim:main',moduleIds:[],acceptance:[]},binding=await service.conversationBinding(main);
  const journal=async(runId:string)=>{const j=new RunJournal(path.join(f.user,'pause-main',runId),main,runId);await j.init();await j.append({type:'run.started',data:{task:main,conversationBinding:binding,message:'明确保留原任务'}});journals.set(runId,j);return j};
  const first=await journal(f.mainRunId),scope=await service.goals.inspect(f.identity,f.scopeId),moduleId=f.task.modules[0].moduleId,ownerSelection=(await service.owners.discover([moduleId])).groups[0].selection!;
  const graph=await service.snapshot(f.identity),b=await service.dispatchTask({...f.identity,commandId:'pause-b',expectedParentRevision:graph.root.revision,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,goal:'等待A真实新候选',acceptance:[{id:'c1',text:'真实读取'}],prerequisites:[{taskId:f.taskId,expectedPlanRevision:f.task.planRevision}]}},f.scopeId);
  const current=await service.snapshot(f.identity),pause:MemberPause={version:1,expectedGraphCursor:{streamId:current.cursor.streamId,seq:current.cursor.seq},tasks:current.tasks.map(task=>({taskId:task.taskId,expectedRevision:task.revision,expectedPlanRevision:task.planRevision,...(task.checkpoints?{kind:'checkpoint' as const,checkpointId:task.checkpoints[0].checkpointId}:{kind:'unstarted' as const})}))};
  const review:GoalReviewInput={expectedRevision:scope.goal!.revision,decision:'awaiting_user',checks:[{criterionId:'c1',outcome:'unmet',reason:'检查点和后继尚未完成',evidence:[]}],superseded:[],gaps:['用户明确继续后再核实执行'],reason:'保留原成员检查点和后继，等待用户继续',memberPause:pause};
  const park=async()=>{await service.goals.review(f.identity,f.scopeId,f.mainRunId,'pause-review',review);await first.append({type:'run.settled',data:{status:'completed'}});return service.parkScope(f.identity,f.scopeId,await RunJournal.read(first.directory),[f.mainRunId])};
  const input=async():Promise<GoalContinuationRequest>=>{const scope=await service.goals.inspect(f.identity,f.scopeId);return {...f.identity,scopeId:f.scopeId,waitId:scope.wait!.waitId,expectedGoalRevision:scope.goal!.revision,expectedInputRevision:scope.goal!.inputRevision??1,commandId:randomUUID(),input:{message:'继续保留的原任务；沿原文件再次核实'},options:{provider:'fixture',model:f.model.model,profileId:f.model.id,permission:'execute'}}};
  return {...f,service,ports,journal,first,scope,b,pause,review,park,input,readCount:()=>reads};
}
