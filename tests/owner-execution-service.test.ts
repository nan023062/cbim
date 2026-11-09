import {expect,test,vi} from 'vitest';
import {fixture,request} from './helpers';
import {seedOwnerExecution} from './owner-execution-fixture';
import type {GoalPlanInput} from '../src/backend/core/tasks/scope-goal';
import {ownerExecutionSelectionFor} from '../src/backend/core/team/member-execution-binding';

const latch=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {promise,resolve}};
async function setup(){
  const f=await fixture(),seed=await seedOwnerExecution(f.app,f.a,{main:'http://localhost:1/main',a:'http://localhost:1/a',b:'http://localhost:1/b'}),workspace=f.app.workspace(seed.entry.id),service=f.app.memberDispatch(seed.entry.id),store=workspace.dispatchStore;
  const identity={workspaceId:seed.entry.id,rootSessionId:'owner-service-root'},scopeId='owner-service-scope',runId='owner-service-main';
  await service.openScope(identity,scopeId,{message:'由明确岗位处理所选模块'},runId);
  const selection=(await service.owners.discover([seed.modules[0]])).groups[0].selection!;
  const input:GoalPlanInput={expectedRevision:1,objective:'核实所选模块',constraints:[],criteria:[{id:'c1',kind:'evidence',text:'保留真实证据'}],assignments:[{agentId:seed.team.input.agentId,moduleIds:[seed.modules[0]],ownerSelection:selection,criterionIds:['c1'],reason:'负责岗位'}],reason:'明确岗位和模块'};
  const request={...identity,commandId:'owner-service-dispatch',expectedParentRevision:1,task:{assigneeAgentId:seed.team.input.agentId,moduleIds:[seed.modules[0]],ownerSelection:selection,goal:'读取模块材料',acceptance:[{id:'c1',text:'真实读取'}]}};
  return {...f,seed,workspace,service,store,identity,scopeId,runId,selection,input,request};
}

test('发现同时给出能力与模型变化，空项目同时说明岗位入口及未核实项且不产生选择',async()=>{
  const f=await setup();try{
    const snapshot=await f.workspace.snapshot(),file=f.seed.team.input.agentId+'/principles.md';
    const original=snapshot.files.find(item=>item.path===file)!.text;
    await f.workspace.commit(request(snapshot,[{path:file,text:original+'\n新增执行原则，须明确重新采纳。\n'}]));
    const profile=f.seed.profiles[1];await f.app.models.save({id:profile.id,profile:{...profile.definition,name:'变化模型配置'}});
    const before=await f.store.read(),result=await f.service.owners.discover([f.seed.modules[0]]),group=result.groups[0];
    expect(group.issues.map(issue=>issue.code)).toEqual(expect.arrayContaining(['OWNER_CAPABILITY_CHANGED','OWNER_MODEL_CHANGED']));expect(group.selection).toBeUndefined();expect(await f.store.read()).toEqual(before);
    const other=await f.app.dispatch('add',{path:f.b}),empty=f.app.memberDispatch(other.id);
    const missing=await empty.owners.discover(['.cbim/workspace/chess']);
    const codes=missing.groups[0].issues.map(issue=>issue.code);expect(codes).toEqual(expect.arrayContaining(['OWNER_UNASSIGNED','OWNER_MEMBER_REQUIRED','OWNER_MODEL_UNRESOLVED']));
    expect(missing.groups[0].issues.some(issue=>issue.message.includes('团队架构 → 项目岗位 → 登记项目岗位'))).toBe(true);
    expect(missing.groups[0].issues.length).toBeGreaterThan(3);expect(missing.groups[0].selection).toBeUndefined();expect(JSON.stringify(missing)).not.toContain('MAINTAINER_UNCONFIRMED');
  }finally{await f.cleanup()}
});

test('同静态Agent的岗位分组不合并，原任务只读对照保持原绑定和岗位名',async()=>{
  const f=await setup();try{
    const discovery=await f.service.owners.discover([...f.seed.modules,f.seed.extraModule,'.cbim/workspace']);
    expect(discovery.groups.filter(group=>group.selection)).toHaveLength(2);expect(discovery.groups.find(group=>group.moduleIds.includes('.cbim/workspace'))?.issues[0].code).toBe('OWNER_UNASSIGNED');
    expect(discovery.groups.find(group=>group.moduleIds.includes(f.seed.modules[0]))?.moduleIds).toEqual([f.seed.modules[0],f.seed.extraModule]);
    await f.service.goals.plan(f.identity,f.scopeId,f.runId,'plan',f.input);const receipt=await f.service.dispatchTask(f.request,f.scopeId),task=(await f.service.snapshot(f.identity)).tasks.find(item=>item.taskId===receipt.taskId)!;
    expect(task.assignee.name).toBe(f.seed.positions[0].member.name);expect(ownerExecutionSelectionFor(task.ownerBinding!)).toEqual(f.selection);
    const profile=f.seed.profiles[1];await f.app.models.save({id:profile.id,profile:{...profile.definition,name:'当前配置已经修改'}});
    const result=await f.service.ownerInspect({...f.identity,taskId:task.taskId});expect(result.ownerBinding).toEqual(task.ownerBinding);expect(result.taskRevision).toBe(task.revision);expect(result.current.groups[0].issues[0].code).toBe('OWNER_MODEL_CHANGED');
    expect((await f.service.snapshot(f.identity)).tasks[0]).toEqual(task);
  }finally{await f.cleanup()}
});

test('原计划和派发命令先查回执，来源模型删除后仍不重做，新命令明确拒绝',async()=>{
  const f=await setup();try{
    const planned=await f.service.goals.plan(f.identity,f.scopeId,f.runId,'plan',f.input),receipt=await f.service.dispatchTask(f.request,f.scopeId);await f.app.models.remove(f.seed.profiles[1].id);
    const before=await f.store.read(),reading=vi.spyOn(f.app.models,'withConfigurations');
    expect(await f.service.goals.plan(f.identity,f.scopeId,f.runId,'plan',f.input)).toEqual(planned);expect(await f.service.dispatchTask(f.request,f.scopeId)).toEqual(receipt);expect(reading).not.toHaveBeenCalled();
    await expect(f.service.dispatchTask({...f.request,commandId:'new-command'},f.scopeId)).rejects.toMatchObject({code:'LLM_REQUIRED'});expect(await f.store.read()).toEqual(before);
    await expect(f.app.dispatch('dispatch.task',{...f.request,commandId:'no-scope'})).rejects.toMatchObject({code:'DISPATCH_SCOPE_REQUIRED'});
    await expect(f.app.dispatch('loop.start',{id:f.seed.entry.id,task:{},options:{}})).rejects.toMatchObject({code:'OWNER_DISPATCH_REQUIRED'});
  }finally{await f.cleanup()}
});

test('计划等待模型短锁时停止，不写计划或创建运行，后来配置操作仍可完成',async()=>{
  const f=await setup(),entered=latch(),release=latch();let stopped=false;
  try{
    const before=await f.store.read(),profile=f.seed.profiles[1];
    const holding=f.app.models.withConfigurations([{profileId:profile.id,modelId:profile.modelId}],async()=>{entered.resolve();await release.promise});await entered.promise;
    const planning=f.service.goals.plan(f.identity,f.scopeId,f.runId,'stopped-plan',f.input,()=>{if(stopped)throw Object.assign(Error('stopped'),{code:'COLLABORATION_STOPPED'})});void planning.catch(()=>{});
    await new Promise<void>(resolve=>setImmediate(resolve));stopped=true;release.resolve();await holding;await expect(planning).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});
    expect(await f.store.read()).toEqual(before);await f.app.models.save({id:profile.id,profile:{...profile.definition,name:'锁已释放'}});
  }finally{release.resolve();await f.cleanup()}
});

test('领取前实际模型修改拒绝旧岗位任务，既不领取信封也不启动或重新采纳',async()=>{
  const f=await setup();try{
    await f.service.goals.plan(f.identity,f.scopeId,f.runId,'plan',f.input);const receipt=await f.service.dispatchTask(f.request,f.scopeId),profile=f.seed.profiles[1];
    await f.app.models.save({id:profile.id,profile:{...profile.definition,name:'领取前新配置'}});const before=await f.store.read();
    await expect(f.app.memberExecution(f.seed.entry.id).start({...f.identity,taskId:receipt.taskId,commandId:'start-stale',expectedRevision:1,options:{permission:'read'}})).rejects.toMatchObject({code:'OWNER_MODEL_CHANGED'});
    expect(await f.store.read()).toEqual(before);expect(before.runs).toEqual([]);expect(before.outbox.find(message=>message.taskId===receipt.taskId)?.delivery).toBe('pending');
  }finally{await f.cleanup()}
});
