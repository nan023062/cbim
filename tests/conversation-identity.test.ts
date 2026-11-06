import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,request} from './helpers';
import {seedTeam} from './team-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import type {TaskSpec} from '../src/backend/core/tasks/types';
import {WorkspaceExecutionLease} from '../src/backend/scheduler-engine/execution/workspace-lease';
import {FileDispatchStore} from '../src/backend/main/persistence/tasks/dispatch-store';

it('主对话绑定可靠复用本会话根实例；不同主会话拥有独立实例且普通聊天不制造任务',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id);
    const task:TaskSpec={mode:'chat',taskId:'main-session',workspaceId:entry.id,root:workspace.entry.path,goal:'你好',agentId:'cbim:main',moduleIds:[],acceptance:[]};
    const service=f.app.memberDispatch(entry.id),identity={workspaceId:entry.id,rootSessionId:task.taskId};
    const [a,b]=await Promise.all([service.conversationBinding(task),service.conversationBinding(task)]);
    expect(a).toEqual(b);
    const graph=await service.snapshot(identity);
    expect(a.agentInstanceId).toBe(graph.root.agent.agentInstanceId);
    expect(a.agentSessionId).not.toBe(graph.root.agent.agentSessionId);
    expect(graph.tasks).toEqual([]);expect(graph.cursor.seq).toBe(1);
    const reader=new FileDispatchStore(path.join(f.user,entry.id,'dispatch'),entry.id);
    try{
      const state=await reader.read(),member=state.members.find(item=>item.agentInstanceId===a.agentInstanceId)!;
      expect(member.mainRootSessionId).toBe(task.taskId);
      expect(member.activity).toBe('idle');expect(member.activeRunId).toBeUndefined();
      expect(state.sessions.find(item=>item.agentSessionId===graph.root.agent.agentSessionId)?.purpose).toBe('task');
    }finally{await reader.close()}
    const other=await service.conversationBinding({...task,taskId:'other-session'});
    expect(other.agentInstanceId).not.toBe(a.agentInstanceId);
    expect(other.agentSessionId).not.toBe(a.agentSessionId);
    const file=path.join(f.user,entry.id,'dispatch','dispatch.jsonl'),before=await fs.readFile(file,'utf8');
    await f.app.open(entry.id,true);
    expect(await f.app.memberDispatch(entry.id).conversationBinding({...task,goal:'继续'})).toEqual(a);
    expect(await fs.readFile(file,'utf8')).toBe(before);
  }finally{await f.cleanup()}
});

it('主实例只调度，周期默认执行者与图根实例分离；关闭周期保留图根和任务历史',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace);
    const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json';
    const definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
    definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
    await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:modulePath,text:json(definition)}]));
    const task:TaskSpec={mode:'chat',taskId:'main-session',workspaceId:entry.id,root:workspace.entry.path,goal:'检查模块',agentId:'cbim:main',moduleIds:[],acceptance:[]};
    const service=f.app.memberDispatch(entry.id),binding=await service.conversationBinding(task),identity={workspaceId:entry.id,rootSessionId:task.taskId};
    const scope=await service.openScope(identity,'user-cycle-1');
    const input={...identity,commandId:'executor-task',expectedParentRevision:1,task:{assigneeAgentId:'cbim:executor',moduleIds:[team.input.moduleId],goal:'验证模块行为',acceptance:[{id:'verified',text:'提供验证证据'}],prerequisites:[]}};
    await expect(service.dispatchTask({...input,commandId:'invalid-self',task:{...input.task,assigneeAgentId:'cbim:main'}},scope.scopeId)).rejects.toMatchObject({code:'AGENT_NOT_EXECUTABLE'});
    const receipt=await service.dispatchTask(input,scope.scopeId);
    const graph=await service.snapshot(identity),executed=graph.tasks.find(item=>item.taskId===receipt.taskId)!;
    expect(executed.scopeId).toBe(scope.scopeId);expect(executed.assignee.agentId).toBe('cbim:executor');
    expect(executed.assignee.agentInstanceId).not.toBe(binding.agentInstanceId);
    expect(executed.assignee.agentSessionId).not.toBe(binding.agentSessionId);
    expect(graph.edges).toMatchObject([{fromNodeId:graph.root.nodeId,toNodeId:executed.nodeId,kind:'dispatch'}]);
    await service.closeScope(identity,scope.scopeId,'cancelled');
    const after=await service.snapshot(identity);
    expect(after.root).toEqual(graph.root);expect(after.tasks).toHaveLength(1);expect(after.tasks[0].status).toBe('cancelled');
    const reader=new FileDispatchStore(path.join(f.user,entry.id,'dispatch'),entry.id);
    try{const state=await reader.read();expect(state.members.find(item=>item.agentInstanceId===executed.assignee.agentInstanceId)).toMatchObject({lifecycle:'released',executionScopeId:scope.scopeId,executionTaskId:executed.taskId});expect(state.members.find(item=>item.agentInstanceId===binding.agentInstanceId)?.lifecycle).toBeUndefined()}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it('错误角色、非聊天任务、错误路径与其他工作区不能创建主对话绑定',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),service=f.app.memberDispatch(entry.id);
    const task:TaskSpec={mode:'chat',taskId:'main-session',workspaceId:entry.id,root:f.app.workspace(entry.id).entry.path,goal:'你好',agentId:'cbim:main',moduleIds:[],acceptance:[]};
    for(const bad of [{...task,mode:undefined},{...task,agentId:'.cbim/team/dev'},{...task,root:f.b}])await expect(service.conversationBinding(bad)).rejects.toMatchObject({code:'CONVERSATION_IDENTITY'});
    await expect(service.conversationBinding({...task,workspaceId:'other-workspace'})).rejects.toMatchObject({code:'GRAPH_IDENTITY_MISMATCH'});
    await expect(service.snapshot({workspaceId:entry.id,rootSessionId:task.taskId})).rejects.toMatchObject({code:'GRAPH_NOT_FOUND'});
  }finally{await f.cleanup()}
});

it('知识结构异常仍可登记主实例进行诊断，正式执行角色注册与派发仍拒绝无效知识',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),snapshot=await workspace.snapshot();
    const invalid={...snapshot,validation:{...snapshot.validation!,structural:false}};
    const spy=vi.spyOn(workspace,'snapshot').mockResolvedValue(invalid);
    try{
      const service=f.app.memberDispatch(entry.id),identity={workspaceId:entry.id,rootSessionId:'diagnosis'};
      const binding=await service.conversationBinding({mode:'chat',taskId:identity.rootSessionId,workspaceId:entry.id,root:workspace.entry.path,goal:'诊断知识异常',agentId:'cbim:main',moduleIds:[],acceptance:[]});
      expect((await service.snapshot(identity)).root.agent.agentInstanceId).toBe(binding.agentInstanceId);
      await expect(service.createMember({...identity,commandId:'formal-member',agentId:'cbim:executor'})).rejects.toMatchObject({code:'KNOWLEDGE_INVALID'});
      await expect(service.dispatchTask({...identity,commandId:'formal-task',expectedParentRevision:1,task:{assigneeAgentId:'cbim:executor',moduleIds:['.cbim/workspace/game'],goal:'执行模块任务',acceptance:[{id:'verified',text:'验证结果'}],prerequisites:[]}})).rejects.toMatchObject({code:'KNOWLEDGE_INVALID'});
      expect((await service.snapshot(identity)).tasks).toEqual([]);
    }finally{spy.mockRestore()}
  }finally{await f.cleanup()}
});

it('同一实例聊天与任务即使只读也互斥，其他实例只读可并行；释放后能重新领取且通知只发一次',()=>{
  const lease=new WorkspaceExecutionLease(),released=vi.fn();lease.observeRelease(released);
  const chat=lease.acquire('conversation:1','read','main-1');
  expect(()=>lease.acquire('member:1','read','main-1')).toThrowError(expect.objectContaining({code:'MEMBER_BUSY'}));
  const other=lease.acquire('conversation:2','read','main-2');
  expect(()=>lease.acquire('member:write','ask','writer')).toThrowError(expect.objectContaining({code:'WORKSPACE_EXECUTION_BUSY'}));
  chat();chat();expect(released).toHaveBeenCalledTimes(1);
  const self=lease.acquire('member:1','read','main-1');
  expect(()=>lease.acquire('conversation:1','read','main-1')).toThrowError(expect.objectContaining({code:'MEMBER_BUSY'}));
  other();self();expect(released).toHaveBeenCalledTimes(3);
  const write=lease.acquire('member:write','execute','writer');write();
});
