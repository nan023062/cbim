import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {humanServiceFixture} from './human-decision-service-fixture';
import type {HumanDecisionPreview,HumanDecisionKind} from '../src/logic/tasks/rules/human-decisions';
import type {HumanContinuationRequest} from '../src/logic/tasks/rules/human-continue';
import type {GoalReviewInput} from '../src/logic/tasks/rules/scope-goal';
import {RunJournal} from '../src/backend/main/run-storage/run-journal';
type Fixture=Awaited<ReturnType<typeof humanServiceFixture>>;
const create=()=>humanServiceFixture({completeManifest:true,jsonValidation:true});
const request=(f:Fixture,preview:HumanDecisionPreview,decision:HumanDecisionKind='accept')=>({...f.input,commandId:randomUUID(),expectedBasis:preview.basis!,expectedDecisionRevision:preview.decisionRevision,decision,comment:'明确核实完整声明集合'});
async function continuation(f:Fixture,id:string):Promise<HumanContinuationRequest>{const scope=(await f.store.read()).scopes![0];return {...f.identity,scopeId:f.scopeId,waitId:scope.wait!.waitId,expectedGoalRevision:scope.goal!.revision,expectedInputRevision:scope.goal!.inputRevision??1,expectedDecisionRevision:scope.humanDecisions!.revision,commandId:randomUUID(),decisionIds:[id],options:{provider:'fixture',model:'fixture',profileId:randomUUID(),permission:'execute'}}}

it('人工完整候选无选择零读取，只能选原交付清单；保存及重复命令保持完整身份',async()=>{
  const f=await create();try{
    f.checkFiles.mockClear();f.checkManifest.mockClear();const menu=await f.service.humanDecisions.preview({...f.input,manifests:[]});expect(menu.allowedDecisions).toEqual(['reject','request_evidence']);expect(menu.candidates[0].baselines).toEqual([]);expect(menu.candidates[0].manifest?.entryCount).toBe(4);expect(f.checkFiles).not.toHaveBeenCalled();expect(f.checkManifest).not.toHaveBeenCalled();
    const wrong=await f.service.humanDecisions.preview({...f.input,manifests:[{...f.input.manifests![0],manifestId:'other'}]});expect(wrong.allowedDecisions).toEqual([]);
    const baseline=await f.service.humanDecisions.preview({...f.input,manifests:[],baselines:[{taskId:f.input.manifests![0].taskId,runId:f.input.manifests![0].runId,baselineId:'another'}]});expect(baseline.allowedDecisions).toEqual([]);expect(f.checkManifest).not.toHaveBeenCalled();
    const preview=await f.preview();expect(preview.allowedDecisions).toContain('accept');expect(preview.candidates[0].selectedManifest).toMatchObject({state:'matches',manifest:{manifestId:f.input.manifests![0].manifestId}});expect(f.checkFiles).not.toHaveBeenCalled();expect(f.checkManifest).toHaveBeenCalledTimes(1);
    const args=request(f,preview),before=await f.store.read(),saved=await f.service.humanDecisions.decide(args,f.actor),reads=f.checkManifest.mock.calls.length;expect(saved.record.baselines).toEqual([]);expect(saved.record.manifests).toEqual(f.input.manifests);expect(await f.service.humanDecisions.decide(args,f.actor)).toEqual(saved);expect(f.checkManifest).toHaveBeenCalledTimes(reads);expect((await f.store.read()).runs).toEqual(before.runs);expect(f.starts).toBe(1);
  }finally{await f.cleanup()}
});
it('JSON和原文件未变但目录新增：自动审阅与人工接受均拒绝，负面意见仍可保存',async()=>{
  const f=await create();try{
    const original=await f.preview(),args=request(f,original),before=await f.store.read();await fs.writeFile(path.join(f.a,'human-output','extra.txt'),'not in original manifest');
    await expect(f.service.humanDecisions.decide(args,f.actor)).rejects.toMatchObject({code:'HUMAN_STALE'});expect(await f.store.read()).toEqual(before);
    const changed=await f.preview();expect(changed.candidates[0].selectedManifest?.state).toBe('changed');expect(changed.allowedDecisions).toEqual(['reject','request_evidence']);
    await expect(f.service.humanDecisions.decide(request(f,changed),f.actor)).rejects.toMatchObject({code:'HUMAN_DECISION_UNAVAILABLE'});
    const saved=await f.service.humanDecisions.decide(request(f,changed,'request_evidence'),f.actor);expect(saved.record.proof.candidates[0].selectedManifest?.state).toBe('changed');
    const scope=before.scopes![0],graph=before.graphs[0];await expect(f.service.goals.validateMemberCandidate(before,scope,graph,graph.tasks[0],saved.record.proof.source.knowledgeRevision)).rejects.toMatchObject({code:'GOAL_WORKFLOW_UNMET'});
    expect((await f.service.humanContinuations.preflight(await continuation(f,saved.record.decisionId))).message).toContain(saved.record.decisionId);expect(await fs.readFile(path.join(f.a,'human-0.txt'),'utf8')).toBe('{"count":1}');
  }finally{await f.cleanup()}
});
it('接受后新增文件阻止显式继续，保留原意见和未消费等待，恢复全集合后同请求可受理',async()=>{
  const f=await create();try{
    const saved=await f.service.humanDecisions.decide(request(f,await f.preview()),f.actor),args=await continuation(f,saved.record.decisionId),before=await f.store.read(),extra=path.join(f.a,'human-output','new.txt');await fs.writeFile(extra,'new');
    await expect(f.service.humanContinuations.accept(args,'human-complete-main')).rejects.toMatchObject({code:'HUMAN_CONTINUATION_STALE'});expect(await f.store.read()).toEqual(before);expect(f.starts).toBe(1);expect((await f.service.humanDecisions.inspect({...f.identity,scopeId:f.scopeId,commandId:saved.record.decisionId}))?.record).toEqual(saved.record);
    await fs.unlink(extra);expect((await f.service.humanContinuations.accept(args,'human-complete-main')).continuation.decisionIds).toEqual([saved.record.decisionId]);expect(f.starts).toBe(1);
  }finally{await f.cleanup()}
});
it('完整人工接受消费后，目标审阅与最终完成仍检查目录新增，不只重读 JSON',async()=>{
  const f=await create();try{
    const saved=await f.service.humanDecisions.decide(request(f,await f.preview()),f.actor),args=await continuation(f,saved.record.decisionId),runId='complete-accepted-main',accepted=await f.service.humanContinuations.accept(args,runId),old=await RunJournal.read(f.journal.directory),journal=new RunJournal(path.join(f.user,'complete-human-continued'),old.task,runId);
    await journal.init();await journal.append({type:'run.started',data:{task:old.task,conversationBinding:old.conversationBinding,message:'可信人工意见',resumeFrom:old.runId,source:{kind:'human_decisions',continuationId:args.commandId,scopeId:f.scopeId,waitId:args.waitId,inputRevision:args.expectedInputRevision+1,decisionRevision:args.expectedDecisionRevision,decisionIds:args.decisionIds}}});await journal.append({type:'session.bound',data:{sessionId:'human-main-native',sessionFile:old.sessionFile}});
    f.inspectMain.mockImplementation((_root,id)=>RunJournal.read(id===runId?journal.directory:f.journal.directory));const plan=accepted.scope.goal!.plan!;
    const planned=await f.service.goals.plan(f.identity,f.scopeId,runId,'new-plan',{expectedRevision:accepted.scope.goal!.revision,objective:plan.objective,constraints:plan.constraints,criteria:plan.criteria,assignments:plan.assignments.map(({agentId,moduleIds,criterionIds,reason,ownerSelection})=>({agentId,moduleIds,criterionIds,reason,ownerSelection})),reason:'按完整原接受复核'}),draft:GoalReviewInput={expectedRevision:planned.goal!.revision,decision:'complete',checks:[{criterionId:'c1',outcome:'satisfied',reason:'明确接受',evidence:[{kind:'human-decision',decisionId:saved.record.decisionId,continuationId:args.commandId}]}],superseded:[],gaps:[],reason:'同一完整集合'};
    const extra=path.join(f.a,'human-output','extra.txt');await fs.writeFile(extra,'extra');const before=await f.store.read();await expect(f.service.goals.review(f.identity,f.scopeId,runId,'changed-full',draft)).rejects.toMatchObject({code:'GOAL_HUMAN_STALE'});expect(await f.store.read()).toEqual(before);
    await fs.unlink(extra);await f.service.goals.review(f.identity,f.scopeId,runId,'matching-full',draft);await journal.append({type:'run.settled',data:{status:'completed'}});const reviewed=await f.store.read();await fs.writeFile(extra,'extra again');
    await expect(f.service.closeScope(f.identity,f.scopeId,'completed',await RunJournal.read(journal.directory))).rejects.toMatchObject({code:'GOAL_HUMAN_STALE'});expect(await f.store.read()).toEqual(reviewed);
  }finally{await f.cleanup()}
});
