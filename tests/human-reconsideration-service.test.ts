import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {secondHumanWait,saveHumanOpinion,reconsiderContinuation} from './human-reconsideration-fixture';
import {latch} from './human-decision-service-fixture';
import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';
import {request as knowledgeRequest} from './data/knowledge';

it.each([false,true])('跨等待 %s 模式仅明确选择才读成果，保存新关联不消费等待；原命令与重放保持两份依据',async complete=>{
  const f=await secondHumanWait({complete});try{
    const before=await f.store.read(),prior=f.first.receipt.record;f.checkFiles.mockClear();f.checkManifest.mockClear();
    const menu=await f.service.humanDecisions.preview(f.menu);expect(menu.reconsideration).toMatchObject({decisionId:prior.decisionId,status:'unverifiable',canReconsider:true});expect(menu.reconsideration?.checks.find(c=>c.key==='source')?.state).toBe('same');expect(f.checkFiles).not.toHaveBeenCalled();expect(f.checkManifest).not.toHaveBeenCalled();expect(menu.allowedDecisions).not.toContain('accept');
    await expect(f.service.humanContinuations.preflight(await reconsiderContinuation(f,prior.decisionId))).rejects.toMatchObject({code:'HUMAN_CONTINUATION_STALE'});
    const next=await saveHumanOpinion(f,f.input);expect(next.preview.reconsideration).toMatchObject({status:'evidence_matches',canReconsider:true});expect(next.receipt.record.reconsidersDecisionId).toBe(prior.decisionId);expect(next.receipt.record.proof.source.waitId).not.toBe(prior.proof.source.waitId);expect(next.receipt.record.supersedesDecisionId).toBeUndefined();
    const after=await f.store.read();expect(after.scopes![0].humanDecisions?.records).toEqual([prior,next.receipt.record]);expect({...after.scopes![0],humanDecisions:before.scopes![0].humanDecisions}).toEqual(before.scopes![0]);expect(after.graphs).toEqual(before.graphs);expect(after.runs).toEqual(before.runs);expect(f.starts).toBe(1);
    const reads=[f.checkFiles.mock.calls.length,f.checkManifest.mock.calls.length];expect(await f.service.humanDecisions.decide(next.request,f.actor)).toEqual(next.receipt);expect([f.checkFiles.mock.calls.length,f.checkManifest.mock.calls.length]).toEqual(reads);
    await expect(f.service.humanDecisions.decide({...next.request,reconsidersDecisionId:randomUUID()},f.actor)).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{expect(await reader.read()).toEqual(after)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it.each([false,true])('跨等待 %s 模式真实文件/全集合变化阻止旧接受，明确补证仍保存当前观察',async complete=>{
  const f=await secondHumanWait({complete});try{
    const stable=await f.service.humanDecisions.preview(f.input),before=await f.store.read(),request={...f.input,commandId:randomUUID(),expectedDecisionRevision:stable.decisionRevision,expectedBasis:stable.basis!,decision:'accept' as const,comment:''};
    await fs.writeFile(path.join(f.a,complete?'human-output/new.txt':'human-0.txt'),'changed after review');await expect(f.service.humanDecisions.decide(request,f.actor)).rejects.toMatchObject({code:'HUMAN_STALE'});expect(await f.store.read()).toEqual(before);
    const changed=await f.service.humanDecisions.preview(f.input);expect(changed.reconsideration).toMatchObject({status:'changed',canReconsider:true});expect(changed.reconsideration?.checks.find(c=>c.key==='artifacts')?.state).toBe('changed');expect(changed.allowedDecisions).not.toContain('accept');
    const saved=await saveHumanOpinion(f,f.input,'request_evidence');expect(saved.receipt.record.reconsidersDecisionId).toBe(f.first.receipt.record.decisionId);expect((await f.store.read()).scopes![0].humanDecisions?.records[0]).toEqual(f.first.receipt.record);
  }finally{await f.cleanup()}
});

it('真实新候选显示身份与选择已变化，不能沿用旧基线；明确核实新成果可作新决定',async()=>{
  const f=await secondHumanWait({replacement:true});try{
    const old=await f.service.humanDecisions.preview(f.input);expect(old.allowedDecisions).toEqual([]);
    const menu=await f.service.humanDecisions.preview(f.menu),candidate=menu.candidates[0];expect(menu.reconsideration?.checks.find(c=>c.key==='candidates')?.state).toBe('changed');
    const input={...f.menu,baselines:[{taskId:candidate.taskId,runId:candidate.runId,baselineId:candidate.baselines[0].baselineId}]},saved=await saveHumanOpinion(f,input);expect(saved.preview.reconsideration).toMatchObject({status:'changed',canReconsider:true});expect(saved.preview.reconsideration?.checks.find(c=>c.key==='selection')?.state).toBe('changed');expect(saved.receipt.record.decision).toBe('accept');expect(saved.receipt.record.reconsidersDecisionId).toBe(f.first.receipt.record.decisionId);expect(f.starts).toBe(2);
  }finally{await f.cleanup()}
});

it('旧主日志真实截断拒绝关联，新决定不能借用未知来源；恢复日志后可独立核当前依据',async()=>{
  const f=await secondHumanWait();try{
    const source=path.join(f.journal.directory,'events.jsonl'),bytes=await fs.readFile(source),stable=await f.service.humanDecisions.preview(f.input),before=await f.store.read();await fs.writeFile(source,bytes.subarray(0,bytes.length-20));
    const bad=await f.service.humanDecisions.preview(f.input);expect(bad.reconsideration).toMatchObject({status:'unverifiable',canReconsider:false});expect(bad.allowedDecisions).toEqual([]);expect(bad.reconsideration?.checks.find(c=>c.key==='source')?.state).toBe('unverifiable');
    await expect(f.service.humanDecisions.decide({...f.input,commandId:randomUUID(),expectedDecisionRevision:stable.decisionRevision,expectedBasis:stable.basis!,decision:'accept',comment:''},f.actor)).rejects.toBeDefined();expect(await f.store.read()).toEqual(before);
    await fs.writeFile(source,bytes);const independent={...f.input};delete independent.reconsidersDecisionId;expect((await f.service.humanDecisions.preview(independent)).allowedDecisions).toContain('accept');
  }finally{await f.cleanup()}
});

it('另一意见在对照读取期间保存，迟到预览必须显示已取代，不能返回可提交旧关联',async()=>{
  const f=await secondHumanWait(),entered=latch(),release=latch();try{
    f.checkFiles.mockImplementationOnce(async(files,signal)=>{entered.resolve();await release.promise;return f.files.checkFiles(files,signal)});
    const pending=f.service.humanDecisions.preview(f.input);await entered.promise;const independent={...f.input};delete independent.reconsidersDecisionId;await saveHumanOpinion(f,independent,'reject');release.resolve();const stale=await pending;
    expect(stale.reconsideration).toMatchObject({status:'superseded',canReconsider:false});expect(stale.decisionRevision).toBe(2);expect(stale.allowedDecisions).toEqual([]);expect(stale.basis).toBeUndefined();
    const latest=(await f.store.read()).scopes![0].humanDecisions!.records.at(-1)!;const same=await f.service.humanDecisions.preview({...f.input,reconsidersDecisionId:latest.decisionId});expect(same.reconsideration).toMatchObject({status:'same_wait',canReconsider:false});
    const foreign=await f.service.humanDecisions.preview({...f.input,reconsidersDecisionId:randomUUID()});expect(foreign.reconsideration).toMatchObject({status:'unverifiable',canReconsider:false});
  }finally{release.resolve();await f.cleanup()}
});

it('对照提交竞争和停止不覆盖新意见；知识变化不生成仍可接受的比较结果',async()=>{
  const f=await secondHumanWait(),entered=latch(),release=latch();try{
    const preview=await f.service.humanDecisions.preview(f.input),request={...f.input,commandId:randomUUID(),expectedBasis:preview.basis!,expectedDecisionRevision:preview.decisionRevision,decision:'accept' as const,comment:''};
    f.checkFiles.mockImplementationOnce(async(files,signal)=>{entered.resolve();await release.promise;return f.files.checkFiles(files,signal)});const result=f.service.humanDecisions.decide(request,f.actor);const outcome=expect(result).rejects.toMatchObject({code:'HUMAN_REVISION_CONFLICT'});await entered.promise;
    const independent={...f.input};delete independent.reconsidersDecisionId;await saveHumanOpinion(f,independent,'reject');const before=await f.store.read();release.resolve();await outcome;expect(await f.store.read()).toEqual(before);
    const snapshot=await f.workspace.snapshot();await f.workspace.commit(knowledgeRequest(snapshot,[{path:'.cbim/README.md',text:'# changed knowledge'}]));const afterKnowledge=await f.store.read(),changed=await f.service.humanDecisions.preview(f.input);expect(changed.allowedDecisions).toEqual([]);expect(changed.issues[0].code).toBe('HUMAN_KNOWLEDGE_CHANGED');expect(afterKnowledge.scopes).toEqual(before.scopes);expect(afterKnowledge.graphs).toEqual(before.graphs);expect(afterKnowledge.runs).toEqual(before.runs);
    f.setRetired();await expect(f.service.humanDecisions.decide(request,f.actor)).rejects.toMatchObject({code:'HUMAN_UNAVAILABLE'});expect(await f.store.read()).toEqual(afterKnowledge);
  }finally{release.resolve();await f.cleanup()}
});
