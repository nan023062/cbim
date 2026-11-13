import {expect,test,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {seedTeam} from './team-fixture';
import {registerFixtureOwner} from './owner-execution-fixture';
import {modelRequestBudgetProvider} from './model-request-budget-provider';
import {codexFixture} from './codex-fixture';
import {budgetScopes} from './scope-budget-fixture';
import {requestBudgetReportSchema} from '../src/backend/core/budget/model-request-budget';
import {NativeSessionFiles} from '../src/backend/main/platform/native-session-files';
import type {LoopEngine} from '../src/logic/models';

const profile=(baseUrl:string,engine:LoopEngine)=>({name:'Application '+engine,api:engine==='codex'?'openai-responses' as const:'anthropic-messages' as const,baseUrl,auth:'none' as const,defaultModel:engine==='codex'?'codex-test-model':'request-budget-model',models:[{id:engine==='codex'?'codex-test-model':'request-budget-model',name:'Test',enabled:true,contextWindow:200000,maxTokens:4096,reasoning:false,pricing:{input:1,output:2,cacheRead:0.5,cacheWrite:1.5}}]});

test('真实主会话 Pi → Codex → Claude → Codex → Pi，保留各自原生身份并传递公开上下文',async()=>{
  const f=await fixture(),codex=await codexFixture(),anthropic=await modelRequestBudgetProvider('anthropic-messages');
  try{
    const ids:Record<string,string>={};for(const engine of ['pi','claude-code','codex'] as const){const settings=await f.app.models.save({profile:profile(engine==='codex'?codex.llm.profile.baseUrl:anthropic.url,engine)});ids[engine]=settings.profiles.find(p=>p.name==='Application '+engine)!.id}
    const entry=await f.app.dispatch('add',{path:f.a});await f.app.dispatch('budget.configure',{revision:1,enabled:true,enforcement:'request',limits:{tokens:2000000}});
    let prior:any;const summaries:any[]=[];
    for(const [index,engine] of (['pi','codex','claude-code','codex','pi'] as const).entries()){
      const options={engine,profileId:ids[engine],model:engine==='codex'?'codex-test-model':'request-budget-model',permission:'read',turnTimeoutMs:30000};
      prior=await f.app.dispatch(index?'loop.resume':'loop.chat',{id:entry.id,...(prior?{taskId:prior.taskId,runId:prior.runId}:{}),message:'Turn '+index+' preserve this context.',options});
      await vi.waitFor(async()=>{const scopes=await budgetScopes(f.user,entry.id);expect(scopes).toHaveLength(index+1);expect(scopes.at(-1)?.status).toBe('closed')},{timeout:30000});
      await vi.waitFor(()=>expect(f.app.runtime.snapshot().pressure.activeRuns).toBe(0));
      const summary=await f.app.dispatch('loop.inspect',{id:entry.id,taskId:prior.taskId,runId:prior.runId});summaries.push(summary);expect(summary.status,JSON.stringify({engine,index,events:summary.events.filter((e:any)=>e.type.startsWith('run.')).slice(-1)})).toBe('completed');expect(summary.events[0].data.engine).toBe(engine);expect(summary.sessionFile).toBeTruthy();
      expect(summary.events.find((e:any)=>e.type==='engine.status'&&e.data.metric==='tool-catalog'&&e.data.stage==='active')?.data.missing).toEqual([]);
      if(engine==='codex')expect(summary.events.find((e:any)=>e.data.metric==='run-usage')?.data).toMatchObject({tokens:{input:100,output:20,cacheRead:0,cacheWrite:0},cost:0.00014,pricingKnown:true});
      const scope=(await budgetScopes(f.user,entry.id)).at(-1)!,report=requestBudgetReportSchema.parse(await f.app.dispatch('dispatch.requestBudget',{workspaceId:entry.id,rootSessionId:prior.taskId,scopeId:scope.scopeId}));
      expect(report).toMatchObject({requests:1,reported:1,tokens:120,reservedTokens:0,unknown:0});
    }
    expect(codex.errors).toEqual([]);expect(anthropic.errors).toEqual([]);expect(codex.requests).toHaveLength(2);expect(anthropic.requests).toHaveLength(3);
    expect(summaries[0].sessionFile).toBe(summaries[4].sessionFile);expect(summaries[1].sessionFile).toBe(summaries[3].sessionFile);expect(new Set(summaries.map(s=>s.sessionFile)).size).toBe(3);
    expect(JSON.stringify(codex.requests[0].body)).toContain('Turn 0 preserve this context.');expect(JSON.stringify(codex.requests[1].body)).toContain('Turn 2 preserve this context.');expect(JSON.stringify(anthropic.requests[2].body)).toContain('Turn 3 preserve this context.');
  }finally{await f.cleanup();await codex.cleanup();await anthropic.close()}
},150000);

test('真实成员采纳 Codex 首次线程 ID；原生文件可核实且没有把模型结束当成业务验收',async()=>{
  const f=await fixture(),provider=await codexFixture();
  try{
    const settings=await f.app.models.save({profile:profile(provider.llm.profile.baseUrl,'codex')}),profileId=settings.selectedId!;
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),team=await seedTeam(ws),moduleId=team.input.moduleId,agentId=team.input.agentId;
    await registerFixtureOwner(f.app,entry.id,{agentId,moduleIds:[moduleId],profileId,modelId:'codex-test-model',engine:'codex',name:'Codex 岗位',adaptation:{instructions:'仅核实本模块',references:[]}});
    const service=f.app.memberDispatch(entry.id),members=f.app.memberExecution(entry.id),identity={workspaceId:entry.id,rootSessionId:randomUUID()},scopeId=randomUUID(),mainRunId=randomUUID();
    await service.openScope(identity,scopeId,{message:'验证岗位引擎'},mainRunId);const release=service.budgets.holdMain(mainRunId);
    try{
      const ownerSelection=(await service.owners.discover([moduleId])).groups[0].selection!;
      await service.goals.plan(identity,scopeId,mainRunId,'plan',{expectedRevision:1,objective:'核实模块',constraints:[],criteria:[{id:'verify',text:'真实证据',kind:'evidence'}],assignments:[{agentId,moduleIds:[moduleId],ownerSelection,criterionIds:['verify'],reason:'负责岗位'}],reason:'测试'});
      const assigned=await service.dispatchTask({...identity,commandId:'dispatch',expectedParentRevision:1,task:{assigneeAgentId:agentId,moduleIds:[moduleId],ownerSelection,goal:'核实模块',acceptance:[{id:'verify',text:'真实证据'}],prerequisites:[]}},scopeId);
      await members.start({...identity,taskId:assigned.taskId,commandId:'start',expectedRevision:1,options:{permission:'read',turnTimeoutMs:30000}});
      await vi.waitFor(async()=>expect((await members.inspect({...identity,taskId:assigned.taskId})).runs[0]?.status).toBe('completed'),{timeout:30000});
      const state=await ws.dispatchStore.read(),run=state.runs!.find(r=>r.binding.taskId===assigned.taskId)!,session=state.sessions!.find(s=>s.agentSessionId===run.binding.agentSessionId)!;
      expect(run.model.engine).toBe('codex');expect(run.session.nativeSessionId).not.toBe(run.binding.agentSessionId);expect(session.nativeSessionId).toBe(run.session.nativeSessionId);expect(run.session.sessionFile).toBeTruthy();
      const native=new NativeSessionFiles(path.join(f.app.paths.project(entry.id),'dispatch','runs','codex','sessions'),()=>{},'codex');
      expect((await native.read(run.session,new AbortController().signal)).byteLength).toBeGreaterThan(0);
      expect(await fs.readFile(run.session.sessionFile!,'utf8')).toContain(run.session.nativeSessionId);
      expect(provider.requests).toHaveLength(1);expect(provider.errors).toEqual([]);expect((await members.inspect({...identity,taskId:assigned.taskId})).task.status).toBe('blocked');
    }finally{release()}
  }finally{await f.cleanup();await provider.cleanup()}
},60000);
