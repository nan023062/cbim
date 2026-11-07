import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import type {HumanContinuationRequest} from '../src/backend/core/tasks/human-continue';
import type {HumanDecisionKind,HumanDecisionPreview} from '../src/backend/core/tasks/human-decisions';
import type {GoalReviewInput} from '../src/backend/core/tasks/scope-goal';
import {RunJournal} from '../src/backend/main/persistence/tasks/run-journal';
import {humanServiceFixture} from './human-decision-service-fixture';

type Fixture=Awaited<ReturnType<typeof humanServiceFixture>>;
function decide(f:Fixture,preview:HumanDecisionPreview,decision:HumanDecisionKind){return f.service.humanDecisions.decide({...f.input,commandId:randomUUID(),expectedBasis:preview.basis!,expectedDecisionRevision:preview.decisionRevision,decision,comment:'根据实际文件明确决定'},f.actor)}
async function continuation(f:Fixture,id:string):Promise<HumanContinuationRequest>{const scope=(await f.store.read()).scopes![0];return {...f.identity,scopeId:f.scopeId,waitId:scope.wait!.waitId,expectedGoalRevision:scope.goal!.revision,expectedInputRevision:scope.goal!.inputRevision??1,expectedDecisionRevision:scope.humanDecisions!.revision,commandId:randomUUID(),decisionIds:[id],options:{provider:'fixture',model:'fixture',profileId:randomUUID(),permission:'execute'}}}
async function chooseNote(f:Fixture){const menu=await f.service.humanDecisions.preview({...f.input,baselines:[]});f.input.baselines[0].baselineId=menu.candidates[0].baselines[1].baselineId}

it.each(['reject','request_evidence'] as const)('JSON 当前变化或缺失仍可保存 %s 并显式继续，不能借负面记录接受原成果',async kind=>{
  const f=await humanServiceFixture({jsonValidation:true});try{
    const original=await f.preview();expect(original.allowedDecisions).toContain('accept');const before=await f.store.read(),runs=before.runs,starts=f.starts;
    if(kind==='reject')await fs.writeFile(path.join(f.a,'human-0.txt'),'{"count":2}');else await fs.unlink(path.join(f.a,'human-0.txt'));
    const preview=await f.preview();expect(preview.basis).toBeTruthy();expect(preview.allowedDecisions).toEqual(['reject','request_evidence']);expect(preview.candidates[0].selected!.files[0].state).toBe(kind==='reject'?'changed':'missing');
    await expect(decide(f,preview,'accept')).rejects.toMatchObject({code:'HUMAN_DECISION_UNAVAILABLE'});expect(await f.store.read()).toEqual(before);
    const saved=await decide(f,preview,kind),request=await continuation(f,saved.record.decisionId);expect((await f.service.humanContinuations.preflight(request)).message).toContain(saved.record.decisionId);
    const accepted=await f.service.humanContinuations.accept(request,'negative-main');expect(accepted.continuation.decisionIds).toEqual([saved.record.decisionId]);expect(accepted.scope.goal!.input).toEqual(before.scopes![0].goal!.input);expect((await f.store.read()).runs).toEqual(runs);expect(f.starts).toBe(starts);
    const state=await f.store.read(),source=state.graphs[0].tasks[0];await expect(f.service.goals.validateMemberCandidate(state,accepted.scope,state.graphs[0],source,saved.record.proof.source.knowledgeRevision)).rejects.toMatchObject({code:'GOAL_WORKFLOW_UNMET'});
  }finally{await f.cleanup()}
});

it('只选未变的其它基线也必须核全部 JSON 要求，保存接受和正面继续都不能绕过变化',async()=>{
  const f=await humanServiceFixture({jsonValidation:true});try{
    await chooseNote(f);f.checkFiles.mockClear();const original=await f.preview();expect(original.allowedDecisions).toContain('accept');expect(f.checkFiles).toHaveBeenCalledTimes(1);expect(f.checkFiles.mock.calls[0][0].map(file=>file.relativePath).sort()).toEqual(['human-0.txt','human-note.txt']);
    const saved=await decide(f,original,'accept'),request=await continuation(f,saved.record.decisionId),before=await f.store.read();await fs.writeFile(path.join(f.a,'human-0.txt'),'{"count":2}');
    const changed=await f.preview();expect(changed.candidates[0].selected!.files.every(file=>file.state==='matches')).toBe(true);expect(changed.allowedDecisions).toEqual(['reject','request_evidence']);expect(changed.issues.some(issue=>issue.code==='HUMAN_WORKFLOW_UNAVAILABLE')).toBe(true);
    await expect(decide(f,changed,'accept')).rejects.toMatchObject({code:'HUMAN_DECISION_UNAVAILABLE'});f.checkFiles.mockClear();await expect(f.service.humanContinuations.accept(request,'positive-main')).rejects.toMatchObject({code:'HUMAN_CONTINUATION_STALE'});expect(f.checkFiles).toHaveBeenCalledTimes(1);expect(f.checkFiles.mock.calls[0][0]).toHaveLength(2);expect(await f.store.read()).toEqual(before);
  }finally{await f.cleanup()}
});

it('人工接受已消费后，新审阅和最终完成仍复核未选入基线的 JSON 文件',async()=>{
  const f=await humanServiceFixture({jsonValidation:true});try{
    await chooseNote(f);const saved=await decide(f,await f.preview(),'accept'),request=await continuation(f,saved.record.decisionId),runId='accepted-main',accepted=await f.service.humanContinuations.accept(request,runId),old=await RunJournal.read(f.journal.directory),journal=new RunJournal(path.join(f.user,'json-human-continued'),old.task,runId);
    await journal.init();await journal.append({type:'run.started',data:{task:old.task,conversationBinding:old.conversationBinding,message:'可信人工意见',resumeFrom:old.runId,source:{kind:'human_decisions',continuationId:request.commandId,scopeId:f.scopeId,waitId:request.waitId,inputRevision:request.expectedInputRevision+1,decisionRevision:request.expectedDecisionRevision,decisionIds:request.decisionIds}}});await journal.append({type:'session.bound',data:{sessionId:'human-main-native',sessionFile:old.sessionFile}});
    f.inspectMain.mockImplementation((_root,id)=>RunJournal.read(id===runId?journal.directory:f.journal.directory));const plan=accepted.scope.goal!.plan!;
    const planned=await f.service.goals.plan(f.identity,f.scopeId,runId,'new-plan',{expectedRevision:accepted.scope.goal!.revision,objective:plan.objective,constraints:plan.constraints,criteria:plan.criteria,assignments:plan.assignments.map(({agentId,moduleIds,criterionIds,reason,ownerSelection})=>({agentId,moduleIds,criterionIds,reason,ownerSelection})),reason:'按保存接受复核'}),draft:GoalReviewInput={expectedRevision:planned.goal!.revision,decision:'complete',checks:[{criterionId:'c1',outcome:'satisfied',reason:'明确接受',evidence:[{kind:'human-decision',decisionId:saved.record.decisionId,continuationId:request.commandId}]}],superseded:[],gaps:[],reason:'保留原主体'};
    const file=path.join(f.a,'human-0.txt');await fs.writeFile(file,'{"count":2}');const before=await f.store.read();await expect(f.service.goals.review(f.identity,f.scopeId,runId,'changed-json',draft)).rejects.toMatchObject({code:'GOAL_HUMAN_STALE'});expect(await f.store.read()).toEqual(before);
    await fs.writeFile(file,'{"count":1}');await f.service.goals.review(f.identity,f.scopeId,runId,'matching-json',draft);await journal.append({type:'run.settled',data:{status:'completed'}});const reviewed=await f.store.read();await fs.unlink(file);
    await expect(f.service.closeScope(f.identity,f.scopeId,'completed',await RunJournal.read(journal.directory))).rejects.toMatchObject({code:'GOAL_HUMAN_STALE'});expect(await f.store.read()).toEqual(reviewed);
  }finally{await f.cleanup()}
});

it('JSON 要求与选择合并超限仅禁接受；无选择零读取，负面路径仍不容许坏 canonical',async()=>{
  const f=await humanServiceFixture({jsonValidation:true,validationFiles:16});try{
    await chooseNote(f);f.checkFiles.mockClear();const preview=await f.preview();expect(preview.allowedDecisions).toEqual(['reject','request_evidence']);expect(preview.issues.some(issue=>issue.code==='HUMAN_WORKFLOW_UNAVAILABLE')).toBe(true);expect(f.checkFiles).toHaveBeenCalledTimes(1);expect(f.checkFiles.mock.calls[0][0].map(file=>file.relativePath)).toEqual(['human-note.txt']);
    expect((await decide(f,preview,'reject')).record.decision).toBe('reject');
    f.input.baselines=[];f.checkFiles.mockClear();const unselected=await f.preview();expect(unselected.allowedDecisions).toEqual(['reject','request_evidence']);expect(f.checkFiles).not.toHaveBeenCalled();const saved=await decide(f,unselected,'request_evidence'),request=await continuation(f,saved.record.decisionId);expect(f.checkFiles).not.toHaveBeenCalled();
    f.inspect.mockImplementation(async run=>{const summary=await f.read(run);summary.logIntegrity=undefined;return summary});const before=await f.store.read();expect((await f.preview()).allowedDecisions).toEqual([]);await expect(f.service.humanContinuations.accept(request,'bad-history')).rejects.toMatchObject({code:'GOAL_WORKFLOW_UNMET'});expect(await f.store.read()).toEqual(before);
  }finally{await f.cleanup()}
});
