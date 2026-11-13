import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {requestBudgetFixture,budgetAttempt,budgetUsage,budgetTestModel} from './model-request-budget-fixture';
import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';
import {ModelRequestBudgetService} from '../src/logic/budget/runtime/model-request-budget-service';
import {requestBudgetStore} from '../src/logic/dispatch/storage/request-budget-store';
import {requestBudgetCommand,requestBudgetReceipt,requestBudgetReservation,requestBudgetReport,requestBudgetRecords,requestBudgetDecision,requestBudgetCost} from '../src/logic/budget/rules/model-request-budget-rules';
import type {ModelRequestBudgetChange} from '../src/logic/budget/rules/model-request-budget';
import {hash} from '../src/core/platform/node/serialization';

it('预算端口只暴露隔离的预算视图，阶段提交保留唯一事务及原命令重放',async()=>{
  const f=await requestBudgetFixture();try{
    const port=requestBudgetStore(f.store),view=await port.readBudget();
    expect(Object.keys(port).sort()).toEqual(['readBudget','transactBudget']);
    // 尚无原请求记录时保持缺省；已有记录后的事务视图在下方继续核对两项字段。
    expect(Object.keys(view).sort()).toEqual(['scopes']);
    view.scopes!.splice(0);expect((await f.store.read()).scopes).toHaveLength(1);
    const ticket=await f.port.reserve(budgetAttempt),initial=(await f.store.read()).modelRequestBudgetChanges![0];
    const replay=vi.fn();expect(await port.transactBudget(requestBudgetCommand(initial),replay)).toEqual(requestBudgetReceipt(initial));expect(replay).not.toHaveBeenCalled();
    const change={requestId:ticket.requestId,revision:2,recordedAt:new Date().toISOString(),phase:'issuing' as const};
    await port.transactBudget(requestBudgetCommand(change),async state=>{
      expect(Object.keys(state).sort()).toEqual(['modelRequestBudgetChanges','scopes']);
      state.scopes!.splice(0);state.modelRequestBudgetChanges!.splice(0);return {modelRequestBudgetChanges:[change],receipt:requestBudgetReceipt(change)};
    });
    const actual=await f.store.read();expect(actual.scopes).toHaveLength(1);expect(actual.modelRequestBudgetChanges).toHaveLength(2);
    expect(actual.modelRequestBudgetChanges!.at(-1)?.phase).toBe('issuing');
  }finally{await f.cleanup()}
});

it('串行可靠预留共同扣余额，明确结算后释放；重放原命令不重新预留或修改正文',async()=>{
  const f=await requestBudgetFixture({tokens:69632});try{
    const results=await Promise.allSettled([f.port.reserve(budgetAttempt),f.port.reserve(budgetAttempt)]);expect(results.map(r=>r.status).sort()).toEqual(['fulfilled','rejected']);
    const ticket=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof f.port.reserve>>>).value;
    expect(await f.service.report(f.query)).toMatchObject({requests:2,inFlight:1,denied:1,reservedTokens:69632,lastDenial:'token_reserve',lastDeniedTokens:69632});
    const initial=(await f.store.read()).modelRequestBudgetChanges![0];expect(initial.phase).toBe('reserved');
    const prepare=vi.fn();expect(await f.store.transact(requestBudgetCommand(initial),prepare)).toEqual(requestBudgetReceipt(initial));expect(prepare).not.toHaveBeenCalled();
    await expect(f.store.transact({...requestBudgetCommand(initial),fingerprint:'different'},prepare)).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    await ticket.issue();await ticket.report(budgetUsage);expect(await f.service.report(f.query)).toMatchObject({reported:1,tokens:120,inFlight:0,reservedTokens:0,estimatedCostUsd:0.00014});
    const smaller=await f.port.reserve({...budgetAttempt,maxOutputTokens:1024});await smaller.notSent('cancelled_before_send');expect(await f.service.report(f.query)).toMatchObject({notSent:1,reservedTokens:0,tokens:120});
    await expect(ticket.report(budgetUsage)).rejects.toMatchObject({code:'MODEL_REQUEST_STAGE'});
  }finally{await f.cleanup()}
});

it('重新打开只读未决事实，换工作区实例不能释放；旧主运行占位失效后不能发送',async()=>{
  const f=await requestBudgetFixture();let reader:FileDispatchStore|undefined;try{
    const ticket=await f.port.reserve(budgetAttempt);await ticket.issue();const before=await fs.readFile(path.join(f.directory,'dispatch.jsonl'));
    await f.store.close();reader=new FileDispatchStore(f.directory,f.entry.id);const next=new ModelRequestBudgetService({entry:f.owner.entry,instanceId:'next-instance',assert:()=>f.owner.assert()},requestBudgetStore(reader),f.dispatch.budgets);
    expect(await next.report(f.query)).toMatchObject({unknown:1,inFlight:0,reservedTokens:69632});expect(await fs.readFile(path.join(f.directory,'dispatch.jsonl'))).toEqual(before);
    const port=(await next.forRun(f.binding,f.llm))!;await expect(port.reserve(budgetAttempt)).rejects.toMatchObject({code:'MODEL_REQUEST_BUDGET_DENIED'});expect(await next.report(f.query)).toMatchObject({unknown:1,denied:1,reservedTokens:69632});
    f.release();await expect(port.reserve(budgetAttempt)).rejects.toMatchObject({code:'MODEL_REQUEST_RUN_STALE'});
  }finally{await reader?.close();await f.cleanup()}
});

it('禁止跳过发送阶段、改写终态或夹带业务变化；停止后仍保留原实际消耗',async()=>{
  const f=await requestBudgetFixture();try{
    const ticket=await f.port.reserve(budgetAttempt);await expect(ticket.report(budgetUsage)).rejects.toMatchObject({code:'MODEL_REQUEST_BUDGET_AUDIT'});
    const initial=(await f.store.read()).modelRequestBudgetChanges![0],mixed={requestId:ticket.requestId,revision:2,recordedAt:new Date().toISOString(),phase:'issuing' as const};
    await expect(f.store.transact(requestBudgetCommand(mixed),async()=>({modelRequestBudgetChanges:[mixed],scopes:[],receipt:requestBudgetReceipt(mixed)}))).rejects.toMatchObject({code:'MODEL_REQUEST_BUDGET_AUDIT'});
    if(initial.phase!=='reserved')throw Error('missing reservation');
    const forged={...initial,requestId:'forged',intent:{...initial.intent,requestId:'forged',binding:{...initial.intent.binding,runId:'foreign-run'}}};
    await expect(f.store.transact(requestBudgetCommand(forged),async()=>({modelRequestBudgetChanges:[forged],receipt:requestBudgetReceipt(forged)}))).rejects.toMatchObject({code:'MODEL_REQUEST_BUDGET_AUDIT'});
    await ticket.issue();await f.dispatch.closeScope(f.identity,f.query.scopeId,'cancelled');f.release();await ticket.report(budgetUsage);
    expect(await f.service.report(f.query)).toMatchObject({reported:1,tokens:120,unknown:0});
    await expect(f.service.report({...f.query,rootSessionId:'other'})).rejects.toMatchObject({code:'MODEL_REQUEST_NOT_ENABLED'});
  }finally{await f.cleanup()}
});

it('缺价格的Token-only可以结算；美元预算拒绝未知价格，真实超额报告保留且阻止后续',async()=>{
  const llm=structuredClone(budgetTestModel);delete llm.profile.pricing;
  const f=await requestBudgetFixture({tokens:100000},llm);try{
    const ticket=await f.port.reserve(budgetAttempt);await ticket.issue();await ticket.report({...budgetUsage,output:5000,totalTokens:5100});
    expect(await f.service.report(f.query)).toMatchObject({tokens:5100,costComplete:false,overrun:1,estimatedCostUsd:0});await expect(f.port.reserve(budgetAttempt)).rejects.toMatchObject({code:'MODEL_REQUEST_UNVERIFIED'});
  }finally{await f.cleanup()}
  const cost=await requestBudgetFixture({estimatedCostUsd:1},llm);try{await expect(cost.port.reserve(budgetAttempt)).rejects.toMatchObject({code:'MODEL_REQUEST_BUDGET_DENIED'});expect(await cost.service.report(cost.query)).toMatchObject({denied:1,lastDenial:'unpriced',reservedTokens:0})}finally{await cost.cleanup()}
});

it.each(['before-write','after-write'] as const)('请求预留持久化失败不放行，重开按实际日志保留 %s',async mode=>{
  const f=await requestBudgetFixture();let reader:FileDispatchStore|undefined;const original=fs.open.bind(fs);try{
    const spy=vi.spyOn(fs,'open').mockImplementation(async(...args:any[])=>{
      if(String(args[0])===path.join(f.directory,'dispatch.jsonl')&&args[1]==='a'){
        if(mode==='before-write')throw Error('fixture open failure');const handle=await original(...args as Parameters<typeof fs.open>);vi.spyOn(handle,'sync').mockRejectedValueOnce(Error('fixture fsync failure'));return handle;
      }return original(...args as Parameters<typeof fs.open>);
    });
    await expect(f.port.reserve(budgetAttempt)).rejects.toMatchObject({code:'GRAPH_STORAGE_FAILED'});spy.mockRestore();await f.store.close();reader=new FileDispatchStore(f.directory,f.entry.id);
    const state=await reader.read(),report=requestBudgetReport(requestBudgetRecords(state.modelRequestBudgetChanges??[]),{...f.query,policyRevision:1},'new-instance');expect(report).toMatchObject(mode==='after-write'?{requests:1,unknown:1,reservedTokens:69632}:{requests:0,reservedTokens:0});
  }finally{vi.restoreAllMocks();await reader?.close();await f.cleanup()}
});

it('只在真实请求原始容量与完整冻结价格上预留；价格浮点边界不绕过正额度',()=>{
  expect(requestBudgetReservation(budgetTestModel.profile,4096)).toEqual({tokens:69632,estimatedCostUsd:0.106496});
  for(const cap of [0,4097,Infinity,1.5])expect(()=>requestBudgetReservation(budgetTestModel.profile,cap)).toThrow();
  const report=requestBudgetReport([],{workspaceId:'workspace',rootSessionId:'root',scopeId:'scope',policyRevision:1},'instance'),reservation=requestBudgetReservation(budgetTestModel.profile,4096);
  for(const limit of [0.106496,0.106496-Number.EPSILON*0.106496])expect(requestBudgetDecision({revision:1,enabled:true,enforcement:'request',limits:{estimatedCostUsd:limit}},report,reservation,[])).toBeUndefined();
  for(const limit of [0.10649,Number.MIN_VALUE])expect(requestBudgetDecision({revision:1,enabled:true,enforcement:'request',limits:{estimatedCostUsd:limit}},report,reservation,[])).toBe('cost_reserve');
  expect(requestBudgetDecision({revision:1,enabled:true,enforcement:'request',limits:{tokens:100000}},{...report,requests:4096},reservation,[])).toBe('capacity');
  const tiny={...budgetTestModel.profile,pricing:{input:Number.MIN_VALUE,output:0,cacheRead:0,cacheWrite:0}};
  expect(requestBudgetReservation(tiny,4096).estimatedCostUsd).toBe(Number.MIN_VALUE);
  const pricingModel={...tiny,profileId:tiny.id,modelId:tiny.model,configurationHash:'a'.repeat(64)};
  expect(requestBudgetCost(pricingModel,budgetUsage)).toBe(Number.MIN_VALUE);expect(requestBudgetCost({...pricingModel,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}},budgetUsage)).toBe(0);
});

it('同周期另一端口变为未知时，已准入但未fetch的请求同步停止，明确未发送才释放自身预留',async()=>{
  const f=await requestBudgetFixture({tokens:300000});try{
    const [a,b]=await Promise.all([f.port.reserve(budgetAttempt),f.port.reserve(budgetAttempt)]);await a.issue();await b.issue();await a.unknown('transport_failed');
    expect(()=>b.assertSend()).toThrow();await b.notSent('cancelled_before_send');expect(await f.service.report(f.query)).toMatchObject({unknown:1,notSent:1,reservedTokens:69632});
  }finally{await f.cleanup()}
});

it('重放即使有完整JSON和正确校验和也拒绝伪造阶段，不把缺预留的报告当可信用量',async()=>{
  const f=await requestBudgetFixture();let reader:FileDispatchStore|undefined;try{
    const ticket=await f.port.reserve(budgetAttempt);await f.store.close();const file=path.join(f.directory,'dispatch.jsonl'),lines=(await fs.readFile(file,'utf8')).trimEnd().split('\n'),record=JSON.parse(lines.at(-1)!);
    const bad:ModelRequestBudgetChange={requestId:ticket.requestId,revision:1,recordedAt:new Date().toISOString(),phase:'reported',usage:budgetUsage,estimatedCostUsd:0.00014};record.body.command=requestBudgetCommand(bad);record.body.mutation={modelRequestBudgetChanges:[bad],receipt:requestBudgetReceipt(bad)};record.checksum=hash(JSON.stringify(record.body));lines[lines.length-1]=JSON.stringify(record);await fs.writeFile(file,lines.join('\n')+'\n');reader=new FileDispatchStore(f.directory,f.entry.id);await expect(reader.read()).rejects.toThrow();
  }finally{await reader?.close();await f.cleanup()}
});
