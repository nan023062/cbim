import {expect,test} from 'vitest';
import {fixture,request} from './helpers';
import {seedTeam} from './team-fixture';
import {registerFixtureOwner} from './owner-execution-fixture';
import {prepareDispatchExecutionContext} from '../src/backend/scheduler-engine/context/execution-context';
import {validatePreparedDispatchKnowledge} from '../src/backend/core/tasks/execution-context';
import {humanContinuationSubject} from '../src/backend/core/tasks/human-continue';

async function setup(modules=false,mode:'auto'|'team'='auto'){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id);
  let moduleId='cbim:project';
  if(modules){const team=await seedTeam(workspace);moduleId=team.input.moduleId;const snapshot=await workspace.snapshot(),file=snapshot.files.find(f=>f.path===moduleId+'/module.json')!,definition=JSON.parse(file.text);definition.maintenance={bindingId:'maintenance-test',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'confirmed-test',source:'local_user',confirmedAt:new Date().toISOString()}};await workspace.commit(request(snapshot,[{path:file.path,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]))}
  const definition={name:'auto-test',api:'openai-completions' as const,baseUrl:'http://localhost:1',auth:'none' as const,defaultModel:'test',models:[{id:'test',name:'test',enabled:true,contextWindow:65536,maxTokens:1024,reasoning:false,vision:false}]};
  const settings=await f.app.models.save({profile:definition}),profileId=settings.profiles.find(p=>p.name==='auto-test')!.id;
  const identity={workspaceId:entry.id,rootSessionId:'auto-root'},service=f.app.memberDispatch(entry.id),scopeId='auto-scope',runId='auto-main';
  await service.openScope(identity,scopeId,{message:'实现并验证项目功能'},runId,{collaborationMode:mode,profileId,model:'test'});
  const input={expectedRevision:1,objective:'实现项目功能',constraints:[],criteria:[{id:'c1',text:'真实验证',kind:'evidence' as const},{id:'human',text:'用户验收',kind:'human' as const}],assignments:[{agentId:'cbim:executor',moduleIds:[moduleId],criterionIds:['c1','human'],reason:'自动处理目标'}],reason:'目标计划'};
  const dispatch={...identity,commandId:'dispatch-auto',expectedParentRevision:1,task:{assigneeAgentId:'cbim:executor',moduleIds:[moduleId],goal:'实现并验证',acceptance:[{id:'c1',text:'真实验证'}]}};
  return {...f,workspace,service,identity,scopeId,runId,input,dispatch,profileId,definition,moduleId,store:workspace.dispatchStore};
}

test('无业务模块的 auto 保存明确兜底、派发及冻结知识，不登记模块或岗位',async()=>{
  const f=await setup();try{
    const snapshot=await f.workspace.snapshot(),before=await f.store.read();
    const scope=await f.service.goals.plan(f.identity,f.scopeId,f.runId,'plan',f.input),assignment=scope.goal!.plan!.assignments[0];
    expect(assignment.fallbackBinding?.reason).toBe('no_modules');expect(assignment.ownerBinding).toBeUndefined();
    const receipt=await f.service.dispatchTask(f.dispatch,f.scopeId),state=await f.store.read(),task=state.graphs[0].tasks[0];
    expect(receipt.fallbackBinding).toEqual(assignment.fallbackBinding);expect(task.fallbackBinding).toEqual(assignment.fallbackBinding);
    const prepared=await prepareDispatchExecutionContext(f.workspace,task);validatePreparedDispatchKnowledge(prepared);expect(prepared.fallbackBinding).toEqual(task.fallbackBinding);expect(prepared.memberContext).toBeUndefined();
    expect((await f.workspace.snapshot()).revision).toBe(snapshot.revision);expect(state.workspaceMembers).toEqual(before.workspaceMembers);expect(state.moduleOwnerships).toEqual(before.moduleOwnerships);
    expect(humanContinuationSubject(scope.goal!.plan!).assignments[0].fallbackBinding).toEqual(task.fallbackBinding);
    await expect(f.service.goals.plan(f.identity,f.scopeId,f.runId,'drop-human',{...f.input,expectedRevision:2,criteria:[f.input.criteria[0]],assignments:[{...f.input.assignments[0],criterionIds:['c1']}]})).rejects.toMatchObject({code:'GOAL_HUMAN_REQUIRED'});
  }finally{await f.cleanup()}
});
test('已有模块无负责人自动执行，登记负责人后旧兜底不能领取',async()=>{
  const f=await setup(true);try{
    const scope=await f.service.goals.plan(f.identity,f.scopeId,f.runId,'plan',f.input);expect(scope.goal!.plan!.assignments[0].fallbackBinding?.reason).toBe('unassigned_owner');
    await f.service.dispatchTask(f.dispatch,f.scopeId);
    await registerFixtureOwner(f.app,f.identity.workspaceId,{agentId:'cbim:executor',moduleIds:[f.moduleId],profileId:f.profileId,modelId:'test',name:'实际负责岗位',adaptation:{instructions:'执行项目任务',references:[]}});
    const state=await f.store.read(),task=state.graphs[0].tasks[0];
    await expect(f.service.owners.withContext(()=>f.service.owners.selections([task]),context=>f.service.owners.verifyTask(state,context,task))).rejects.toMatchObject({code:'AUTO_OWNER_EXISTS'});
    expect((await f.store.read()).runs).toEqual([]);
  }finally{await f.cleanup()}
});
test.each([false,true])('团队模式没有负责人拒绝计划和派发（有模块=%s）',async modules=>{
  const f=await setup(modules,'team');try{
    const before=await f.store.read();await expect(f.service.goals.plan(f.identity,f.scopeId,f.runId,'team-plan',f.input)).rejects.toMatchObject({code:'OWNER_SELECTION_REQUIRED'});
    await expect(f.service.dispatchTask(f.dispatch,f.scopeId)).rejects.toMatchObject({code:'OWNER_SELECTION_REQUIRED'});expect(await f.store.read()).toEqual(before);
  }finally{await f.cleanup()}
});
test('自动模式冻结模型，不能冒充角色或忽略已有模块走全项目捷径',async()=>{
  const f=await setup(true);try{
    await expect(f.service.goals.plan(f.identity,f.scopeId,f.runId,'wrong-agent',{...f.input,assignments:[{...f.input.assignments[0],agentId:'.cbim/team/unknown'}]})).rejects.toBeTruthy();
    await expect(f.service.goals.plan(f.identity,f.scopeId,f.runId,'whole-project',{...f.input,assignments:[{...f.input.assignments[0],moduleIds:['cbim:project']}]})).rejects.toMatchObject({code:'AUTO_MODULES_CHANGED'});
    await f.app.models.save({id:f.profileId,profile:{...f.definition,name:'配置变化'}});
    await expect(f.service.goals.plan(f.identity,f.scopeId,f.runId,'model-change',f.input)).rejects.toMatchObject({code:'OWNER_MODEL_CHANGED'});
    expect((await f.store.read()).graphs[0].tasks).toEqual([]);
  }finally{await f.cleanup()}
});

test('存储拒绝改写周期模式和既有兜底身份，原命令重查不会再派工',async()=>{
  const f=await setup();try{
    await f.service.goals.plan(f.identity,f.scopeId,f.runId,'plan',f.input);const receipt=await f.service.dispatchTask(f.dispatch,f.scopeId),before=await f.store.read();
    await expect(f.store.transact({commandId:'change-mode',fingerprint:'a'.repeat(64)},async()=>({scopes:[{...before.scopes![0],executionPolicy:{mode:'team' as const}}],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await f.app.models.save({id:f.profileId,profile:{...f.definition,name:'外部配置变更'}});
    expect(await f.service.dispatchTask(f.dispatch,f.scopeId)).toEqual(receipt);expect(await f.store.read()).toEqual(before);
  }finally{await f.cleanup()}
});
