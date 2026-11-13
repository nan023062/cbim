import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import type {HumanContinuationRequest} from '../src/logic/tasks/rules/human-continue';
import type {GoalReviewInput} from '../src/logic/tasks/rules/scope-goal';
import {RunJournal} from '../src/backend/main/run-storage/run-journal';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/dispatch/dispatch-service';
import {humanServiceFixture,latch} from './human-decision-service-fixture';
import {request as knowledgeRequest} from './data/knowledge';

type Fixture=Awaited<ReturnType<typeof humanServiceFixture>>;
async function decision(f:Fixture,kind:'accept'|'reject'|'request_evidence'='accept'){
  const preview=await f.preview();return f.service.humanDecisions.decide({...f.input,commandId:randomUUID(),expectedBasis:preview.basis!,expectedDecisionRevision:preview.decisionRevision,decision:kind,comment:'用户明确意见'},f.actor);
}
async function input(f:Fixture,decisionIds:string[]):Promise<HumanContinuationRequest>{
  const scope=(await f.store.read()).scopes![0];return {...f.identity,scopeId:f.scopeId,waitId:scope.wait!.waitId,expectedGoalRevision:scope.goal!.revision,expectedInputRevision:scope.goal!.inputRevision??1,expectedDecisionRevision:scope.humanDecisions!.revision,commandId:randomUUID(),decisionIds,options:{provider:'fixture',model:'fixture',profileId:randomUUID(),permission:'execute'}};
}
async function prepareReview(f:Fixture,kind:'accept'|'reject'='accept'){
  const saved=await decision(f,kind),request=await input(f,[saved.record.decisionId]),runId='continued-main',accepted=await f.service.humanContinuations.accept(request,runId),old=await RunJournal.read(f.journal.directory),journal=new RunJournal(path.join(f.user,'human-continued-log'),old.task,runId);
  await journal.init();await journal.append({type:'run.started',data:{task:old.task,conversationBinding:old.conversationBinding,message:'可信人工决定系统转交',resumeFrom:old.runId,source:{kind:'human_decisions',continuationId:request.commandId,scopeId:f.scopeId,waitId:request.waitId,inputRevision:request.expectedInputRevision+1,decisionRevision:request.expectedDecisionRevision,decisionIds:request.decisionIds}}});
  await journal.append({type:'session.bound',data:{sessionId:'human-main-native',sessionFile:old.sessionFile}});
  f.inspectMain.mockImplementation((_root,id)=>RunJournal.read(id===runId?journal.directory:f.journal.directory));
  const plan=accepted.scope.goal!.plan!,draft={expectedRevision:accepted.scope.goal!.revision,objective:plan.objective,constraints:plan.constraints,criteria:plan.criteria,assignments:plan.assignments.map(({agentId,moduleIds,criterionIds,reason,ownerSelection})=>({agentId,moduleIds,criterionIds,reason,ownerSelection})),reason:'按保存意见重新审阅原目标'};
  const planned=await f.service.goals.plan(f.identity,f.scopeId,runId,'human-replan',draft),review:GoalReviewInput={expectedRevision:planned.goal!.revision,decision:'complete',checks:[{criterionId:'c1',outcome:'satisfied',reason:'引用明确接受并重核',evidence:[{kind:'human-decision',decisionId:saved.record.decisionId,continuationId:request.commandId}]}],superseded:[],gaps:[],reason:'精确证据复核'};
  return {saved,request,accepted,runId,journal,plan,draft,review};
}

it('专用人工意图一次消费等待，保留原目标和历史候选，重开只查回执且普通文本口不能借用',async()=>{
  const f=await humanServiceFixture();try{
    const saved=await decision(f),request=await input(f,[saved.record.decisionId]),before=await f.store.read(),preflight=await f.service.humanContinuations.preflight(request);expect(preflight.message).toContain(saved.record.decisionId);expect(preflight.wait).toEqual(before.scopes![0].wait);
    const [one,two]=await Promise.all([f.service.humanContinuations.accept(request,'new-main'),f.service.humanContinuations.accept(request,'new-main')]);expect([one.fresh,two.fresh].filter(Boolean)).toHaveLength(1);
    const after=await f.store.read(),scope=after.scopes![0],old=before.scopes![0];expect(scope.status).toBe('active');expect(scope.wait).toBeUndefined();expect(scope.goal!.input).toEqual(old.goal!.input);expect(scope.goal!.inputRevision).toBe(2);expect(scope.goal!.review).toBeUndefined();expect(scope.goal!.plan).toEqual(old.goal!.plan);expect(scope.humanDecisions).toEqual(old.humanDecisions);expect(after.graphs).toEqual(before.graphs);expect(after.runs).toEqual(before.runs);expect(after.outbox).toEqual(before.outbox);expect(scope.runTracking!.mainRunIds).toEqual([...old.runTracking!.mainRunIds,'new-main']);
    expect(one.continuation).not.toHaveProperty('input');expect(one.continuation.priorTaskIds).toEqual(before.graphs[0].tasks.map(task=>task.taskId));
    expect(await f.service.continuations.inspect({...f.identity,scopeId:f.scopeId,commandId:request.commandId})).toBeUndefined();
    await expect(f.service.humanContinuations.accept({...request,options:{...request.options,permission:'read'}},'other-main')).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{const restored=new WorkspaceDispatchService(f.workspace,reader);expect(await restored.humanContinuations.inspect({...f.identity,scopeId:f.scopeId,commandId:request.commandId})).toMatchObject({scopeStatus:'active',continuation:one.continuation});expect(await reader.read()).toEqual(after)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it('晚到的新拒绝跨basis取代旧接受，旧版本或只挑旧接受均不消费原等待',async()=>{
  const f=await humanServiceFixture();try{
    const accepted=await decision(f),old=await input(f,[accepted.record.decisionId]);await fs.writeFile(path.join(f.a,'human-0.txt'),'new bytes');const rejected=await decision(f,'reject'),before=await f.store.read();
    await expect(f.service.humanContinuations.accept(old,'no-main')).rejects.toMatchObject({code:'HUMAN_CONTINUATION_STALE'});
    await expect(f.service.humanContinuations.accept({...old,expectedDecisionRevision:2,commandId:randomUUID()},'no-main')).rejects.toMatchObject({code:'HUMAN_CONTINUATION_STALE'});expect(await f.store.read()).toEqual(before);
    const latest=await input(f,[rejected.record.decisionId]);expect((await f.service.humanContinuations.accept(latest,'negative-main')).continuation.decisionIds).toEqual([rejected.record.decisionId]);
  }finally{await f.cleanup()}
});

it('接受后的文件、知识或canonical改变，在实际消费之前拒绝且不追加运行',async()=>{
  const f=await humanServiceFixture();try{
    const saved=await decision(f),req=await input(f,[saved.record.decisionId]),before=await f.store.read(),file=path.join(f.a,'human-0.txt'),bytes=await fs.readFile(file);
    await fs.writeFile(file,'changed');await expect(f.service.humanContinuations.accept(req,'new-main')).rejects.toMatchObject({code:'HUMAN_CONTINUATION_STALE'});expect(await f.store.read()).toEqual(before);await fs.writeFile(file,bytes);
    f.inspect.mockImplementation(async run=>{const summary=await f.read(run);summary.logIntegrity=undefined;return summary});await expect(f.service.humanContinuations.accept(req,'new-main')).rejects.toMatchObject({code:'GOAL_EVIDENCE_INVALID'});expect(await f.store.read()).toEqual(before);f.inspect.mockImplementation(f.read);
    const snapshot=await f.workspace.snapshot();await f.workspace.commit(knowledgeRequest(snapshot,[{path:'.cbim/README.md',text:'# changed knowledge'}]));const afterKnowledge=await f.store.read();expect(afterKnowledge.graphs).toEqual(before.graphs);expect(afterKnowledge.scopes).toEqual(before.scopes);await expect(f.service.humanContinuations.accept(req,'new-main')).rejects.toMatchObject({code:'HUMAN_KNOWLEDGE_CHANGED'});expect(await f.store.read()).toEqual(afterKnowledge);
  }finally{await f.cleanup()}
});

it('文件核实await期间停止，在落盘前拒绝且归还只读占用',async()=>{
  const f=await humanServiceFixture(),entered=latch(),release=latch();try{
    const saved=await decision(f),req=await input(f,[saved.record.decisionId]),before=await f.store.read(),abort=new AbortController();f.checkFiles.mockImplementation(async(files,signal)=>{entered.resolve();await release.promise;return f.files.checkFiles(files,signal)});
    const pending=f.service.humanContinuations.accept(req,'stopped-main',()=>abort.signal.throwIfAborted());await entered.promise;abort.abort();release.resolve();await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(await f.store.read()).toEqual(before);expect(f.lease.canAcquire('probe','execute')).toBeUndefined();expect(await f.service.humanContinuations.inspect({...f.identity,scopeId:f.scopeId,commandId:req.commandId})).toBeUndefined();
  }finally{release.resolve();await f.cleanup()}
});

it('人工接续核证与受控知识提交共用账本时不逆序等待，知识变化不消费原等待',async()=>{
  const f=await humanServiceFixture();try{
    const saved=await decision(f),req=await input(f,[saved.record.decisionId]),before=await f.store.read();
    f.checkFiles.mockImplementation(async(files,signal)=>{
      const observed=await f.files.checkFiles(files,signal),snapshot=await f.workspace.snapshot();
      await f.workspace.commit(knowledgeRequest(snapshot,[{path:'.cbim/README.md',text:'# 验收期间的新知识'}]));
      return observed;
    });
    await expect(f.service.humanContinuations.accept(req,'no-deadlock-run')).rejects.toMatchObject({code:'HUMAN_CONTINUATION_STALE'});
    const after=await f.store.read();expect(after.scopes).toEqual(before.scopes);expect(after.graphs).toEqual(before.graphs);expect(after.runs).toEqual(before.runs);
    expect(await f.service.humanContinuations.inspect({...f.identity,scopeId:f.scopeId,commandId:req.commandId})).toBeUndefined();
  }finally{await f.cleanup()}
});

it('新计划同主体可凭已消费接受审阅，完成前再次核文件；原目标与记录不改写',async()=>{
  const f=await humanServiceFixture();try{
    const p=await prepareReview(f),reviewed=await f.service.goals.review(f.identity,f.scopeId,p.runId,'accepted-review',p.review);await p.journal.append({type:'run.settled',data:{status:'completed'}});
    const summary=await RunJournal.read(p.journal.directory),before=await f.store.read();await fs.writeFile(path.join(f.a,'human-0.txt'),'post-review change');
    await expect(f.service.closeScope(f.identity,f.scopeId,'completed',summary)).rejects.toMatchObject({code:'GOAL_HUMAN_STALE'});expect(await f.store.read()).toEqual(before);
    await fs.writeFile(path.join(f.a,'human-0.txt'),'original 0');await f.service.closeScope(f.identity,f.scopeId,'completed',summary);const scope=(await f.store.read()).scopes![0];expect(scope).toMatchObject({status:'closed',outcome:'completed',humanDecisions:reviewed.humanDecisions});expect(scope.goal!.input.message).toBe('人工验收真实候选');
  }finally{await f.cleanup()}
});

it('改变业务主体不能借用旧人工接受，未消费/别continuation/拒绝也不能满足人工项',async()=>{
  const f=await humanServiceFixture();try{
    const p=await prepareReview(f),before=await f.store.read();await expect(f.service.goals.review(f.identity,f.scopeId,p.runId,'wrong-intent',{...p.review,checks:[{...p.review.checks[0],evidence:[{kind:'human-decision',decisionId:p.saved.record.decisionId,continuationId:randomUUID()}]}]})).rejects.toMatchObject({code:'GOAL_HUMAN_SOURCE'});expect(await f.store.read()).toEqual(before);
    const changed=await f.service.goals.plan(f.identity,f.scopeId,p.runId,'change-subject',{...p.draft,expectedRevision:before.scopes![0].goal!.revision,objective:'different objective'});await expect(f.service.goals.review(f.identity,f.scopeId,p.runId,'bad-subject',{...p.review,expectedRevision:changed.goal!.revision})).rejects.toMatchObject({code:'GOAL_HUMAN_SUBJECT_CHANGED'});
  }finally{await f.cleanup()}
  const f2=await humanServiceFixture();try{const p=await prepareReview(f2,'reject');await expect(f2.service.goals.review(f2.identity,f2.scopeId,p.runId,'reject-not-accept',p.review)).rejects.toMatchObject({code:'GOAL_HUMAN_REQUIRED'})}finally{await f2.cleanup()}
});

it('人工意图的canonical原始来源被改写时，不能仅凭持久意图通过新审阅',async()=>{
  const f=await humanServiceFixture();try{
    const p=await prepareReview(f),before=await f.store.read();f.inspectMain.mockImplementation(async(_root,id)=>{const summary=await RunJournal.read(id===p.runId?p.journal.directory:f.journal.directory);if(id===p.runId)summary.events[0].data.source={kind:'member-results',continuationId:p.request.commandId,messageIds:[],taskIds:[]};return summary});
    await expect(f.service.goals.review(f.identity,f.scopeId,p.runId,'wrong-canonical-source',p.review)).rejects.toMatchObject({code:'GOAL_HUMAN_SOURCE'});expect(await f.store.read()).toEqual(before);
  }finally{await f.cleanup()}
});

it('人工返工重新核实被拒原日志，不能用superseded隐藏损坏来源；文件本身可由新任务改变',async()=>{
  const f=await humanServiceFixture();try{
    const p=await prepareReview(f,'reject'),source=(await f.service.snapshot(f.identity)).tasks[0];await fs.writeFile(path.join(f.a,'human-rework.txt'),'reworked');
    const assigned=await f.service.dispatchTask({...f.identity,commandId:'rework-assignment',expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:p.plan.assignments[0].moduleIds,ownerSelection:p.plan.assignments[0].ownerSelection,goal:'human-rework.txt',acceptance:[{id:'c1',text:'有真实读取'}]}},f.scopeId);
    await f.members.start({...f.identity,taskId:assigned.taskId,commandId:'start-rework',expectedRevision:1,options:{permission:'execute'}});await f.members.waitForSettlement({...f.identity,taskId:assigned.taskId});
    const replacement=(await f.service.snapshot(f.identity)).tasks.find(task=>task.taskId===assigned.taskId)!,draft:GoalReviewInput={...p.review,decision:'awaiting_user',checks:[{criterionId:'c1',outcome:'needs_human',reason:'请确认返工',evidence:[{kind:'member-result',taskId:replacement.taskId,runId:replacement.result!.runId,resultId:replacement.result!.resultId,planRevision:replacement.planRevision,toolCallIds:replacement.result!.evidenceRefs}]}],superseded:[{taskId:source.taskId,replacementTaskIds:[replacement.taskId],reason:'按明确拒绝新做',humanDecision:{decisionId:p.saved.record.decisionId,continuationId:p.request.commandId}}],gaps:['待用户重新核实']},before=await f.store.read();
    f.inspect.mockImplementation(async run=>{const summary=await f.read(run);if(run.binding.taskId===source.taskId)summary.events.at(-1)!.time='2026-11-07T00:00:00.000Z';return summary});
    await expect(f.service.goals.review(f.identity,f.scopeId,p.runId,'bad-old-source',draft)).rejects.toMatchObject({code:'GOAL_SUPERSESSION_INVALID'});expect(await f.store.read()).toEqual(before);
    f.inspect.mockImplementation(f.read);await fs.writeFile(path.join(f.a,'human-0.txt'),'old rejected file may change');await f.service.goals.review(f.identity,f.scopeId,p.runId,'valid-rework',draft);expect((await f.service.snapshot(f.identity)).tasks.find(task=>task.taskId===source.taskId)).toEqual(source);
  }finally{await f.cleanup()}
});

it('后续主回注引用人工意图时，旧来源日志完整行截断仍拒绝，不能凭有效头部授权',async()=>{
  const f=await humanServiceFixture();try{
    const p=await prepareReview(f);await p.journal.append({type:'run.settled',data:{status:'completed'}});const prior=await RunJournal.read(p.journal.directory),runId='main-after-human';await f.service.registerMainRun(f.identity,f.scopeId,runId);
    const journal=new RunJournal(path.join(f.user,'human-later-log'),prior.task,runId);await journal.init();await journal.append({type:'run.started',data:{task:prior.task,conversationBinding:prior.conversationBinding,message:'成员回注',resumeFrom:p.runId}});await journal.append({type:'session.bound',data:{sessionId:'human-main-native',sessionFile:prior.sessionFile}});
    f.inspectMain.mockImplementation(async(_root,id)=>{if(id===runId)return RunJournal.read(journal.directory);if(id!==p.runId)return RunJournal.read(f.journal.directory);const summary=await RunJournal.read(p.journal.directory);summary.events.pop();summary.status='interrupted';return summary});const before=await f.store.read();
    await expect(f.service.goals.review(f.identity,f.scopeId,runId,'truncated-human-origin',p.review)).rejects.toMatchObject({code:'GOAL_HUMAN_SOURCE'});expect(await f.store.read()).toEqual(before);
  }finally{await f.cleanup()}
});

it('已接受的人工项不能混入接续后新候选或借旧接受代替新产物验收',async()=>{
  const f=await humanServiceFixture();try{
    const p=await prepareReview(f);await fs.writeFile(path.join(f.a,'extra-candidate.txt'),'new candidate');const assigned=await f.service.dispatchTask({...f.identity,commandId:'extra-assignment',expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:p.plan.assignments[0].moduleIds,ownerSelection:p.plan.assignments[0].ownerSelection,goal:'extra-candidate.txt',acceptance:[{id:'c1',text:'有真实读取'}]}},f.scopeId);
    await f.members.start({...f.identity,taskId:assigned.taskId,commandId:'start-extra',expectedRevision:1,options:{permission:'execute'}});await f.members.waitForSettlement({...f.identity,taskId:assigned.taskId});const task=(await f.service.snapshot(f.identity)).tasks.find(item=>item.taskId===assigned.taskId)!,before=await f.store.read();
    await expect(f.service.goals.review(f.identity,f.scopeId,p.runId,'mix-unaccepted',{...p.review,checks:[{...p.review.checks[0],evidence:[...p.review.checks[0].evidence,{kind:'member-result',taskId:task.taskId,runId:task.result!.runId,resultId:task.result!.resultId,planRevision:task.planRevision,toolCallIds:task.result!.evidenceRefs}]}]})).rejects.toMatchObject({code:'GOAL_HUMAN_CANDIDATE'});expect(await f.store.read()).toEqual(before);
  }finally{await f.cleanup()}
});
