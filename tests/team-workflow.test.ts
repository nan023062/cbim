import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {seedTeam} from './team-fixture';
import {knowledgeTools} from '../src/backend/scheduler-engine/tools/knowledge-tools';
import {prepareTeamTask} from '../src/backend/scheduler-engine/context/team-workflow';
import {WorkspaceExecutionManager} from '../src/backend/scheduler-engine/execution/execution-manager';
import {LoopRuntime} from '../src/backend/core/brain';

it('空工作区普通对话默认主 Agent，知识变化后仍可继续，保留每轮消息',async()=>{
  const f=await fixture();let manager:WorkspaceExecutionManager|undefined;
  try{
    const e=await f.app.dispatch('add',{path:f.a}),w=f.app.workspace(e.id);const modes:unknown[]=[];
    manager=new WorkspaceExecutionManager(w,new FileRunStorage(),async options=>{
      modes.push(options.mode);
      const runtime=new LoopRuntime({storage:new FileRunStorage(),directory:path.join(f.app.paths.project(e.id),'loop-engine','tasks'),acquireLease:async()=>()=>{},toolPolicy:async()=>({allow:true}),createEngine:()=>({kind:'test',start:async context=>{await context.emit({type:'session.bound',data:{sessionFile:'chat-session'}})},run:async()=>({status:'completed'}),stop:async()=>{},close:async()=>{}})});
      return {runtime,workspace:await f.app.paths.identity(f.a),agentHome:'test',newTask:()=>{throw Error('not used')}};
    });
    const options={provider:'test',model:'test',allowNativeExecution:false};
    await expect(manager.chat('   ',options)).rejects.toThrow();
    const first=await manager.chat('你好',options);
    while((await manager.inspect(first.taskId,first.runId)).status==='running')await new Promise(r=>setTimeout(r,10));
    const state=await manager.inspect(first.taskId,first.runId);expect(state.task).toMatchObject({mode:'chat',agentId:'cbim:main',moduleIds:[],acceptance:[]});expect(state.task.workflowContext).toBeUndefined();
    await fs.appendFile(path.join(f.a,'.cbim/README.md'),'\nKnowledge changed');
    const next=await manager.resume(first.taskId,first.runId,'再聊聊',options);
    while((await manager.inspect(next.taskId,next.runId)).status==='running')await new Promise(r=>setTimeout(r,10));
    expect((await manager.thread(first.taskId)).map(r=>r.events[0].data.message)).toEqual(['你好','再聊聊']);expect(modes).toEqual(['chat','chat']);
    await expect(manager.resume(first.taskId,first.runId,'旧轮次',options)).rejects.toMatchObject({code:'STALE_RUN'});
  }finally{await manager?.close();await f.cleanup()}
});

it('内部知识服务保留身份、写授权与 Schema 校验，团队准备冻结继承和本模块流程',async()=>{
  const f=await fixture();try{
    const e=await f.app.dispatch('add',{path:f.a}),w=f.app.workspace(e.id),service=knowledgeTools(w);
    await expect(fs.access(path.join(f.app.paths.project(e.id),'discovery.json'))).rejects.toThrow();
    const seeded=await seedTeam(w),task=await f.app.dispatch('loop.prepare',{id:e.id,task:seeded.input});
    expect(task.workflowContext.agent.skills.map((x:any)=>x.id)).toEqual([seeded.own,seeded.shared]);
    expect(task.workflowContext.workflow.owner).toBe(seeded.input.moduleId);
    expect(task.workflowContext.standards).toHaveLength(2);
    const choices=await f.app.dispatch('loop.choices',{id:e.id});
    expect(choices.modules.find((m:any)=>m.id===seeded.input.moduleId).workflows.some((w:any)=>w.id===seeded.input.workflowId)).toBe(true);
    expect(choices.modules.find((m:any)=>m.id===seeded.child).workflows).toEqual([]);
    expect(choices.agents.some((a:any)=>a.id===seeded.input.agentId)).toBe(true);
    await expect(prepareTeamTask(w,{...seeded.input,moduleId:seeded.child})).rejects.toMatchObject({code:'WORKFLOW_SCOPE'});
    await expect(prepareTeamTask(w,{...seeded.input,responsiblePerson:'unknown'})).rejects.toMatchObject({code:'PERSON_NOT_FOUND'});
    await expect(service.callFromRun('cbim_agent_get',{workspaceId:e.id,instanceId:'stale',id:seeded.input.agentId},false)).rejects.toMatchObject({code:'STALE_INSTANCE'});
    await expect(seeded.call('cbim_knowledge_commit',{revision:task.workflowContext.revision,requestId:'no-permission',changes:[]})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(service.callFromRun('cbim_agent_get',{},false)).rejects.toThrow();
    expect(service.list().every(t=>t.inputSchema.type==='object')).toBe(true);
  }finally{await f.cleanup()}
});

it('执行管理持久化业务上下文、隔离历史、停止与关闭排空，恢复拒绝知识变化',async()=>{
  const f=await fixture();let manager:WorkspaceExecutionManager|undefined;
  try{
    const e=await f.app.dispatch('add',{path:f.a}),w=f.app.workspace(e.id),seeded=await seedTeam(w);
    let finish:()=>void=()=>{};let emitted=0;
    manager=new WorkspaceExecutionManager(w,new FileRunStorage(),async options=>{
      const runtime=new LoopRuntime({storage:new FileRunStorage(),directory:path.join(f.app.paths.project(e.id),'loop-engine','tasks'),acquireLease:async()=>()=>{},toolPolicy:async()=>({allow:true}),onEvent:options.onEvent,createEngine:()=>({kind:'test',start:async context=>{await context.emit({type:'session.bound',data:{sessionFile:'test-session'}})},run:async()=>{await new Promise<void>(resolve=>{finish=resolve});return {status:'cancelled'}},stop:async()=>finish(),close:async()=>{}})});
      return {runtime,workspace:await f.app.paths.identity(f.a),agentHome:'test',newTask:()=>{throw Error('not used')}};
    });
    manager.subscribe(()=>{emitted++});
    const options={provider:'test',model:'test',allowNativeExecution:false};
    const run=await manager.start(seeded.input,options);
    while(!(await manager.inspect(run.taskId,run.runId)).sessionFile)await new Promise(r=>setTimeout(r,5));
    expect((await manager.inspect(run.taskId,run.runId)).task.workflowContext?.workflowId).toBe(seeded.input.workflowId);
    await manager.stop(run.taskId);await manager.close();
    expect((await manager.list())[0].status).toBe('cancelled');expect(emitted).toBeGreaterThan(1);
    const thread=await f.app.dispatch('loop.thread',{id:e.id,taskId:run.taskId});
    expect(thread[0].events[0].data.message).toBe(seeded.input.goal);
    const fresh=f.app.execution(e.id);
    await fs.appendFile(path.join(f.a,'.cbim/README.md'),'\nChanged');
    await expect(fresh.resume(run.taskId,run.runId,'继续',options)).rejects.toMatchObject({code:'CONFLICT'});
    const other=await f.app.dispatch('add',{path:f.b});
    await expect(f.app.execution(other.id).inspect(run.taskId,run.runId)).rejects.toThrow();
    await expect(manager.start(seeded.input,options)).rejects.toThrow('关闭');
  }finally{await manager?.close();await f.cleanup()}
});
