import {expect,it,vi} from 'vitest';
import path from 'node:path';
import {fixture} from './helpers';
import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';
import {WorkspaceDispatchService} from '../src/logic/dispatch/runtime/dispatch-service';
import type {ScopeBudgetPolicy} from '../src/logic/budget/rules/scope-budget';
import type {RunSummary,TaskSpec,EngineEvent} from '../src/logic/execution/rules/types';

async function setup(limits:ScopeBudgetPolicy['limits']={tokens:200}){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),directory=path.join(f.user,'budget-tests'),store=new FileDispatchStore(directory,entry.id);
  let policy:ScopeBudgetPolicy={revision:1,enabled:true,limits};
  const logs=new Map<string,RunSummary>(),inspectMain=vi.fn(async(_root:string,id:string)=>{const value=logs.get(id);if(!value)throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(value)});
  const service=new WorkspaceDispatchService(workspace,store,{inspectMain,inspectMember:async()=>{throw Error('unexpected member')}},()=>policy),identity={workspaceId:entry.id,rootSessionId:'root'};
  const record=async(runId:string,root='root',tokens=100,priced=true)=>{
    const task:TaskSpec={taskId:root,workspaceId:entry.id,root:f.a,mode:'chat',agentId:'cbim:main',goal:'测试',moduleIds:[],acceptance:[]},conversationBinding=await service.conversationBinding(task);
    const events:EngineEvent[]=[{type:'run.started',data:{task,conversationBinding}},{type:'engine.status',data:{metric:'run-usage',tokens:{input:tokens,output:0,cacheRead:0,cacheWrite:0,reasoning:0},cost:priced?0.1:undefined,pricingKnown:priced}},{type:'run.settled',data:{status:'completed'}}];
    logs.set(runId,{task,conversationBinding,runId,status:'completed',acceptance:'not_evaluated',unresolvedTools:[],logIntegrity:{partialTail:false},events:events.map((event,i)=>({...event,seq:i+1,version:1,time:'2026-11-07T00:00:00.000Z',workspaceId:entry.id,taskId:root,runId}))});
  };
  return {...f,entry,store,service,identity,directory,logs,inspectMain,record,setPolicy:(value:ScopeBudgetPolicy)=>{policy=value},cleanup:async()=>{await store.close();await f.cleanup()}};
}

it('冻结策略和主运行证明同事务保存，达到阈值先保存拒绝再返回错误，重开不丢失',async()=>{
  const f=await setup();try{
    const first=await f.service.openScope(f.identity,'scope',{message:'目标'},'one');expect(first.budget).toMatchObject({policy:{revision:1,limits:{tokens:200}},lastAdmission:{runId:'one',observation:{registeredRuns:0}}});
    f.setPolicy({revision:2,enabled:false,limits:{}});await f.record('one');
    await f.service.registerMainRun(f.identity,'scope','two');await f.record('two');
    expect((await f.service.goals.inspect(f.identity,'scope')).budget?.lastAdmission).toMatchObject({runId:'two',observation:{tokens:100,registeredRuns:1}});
    await expect(f.service.registerMainRun(f.identity,'scope','three')).rejects.toMatchObject({code:'SCOPE_BUDGET_EXCEEDED'});
    const denied=await f.service.goals.inspect(f.identity,'scope');expect(denied.budget?.blocked?.reason).toBe('token_limit');expect(denied.runTracking?.mainRunIds).toEqual(['one','two']);
    await expect(f.service.registerMainRun(f.identity,'scope','three')).rejects.toMatchObject({code:'SCOPE_BUDGET_EXCEEDED'});expect(await f.service.goals.inspect(f.identity,'scope')).toEqual(denied);
    await f.service.closeScope(f.identity,'scope','failed');await f.store.close();const reopened=new FileDispatchStore(f.directory,f.entry.id);try{expect((await reopened.read()).scopes?.[0].budget).toEqual(denied.budget)}finally{await reopened.close()}
  }finally{await f.cleanup()}
});

it('可信启动空窗等待且不读缺失日志、不留下拒绝；释放后缺失才作为未知，不能算零',async()=>{
  const f=await setup();try{
    const release=f.service.budgets.holdMain('one');await f.service.openScope(f.identity,'scope',{message:'目标'},'one');
    await expect(f.service.registerMainRun(f.identity,'scope','two')).rejects.toMatchObject({code:'SCOPE_BUDGET_WAITING'});
    expect(f.inspectMain).not.toHaveBeenCalled();expect((await f.service.goals.inspect(f.identity,'scope')).budget?.blocked).toBeUndefined();release();
    await expect(f.service.registerMainRun(f.identity,'scope','two')).rejects.toMatchObject({code:'SCOPE_BUDGET_UNVERIFIABLE'});
    expect((await f.service.goals.inspect(f.identity,'scope')).budget?.blocked?.observation.unknownRunIds).toEqual(['one']);
  }finally{await f.cleanup()}
});

it('仅token额度不要求价格；单周期在途串行，但另一个根独立获得首轮',async()=>{
  const f=await setup();try{
    await f.service.openScope(f.identity,'scope',{message:'目标'},'one');await f.record('one','root',100,false);
    const release=f.service.budgets.holdMain('two');await f.service.registerMainRun(f.identity,'scope','two');
    await expect(f.service.registerMainRun(f.identity,'scope','three')).rejects.toMatchObject({code:'SCOPE_BUDGET_WAITING'});
    const other=await f.service.openScope({...f.identity,rootSessionId:'other'},'other-scope',{message:'另一个目标'},'other-one');expect(other.budget?.lastAdmission?.observation.registeredRuns).toBe(0);release();
  }finally{await f.cleanup()}
});

it('费用额度不能将无价格日志当免费，默认关闭和旧周期不回读计量或补策略',async()=>{
  const f=await setup({estimatedCostUsd:1});try{
    await f.service.openScope(f.identity,'scope',{message:'目标'},'one');await f.record('one','root',100,false);
    await expect(f.service.registerMainRun(f.identity,'scope','two')).rejects.toMatchObject({code:'SCOPE_BUDGET_UNVERIFIABLE'});
    await f.service.closeScope(f.identity,'scope','failed');f.setPolicy({revision:2,enabled:false,limits:{tokens:1}});f.inspectMain.mockClear();
    await f.service.openScope(f.identity,'disabled',{message:'目标'},'disabled-one');await f.service.registerMainRun(f.identity,'disabled','disabled-two');expect(f.inspectMain).not.toHaveBeenCalled();
    await f.service.closeScope(f.identity,'disabled','cancelled');await f.service.openScope(f.identity,'legacy');await f.service.registerMainRun(f.identity,'legacy','legacy-one');expect((await f.service.goals.inspect(f.identity,'legacy')).budget).toBeUndefined();
  }finally{await f.cleanup()}
});
