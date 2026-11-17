import {expect,test} from 'vitest';
import {GlobalRuntimeManager} from '../../../../../src/logic/runtime/monitoring/global-runtime';
import type {RunSummary,StoredEvent,TaskSpec} from '../../../../../src/logic/execution/rules/types';
import type {AgentInstance} from '../../../../../src/logic/team/rules/agent-types';
import type {DispatchState,DispatchMutation} from '../../../../../src/logic/dispatch/rules/dispatch-storage';
import type {GraphSnapshot,TaskNode} from '../../../../../src/logic/tasks/rules/graph-types';
import type {MemberRunBinding} from '../../../../../src/logic/execution/rules/member-run';
import type {ConversationAgentBinding} from '../../../../../src/logic/execution/rules/conversation-binding';

const stamp='2026-11-06T12:00:00.000Z';
function task(workspaceId='a'):TaskSpec{return {workspaceId,taskId:'conversation',root:'C:/private/project',goal:'PRIVATE PROMPT',moduleIds:['game'],agentId:'cbim:main',acceptance:[],mode:'chat'}}
function event(seq:number,type:StoredEvent['type'],data:StoredEvent['data']={},workspaceId='a',runId='run'):StoredEvent{return {version:1,workspaceId,taskId:'conversation',runId,seq,time:new Date(Date.parse(stamp)+seq*1000).toISOString(),type,data}}
function start(workspaceId='a',runId='run'){return event(1,'run.started',{task:task(workspaceId),message:'PRIVATE PROMPT'},workspaceId,runId)}
function member(workspaceId='a'):AgentInstance{return {workspaceId,teamId:'team',agentId:'cbim:main',agentInstanceId:'member',leaseEpoch:0,configurationRevision:'knowledge-1',agentSessionIds:['session'],activity:'idle',waitingTaskIds:[],communicatingMessageIds:[]}}
function baseline(workspaceId='a'):DispatchState {
  const identity={workspaceId,rootSessionId:'root'},agent={agentId:'cbim:main',agentInstanceId:'member',agentSessionId:'session',name:'助手'};
  const graph:GraphSnapshot={version:1,identity,cursor:{...identity,streamId:'graph',seq:1},root:{kind:'session-root',nodeId:'root',identity,agent,revision:1,createdAt:stamp},tasks:[],edges:[],agents:[]};
  return {workspaceId,members:[member(workspaceId)],sessions:[{workspaceId,teamId:'team',agentId:agent.agentId,agentInstanceId:agent.agentInstanceId,agentSessionId:'session',rootSessionId:'root'}],graphs:[graph],outbox:[]};
}
function dispatch(status:TaskNode['status']='queued',seq=2):DispatchMutation {
  const identity={workspaceId:'a',rootSessionId:'root'},agent={agentId:'cbim:main',agentInstanceId:'member',agentSessionId:'session',name:'助手'};
  const task:TaskNode={kind:'task',identity,nodeId:'task:conversation',taskId:'conversation',requester:agent,assignee:agent,modules:[{moduleId:'game',name:'玩法',knowledgeRevision:'k1',maintenanceBindingId:'maint',maintainerPersonIds:['person'],workflow:{kind:'general',id:'general',version:'1',reason:'无模块流程'}}],goal:'PRIVATE GOAL',acceptance:[],revision:seq-1,planRevision:1,status,awaitedChildren:[],runIds:[],createdAt:stamp,updatedAt:stamp};
  return {receipt:{},batch:{version:1,identity,streamId:'graph',seq,eventId:'event-'+seq,commandId:'command-'+seq,cause:'task.dispatched',committedAt:stamp,changes:[{type:'task.upserted',task}]},messages:seq===2?[{kind:'assignment',messageId:'message',commandId:'command-2',identity,from:agent,to:agent,taskId:task.taskId,planRevision:1,createdAt:stamp,delivery:'pending'}]:[]};
}
function summary(events:StoredEvent[],status:RunSummary['status']='completed'):RunSummary{return {task:task(events[0].workspaceId),runId:events[0].runId,status,acceptance:'not_evaluated',unresolvedTools:[],sessionFile:'C:/private/model-session.json',events}}

test('global index keeps workspace, dispatch task and legacy role-only run identities separate',()=>{
  const manager=new GlobalRuntimeManager(),a=manager.Begin('a','项目 A'),b=manager.Begin('b','项目 B');
  manager.RestoreDispatch('a',a,baseline());manager.RestoreDispatch('b',b,baseline('b'));manager.Ready('a',a);manager.Ready('b',b);
  manager.DispatchCommitted('a',a,dispatch());manager.RunEvent('a',a,start());manager.RunEvent('b',b,start('b'));
  const state=manager.Snapshot();
  expect(state.pressure).toMatchObject({memberInstances:2,taskInstances:3,activeRuns:2,activeMembers:0,queuedDispatchTasks:1,pendingOutbox:1});
  expect(state.tasks.filter(t=>t.source==='loop').every(t=>t.binding==='role-only'&&!('agentInstanceId' in t))).toBe(true);
  expect(state.tasks.find(t=>t.source==='dispatch')).toMatchObject({binding:'instance',agentInstanceId:'member',runIds:[],status:'queued'});
  expect(state.members.every(m=>m.activityCurrent===false)).toBe(true);
  expect(JSON.stringify(state)).not.toMatch(/PRIVATE|C:\/private|sessionFile/);
  state.members[0].waitingTaskIds.push('external');state.runs[0].usage.total=100;
  expect(manager.Snapshot().members[0].waitingTaskIds).toEqual([]);expect(manager.Snapshot().usage.total).toBe(0);
});
test('committed dispatch updates and queue changes are deduplicated; cursor reads do no snapshot work',()=>{
  const manager=new GlobalRuntimeManager(),epoch=manager.Begin('a','项目');manager.RestoreDispatch('a',epoch,baseline());manager.Ready('a',epoch);
  manager.DispatchCommitted('a',epoch,dispatch());const first=manager.Snapshot();
  manager.DispatchCommitted('a',epoch,dispatch());expect(manager.Read(first.cursor)).toEqual({mode:'noop',cursor:first.cursor});
  manager.DispatchCommitted('a',epoch,dispatch('waiting',3));manager.Queue('a',epoch,{pending:3,paused:1,inserting:1});
  const second=manager.Snapshot();expect(second.pressure).toMatchObject({queuedDispatchTasks:0,waitingDispatchTasks:1,queuedConversationMessages:3,pausedConversationMessages:1,insertingConversationMessages:1,pendingOutbox:1});
  manager.Queue('a',epoch,{pending:3,paused:1,inserting:1});expect(manager.Read(second.cursor).mode).toBe('noop');
  expect(manager.Read({...second.cursor,streamId:'old-app'}).mode).toBe('snapshot');
});
test('real event consumption ignores duplicate sequences and stream fragments, summary replaces message totals',()=>{
  const manager=new GlobalRuntimeManager(),epoch=manager.Begin('a','项目');manager.Ready('a',epoch);manager.RunEvent('a',epoch,start());
  const initial=manager.Snapshot().cursor;
  manager.RunEvent('a',epoch,event(2,'message.delta',{text:'PRIVATE FRAGMENT'}));expect(manager.Read(initial).mode).toBe('noop');
  const report=event(3,'message',{text:'PRIVATE ANSWER',usage:{input:100,output:60,reasoning:20,cacheRead:10,cacheWrite:0,cost:{total:0}}});
  manager.RunEvent('a',epoch,report);manager.RunEvent('a',epoch,report);
  expect(manager.Snapshot().usage).toMatchObject({total:170,reasoning:20,unpricedRuns:1,costPartial:true,reportedRuns:1});
  manager.RunEvent('a',epoch,event(4,'engine.status',{metric:'run-usage',tokens:{input:200,output:80,cacheRead:20,cacheWrite:0},cost:0.03,pricingKnown:true}));
  manager.RunEvent('a',epoch,event(5,'run.settled',{status:'failed'}));
  expect(manager.Snapshot().usage).toMatchObject({total:300,reasoning:20,cost:0.03,costPartial:false,runCount:1,reportedRuns:1,unpricedRuns:0});
  expect(manager.Snapshot().runs[0]).toMatchObject({status:'failed',phase:'settled'});expect(manager.Snapshot().pressure.activeRuns).toBe(0);
});
test('restore counts cancelled and failed consumption without reviving historical activity or duplicate runs',()=>{
  const manager=new GlobalRuntimeManager(),epoch=manager.Begin('a','项目');
  const first=summary([start(),event(2,'message',{usage:{input:10,output:5},pricingKnown:true})],'running');
  manager.RestoreRun('a',epoch,first);manager.RestoreRun('a',epoch,first);
  manager.RestoreRun('a',epoch,summary([start('a','second'),event(2,'engine.status',{metric:'run-usage',tokens:{input:5,output:5,cacheRead:0,cacheWrite:0},cost:0,pricingKnown:true},'a','second')],'cancelled'));
  manager.Ready('a',epoch);
  const state=manager.Snapshot();expect(state.runs.map(r=>r.status)).toEqual(['interrupted','cancelled']);
  expect(state.pressure.activeRuns).toBe(0);expect(state.usage).toMatchObject({runCount:2,total:25,cost:0,costPartial:true,reportedRuns:2,unreportedRuns:0,unpricedRuns:1});
  expect(JSON.stringify(state)).not.toContain('sessionFile');
});
test('workspace epochs reject delayed callbacks; closing retains history but ends observed activity',()=>{
  const manager=new GlobalRuntimeManager(),old=manager.Begin('a','项目');manager.Ready('a',old);manager.RunEvent('a',old,start());
  manager.DispatchCommitted('a',old,{receipt:{},members:[{...member(),activity:'working',activeTaskId:'task',activeRunId:'other-run'}]});
  expect(manager.Snapshot().pressure.activeMembers).toBe(1);
  manager.Detach('a',old);expect(manager.Snapshot().pressure).toMatchObject({activeRuns:0,activeMembers:0});expect(manager.Snapshot().runs[0].status).toBe('interrupted');
  const closed=manager.Snapshot().cursor;manager.RunEvent('a',old,event(2,'message',{usage:{input:900,output:90}}));expect(manager.Read(closed).mode).toBe('noop');
  const current=manager.Begin('a','新名称');manager.Ready('a',current);const fresh=manager.Snapshot().cursor;
  manager.RunEvent('a',old,start());manager.Queue('a',old,{pending:5,paused:0,inserting:0});manager.Issue('a',old,'old','old');expect(manager.Read(fresh).mode).toBe('noop');
  manager.Rename('a','重命名');expect(manager.Snapshot().workspaces[0].name).toBe('重命名');
  manager.Forget('a');expect(manager.Snapshot().workspaces).toEqual([]);
});
test('unavailable or incomplete inputs remain visible rather than pretending empty healthy totals',()=>{
  const manager=new GlobalRuntimeManager(),epoch=manager.Begin('a','项目');expect(manager.Snapshot().complete).toBe(false);
  manager.Issue('a',epoch,'history','一条运行日志损坏');manager.Ready('a',epoch);expect(manager.Snapshot().complete).toBe(false);
  manager.RunEvent('a',epoch,start());expect(manager.Snapshot().usage).toMatchObject({usageReported:false,unreportedRuns:1,costPartial:true});expect(manager.Snapshot().usage.cost).toBeUndefined();
  const cursor=manager.Snapshot().cursor;manager.Issue('a',epoch,'history','一条运行日志损坏');expect(manager.Read(cursor).mode).toBe('noop');
  manager.Unavailable('a',epoch,'工作区不可用');expect(manager.Snapshot().pressure).toMatchObject({unavailableWorkspaces:1,activeRuns:0});
  expect(()=>manager.RunEvent('a',epoch,start('other'))).toThrow('其他工作区');
});
test('tool phase reports current run facts without fabricating instance ownership',()=>{
  const manager=new GlobalRuntimeManager(),epoch=manager.Begin('a','项目');manager.Ready('a',epoch);manager.RunEvent('a',epoch,start());
  manager.RunEvent('a',epoch,event(2,'tool.proposed',{command:'PRIVATE COMMAND'}));expect(manager.Snapshot().runs[0].phase).toBe('waiting');
  manager.RunEvent('a',epoch,event(3,'tool.started',{id:'tool'}));expect(manager.Snapshot().runs[0].phase).toBe('tool');
  manager.RunEvent('a',epoch,event(4,'tool.finished',{result:'PRIVATE RESULT'}));expect(manager.Snapshot().runs[0].phase).toBe('working');
  manager.RunEvent('a',epoch,event(5,'run.stop_requested'));expect(manager.Snapshot().runs[0].phase).toBe('stopping');
  manager.RunEvent('a',epoch,event(6,'run.settled',{status:'cancelled'}));expect(manager.Snapshot().runs[0].phase).toBe('settled');
  expect(manager.Snapshot().members).toEqual([]);expect(JSON.stringify(manager.Snapshot())).not.toContain('PRIVATE');
});
test('a newer history read does not overwrite a live run with the unfinished-log interrupted fallback',()=>{
  const manager=new GlobalRuntimeManager(),epoch=manager.Begin('a','项目');manager.Ready('a',epoch);manager.RunEvent('a',epoch,start());
  const startedTool=event(2,'tool.started',{id:'tool'}),usage=event(3,'message',{usage:{input:10,output:5}});
  manager.RestoreRun('a',epoch,summary([start(),startedTool,usage],'interrupted'));
  expect(manager.Snapshot().runs[0]).toMatchObject({status:'running',phase:'working'});expect(manager.Snapshot().pressure.activeRuns).toBe(1);
  manager.RunEvent('a',epoch,startedTool);manager.RunEvent('a',epoch,usage);
  expect(manager.Snapshot().usage.total).toBe(15);
  manager.RunEvent('a',epoch,event(4,'tool.started',{id:'next'}));expect(manager.Snapshot().runs[0].phase).toBe('tool');
  manager.RunEvent('a',epoch,event(5,'run.settled',{status:'completed'}));expect(manager.Snapshot().pressure.activeRuns).toBe(0);
});
test('corrupt restored status or runtime task shape cannot publish a partial run',()=>{
  const manager=new GlobalRuntimeManager(),epoch=manager.Begin('a','项目');manager.Ready('a',epoch);const cursor=manager.Snapshot().cursor;
  const broken=summary([start()]);broken.status='bogus' as RunSummary['status'];
  expect(()=>manager.RestoreRun('a',epoch,broken)).toThrow('状态或事件列表');
  const invalid=start();(invalid.data.task as unknown as {moduleIds:unknown}).moduleIds=null;
  expect(()=>manager.RunEvent('a',epoch,invalid)).toThrow('任务概要');
  expect(manager.Snapshot().runs).toEqual([]);expect(manager.Read(cursor).mode).toBe('noop');
});

test('成员运行归属派发节点，消费仍累计一次；claimed 与 processed 信封退出待消费压力',()=>{
  const manager=new GlobalRuntimeManager(),epoch=manager.Begin('a','项目');manager.RestoreDispatch('a',epoch,baseline());manager.Ready('a',epoch);
  const mutation=dispatch(),message=mutation.messages![0];manager.DispatchCommitted('a',epoch,mutation);
  const memberTask={...task(),agentId:'cbim:executor',mode:undefined};
  const memberBinding:MemberRunBinding={workspaceId:'a',teamId:'team',agentId:'cbim:executor',agentInstanceId:'executor',agentSessionId:'session',rootSessionId:'root',taskId:'conversation',runId:'run',leaseEpoch:1,planRevision:1};
  const began=event(1,'run.started',{task:memberTask,memberBinding});manager.RunEvent('a',epoch,began);
  const tokens=event(2,'message',{usage:{input:100,output:20},pricingKnown:false});manager.RunEvent('a',epoch,tokens);manager.RunEvent('a',epoch,tokens);
  expect(manager.Snapshot().pressure).toMatchObject({taskInstances:1,activeRuns:1,pendingOutbox:1});
  expect(manager.Snapshot().tasks.map(task=>task.source)).toEqual(['dispatch']);
  expect(manager.Snapshot().runs[0].memberBinding).toEqual(memberBinding);
  expect(manager.Snapshot().usage).toMatchObject({runCount:1,total:120});
  manager.DispatchCommitted('a',epoch,{receipt:{},messages:[{...message,delivery:'claimed',claim:{runId:'run',leaseEpoch:1}}]});
  expect(manager.Snapshot().pressure.pendingOutbox).toBe(0);
  manager.DispatchCommitted('a',epoch,{receipt:{},messages:[{...message,messageId:'result',delivery:'pending'}]});
  expect(manager.Snapshot().pressure.pendingOutbox).toBe(1);
  manager.DispatchCommitted('a',epoch,{receipt:{},messages:[{...message,messageId:'result',delivery:'processed'}]});
  expect(manager.Snapshot().pressure.pendingOutbox).toBe(0);
});

test('成员日志恢复可从起始事件确定绑定，摘要与起始身份冲突时不得发布统计',()=>{
  const manager=new GlobalRuntimeManager(),epoch=manager.Begin('a','项目'),state=baseline();
  const queued=dispatch();state.graphs[0].tasks.push((queued.batch!.changes[0] as {task:TaskNode}).task);
  const message=queued.messages![0];state.outbox=[{...message,delivery:'claimed'},{...message,messageId:'processed',delivery:'processed'},{...message,messageId:'pending',delivery:'pending'}];
  manager.RestoreDispatch('a',epoch,state);manager.Ready('a',epoch);
  const memberTask={...task(),agentId:'cbim:executor',mode:undefined};
  const memberBinding:MemberRunBinding={workspaceId:'a',teamId:'team',agentId:'cbim:executor',agentInstanceId:'executor',agentSessionId:'session',rootSessionId:'root',taskId:'conversation',runId:'run',leaseEpoch:1,planRevision:1};
  const events=[event(1,'run.started',{task:memberTask,memberBinding}),event(2,'message',{usage:{input:10,output:2}}),event(3,'run.settled',{status:'completed'})];
  const recovered={...summary(events),task:memberTask};
  manager.RestoreRun('a',epoch,recovered);manager.RestoreRun('a',epoch,recovered);
  expect(manager.Snapshot().runs[0].memberBinding).toEqual(memberBinding);
  expect(manager.Snapshot().pressure).toMatchObject({taskInstances:1,pendingOutbox:1,activeRuns:0});
  expect(manager.Snapshot().usage).toMatchObject({runCount:1,total:12});
  const other=new GlobalRuntimeManager(),otherEpoch=other.Begin('a','项目');
  expect(()=>other.RestoreRun('a',otherEpoch,{...recovered,memberBinding:{...memberBinding,agentSessionId:'wrong'}})).toThrow('成员身份不一致');
  expect(other.Snapshot().runs).toEqual([]);
});

function conversationBinding(rootSessionId='conversation',agentInstanceId='main-'+rootSessionId):ConversationAgentBinding{return {workspaceId:'a',teamId:'team',agentId:'cbim:main',agentInstanceId,agentSessionId:'chat-'+rootSessionId,rootSessionId}}
function conversationStart(binding=conversationBinding(),runId='run'):StoredEvent{return {...start('a',runId),taskId:binding.rootSessionId,data:{task:{...task(),taskId:binding.rootSessionId},conversationBinding:binding}}}
function registerConversation(manager:GlobalRuntimeManager,epoch:number,binding:ConversationAgentBinding){manager.DispatchCommitted('a',epoch,{receipt:{},members:[{...member(),agentInstanceId:binding.agentInstanceId,agentSessionIds:[binding.agentSessionId],mainRootSessionId:binding.rootSessionId}]})}

test('主会话按可信实例绑定报告真实活动，等待与终态不创建派发业务任务',()=>{
  const manager=new GlobalRuntimeManager(),epoch=manager.Begin('a','项目'),binding=conversationBinding();manager.Ready('a',epoch);registerConversation(manager,epoch,binding);
  manager.RunEvent('a',epoch,conversationStart(binding));
  let state=manager.Snapshot();expect(state.pressure).toMatchObject({memberInstances:1,activeMembers:1,workingMembers:1,taskInstances:1,queuedDispatchTasks:0});
  expect(state.tasks[0]).toMatchObject({source:'loop',binding:'instance',agentInstanceId:binding.agentInstanceId,agentSessionId:binding.agentSessionId,rootSessionId:'conversation'});
  expect(state.members[0]).toMatchObject({activity:'working',activityCurrent:true,activeConversation:{rootSessionId:'conversation',agentSessionId:binding.agentSessionId,runId:'run'}});expect(state.members[0].activeTaskId).toBeUndefined();
  manager.RunEvent('a',epoch,event(2,'tool.proposed'));expect(manager.Snapshot().pressure).toMatchObject({workingMembers:0,waitingMembers:1,activeMembers:1});
  manager.RunEvent('a',epoch,event(3,'tool.started'));expect(manager.Snapshot().members[0].activity).toBe('working');
  manager.RunEvent('a',epoch,event(4,'message',{usage:{input:10,output:2}}));manager.RunEvent('a',epoch,event(4,'message',{usage:{input:10,output:2}}));
  manager.RunEvent('a',epoch,event(5,'run.settled',{status:'completed'}));state=manager.Snapshot();
  expect(state.pressure).toMatchObject({activeMembers:0,activeRuns:0,taskInstances:1});expect(state.members[0].activeConversation).toBeUndefined();expect(state.usage).toMatchObject({runCount:1,total:12});
});

test('同名主角色的两个主会话保持两个实例、独立通道与独立活动，旧对话仍无实例绑定',()=>{
  const manager=new GlobalRuntimeManager(),epoch=manager.Begin('a','项目'),one=conversationBinding(),two=conversationBinding('second');manager.Ready('a',epoch);
  for(const binding of [one,two]){registerConversation(manager,epoch,binding);manager.RunEvent('a',epoch,conversationStart(binding,binding.rootSessionId))}
  const legacy={...start('a','legacy'),taskId:'legacy',data:{task:{...task(),taskId:'legacy'}}};manager.RunEvent('a',epoch,legacy);
  const state=manager.Snapshot();expect(state.pressure).toMatchObject({memberInstances:2,activeMembers:2,activeRuns:3,taskInstances:3});
  expect(state.members.map(item=>item.activeConversation?.rootSessionId)).toEqual(['conversation','second']);
  expect(state.members.map(item=>item.mainRootSessionId)).toEqual(['conversation','second']);
  expect(state.tasks.find(item=>item.taskId==='legacy')).toMatchObject({source:'loop',binding:'role-only'});
  expect(state.runs.find(item=>item.runId==='legacy')?.conversationBinding).toBeUndefined();
  manager.Detach('a',epoch);expect(manager.Snapshot().pressure).toMatchObject({activeMembers:0,activeRuns:0});expect(manager.Snapshot().members.every(item=>item.activeConversation===undefined)).toBe(true);
});

test('主会话日志恢复保留绑定与消费，不复活活动；摘要与起始身份冲突不可发布',()=>{
  const manager=new GlobalRuntimeManager(),epoch=manager.Begin('a','项目'),binding=conversationBinding();registerConversation(manager,epoch,binding);
  const began=conversationStart(binding),events=[began,event(2,'message',{usage:{input:20,output:3}})],history=summary(events,'running');
  manager.RestoreRun('a',epoch,history);manager.Ready('a',epoch);
  expect(manager.Snapshot().runs[0]).toMatchObject({conversationBinding:binding,status:'interrupted'});expect(manager.Snapshot().pressure).toMatchObject({activeMembers:0,activeRuns:0});expect(manager.Snapshot().usage.total).toBe(23);
  const other=new GlobalRuntimeManager(),otherEpoch=other.Begin('a','项目');
  expect(()=>other.RestoreRun('a',otherEpoch,{...history,conversationBinding:{...binding,agentInstanceId:'another-instance'}})).toThrow('主会话身份不一致');expect(other.Snapshot().runs).toEqual([]);
  const invalid=conversationStart({...binding,rootSessionId:'other'});invalid.data.task=task();
  expect(()=>other.RunEvent('a',otherEpoch,{...invalid,taskId:'conversation'})).toThrow('根会话不一致');
  expect(()=>other.RunEvent('a',otherEpoch,{...began,data:{...began.data,memberBinding:{}}})).toThrow('同时绑定');expect(other.Snapshot().runs).toEqual([]);
});

test('只有运行绑定而缺少登记实例时不补造人员，独立执行轮次不重复合成任务',()=>{
  const manager=new GlobalRuntimeManager(),epoch=manager.Begin('a','项目'),binding=conversationBinding('conversation','member');manager.RestoreDispatch('a',epoch,baseline());manager.Ready('a',epoch);
  manager.RunEvent('a',epoch,conversationStart(binding,'chat-run'));manager.RunEvent('a',epoch,event(2,'message',{usage:{input:10,output:2}},'a','chat-run'));manager.RunEvent('a',epoch,event(3,'run.settled',{status:'completed'},'a','chat-run'));
  manager.DispatchCommitted('a',epoch,dispatch());
  const memberBinding:MemberRunBinding={...binding,agentId:'cbim:executor',agentInstanceId:'executor',agentSessionId:'session',rootSessionId:'root',taskId:'conversation',runId:'business-run',leaseEpoch:1,planRevision:1};
  manager.RunEvent('a',epoch,event(1,'run.started',{task:{...task(),agentId:'cbim:executor',mode:undefined},memberBinding},'a','business-run'));manager.RunEvent('a',epoch,event(2,'message',{usage:{input:20,output:3}},'a','business-run'));
  const state=manager.Snapshot();expect(state.pressure).toMatchObject({memberInstances:1,taskInstances:2,activeRuns:1});expect(state.tasks.map(item=>item.source)).toEqual(['dispatch','loop']);expect(state.usage).toMatchObject({runCount:2,total:35});
  const unknown=new GlobalRuntimeManager(),unknownEpoch=unknown.Begin('a','项目');unknown.Ready('a',unknownEpoch);unknown.RunEvent('a',unknownEpoch,conversationStart());expect(unknown.Snapshot().members).toEqual([]);expect(unknown.Snapshot().pressure.activeMembers).toBe(0);
});

test('执行周期释放后保留实例和消费历史但退出当前压力，主调度实例继续保留',()=>{
  const manager=new GlobalRuntimeManager(),epoch=manager.Begin('a','项目');manager.RestoreDispatch('a',epoch,baseline());manager.Ready('a',epoch);
  const executor:AgentInstance={...member(),agentId:'cbim:executor',agentInstanceId:'executor',executionScopeId:'scope',executionTaskId:'conversation',lifecycle:'active',activity:'working',activeTaskId:'conversation',activeRunId:'business-run'};
  manager.DispatchCommitted('a',epoch,{receipt:{},members:[executor]});
  const binding:MemberRunBinding={workspaceId:'a',teamId:'team',agentId:executor.agentId,agentInstanceId:executor.agentInstanceId,agentSessionId:'executor-session',rootSessionId:'root',taskId:'conversation',runId:'business-run',leaseEpoch:1,planRevision:1};
  manager.RunEvent('a',epoch,event(1,'run.started',{task:{...task(),agentId:executor.agentId,mode:undefined},memberBinding:binding},'a','business-run'));manager.RunEvent('a',epoch,event(2,'message',{usage:{input:30,output:4}},'a','business-run'));
  expect(manager.Snapshot().pressure).toMatchObject({memberInstances:2,activeMembers:1,activeRuns:1});
  const released:AgentInstance={...executor,lifecycle:'released',releasedAt:stamp,activity:'idle',activeTaskId:undefined,activeRunId:undefined,leaseEpoch:2};manager.DispatchCommitted('a',epoch,{receipt:{},members:[released]});
  const state=manager.Snapshot();expect(state.members).toHaveLength(2);expect(state.members.find(item=>item.agentInstanceId==='executor')).toMatchObject({executionScopeId:'scope',executionTaskId:'conversation',lifecycle:'released',releasedAt:stamp,activityCurrent:false});
  expect(state.pressure).toMatchObject({memberInstances:1,activeMembers:0,activeRuns:0});expect(state.usage).toMatchObject({runCount:1,total:34});expect(state.members.find(item=>item.agentId==='cbim:main')).toBeDefined();
  const restored=new GlobalRuntimeManager(),next=restored.Begin('a','项目'),base=baseline();base.members.push(released);restored.RestoreDispatch('a',next,base);restored.Ready('a',next);expect(restored.Snapshot().pressure).toMatchObject({memberInstances:1,activeMembers:0});expect(restored.Snapshot().members).toHaveLength(2);
});
