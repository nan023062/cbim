import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {humanServiceFixture} from './human-decision-service-fixture';
import {RunJournal} from '../src/backend/main/run-storage/run-journal';
import type {HumanDecisionKind,HumanDecisionPreviewInput} from '../src/logic/tasks/rules/human-decisions';
import type {HumanContinuationRequest} from '../src/logic/tasks/rules/human-continue';

type Fixture=Awaited<ReturnType<typeof humanServiceFixture>>;
export async function saveHumanOpinion(f:Fixture,input:HumanDecisionPreviewInput=f.input,decision:HumanDecisionKind='accept'){
  const preview=await f.service.humanDecisions.preview(input),request={...input,commandId:randomUUID(),expectedBasis:preview.basis!,expectedDecisionRevision:preview.decisionRevision,decision,comment:'明确核实当前成果后作出的意见'};
  return {preview,request,receipt:await f.service.humanDecisions.decide(request,f.actor)};
}
export async function reconsiderContinuation(f:Fixture,id:string):Promise<HumanContinuationRequest>{const scope=(await f.store.read()).scopes![0];return {...f.identity,scopeId:f.scopeId,waitId:scope.wait!.waitId,expectedGoalRevision:scope.goal!.revision,expectedInputRevision:scope.goal!.inputRevision??1,expectedDecisionRevision:scope.humanDecisions!.revision,commandId:randomUUID(),decisionIds:[id],options:{provider:'fixture',model:'fixture',profileId:randomUUID(),permission:'execute'}}}
/** 两次等待均由正式意见、接续、计划、审阅与 park 生成；不直接改 Store 快照或伪造等待身份。 */
export async function secondHumanWait(options:{complete?:boolean;replacement?:boolean}={}){
  const f=await humanServiceFixture(options.complete?{completeManifest:true,jsonValidation:true}:{});
  try{
    const first=await saveHumanOpinion(f,f.input,options.replacement?'reject':'accept'),request=await reconsiderContinuation(f,first.receipt.record.decisionId),runId='second-wait-main',accepted=await f.service.humanContinuations.accept(request,runId),original=await RunJournal.read(f.journal.directory),journal=new RunJournal(path.join(f.user,'second-wait-main-log'),original.task,runId);
    await journal.init();await journal.append({type:'run.started',data:{task:original.task,conversationBinding:original.conversationBinding,message:'按明确意见重新核实',resumeFrom:original.runId,source:{kind:'human_decisions',continuationId:request.commandId,scopeId:f.scopeId,waitId:request.waitId,inputRevision:request.expectedInputRevision+1,decisionRevision:request.expectedDecisionRevision,decisionIds:request.decisionIds}}});
    await journal.append({type:'session.bound',data:{sessionId:'human-main-native',sessionFile:original.sessionFile}});
    f.inspectMain.mockImplementation((_root,id)=>RunJournal.read(id===runId?journal.directory:f.journal.directory));
    const plan=accepted.scope.goal!.plan!,planned=await f.service.goals.plan(f.identity,f.scopeId,runId,'second-wait-plan',{expectedRevision:accepted.scope.goal!.revision,objective:plan.objective,constraints:plan.constraints,criteria:plan.criteria,assignments:plan.assignments.map(({agentId,moduleIds,criterionIds,reason,ownerSelection})=>({agentId,moduleIds,criterionIds,reason,ownerSelection})),reason:'仍需人对当前等待明确决定'});
    const old=(await f.service.snapshot(f.identity)).tasks[0];let candidate=old;
    if(options.replacement){
      await fs.writeFile(path.join(f.a,'replacement.txt'),'new candidate');const assigned=await f.service.dispatchTask({...f.identity,commandId:'replacement-assignment',expectedParentRevision:1,task:{assigneeAgentId:plan.assignments[0].agentId,moduleIds:plan.assignments[0].moduleIds,ownerSelection:plan.assignments[0].ownerSelection,goal:'replacement.txt',acceptance:[{id:'c1',text:'有真实读取'}]}},f.scopeId);
      await f.members.start({...f.identity,taskId:assigned.taskId,commandId:'replacement-start',expectedRevision:1,options:{permission:'execute'}});await f.members.waitForSettlement({...f.identity,taskId:assigned.taskId});candidate=(await f.service.snapshot(f.identity)).tasks.find(t=>t.taskId===assigned.taskId)!;
    }
    await f.service.goals.review(f.identity,f.scopeId,runId,'second-wait-review',{expectedRevision:planned.goal!.revision,decision:'awaiting_user',checks:[{criterionId:'c1',outcome:'needs_human',reason:'新等待需要新意见',evidence:[{kind:'member-result',taskId:candidate.taskId,runId:candidate.result!.runId,resultId:candidate.result!.resultId,planRevision:candidate.planRevision,toolCallIds:candidate.result!.evidenceRefs}]}],superseded:options.replacement?[{taskId:old.taskId,replacementTaskIds:[candidate.taskId],reason:'对拒绝成果返工',humanDecision:{decisionId:first.receipt.record.decisionId,continuationId:request.commandId}}]:[],gaps:['明确重新决定'],reason:'旧接受不自动继承'});
    await journal.append({type:'run.settled',data:{status:'completed'}});await f.service.parkScope(f.identity,f.scopeId,await RunJournal.read(journal.directory),[f.mainRunId,runId]);
    const input:HumanDecisionPreviewInput={...f.input,reconsidersDecisionId:first.receipt.record.decisionId},menu={...input,baselines:[],...(input.manifests?{manifests:[]}:{})};
    return {...f,first,input,menu,secondJournal:journal};
  }catch(error){await f.cleanup();throw error}
}
