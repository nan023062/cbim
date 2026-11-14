import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {humanServiceFixture} from './human-decision-service-fixture';
import {checkpointServiceFixture} from './member-checkpoint-service-fixture';
import {RunJournal} from '../src/logic/execution/storage/run-journal';
import type {HumanContinuationRequest} from '../src/logic/tasks/rules/human-continue';

it('人工来源不能把默认任务当作显式首项的候选，拒绝不改原等待和历史',async()=>{
  const f=await humanServiceFixture();try{
    const before=await f.store.read(),state=structuredClone(before),scope=state.scopes![0],task=state.graphs[0].tasks[0];
    scope.goal!.plan!.assignments[0].workflowSelections=task.modules.map(module=>({moduleId:module.moduleId,workflowId:module.workflow.id}));
    await expect(f.service.goals.validateHumanCandidates(state,scope,'c1')).rejects.toMatchObject({code:'HUMAN_SOURCE_INVALID'});
    expect(await f.store.read()).toEqual(before);expect(task.workflowSelections).toBeUndefined();
  }finally{await f.cleanup()}
});

it('真实人工接续后改为显式Workflow，新审阅既不能复用旧默认候选，也不能沿用旧接受',async()=>{
  const f=await humanServiceFixture();try{
    const preview=await f.preview(),saved=await f.service.humanDecisions.decide({...f.input,commandId:randomUUID(),expectedBasis:preview.basis!,expectedDecisionRevision:preview.decisionRevision,decision:'accept',comment:'明确接受旧默认流程结果'},f.actor),waiting=(await f.store.read()).scopes![0];
    const request:HumanContinuationRequest={...f.identity,scopeId:f.scopeId,waitId:waiting.wait!.waitId,expectedGoalRevision:waiting.goal!.revision,expectedInputRevision:waiting.goal!.inputRevision??1,expectedDecisionRevision:waiting.humanDecisions!.revision,commandId:randomUUID(),decisionIds:[saved.record.decisionId],options:{provider:'fixture',model:'fixture',profileId:randomUUID(),permission:'read'}};
    const runId='selection-human-main',accepted=await f.service.humanContinuations.accept(request,runId),old=await RunJournal.read(f.journal.directory),journal=new RunJournal(path.join(f.user,'selection-human-main-log'),old.task,runId);
    await journal.init();await journal.append({type:'run.started',data:{task:old.task,conversationBinding:old.conversationBinding,message:'可信人工决定系统转交',resumeFrom:old.runId,source:{kind:'human_decisions',continuationId:request.commandId,scopeId:f.scopeId,waitId:request.waitId,inputRevision:request.expectedInputRevision+1,decisionRevision:request.expectedDecisionRevision,decisionIds:request.decisionIds}}});await journal.append({type:'session.bound',data:{sessionId:'human-main-native',sessionFile:old.sessionFile}});
    f.inspectMain.mockImplementation((_root,id)=>RunJournal.read(id===runId?journal.directory:f.journal.directory));
    const plan=accepted.scope.goal!.plan!,task=(await f.service.snapshot(f.identity)).tasks[0],workflowSelections=task.modules.map(module=>({moduleId:module.moduleId,workflowId:module.workflow.id}));
    const planned=await f.service.goals.plan(f.identity,f.scopeId,runId,'select-in-new-plan',{expectedRevision:accepted.scope.goal!.revision,objective:plan.objective,constraints:plan.constraints,criteria:plan.criteria,assignments:plan.assignments.map(({agentId,moduleIds,criterionIds,reason,ownerSelection})=>({agentId,moduleIds,criterionIds,reason,ownerSelection,workflowSelections})),reason:'明确采用专属流程'}),before=await f.store.read();
    await expect(f.service.goals.review(f.identity,f.scopeId,runId,'old-candidate',{expectedRevision:planned.goal!.revision,decision:'awaiting_user',checks:[{criterionId:'c1',outcome:'needs_human',reason:'不能跨流程使用候选',evidence:[{kind:'member-result',taskId:task.taskId,runId:task.result!.runId,resultId:task.result!.resultId,planRevision:task.planRevision,toolCallIds:task.result!.evidenceRefs}]}],superseded:[],gaps:['等待新结果'],reason:'核对来源'})).rejects.toMatchObject({code:'GOAL_EVIDENCE_IDENTITY'});
    await expect(f.service.goals.review(f.identity,f.scopeId,runId,'old-accept',{expectedRevision:planned.goal!.revision,decision:'complete',checks:[{criterionId:'c1',outcome:'satisfied',reason:'不能跨流程借接受',evidence:[{kind:'human-decision',decisionId:saved.record.decisionId,continuationId:request.commandId}]}],superseded:[],gaps:[],reason:'核对来源'})).rejects.toMatchObject({code:'GOAL_HUMAN_SUBJECT_CHANGED'});
    expect(await f.store.read()).toEqual(before);expect((await f.service.snapshot(f.identity)).tasks[0]).toEqual(task);expect(f.starts).toBe(1);
  }finally{await f.cleanup()}
});

it('检查点预约使用最新目标版本也不能从旧默认改成显式首项，不产生新信封或run',async()=>{
  const f=await checkpointServiceFixture();try{
    const old=(await f.store.read()).scopes![0].goal!.plan!,workflowSelections=f.task.modules.map(module=>({moduleId:module.moduleId,workflowId:module.workflow.id}));
    const changed=await f.service.goals.plan(f.identity,f.scopeId,f.mainRunId,'checkpoint-select-workflow',{expectedRevision:2,objective:old.objective,constraints:old.constraints,criteria:old.criteria,assignments:old.assignments.map(({agentId,moduleIds,criterionIds,reason,ownerSelection})=>({agentId,moduleIds,criterionIds,reason,ownerSelection,workflowSelections})),reason:'明确不同的流程选择模式'}),before=await f.store.read();
    await expect(f.members.requestResume(f.identity,f.scopeId,f.mainRunId,'changed-selection-resume',{...f.input,expectedGoalRevision:changed.goal!.revision},()=>{})).rejects.toMatchObject({code:'MEMBER_RESUME_STALE'});
    expect(await f.store.read()).toEqual(before);expect(f.starts).toBe(1);expect(before.graphs[0].tasks[0].checkpoints).toEqual(f.task.checkpoints);
  }finally{await f.cleanup()}
});
