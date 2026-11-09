import {expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ExecutionReportController,applyExecutionReport,executionReportStale,type ExecutionReportSelection} from '../src/frontend/tasks/execution-report-state';
import {ExecutionReportPanel} from '../src/frontend/tasks/MemberExecutionReport';
import {MemberTaskDetail} from '../src/frontend/tasks/MemberTaskDetail';
import type {ExecutionReport,ExecutionReportInput,TaskNode,ScopeSummary} from '../src/bridge/contracts/dispatch';

const identity={workspaceId:'workspace',rootSessionId:'root',taskId:'member',runId:'run'};
const selection:ExecutionReportSelection={...identity,scopeId:'cycle'},time='2026-11-07T00:00:00.000Z';
const graphCursor={workspaceId:identity.workspaceId,rootSessionId:identity.rootSessionId,streamId:'graph',seq:8};
const basisKey='a'.repeat(64),changedKey='b'.repeat(64);
function tool(id:string):ExecutionReport['tools']['items'][number]{return {toolCallId:id,toolName:'write',status:'succeeded',effects:['business-write'],scope:{kind:'workspace',workspaceId:'workspace'},proposedSeq:1,allowedSeq:2,finishedSeq:3,receipt:{version:1,toolCallId:id,toolName:'write',workspaceId:'workspace',taskId:'member',runId:'run',outcome:'succeeded',inputHash:'c'.repeat(64),resultHash:'d'.repeat(64),effects:['business-write'],scope:{kind:'workspace',workspaceId:'workspace'},recordedAt:time}}}
function report(items=['one'],total=items.length,offset=0,key=basisKey):ExecutionReport{return {
  identity:{...identity},checkedAt:time,basis:{key,graphCursor,taskRevision:3,planRevision:1,taskStatus:'failed',scopeId:'cycle',scopeStatus:'closed',goalRevision:3,runStatus:'failed',logSeq:12},consistency:'stable',execution:'settled',
  log:{state:'verified',hasTerminal:true,summaryStatus:'failed'},tools:{available:true,total,counts:{succeeded:total,failed:0,denied:0,unknown:0,not_authorized:0},items:items.map(tool),...(offset+items.length<total?{nextCursor:{basis:key,offset:offset+items.length}}:{}),paginationReset:false},
  issues:[{code:'RUN_FAILED',severity:'warning',message:'该执行轮次已失败，已有副作用仍需核实'}],next:{kind:'inspect_effects',reason:'先核实已发生的改动，不自动重试。'},
}}
const request=(cursor?:ExecutionReportInput['cursor']):ExecutionReportInput=>({...identity,limit:2,...(cursor?{cursor}:{})});
function task():TaskNode{const agent={agentId:'cbim:executor',agentInstanceId:'instance',agentSessionId:'channel',name:'执行 Agent'};return {kind:'task',nodeId:'task:member',taskId:'member',scopeId:'cycle',identity:{workspaceId:'workspace',rootSessionId:'root'},requester:{...agent,agentId:'cbim:main'},assignee:agent,modules:[],goal:'核实业务改动',acceptance:[],revision:3,planRevision:1,status:'failed',awaitedChildren:[],runIds:['run'],createdAt:time,updatedAt:time}}
const scope:ScopeSummary={scopeId:'cycle',status:'closed',outcome:'failed',createdAt:time,closedAt:time,hasGoal:true,hasPlan:true,goalRevision:3,stamp:{scopeId:'cycle',streamId:'scopes:graph',seq:3}};

it('挂载与订阅不读取，显式核实双击只读一次；切换节点后忽略迟到报告',async()=>{
  let finish!:(value:unknown)=>void;const read=vi.fn((_request:ExecutionReportInput)=>new Promise(resolve=>{finish=resolve})),controller=new ExecutionReportController(selection,read),changed=vi.fn();const stop=controller.subscribe(changed);
  expect(read).not.toHaveBeenCalled();expect(controller.snapshot.report).toBeUndefined();const first=controller.inspect();await controller.inspect();expect(read).toHaveBeenCalledTimes(1);expect(read.mock.calls[0][0]).toEqual({...identity,limit:50});
  stop();controller.cancel();finish(report());await first;expect(controller.snapshot.report).toBeUndefined();expect(controller.snapshot.loading).toBe(false);
  const otherRead=vi.fn(async()=>({...report(),identity:{...identity,taskId:'other'}})),other=new ExecutionReportController({...selection,taskId:'other'},otherRead);expect(otherRead).not.toHaveBeenCalled();
});

it('工具页必须连续且同基线，分页重置替换旧结果，不拼接两次核实',()=>{
  const first=applyExecutionReport(undefined,report(['one','two'],5),request(),selection);
  const second=applyExecutionReport(first,report(['three','four'],5,2),request(first.tools.nextCursor),selection);expect(second.tools.items.map(item=>item.toolCallId)).toEqual(['one','two','three','four']);
  const complete=applyExecutionReport(second,report(['five'],5,4),request(second.tools.nextCursor),selection);expect(complete.tools.items).toHaveLength(5);expect(complete.tools.nextCursor).toBeUndefined();
  const changed={...report(['new-one','new-two'],3,0,changedKey),tools:{...report(['new-one','new-two'],3,0,changedKey).tools,paginationReset:true}};
  const reset=applyExecutionReport(second,changed,request(second.tools.nextCursor),selection);expect(reset.tools.items.map(item=>item.toolCallId)).toEqual(['new-one','new-two']);expect(reset.basis.key).toBe(changedKey);
  expect(()=>applyExecutionReport(first,report(['three','four'],5,2,changedKey),request(first.tools.nextCursor),selection)).toThrow('基线');
  expect(()=>applyExecutionReport(first,report(['two','three'],5,2),request(first.tools.nextCursor),selection)).toThrow('重复');
});

it('核实失败保留已确认报告，不把缺日志、取消或未知结果当作未执行',async()=>{
  const read=vi.fn(async()=>report()),controller=new ExecutionReportController(selection,read);await controller.inspect();const prior=controller.snapshot.report;
  read.mockRejectedValueOnce(Error('ENOENT: 读取中断'));await controller.inspect();expect(controller.snapshot.report).toBe(prior);expect(controller.snapshot.error).toContain('ENOENT');expect(read).toHaveBeenCalledTimes(2);
  for(const logState of ['missing','incomplete','invalid','identity_mismatch','unavailable'] as const){const next=report([],0);next.execution='unknown';next.log={state:logState};next.tools.available=false;const html=render(next);expect(html).toContain('执行结果未知');expect(html).toContain('这不表示没有执行任何操作');expect(html).not.toContain('尚未领取执行');expect(html).not.toContain('恢复执行</button>');}
  const cancelled=report();cancelled.basis.runStatus='cancelled';cancelled.log.summaryStatus='cancelled';expect(render(cancelled)).toContain('登记状态：已停止');expect(render(cancelled)).not.toContain('任务未执行');
});

it('报告身份、候选和回执必须属于所选轮次，坏响应不覆盖已有报告',async()=>{
  const read=vi.fn(async()=>report()),controller=new ExecutionReportController(selection,read);await controller.inspect();const prior=controller.snapshot.report;
  read.mockResolvedValueOnce({...report(),identity:{...identity,runId:'different'}});await controller.inspect();expect(controller.snapshot.report).toBe(prior);expect(controller.snapshot.error).toContain('执行轮次');
  expect(()=>applyExecutionReport(undefined,{...report(),candidate:{resultId:'candidate',runId:'different',planRevision:1,acceptance:'not_evaluated'}},request(),selection)).toThrow('其他执行轮次');
  const bad=report();bad.tools.items[0].receipt!.workspaceId='other';expect(()=>applyExecutionReport(undefined,bad,request(),selection)).toThrow('回执');
  expect(()=>applyExecutionReport(undefined,report(),request(),{...selection,scopeId:'wrong'})).toThrow('不属于');
});

it('读取中变化的报告替换旧工具页为未知，图或所属周期变化仅标过期不自动核实',()=>{
  const previous=report(['one','two'],4),changed=report([],0,0,changedKey);changed.consistency='changed_during_read';changed.execution='unknown';changed.tools.available=false;
  const value=applyExecutionReport(previous,changed,request(previous.tools.nextCursor),selection);expect(value.tools.items).toEqual([]);expect(value.execution).toBe('unknown');expect(executionReportStale(value,task(),graphCursor,scope)).toBe(true);
  expect(executionReportStale(report(),task(),graphCursor,scope)).toBe(false);expect(executionReportStale(report(),{...task(),revision:4},graphCursor,scope)).toBe(true);expect(executionReportStale(report(),task(),{...graphCursor,seq:9},scope)).toBe(true);expect(executionReportStale(report(),task(),graphCursor,{...scope,goalRevision:4})).toBe(true);
  const html=render(report(['one','two'],4),true);expect(html).toContain('execution-report-stale');expect(html).toMatch(/data-testid="execution-report-more" disabled/);expect(html).not.toContain('自动重新核实');
});

it('未选择轮次只查询任务登记，不自动选择最新运行；报告独立于正文且不展示其他轮次候选',()=>{
  const {runId,...withoutRun}=identity,empty=report([],0);empty.identity=withoutRun;empty.execution='not_started';empty.log={state:'not_expected'};empty.basis.runStatus=undefined;empty.tools.available=false;
  const value=applyExecutionReport(undefined,empty,{...withoutRun,limit:2},{...selection,runId:undefined});expect(value.identity.runId).toBeUndefined();expect(render(value)).toContain('尚未领取执行');
  const member={...task(),runIds:['old'],result:{resultId:'candidate',runId:'new',planRevision:1,summary:'NEW_RESULT_SENTINEL',limitations:[],evidenceRefs:[],acceptance:'not_evaluated' as const}};
  const html=renderToStaticMarkup(createElement(MemberTaskDetail,{workspaceId:'workspace',rootSessionId:'root',task:member}));expect(html).toContain('核实执行记录');expect(html.indexOf('member-execution-report')).toBeLessThan(html.indexOf('member-run-detail'));expect(html).not.toContain('NEW_RESULT_SENTINEL');
});

function render(value:ExecutionReport,stale=false){return renderToStaticMarkup(createElement(ExecutionReportPanel,{taskId:'member',runId:value.identity.runId,state:{report:value,loading:false,error:'',stale,inspect:async()=>{},more:async()=>{}}}))}
it('报告只含核实与分页操作，候选/工具成功均不宣称业务验收，无输入输出或原生会话路径',()=>{
  const value={...report(),candidate:{resultId:'candidate',runId:'run',planRevision:1,acceptance:'not_evaluated' as const}},html=render(value);
  expect(html).toContain('本轮交付候选 · 尚未验收');expect(html).toContain('收到成功回执');expect(html).toContain('不是业务产物指纹');expect(html).toContain('重新核实');expect(html).not.toContain('批准</button>');expect(html).not.toContain('重试</button>');expect(html).not.toContain('改派</button>');expect(html).not.toContain('恢复</button>');
  expect(()=>applyExecutionReport(undefined,{...value,sessionFile:'PRIVATE_SENTINEL'},request(),selection)).toThrow();
});
