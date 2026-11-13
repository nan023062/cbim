import {registerServiceOwner} from './owner-service-fixture';
import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {RunJournal} from '../src/backend/main/run-storage/run-journal';
import {MemberExecutionManager,type MemberExecutionPorts} from '../src/logic/team/runtime/member-execution';
import {ExecutionReportService} from '../src/logic/evidence/runtime/execution-report-service';
import {executionReportInputSchema,executionReportSchema} from '../src/logic/tasks/rules/execution-report';
import {toolReceipt} from '../src/logic/tools/rules/receipts';
import type {ToolCall,ToolDecision} from '../src/logic/tools/rules/types';
import type {TaskSpec,RunSummary} from '../src/logic/execution/rules/types';
import type {DispatchRun} from '../src/logic/tasks/rules/dispatch-execution';
import type {DispatchStore,DispatchState} from '../src/logic/dispatch/rules/dispatch-storage';
import type {KnowledgeWorkspace} from '../src/logic/knowledge/rules/ports';
import type {TaskNode,GraphSnapshot} from '../src/logic/tasks/rules/graph-types';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {json} from '../src/core/platform/node/serialization';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import {WorkspaceDispatchService} from '../src/logic/dispatch/runtime/dispatch-service';

async function setup(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-report-')),identity={workspaceId:'workspace-1',rootSessionId:'root-1'},taskId='task-1',runId='run-1';
  const assignee={agentId:'.cbim/team/dev',agentInstanceId:'member-1',agentSessionId:'channel-1',name:'执行者'},requester={agentId:'cbim:main',agentInstanceId:'main-1',agentSessionId:'main-channel',name:'调度员'};
  const task:TaskNode={kind:'task',nodeId:'node-1',taskId,identity,requester,assignee,modules:[],goal:'核验产物',acceptance:[],revision:3,planRevision:1,status:'running',awaitedChildren:[],runIds:[runId],activeRunId:runId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const graph:GraphSnapshot={version:1,identity,cursor:{...identity,streamId:'stream-1',seq:3},root:{kind:'session-root',nodeId:'root-node',identity,agent:requester,revision:1,createdAt:task.createdAt},tasks:[task],edges:[],agents:[]};
  const run={binding:{...identity,taskId,runId,teamId:'.cbim/team',agentId:assignee.agentId,agentInstanceId:assignee.agentInstanceId,agentSessionId:assignee.agentSessionId,leaseEpoch:1,planRevision:1},assignmentMessageId:'assignment-1',status:'running',session:{nativeSessionId:'native-1',sessionFile:path.join(root,'private-native.jsonl')},createdAt:task.createdAt,startedAt:task.createdAt,permission:'execute',prepared:{private:'not-public'},model:{private:'not-public'}} as unknown as DispatchRun;
  const state:DispatchState={workspaceId:identity.workspaceId,members:[],sessions:[],graphs:[graph],runs:[run],outbox:[]};
  const store={read:vi.fn(async()=>structuredClone(state)),transact:vi.fn(async()=>{throw Error('readonly report attempted mutation')})} as unknown as DispatchStore;
  const owner={entry:{id:identity.workspaceId,path:root},assert:vi.fn()} as unknown as KnowledgeWorkspace;
  const spec:TaskSpec={taskId,workspaceId:identity.workspaceId,root,goal:task.goal,agentId:assignee.agentId,moduleIds:['app'],acceptance:[]};
  const journal=new RunJournal(path.join(root,'journal'),spec,runId);await journal.init();await journal.append({type:'run.started',data:{task:spec,memberBinding:run.binding,message:'private input'}});await journal.append({type:'session.bound',data:{sessionFile:run.session.sessionFile,sessionId:'native-1'}});
  const inspect=vi.fn(async()=>RunJournal.read(journal.directory)),prepare=vi.fn(async()=>{throw Error('must not create engine')}),acquire=vi.fn(()=>{throw Error('must not acquire lease')});
  const manager=new MemberExecutionManager(owner,store,{inspect,prepare,acquire} as MemberExecutionPorts);
  const input={...identity,taskId,runId};
  let callNumber=0;
  const call=async(outcome:'succeeded'|'failed'|'denied'|'pending'='succeeded',id='call-'+(++callNumber),startedBeforeGate=false)=>{
    const tool:ToolCall={id,name:'bash',input:{command:'private command'}},decision:ToolDecision={allow:outcome!=='denied',effects:['command'],scope:{kind:'workspace',workspaceId:identity.workspaceId}};
    if(startedBeforeGate)await journal.append({type:'tool.started',data:{id,name:tool.name}});
    await journal.append({type:'tool.proposed',data:{...tool}});
    await journal.append({type:decision.allow?'tool.allowed':'tool.denied',data:{...tool,...decision,...(!decision.allow?{receipt:toolReceipt({workspaceId:identity.workspaceId,taskId,runId},tool,decision,'denied')}: {})}});
    if(outcome!=='pending'){
      const result={content:[{type:'text',text:'private result'}]},receipt=toolReceipt({workspaceId:identity.workspaceId,taskId,runId},tool,decision,outcome,result);
      await journal.append({type:'tool.finished',data:{id,name:tool.name,isError:outcome!=='succeeded',result,receipt}});
    }
    return tool;
  };
  const settle=async(status:'completed'|'failed'|'cancelled'='completed')=>{await journal.append({type:'run.settled',data:{status,acceptance:'not_evaluated'}});run.status=status;run.settledAt=new Date().toISOString();delete task.activeRunId;task.status=status==='completed'?'result_ready':status;task.revision++;graph.cursor.seq++};
  return {root,identity,input,task,graph,run,state,store,owner,journal,inspect,prepare,acquire,manager,call,settle,cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}

it('手动报告读取真实日志、保持只读并区分成功/失败回执与业务验收',async()=>{
  const f=await setup();try{
    await f.call('succeeded');await f.call('failed');await f.settle('failed');
    const state=structuredClone(f.state),bytes=await fs.readFile(path.join(f.journal.directory,'events.jsonl'));
    const report=await f.manager.report(f.input);
    expect(report).toMatchObject({execution:'settled',consistency:'stable',log:{state:'verified',hasTerminal:true,summaryStatus:'failed'},tools:{available:true,total:2,counts:{succeeded:1,failed:1}}});
    expect(report.issues.some(i=>i.code==='TOOLS_FAILED_WITH_POSSIBLE_EFFECTS')).toBe(true);
    expect(report.candidate).toBeUndefined();expect(f.state).toEqual(state);expect(await fs.readFile(path.join(f.journal.directory,'events.jsonl'))).toEqual(bytes);
    expect(f.prepare).not.toHaveBeenCalled();expect(f.acquire).not.toHaveBeenCalled();expect(f.store.transact).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toMatch(/private|sessionFile|"command":|"result":/);
    expect(executionReportSchema.safeParse(report).success).toBe(true);
  }finally{await f.cleanup()}
});

it('Pi started可早于授权；无终态活动运行和在途工具不误报执行失败',async()=>{
  const f=await setup();try{
    await f.call('succeeded','first',true);await f.call('pending','pending',true);
    const report=await f.manager.report(f.input);
    expect(report).toMatchObject({execution:'in_flight',log:{state:'verified',hasTerminal:false},tools:{counts:{succeeded:1,unknown:1}}});
    expect(report.issues.map(i=>i.code)).toContain('TOOLS_IN_FLIGHT');
    f.run.status='interrupted';delete f.task.activeRunId;f.task.status='interrupted';
    expect((await f.manager.report(f.input)).execution).toBe('unknown');
  }finally{await f.cleanup()}
});

it('未选轮次只核实持久领取；不存在日志不能说明未启动，拒绝跨会话且不读其它run',async()=>{
  const f=await setup();try{
    const noRun={...f.identity,taskId:f.task.taskId};
    expect(await f.manager.report(noRun)).toMatchObject({execution:'unknown',log:{state:'not_selected'}});expect(f.inspect).not.toHaveBeenCalled();
    f.task.runIds=[];f.task.status='queued';delete f.task.activeRunId;f.state.runs=[];
    expect(await f.manager.report(noRun)).toMatchObject({execution:'not_started',log:{state:'not_expected'}});
    expect(await f.manager.report(f.input)).toMatchObject({execution:'unknown',log:{state:'missing'}});expect(f.inspect).not.toHaveBeenCalled();
    await expect(f.manager.report({...f.input,rootSessionId:'other'})).rejects.toMatchObject({code:'TASK_NOT_FOUND'});
    await expect(f.manager.report({...f.input,workspaceId:'other'})).rejects.toMatchObject({code:'GRAPH_IDENTITY_MISMATCH'});
    expect(executionReportInputSchema.safeParse({...f.input,run:'any'}).success).toBe(false);
  }finally{await f.cleanup()}
});

it('真实撤销服务产生的never-run任务可报告not_started，读取不创建日志、模型或修改记录',async()=>{
  const f=await fixture();let service:WorkspaceDispatchService|undefined;try{
    const entry=await f.app.dispatch('add',{path:f.a}),owner=f.app.workspace(entry.id),team=await seedTeam(owner),snapshot=await owner.snapshot(),moduleId=team.input.moduleId;
    const definition=JSON.parse(snapshot.files.find(item=>item.path===moduleId+'/module.json')!.text);definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
    await owner.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:moduleId+'/module.json',text:json(definition)}]));
    await registerServiceOwner(f.app,owner,'.cbim/team/dev',[moduleId]);
    const store=owner.dispatchStore,directory=store.directory,identity={workspaceId:entry.id,rootSessionId:'report-root'};service=new WorkspaceDispatchService(owner,store,undefined,undefined,undefined,f.app.models);
    const ownerSelection=(await service.owners.discover([moduleId])).groups[0].selection!;
    await service.openScope(identity,'cycle',{message:'完成目标'},'main-run');await service.goals.plan(identity,'cycle','main-run','plan',{expectedRevision:1,objective:'完成目标',constraints:[],criteria:[{id:'c1',text:'真实产物',kind:'evidence'}],assignments:[{agentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,criterionIds:['c1'],reason:'负责业务模块'}],reason:'按图派发'});
    const assigned=await service.dispatchTask({...identity,commandId:'assign',expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,goal:'实现模块',acceptance:[{id:'c1',text:'真实产物'}],prerequisites:[]}},'cycle'),graph=await service.snapshot(identity);
    await service.cancelQueued(identity,'cycle','main-run','cancel',{expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},targets:[{taskId:assigned.taskId,expectedRevision:1}],reason:'缺少输入，撤销排队工作'});
    const inspect=vi.fn(async()=>{throw Error('must not read missing logs')}),prepare=vi.fn(async()=>{throw Error('must not create model')}),acquire=vi.fn(()=>{throw Error('must not acquire lease')}),manager=new MemberExecutionManager(owner,store,{inspect,prepare,acquire});
    const bytes=await fs.readFile(path.join(directory,'dispatch.jsonl')),state=await store.read();
    const report=await manager.report({...identity,taskId:assigned.taskId});expect(report).toMatchObject({execution:'not_started',log:{state:'not_expected'},tools:{available:false,total:0},issues:[{code:'TASK_CANCELLED_BEFORE_START'}]});
    expect(report.issues.some(item=>item.code==='RUN_NOT_SELECTED')).toBe(false);expect(inspect).not.toHaveBeenCalled();expect(prepare).not.toHaveBeenCalled();expect(acquire).not.toHaveBeenCalled();expect(await store.read()).toEqual(state);expect(await fs.readFile(path.join(directory,'dispatch.jsonl'))).toEqual(bytes);
    await service.closeScope(identity,'cycle','cancelled');expect(await manager.report({...identity,taskId:assigned.taskId})).toMatchObject({execution:'not_started',log:{state:'not_expected'},next:{kind:'new_cycle_only'}});
  }finally{await service?.close();await f.cleanup()}
});

it('缺失/损坏撤销记录、错误绑定或运行领取事实仍保持unknown，后屏障变化也不宣称未执行',async()=>{
  const f=await setup();try{
    f.task.scopeId='cycle';f.task.status='cancelled';f.task.runIds=[];delete f.task.activeRunId;f.state.runs=[];f.task.waitReason='明确撤销';
    f.task.cancelledBeforeStart={commandId:'cancel',scopeId:'cycle',mainRunId:'main-run',reason:f.task.waitReason,cancelledAt:f.task.updatedAt,previousRevision:f.task.revision-1,graphCursor:{streamId:f.graph.cursor.streamId,seq:f.graph.cursor.seq-1}};
    f.state.scopes=[{...f.identity,scopeId:'cycle',status:'active',createdAt:f.task.createdAt}];f.state.outbox=[{kind:'assignment',messageId:'assignment',commandId:'assign',identity:f.identity,from:f.task.requester,to:f.task.assignee,taskId:f.task.taskId,planRevision:f.task.planRevision,createdAt:f.task.createdAt,delivery:'processed'}];
    const input={...f.identity,taskId:f.task.taskId},good=structuredClone(f.state),read=vi.mocked(f.store.read);
    expect((await f.manager.report(input)).execution).toBe('not_started');
    const mutations:((state:DispatchState)=>void)[]=[
      state=>{delete state.graphs[0].tasks[0].cancelledBeforeStart},state=>{state.graphs[0].tasks[0].cancelledBeforeStart!.previousRevision++},state=>{state.graphs[0].tasks[0].cancelledBeforeStart!.scopeId='foreign'},
      state=>{state.graphs[0].tasks[0].cancelledBeforeStart!.cancelledAt='invalid'},state=>{state.graphs[0].tasks[0].cancelledBeforeStart!.reason='different'},state=>{state.graphs[0].tasks[0].cancelledBeforeStart!.graphCursor.streamId='other'},
      state=>{state.outbox[0].claim={runId:'run',leaseEpoch:1}},state=>{state.outbox[0].delivery='pending'},state=>{state.outbox[0].to={...state.outbox[0].to,agentSessionId:'foreign'}},state=>{state.outbox=[]},state=>{state.runs=[f.run]},state=>{state.scopes=[]},
      state=>{state.graphs[0].tasks[0].runIds=['old-run']},state=>{state.graphs[0].tasks[0].activeRunId='old-run'},state=>{state.graphs[0].tasks[0].awaitedChildren=[{taskId:'child',planRevision:1}]},state=>{state.graphs[0].tasks[0].help={} as NonNullable<TaskNode['help']>},state=>{state.graphs[0].tasks[0].result={} as NonNullable<TaskNode['result']>},
    ];
    for(const mutate of mutations){const state=structuredClone(good);mutate(state);read.mockImplementation(async()=>structuredClone(state));expect(await f.manager.report(input)).toMatchObject({execution:'unknown',log:{state:'not_selected'}})}
    const changed=structuredClone(good);changed.outbox[0].claim={runId:'new-claim',leaseEpoch:2};read.mockResolvedValueOnce(good).mockResolvedValueOnce(changed);
    expect(await f.manager.report(input)).toMatchObject({execution:'unknown',consistency:'changed_during_read'});expect(f.inspect).not.toHaveBeenCalled();expect(f.prepare).not.toHaveBeenCalled();expect(f.acquire).not.toHaveBeenCalled();expect(f.store.transact).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});

it.each(['missing','invalid','identity_mismatch','unavailable'] as const)('日志%s只返回安全问题，不传播原始内容',async state=>{
  const f=await setup();try{
    const code={missing:'ENOENT',invalid:'RUN_LOG_INVALID',identity_mismatch:'MEMBER_LOG_IDENTITY',unavailable:'EACCES'}[state];
    f.inspect.mockRejectedValue(Object.assign(Error('private secret path/token'),{code}));
    const report=await f.manager.report(f.input);
    expect(report).toMatchObject({execution:'unknown',log:{state},tools:{available:false,total:0}});expect(JSON.stringify(report)).not.toContain('private');
  }finally{await f.cleanup()}
});

it('完整终态后的截断尾行仍为incomplete/unknown，可读前缀不被当作完整证据',async()=>{
  const f=await setup();try{
    await f.call();await f.settle();await fs.appendFile(path.join(f.journal.directory,'events.jsonl'),'{"private":"unfinished');
    expect(await f.manager.report(f.input)).toMatchObject({execution:'unknown',log:{state:'incomplete'},tools:{available:true,total:1}});
  }finally{await f.cleanup()}
});

it('运行身份错绑、旧轮次借用新候选和终态后悬空事件均不冒充成功',async()=>{
  const f=await setup();try{
    await f.call();await f.settle();
    f.task.result={resultId:'new-result',runId:'new-run',planRevision:1,summary:'最新候选',evidenceRefs:['call-1'],limitations:[],acceptance:'not_evaluated'};
    expect((await f.manager.report(f.input)).candidate).toBeUndefined();
    f.task.result.runId=f.input.runId;expect((await f.manager.report(f.input)).candidate?.resultId).toBe('new-result');
    const original=await RunJournal.read(f.journal.directory),wrong=structuredClone(original);wrong.memberBinding!.agentInstanceId='foreign';f.inspect.mockResolvedValue(wrong);
    expect(await f.manager.report(f.input)).toMatchObject({execution:'unknown',log:{state:'identity_mismatch'}});
    f.inspect.mockImplementation(async()=>RunJournal.read(f.journal.directory));await f.journal.append({type:'message',data:{text:'late'}});
    expect((await f.manager.report(f.input)).execution).toBe('unknown');
  }finally{await f.cleanup()}
});

it('重复结束/重复授权或伪造hash变成unknown；正常denied随后finished不误报',async()=>{
  const f=await setup();try{
    await f.call('denied','denied');await f.call('succeeded','twice');await f.call('succeeded','duplicate-gate');
    const summary=await RunJournal.read(f.journal.directory),finished=summary.events.find(e=>e.type==='tool.finished'&&e.data.id==='twice')!;
    const allowed=summary.events.find(e=>e.type==='tool.allowed'&&e.data.id==='duplicate-gate')!;
    await f.journal.append({type:'tool.allowed',data:allowed.data});
    await f.journal.append({type:'tool.finished',data:finished.data});await f.settle();
    const report=await f.manager.report(f.input);
    expect(report.tools.items.find(i=>i.toolCallId==='denied')?.status).toBe('denied');expect(report.tools.items.find(i=>i.toolCallId==='twice')?.status).toBe('unknown');expect(report.execution).toBe('unknown');
    expect(report.tools.items.find(i=>i.toolCallId==='duplicate-gate')?.status).toBe('unknown');
    const bad=await RunJournal.read(f.journal.directory),item=bad.events.find(e=>e.type==='tool.finished'&&e.data.id==='denied')!;(item.data.receipt as {inputHash:string}).inputHash='f'.repeat(64);f.inspect.mockResolvedValue(bad);
    expect((await f.manager.report(f.input)).tools.items.find(i=>i.toolCallId==='denied')?.status).toBe('unknown');
  }finally{await f.cleanup()}
});

it('回执和isError矛盾或先成功结束后追加denied都不能冒充已拒绝或成功',async()=>{
  const f=await setup();try{
    const tool=await f.call('succeeded','late-deny');await f.call('succeeded','wrong-outcome');await f.settle();
    const decision:ToolDecision={allow:false,effects:['command'],scope:{kind:'workspace',workspaceId:f.identity.workspaceId}};
    await f.journal.append({type:'tool.denied',data:{...tool,...decision,receipt:toolReceipt({workspaceId:f.identity.workspaceId,taskId:f.input.taskId,runId:f.input.runId},tool,decision,'denied')}});
    const summary=await RunJournal.read(f.journal.directory);summary.events.find(e=>e.type==='tool.finished'&&e.data.id==='wrong-outcome')!.data.isError=true;f.inspect.mockResolvedValue(summary);
    const report=await f.manager.report(f.input);expect(report.execution).toBe('unknown');expect(report.tools.counts.unknown).toBe(2);expect(report.tools.counts.denied).toBe(0);expect(report.tools.counts.succeeded).toBe(0);
  }finally{await f.cleanup()}
});

it('分页同基线有界返回，日志变化重置第一页；读取期间状态变化整份报告标未知',async()=>{
  const f=await setup();try{
    await f.call();await f.call();await f.call();
    const first=await f.manager.report({...f.input,limit:2}),second=await f.manager.report({...f.input,limit:2,cursor:first.tools.nextCursor});
    expect(first.tools.items).toHaveLength(2);expect(second.tools.items).toHaveLength(1);expect(second.basis.key).toBe(first.basis.key);expect(second.tools.paginationReset).toBe(false);
    await f.call();const changed=await f.manager.report({...f.input,limit:2,cursor:first.tools.nextCursor});
    expect(changed.tools.paginationReset).toBe(true);expect(changed.tools.items[0].toolCallId).toBe(first.tools.items[0].toolCallId);
    f.inspect.mockImplementation(async()=>{f.task.revision++;f.graph.cursor.seq++;return RunJournal.read(f.journal.directory)});
    expect(await f.manager.report(f.input)).toMatchObject({consistency:'changed_during_read',execution:'unknown',tools:{available:false,items:[]}});
  }finally{await f.cleanup()}
});

it('重新创建只读服务不恢复starting记录，关闭周期只提示新周期而不重试',async()=>{
  const f=await setup();try{
    f.run.status='starting';f.task.scopeId='closed-scope';f.state.scopes=[{workspaceId:f.identity.workspaceId,rootSessionId:f.identity.rootSessionId,scopeId:'closed-scope',status:'closed'} as NonNullable<DispatchState['scopes']>[number]];
    const report=await new ExecutionReportService(f.owner,f.store,f.inspect).read(f.input);
    expect(report.next.kind).toBe('new_cycle_only');expect(f.run.status).toBe('starting');expect(f.store.transact).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});

it('JSON可解析但工具事件正文缺失时返回未知，不抛投影异常或泄漏正文',async()=>{
  const f=await setup();try{
    await f.journal.append({type:'tool.started',data:undefined as never});await f.settle();
    const report=await f.manager.report(f.input);
    expect(report.execution).toBe('unknown');expect(report.issues.some(i=>i.code==='TOOL_EVIDENCE_INVALID')).toBe(true);
  }finally{await f.cleanup()}
});
