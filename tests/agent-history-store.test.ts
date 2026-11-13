import {afterEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AgentHistoryService} from '../src/logic/history/runtime/agent-history';
import {FileAgentHistoryStore} from '../src/backend/main/history/file-store';
import {RunJournal} from '../src/backend/main/run-storage/run-journal';
import type {StoredEvent,TaskSpec} from '../src/logic/execution/rules/types';
import type {AgentHistoryStore,AgentHistoryRecord} from '../src/logic/team/rules/session-history-storage';
import type {DispatchRun} from '../src/logic/tasks/rules/dispatch-execution';
import type {TaskNode} from '../src/logic/tasks/rules/graph-types';
import type {DispatchState} from '../src/logic/dispatch/rules/dispatch-storage';

const temporary:string[]=[];
afterEach(async()=>{for(const directory of temporary.splice(0))await fs.rm(directory,{recursive:true,force:true})});
const stamp='2026-11-07T10:00:00.000Z',workspaceId='history-workspace';
async function setup(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-agent-history-'));temporary.push(root);
  const directory=path.join(root,'archive'),store=new FileAgentHistoryStore(directory,workspaceId,root);
  const read=vi.fn((record:AgentHistoryRecord)=>RunJournal.read(path.join(root,'canonical',record.view.taskId,record.view.runId)));
  const history=new AgentHistoryService(workspaceId,root,{store,read});await history.initialize();
  return {root,directory,store,read,history};
}
function started(root:string,taskId='task-one',runId='run-one',sessionId='session-one',agentId='cbim:main'):StoredEvent{
  const task:TaskSpec={taskId,workspaceId,root,goal:'历史任务 '+taskId,moduleIds:[],agentId,acceptance:[],...(agentId==='cbim:main'?{mode:'chat' as const}:{})};
  return {version:1,seq:1,workspaceId,taskId,runId,time:stamp,type:'run.started',data:{task,message:task.goal,...(agentId==='cbim:main'?{conversationBinding:{workspaceId,teamId:'.cbim/team',agentId,agentInstanceId:'instance-'+taskId,agentSessionId:sessionId,rootSessionId:taskId}}:{})}};
}
const next=(event:StoredEvent,seq:number,type:StoredEvent['type'],data:Record<string,unknown>):StoredEvent=>({...event,seq,type,data,time:stamp});
async function writeLog(root:string,start:StoredEvent,extra:StoredEvent[]=[]){
  const directory=path.join(root,'canonical',start.taskId,start.runId),journal=new RunJournal(directory,start.data.task as TaskSpec,start.runId);await journal.init();
  for(const event of [start,...extra])await journal.append({type:event.type,data:event.data});
  return {journal,summary:await RunJournal.read(directory),directory};
}

describe('静态 Agent 持久化历史索引',()=>{
  it('列表从索引恢复不读正文，详情只恢复一次并持续消费已持久化增量',async()=>{
    const f=await setup(),start=started(f.root),log=await writeLog(f.root,start,[next(start,2,'message',{role:'assistant',text:'第一段',privateReasoning:'不公开'})]);
    for(const event of log.summary.events)f.history.observeRun(event,'loop');await f.history.flush();
    expect((await f.history.roles({workspaceId})).roles[0]).toMatchObject({agentId:'cbim:main',sessionCount:1,runCount:1});
    const sessions=await f.history.sessions({workspaceId,agentId:'cbim:main'});expect(sessions.items[0].agentInstanceId).toBe('instance-task-one');
    await f.history.runs({workspaceId,agentId:'cbim:main',sessionId:'session-one'});expect(f.read).not.toHaveBeenCalled();
    const identity={workspaceId,agentId:'cbim:main',sessionId:'session-one',taskId:start.taskId,runId:start.runId};
    const first=await f.history.events({...identity,limit:1});expect(first.mode).toBe('reset');expect(f.read).toHaveBeenCalledTimes(1);
    const second=await f.history.events({...identity,cursor:first.cursor});expect(second.mode).toBe('delta');expect(JSON.stringify(second)).not.toContain('privateReasoning');expect(f.read).toHaveBeenCalledTimes(1);
    const addition=await log.journal.append({type:'message',data:{role:'assistant',text:'实时新增'}});f.history.observeRun(addition,'loop');
    const delta=await f.history.events({...identity,cursor:second.cursor});expect(delta.mode).toBe('delta');if(delta.mode!=='noop')expect(delta.events[0].data.text).toBe('实时新增');
    const ended=await log.journal.append({type:'run.settled',data:{status:'completed'}});f.history.observeRun(ended,'loop');await f.history.close();
    const reopened=new AgentHistoryService(workspaceId,f.root,{store:f.store,read:f.read});await reopened.initialize();
    expect((await reopened.runs({workspaceId,agentId:'cbim:main',sessionId:'session-one'})).items[0].status).toBe('completed');expect(f.read).toHaveBeenCalledTimes(1);
    await reopened.close();
  });

  it('同时间大小写/标点身份分页不漏不重，游标不能跨角色或查询层级',async()=>{
    const f=await setup();
    for(const id of ['z','Z','a_1','a-1'])f.history.observeRun(started(f.root,'task-'+id,'run-'+id,'session-'+id),'loop');
    const seen:string[]=[];let cursor:string|undefined;
    do{const page=await f.history.sessions({workspaceId,agentId:'cbim:main',limit:1,cursor});seen.push(...page.items.map(x=>x.sessionId));cursor=page.nextCursor}while(cursor);
    expect(new Set(seen).size).toBe(4);expect(seen).toEqual(['session-Z','session-a-1','session-a_1','session-z']);
    const first=await f.history.sessions({workspaceId,agentId:'cbim:main',limit:1});
    await expect(f.history.sessions({workspaceId,agentId:'other',cursor:first.nextCursor})).rejects.toMatchObject({code:'AGENT_HISTORY_CURSOR'});
    await expect(f.history.runs({workspaceId,agentId:'cbim:main',sessionId:seen[0],cursor:first.nextCursor})).rejects.toMatchObject({code:'AGENT_HISTORY_CURSOR'});
    await f.history.close();
  });

  it('旧明确角色只建legacy分组，无角色/矛盾绑定保持诊断且不补造实例',async()=>{
    const f=await setup(),legacy=started(f.root,'old-task','old-run','ignored','.cbim/team/old-agent');
    f.history.observeRun(legacy,'loop');
    const noAgent=started(f.root,'unknown-task','unknown-run');delete (noAgent.data.task as TaskSpec).agentId;delete noAgent.data.conversationBinding;f.history.observeRun(noAgent,'loop');
    const conflict=started(f.root,'conflict-task','conflict-run');(conflict.data.conversationBinding as any).rootSessionId='wrong';f.history.observeRun(conflict,'loop');
    const roles=await f.history.roles({workspaceId});expect(roles.roles.map(x=>x.agentId)).toEqual(['.cbim/team/old-agent']);expect(roles.diagnostics.length).toBe(2);
    const session=(await f.history.sessions({workspaceId,agentId:'.cbim/team/old-agent'})).items[0];expect(session.sessionId).toBe('legacy:old-task');expect(session).not.toHaveProperty('agentSessionId');expect(session).not.toHaveProperty('agentInstanceId');
    await f.history.close();
  });

  it('单条索引损坏可见、其他记录仍可查，canonical恢复幂等修复损坏条目',async()=>{
    const f=await setup(),a=started(f.root),b=started(f.root,'task-two','run-two','session-two');
    const first=await writeLog(f.root,a,[next(a,2,'run.settled',{status:'completed'})]);
    f.history.restoreRun(first.summary,'loop');f.history.observeRun(b,'loop');await f.history.close();
    const loaded=await f.store.load();expect(loaded.records).toHaveLength(2);
    const {hash}=await import('../src/core/platform/node/serialization');
    const file=path.join(f.directory,hash('cbim:main'),'sessions',hash('session-one'),hash(JSON.stringify([a.taskId,a.runId]))+'.json');await fs.writeFile(file,'{broken');
    const reopened=new AgentHistoryService(workspaceId,f.root,{store:f.store,read:f.read});await reopened.initialize();
    expect((await reopened.roles({workspaceId})).roles[0].runCount).toBe(1);expect((await reopened.roles({workspaceId})).diagnostics).not.toHaveLength(0);
    reopened.restoreRun(first.summary,'loop');reopened.restoreRun(first.summary,'loop');await reopened.close();
    expect((await f.store.load()).records).toHaveLength(2);expect((await f.store.load()).diagnostics).toHaveLength(0);
  });

  it('执行意图在模型/日志启动前失败仍保留角色履历，不伪造执行事件',async()=>{
    const f=await setup(),agentId='cbim:executor',taskId='dispatch-task',runId='dispatch-run';
    const binding={workspaceId,teamId:'.cbim/team',agentId,agentInstanceId:'executor-instance',agentSessionId:'executor-session',rootSessionId:'main-root',taskId,runId,leaseEpoch:1,planRevision:1};
    const task={taskId,identity:{workspaceId,rootSessionId:'main-root'},assignee:{agentId,agentInstanceId:binding.agentInstanceId,agentSessionId:binding.agentSessionId},goal:'启动失败也保留',modules:[{moduleId:'client'}],acceptance:[{text:'可验证'}]} as TaskNode;
    const run={binding,status:'starting',prepared:{agent:{agentId,name:'默认执行 Agent',knowledgeRevision:'rev'}},createdAt:stamp} as DispatchRun;
    f.history.restoreDispatch({workspaceId,members:[],sessions:[],graphs:[{tasks:[task]}],outbox:[],runs:[run]} as unknown as DispatchState);
    f.history.dispatchCommitted({runs:[{...run,status:'failed',settledAt:stamp}],receipt:{}});await f.history.flush();
    const record=(await f.history.runs({workspaceId,agentId,sessionId:binding.agentSessionId})).items[0];expect(record.status).toBe('failed');
    const read=await f.history.events({workspaceId,agentId,sessionId:binding.agentSessionId,taskId,runId});expect(read.run.status).toBe('failed');if(read.mode!=='noop')expect(read.events).toEqual([]);
    expect((await f.store.load()).records[0].journalSeen).toBe(false);await f.history.close();
  });

  it('索引写失败不改变运行但明确诊断，关闭等待正在写入的索引',async()=>{
    const f=await setup();let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve});
    const put=vi.fn(async()=>{await blocked;throw Error('disk unavailable')});
    const store:AgentHistoryStore={load:async()=>({records:[],diagnostics:[]}),put},history=new AgentHistoryService(workspaceId,f.root,{store,read:f.read});await history.initialize();
    expect(()=>history.observeRun(started(f.root),'loop')).not.toThrow();let closed=false;const closing=history.close().then(()=>{closed=true});await Promise.resolve();expect(closed).toBe(false);release();await closing;expect(put).toHaveBeenCalledTimes(1);
    // 未关闭的独立服务可直接在查询中观察失败，不需要等待重启才显示错误。
    const visible=new AgentHistoryService(workspaceId,f.root,{store,read:f.read});await visible.initialize();visible.observeRun(started(f.root),'loop');await visible.flush();expect((await visible.roles({workspaceId})).diagnostics).toEqual([expect.stringContaining('未能保存')]);await visible.close();
  });

  it('已缓存流遇到重复序号不同正文后保持故障，不能返回旧流掩盖冲突',async()=>{
    const f=await setup(),start=started(f.root),log=await writeLog(f.root,start,[next(start,2,'message',{role:'assistant',text:'原文'})]);
    for(const event of log.summary.events)f.history.observeRun(event,'loop');
    const identity={workspaceId,agentId:'cbim:main',sessionId:'session-one',taskId:start.taskId,runId:start.runId};
    const first=await f.history.events(identity);f.history.observeRun({...log.summary.events[1],data:{role:'assistant',text:'冲突'}},'loop');
    await expect(f.history.events({...identity,cursor:first.cursor})).rejects.toMatchObject({code:'AGENT_HISTORY_UNREADABLE'});expect(f.read).toHaveBeenCalledTimes(1);await f.history.close();
  });

  it('加载中的详情不会被其他历史页淘汰，恢复与实时事件交错仍形成连续增量',async()=>{
    const f=await setup(),start=started(f.root);let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve});
    const summaries=new Map<string,Awaited<ReturnType<typeof RunJournal.read>>>();
    const first=await writeLog(f.root,start);summaries.set(start.runId,first.summary);
    const read=vi.fn(async(record:AgentHistoryRecord)=>{if(record.view.runId===start.runId)await blocked;return structuredClone(summaries.get(record.view.runId)!)});
    const history=new AgentHistoryService(workspaceId,f.root,{store:f.store,read});await history.initialize();history.observeRun(first.summary.events[0],'loop');
    const identity={workspaceId,agentId:'cbim:main',sessionId:'session-one',taskId:start.taskId,runId:start.runId},initial=history.events(identity);
    for(let i=0;i<25;i++){
      const other=started(f.root,'other-'+i,'other-run-'+i,'other-session-'+i),log=await writeLog(f.root,other,[next(other,2,'run.settled',{status:'completed'})]);summaries.set(other.runId,log.summary);history.restoreRun(log.summary,'loop');
      await history.events({workspaceId,agentId:'cbim:main',sessionId:'other-session-'+i,taskId:other.taskId,runId:other.runId});
    }
    const addition=await first.journal.append({type:'message',data:{role:'assistant',text:'加载期间新增'}});history.observeRun(addition,'loop');release();
    const loaded=await initial;expect(loaded.cursor.seq).toBe(2);if(loaded.mode!=='noop')expect(loaded.events[1].data.text).toBe('加载期间新增');
    expect((await history.events({...identity,cursor:loaded.cursor})).mode).toBe('noop');expect(read.mock.calls.filter(([record])=>record.view.runId===start.runId)).toHaveLength(1);await history.close();
  });

  it('重复起始事件不会把已完成索引重置成正在执行',async()=>{
    const f=await setup(),start=started(f.root),log=await writeLog(f.root,start,[next(start,2,'run.settled',{status:'completed'})]);
    f.history.restoreRun(log.summary,'loop');f.history.observeRun(log.summary.events[0],'loop');
    expect((await f.history.runs({workspaceId,agentId:'cbim:main',sessionId:'session-one'})).items[0].status).toBe('completed');await f.history.close();
  });
});
