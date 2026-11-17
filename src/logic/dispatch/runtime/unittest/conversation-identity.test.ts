// logic/dispatch/runtime: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../../application/unittest/support/helpers';
import {request} from '../../../knowledge/rules/unittest/data/knowledge';
import {seedTeam} from '../../../knowledge/service/unittest/support/team-fixture';
import {registerExplicitFixtureOwner} from '../../../team/service/unittest/support/explicit-owner-fixture';
import type {Application} from '../../../../bridge/server/application';

async function registerExecutor(app:Application,workspaceId:string,moduleId:string){
  const settings=await app.models.Save({profile:{name:'Conversation identity fixture',api:'openai-completions',auth:'none',baseUrl:'https://example.test/v1',defaultModel:'fixture',models:[{id:'fixture',name:'fixture',enabled:true,contextWindow:200000,maxTokens:1000,reasoning:false}]}}),profile=settings.profiles.find(item=>item.name==='Conversation identity fixture')!;
  return registerExplicitFixtureOwner(app,workspaceId,{agentId:'.cbim/team/dev',moduleIds:[moduleId],profileId:profile.id,modelId:'fixture'});
}
import {json} from '../../../../core/platform/node/serialization';
import type {TaskSpec} from '../../../tasks/rules/types';
import {WorkspaceExecutionLease} from '../../../execution/admission/workspace-lease';
import {FileDispatchStore} from '../../storage/dispatch-store';

it('主实例只调度，显式登记的执行岗位与图根实例分离；关闭周期保留图根和任务历史',async()=>{
  const f=await fixture();try{
    const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id),team=await seedTeam(workspace);
    const snapshot=await workspace.Snapshot(),modulePath=team.input.moduleId+'/module.json';
    const definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
    definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
    await workspace.Commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:modulePath,text:json(definition)}]));
    const task:TaskSpec={mode:'chat',taskId:'main-session',workspaceId:entry.id,root:workspace.entry.path,goal:'检查模块',agentId:'cbim:main',moduleIds:[],acceptance:[]};
    const service=f.app.MemberDispatch(entry.id),binding=await service.ConversationBinding(task),identity={workspaceId:entry.id,rootSessionId:task.taskId};
    const registered=await registerExecutor(f.app,entry.id,team.input.moduleId),ownerSelection=registered.selection;
    const scope=await service.OpenScope(identity,'user-cycle-1',{message:'Inspect module behavior'},'conversation-probe-main');
    await service.goals.Plan(identity,scope.scopeId,'conversation-probe-main','conversation-probe-plan',{expectedRevision:1,objective:'Inspect module behavior',constraints:[],criteria:[{id:'verified',text:'Actual evidence',kind:'evidence'}],assignments:[{agentId:'.cbim/team/dev',moduleIds:[team.input.moduleId],ownerSelection,criterionIds:['verified'],reason:'Explicit executor position'}],reason:'Keep main and executor identities separate'});
    const input={...identity,commandId:'executor-task',expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:[team.input.moduleId],ownerSelection,goal:'验证模块行为',acceptance:[{id:'verified',text:'提供验证证据'}],prerequisites:[]}};
    await expect(service.DispatchTask({...input,commandId:'invalid-self',task:{...input.task,assigneeAgentId:'cbim:main'}},scope.scopeId)).rejects.toMatchObject({code:'AGENT_NOT_EXECUTABLE'});
    const receipt=await service.DispatchTask(input,scope.scopeId);
    const graph=await service.Snapshot(identity),executed=graph.tasks.find(item=>item.taskId===receipt.taskId)!;
    expect(executed.scopeId).toBe(scope.scopeId);expect(executed.assignee.agentId).toBe('.cbim/team/dev');
    expect(executed.assignee.agentInstanceId).not.toBe(binding.agentInstanceId);
    expect(executed.assignee.agentSessionId).not.toBe(binding.agentSessionId);
    expect(graph.edges).toMatchObject([{fromNodeId:graph.root.nodeId,toNodeId:executed.nodeId,kind:'dispatch'}]);
    await service.CloseScope(identity,scope.scopeId,'cancelled');
    const after=await service.Snapshot(identity);
    expect(after.root).toEqual(graph.root);expect(after.tasks).toHaveLength(1);expect(after.tasks[0].status).toBe('cancelled');
    const reader=new FileDispatchStore(path.join(f.user,entry.id,'dispatch'),entry.id);
    try{const state=await reader.Read();expect(state.members.find(item=>item.agentInstanceId===executed.assignee.agentInstanceId)).toMatchObject({lifecycle:'released',executionScopeId:scope.scopeId,executionTaskId:executed.taskId});expect(state.members.find(item=>item.agentInstanceId===binding.agentInstanceId)?.lifecycle).toBeUndefined()}finally{await reader.Close()}
  }finally{await f.cleanup()}
});
