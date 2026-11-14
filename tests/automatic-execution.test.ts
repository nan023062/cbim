import {expect,test} from 'vitest';
import {fixture} from './helpers';
import {seedTeam} from './team-fixture';
import {assertAutomaticExecution} from '../src/logic/tasks/rules/automatic-execution-rules';
import type {AutomaticExecutionBinding} from '../src/logic/team/rules/automatic-execution';

async function setup(modules=false,mode:'auto'|'team'='auto'){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id);
  const moduleId=modules?(await seedTeam(workspace)).input.moduleId:'cbim:project';
  const definition={name:'main-test',api:'openai-completions' as const,baseUrl:'http://localhost:1',auth:'none' as const,defaultModel:'test',models:[{id:'test',name:'test',enabled:true,contextWindow:65536,maxTokens:1024,reasoning:false,vision:false}]};
  const settings=await f.app.models.save({profile:definition}),profileId=settings.profiles.find(p=>p.name==='main-test')!.id;
  const identity={workspaceId:entry.id,rootSessionId:'main-root'},service=f.app.memberDispatch(entry.id),scopeId='main-scope',runId='main-run';
  await service.openScope(identity,scopeId,{message:'实现并验证项目功能'},runId,{collaborationMode:mode,profileId,model:'test'});
  const input={expectedRevision:1,objective:'实现项目功能',constraints:[],criteria:[{id:'c1',text:'真实验证',kind:'evidence' as const}],assignments:[{agentId:'cbim:main',moduleIds:[moduleId],criterionIds:['c1'],reason:'默认主会话执行'}],reason:'目标计划'};
  return {...f,workspace,service,identity,scopeId,runId,input,moduleId,store:workspace.dispatchStore};
}

test.each([{mode:'auto',modules:false},{mode:'auto',modules:true},{mode:'team',modules:false},{mode:'team',modules:true}] as const)('未指定自定义岗位的模块隐式由主 Agent 负责 ($mode / modules=$modules)',async({mode,modules})=>{
  const f=await setup(modules,mode);try{
    const before=await f.workspace.snapshot();
    expect((await f.service.owners.discover([f.moduleId])).groups).toEqual([{moduleIds:[f.moduleId],execution:'main',agentId:'cbim:main',issues:[]}]);
    const scope=await f.service.goals.plan(f.identity,f.scopeId,f.runId,'plan',f.input),assignment=scope.goal!.plan!.assignments[0];
    expect(assignment.agentId).toBe('cbim:main');expect(assignment.ownerBinding).toBeUndefined();expect(assignment.fallbackBinding).toBeUndefined();
    const state=await f.store.read();expect(state.workspaceMembers??[]).toEqual([]);expect(state.moduleOwnerships??[]).toEqual([]);expect(state.graphs[0].tasks).toEqual([]);expect((await f.workspace.snapshot()).files).toEqual(before.files);
    await expect(f.service.dispatchTask({...f.identity,commandId:'retired',expectedParentRevision:1,task:{assigneeAgentId:'cbim:executor',moduleIds:[f.moduleId],goal:'不再派给默认执行员',acceptance:[{id:'c',text:'真实证据'}]}},f.scopeId)).rejects.toMatchObject({code:'MAIN_EXECUTION_REQUIRED'});
    expect(await f.store.read()).toEqual(state);
  }finally{await f.cleanup()}
});

test('旧自动绑定仅保留读取；新许可拒绝退役角色，周期模式仍不可改写',async()=>{
  const f=await setup();try{
    const before=await f.store.read(),scope=before.scopes![0],policy=scope.executionPolicy!;if(policy.mode!=='auto')throw Error('fixture policy');
    const binding:AutomaticExecutionBinding={version:1,kind:'automatic',scopeId:f.scopeId,workspaceId:f.identity.workspaceId,agentId:'cbim:executor',teamId:'.cbim/team',capabilityHash:'a'.repeat(64),knowledgeRevision:'old-knowledge',model:policy.model,reason:'no_modules',moduleIds:['cbim:project']};
    expect(()=>assertAutomaticExecution(before,binding,f.identity.rootSessionId)).not.toThrow();
    expect(()=>assertAutomaticExecution(before,binding,f.identity.rootSessionId,true)).toThrow(expect.objectContaining({code:'AGENT_RETIRED'}));
    await expect(f.store.transact({commandId:'change-mode',fingerprint:'a'.repeat(64)},async()=>({scopes:[{...scope,executionPolicy:{mode:'team' as const}}],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    expect(await f.store.read()).toEqual(before);
  }finally{await f.cleanup()}
});
