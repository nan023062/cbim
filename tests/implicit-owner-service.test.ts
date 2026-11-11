import {expect,it} from 'vitest';
import {fixture} from './helpers';
import {moduleFiles,summary,request} from './data/knowledge';
import {seedOwnerExecution} from './owner-execution-fixture';
import {commitModuleOwnership,moduleOwnershipChange} from './module-ownership-fixture';
import {ownerExecutionSelectionFor} from '../src/backend/core/team/member-execution-binding';

async function setup(){
 const f=await fixture(),seed=await seedOwnerExecution(f.app,f.a,{main:'http://localhost:1/main',a:'http://localhost:1/a',b:'http://localhost:1/b'}),workspace=f.app.workspace(seed.entry.id),service=f.app.memberDispatch(seed.entry.id),child=seed.modules[0]+'/inherited_leaf',unassigned='.cbim/workspace/unassigned';
 const preview=await seed.team.call('cbim_object_preview',{revision:(await workspace.snapshot()).revision,operations:[
  {kind:'module',action:'create',parentId:seed.modules[0],slug:'inherited_leaf',data:{summary},body:moduleFiles('inherited_leaf')[1].text},
  {kind:'module',action:'create',parentId:'.cbim/workspace',slug:'unassigned',data:{summary},body:moduleFiles('unassigned')[1].text},
 ]});expect(preview.validation.structural).toBe(true);await seed.team.call('cbim_object_commit',{planId:preview.planId},true);
 return {...f,seed,workspace,service,child,unassigned};
}
it('最近父级自动解析，子模块显式选择优先，失效父岗位不降级为主 Agent',async()=>{
 const f=await setup();try{
  const original=await f.workspace.dispatchStore.read(),inherited=(await f.service.owners.discover([f.child])).groups[0];
  expect(inherited).toMatchObject({execution:'member',memberId:f.seed.positions[0].member.memberId});expect(inherited.selection!.expectedOwners[0].inheritedFrom).toBe(f.seed.modules[0]);expect(await f.workspace.dispatchStore.read()).toEqual(original);
  const identity={workspaceId:f.seed.entry.id,rootSessionId:'inherited-root'},scopeId='inherited-scope';await f.service.openScope(identity,scopeId,{message:'按父级继承执行'},'main-run');
  await f.service.goals.plan(identity,scopeId,'main-run','inherited-plan',{expectedRevision:1,objective:'核实继承模块',constraints:[],criteria:[{id:'c1',kind:'evidence',text:'真实读取'}],assignments:[{agentId:inherited.agentId!,moduleIds:[f.child],ownerSelection:inherited.selection!,criterionIds:['c1'],reason:'继承父模块岗位'}],reason:'保持父级职责'});
  const receipt=await f.service.dispatchTask({...identity,commandId:'inherited-dispatch',expectedParentRevision:1,task:{assigneeAgentId:inherited.agentId!,moduleIds:[f.child],ownerSelection:inherited.selection!,goal:'读取子模块资料',acceptance:[{id:'c1',text:'真实读取'}]}},scopeId),task=(await f.service.snapshot(identity)).tasks.find(t=>t.taskId===receipt.taskId)!;
  const second=f.seed.positions[1].member;await commitModuleOwnership(f.app,f.seed.entry.id,await moduleOwnershipChange(f.app,f.seed.entry.id,f.child,{memberId:second.memberId,expectedRevision:second.revision},'显式子模块覆盖父级'));
  const direct=(await f.service.owners.discover([f.child])).groups[0];expect(direct.memberId).toBe(second.memberId);expect(direct.selection!.expectedOwners[0].inheritedFrom).toBeUndefined();
  expect((await f.service.snapshot(identity)).tasks.find(t=>t.taskId===task.taskId)).toEqual(task);
  await f.app.models.remove(f.seed.profiles[2].id);const broken=(await f.service.owners.discover([f.child])).groups[0];expect(broken.execution).toBe('member');expect(broken.selection).toBeUndefined();expect(broken.issues.length).toBeGreaterThan(0);
 }finally{await f.cleanup()}
});
it('模型匹配形成可实际计划与派发的冻结选择，无责任写入；新知识使匹配失效，旧任务不改写',async()=>{
 const f=await setup();try{
  const snapshot=await f.workspace.snapshot(),before=await f.workspace.dispatchStore.read(),choice={knowledgeRevision:snapshot.revision,choices:[{moduleId:f.unassigned,memberId:f.seed.positions[0].member.memberId,reason:'根据模块正文与岗位能力匹配资料核实职责'}]};
  const matched=(await f.service.owners.discover([f.unassigned],choice)).groups[0];expect(matched.selection!.expectedOwners[0]).toMatchObject({match:{reason:choice.choices[0].reason,knowledgeRevision:snapshot.revision}});expect(await f.workspace.dispatchStore.read()).toEqual(before);
  const identity={workspaceId:f.seed.entry.id,rootSessionId:'matched-root'},scopeId='matched-scope';await f.service.openScope(identity,scopeId,{message:'根据模块职责匹配执行'},'main-run');
  await f.service.goals.plan(identity,scopeId,'main-run','matched-plan',{expectedRevision:1,objective:'核实匹配模块',constraints:[],criteria:[{id:'c1',kind:'evidence',text:'真实读取'}],assignments:[{agentId:matched.agentId!,moduleIds:[f.unassigned],ownerSelection:matched.selection!,criterionIds:['c1'],reason:choice.choices[0].reason}],reason:'模型依据当前知识匹配'});
  const receipt=await f.service.dispatchTask({...identity,commandId:'matched-dispatch',expectedParentRevision:1,task:{assigneeAgentId:matched.agentId!,moduleIds:[f.unassigned],ownerSelection:matched.selection!,goal:'读取模块资料',acceptance:[{id:'c1',text:'真实读取'}]}},scopeId),task=(await f.service.snapshot(identity)).tasks.find(t=>t.taskId===receipt.taskId)!;
  expect(ownerExecutionSelectionFor(task.ownerBinding!)).toEqual(matched.selection);expect((await f.workspace.dispatchStore.read()).moduleOwnerships).toEqual(before.moduleOwnerships);
  await f.workspace.commit(request(await f.workspace.snapshot(),[{path:'.cbim/README.md',text:'# 知识已变更'}]));
  await expect(f.service.owners.discover([f.unassigned],choice)).rejects.toMatchObject({code:'OWNER_MATCH_STALE'});expect((await f.service.snapshot(identity)).tasks.find(t=>t.taskId===task.taskId)).toEqual(task);
  const fresh=await f.workspace.snapshot();expect((await f.service.owners.discover([f.unassigned],{knowledgeRevision:fresh.revision,choices:[{moduleId:f.unassigned,memberId:null,reason:'当前无适合的岗位'}]})).groups[0]).toMatchObject({execution:'main',agentId:'cbim:main'});
 }finally{await f.cleanup()}
});
