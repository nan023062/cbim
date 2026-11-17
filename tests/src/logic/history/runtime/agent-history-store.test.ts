import {afterEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AgentHistoryService} from '../../../../../src/logic/history/runtime/agent-history';
import {FileAgentHistoryStore} from '../../../../../src/logic/history/service/file-store';
import {RunJournal} from '../../../../../src/logic/execution/storage/run-journal';
import type {StoredEvent,TaskSpec} from '../../../../../src/logic/execution/rules/types';
import type {AgentHistoryStore,AgentHistoryRecord} from '../../../../../src/logic/team/rules/session-history-storage';
import type {DispatchRun} from '../../../../../src/logic/tasks/rules/dispatch-execution';
import type {TaskNode} from '../../../../../src/logic/tasks/rules/graph-types';
import type {DispatchState} from '../../../../../src/logic/dispatch/rules/dispatch-storage';

const temporary:string[]=[];
afterEach(async()=>{for(const directory of temporary.splice(0))await fs.rm(directory,{recursive:true,force:true})});
const stamp='2026-11-07T10:00:00.000Z',workspaceId='history-workspace';
async function setup(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-agent-history-'));temporary.push(root);
  const directory=path.join(root,'archive'),store=new FileAgentHistoryStore(directory,workspaceId,root);
  const read=vi.fn((record:AgentHistoryRecord)=>RunJournal.Read(path.join(root,'canonical',record.view.taskId,record.view.runId)));
  const history=new AgentHistoryService(workspaceId,root,{store,Read: read});await history.Initialize();
  return {root,directory,store,read,history};
}
function started(root:string,taskId='task-one',runId='run-one',sessionId='session-one',agentId='cbim:main'):StoredEvent{
  const task:TaskSpec={taskId,workspaceId,root,goal:'历史任务 '+taskId,moduleIds:[],agentId,acceptance:[],...(agentId==='cbim:main'?{mode:'chat' as const}:{})};
  return {version:1,seq:1,workspaceId,taskId,runId,time:stamp,type:'run.started',data:{task,message:task.goal,...(agentId==='cbim:main'?{conversationBinding:{workspaceId,teamId:'.cbim/team',agentId,agentInstanceId:'instance-'+taskId,agentSessionId:sessionId,rootSessionId:taskId}}:{})}};
}
const next=(event:StoredEvent,seq:number,type:StoredEvent['type'],data:Record<string,unknown>):StoredEvent=>({...event,seq,type,data,time:stamp});
async function writeLog(root:string,start:StoredEvent,extra:StoredEvent[]=[]){
  const directory=path.join(root,'canonical',start.taskId,start.runId),journal=new RunJournal(directory,start.data.task as TaskSpec,start.runId);await journal.Init();
  for(const event of [start,...extra])await journal.Append({type:event.type,data:event.data});
  return {journal,summary:await RunJournal.Read(directory),directory};
}

describe('静态 Agent 持久化历史索引',()=>{
  it('列表从索引恢复不读正文，详情只恢复一次并持续消费已持久化增量',async()=>{
    const f=await setup(),start=started(f.root),log=await writeLog(f.root,start,[next(start,2,'message',{role:'assistant',text:'第一段',privateReasoning:'不公开'})]);
    for(const event of log.summary.events)f.history.ObserveRun(event,'loop');await f.history.Flush();
    expect((await f.history.Roles({workspaceId})).roles[0]).toMatchObject({agentId:'cbim:main',sessionCount:1,runCount:1});
    const sessions=await f.history.Sessions({workspaceId,agentId:'cbim:main'});expect(sessions.items[0].agentInstanceId).toBe('instance-task-one');
    await f.history.Runs({workspaceId,agentId:'cbim:main',sessionId:'session-one'});expect(f.read).not.toHaveBeenCalled();
    const identity={workspaceId,agentId:'cbim:main',sessionId:'session-one',taskId:start.taskId,runId:start.runId};
    const first=await f.history.Events({...identity,limit:1});expect(first.mode).toBe('reset');expect(f.read).toHaveBeenCalledTimes(1);
    const second=await f.history.Events({...identity,cursor:first.cursor});expect(second.mode).toBe('delta');expect(JSON.stringify(second)).not.toContain('privateReasoning');expect(f.read).toHaveBeenCalledTimes(1);
    const addition=await log.journal.Append({type:'message',data:{role:'assistant',text:'实时新增'}});f.history.ObserveRun(addition,'loop');
    const delta=await f.history.Events({...identity,cursor:second.cursor});expect(delta.mode).toBe('delta');if(delta.mode!=='noop')expect(delta.events[0].data.text).toBe('实时新增');
    const ended=await log.journal.Append({type:'run.settled',data:{status:'completed'}});f.history.ObserveRun(ended,'loop');await f.history.Close();
    const reopened=new AgentHistoryService(workspaceId,f.root,{store:f.store,Read:f.read});await reopened.Initialize();
    expect((await reopened.Runs({workspaceId,agentId:'cbim:main',sessionId:'session-one'})).items[0].status).toBe('completed');expect(f.read).toHaveBeenCalledTimes(1);
    await reopened.Close();
  });

  it('同时间大小写/标点身份分页不漏不重，游标不能跨角色或查询层级',async()=>{
    const f=await setup();
    for(const id of ['z','Z','a_1','a-1'])f.history.ObserveRun(started(f.root,'task-'+id,'run-'+id,'session-'+id),'loop');
    const seen:string[]=[];let cursor:string|undefined;
    do{const page=await f.history.Sessions({workspaceId,agentId:'cbim:main',limit:1,cursor});seen.push(...page.items.map(x=>x.sessionId));cursor=page.nextCursor}while(cursor);
    expect(new Set(seen).size).toBe(4);expect(seen).toEqual(['session-Z','session-a-1','session-a_1','session-z']);
    const first=await f.history.Sessions({workspaceId,agentId:'cbim:main',limit:1});
    await expect(f.history.Sessions({workspaceId,agentId:'other',cursor:first.nextCursor})).rejects.toMatchObject({code:'AGENT_HISTORY_CURSOR'});
    await expect(f.history.Runs({workspaceId,agentId:'cbim:main',sessionId:seen[0],cursor:first.nextCursor})).rejects.toMatchObject({code:'AGENT_HISTORY_CURSOR'});
    await f.history.Close();
  });

  it('旧明确角色只建legacy分组，无角色/矛盾绑定保持诊断且不补造实例',async()=>{
    const f=await setup(),legacy=started(f.root,'old-task','old-run','ignored','.cbim/team/old-agent');
    f.history.ObserveRun(legacy,'loop');
    const noAgent=started(f.root,'unknown-task','unknown-run');delete (noAgent.data.task as TaskSpec).agentId;delete noAgent.data.conversationBinding;f.history.ObserveRun(noAgent,'loop');
    const conflict=started(f.root,'conflict-task','conflict-run');(conflict.data.conversationBinding as any).rootSessionId='wrong';f.history.ObserveRun(conflict,'loop');
    const roles=await f.history.Roles({workspaceId});expect(roles.roles.map(x=>x.agentId)).toEqual(['.cbim/team/old-agent']);expect(roles.diagnostics.length).toBe(2);
    const session=(await f.history.Sessions({workspaceId,agentId:'.cbim/team/old-agent'})).items[0];expect(session.sessionId).toBe('legacy:old-task');expect(session).not.toHaveProperty('agentSessionId');expect(session).not.toHaveProperty('agentInstanceId');
    await f.history.Close();
  });

  it('单条索引损坏可见、其他记录仍可查，canonical恢复幂等修复损坏条目',async()=>{
    const f=await setup(),a=started(f.root),b=started(f.root,'task-two','run-two','session-two');
    const first=await writeLog(f.root,a,[next(a,2,'run.settled',{status:'completed'})]);
    f.history.RestoreRun(first.summary,'loop');f.history.ObserveRun(b,'loop');await f.history.Close();
    const loaded=await f.store.Load();expect(loaded.records).toHaveLength(2);
    const {hash}=await import('../../../../../src/core/platform/node/serialization');
    const file=path.join(f.directory,hash('cbim:main'),'sessions',hash('session-one'),hash(JSON.stringify([a.taskId,a.runId]))+'.json');await fs.writeFile(file,'{broken');
    const reopened=new AgentHistoryService(workspaceId,f.root,{store:f.store,Read:f.read});await reopened.Initialize();
    expect((await reopened.Roles({workspaceId})).roles[0].runCount).toBe(1);expect((await reopened.Roles({workspaceId})).diagnostics).not.toHaveLength(0);
    reopened.RestoreRun(first.summary,'loop');reopened.RestoreRun(first.summary,'loop');await reopened.Close();
    expect((await f.store.Load()).records).toHaveLength(2);expect((await f.store.Load()).diagnostics).toHaveLength(0);
  });

  it('执行意图在模型/日志启动前失败仍保留角色履历，不伪造执行事件',async()=>{
    const f=await setup(),agentId='cbim:executor',taskId='dispatch-task',runId='dispatch-run';
    const binding={workspaceId,teamId:'.cbim/team',agentId,agentInstanceId:'executor-instance',agentSessionId:'executor-session',rootSessionId:'main-root',taskId,runId,leaseEpoch:1,planRevision:1};
    const task={taskId,identity:{workspaceId,rootSessionId:'main-root'},assignee:{agentId,agentInstanceId:binding.agentInstanceId,agentSessionId:binding.agentSessionId},goal:'启动失败也保留',modules:[{moduleId:'client'}],acceptance:[{text:'可验证'}]} as TaskNode;
    const run={binding,status:'starting',prepared:{agent:{agentId,name:'默认执行 Agent',knowledgeRevision:'rev'}},createdAt:stamp} as DispatchRun;
    f.history.RestoreDispatch({workspaceId,members:[],sessions:[],graphs:[{tasks:[task]}],outbox:[],runs:[run]} as unknown as DispatchState);
    f.history.DispatchCommitted({runs:[{...run,status:'failed',settledAt:stamp}],receipt:{}});await f.history.Flush();
    const record=(await f.history.Runs({workspaceId,agentId,sessionId:binding.agentSessionId})).items[0];expect(record.status).toBe('failed');
    const read=await f.history.Events({workspaceId,agentId,sessionId:binding.agentSessionId,taskId,runId});expect(read.run.status).toBe('failed');if(read.mode!=='noop')expect(read.events).toEqual([]);
    expect((await f.store.Load()).records[0].journalSeen).toBe(false);await f.history.Close();
  });

  it('索引写失败不改变运行但明确诊断，关闭等待正在写入的索引',async()=>{
    const f=await setup();let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve});
    const put=vi.fn(async()=>{await blocked;throw Error('disk unavailable')});
    const store:AgentHistoryStore={Load:async()=>({records:[],diagnostics:[]}),Put: put},history=new AgentHistoryService(workspaceId,f.root,{store,Read:f.read});await history.Initialize();
    expect(()=>history.ObserveRun(started(f.root),'loop')).not.toThrow();let closed=false;const closing=history.Close().then(()=>{closed=true});await Promise.resolve();expect(closed).toBe(false);release();await closing;expect(put).toHaveBeenCalledTimes(1);
    // 未关闭的独立服务可直接在查询中观察失败，不需要等待重启才显示错误。
    const visible=new AgentHistoryService(workspaceId,f.root,{store,Read:f.read});await visible.Initialize();visible.ObserveRun(started(f.root),'loop');await visible.Flush();expect((await visible.Roles({workspaceId})).diagnostics).toEqual([expect.stringContaining('未能保存')]);await visible.Close();
  });

  it('已缓存流遇到重复序号不同正文后保持故障，不能返回旧流掩盖冲突',async()=>{
    const f=await setup(),start=started(f.root),log=await writeLog(f.root,start,[next(start,2,'message',{role:'assistant',text:'原文'})]);
    for(const event of log.summary.events)f.history.ObserveRun(event,'loop');
    const identity={workspaceId,agentId:'cbim:main',sessionId:'session-one',taskId:start.taskId,runId:start.runId};
    const first=await f.history.Events(identity);f.history.ObserveRun({...log.summary.events[1],data:{role:'assistant',text:'冲突'}},'loop');
    await expect(f.history.Events({...identity,cursor:first.cursor})).rejects.toMatchObject({code:'AGENT_HISTORY_UNREADABLE'});expect(f.read).toHaveBeenCalledTimes(1);await f.history.Close();
  });

  it('加载中的详情不会被其他历史页淘汰，恢复与实时事件交错仍形成连续增量',async()=>{
    const f=await setup(),start=started(f.root);let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve});
    const summaries=new Map<string,Awaited<ReturnType<typeof RunJournal.Read>>>();
    const first=await writeLog(f.root,start);summaries.set(start.runId,first.summary);
    const read=vi.fn(async(record:AgentHistoryRecord)=>{if(record.view.runId===start.runId)await blocked;return structuredClone(summaries.get(record.view.runId)!)});
    const history=new AgentHistoryService(workspaceId,f.root,{store:f.store,Read: read});await history.Initialize();history.ObserveRun(first.summary.events[0],'loop');
    const identity={workspaceId,agentId:'cbim:main',sessionId:'session-one',taskId:start.taskId,runId:start.runId},initial=history.Events(identity);
    for(let i=0;i<25;i++){
      const other=started(f.root,'other-'+i,'other-run-'+i,'other-session-'+i),log=await writeLog(f.root,other,[next(other,2,'run.settled',{status:'completed'})]);summaries.set(other.runId,log.summary);history.RestoreRun(log.summary,'loop');
      await history.Events({workspaceId,agentId:'cbim:main',sessionId:'other-session-'+i,taskId:other.taskId,runId:other.runId});
    }
    const addition=await first.journal.Append({type:'message',data:{role:'assistant',text:'加载期间新增'}});history.ObserveRun(addition,'loop');release();
    const loaded=await initial;expect(loaded.cursor.seq).toBe(2);if(loaded.mode!=='noop')expect(loaded.events[1].data.text).toBe('加载期间新增');
    expect((await history.Events({...identity,cursor:loaded.cursor})).mode).toBe('noop');expect(read.mock.calls.filter(([record])=>record.view.runId===start.runId)).toHaveLength(1);await history.Close();
  });

  it('重复起始事件不会把已完成索引重置成正在执行',async()=>{
    const f=await setup(),start=started(f.root),log=await writeLog(f.root,start,[next(start,2,'run.settled',{status:'completed'})]);
    f.history.RestoreRun(log.summary,'loop');f.history.ObserveRun(log.summary.events[0],'loop');
    expect((await f.history.Runs({workspaceId,agentId:'cbim:main',sessionId:'session-one'})).items[0].status).toBe('completed');await f.history.Close();
  });
});

function recursiveStart(root:string){
 const start=started(root,'child-task','child-run','child-session','.cbim/team/worker');
 (start.data.task as TaskSpec).moduleIds=['.cbim/workspace/app'];
 start.data.memberBinding={workspaceId,teamId:'.cbim/team',agentId:'.cbim/team/worker',agentInstanceId:'child-instance',agentSessionId:'child-session',rootSessionId:'root-task',taskId:'child-task',runId:'child-run',leaseEpoch:0,planRevision:1};
 start.data.executionModel='agent-tools-v1';
 start.data.agentCall={version:1,workspaceId,callerTaskId:'root-task',callerRunId:'root-run',toolCallId:'call-child',taskId:'child-task',runId:'child-run'};
 return start;
}
it('archives a recursive business child in its original loop journal and restores the same identity',async()=>{
 const f=await setup(),start=recursiveStart(f.root),log=await writeLog(f.root,start,[next(start,2,'message',{role:'assistant',text:'child evidence'}),next(start,3,'run.settled',{status:'completed'})]);
 for(const event of log.summary.events)f.history.ObserveRun(event,'loop');await f.history.Close();
 const stored=await f.store.Load();expect(stored.diagnostics).toEqual([]);expect(stored.records).toHaveLength(1);
 expect(stored.records[0]).toMatchObject({kind:'task',journal:'loop',agentCall:start.data.agentCall,view:{source:'member',binding:'registered',status:'completed',rootSessionId:'root-task'}});
 const reopened=new AgentHistoryService(workspaceId,f.root,{store:f.store,Read:f.read});await reopened.Initialize();
 expect((await reopened.Roles({workspaceId})).diagnostics).toEqual([]);
 const events=await reopened.Events({workspaceId,agentId:'.cbim/team/worker',sessionId:'child-session',taskId:'child-task',runId:'child-run'});
 expect(JSON.stringify(events)).toContain('child evidence');expect(f.read).toHaveBeenCalledTimes(1);await reopened.Close();
});
it.each(['missing-protocol','foreign-child','self-reference','legacy-directory'] as const)('does not relabel invalid recursive history as a legacy member (%s)',async mode=>{
 const f=await setup(),start=recursiveStart(f.root);
 if(mode==='missing-protocol')delete start.data.executionModel;
 if(mode==='foreign-child')(start.data.agentCall as any).taskId='foreign-task';
 if(mode==='self-reference')(start.data.agentCall as any).callerRunId=start.runId;
 f.history.ObserveRun(start,mode==='legacy-directory'?'member':'loop');await f.history.Flush();
 const roles=await f.history.Roles({workspaceId});expect(roles.roles).toEqual([]);expect(roles.diagnostics).not.toHaveLength(0);expect((await f.store.Load()).records).toEqual([]);await f.history.Close();
});
it('a changed parent reference in canonical child history cannot reuse the old indexed identity',async()=>{
 const f=await setup(),start=recursiveStart(f.root),log=await writeLog(f.root,start,[next(start,2,'run.settled',{status:'completed'})]);
 f.history.RestoreRun(log.summary,'loop');await f.history.Flush();
 const file=path.join(log.directory,'events.jsonl'),bytes=await fs.readFile(file,'utf8');
 await fs.writeFile(file,bytes.replace('"callerRunId":"root-run"','"callerRunId":"other-run"'));
 await expect(f.history.Events({workspaceId,agentId:'.cbim/team/worker',sessionId:'child-session',taskId:'child-task',runId:'child-run'})).rejects.toMatchObject({code:'AGENT_HISTORY_UNREADABLE'});
 await f.history.Close();
});
