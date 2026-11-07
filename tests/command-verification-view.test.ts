import {expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CommandVerificationController,applyCommandVerification,commandVerificationStale,mainCommandSelection,type CommandVerificationSelection} from '../src/frontend/conversation/command-verification-state';
import {CommandVerificationPanel} from '../src/frontend/conversation/CommandVerificationPanel';
import {ToolActivity} from '../src/frontend/conversation/ToolActivity';
import {commandVerificationToolNames,type CommandVerificationReport,type CommandResultSummary} from '../src/bridge/contracts/command-verification';
import type {RunSummary} from '../src/bridge/contracts/execution';

const identity={workspaceId:'workspace',rootSessionId:'root',runId:'main-run',toolCallId:'original-call'},selection:CommandVerificationSelection={...identity,expectedToolName:'cbim_goal_plan'},time='2026-11-08T00:00:00.000Z';
const hash='a'.repeat(64);
function report():CommandVerificationReport{return {version:1,identity:{...identity},checkedAt:time,basis:{key:hash,adapterVersion:1,logPrefixHash:hash,throughSeq:12},consistency:'stable',source:{state:'verified',toolName:'cbim_goal_plan',runStatus:'failed',proposedSeq:2,allowedSeq:3,finishedSeq:5,inputHash:hash,outcome:'failed'},command:{state:'committed',commandId:'original-command',requestFingerprint:hash,receiptHash:hash,commit:{transactionSeq:4,checksum:hash,executionProtocol:'module_owner_v1'},result:{toolName:'cbim_goal_plan',goalRevision:2,inputRevision:1,planRevision:1,recordedAt:time,criterionCount:1,assignmentCount:1}},scope:{scopeId:'cycle',status:'closed',outcome:'failed'},issues:[],readOnly:true,acceptance:'not_evaluated'}}
function run(toolName='cbim_goal_plan'):RunSummary{return {task:{mode:'chat',taskId:'root',workspaceId:'workspace',root:'test-root',goal:'核实命令',agentId:'cbim:main',moduleIds:[],acceptance:[]},runId:'main-run',status:'failed',acceptance:'not_evaluated',conversationBinding:{workspaceId:'workspace',rootSessionId:'root',teamId:'team',agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-channel'},unresolvedTools:['original-call'],events:[{version:1,seq:2,workspaceId:'workspace',taskId:'root',runId:'main-run',time,type:'tool.proposed',data:{id:'original-call',name:toolName,input:{}}},{version:1,seq:5,workspaceId:'workspace',taskId:'root',runId:'main-run',time,type:'tool.finished',data:{id:'original-call',name:toolName,isError:true,result:'BAD_RETURN: 原回包无效'}}]}}
function render(value:CommandVerificationReport,stale=false,error=''){return renderToStaticMarkup(createElement(CommandVerificationPanel,{selection:{...selection,expectedToolName:value.source.toolName??selection.expectedToolName},state:{report:value,loading:false,error,stale,inspect:async()=>{}}}))}

it('挂载与订阅零查询，在途重复点击合并；卸载迟到回包不写入其它原调用',async()=>{
  let finish!:(value:unknown)=>void;
  const read=vi.fn((_input:unknown)=>new Promise(resolve=>{finish=resolve})),controller=new CommandVerificationController(selection,read),listener=vi.fn();
  const unsubscribe=controller.subscribe(listener);expect(read).not.toHaveBeenCalled();
  const first=controller.inspect();await controller.inspect();expect(read).toHaveBeenCalledTimes(1);expect(read.mock.calls[0][0]).toEqual(identity);
  unsubscribe();controller.cancel();finish(report());await first;expect(controller.snapshot).toEqual({loading:false,error:''});
  const other=new CommandVerificationController({...selection,toolCallId:'different'},read);expect(other.snapshot.report).toBeUndefined();expect(read).toHaveBeenCalledTimes(1);
});

it('刷新失败保留旧报告，不自动重读；后续只能显式核实',async()=>{
  const read=vi.fn(async()=>report()),controller=new CommandVerificationController(selection,read);
  await controller.inspect();const previous=controller.snapshot.report;
  read.mockRejectedValueOnce(Error('IO: 读取失败'));await controller.inspect();expect(controller.snapshot.report).toBe(previous);expect(controller.snapshot.error).toBe('IO: 读取失败');
  await Promise.resolve();expect(read).toHaveBeenCalledTimes(2);
  const html=render(previous!,true,controller.snapshot.error);expect(html).toContain('保留上次报告');expect(html).toContain('原事务已保存');expect(html).not.toContain('重试操作</button>');
  await controller.inspect();expect(read).toHaveBeenCalledTimes(3);expect(controller.snapshot.error).toBe('');
});

it.each(['workspaceId','rootSessionId','runId','toolCallId'] as const)('拒绝跨 %s 回包并保留旧报告',async field=>{
  const read=vi.fn(async()=>report()),controller=new CommandVerificationController(selection,read);await controller.inspect();const previous=controller.snapshot.report,bad=report();bad.identity[field]='different';
  read.mockResolvedValueOnce(bad);await controller.inspect();expect(controller.snapshot.report).toBe(previous);expect(controller.snapshot.error).toContain('原命令');
});

it('拒绝错工具与含私有字段的回包；请求身份不受外部对象修改影响',async()=>{
  const bad=report();bad.source.toolName='cbim_goal_review';bad.command={state:'absent',commandId:'other'};
  expect(()=>applyCommandVerification(bad,selection)).toThrow('工具');
  expect(()=>applyCommandVerification({...report(),privatePrepared:{secret:'credential'}},selection)).toThrow();
  const mutable={...selection},read=vi.fn(async()=>report()),controller=new CommandVerificationController(mutable,read);mutable.runId='different';await controller.inspect();expect(read).toHaveBeenCalledWith(identity);expect(controller.snapshot.error).toBe('');
});

it('原工具失败和原事务已保存同时呈现，不改写原执行结果或验收',()=>{
  const value=report(),before=JSON.stringify(value),html=render(value);
  expect(html).toContain('原工具已返回失败');expect(html).toContain('原事务已保存');expect(html).toContain('本报告不判定业务验收');expect(html).toContain('重新核实原命令');
  expect(html).not.toContain('恢复执行</button>');expect(html).not.toContain('重新执行</button>');expect(JSON.stringify(value)).toBe(before);
});

it('查无回执、坏记录与读取中变化分别保持未知，不说没有执行或可重试',()=>{
  const value=report();value.command={state:'absent',commandId:'original-command'};
  expect(render(value)).toContain('查无回执不表示没有执行，也不构成重新执行的许可');
  value.command={state:'unverifiable',reason:'source_unverified'};value.source={state:'missing'};
  expect(render(value)).toContain('原事务仍无法核实');expect(render(value)).toContain('原调用记录缺失');
  value.consistency='changed_during_read';value.command={state:'unverifiable',reason:'changed_during_read'};
  expect(commandVerificationStale(value,12)).toBe(true);expect(render(value,true)).toContain('读取期间记录发生变化');
});

it('新日志仅提示报告时效，原提交仍展示；序号相同不凭时间推断过期',()=>{
  const value=report();expect(commandVerificationStale(value,12)).toBe(false);expect(commandVerificationStale(value,11)).toBe(false);expect(commandVerificationStale(value,13)).toBe(true);
  expect(render(value,true)).toContain('原事务已保存');expect(render(value,true)).toContain('已保存事实不会因新日志自动撤回');
  delete value.basis.throughSeq;delete value.basis.logPrefixHash;value.command={state:'unverifiable',reason:'source_unverified'};expect(commandVerificationStale(value,999)).toBe(false);
});

it('只给已支持的真实主实例调用显示入口，不为成员、旧无绑定或只读工具创建入口',()=>{
  for(const name of commandVerificationToolNames){const value=run(name),before=JSON.stringify(value),html=renderToStaticMarkup(createElement(ToolActivity,{run:value}));expect(html).toContain('command-verification-panel');expect(html).toContain('BAD_RETURN');expect(html).toContain('执行失败');expect(JSON.stringify(value)).toBe(before)}
  for(const name of ['read','cbim_dispatch_command_report','cbim_goal_inspect','cbim_knowledge_commit'])expect(renderToStaticMarkup(createElement(ToolActivity,{run:run(name)}))).not.toContain('command-verification-panel');
  for(const modify of [(value:RunSummary)=>{delete value.conversationBinding},(value:RunSummary)=>{value.task.mode=undefined},(value:RunSummary)=>{value.task.agentId='executor'},(value:RunSummary)=>{value.conversationBinding!.rootSessionId='other'},(value:RunSummary)=>{value.conversationBinding!.workspaceId='other'}]){const value=run();modify(value);expect(mainCommandSelection(value,'original-call','cbim_goal_plan')).toBeUndefined();expect(renderToStaticMarkup(createElement(ToolActivity,{run:value}))).not.toContain('command-verification-panel')}
});

it('缺少任务身份的旧工具轨道仍能展示错误，不生成主命令或影响观察入口',()=>{
  const complete=run(),{task:_task,...old}=complete,value=old as RunSummary;
  expect(mainCommandSelection(value,'original-call','cbim_goal_plan')).toBeUndefined();
  const html=renderToStaticMarkup(createElement(ToolActivity,{run:value}));expect(html).toContain('BAD_RETURN');expect(html).not.toContain('command-verification-panel');expect(html).not.toContain('effect-observation-panel');
});

it('八种保存结果均使用控制面事实文案，预约不等于启动，放弃不等于回滚',()=>{
  const cursor={workspaceId:'workspace',rootSessionId:'root',streamId:'graph',seq:10},graphCursor={streamId:'graph',seq:10},tracked={total:0,taskIds:[],truncated:false};
  const results:CommandResultSummary[]=[
    {toolName:'cbim_goal_plan',goalRevision:2,inputRevision:1,planRevision:1,recordedAt:time,criterionCount:2,assignmentCount:3},
    {toolName:'cbim_goal_review',goalRevision:2,inputRevision:1,planRevision:1,recordedAt:time,reviewRevision:1,decision:'replan',checkCount:2},
    {toolName:'cbim_dispatch_task',taskId:'task',messageId:'message',cursor,disposition:'queued'},
    {toolName:'cbim_dispatch_cancel',cancelled:tracked,graphCursor},
    {toolName:'cbim_dispatch_replace_dependency',taskId:'task',status:'queued',retiredEdgeId:'old',replacementEdgeId:'new',sourceTaskId:'source',sourceRunId:'source-run',sourceResultId:'result',tracked,graphCursor},
    {toolName:'cbim_dispatch_add_dependency',taskId:'task',status:'waiting',edgeId:'edge',sourceTaskId:'source',tracked,graphCursor},
    {toolName:'cbim_dispatch_resume',taskId:'task',checkpointId:'checkpoint',requestId:'request',tracked,cursor},
    {toolName:'cbim_dispatch_abandon_checkpoint',taskId:'task',status:'cancelled',checkpointId:'checkpoint',sourceRunId:'source-run',resumeRequestId:null,previousLeaseEpoch:1,nextLeaseEpoch:2,abandonedAt:time,graphCursor},
  ];
  for(const result of results){const value=report();value.source.toolName=result.toolName;if(value.command.state==='committed')value.command.result=result;const html=render(value);expect(html).toContain('原事务已保存');expect(html).toContain('本报告不判定业务验收');if(result.toolName==='cbim_dispatch_resume')expect(html).toContain('预约不代表已经启动');if(result.toolName==='cbim_dispatch_abandon_checkpoint')expect(html).toContain('不是回滚或交付成功')}
});
