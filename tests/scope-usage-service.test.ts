import {expect,it,vi} from 'vitest';
import {ScopeUsageService} from '../src/logic/budget/runtime/scope-usage-service';
import type {DispatchState} from '../src/logic/dispatch/rules/dispatch-storage';
import type {DispatchRun} from '../src/logic/tasks/rules/dispatch-execution';
import type {RunSummary,TaskSpec,EngineEvent} from '../src/logic/execution/rules/types';
import type {KnowledgeWorkspace} from '../src/logic/knowledge/rules/ports';

const identity={workspaceId:'workspace',rootSessionId:'root',scopeId:'scope'},rootPath='C:/project';
const mainBinding={workspaceId:'workspace',teamId:'team',agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'conversation',rootSessionId:'root'};
const memberBinding={workspaceId:'workspace',teamId:'team',agentId:'cbim:executor',agentInstanceId:'member-instance',agentSessionId:'member-session',rootSessionId:'root',taskId:'member-task',runId:'member-run',leaseEpoch:1,planRevision:1};

function summary(runId:string,member=false):RunSummary{
  const task:TaskSpec={taskId:member?'member-task':'root',workspaceId:'workspace',root:rootPath,goal:'目标',moduleIds:[],acceptance:[],agentId:member?'cbim:executor':'cbim:main',...(member?{}:{mode:'chat' as const})};
  const binding=member?{memberBinding}:{conversationBinding:mainBinding};
  const data:EngineEvent[]=[{type:'run.started',data:{task,...binding}},{type:'engine.status',data:{metric:'run-usage',tokens:{input:100,output:20,cacheRead:10,cacheWrite:0,reasoning:5},cost:0.1,pricingKnown:true}},{type:'run.settled',data:{status:'completed'}}];
  return {task,runId,status:'completed',acceptance:'not_evaluated',unresolvedTools:[],...binding,logIntegrity:{partialTail:false},events:data.map((event,index)=>({...event,version:1,seq:index+1,time:'2026-11-07T00:00:00.000Z',workspaceId:'workspace',taskId:task.taskId,runId}))};
}
function setup(){
  const state={workspaceId:'workspace',members:[],outbox:[],sessions:[{...mainBinding,purpose:'conversation'}],
    scopes:[{...identity,status:'closed',createdAt:'2026-11-07T00:00:00.000Z',outcome:'completed',runTracking:{version:1,mainRunIds:['main-one','main-two']}},{workspaceId:'workspace',rootSessionId:'unrelated',scopeId:'unrelated-scope',status:'active',createdAt:'2026-11-07T00:00:00.000Z',runTracking:{version:1,mainRunIds:['do-not-read']}}],
    graphs:[{identity:{workspaceId:'workspace',rootSessionId:'root'},root:{agent:{agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'root-channel'}},tasks:[{taskId:'member-task',scopeId:'scope',identity:{workspaceId:'workspace',rootSessionId:'root'},assignee:{agentId:'cbim:executor',agentInstanceId:'member-instance',agentSessionId:'member-session'},planRevision:1,runIds:['member-run'],status:'result_ready'}]}],
    runs:[{binding:memberBinding,status:'completed'}],
  } as unknown as DispatchState;
  const logs=new Map([['main-one',summary('main-one')],['main-two',summary('main-two')],['member-run',summary('member-run',true)]]);
  const read=vi.fn(async()=>structuredClone(state)),inspectMain=vi.fn(async(_root:string,id:string)=>structuredClone(logs.get(id)!)),inspectMember=vi.fn(async(run:DispatchRun)=>structuredClone(logs.get(run.binding.runId)!));
  const service=new ScopeUsageService({entry:{id:'workspace',path:rootPath},assert:()=>{}} as Pick<KnowledgeWorkspace,'entry'|'assert'>,{read},{inspectMain,inspectMember});
  return {state,logs,read,inspectMain,inspectMember,service};
}

it('精确读取所选周期2主1成员，不读其它根；重复读取不累计或修改来源',async()=>{
  const f=setup(),before=structuredClone(f.state),report=await f.service.read(identity);
  expect(report).toMatchObject({coverage:'tracked',consistency:'stable',totals:{registeredRuns:3,readRuns:3,inFlightRuns:0,tokensComplete:true,costComplete:true,tokens:{input:300,output:60,reasoning:15,total:390}}});
  expect(report.totals.estimatedCostUsd).toBeCloseTo(0.3);expect(f.inspectMain.mock.calls.map(call=>call[1])).toEqual(['main-one','main-two']);expect(f.inspectMember).toHaveBeenCalledTimes(1);
  expect((await f.service.read(identity)).totals).toEqual(report.totals);expect(f.state).toEqual(before);expect(f.read).toHaveBeenCalledTimes(4);
});

it('旧周期不补造主运行归属，仍能读取明确成员，但不能宣称完整消耗',async()=>{
  const f=setup();delete f.state.scopes![0].runTracking;
  const report=await f.service.read(identity);
  expect(report.coverage).toBe('legacy');expect(report.runs).toHaveLength(1);expect(f.inspectMain).not.toHaveBeenCalled();
  expect(report.totals).toMatchObject({registeredRuns:1,tokensComplete:false,costComplete:false});expect(f.state.scopes![0].runTracking).toBeUndefined();
});

it('缺失、损坏与伪造头部身份都保留未知；正确摘要不能掩盖错误run.started',async()=>{
  const f=setup();f.inspectMain.mockImplementation(async(_root,id)=>{if(id==='main-one')throw Object.assign(Error('private path'),{code:'ENOENT'});const value=structuredClone(f.logs.get(id)!);value.events[0].data.conversationBinding={...mainBinding,agentInstanceId:'foreign-instance'};return value});
  f.inspectMember.mockRejectedValue(Object.assign(Error('private bad text'),{code:'RUN_LOG_INVALID'}));
  const report=await f.service.read(identity);expect(report.runs.map(run=>run.logState)).toEqual(['missing','identity_mismatch','invalid']);
  expect(report.totals).toMatchObject({readRuns:0,missingUsageRuns:3,tokensComplete:false,costComplete:false});expect(report.totals.estimatedCostUsd).toBeUndefined();
  expect(JSON.stringify(report)).not.toMatch(/private path|private bad text/);
});

it('缺完整性标记或截断只报告部分值，事件序号与成员绑定错误不进入计量',async()=>{
  const f=setup();delete f.logs.get('main-one')!.logIntegrity;f.logs.get('main-two')!.logIntegrity={partialTail:true};f.logs.get('member-run')!.events[1].seq=99;
  const report=await f.service.read(identity);expect(report.runs.map(run=>run.logState)).toEqual(['incomplete','incomplete','identity_mismatch']);
  expect(report.totals.tokensComplete).toBe(false);expect(report.totals.costComplete).toBe(false);expect(report.totals.tokens.total).toBe(260);
});

it('读取期间来源变化降级整份报告，不混入晚新增主运行或额外扫描日志',async()=>{
  const f=setup(),original=f.inspectMain.getMockImplementation()!;
  f.inspectMain.mockImplementation(async(root,id)=>{const value=await original(root,id);if(id==='main-one')f.state.scopes![0].runTracking!.mainRunIds.push('new-run');return value});
  const report=await f.service.read(identity);expect(report.consistency).toBe('changed_during_read');expect(report.totals.tokensComplete).toBe(false);expect(report.runs).toHaveLength(3);expect(f.inspectMain).toHaveBeenCalledTimes(2);
});

it('跨周期查询与矛盾来源不泄漏其它日志，重复run不会双计',async()=>{
  const f=setup();await expect(f.service.read({...identity,rootSessionId:'other'})).rejects.toMatchObject({code:'SCOPE_USAGE_IDENTITY'});await expect(f.service.read({...identity,workspaceId:'other'})).rejects.toMatchObject({code:'SCOPE_USAGE_IDENTITY'});expect(f.inspectMain).not.toHaveBeenCalled();
  f.state.scopes![0].runTracking!.mainRunIds.push('member-run');
  const report=await f.service.read(identity);expect(report.runs).toHaveLength(3);expect(report.runs.find(row=>row.runId==='member-run')?.logState).toBe('identity_mismatch');expect(f.inspectMember).not.toHaveBeenCalled();expect(report.totals.tokens.total).toBe(260);expect(report.totals.tokensComplete).toBe(false);
});
