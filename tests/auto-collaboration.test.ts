import {expect,it,vi} from 'vitest';
import {AutoCollaboration} from '../src/backend/scheduler-engine/execution/auto-collaboration';
import {WorkspaceExecutionLease} from '../src/backend/scheduler-engine/execution/workspace-lease';
import type {ExecutionCollaboration,WorkspaceExecutionManager} from '../src/backend/scheduler-engine/execution/execution-manager';
import type {WorkspaceDispatchService} from '../src/backend/scheduler-engine/execution/dispatch-service';
import type {MemberExecutionManager} from '../src/backend/scheduler-engine/execution/member-execution';
import type {KnowledgeWorkspace} from '../src/backend/core/knowledge/ports';
import type {TaskSpec,RunSummary} from '../src/backend/core/brain/types';
import type {GraphSnapshot,TaskNode} from '../src/backend/core/tasks/graph-types';

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return {promise,resolve}}
async function setup(){
  const task:TaskSpec={taskId:'conversation-1',workspaceId:'workspace-1',root:'C:/project',mode:'chat',goal:'原任务',agentId:'cbim:main',moduleIds:[],acceptance:[]};
  const identity={workspaceId:task.workspaceId,rootSessionId:task.taskId};
  const agent={agentId:'member',agentInstanceId:'instance',agentSessionId:'session',name:'成员'};
  const graph:GraphSnapshot={version:1,identity,cursor:{...identity,streamId:'stream',seq:1},root:{kind:'session-root',identity,nodeId:'root',agent:{...agent,agentId:'cbim:main',agentSessionId:'root-channel'},revision:1,createdAt:'2026-11-06'},tasks:[],edges:[],agents:[]};
  const lease=new WorkspaceExecutionLease(),done=deferred<void>();let release=()=>{},hooks!:ExecutionCollaboration;
  const options={provider:'provider',model:'model',profileId:'00000000-0000-4000-8000-000000000001',permission:'ask' as const,allowNativeExecution:true};
  const dispatch={
    goals:{inspect:vi.fn(async()=>({goal:{plan:{}}})),plan:vi.fn(async()=>({})),review:vi.fn(async()=>({})),block:vi.fn(async()=>({}))},
    openScope:vi.fn(async(_identity:any,scopeId:string)=>({...identity,scopeId,status:'active',createdAt:'2026-11-07'})),
    waitingScopes:vi.fn<()=>Promise<any[]>>(async()=>[]),
    parkScope:vi.fn(async(_identity:any,scopeId:string,summary:RunSummary,mainRunIds:string[])=>({...identity,scopeId,status:'waiting',createdAt:'2026-11-07',wait:{waitId:'wait-one',runId:summary.runId,mainRunIds}})),
    closeScope:vi.fn(async(_identity:any,scopeId:string,outcome:string,_summary?:RunSummary)=>{if(graph.tasks.some(task=>task.activeRunId))throw Error('scope still active');return {...identity,scopeId,status:'closed',outcome}}),
    openGraph:vi.fn(async()=>({agent:graph.root.agent,cursor:graph.cursor})),
    snapshot:vi.fn(async()=>structuredClone(graph)),
    dispatchTask:vi.fn(async(input:any,scopeId?:string)=>{
      const node:TaskNode={kind:'task',scopeId,taskId:'assigned-1',nodeId:'task:assigned-1',identity,requester:graph.root.agent,assignee:agent,modules:[],goal:input.task.goal,acceptance:input.task.acceptance,revision:1,planRevision:1,status:'queued',awaitedChildren:[],runIds:[],createdAt:'2026-11-06',updatedAt:'2026-11-06'};
      graph.tasks.push(node);return {commandId:input.commandId,taskId:node.taskId,messageId:'assignment',cursor:graph.cursor,disposition:'queued' as const};
    }),
  };
  const members={
    start:vi.fn(async(input:any)=>{release=lease.acquire('member',input.options.permission);graph.tasks[0].activeRunId='member-run';graph.tasks[0].runIds=['member-run'];graph.tasks[0].status='running';return {taskId:input.taskId,runId:'member-run',cursor:graph.cursor}}),
    waitForSettlement:vi.fn(async()=>{if(graph.tasks[0]?.activeRunId)await done.promise}),
    stop:vi.fn(async()=>{if(graph.tasks[0]?.activeRunId){Object.assign(graph.tasks[0],{activeRunId:undefined,status:'cancelled'});release();done.resolve()}return {requested:true}}),
    messages:vi.fn(async()=>graph.tasks[0].result?[{kind:'result',taskId:'assigned-1',messageId:'message-1',resultId:'result-1'}]:[]),
    acknowledge:vi.fn(async()=>({delivery:'processed'})),
  };
  const execution={attachCollaboration:(value:ExecutionCollaboration)=>{hooks=value},continueFromResults:vi.fn(async(..._args:unknown[])=>({workspaceId:task.workspaceId,taskId:task.taskId,runId:'continued'})),collaborationReady:vi.fn(async()=>{}),pauseCollaboration:vi.fn(async()=>{})};
  const issues=vi.fn();
  const coordinator=new AutoCollaboration({entry:{id:task.workspaceId,path:task.root},assert:()=>{}} as KnowledgeWorkspace,dispatch as unknown as WorkspaceDispatchService,members as unknown as MemberExecutionManager,execution as unknown as WorkspaceExecutionManager,lease,issues);
  await hooks.starting?.(task,options,undefined,'本轮实际输入');
  execution.continueFromResults.mockImplementation(async(...args:unknown[])=>{
    await hooks.starting?.(task,options,args[3] as any,args[1] as string);coordinator.tools(task,'continued',options);
    queueMicrotask(()=>hooks.settled(task,options,{task,runId:'continued',status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events:[]}));
    return {workspaceId:task.workspaceId,taskId:task.taskId,runId:'continued'};
  });
  const tools=coordinator.tools(task,'parent-run',options)!;
  const assign=()=>tools.call('cbim_dispatch_task',{agentId:'member',moduleIds:['module'],goal:'核实产物',acceptance:[{id:'actual',text:'真实文件证据'}]},new AbortController().signal,'dispatch-call');
  const settleParent=(status:RunSummary['status']='completed')=>hooks.settled(task,options,{task,runId:'parent-run',status,acceptance:'not_evaluated',unresolvedTools:[],events:[]});
  const finishMember=(candidate=true)=>{
    Object.assign(graph.tasks[0],{activeRunId:undefined,status:candidate?'result_ready':'blocked',...(candidate?{result:{resultId:'result-1',runId:'member-run',planRevision:1,summary:'真实读取结果',evidenceRefs:['read'],limitations:[],acceptance:'not_evaluated'}}:{waitReason:'没有有效候选'})});
    release();done.resolve();
  };
  return {task,graph,dispatch,members,execution,issues,lease,coordinator,tools,options,assign,settleParent,finishMember,hooks:()=>hooks};
}

it('已结算的等待申请停泊并保留目标入口，关闭应用不取消检查点',async()=>{
  const f=await setup();try{
    f.dispatch.goals.inspect.mockResolvedValue({goal:{plan:{},review:{decision:'awaiting_user'}}} as any);
    f.settleParent();await vi.waitFor(()=>expect(f.dispatch.parkScope).toHaveBeenCalledTimes(1));
    expect(f.dispatch.parkScope.mock.calls[0][3]).toEqual(['parent-run']);
    await vi.waitFor(()=>expect(f.hooks().waiting?.(f.task.taskId)).toBe(true));
    expect(f.coordinator.busy(f.task.taskId)).toBe(true);expect(f.execution.continueFromResults).not.toHaveBeenCalled();
    await expect(f.hooks().starting!(f.task,f.options,undefined,'普通用户输入')).rejects.toMatchObject({code:'GOAL_WAITING'});
    await f.coordinator.close();expect(f.dispatch.closeScope).not.toHaveBeenCalled();
  }finally{await f.coordinator.close()}
});

it('用户停止与等待检查点提交竞争，等待落盘后仍取消而不遗留开放周期',async()=>{
  const f=await setup(),parking=deferred<any>();try{
    f.dispatch.goals.inspect.mockResolvedValue({goal:{plan:{},review:{decision:'awaiting_user'}}} as any);
    f.dispatch.parkScope.mockImplementation(()=>parking.promise);
    f.settleParent();await vi.waitFor(()=>expect(f.dispatch.parkScope).toHaveBeenCalledTimes(1));
    const stop=f.hooks().stop(f.task.taskId);
    const scopeId=f.dispatch.parkScope.mock.calls[0][1];
    parking.resolve({...f.graph.identity,scopeId,status:'waiting',createdAt:'2026-11-07'});
    await stop;
    expect(f.dispatch.closeScope).toHaveBeenCalledWith(f.graph.identity,scopeId,'cancelled');
    expect(f.coordinator.busy(f.task.taskId)).toBe(false);expect(f.execution.collaborationReady).not.toHaveBeenCalled();
  }finally{await f.coordinator.close()}
});

it('恢复等待只登记占位，用户停止无需启动历史模型或伪造TaskSpec',async()=>{
  const f=await setup();try{
    await f.hooks().stop(f.task.taskId);f.dispatch.closeScope.mockClear();
    const identity={workspaceId:f.task.workspaceId,rootSessionId:'history-root'};
    f.dispatch.waitingScopes.mockResolvedValue([{...identity,scopeId:'history-scope',status:'waiting',createdAt:'2026-11-07'}]);
    await f.coordinator.initialize();expect(f.coordinator.busy(identity.rootSessionId)).toBe(true);
    expect(f.members.start).not.toHaveBeenCalled();expect(f.execution.continueFromResults).not.toHaveBeenCalled();
    await f.hooks().stop(identity.rootSessionId);
    expect(f.dispatch.closeScope).toHaveBeenCalledWith(identity,'history-scope','cancelled');
    expect(f.coordinator.busy(identity.rootSessionId)).toBe(false);
  }finally{await f.coordinator.close()}
});

it('主轮委派只入队，释放占用后成员才能运行；结果确认失败不重复续跑',async()=>{
  const f=await setup();try{
    const release=f.lease.acquire('parent','ask');await f.assign();expect(f.members.start).not.toHaveBeenCalled();
    f.settleParent();await vi.waitFor(()=>expect(f.members.start).toHaveBeenCalledTimes(1));expect(f.graph.tasks[0].status).toBe('queued');
    release();await vi.waitFor(()=>expect(f.graph.tasks[0].status).toBe('running'));
    expect(f.dispatch.openScope).toHaveBeenCalledTimes(1);expect(f.dispatch.closeScope).not.toHaveBeenCalled();
    expect(f.dispatch.openScope).toHaveBeenCalledWith(f.graph.identity,expect.any(String),{message:'本轮实际输入',attachmentIds:undefined});
    expect(f.members.start.mock.calls.at(-1)![0].options).toMatchObject({permission:'ask',model:'model',profileId:f.options.profileId});
    expect(f.members.start.mock.calls.at(-1)![0].options).not.toHaveProperty('allowAll');
    f.members.acknowledge.mockRejectedValueOnce(Error('ack disk unavailable'));f.finishMember();
    await vi.waitFor(()=>expect(f.execution.continueFromResults).toHaveBeenCalledTimes(1));
    const args=f.execution.continueFromResults.mock.calls[0] as unknown as any[];
    expect(args[0]).toBe(f.task.taskId);expect(args[1]).toContain('真实读取结果');expect(args[3]).toMatchObject({kind:'member-results',messageIds:['message-1'],taskIds:['assigned-1']});
    const releaseAgain=f.lease.acquire('unrelated','read');releaseAgain();f.settleParent();
    await vi.waitFor(()=>expect(f.issues).toHaveBeenCalled());expect(f.execution.continueFromResults).toHaveBeenCalledTimes(1);
    expect(f.graph.tasks[0].result?.acceptance).toBe('not_evaluated');
  }finally{await f.coordinator.close()}
});

it('停止会话后迟到成员结果只保留事实，不回注或确认收件',async()=>{
  const f=await setup();try{
    await f.assign();f.settleParent();await vi.waitFor(()=>expect(f.graph.tasks[0].status).toBe('running'));
    await f.hooks().stop(f.task.taskId);f.finishMember();await f.coordinator.close();
    expect(f.members.stop).toHaveBeenCalledWith({...f.graph.identity,taskId:'assigned-1'});
    expect(f.execution.continueFromResults).not.toHaveBeenCalled();expect(f.members.acknowledge).not.toHaveBeenCalled();
  }finally{await f.coordinator.close()}
});

it('主轮失败不启动已入队成员；模型不能查询别的主会话任务',async()=>{
  const f=await setup();try{
    await f.assign();await expect(f.tools.call('cbim_dispatch_inspect',{taskId:'foreign-task'},new AbortController().signal,'inspect-call')).rejects.toMatchObject({code:'TASK_NOT_FOUND'});
    f.settleParent('failed');await f.coordinator.close();expect(f.members.start).not.toHaveBeenCalled();expect(f.graph.tasks).toHaveLength(1);
    expect(f.coordinator.tools({...f.task,mode:undefined},'member',f.options)).toBeUndefined();
    expect(f.coordinator.tools({...f.task,agentId:'.cbim/team/executor'},'not-main',f.options)).toBeUndefined();
  }finally{await f.coordinator.close()}
});

it('没有候选的成员终态仍返回主会话，不伪造结果信封或验收通过',async()=>{
  const f=await setup();try{
    await f.assign();f.settleParent();await vi.waitFor(()=>expect(f.graph.tasks[0].status).toBe('running'));
    f.finishMember(false);await vi.waitFor(()=>expect(f.execution.continueFromResults).toHaveBeenCalledTimes(1));
    const args=f.execution.continueFromResults.mock.calls[0] as unknown as any[];
    expect(args[1]).toContain('blocked');expect(args[1]).toContain('没有有效候选');expect(args[3].messageIds).toEqual([]);expect(f.members.acknowledge).not.toHaveBeenCalled();
    await vi.waitFor(()=>expect(f.dispatch.closeScope).toHaveBeenCalledTimes(1));
    expect(f.dispatch.closeScope).toHaveBeenCalledWith(f.graph.identity,f.dispatch.openScope.mock.calls[0][1],'completed',expect.objectContaining({runId:'continued'}));
  }finally{await f.coordinator.close()}
});

it('成功关闭门禁失败时保存阻塞原因并关闭失败周期，不能放行队列或把成员失败当完成',async()=>{
  const f=await setup();try{
    f.dispatch.closeScope.mockImplementation(async(identity,scopeId,outcome)=>{
      if(outcome==='completed')throw Object.assign(Error('缺少当前目标的有效证据审阅'),{code:'GOAL_REVIEW_REQUIRED'});
      return {...identity,scopeId,status:'closed',outcome};
    });
    await f.assign();f.settleParent();await vi.waitFor(()=>expect(f.graph.tasks[0].status).toBe('running'));
    f.finishMember(false);
    await vi.waitFor(()=>expect(f.hooks().busy(f.task.taskId)).toBe(false));
    expect(f.dispatch.goals.block).toHaveBeenCalledWith(f.graph.identity,expect.any(String),'缺少当前目标的有效证据审阅');
    expect(f.dispatch.closeScope).toHaveBeenLastCalledWith(f.graph.identity,expect.any(String),'failed');
    expect(f.execution.pauseCollaboration).toHaveBeenCalledWith(f.task.taskId,expect.stringContaining('目标尚未完成'));
    expect(f.execution.collaborationReady).not.toHaveBeenCalled();
  }finally{await f.coordinator.close()}
});

it.each(['cbim_object_commit','cbim_goal_plan','cbim_goal_review'])('未建计划的%s调用不能绕过为普通聊天成功',async toolName=>{
  const f=await setup();try{
    f.dispatch.goals.inspect.mockResolvedValue({goal:{}} as any);
    f.hooks().settled(f.task,f.options,{task:f.task,runId:'parent-run',status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events:[],toolReceipts:[{toolName,effects:toolName==='cbim_object_commit'?['knowledge-write']:['maintenance']} as any]});
    await vi.waitFor(()=>expect(f.hooks().busy(f.task.taskId)).toBe(false));
    expect(f.dispatch.goals.block).toHaveBeenCalled();
    expect(f.dispatch.closeScope).toHaveBeenLastCalledWith(f.graph.identity,expect.any(String),'failed');
    expect(f.execution.collaborationReady).not.toHaveBeenCalled();
  }finally{await f.coordinator.close()}
});

it('周期未可靠关闭时用户队列继续等待，关闭后才通知队列开始下一周期',async()=>{
  const f=await setup(),closing=deferred<void>();try{
    f.dispatch.closeScope.mockImplementationOnce(async(identity,scopeId,outcome)=>{await closing.promise;return {...identity,scopeId,status:'closed',outcome}});
    f.settleParent();await vi.waitFor(()=>expect(f.dispatch.closeScope).toHaveBeenCalledTimes(1));
    expect(f.hooks().busy(f.task.taskId)).toBe(true);expect(f.execution.collaborationReady).not.toHaveBeenCalled();
    closing.resolve();await vi.waitFor(()=>expect(f.execution.collaborationReady).toHaveBeenCalledWith(f.task.taskId));
    expect(f.hooks().busy(f.task.taskId)).toBe(false);
  }finally{closing.resolve();await f.coordinator.close()}
});

it('同一周期最多创建32次主调度运行，同run重复装配不重复扣额度',async()=>{
  const f=await setup();try{
    for(let i=1;i<32;i++)f.coordinator.tools(f.task,'main-'+i,f.options);
    expect(()=>f.coordinator.tools(f.task,'main-31',f.options)).not.toThrow();
    expect(()=>f.coordinator.tools(f.task,'main-over-limit',f.options)).toThrow('32');
    expect(f.dispatch.closeScope).not.toHaveBeenCalled();
  }finally{await f.coordinator.close()}
});

it('读取图期间关闭，不允许读取返回后启动成员',async()=>{
  const f=await setup();try{
    await f.assign();const reading=deferred<GraphSnapshot>();f.dispatch.snapshot.mockImplementationOnce(()=>reading.promise);
    f.settleParent();await vi.waitFor(()=>expect(f.dispatch.snapshot).toHaveBeenCalledTimes(2));
    const closing=f.coordinator.close();reading.resolve(structuredClone(f.graph));await closing;
    expect(f.members.start).not.toHaveBeenCalled();expect(f.execution.continueFromResults).not.toHaveBeenCalled();
  }finally{await f.coordinator.close()}
});

it('成员终态提交失败保留真实占用并报告诊断，不无限忙碌或重新启动',async()=>{
  const f=await setup();try{
    f.members.waitForSettlement.mockRejectedValueOnce(Object.assign(Error('成员终态提交失败'),{code:'MEMBER_SETTLEMENT_FAILED'}));
    f.members.stop.mockRejectedValue(Error('成员终态仍未确认'));
    await f.assign();f.settleParent();await vi.waitFor(()=>expect(f.issues).toHaveBeenCalled());
    expect(f.graph.tasks[0].activeRunId).toBe('member-run');expect(f.hooks().busy(f.task.taskId)).toBe(true);
    expect(()=>f.lease.acquire('other-writer','execute')).toThrow();
    expect(f.execution.continueFromResults).not.toHaveBeenCalled();expect(f.members.start).toHaveBeenCalledTimes(1);
    expect(f.execution.pauseCollaboration).toHaveBeenCalledWith(f.task.taskId,expect.stringContaining('终态未确认'));
    f.finishMember();f.members.stop.mockResolvedValue({requested:true});
  }finally{await f.coordinator.close()}
});

it('停止请求失败不能静默当作成功收尾',async()=>{
  const f=await setup();try{
    await f.assign();f.settleParent();await vi.waitFor(()=>expect(f.graph.tasks[0].status).toBe('running'));
    f.members.stop.mockRejectedValueOnce(Error('无法确认停止'));
    await expect(f.hooks().stop(f.task.taskId)).rejects.toThrow('无法确认停止');expect(f.issues).toHaveBeenCalled();
    f.finishMember();await f.coordinator.close();expect(f.execution.continueFromResults).not.toHaveBeenCalled();
  }finally{await f.coordinator.close()}
});

it('回注遇到同一主实例仍被占用时等待释放，不误报协作失败或提前确认结果',async()=>{
  const f=await setup();let unblock=()=>{};try{
    const continueRun=f.execution.continueFromResults.getMockImplementation()!;
    f.execution.continueFromResults.mockImplementation(async(...args:unknown[])=>{
      const release=f.lease.acquire('main-resume','read','main-instance');release();
      return continueRun(...args);
    });
    await f.assign();f.settleParent();await vi.waitFor(()=>expect(f.graph.tasks[0].status).toBe('running'));
    f.finishMember();unblock=f.lease.acquire('historical-shared-root','read','main-instance');
    await vi.waitFor(()=>expect(f.execution.continueFromResults).toHaveBeenCalled());
    expect(f.members.acknowledge).not.toHaveBeenCalled();expect(f.issues).not.toHaveBeenCalled();
    expect(f.hooks().busy(f.task.taskId)).toBe(true);
    unblock();await vi.waitFor(()=>expect(f.members.acknowledge).toHaveBeenCalledTimes(1));
    expect(f.issues).not.toHaveBeenCalled();expect(f.hooks().busy(f.task.taskId)).toBe(false);
  }finally{unblock();await f.coordinator.close()}
});
