import {expect,test,vi} from 'vitest';
import {hash,json} from '../src/core/platform/node/serialization';
import {Fault} from '../src/core/errors';
import {restoreMainCommand} from '../src/logic/tasks/runtime/main-command-request';
import {DispatchTools} from '../src/logic/tools/runtime/dispatch-tools';
import {authorizeRunTool} from '../src/logic/tools/rules/policy/tool-policy';
import {reportBinding as binding,reportIdentity as identity,reportInputs,reportFixture,evidenceFor,rawInputHash} from './command-verification-fixture';

test.each(reportInputs())('$name 历史指纹与原canonical输入分开，失败回包不抹去已提交命令',async({name,input})=>{
  const restored=restoreMainCommand(name,binding,identity.toolCallId,input,7),evidence=evidenceFor(name,restored.input,restored.commandId,restored.fingerprint!);
  const f=reportFixture(name,input,evidence),before=structuredClone(f.summary);
  const report=await f.service.read(identity);
  expect(report).toMatchObject({source:{state:'verified',outcome:'failed',inputHash:rawInputHash(input)},command:{state:'committed',commandId:restored.commandId,requestFingerprint:restored.fingerprint,result:{toolName:name}},consistency:'stable',readOnly:true,acceptance:'not_evaluated'});
  expect(f.summary).toEqual(before);expect(f.commandEvidence).toHaveBeenCalledTimes(2);expect(f.read).toHaveBeenCalledTimes(2);expect(f.inspectMain).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(report)).not.toContain('原用户目标');expect(report.command).not.toHaveProperty('receipt');expect(report.command).not.toHaveProperty('prepared');
});

test('旧pre-owner派发保留默认角色/空前置，原隐藏父版本不取当前根；旧goal不要求新ownerSelection',async()=>{
  const raw={acceptance:[{text:' 完成 ',id:'c'}],goal:' 旧任务 ',moduleIds:[' app ']},identityOnly={workspaceId:identity.workspaceId,rootSessionId:identity.rootSessionId};
  const got=restoreMainCommand('cbim_dispatch_task',binding,identity.toolCallId,raw,7);
  const commandId='auto-task-'+hash(json({identity:identityOnly,runId:identity.runId,toolCallId:identity.toolCallId}));
  expect(got.commandId).toBe(commandId);expect(got.input).toEqual({agentId:'cbim:executor',moduleIds:['app'],goal:'旧任务',acceptance:[{id:'c',text:'完成'}],prerequisites:[]});
  expect(got.fingerprint).toBe(hash(json({operation:'dispatch',actor:'desktop-local-user',input:{...identityOnly,commandId,expectedParentRevision:7,task:{assigneeAgentId:'cbim:executor',moduleIds:['app'],goal:'旧任务',acceptance:[{id:'c',text:'完成'}],prerequisites:[]},scopeId:binding.scopeId}})));
  const f=reportFixture('cbim_dispatch_task',raw,evidenceFor('cbim_dispatch_task',got.input,got.commandId,got.fingerprint!));f.state.graphs[0].root.revision=999;
  // 只读端口模拟旧协议允许的后续计划/assignee修订，不授予这份旧投影新的运行权限。
  f.state.graphs[0].tasks[0].planRevision=2;f.state.graphs[0].tasks[0].assignee={agentId:'later-agent',agentInstanceId:'later-instance',agentSessionId:'later-session',name:'后来修订'};
  expect((await f.service.read(identity)).command.state).toBe('committed');
  const plan=reportInputs()[0];expect(()=>restoreMainCommand(plan.name,binding,identity.toolCallId,plan.input)).not.toThrow();
  expect(restoreMainCommand('cbim_dispatch_task',binding,identity.toolCallId,{...raw,agentId:'cbim:executor'},7).fingerprint).toBe(got.fingerprint);
  expect(rawInputHash(raw)).not.toBe(rawInputHash({...raw,agentId:'cbim:executor'}));
});

test('已支持主命令指纹保持原字段键序/操作域；cancel没有凭空goalRevision，resume没有command正文',()=>{
  const pair={workspaceId:identity.workspaceId,rootSessionId:identity.rootSessionId};
  for(const c of reportInputs()){
    const r=restoreMainCommand(c.name,binding,identity.toolCallId,c.input,7);
    if(c.name==='cbim_dispatch_task')continue;
    const operation={cbim_goal_plan:'goal.plan',cbim_goal_review:'goal.review',cbim_dispatch_cancel:'dispatch.cancelQueued',cbim_dispatch_replace_dependency:'dispatch.replaceDependency',cbim_dispatch_add_dependency:'dispatch.addDependency',cbim_dispatch_revise_dependencies:'dispatch.reviseDependencies',cbim_dispatch_resume:'member.resume.request',cbim_dispatch_abandon_checkpoint:'member.checkpoint.abandon'}[c.name];
    const original=c.name.startsWith('cbim_goal_')?{operation,identity:pair,scopeId:binding.scopeId,runId:binding.runId,draft:r.input}:c.name==='cbim_dispatch_resume'?{operation,identity:pair,scopeId:binding.scopeId,mainRunId:binding.runId,input:r.input}:{operation,context:{...pair,scopeId:binding.scopeId,...(c.name==='cbim_dispatch_abandon_checkpoint'?{mainRunId:binding.runId}:{runId:binding.runId}),commandId:r.commandId},input:r.input};
    expect(r.fingerprint).toBe(hash(json(original)));
  }
  expect(()=>restoreMainCommand('cbim_dispatch_resume',binding,identity.toolCallId,{...(reportInputs()[6].input as object),expectedPlanRevision:1})).toThrow();
});

test('不支持、未授权、跨root/缺原绑定和重复scope不查询原命令，也不泄漏输入',async()=>{
  for(const name of ['cbim_dispatch_inspect','read','bash','cbim_dispatch_command_report']){
    const f=reportFixture(name,{secret:'private'}),report=await f.service.read(identity);expect(report.command.state).toBe('not_applicable');expect(f.commandEvidence).not.toHaveBeenCalled();expect(JSON.stringify(report)).not.toContain('private');
  }
  const mutations:Array<(f:ReturnType<typeof reportFixture>)=>void>=[f=>{f.summary.task.taskId='other-root'},f=>{delete f.summary.conversationBinding},f=>{f.state.scopes!.push({...f.state.scopes![0],scopeId:'ambiguous'})},f=>{f.summary.events=f.summary.events.slice(0,2);f.summary.toolReceipts=[]}];
  for(const mutate of mutations){
    const one=reportInputs()[0],f=reportFixture(one.name,one.input);mutate(f);expect((await f.service.read(identity)).command.state).toBe('unverifiable');expect(f.commandEvidence).not.toHaveBeenCalled();
  }
});

test('查无只报告absent；坏fp/缺派发前态/坏receipt明确未知，IO和畸形日志不当查无',async()=>{
  const one=reportInputs()[2],r=restoreMainCommand(one.name,binding,identity.toolCallId,one.input,7);
  expect((await reportFixture(one.name,one.input).service.read(identity)).command).toEqual({state:'absent',commandId:r.commandId});
  for(const [reason,mutate] of [['fingerprint_mismatch',(e:any)=>{e.fingerprint=hash('another')}],['missing_prestate',(e:any)=>{delete e.graph}],['receipt_invalid',(e:any)=>{e.receipt.cursor.rootSessionId='foreign'}],['receipt_invalid',(e:any)=>{e.receipt.cursor.seq=999}],['receipt_invalid',(e:any)=>{e.receipt.taskId='foreign'}],['receipt_invalid',(e:any)=>{e.receipt.messageId='foreign'}],['receipt_invalid',(e:any)=>{e.commit.transactionSeq=0}]] as const){const e=evidenceFor(one.name,r.input,r.commandId,r.fingerprint!);mutate(e);expect((await reportFixture(one.name,one.input,e).service.read(identity)).command).toEqual({state:'unverifiable',reason})}
  for(const [code,state] of [['ENOENT','missing'],['RUN_LOG_EMPTY','incomplete'],['RUN_LOG_INVALID','invalid'],['EIO','unavailable']] as const){const f=reportFixture(one.name,one.input);f.inspectMain.mockRejectedValue(new Fault(code,'private failed bytes'));const report=await f.service.read(identity);expect(report.source.state).toBe(state);expect(report.command.state).toBe('unverifiable');expect(JSON.stringify(report)).not.toContain('private');expect(f.commandEvidence).not.toHaveBeenCalled()}
  const f=reportFixture(one.name,one.input);f.commandEvidence.mockRejectedValue(new Error('secret IO'));expect((await f.service.read(identity)).command).toEqual({state:'unverifiable',reason:'store_unavailable'});
});

test('原事实在读取期间变化时不返回旧committed，取消/关闭不落任何记录',async()=>{
  const one=reportInputs()[0],r=restoreMainCommand(one.name,binding,identity.toolCallId,one.input),e=evidenceFor(one.name,r.input,r.commandId,r.fingerprint!);
  for(const change of ['log','scope','command'] as const){const f=reportFixture(one.name,one.input,e);if(change==='log')f.inspectMain.mockImplementationOnce(async()=>{const old=structuredClone(f.summary);f.summary.events.push({...f.summary.events[0],seq:5,type:'message',data:{text:'later'}});return old});if(change==='scope')f.read.mockImplementationOnce(async()=>{const old=structuredClone(f.state);f.state.scopes![0].goal!.revision++;return old});if(change==='command')f.commandEvidence.mockResolvedValueOnce(e).mockResolvedValueOnce(undefined);expect(await f.service.read(identity)).toMatchObject({consistency:'changed_during_read',command:{state:'unverifiable',reason:'changed_during_read'}})}
  const f=reportFixture(one.name,one.input,e),controller=new AbortController();f.inspectMain.mockImplementationOnce(async()=>{controller.abort(new Error('stopped read'));return structuredClone(f.summary)});await expect(f.service.read(identity,controller.signal)).rejects.toThrow('stopped read');expect(f.commandEvidence).not.toHaveBeenCalled();
  const closed=reportFixture(one.name,one.input,e);closed.owner.assert.mockImplementation(()=>{throw Error('closed')});await expect(closed.service.read(identity)).rejects.toThrow('closed');expect(closed.read).not.toHaveBeenCalled();expect(closed.inspectMain).not.toHaveBeenCalled();
});

test('未知工具结论不因command提交被清除；八写错误授权分类不成为可信命令',async()=>{
  const one=reportInputs()[0],r=restoreMainCommand(one.name,binding,identity.toolCallId,one.input),f=reportFixture(one.name,one.input,evidenceFor(one.name,r.input,r.commandId,r.fingerprint!));
  f.summary.events=f.summary.events.slice(0,3);f.summary.toolReceipts=[];f.summary.unresolvedTools=[identity.toolCallId];expect(await f.service.read(identity)).toMatchObject({source:{outcome:'unknown'},command:{state:'committed'}});expect(f.summary.unresolvedTools).toEqual([identity.toolCallId]);
  f.summary.events[2].data.effects=['read'];expect((await f.service.read(identity)).source.state).toBe('invalid');
});

test('重复run.started、终态后工具及重复终态拒绝；真实在途与迟到stop不伪造终态',async()=>{
  const one=reportInputs()[0],r=restoreMainCommand(one.name,binding,identity.toolCallId,one.input),e=evidenceFor(one.name,r.input,r.commandId,r.fingerprint!);
  for(const kind of ['start','early-terminal','duplicate-terminal'] as const){const f=reportFixture(one.name,one.input,e),base=f.summary.events[0];
    if(kind==='start')f.summary.events.splice(1,0,{...base});
    else if(kind==='early-terminal')f.summary.events.splice(1,0,{...base,type:'run.settled',data:{status:'completed'}});
    else f.summary.events.push({...base,type:'run.settled',data:{status:'completed'}},{...base,type:'run.interrupted',data:{}});
    f.summary.events.forEach((event,index)=>event.seq=index+1);expect((await f.service.read(identity)).source.state).toBe('invalid');expect(f.commandEvidence).not.toHaveBeenCalled();
  }
  const f=reportFixture(one.name,one.input,e),base=f.summary.events[0];f.summary.events.push({...base,seq:5,type:'run.settled',data:{status:'completed'}},{...base,seq:6,type:'run.stop_requested',data:{}});f.summary.status='completed';expect((await f.service.read(identity)).command.state).toBe('committed');
});

test('主报告工具严格身份/输入、read权限、唯一序列化与端口别名隔离',async()=>{
  const f=reportFixture('cbim_dispatch_inspect',{}),report=await f.service.read(identity),query={runId:identity.runId,toolCallId:identity.toolCallId};
  const port=vi.fn(async()=>report),tools=new DispatchTools({binding,inspect:vi.fn(),dispatch:vi.fn(),commandReport:port}),signal=new AbortController().signal;
  expect(tools.list().find(item=>item.name==='cbim_dispatch_command_report')).toMatchObject({version:1,effects:['read'],recovery:{mode:'read_again'}});
  const approve=vi.fn();expect(await authorizeRunTool({id:'query',name:'cbim_dispatch_command_report',input:query},tools.describe('cbim_dispatch_command_report',query),{workspaceId:identity.workspaceId,permission:'read',guard:vi.fn(),approve})).toMatchObject({allow:true});expect(approve).not.toHaveBeenCalled();
  for(const field of ['workspaceId','rootSessionId','scopeId','commandId'])await expect(tools.call('cbim_dispatch_command_report',{...query,[field]:'foreign'},signal,'query')).rejects.toMatchObject({code:'DISPATCH_TOOL_INPUT_INVALID'});expect(port).not.toHaveBeenCalled();
  let serializations=0;const encoded={...report,toJSON(){serializations++;return report}};port.mockResolvedValueOnce(encoded);await tools.call('cbim_dispatch_command_report',query,signal,'query');expect(serializations).toBe(1);
  port.mockImplementationOnce(async(input?:any)=>{input.runId='foreign';return {...report,identity:{...report.identity,runId:'foreign'}}});await expect(tools.call('cbim_dispatch_command_report',query,signal,'query2')).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(port).toHaveBeenCalledTimes(2);
});
