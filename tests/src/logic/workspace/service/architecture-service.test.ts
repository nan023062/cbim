import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ArchitectureService} from '../../../../../src/logic/workspace/service/architecture-service';
import type {KnowledgeWorkspace} from '../../../../../src/logic/knowledge/rules/ports';
import {resolveDispatchModules} from '../../../../../src/logic/execution/context/dispatch-context';
import {prepareDispatchExecutionContext} from '../../../../../src/logic/execution/context/execution-context';
import type {ObjectOperation} from '../../../../../src/bridge/contracts/architecture';
import {fixture} from '../../application/support/helpers';
import {summary,moduleFiles} from '../../knowledge/rules/data/knowledge';
import {internalKnowledge} from '../../tools/runtime/support/knowledge-tool-fixture';
import {registerExplicitFixtureOwner} from '../../team/service/support/explicit-owner-fixture';

const moduleCreate: ObjectOperation={kind:'module',action:'create',parentId:'.cbim/workspace',slug:'game',data:{summary},body:moduleFiles()[1].text};
const agentCreate: ObjectOperation={kind:'agent',action:'create',parentId:'.cbim/team',slug:'developer',data:{name:'开发成员',summary,capabilities:['开发']},body:'# 工作原则\n实际实现并验证成果。'};
async function identity(workspace:KnowledgeWorkspace){
  const snapshot=await workspace.Snapshot();return {workspaceId:snapshot.workspaceId,instanceId:snapshot.instanceId,revision:snapshot.revision};
}

it('空项目可直接创建模块和角色，不创建真人花名册或维护声明，Workflow 与事务幂等保留',async()=>{
  const f=await fixture();
  try{
    const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id),service=new ArchitectureService(workspace),input=await identity(workspace);
    await expect(fs.access(path.join(f.a,'.cbim/team/people.json'))).rejects.toThrow();
    const preview=await service.Preview({...input,operations:[agentCreate,moduleCreate,{kind:'workflow',action:'create',parentId:'.cbim/workspace/game',slug:'implement',data:{name:'开发验证'},body:'# 开发\n实现并验证。'}]});
    expect(preview.validation.issues.filter(issue=>issue.severity==='error')).toEqual([]);
    expect(preview.changes.some(change=>change.path==='.cbim/team/people.json')).toBe(false);
    expect(JSON.parse(preview.changes.find(change=>change.path.endsWith('/module.json'))!.text!).maintenance).toBeUndefined();
    await expect(fs.access(path.join(f.a,'.cbim/workspace/game/module.json'))).rejects.toThrow();
    const command={workspaceId:input.workspaceId,instanceId:input.instanceId,planId:preview.planId};
    const result=await service.Commit(command);expect(result.state).toBe('committed');expect(await service.Commit(command)).toEqual(result);
    const [binding]=await resolveDispatchModules(await workspace.Snapshot(),['.cbim/workspace/game']);
    expect(binding).toMatchObject({moduleId:'.cbim/workspace/game',workflow:{kind:'module',id:'.cbim/workspace/game/workflows/implement'}});
    expect(binding).not.toHaveProperty('maintainerPersonIds');expect(binding).not.toHaveProperty('maintenanceBindingId');
    await expect(fs.access(path.join(f.a,'.cbim/team/people.json'))).rejects.toThrow();
  }finally{await f.cleanup()}
});

it('桌面 Agent/Skill/Workflow CRUD复用知识校验、继承和显式级联删除，不改业务源码',async()=>{
  const f=await fixture();
  try{
    const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id),service=new ArchitectureService(workspace),{call}=internalKnowledge(workspace);
    const apply=async(operations:ObjectOperation[],extra:Record<string,unknown>={})=>{
      const input=await identity(workspace),preview=await service.Preview({...input,operations,...extra});
      expect(preview.validation.issues.filter(issue=>issue.severity==='error')).toEqual([]);
      await service.Commit({workspaceId:input.workspaceId,instanceId:input.instanceId,planId:preview.planId});return preview;
    };
    await fs.mkdir(path.join(f.a,'game'));await fs.writeFile(path.join(f.a,'game/index.ts'),'export const untouched = true;');
    await apply([agentCreate,moduleCreate]);
    await apply([{kind:'skill',action:'create',parentId:'.cbim/team',slug:'review',data:{name:'审阅',purpose:'核实成果'},body:'# 审阅'},{kind:'workflow',action:'create',parentId:'.cbim/workspace/game',slug:'build',data:{name:'构建'},body:'# 构建'}]);
    expect((await call('cbim_agent_get',{id:'.cbim/team/developer'})).skills[0]).toMatchObject({name:'审阅',inherited:true});
    await apply([{kind:'agent',action:'update',id:'.cbim/team/developer',data:{name:'工程成员'},body:'# 变更原则'},{kind:'skill',action:'update',id:'.cbim/team/skills/review',data:{purpose:'核实测试'},body:'# Review'},{kind:'workflow',action:'update',id:'.cbim/workspace/game/workflows/build',data:{name:'构建并验证'},body:'# 验证'}]);
    expect((await call('cbim_agent_get',{id:'.cbim/team/developer'})).definition.name).toBe('工程成员');
    expect((await call('cbim_module_get',{id:'.cbim/workspace/game'})).workflows[0].name).toBe('构建并验证');
    await expect(service.Preview({...await identity(workspace),operations:[{kind:'module',action:'delete',id:'.cbim/workspace/game'}]})).rejects.toMatchObject({code:'HAS_CHILDREN'});
    await apply([{kind:'module',action:'delete',id:'.cbim/workspace/game',cascade:true},{kind:'agent',action:'delete',id:'.cbim/team/developer'},{kind:'skill',action:'delete',id:'.cbim/team/skills/review'}]);
    expect(await fs.readFile(path.join(f.a,'game/index.ts'),'utf8')).toBe('export const untouched = true;');
    expect((await call('cbim_module_registry')).modules).toEqual([]);
  }finally{await f.cleanup()}
});

it('废弃登记入口被明确拒绝，实例、版本、未知字段和正文校验仍阻止无效提交',async()=>{
  const f=await fixture();
  try{
    const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id),service=new ArchitectureService(workspace),input=await identity(workspace);
    const valid={...input,operations:[moduleCreate]};
    await expect(service.Preview({...valid,instanceId:'other'})).rejects.toMatchObject({code:'STALE_INSTANCE'});
    await expect(service.Preview({...valid,workspaceId:'other'})).rejects.toMatchObject({code:'STALE_INSTANCE'});
    await expect(service.Preview({...valid,revision:'other'})).rejects.toMatchObject({code:'CONFLICT'});
    for(const extra of [{peopleUpserts:[]},{maintenance:{maintainerPersonIds:['forged'],confirmed:true}},{unexpected:true}])await expect(service.Preview({...valid,...extra})).rejects.toThrow();
    await expect(service.Preview({...valid,operations:[{...moduleCreate,data:{summary,maintenance:{bindingId:'forged'}}}]})).rejects.toThrow();
    const invalid=await service.Preview({...valid,operations:[{...moduleCreate,body:'# 不完整业务知识'}]});
    expect(invalid.validation.structural).toBe(false);
    await expect(service.Commit({workspaceId:input.workspaceId,instanceId:input.instanceId,planId:invalid.planId})).rejects.toMatchObject({code:'VALIDATION'});
    await expect(fs.access(path.join(f.a,'.cbim/team/people.json'))).rejects.toThrow();
    await expect(fs.access(path.join(f.a,'.cbim/workspace/game/module.json'))).rejects.toThrow();
  }finally{await f.cleanup()}
});

it('架构预览不能跨版本或工作区实例提交，内部工具仍需要运行写授权',async()=>{
  const f=await fixture();
  try{
    const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id),service=new ArchitectureService(workspace),input=await identity(workspace),{call}=internalKnowledge(workspace);
    const preview=await service.Preview({...input,operations:[moduleCreate]});
    await expect(service.Commit({workspaceId:input.workspaceId,instanceId:'other',planId:preview.planId})).rejects.toMatchObject({code:'STALE_INSTANCE'});
    await expect(service.Commit({workspaceId:input.workspaceId,instanceId:input.instanceId,planId:preview.planId,changes:[]})).rejects.toThrow();
    await expect(call('cbim_object_commit',{planId:preview.planId})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(call('cbim_object_preview',{revision:input.revision,operations:[{...moduleCreate,data:{summary,maintenance:{bindingId:'forged'}}}]})).rejects.toThrow();
    await fs.writeFile(path.join(f.a,'.cbim/README.md'),'# 外部变更');
    await expect(service.Commit({workspaceId:input.workspaceId,instanceId:input.instanceId,planId:preview.planId})).rejects.toMatchObject({code:'CONFLICT'});
    const newer=await service.Preview({...await identity(workspace),operations:[moduleCreate]});
    await f.app.Stop(entry.id);await f.app.Open(entry.id);
    const replacement=f.app.Workspace(entry.id);
    await expect(new ArchitectureService(replacement).Commit({workspaceId:entry.id,instanceId:replacement.instanceId,planId:newer.planId})).rejects.toMatchObject({code:'STALE_INSTANCE'});
  }finally{await f.cleanup()}
});

it('工作区静态定义修改不重建成员或改写两个主会话派发图，旧任务基线必须重新准备',async()=>{
  const f=await fixture();
  try{
    const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id),service=new ArchitectureService(workspace);
    const initial=await identity(workspace),created=await service.Preview({...initial,operations:[agentCreate,moduleCreate]});
    await service.Commit({workspaceId:entry.id,instanceId:workspace.instanceId,planId:created.planId});
    const models=await f.app.models.Save({profile:{name:'Architecture dispatch fixture',api:'openai-completions',auth:'none',baseUrl:'https://example.test/v1',defaultModel:'fixture',models:[{id:'fixture',name:'fixture',enabled:true,contextWindow:65536,maxTokens:1024,reasoning:false}]}}),profile=models.profiles.find(item=>item.name==='Architecture dispatch fixture')!;
    const registered=await registerExplicitFixtureOwner(f.app,entry.id,{agentId:'.cbim/team/developer',moduleIds:['.cbim/workspace/game'],profileId:profile.id,modelId:'fixture'}),ownerSelection=registered.selection,dispatch=f.app.MemberDispatch(entry.id);
    const identities=['first-session','second-session'].map(rootSessionId=>({workspaceId:entry.id,rootSessionId}));
    for(const [index,identity] of identities.entries()){
      await f.app.Dispatch('dispatch.open',{...identity,commandId:'open-'+index});
      const scope=await dispatch.OpenScope(identity,'architecture-scope-'+index,{message:'Independent graph probe'},'architecture-main-'+index);
      await dispatch.goals.Plan(identity,scope.scopeId,'architecture-main-'+index,'architecture-plan-'+index,{expectedRevision:1,objective:'Independent graph probe',constraints:[],criteria:[{id:'verified',text:'Actual evidence',kind:'evidence'}],assignments:[{agentId:'.cbim/team/developer',moduleIds:['.cbim/workspace/game'],ownerSelection,criterionIds:['verified'],reason:'Registered module owner'}],reason:'Freeze separate original contexts'});
      await f.app.Dispatch('dispatch.task',{...identity,scopeId:scope.scopeId,commandId:'assign-'+index,expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/developer',moduleIds:['.cbim/workspace/game'],ownerSelection,goal:'独立会话目标 '+index,acceptance:[{id:'verified',text:'真实验证本会话目标'}]}});
    }
    const graphs=structuredClone(await Promise.all(identities.map(identity=>f.app.Dispatch('dispatch.graphSnapshot',{identity}))));
    const runtime=structuredClone(f.app.runtime.Snapshot()),before=await workspace.Snapshot();
    expect(graphs.map(graph=>graph.tasks.length)).toEqual([1,1]);
    expect(graphs[0].tasks[0].taskId).not.toBe(graphs[1].tasks[0].taskId);
    expect(runtime.members.some(member=>member.agentId==='.cbim/team/developer')).toBe(true);
    expect(runtime.tasks).toHaveLength(2);expect(runtime.runs).toEqual([]);

    const edited=await service.Preview({...await identity(workspace),operations:[{kind:'agent',action:'update',id:'.cbim/team/developer',data:{name:'更新后的静态角色'},body:'# 新工作原则\n遵循当前角色配置。'},{kind:'module',action:'update',id:'.cbim/workspace/game',data:{summary}}]});
    await service.Commit({workspaceId:entry.id,instanceId:workspace.instanceId,planId:edited.planId});
    const after=await workspace.Snapshot();
    expect(after.revision).not.toBe(before.revision);
    expect(JSON.parse(after.files.find(file=>file.path==='.cbim/team/developer/agent.json')!.text).name).toBe('更新后的静态角色');
    expect(JSON.parse(after.files.find(file=>file.path==='.cbim/workspace/game/module.json')!.text).maintenance).toBeUndefined();
    expect(await Promise.all(identities.map(identity=>f.app.Dispatch('dispatch.graphSnapshot',{identity})))).toEqual(graphs);
    for(const graph of graphs)expect(graph.tasks[0].modules[0]).not.toHaveProperty('maintainerPersonIds');
    const observed=f.app.runtime.Snapshot();
    expect(observed.members).toEqual(runtime.members);expect(observed.tasks).toEqual(runtime.tasks);expect(observed.runs).toEqual(runtime.runs);
    await expect(prepareDispatchExecutionContext(workspace,graphs[0].tasks[0])).rejects.toMatchObject({code:'KNOWLEDGE_CHANGED'});
    expect(await f.app.Dispatch('loop.list',{id:entry.id})).toEqual([]);
  }finally{await f.cleanup()}
});
