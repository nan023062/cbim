import fs from 'node:fs/promises';
import path from 'node:path';
import {expect,it,vi} from 'vitest';
import {fixture,request} from './helpers';
import {seedTeam} from './team-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import {LoopRuntime} from '../src/backend/core/brain/runtime';
import type {AgentEngine,EngineContext} from '../src/backend/core/brain/types';
import type {RuntimeSnapshot} from '../src/backend/core/runtime/types';
import * as loops from '../src/backend/scheduler-engine/execution/loop-engine';
import {RunJournal} from '../src/backend/main/persistence/tasks/run-journal';
import type {TaskSpec} from '../src/backend/core/brain/types';
import {registerServiceOwner} from './owner-service-fixture';

it('真实应用汇总两个工作区的成员及任务，幂等重试和重启不重复，关闭后不残留活动',async()=>{
  const f=await fixture();
  try{
    const a=await f.app.dispatch('add',{path:f.a}),b=await f.app.dispatch('add',{path:f.b});
    const wa=f.app.workspace(a.id),team=await seedTeam(wa),snap=await wa.snapshot();
    const file=team.input.moduleId+'/module.json',definition=JSON.parse(snap.files.find(x=>x.path===file)!.text);
    definition.maintenance={bindingId:'binding',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'confirmed',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
    await wa.commit(request(snap,[{path:file,text:json(definition)},{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'Owner',team:'.cbim/team'}]})}]));
    await registerServiceOwner(f.app,wa,team.input.agentId,[team.input.moduleId]);
    for(const id of [a.id,b.id])await f.app.dispatch('dispatch.open',{workspaceId:id,rootSessionId:'same-session',commandId:'open'});
    const service=f.app.memberDispatch(a.id),identity={workspaceId:a.id,rootSessionId:'same-session'},scopeId='runtime-member-cycle',ownerSelection=(await service.owners.discover([team.input.moduleId])).groups[0].selection!;
    await service.openScope(identity,scopeId,{message:'Verify module'},'runtime-main');
    await service.goals.plan(identity,scopeId,'runtime-main','runtime-goal-plan',{expectedRevision:1,objective:'Verify module',constraints:[],criteria:[{id:'test',text:'Tests pass',kind:'evidence'}],assignments:[{agentId:team.input.agentId,moduleIds:[team.input.moduleId],ownerSelection,criterionIds:['test'],reason:'Registered owner'}],reason:'Explicit current plan'});
    const command={...identity,scopeId,commandId:'send',expectedParentRevision:1,task:{assigneeAgentId:team.input.agentId,moduleIds:[team.input.moduleId],ownerSelection,goal:'Verify module',acceptance:[{id:'test',text:'Tests pass'}]}};
    const sent=await f.app.dispatch('dispatch.task',command);
    const snapshot=await f.app.dispatch('runtime.snapshot') as RuntimeSnapshot;
    expect(snapshot.complete).toBe(true);
    expect(snapshot.pressure).toMatchObject({openWorkspaces:2,memberInstances:3,taskInstances:1,queuedDispatchTasks:1,pendingOutbox:1,activeRuns:0});
    expect(snapshot.tasks[0]).toMatchObject({source:'dispatch',binding:'instance',taskId:sent.taskId,workspaceId:a.id,runIds:[]});
    expect(new Set(snapshot.members.filter(m=>m.agentId==='cbim:main').map(m=>m.agentInstanceId)).size).toBe(2);
    await f.app.dispatch('dispatch.task',command);
    expect(await f.app.dispatch('runtime.read',{cursor:snapshot.cursor})).toEqual({mode:'noop',cursor:snapshot.cursor});
    await f.app.dispatch('rename',{id:a.id,name:'renamed'});
    expect(f.app.runtime.snapshot().workspaces.find(w=>w.workspaceId===a.id)?.name).toBe('renamed');
    await f.app.open(a.id,true);
    // 重开封存原活动周期：历史任务保留，未领取信封被明确取消且实例释放，不能伪装仍可领取。
    expect(f.app.runtime.snapshot().pressure).toMatchObject({memberInstances:2,taskInstances:1,queuedDispatchTasks:0,pendingOutbox:0});
    expect(f.app.runtime.snapshot().tasks.find(task=>task.taskId===sent.taskId)).toMatchObject({status:'cancelled',runIds:[]});
    expect(f.app.runtime.snapshot().scopes.find(scope=>scope.scopeId===scopeId)).toMatchObject({status:'closed',outcome:'interrupted'});
    expect(f.app.runtime.snapshot().members.filter(m=>m.workspaceId===a.id).every(m=>!m.activityCurrent)).toBe(true);
    await f.app.stop(a.id);
    expect(f.app.runtime.snapshot().workspaces.find(w=>w.workspaceId===a.id)?.availability).toBe('closed');
    expect(f.app.runtime.snapshot().pressure).toMatchObject({openWorkspaces:1,activeMembers:0,activeRuns:0});
    await f.app.remove(b.id);
    expect(f.app.runtime.snapshot().workspaces.map(w=>w.workspaceId)).toEqual([a.id]);
  }finally{await f.cleanup()}
});

it('实际Loop、日志及队列接入全局；用量只算一次，查询不回读，重启恢复暂停队列',async()=>{
  const f=await fixture(),controls=new Map<string,()=>void>();
  // 只替换模型引擎；Application、工作区管理、LoopRuntime、文件日志与事件订阅均为真实实现。
  const factory=vi.spyOn(loops,'createWorkspaceLoop').mockImplementation(async(paths,owner,options,services)=>{
    class Engine implements AgentEngine {
      readonly kind='controlled-test';context!:EngineContext;private finish!:()=>void;private stopped=false;
      async start(context:EngineContext){this.context=context;await context.emit({type:'session.bound',data:{sessionFile:path.join(context.directory,'native.jsonl')}})}
      async run(){
        const done=new Promise<void>(resolve=>{this.finish=resolve;controls.set(this.context.task.taskId,resolve)});
        await this.context.emit({type:'message',data:{text:'secret message body',usage:{input:100,output:20,cacheRead:30,cost:{total:0.02}},pricingKnown:true}});
        await done;
        await this.context.emit({type:'engine.status',data:{metric:'run-usage',tokens:{input:120,output:25,cacheRead:35,cacheWrite:0},cost:0.03,pricingKnown:true}});
        return {status:this.stopped?'cancelled' as const:'completed' as const};
      }
      async stop(){this.stopped=true;this.finish?.()}
      async close(){}
    }
    const workspace={id:owner.entry.id,path:owner.entry.path};
    return {workspace,agentHome:'unused-test-home',newTask:()=>{throw Error('not used')},runtime:new LoopRuntime({storage:services.storage,directory:path.join(paths.project(workspace.id),'loop-engine','tasks'),acquireLease:services.acquireLease,toolPolicy:async()=>({allow:false}),createEngine:()=>new Engine(),onEvent:options.onEvent})};
  });
  try{
    const entries=await Promise.all([f.app.dispatch('add',{path:f.a}),f.app.dispatch('add',{path:f.b})]);
    const options={provider:'test',model:'test',allowNativeExecution:false};
    const handles=await Promise.all(entries.map(e=>f.app.execution(e.id).chat('private goal',options)));
    await vi.waitFor(()=>expect(f.app.runtime.snapshot().usage).toMatchObject({runCount:2,total:300,cost:0.04}));
    expect(f.app.runtime.snapshot().pressure.activeRuns).toBe(2);
    expect(f.app.runtime.snapshot().tasks.every(t=>t.source==='loop'&&t.binding==='role-only')).toBe(true);
    const manager=f.app.execution(entries[0].id),handle=handles[0];
    const first=await manager.enqueue(handle.taskId,'queued one',options),second=await manager.enqueue(handle.taskId,'queued two',options);
    expect(f.app.runtime.snapshot().pressure.queuedConversationMessages).toBe(2);
    await manager.moveQueued(handle.taskId,second.id,first.id);
    await manager.editQueued(handle.taskId,second.id,'edited','queued two');
    expect(f.app.runtime.snapshot().pressure.queuedConversationMessages).toBe(2);
    await manager.changeQueued(handle.taskId,first.id,'remove');
    expect(f.app.runtime.snapshot().pressure.queuedConversationMessages).toBe(1);
    // 固定快照的读取不扫描历史目录，也不因消息顺序变更而重复累计 tokens。
    const cursor=f.app.runtime.snapshot().cursor,read=vi.spyOn(fs,'readFile');
    try{expect(await f.app.dispatch('runtime.read',{cursor})).toEqual({mode:'noop',cursor});expect(read).not.toHaveBeenCalled()}finally{read.mockRestore()}
    const serialized=JSON.stringify(f.app.runtime.snapshot());
    expect(serialized).not.toContain('private goal');expect(serialized).not.toContain('secret message body');expect(serialized).not.toContain('native.jsonl');
    await manager.stop(handle.taskId);controls.get(handles[1].taskId)!();
    await vi.waitFor(()=>expect(f.app.runtime.snapshot().pressure.activeRuns).toBe(0));
    expect(f.app.runtime.snapshot().usage).toMatchObject({runCount:2,total:360,cost:0.06,unreportedRuns:0});
    expect(f.app.runtime.snapshot().pressure.pausedConversationMessages).toBe(1);
    await f.app.open(entries[0].id,true);
    expect(f.app.runtime.snapshot().usage).toMatchObject({runCount:2,total:360,cost:0.06});
    expect(f.app.runtime.snapshot().pressure).toMatchObject({activeRuns:0,pausedConversationMessages:1});
    expect(f.app.runtime.snapshot().runs.find(r=>r.runId===handle.runId)?.status).toBe('cancelled');
  }finally{for(const release of controls.values())release();await f.cleanup();factory.mockRestore()}
});

it('损坏历史与无法打开的工作区标明不完整，不伪造为零消耗的健康系统',async()=>{
  const f=await fixture();
  try{
    const entry=await f.app.dispatch('add',{path:f.a});await f.app.stop(entry.id);
    const directory=path.join(f.user,entry.id,'loop-engine','tasks','bad-task','bad-run');
    await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'events.jsonl'),'not-json\n');
    await f.app.open(entry.id);
    const snapshot=f.app.runtime.snapshot();
    expect(snapshot.complete).toBe(false);expect(snapshot.workspaces[0].availability).toBe('ready');
    expect(snapshot.workspaces[0].issues.map(issue=>issue.source)).toEqual(expect.arrayContaining(['agent-history','run:bad-task/bad-run']));
    expect(snapshot.usage.runCount).toBe(0); // 数字只代表可读取的记录；complete=false 显示缺口。
    await f.app.stop(entry.id);
    const opened=vi.spyOn(f.app.rules,'validate').mockRejectedValueOnce(Error('private path must not leak'));
    try{await expect(f.app.open(entry.id)).rejects.toThrow('private path must not leak')}finally{opened.mockRestore()}
    expect(f.app.runtime.snapshot().workspaces[0].availability).toBe('unavailable');
    expect(f.app.runtime.snapshot().complete).toBe(false);
    expect(JSON.stringify(f.app.runtime.snapshot())).not.toContain('private path must not leak');
  }finally{await f.cleanup()}
});

it('重开一次恢复成员和对话的两套运行历史，成员轮次不重复生成 Loop 任务',async()=>{
  const f=await fixture();
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),root=f.app.workspace(entry.id).entry.path;await f.app.stop(entry.id);
    const task:TaskSpec={taskId:'member-task',workspaceId:entry.id,root,goal:'private goal',moduleIds:['game'],agentId:'cbim:main',acceptance:[]};
    const memberBinding={workspaceId:entry.id,teamId:'team',agentId:'cbim:main',agentInstanceId:'member',agentSessionId:'member-session',rootSessionId:'main-session',taskId:task.taskId,runId:'member-run',leaseEpoch:1,planRevision:1};
    const memberLog=new RunJournal(path.join(f.user,entry.id,'dispatch','runs','tasks',task.taskId,'member-run'),task,'member-run');
    await memberLog.init();await memberLog.append({type:'run.started',data:{task,memberBinding}});await memberLog.append({type:'message',data:{usage:{input:40,output:10},text:'private member answer'}});await memberLog.append({type:'run.settled',data:{status:'completed'}});
    const chatTask={...task,taskId:'chat-task',mode:'chat' as const},chatLog=new RunJournal(path.join(f.user,entry.id,'loop-engine','tasks',chatTask.taskId,'chat-run'),chatTask,'chat-run');
    await chatLog.init();await chatLog.append({type:'run.started',data:{task:chatTask}});await chatLog.append({type:'message',data:{usage:{input:20,output:5}}});await chatLog.append({type:'run.settled',data:{status:'cancelled'}});
    await f.app.open(entry.id);
    const state=f.app.runtime.snapshot();expect(state.complete).toBe(true);
    expect(state.usage).toMatchObject({runCount:2,total:75});expect(state.pressure.activeRuns).toBe(0);
    expect(state.tasks.map(task=>task.taskId)).toEqual(['chat-task']);
    expect(state.runs.find(run=>run.runId==='member-run')?.memberBinding).toEqual(memberBinding);
    expect(JSON.stringify(state)).not.toMatch(/private goal|private member answer/);
    await f.app.open(entry.id,true);expect(f.app.runtime.snapshot().usage).toMatchObject({runCount:2,total:75});
  }finally{await f.cleanup()}
});
