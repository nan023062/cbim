import {expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ExecutionRecoveryController,ExecutionRecoveryPool,checkedRecoveryReceipt,recoveryRejected,type RecoveryPorts,type RecoveryTarget} from '../src/frontend/tasks/recovery-state';
import {recoveryTarget,recoverySourceReason,type ExecutionRecoveryView} from '../src/frontend/tasks/useExecutionRecovery';
import {ExecutionReportController} from '../src/frontend/tasks/execution-report-state';
import {ExecutionRecoveryForm} from '../src/frontend/tasks/ExecutionRecoveryForm';
import {ThreadHistoryNotice,threadResumeRun} from '../src/frontend/conversation/ThreadHistoryNotice';
import {conversationUsage} from '../src/frontend/conversation/usage';
import {UsageStatus} from '../src/frontend/conversation/UsageStatus';
import type {RecoveryRequest,RecoveryReceipt,ExecutionReport,TaskNode,GraphSnapshot,ScopeSummary} from '../src/bridge/contracts/dispatch';
import type {RunSummary,ConversationThreadView} from '../src/bridge/contracts/execution';
import type {ScopeGoalState} from '../src/frontend/tasks/scope-state';

const time='2026-11-07T00:00:00.000Z',command='22222222-2222-4222-8222-222222222222';
const target={workspaceId:'workspace',rootSessionId:'root',source:{scopeId:'old-scope',taskId:'member',runId:'old-run',reportBasis:'a'.repeat(64)}} satisfies RecoveryTarget;
const options={provider:'cbim-11111111-1111-4111-8111-111111111111',profileId:'11111111-1111-4111-8111-111111111111',model:'model',permission:'read' as const};
function receipt(request:RecoveryRequest):RecoveryReceipt{if('kind' in request.source)throw Error('此夹具仅测试旧成员来源');return {workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,scopeId:request.commandId,scopeStatus:'active',recovery:{recoveryId:request.commandId,acceptedAt:time,source:{...request.source,taskRevision:3,planRevision:1,scopeOutcome:'failed',reportExecution:'unknown',logState:'missing',unknownToolCount:1},operation:request.operation,observation:{...request.observation},input:{...request.input},options:structuredClone(request.options),runId:'new-run'}}}
function fixture(submit:RecoveryPorts['submit']=async request=>receipt(request),lookup:RecoveryPorts['lookup']=async()=>undefined){
  const saved=new Map<string,string>(),ports:RecoveryPorts={storage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>{saved.set(key,value)}},submit:vi.fn(submit),lookup:vi.fn(lookup),uuid:()=>command};
  const controller=new ExecutionRecoveryController(target.workspaceId,target.rootSessionId,ports);return {controller,ports,saved,send:vi.mocked(ports.submit),query:vi.mocked(ports.lookup)};
}
const fields={observation:'  已看到文件存在，但结果尚未确认\n  ',message:'  只读核实哪些操作已经影响产物  '};

it('显式发送前保存完整请求；观察与目标分离且权限只能read，双击不重复创建',async()=>{
  let finish!:(value:unknown)=>void;const f=fixture(request=>{expect(JSON.parse(f.saved.get(f.controller.storageKey)!).records[0].attempt.request).toEqual(request);return new Promise(resolve=>{finish=resolve})});
  f.controller.edit(target.source,fields);const running=f.controller.submit(target,options);await f.controller.submit(target,options);expect(f.send).toHaveBeenCalledTimes(1);
  const request=f.send.mock.calls[0][0];expect(request.observation.text).toBe(fields.observation);expect(request.input.message).toBe(fields.message);expect(request.options.permission).toBe('read');expect(request).not.toHaveProperty('attachments');
  finish(receipt(request));await running;expect(f.controller.record(target.source)?.attempt?.phase).toBe('accepted');
  f.controller.edit(target.source,{...fields,message:'不能改写'});await f.controller.submit(target,options);expect(f.send).toHaveBeenCalledTimes(1);
  const wrong=fixture();wrong.controller.edit(target.source,fields);await wrong.controller.submit(target,{...options,permission:'execute' as 'read'});expect(wrong.send).not.toHaveBeenCalled();expect(wrong.controller.snapshot.error).toContain('无效');
});

it('未知请求跨报告版本仍锁定，同ID重试冻结正文和模型，undefined不是未执行',async()=>{
  const f=fixture(async()=>{throw Error('IPC_TIMEOUT')});f.controller.edit(target.source,fields);await f.controller.submit(target,options);const request=f.send.mock.calls[0][0];
  f.controller.edit({...target.source},{observation:'修改',message:'修改'});await f.controller.submit({...target,source:{...target.source,reportBasis:'b'.repeat(64)}},{...options,model:'other'});
  expect(f.send).toHaveBeenCalledTimes(1);expect(f.controller.record(target.source)?.message).toBe(fields.message);
  await f.controller.query(target.source);expect(f.query.mock.calls[0][0]).toEqual({workspaceId:'workspace',rootSessionId:'root',commandId:command});expect(f.controller.record(target.source)?.attempt?.phase).toBe('unknown');
  f.send.mockImplementation(async request=>receipt(request));await f.controller.retry(target.source);expect(f.send.mock.calls[1][0]).toEqual(request);expect(f.controller.record(target.source)?.attempt?.phase).toBe('accepted');
});

it('已受理但响应丢失，重开仅查原命令；节点切换不覆盖另一来源草稿',async()=>{
  let accepted:RecoveryReceipt|undefined;const f=fixture(async request=>{accepted=receipt(request);throw Error('连接中断')},async()=>accepted);
  f.controller.edit(target.source,fields);await f.controller.submit(target,options);f.controller.edit({...target.source,taskId:'another'}, {observation:'另一现象',message:'另一核实目标'});
  const reopened=new ExecutionRecoveryController('workspace','root',f.ports);expect(reopened.record(target.source)?.attempt?.phase).toBe('unknown');await reopened.restore();
  expect(f.send).toHaveBeenCalledTimes(1);expect(reopened.record(target.source)?.attempt?.phase).toBe('accepted');expect(reopened.record({...target.source,taskId:'another'})?.message).toBe('另一核实目标');
  await reopened.retry(target.source);expect(f.send).toHaveBeenCalledTimes(1);
});

it('工作区重访复用在途控制器，迟到回执只能写原来源；错误回执保持未知',async()=>{
  let finish!:(value:unknown)=>void;const f=fixture(()=>new Promise(resolve=>{finish=resolve})),pool=new ExecutionRecoveryPool(1),first=pool.get('workspace','root',f.ports);
  first.edit(target.source,fields);const pending=first.submit(target,options);pool.get('workspace','another-root',f.ports);expect(pool.get('workspace','root',f.ports)).toBe(first);
  const request=f.send.mock.calls[0][0];finish({...receipt(request),rootSessionId:'other'});await pending;expect(first.record(target.source)?.attempt?.phase).toBe('unknown');
  expect(()=>checkedRecoveryReceipt({...receipt(request),scopeId:target.source.scopeId},request)).toThrow('不一致');
  expect(()=>checkedRecoveryReceipt({...receipt(request),recovery:{...receipt(request).recovery,input:{message:'改写目标'}}},request)).toThrow('不一致');
  const other=new ExecutionRecoveryController('workspace','other-root',f.ports);expect(other.snapshot.records).toEqual([]);await other.submit(target,options);expect(f.send).toHaveBeenCalledTimes(1);
});

it('明确预受理拒绝允许修正，曾未知后的拒绝及命令冲突不释放原请求',async()=>{
  const f=fixture(async()=>{throw Error('RECOVERY_REPORT_STALE: 依据已变化')});f.controller.edit(target.source,fields);await f.controller.submit(target,options);expect(f.controller.record(target.source)?.attempt?.phase).toBe('rejected');f.controller.edit(target.source,{...fields,message:'修正核实目标'});expect(f.controller.record(target.source)?.message).toBe('修正核实目标');
  const unknown=fixture(async()=>{throw Error('网络中断')});unknown.controller.edit(target.source,fields);await unknown.controller.submit(target,options);unknown.send.mockRejectedValueOnce(Error('RECOVERY_REPORT_STALE: 旧基线'));await unknown.controller.retry(target.source);expect(unknown.controller.record(target.source)?.attempt?.phase).toBe('unknown');
  for(const code of ['RECOVERY_COMMAND_CONFLICT','COMMAND_ID_CONFLICT','RECOVERY_UNKNOWN','COLLABORATION_STOPPED'])expect(recoveryRejected(Error(code+': 不能解冻'))).toBe(false);
});

it('本机保存失败不发送，损坏本地记录不覆盖；已有受理不因查询失败降为未受理',async()=>{
  const f=fixture();f.controller.edit(target.source,fields);const save=f.ports.storage.setItem;f.ports.storage.setItem=()=>{throw Error('QuotaExceededError')};await f.controller.submit(target,options);expect(f.send).not.toHaveBeenCalled();expect(f.controller.snapshot.error).toContain('未能保存');
  f.ports.storage.setItem=save;await f.controller.submit(target,options);expect(f.send).toHaveBeenCalledTimes(1);f.query.mockRejectedValueOnce(Error('查询断开'));await f.controller.query(target.source);expect(f.controller.record(target.source)?.attempt?.phase).toBe('accepted');
  f.saved.set(f.controller.storageKey,'{broken');const broken=new ExecutionRecoveryController('workspace','root',f.ports);broken.edit(target.source,fields);await broken.submit(target,options);expect(broken.available).toBe(false);expect(f.saved.get(f.controller.storageKey)).toBe('{broken');expect(f.send).toHaveBeenCalledTimes(1);
});

it('同命令只允许周期状态更新，不能覆盖已受理运行或可信来源事实',async()=>{
  const f=fixture();f.controller.edit(target.source,fields);await f.controller.submit(target,options);const request=f.send.mock.calls[0][0],original=f.controller.record(target.source)!.attempt!.receipt!;
  expect(()=>checkedRecoveryReceipt({...original,scopeId:'different-new-scope'},request)).toThrow('不一致');
  for(const change of [{runId:'other-run'},{acceptedAt:'2026-11-08T00:00:00.000Z'},{source:{...original.recovery.source,unknownToolCount:2}}]){
    f.query.mockResolvedValueOnce({...original,recovery:{...original.recovery,...change}});await f.controller.query(target.source);
    expect(f.controller.record(target.source)?.attempt?.receipt).toBe(original);expect(f.controller.record(target.source)?.attempt?.error).toContain('冲突');
  }
  f.query.mockResolvedValueOnce({...original,scopeStatus:'closed'});await f.controller.query(target.source);expect(f.controller.record(target.source)?.attempt?.receipt?.scopeStatus).toBe('closed');
  f.query.mockResolvedValueOnce(original);await f.controller.query(target.source);expect(f.controller.record(target.source)?.attempt?.receipt?.scopeStatus).toBe('closed');expect(f.controller.record(target.source)?.attempt?.error).toContain('冲突');
});

function graphFixture(){
  const identity={workspaceId:'workspace',rootSessionId:'root'},agent={agentId:'cbim:executor',agentInstanceId:'instance',agentSessionId:'channel',name:'执行 Agent'},cursor={...identity,streamId:'graph',seq:8};
  const task:TaskNode={kind:'task',nodeId:'task:member',taskId:'member',scopeId:'old-scope',identity,requester:{...agent,agentId:'cbim:main'},assignee:agent,modules:[],goal:'旧目标',acceptance:[],revision:3,planRevision:1,status:'failed',awaitedChildren:[],runIds:['old-run'],createdAt:time,updatedAt:time};
  const scope:ScopeSummary={scopeId:'old-scope',status:'closed',outcome:'failed',createdAt:time,closedAt:time,hasGoal:true,hasPlan:true,goalRevision:3,stamp:{scopeId:'old-scope',streamId:'scopes:graph',seq:3}};
  const graph:GraphSnapshot={version:1,identity,cursor,root:{kind:'session-root',nodeId:'session:root',identity,agent:{...agent,agentId:'cbim:main'},revision:1,createdAt:time},tasks:[task],edges:[],agents:[]};
  const view={phase:'failed',label:'目标未完成',tone:'warning' as const},state:ScopeGoalState={graph,scopes:[scope],selectedScopeId:scope.scopeId,selectedGoalView:view,currentGoalView:view,loading:false,detailLoading:false,error:'',selectScope:()=>{}};
  const report:ExecutionReport={identity:{...identity,taskId:'member',runId:'old-run'},checkedAt:time,basis:{key:target.source.reportBasis,graphCursor:cursor,taskRevision:3,planRevision:1,taskStatus:'failed',scopeId:scope.scopeId,scopeStatus:'closed',goalRevision:3,runStatus:'failed'},consistency:'stable',execution:'unknown',log:{state:'missing'},tools:{available:false,total:0,counts:{succeeded:0,failed:0,denied:0,unknown:0,not_authorized:0},items:[],paginationReset:false},issues:[],next:{kind:'new_cycle_only',reason:'只创建新周期'}};
  return {task,scope,graph,state,report};
}
it('新请求必须来源closed且当前无开放周期，历史筛选不改变此条件；未知日志可以核实',()=>{
  const f=graphFixture(),check=(state=f.state,report=f.report,task=f.task)=>recoveryTarget('workspace','root',task,report.identity.runId,report,false,state);
  expect(check().target).toEqual(target);expect(check({...f.state,selectedScopeId:'different-history'}).target).toEqual(target);
  expect(check({...f.state,scopes:[{...f.scope,status:'waiting'}]}).target).toBeUndefined();expect(check({...f.state,openScope:{...f.scope,scopeId:'current',status:'active'}}).target).toBeUndefined();
  expect(check({...f.state,graph:{...f.graph,cursor:{...f.graph.cursor,seq:9}}}).target).toBeUndefined();expect(check(f.state,{...f.report,consistency:'changed_during_read'}).target).toBeUndefined();expect(recoveryTarget('workspace','root',f.task,undefined,f.report,false,f.state).target).toBeUndefined();
  const task={...f.task,runIds:[]},noRun={...f.report,identity:{workspaceId:'workspace',rootSessionId:'root',taskId:'member'},execution:'not_started' as const,log:{state:'not_expected' as const}};
  expect(check(f.state,noRun,task).target?.source.runId).toBeUndefined();expect(check(f.state,noRun,task).target).toBeDefined();
  const cancelled={...task,status:'cancelled' as const},unknown={...noRun,execution:'unknown' as const,log:{state:'not_selected' as const},basis:{...noRun.basis,taskStatus:'cancelled' as const}};
  const cancelledState={...f.state,graph:{...f.graph,tasks:[cancelled]}};
  expect(check(cancelledState,unknown,cancelled).target).toBeDefined();
  expect(check(cancelledState,unknown,{...cancelled,runIds:['old-run']}).target).toBeUndefined();
  expect(recoverySourceReason('workspace','root',f.task,'old-run',f.state)).toBe('');
  expect(recoverySourceReason('workspace','root',f.task,'old-run',{...f.state,openScope:{...f.scope,status:'waiting'}})).toContain('未结束');
  expect(check({...f.state,loading:true}).target).toBeUndefined();expect(check(f.state,f.report,{...f.task,scopeId:undefined}).target).toBeUndefined();
});

it('表单观察与目标分开；未知请求只有查询和同命令重试，受理不宣称已执行或人工通过',()=>{
  const request:RecoveryRequest={...target,commandId:command,operation:'inspect_effects',observation:{text:fields.observation},input:{message:fields.message},options};
  const base:ExecutionRecoveryView={visible:true,observation:fields.observation,message:fields.message,editable:false,canSubmit:false,canPrepare:false,pending:false,error:'',reason:'',modelLabel:'model · 只读访问',edit:()=>{},submit:async()=>{},prepare:async()=>{},query:async()=>{},retry:async()=>{},showCreated:()=>{}};
  const unknown=renderToStaticMarkup(createElement(ExecutionRecoveryForm,{state:{...base,record:{source:target.source,...fields,attempt:{request,phase:'unknown',uncertain:true}}}}));
  expect(unknown).toContain('你的观察');expect(unknown).toContain('新的核实目标');expect(unknown).toContain('不重放旧工具');expect(unknown).toContain('不代表人工验收');expect(unknown).toContain('execution-recovery-query');expect(unknown).toContain('execution-recovery-retry');expect(unknown).not.toContain('execution-recovery-submit');expect(unknown).toMatch(/readonly=""/i);
  const accepted=renderToStaticMarkup(createElement(ExecutionRecoveryForm,{state:{...base,record:{source:target.source,...fields,attempt:{request,phase:'accepted',uncertain:false,receipt:receipt(request)}}}}));expect(accepted).toContain('新核实周期已受理');expect(accepted).toContain('查看新目标');expect(accepted).not.toContain('execution-recovery-retry');
  expect(accepted).not.toContain('execution-recovery-prepare');
  const archive={request,phase:'accepted' as const,uncertain:false,receipt:{...receipt(request),scopeStatus:'closed' as const}};
  const closed=renderToStaticMarkup(createElement(ExecutionRecoveryForm,{state:{...base,canPrepare:true,record:{source:target.source,...fields,attempt:archive}}}));expect(closed).toContain('execution-recovery-prepare');expect(closed).not.toContain('execution-recovery-submit');
  const prepared=renderToStaticMarkup(createElement(ExecutionRecoveryForm,{state:{...base,reason:'请重新核实来源报告，再提交新的核实任务。',record:{source:target.source,...fields,history:[archive]}}}));
  expect(prepared).toContain('execution-recovery-history');expect(prepared).toContain('execution-recovery-history-item');expect(prepared).toContain(command);expect(prepared).toContain('请重新核实来源报告');expect(prepared).toMatch(/data-testid="execution-recovery-submit" disabled/);expect(prepared).toContain(fields.message);
});

it('归档准备同步清除同来源各视图报告，迟到旧读取无效，必须显式重读；其他节点保持原报告',async()=>{
  const graph=graphFixture(),f=fixture(async request=>({...receipt(request),scopeStatus:'closed'}));
  f.controller.edit(target.source,fields);await f.controller.submit(target,options);
  f.query.mockResolvedValue({...receipt(f.send.mock.calls[0][0]),scopeStatus:'closed'});
  let finish!:(value:ExecutionReport)=>void;const read=vi.fn(async()=>graph.report),one=new ExecutionReportController({...target.source,workspaceId:'workspace',rootSessionId:'root'},read),two=new ExecutionReportController({...target.source,workspaceId:'workspace',rootSessionId:'root'},read);
  await one.inspect();await two.inspect();read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));const late=one.inspect();
  const different=vi.fn(),stopOne=f.controller.subscribeSource(target.source,()=>{},()=>one.invalidate()),stopTwo=f.controller.subscribeSource(target.source,()=>{},()=>two.invalidate()),stopOther=f.controller.subscribeSource({...target.source,taskId:'another'},()=>{},different);
  expect(await f.controller.prepareAgain(target.source,command)).toBe(true);
  expect(one.snapshot).toEqual({loading:false,error:''});expect(two.snapshot).toEqual({loading:false,error:''});expect(different).not.toHaveBeenCalled();expect(read).toHaveBeenCalledTimes(3);expect(f.send).toHaveBeenCalledTimes(1);
  finish(graph.report);await late;expect(one.snapshot.report).toBeUndefined();expect(recoveryTarget('workspace','root',graph.task,'old-run',one.snapshot.report,false,graph.state).target).toBeUndefined();
  await one.inspect();expect(one.snapshot.report).toEqual(graph.report);expect(two.snapshot.report).toBeUndefined();expect(recoveryTarget('workspace','root',graph.task,'old-run',one.snapshot.report,false,graph.state).target).toEqual(target);
  // 刚挂载的第二处视图在 render 与订阅之间错过归档，也必须清旧缓存。
  const missed=vi.fn();const stopMissed=f.controller.subscribeSource(target.source,()=>{},missed,0);expect(missed).toHaveBeenCalledTimes(1);
  stopOne();stopTwo();stopOther();stopMissed();
});

it('坏历史独立占位，不制造运行或从较早可读记录回退续接头',()=>{
  const run:RunSummary={task:{taskId:'root',workspaceId:'workspace',root:'path',goal:'旧正常记录',moduleIds:[],acceptance:[]},runId:'old-readable',status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events:[]};
  const view:ConversationThreadView={runs:[run],issues:[{runId:'latest-broken',code:'RUN_LOG_INVALID',message:'运行记录不完整'}]};
  expect(threadResumeRun(view.runs,view.resumeRunId)).toBeUndefined();expect(threadResumeRun(view.runs,'missing')).toBeUndefined();expect(threadResumeRun(view.runs,'old-readable')).toBe(run);
  const html=renderToStaticMarkup(createElement(ThreadHistoryNotice,{issues:view.issues}));expect(html).toContain('运行记录不完整');expect(html).toContain('latest-broken');expect(html).not.toContain('<button');expect(html).not.toContain('执行成功');expect(view.runs).toEqual([run]);
});

it('可信当前头决定状态和上下文；旧异常running不增长时间，已知费用仍逐轮累加',()=>{
  const make=(runId:string,status:RunSummary['status'],tokens:number):RunSummary=>({task:{taskId:'root',workspaceId:'workspace',root:'path',goal:'核实',moduleIds:[],acceptance:[]},runId,status,acceptance:'not_evaluated',unresolvedTools:[],events:[
    {type:'run.started',time:'2026-11-07T00:00:00.000Z',data:{}},
    {type:'message',time:'2026-11-07T00:00:01.000Z',data:{usage:{input:10,output:5,cost:{total:0.5}},pricingKnown:true,generationDurationMs:1000}},
    {type:'engine.status',time:'2026-11-07T00:00:02.000Z',data:{metric:'context',contextWindow:1000,tokens}},
  ].map((event,index)=>({...event,version:1,seq:index+1,workspaceId:'workspace',taskId:'root',runId})) as RunSummary['events']});
  const old=make('old','running',900),head=make('head','completed',100),runs=[head,old],now=Date.parse('2026-11-07T00:10:00.000Z');
  expect(conversationUsage(runs,now,head)).toMatchObject({used:100,capacity:1000,cost:1,durationMs:4000});
  expect(conversationUsage(runs,now+60000,head).durationMs).toBe(4000);expect(conversationUsage(runs,now,null).used).toBeUndefined();
  const status=renderToStaticMarkup(createElement(UsageStatus,{runs,currentRun:head,now,placement:'above'}));expect(status).not.toContain('usage-sparkle');
  const none=renderToStaticMarkup(createElement(UsageStatus,{runs,currentRun:null,now,placement:'footer',historyIncomplete:true}));expect(none).toContain('已知部分 $1.0000');expect(none).toContain('待更新');expect(none).not.toContain('90%');
});
