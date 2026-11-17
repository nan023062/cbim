// logic/conversation/runtime: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../application/support/helpers';
import {request} from '../../knowledge/rules/data/knowledge';
import {seedTeam} from '../../knowledge/service/support/team-fixture';
import {registerExplicitFixtureOwner} from '../../team/service/support/explicit-owner-fixture';
import type {Application} from '../../../../../src/bridge/server/application';

async function registerExecutor(app:Application,workspaceId:string,moduleId:string){
  const settings=await app.models.Save({profile:{name:'Conversation identity fixture',api:'openai-completions',auth:'none',baseUrl:'https://example.test/v1',defaultModel:'fixture',models:[{id:'fixture',name:'fixture',enabled:true,contextWindow:200000,maxTokens:1000,reasoning:false}]}}),profile=settings.profiles.find(item=>item.name==='Conversation identity fixture')!;
  return registerExplicitFixtureOwner(app,workspaceId,{agentId:'.cbim/team/dev',moduleIds:[moduleId],profileId:profile.id,modelId:'fixture'});
}
import {json} from '../../../../../src/core/platform/node/serialization';
import type {TaskSpec} from '../../../../../src/logic/tasks/rules/types';
import {WorkspaceExecutionLease} from '../../../../../src/logic/execution/admission/workspace-lease';
import {FileDispatchStore} from '../../../../../src/logic/dispatch/storage/dispatch-store';

it('主对话绑定可靠复用本会话根实例；不同主会话拥有独立实例且普通聊天不制造任务',async()=>{
  const f=await fixture();try{
    const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id);
    const task:TaskSpec={mode:'chat',taskId:'main-session',workspaceId:entry.id,root:workspace.entry.path,goal:'你好',agentId:'cbim:main',moduleIds:[],acceptance:[]};
    const service=f.app.MemberDispatch(entry.id),identity={workspaceId:entry.id,rootSessionId:task.taskId};
    const [a,b]=await Promise.all([service.ConversationBinding(task),service.ConversationBinding(task)]);
    expect(a).toEqual(b);
    const graph=await service.Snapshot(identity);
    expect(a.agentInstanceId).toBe(graph.root.agent.agentInstanceId);
    expect(a.agentSessionId).not.toBe(graph.root.agent.agentSessionId);
    expect(graph.tasks).toEqual([]);expect(graph.cursor.seq).toBe(1);
    const reader=new FileDispatchStore(path.join(f.user,entry.id,'dispatch'),entry.id);
    try{
      const state=await reader.Read(),member=state.members.find(item=>item.agentInstanceId===a.agentInstanceId)!;
      expect(member.mainRootSessionId).toBe(task.taskId);
      expect(member.activity).toBe('idle');expect(member.activeRunId).toBeUndefined();
      expect(state.sessions.find(item=>item.agentSessionId===graph.root.agent.agentSessionId)?.purpose).toBe('task');
    }finally{await reader.Close()}
    const other=await service.ConversationBinding({...task,taskId:'other-session'});
    expect(other.agentInstanceId).not.toBe(a.agentInstanceId);
    expect(other.agentSessionId).not.toBe(a.agentSessionId);
    const file=path.join(f.user,entry.id,'dispatch','dispatch.jsonl'),before=await fs.readFile(file,'utf8');
    await f.app.Open(entry.id,true);
    expect(await f.app.MemberDispatch(entry.id).ConversationBinding({...task,goal:'继续'})).toEqual(a);
    expect(await fs.readFile(file,'utf8')).toBe(before);
  }finally{await f.cleanup()}
});

it('错误角色、非聊天任务、错误路径与其他工作区不能创建主对话绑定',async()=>{
  const f=await fixture();try{
    const entry=await f.app.Dispatch('add',{path:f.a}),service=f.app.MemberDispatch(entry.id);
    const task:TaskSpec={mode:'chat',taskId:'main-session',workspaceId:entry.id,root:f.app.Workspace(entry.id).entry.path,goal:'你好',agentId:'cbim:main',moduleIds:[],acceptance:[]};
    for(const bad of [{...task,mode:undefined},{...task,agentId:'.cbim/team/dev'},{...task,root:f.b}])await expect(service.ConversationBinding(bad)).rejects.toMatchObject({code:'CONVERSATION_IDENTITY'});
    await expect(service.ConversationBinding({...task,workspaceId:'other-workspace'})).rejects.toMatchObject({code:'GRAPH_IDENTITY_MISMATCH'});
    await expect(service.Snapshot({workspaceId:entry.id,rootSessionId:task.taskId})).rejects.toMatchObject({code:'GRAPH_NOT_FOUND'});
  }finally{await f.cleanup()}
});

it('知识结构异常仍可登记主实例进行诊断，正式执行角色注册与派发仍拒绝无效知识',async()=>{
  const f=await fixture();try{
    const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id),team=await seedTeam(workspace),initial=await workspace.Snapshot(),moduleId=team.input.moduleId,definition=JSON.parse(initial.files.find(file=>file.path===moduleId+'/module.json')!.text);
    definition.maintenance={bindingId:'diagnostic-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'diagnostic-review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
    await workspace.Commit(request(initial,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'Maintainer',team:'.cbim/team'}]})},{path:moduleId+'/module.json',text:json(definition)}]));
    const registered=await registerExecutor(f.app,entry.id,moduleId),ownerSelection=registered.selection,service=f.app.MemberDispatch(entry.id),identity={workspaceId:entry.id,rootSessionId:'diagnosis'};
    const scope=await service.OpenScope(identity,'diagnosis-scope',{message:'Diagnose invalid knowledge'},'diagnosis-main');
    await service.goals.Plan(identity,scope.scopeId,'diagnosis-main','diagnosis-plan',{expectedRevision:1,objective:'Diagnose invalid knowledge',constraints:[],criteria:[{id:'verified',text:'Evidence',kind:'evidence'}],assignments:[{agentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,criterionIds:['verified'],reason:'Registered position'}],reason:'Freeze valid intent before injecting knowledge corruption'});
    const snapshot=await workspace.Snapshot();
    const invalid={...snapshot,validation:{...snapshot.validation!,structural:false}};
    // 先建立合法岗位和计划，再在真实知识读取锁中注入损坏；避免被更早的缺 scope/岗位门禁遮蔽。
    const original=workspace.WithSourceSnapshot.bind(workspace),sourceSpy=vi.spyOn(workspace,'WithSourceSnapshot').mockImplementation(use=>original(()=>use(invalid)));
    const spy=vi.spyOn(workspace,'Snapshot').mockResolvedValue(invalid);
    try{
      const binding=await service.ConversationBinding({mode:'chat',taskId:identity.rootSessionId,workspaceId:entry.id,root:workspace.entry.path,goal:'诊断知识异常',agentId:'cbim:main',moduleIds:[],acceptance:[]});
      expect((await service.Snapshot(identity)).root.agent.agentInstanceId).toBe(binding.agentInstanceId);
      await expect(service.CreateMember({...identity,commandId:'formal-member',agentId:'.cbim/team/dev'})).rejects.toMatchObject({code:'KNOWLEDGE_INVALID'});
      await expect(service.DispatchTask({...identity,commandId:'formal-task',expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,goal:'执行模块任务',acceptance:[{id:'verified',text:'验证结果'}],prerequisites:[]}},scope.scopeId)).rejects.toMatchObject({code:'KNOWLEDGE_INVALID'});
      expect((await service.Snapshot(identity)).tasks).toEqual([]);
    }finally{spy.mockRestore();sourceSpy.mockRestore()}
  }finally{await f.cleanup()}
});
