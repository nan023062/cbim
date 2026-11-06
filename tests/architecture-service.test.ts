import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ArchitectureService} from '../src/backend/main/workspace/architecture-service';
import type {KnowledgeWorkspace} from '../src/backend/core/knowledge/ports';
import {resolveDispatchModules} from '../src/backend/scheduler-engine/context/dispatch-context';
import {prepareDispatchExecutionContext} from '../src/backend/scheduler-engine/context/execution-context';
import type {ObjectOperation} from '../src/bridge/contracts/architecture';
import {fixture,summary,moduleFiles,internalKnowledge} from './helpers';

const owner={id:'owner',name:'项目维护人',team:'.cbim/team'};
const maintenance={maintainerPersonIds:['owner'],confirmed:true};
const moduleCreate: ObjectOperation={kind:'module',action:'create',parentId:'.cbim/workspace',slug:'game',data:{summary},body:moduleFiles()[1].text};
const agentCreate: ObjectOperation={kind:'agent',action:'create',parentId:'.cbim/team',slug:'developer',data:{name:'开发成员',summary,capabilities:['开发']},body:'# 工作原则\n实际实现并验证成果。'};
async function identity(workspace:KnowledgeWorkspace){
  const snapshot=await workspace.snapshot();return {workspaceId:snapshot.workspaceId,instanceId:snapshot.instanceId,revision:snapshot.revision};
}

it('桌面架构预览将模块、真人和后端维护确认合成同一事务，确认后可用于真实派发',async()=>{
  const f=await fixture();
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),service=new ArchitectureService(workspace);
    const input=await identity(workspace),before=await fs.readFile(path.join(f.a,'.cbim/team/people.json'),'utf8');
    const p=await service.preview({...input,operations:[agentCreate,moduleCreate,{kind:'workflow',action:'create',parentId:'.cbim/workspace/game',slug:'implement',data:{name:'开发验证'},body:'# 开发\n实现并验证。'}],peopleUpserts:[owner],maintenance});
    expect(p.validation.issues.filter(issue=>issue.severity==='error')).toEqual([]);
    expect(p.objects).toEqual(['.cbim/team/developer','.cbim/workspace/game','.cbim/workspace/game/workflows/implement']);
    expect(await fs.readFile(path.join(f.a,'.cbim/team/people.json'),'utf8')).toBe(before);
    await expect(fs.access(path.join(f.a,'.cbim/workspace/game/module.json'))).rejects.toThrow();
    const definition=JSON.parse(p.changes.find(change=>change.path==='.cbim/workspace/game/module.json')!.text!);
    expect(definition.maintenance).toMatchObject({revision:1,state:'active',maintainerPersonIds:['owner'],confirmation:{source:'local_user'}});
    expect(definition.maintenance.bindingId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(definition.maintenance.confirmation.confirmedAt).toISOString()).toBe(definition.maintenance.confirmation.confirmedAt);
    const result=await service.commit({workspaceId:input.workspaceId,instanceId:input.instanceId,planId:p.planId});
    expect(result.state).toBe('committed');
    expect(await service.commit({workspaceId:input.workspaceId,instanceId:input.instanceId,planId:p.planId})).toEqual(result);
    const snapshot=await workspace.snapshot();
    const [binding]=await resolveDispatchModules(snapshot,['.cbim/workspace/game']);
    expect(binding.maintainerPersonIds).toEqual(['owner']);
    expect(binding.maintenanceBindingId).toBe(definition.maintenance.bindingId);
    expect(binding.workflow).toMatchObject({kind:'module',id:'.cbim/workspace/game/workflows/implement'});
    const edit=await service.preview({...await identity(workspace),operations:[{kind:'module',action:'update',id:'.cbim/workspace/game',data:{summary}}],peopleUpserts:[{...owner,name:'维护负责人'}],maintenance});
    const changed=JSON.parse(edit.changes.find(change=>change.path.endsWith('/module.json'))!.text!).maintenance;
    expect(changed.bindingId).toBe(definition.maintenance.bindingId);expect(changed.revision).toBe(2);
    expect(changed.confirmation.recordId).not.toBe(definition.maintenance.confirmation.recordId);
    await service.commit({workspaceId:input.workspaceId,instanceId:input.instanceId,planId:edit.planId});
    expect(JSON.parse(await fs.readFile(path.join(f.a,'.cbim/team/people.json'),'utf8')).people).toEqual([{...owner,name:'维护负责人'}]);
  }finally{await f.cleanup()}
});

it('桌面 Agent/Skill/Workflow CRUD复用知识校验、继承和显式级联删除，不改业务源码',async()=>{
  const f=await fixture();
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),service=new ArchitectureService(workspace),{call}=internalKnowledge(workspace);
    const apply=async(operations:ObjectOperation[],extra:Record<string,unknown>={})=>{
      const input=await identity(workspace),preview=await service.preview({...input,operations,...extra});
      expect(preview.validation.issues.filter(issue=>issue.severity==='error')).toEqual([]);
      await service.commit({workspaceId:input.workspaceId,instanceId:input.instanceId,planId:preview.planId});return preview;
    };
    await fs.mkdir(path.join(f.a,'game'));await fs.writeFile(path.join(f.a,'game/index.ts'),'export const untouched = true;');
    await apply([agentCreate,moduleCreate],{peopleUpserts:[owner],maintenance});
    await apply([{kind:'skill',action:'create',parentId:'.cbim/team',slug:'review',data:{name:'审阅',purpose:'核实成果'},body:'# 审阅'},{kind:'workflow',action:'create',parentId:'.cbim/workspace/game',slug:'build',data:{name:'构建'},body:'# 构建'}]);
    expect((await call('cbim_agent_get',{id:'.cbim/team/developer'})).skills[0]).toMatchObject({name:'审阅',inherited:true});
    await apply([{kind:'agent',action:'update',id:'.cbim/team/developer',data:{name:'工程成员'},body:'# 变更原则'},{kind:'skill',action:'update',id:'.cbim/team/skills/review',data:{purpose:'核实测试'},body:'# Review'},{kind:'workflow',action:'update',id:'.cbim/workspace/game/workflows/build',data:{name:'构建并验证'},body:'# 验证'}]);
    expect((await call('cbim_agent_get',{id:'.cbim/team/developer'})).definition.name).toBe('工程成员');
    expect((await call('cbim_module_get',{id:'.cbim/workspace/game'})).workflows[0].name).toBe('构建并验证');
    await expect(service.preview({...await identity(workspace),operations:[{kind:'module',action:'delete',id:'.cbim/workspace/game'}]})).rejects.toMatchObject({code:'HAS_CHILDREN'});
    await apply([{kind:'module',action:'delete',id:'.cbim/workspace/game',cascade:true},{kind:'agent',action:'delete',id:'.cbim/team/developer'},{kind:'skill',action:'delete',id:'.cbim/team/skills/review'}]);
    expect(await fs.readFile(path.join(f.a,'game/index.ts'),'utf8')).toBe('export const untouched = true;');
    expect((await call('cbim_module_registry')).modules).toEqual([]);
  }finally{await f.cleanup()}
});

it('桌面架构入口拒绝身份、维护伪造和未知字段；缺失真人或无效知识不能提交',async()=>{
  const f=await fixture();
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),service=new ArchitectureService(workspace),input=await identity(workspace);
    const valid={...input,operations:[moduleCreate],peopleUpserts:[owner],maintenance};
    await expect(service.preview({...valid,instanceId:'other'})).rejects.toMatchObject({code:'STALE_INSTANCE'});
    await expect(service.preview({...valid,workspaceId:'other'})).rejects.toMatchObject({code:'STALE_INSTANCE'});
    await expect(service.preview({...valid,revision:'other'})).rejects.toMatchObject({code:'CONFLICT'});
    await expect(service.preview({...valid,maintenance:undefined})).rejects.toMatchObject({code:'MAINTENANCE_CONFIRMATION'});
    await expect(service.preview({...valid,maintenance:{...maintenance,confirmed:false}})).rejects.toThrow();
    await expect(service.preview({...valid,maintenance:{...maintenance,confirmation:{source:'local_user'}}})).rejects.toThrow();
    await expect(service.preview({...valid,operations:[{...moduleCreate,data:{summary,maintenance:{bindingId:'forged'}}}]})).rejects.toThrow();
    await expect(service.preview({...valid,maintenance:{...maintenance,moduleId:'.cbim/workspace/other'}})).rejects.toMatchObject({code:'MAINTENANCE'});
    await expect(service.preview({...valid,maintenance:{...maintenance,maintainerPersonIds:['owner','owner']}})).rejects.toMatchObject({code:'MAINTENANCE'});
    await expect(service.preview({...valid,peopleUpserts:[owner,owner]})).rejects.toMatchObject({code:'PEOPLE'});
    await expect(service.preview({...valid,unexpected:true})).rejects.toThrow();
    const missing=await service.preview({...valid,peopleUpserts:[]});
    expect(missing.validation.issues.some(issue=>issue.code==='maintenance')).toBe(true);
    await expect(service.commit({workspaceId:input.workspaceId,instanceId:input.instanceId,planId:missing.planId})).rejects.toMatchObject({code:'VALIDATION'});
    const invalid=await service.preview({...valid,operations:[{...moduleCreate,body:'# 不完整业务知识'}]});
    expect(invalid.validation.structural).toBe(false);
    await expect(service.commit({workspaceId:input.workspaceId,instanceId:input.instanceId,planId:invalid.planId})).rejects.toMatchObject({code:'VALIDATION'});
    expect(JSON.parse(await fs.readFile(path.join(f.a,'.cbim/team/people.json'),'utf8')).people).toEqual([]);
    await expect(fs.access(path.join(f.a,'.cbim/workspace/game/module.json'))).rejects.toThrow();
  }finally{await f.cleanup()}
});

it('架构预览不能跨版本或工作区实例提交，内部工具仍需要运行写授权',async()=>{
  const f=await fixture();
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),service=new ArchitectureService(workspace),input=await identity(workspace),{call}=internalKnowledge(workspace);
    const preview=await service.preview({...input,operations:[moduleCreate],peopleUpserts:[owner],maintenance});
    await expect(service.commit({workspaceId:input.workspaceId,instanceId:'other',planId:preview.planId})).rejects.toMatchObject({code:'STALE_INSTANCE'});
    await expect(service.commit({workspaceId:input.workspaceId,instanceId:input.instanceId,planId:preview.planId,changes:[]})).rejects.toThrow();
    await expect(call('cbim_object_commit',{planId:preview.planId})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(call('cbim_object_preview',{revision:input.revision,operations:[{...moduleCreate,data:{summary,maintenance:{bindingId:'forged'}}}]})).rejects.toThrow();
    await fs.writeFile(path.join(f.a,'.cbim/README.md'),'# 外部变更');
    await expect(service.commit({workspaceId:input.workspaceId,instanceId:input.instanceId,planId:preview.planId})).rejects.toMatchObject({code:'CONFLICT'});
    const newer=await service.preview({...await identity(workspace),operations:[moduleCreate],peopleUpserts:[owner],maintenance});
    await f.app.stop(entry.id);await f.app.open(entry.id);
    const replacement=f.app.workspace(entry.id);
    await expect(new ArchitectureService(replacement).commit({workspaceId:entry.id,instanceId:replacement.instanceId,planId:newer.planId})).rejects.toMatchObject({code:'STALE_INSTANCE'});
  }finally{await f.cleanup()}
});

it('工作区静态定义修改不重建成员或改写两个主会话派发图，旧任务基线必须重新准备',async()=>{
  const f=await fixture();
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),service=new ArchitectureService(workspace);
    const initial=await identity(workspace),created=await service.preview({...initial,operations:[agentCreate,moduleCreate],peopleUpserts:[owner],maintenance});
    await service.commit({workspaceId:entry.id,instanceId:workspace.instanceId,planId:created.planId});
    const identities=['first-session','second-session'].map(rootSessionId=>({workspaceId:entry.id,rootSessionId}));
    for(const [index,identity] of identities.entries()){
      await f.app.dispatch('dispatch.open',{...identity,commandId:'open-'+index});
      await f.app.dispatch('dispatch.task',{...identity,commandId:'assign-'+index,expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/developer',moduleIds:['.cbim/workspace/game'],goal:'独立会话目标 '+index,acceptance:[{id:'verified',text:'真实验证本会话目标'}]}});
    }
    const graphs=structuredClone(await Promise.all(identities.map(identity=>f.app.dispatch('dispatch.graphSnapshot',{identity}))));
    const runtime=structuredClone(f.app.runtime.snapshot()),before=await workspace.snapshot();
    expect(graphs.map(graph=>graph.tasks.length)).toEqual([1,1]);
    expect(graphs[0].tasks[0].taskId).not.toBe(graphs[1].tasks[0].taskId);
    expect(runtime.members.some(member=>member.agentId==='.cbim/team/developer')).toBe(true);
    expect(runtime.tasks).toHaveLength(2);expect(runtime.runs).toEqual([]);

    const edited=await service.preview({...await identity(workspace),operations:[{kind:'agent',action:'update',id:'.cbim/team/developer',data:{name:'更新后的静态角色'},body:'# 新工作原则\n遵循当前角色配置。'},{kind:'module',action:'update',id:'.cbim/workspace/game',data:{summary}}],peopleUpserts:[{id:'successor',name:'新维护人',team:'.cbim/team'}],maintenance:{maintainerPersonIds:['successor'],confirmed:true}});
    await service.commit({workspaceId:entry.id,instanceId:workspace.instanceId,planId:edited.planId});
    const after=await workspace.snapshot();
    expect(after.revision).not.toBe(before.revision);
    expect(JSON.parse(after.files.find(file=>file.path==='.cbim/team/developer/agent.json')!.text).name).toBe('更新后的静态角色');
    expect(JSON.parse(after.files.find(file=>file.path==='.cbim/workspace/game/module.json')!.text).maintenance).toMatchObject({revision:2,maintainerPersonIds:['successor']});
    expect(await Promise.all(identities.map(identity=>f.app.dispatch('dispatch.graphSnapshot',{identity})))).toEqual(graphs);
    for(const graph of graphs)expect(graph.tasks[0].modules[0].maintainerPersonIds).toEqual(['owner']);
    const observed=f.app.runtime.snapshot();
    expect(observed.members).toEqual(runtime.members);expect(observed.tasks).toEqual(runtime.tasks);expect(observed.runs).toEqual(runtime.runs);
    await expect(prepareDispatchExecutionContext(workspace,graphs[0].tasks[0])).rejects.toMatchObject({code:'KNOWLEDGE_CHANGED'});
    expect(await f.app.dispatch('loop.list',{id:entry.id})).toEqual([]);
  }finally{await f.cleanup()}
});
