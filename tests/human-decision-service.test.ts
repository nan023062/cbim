import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import type {HumanDecisionPreview,HumanDecisionRequest} from '../src/logic/tasks/rules/human-decisions';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import {WorkspaceDispatchService} from '../src/logic/dispatch/runtime/dispatch-service';
import {humanServiceFixture,latch} from './human-decision-service-fixture';
import {request} from './data/knowledge';

function submit(f:Awaited<ReturnType<typeof humanServiceFixture>>,preview:HumanDecisionPreview,decision:HumanDecisionRequest['decision']='accept',comment='明确意见'):HumanDecisionRequest{return {...f.input,commandId:randomUUID(),expectedBasis:preview.basis!,expectedDecisionRevision:preview.decisionRevision,decision,comment}}

it('真实候选和文件一次有界核实，三种人工记录不改目标、等待、图或运行，重开保留且幂等不重读',async()=>{
  const f=await humanServiceFixture({candidates:2});try{
    f.checkFiles.mockClear();const preview=await f.preview();expect(preview.allowedDecisions).toEqual(['accept','reject','request_evidence']);expect(f.checkFiles).toHaveBeenCalledTimes(1);expect(f.checkFiles.mock.calls[0][0]).toHaveLength(2);
    const before=await f.store.read(),mainBytes=await fs.readFile(path.join(f.journal.directory,'events.jsonl'),'utf8'),starts=f.starts,first=submit(f,preview),accepted=await f.service.humanDecisions.decide(first,f.actor);
    expect(accepted.record).toMatchObject({decisionId:first.commandId,revision:1,decision:'accept',actor:f.actor});
    const after=await f.store.read(),{humanDecisions:history,...scope}=after.scopes![0];expect(history!.revision).toBe(1);expect(scope).toEqual(before.scopes![0]);expect({...after,scopes:before.scopes}).toEqual(before);expect(f.starts).toBe(starts);expect(await fs.readFile(path.join(f.journal.directory,'events.jsonl'),'utf8')).toBe(mainBytes);
    f.inspect.mockClear();f.checkFiles.mockClear();expect(await f.service.humanDecisions.decide(first,f.actor)).toEqual(accepted);expect(f.inspect).not.toHaveBeenCalled();expect(f.checkFiles).not.toHaveBeenCalled();
    await expect(f.service.humanDecisions.decide({...first,comment:'同命令不同意见'},f.actor)).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    const secondPreview=await f.preview();expect(secondPreview.basis).toBe(preview.basis);const rejected=await f.service.humanDecisions.decide(submit(f,secondPreview,'reject'),f.actor);expect(rejected.record.supersedesDecisionId).toBe(first.commandId);
    const third=await f.service.humanDecisions.decide(submit(f,await f.preview(),'request_evidence'),f.actor);expect(third.record.supersedesDecisionId).toBe(rejected.record.decisionId);
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{const restored=new WorkspaceDispatchService(f.workspace,reader),history=await restored.humanDecisions.history({...f.identity,scopeId:f.scopeId});expect(history.records).toHaveLength(3);expect(await restored.humanDecisions.inspect({...f.identity,scopeId:f.scopeId,commandId:first.commandId})).toMatchObject({scopeStatus:'waiting',record:accepted.record});expect(await reader.read()).toEqual(await f.store.read())}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it('预览后文件变化拒绝旧basis；重新核实可记录拒绝/补证但不能接受或冒充匹配',async()=>{
  const f=await humanServiceFixture();try{
    const preview=await f.preview(),old=submit(f,preview),before=await f.store.read();await fs.writeFile(path.join(f.a,'human-0.txt'),'changed');
    await expect(f.service.humanDecisions.decide(old,f.actor)).rejects.toMatchObject({code:'HUMAN_STALE'});expect(await f.store.read()).toEqual(before);
    const changed=await f.preview();expect(changed.candidates[0].selected!.files[0].state).toBe('changed');expect(changed.allowedDecisions).toEqual(['reject','request_evidence']);
    await expect(f.service.humanDecisions.decide(submit(f,changed),f.actor)).rejects.toMatchObject({code:'HUMAN_DECISION_UNAVAILABLE'});
    const rejected=await f.service.humanDecisions.decide(submit(f,changed,'reject','文件内容有变化'),f.actor);expect(rejected.record.proof.candidates[0].selected!.files[0].state).toBe('changed');
    await fs.unlink(path.join(f.a,'human-0.txt'));const missing=await f.preview();expect(missing.candidates[0].selected!.files[0].state).toBe('missing');const supplemented=await f.service.humanDecisions.decide(submit(f,missing,'request_evidence','请恢复可核实文件'),f.actor);expect(supplemented.record.supersedesDecisionId).toBeUndefined();
  }finally{await f.cleanup()}
});

it('未选基线不读文件且不能接受，跨候选选择和伪造actor/proof字段被拒',async()=>{
  const f=await humanServiceFixture();try{
    f.checkFiles.mockClear();const unselected={...f.input,baselines:[]},preview=await f.service.humanDecisions.preview(unselected);expect(preview.allowedDecisions).toEqual(['reject','request_evidence']);expect(f.checkFiles).not.toHaveBeenCalled();
    const input={...submit(f,preview),baselines:[]};await expect(f.service.humanDecisions.decide(input,f.actor)).rejects.toMatchObject({code:'HUMAN_DECISION_UNAVAILABLE'});
    await expect(f.service.humanDecisions.decide({...input,actor:f.actor} as HumanDecisionRequest,f.actor)).rejects.toMatchObject({code:'HUMAN_INPUT_INVALID'});
    await expect(f.service.humanDecisions.decide(input,{kind:'local_desktop',interaction:'model'} as never)).rejects.toMatchObject({code:'HUMAN_INPUT_INVALID'});
    const foreign=await f.service.humanDecisions.preview({...f.input,baselines:[{...f.input.baselines[0],runId:'foreign-run'}]});expect(foreign.allowedDecisions).toEqual([]);expect(foreign.issues[0].code).toBe('HUMAN_SOURCE_INVALID');
    const rejected=await f.service.humanDecisions.decide({...input,commandId:randomUUID(),decision:'reject',comment:'尚未核实文件'},f.actor);expect(rejected.record.baselines).toEqual([]);
  }finally{await f.cleanup()}
});

it('真实unknown/损坏/缺失native登记不可补签；已成功命令范围不全保留限制仍可明确接受',async()=>{
  const f=await humanServiceFixture({command:true});try{
    const preview=await f.preview();expect(preview.allowedDecisions).toContain('accept');expect(preview.limitations.some(item=>item.includes('命令外部影响'))).toBe(true);
    const before=await f.store.read();
    for(const mutate of [(summary:Awaited<ReturnType<typeof f.read>>)=>{summary.logIntegrity=undefined},(summary:Awaited<ReturnType<typeof f.read>>)=>{summary.unresolvedTools=['unknown-write']},(summary:Awaited<ReturnType<typeof f.read>>)=>{summary.events=summary.events.filter(event=>event.type!=='session.bound').map((event,index)=>({...event,seq:index+1}))}]){
      f.inspect.mockImplementation(async run=>{const summary=await f.read(run);mutate(summary);return summary});const invalid=await f.preview();expect(invalid.allowedDecisions).toEqual([]);await expect(f.service.humanDecisions.decide(submit(f,preview,'reject'),f.actor)).rejects.toMatchObject({code:'HUMAN_EVIDENCE_INVALID'});expect(await f.store.read()).toEqual(before);
    }
    f.inspect.mockImplementation(f.read);const accepted=await f.service.humanDecisions.decide(submit(f,await f.preview()),f.actor);expect(accepted.record.proof.limitations).toEqual(preview.limitations);
  }finally{await f.cleanup()}
});

it('独立CAS阻止两个新命令覆盖，同一命令双击只追加一次',async()=>{
  const f=await humanServiceFixture();try{
    const preview=await f.preview(),one=submit(f,preview),receipts=await Promise.all([f.service.humanDecisions.decide(one,f.actor),f.service.humanDecisions.decide(one,f.actor)]);expect(receipts[0]).toEqual(receipts[1]);
    const current=await f.preview(),a=submit(f,current,'reject'),b=submit(f,current,'request_evidence'),results=await Promise.allSettled([f.service.humanDecisions.decide(a,f.actor),f.service.humanDecisions.decide(b,f.actor)]);expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(results.find(result=>result.status==='rejected')).toMatchObject({reason:{code:'HUMAN_REVISION_CONFLICT'}});expect((await f.store.read()).scopes![0].humanDecisions!.revision).toBe(2);
  }finally{await f.cleanup()}
});

it('文件异步核实期间工作区退役不提交；释放只读占用且无成功回执',async()=>{
  const f=await humanServiceFixture(),entered=latch(),release=latch();try{
    const input=submit(f,await f.preview()),before=await f.store.read();f.checkFiles.mockImplementation(async(files,signal)=>{entered.resolve();await release.promise;return f.files.checkFiles(files,signal)});
    const pending=f.service.humanDecisions.decide(input,f.actor);await entered.promise;f.setRetired();release.resolve();await expect(pending).rejects.toMatchObject({code:'HUMAN_UNAVAILABLE'});expect(await f.store.read()).toEqual(before);expect(f.lease.canAcquire('probe','execute')).toBeUndefined();
  }finally{release.resolve();await f.cleanup()}
});

it('读取期间知识或canonical发生变化不拼接证明，原目标与决定历史保持原样',async()=>{
  const f=await humanServiceFixture();try{
    const input=submit(f,await f.preview()),before=await f.store.read();let reads=0;
    f.inspect.mockImplementation(async run=>{const summary=await f.read(run);if(++reads>1)summary.events.at(-1)!.time='2026-11-07T00:00:00.000Z';return summary});
    await expect(f.service.humanDecisions.decide(input,f.actor)).rejects.toMatchObject({code:'HUMAN_STALE'});expect(await f.store.read()).toEqual(before);
    f.inspect.mockImplementation(f.read);f.checkFiles.mockImplementation(async(files,signal)=>{const result=await f.files.checkFiles(files,signal),snapshot=await f.workspace.snapshot();await f.workspace.commit(request(snapshot,[{path:'.cbim/README.md',text:'# 新知识版本'}]));return result});
    await expect(f.service.humanDecisions.decide(input,f.actor)).rejects.toMatchObject({code:'HUMAN_KNOWLEDGE_CHANGED'});const after=await f.store.read();expect(after.graphs).toEqual(before.graphs);expect(after.runs).toEqual(before.runs);expect(after.scopes).toEqual(before.scopes);expect(await f.service.humanDecisions.inspect({...f.identity,scopeId:f.scopeId,commandId:input.commandId})).toBeUndefined();
  }finally{await f.cleanup()}
});

it('本地写占用和已关闭周期明确拒绝新记录，关闭后的原回执仍可只读查询',async()=>{
  const f=await humanServiceFixture();try{
    const input=submit(f,await f.preview()),before=await f.store.read(),release=f.lease.acquire('other-business','execute');
    try{await expect(f.service.humanDecisions.decide(input,f.actor)).rejects.toMatchObject({code:'HUMAN_UNAVAILABLE'});expect(await f.store.read()).toEqual(before)}finally{release()}
    const accepted=await f.service.humanDecisions.decide(input,f.actor);await f.service.closeScope(f.identity,f.scopeId,'cancelled');
    await expect(f.service.humanDecisions.decide({...input,commandId:randomUUID(),expectedDecisionRevision:1},f.actor)).rejects.toMatchObject({code:'HUMAN_NOT_WAITING'});
    expect(await f.service.humanDecisions.inspect({...f.identity,scopeId:f.scopeId,commandId:input.commandId})).toMatchObject({scopeStatus:'closed',record:accepted.record});expect(await f.service.humanDecisions.decide(input,f.actor)).toEqual(accepted);
  }finally{await f.cleanup()}
});
