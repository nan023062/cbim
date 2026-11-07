import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {randomUUID} from 'node:crypto';
import type {DispatchScope,TaskNode} from '../src/bridge/contracts/dispatch';
import type {OwnerExecutionBinding,TaskOwnerInspectOutput} from '../src/bridge/contracts/owner-execution';
import {ownerExecutionSelectionFor} from '../src/backend/core/team/member-execution-binding';
import {summarizeScope} from '../src/backend/core/tasks/scope-view';
import {ownerTaskView,checkedOwnerInspection,OwnerInspectionController} from '../src/frontend/tasks/owner-execution-state';
import {MemberOwnerNotice,OwnerExecutionDetails} from '../src/frontend/tasks/OwnerExecutionDetails';
import {MemberTaskDetail} from '../src/frontend/tasks/MemberTaskDetail';
import {MemberActivity} from '../src/frontend/tasks/MemberActivity';
import {ScopeGoalPanel} from '../src/frontend/tasks/ScopeGoalPanel';
import {scopeGoalView,type ScopeGoalState} from '../src/frontend/tasks/scope-state';
import {OwnerExecutionInspection} from '../src/frontend/tasks/OwnerExecutionInspection';

const identity={workspaceId:'workspace-one',rootSessionId:'main-session'},time='2026-11-08T00:00:00.000Z',moduleId='.cbim/workspace/game',agentId='.cbim/team/developer',teamId='.cbim/team',hash='a'.repeat(64);
function task():TaskNode {
  const memberId=randomUUID();
  const ownerBinding:OwnerExecutionBinding={version:1,workspaceId:identity.workspaceId,memberId,memberRevision:3,memberHash:hash,capability:{agentId,teamId,captureId:randomUUID(),capabilityHash:hash,sourceRef:{version:1,workspaceId:identity.workspaceId,source:{kind:'agent',sourceId:agentId},generationId:randomUUID()}},model:{profileId:randomUUID(),modelId:'member-model-alpha',configurationHash:hash},owners:[{moduleId,bindingId:randomUUID(),revision:2,ownerMemberId:memberId,sourceRef:{version:1,workspaceId:identity.workspaceId,source:{kind:'module',sourceId:moduleId},generationId:randomUUID()}}]};
  return {kind:'task',nodeId:'task:task-one',taskId:'task-one',identity,scopeId:'scope-one',requester:{agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-channel',name:'主 Agent'},assignee:{agentId,agentInstanceId:'execution-instance',agentSessionId:'execution-channel',name:'原网页工程岗位'},ownerBinding,modules:[{moduleId,name:'网页模块',knowledgeRevision:hash,maintenanceBindingId:'human-maintenance',maintainerPersonIds:['person'],workflow:{kind:'general',id:'general',version:'1',reason:'通用流程'}}],goal:'实现并验证网页',acceptance:[{id:'c1',text:'真实验证'}],revision:1,planRevision:1,status:'queued',awaitedChildren:[],runIds:[],createdAt:time,updatedAt:time};
}
const notice=(value:TaskNode)=>renderToStaticMarkup(createElement(MemberOwnerNotice,{task:value}));

it('原岗位与模型按派发绑定显示，同Agent另一岗位不覆盖原名字和配置',()=>{
  const a=task(),b=task();b.assignee={...b.assignee,name:'另一项目岗位'};b.ownerBinding!.model.modelId='member-model-beta';
  const before=JSON.stringify(a),html=notice(a);
  expect(ownerTaskView(a).kind).toBe('bound');expect(html).toContain(a.ownerBinding!.memberId);expect(html).toContain('member-model-alpha');expect(html).toContain('责任第 2 版');expect(html).toContain('岗位第 3 版');
  expect(html).not.toContain('member-model-beta');expect(html).not.toContain(b.ownerBinding!.memberId);expect(JSON.stringify(a)).toBe(before);
  expect(notice(b)).toContain('member-model-beta');expect(notice(b)).not.toContain(a.ownerBinding!.memberId);
});

it('跨工作区、角色、模块以及损坏绑定拒绝展示，错误来源不冒充历史',()=>{
  const base=task();
  const variants:TaskNode[]=[{...base,identity:{...identity,workspaceId:'foreign'}},{...base,assignee:{...base.assignee,agentId:'foreign'}},{...base,modules:[]},{...base,modules:[...base.modules,...base.modules]},{...base,ownerBinding:{...base.ownerBinding!,memberRevision:0}},{...base,ownerBinding:null as unknown as OwnerExecutionBinding}];
  for(const value of variants){expect(ownerTaskView(value).kind).toBe('invalid');const html=notice(value);expect(html).toContain('owner-binding-invalid');expect(html).not.toContain('member-model-alpha');expect(html).not.toContain('owner-binding-legacy')}
});

it('旧待办和检查点提示重规划，在途与候选保留历史含义，不自动补绑定',()=>{
  const value=task();delete value.ownerBinding;
  for(const status of ['planned','queued','waiting','checkpointed'] as const){const old={...value,status};expect(ownerTaskView(old)).toEqual({kind:'legacy',needsReplan:true});expect(notice(old)).toContain('不能新领取或续执行')}
  for(const status of ['running','result_ready','failed','cancelled','interrupted','blocked'] as const){const old={...value,status};expect(ownerTaskView(old)).toEqual({kind:'legacy',needsReplan:false});expect(notice(old)).not.toContain('不能新领取或续执行');expect(notice(old)).not.toContain('执行失败')}
  expect(ownerTaskView({...value,activeRunId:'in-flight'})).toEqual({kind:'legacy',needsReplan:false});expect(value).not.toHaveProperty('ownerBinding');
});

it('内置能力明确显示系统来源，不伪造项目代次；额外字段不会进入界面',()=>{
  const value=task();value.assignee.agentId='cbim:executor';value.ownerBinding!.capability={...value.ownerBinding!.capability,agentId:'cbim:executor',sourceRef:{kind:'builtin',id:'cbim:executor',contentHash:hash}};
  expect(notice(value)).toContain('系统内置执行能力');
  const bad=structuredClone(value);Object.assign(bad.ownerBinding!.model,{apiKey:'do-not-display'});expect(notice(bad)).toContain('owner-binding-invalid');expect(notice(bad)).not.toContain('do-not-display');
});

it('主对话和任务详情同一原署名、模型，错误会话不展示敏感任务事实',()=>{
  const value=task(),before=JSON.stringify(value);
  for(const html of [renderToStaticMarkup(createElement(MemberActivity,{...identity,tasks:[value],onSelectTask:()=>{}})),renderToStaticMarkup(createElement(MemberTaskDetail,{...identity,task:value}))]){expect(html).toContain('原网页工程岗位');expect(html).toContain('member-model-alpha');expect(html).toContain('data-member-id="'+value.ownerBinding!.memberId+'"')}
  const foreign=renderToStaticMarkup(createElement(MemberTaskDetail,{...identity,workspaceId:'foreign',task:value}));expect(foreign).not.toContain('member-model-alpha');expect(foreign).not.toContain(value.ownerBinding!.memberId);expect(JSON.stringify(value)).toBe(before);
});

it('目标分配显示同一冻结岗位；主治理和旧分配不被猜成当前负责人',()=>{
  const value=task(),binding=value.ownerBinding!;
  const scope:DispatchScope={scopeId:'scope-one',...identity,status:'active',createdAt:time,goal:{revision:2,input:{message:'实现网页',attachmentIds:[]},plan:{revision:2,runId:'main-run',recordedAt:time,knowledgeRevision:hash,graphCursor:{streamId:'graph-stream',seq:1},objective:'实现网页',constraints:[],criteria:[{id:'c1',kind:'evidence',text:'真实验证'}],assignments:[{agentId,teamId,agentName:value.assignee.name,moduleIds:[moduleId],moduleNames:['网页模块'],criterionIds:['c1'],reason:'依当前模块负责人安排',ownerSelection:ownerExecutionSelectionFor(binding),ownerBinding:binding}],reason:'负责岗位计划'}}};
  const render=(current:DispatchScope)=>{const summary=summarizeScope(current,'scope-stream',1),view=scopeGoalView(summary);const state:ScopeGoalState={scopes:[summary],selectedScopeId:current.scopeId,selectedScope:current,openScope:summary,activeScope:summary,selectedGoalView:view,currentGoalView:view,loading:false,detailLoading:false,error:'',selectScope:()=>{}};return renderToStaticMarkup(createElement(ScopeGoalPanel,{state}))};
  expect(render(scope)).toContain(binding.memberId);expect(render(scope)).toContain('member-model-alpha');expect(render(scope)).not.toContain('goal-owner-legacy');
  const old=structuredClone(scope);delete old.goal!.plan!.assignments[0].ownerBinding;delete old.goal!.plan!.assignments[0].ownerSelection;expect(render(old)).toContain('goal-owner-legacy');expect(render(old)).not.toContain(binding.memberId);
  old.goal!.plan!.assignments[0]={agentId:'cbim:main',teamId,agentName:'主 Agent',moduleIds:[],moduleNames:[],criterionIds:['c1'],reason:'治理知识'};expect(render(old)).not.toContain('goal-owner-legacy');expect(render(old)).not.toContain('owner-execution-binding');
});

it('纯绑定详情不建立执行、采纳、配置修改或外部查询操作',()=>{
  const value=task(),html=renderToStaticMarkup(createElement(OwnerExecutionDetails,{binding:value.ownerBinding!,workspaceId:identity.workspaceId,agentId,moduleIds:[moduleId]}));
  expect(html).not.toMatch(/<(button|input|form)\b/);expect(html).toContain('原派发记录');expect(html).toContain('新领取仍须由调度系统重新核实');
});

function inspected(value:TaskNode):TaskOwnerInspectOutput {
  const binding=value.ownerBinding!;return {identity:value.identity,taskId:value.taskId,taskRevision:value.revision,ownerBinding:structuredClone(binding),current:{workspaceId:value.identity.workspaceId,instanceId:'live-instance',readOnly:true,checkedAt:time,knowledgeRevision:hash,registryCursor:null,ownershipCursor:null,sourceCursor:null,moduleIds:value.modules.map(module=>module.moduleId),groups:[{moduleIds:value.modules.map(module=>module.moduleId),memberId:binding.memberId,memberName:'当前已核实岗位',agentId:value.assignee.agentId,selection:ownerExecutionSelectionFor(binding),issues:[]}]}};
}

it('当前核实比较岗位/责任/能力和模型，缺口与变更区分，旧记录不会被补绑定',()=>{
  const value=task(),report=inspected(value);
  expect(checkedOwnerInspection(report,value).comparison).toBe('matching');
  for(const modify of [(r:TaskOwnerInspectOutput)=>r.current.groups[0].selection!.expectedMemberRevision++,(r:TaskOwnerInspectOutput)=>r.current.groups[0].selection!.expectedOwners[0].revision++,(r:TaskOwnerInspectOutput)=>{r.current.groups[0].selection!.expectedCapabilityHash='b'.repeat(64)},(r:TaskOwnerInspectOutput)=>{r.current.groups[0].selection!.expectedConfigurationHash='b'.repeat(64)}]){const changed=structuredClone(report);modify(changed);expect(checkedOwnerInspection(changed,value).comparison).toBe('changed')}
  const unavailable=structuredClone(report);delete unavailable.current.groups[0].selection;unavailable.current.groups[0].issues=[{code:'SOURCE_PENDING',message:'来源仍待原事务核实'}];expect(checkedOwnerInspection(unavailable,value)).toMatchObject({comparison:'unavailable',issues:['来源仍待原事务核实']});
  const legacy=structuredClone(value),legacyReport=structuredClone(report);delete legacy.ownerBinding;delete legacyReport.ownerBinding;expect(checkedOwnerInspection(legacyReport,legacy).comparison).toBe('legacy');expect(legacy).not.toHaveProperty('ownerBinding');
});

it('当前核实拒绝跨身份、旧任务版本、换原绑定、模块缺失以及额外私有字段',()=>{
  const value=task(),base=inspected(value);
  for(const modify of [(r:TaskOwnerInspectOutput)=>{r.identity.rootSessionId='other'},(r:TaskOwnerInspectOutput)=>{r.taskId='other'},(r:TaskOwnerInspectOutput)=>r.taskRevision++,(r:TaskOwnerInspectOutput)=>r.ownerBinding!.memberRevision++,(r:TaskOwnerInspectOutput)=>{r.current.workspaceId='other'},(r:TaskOwnerInspectOutput)=>{r.current.moduleIds=['other']},(r:TaskOwnerInspectOutput)=>{Object.assign(r.current,{apiKey:'never-render'})}]){const invalid=structuredClone(base);modify(invalid);expect(()=>checkedOwnerInspection(invalid,value)).toThrow()}
});

it('核实按点击执行，重复点击合并；任务切换/版本变化隔离迟到结果',async()=>{
  const a=task(),b=task();b.taskId='task-two';let calls=0;let release!:(value:unknown)=>void;
  const controller=new OwnerInspectionController(a,()=>{calls++;return new Promise(resolve=>{release=resolve})});
  expect(calls).toBe(0);const first=controller.inspect(),second=controller.inspect();expect(first).toBe(second);await Promise.resolve();expect(calls).toBe(1);
  controller.observe(b);release(inspected(a));await first;expect(controller.snapshot.view).toBeUndefined();expect(controller.snapshot.loading).toBe(false);
  const third=controller.inspect();await Promise.resolve();expect(calls).toBe(2);controller.observe({...b,revision:2});release(inspected(b));await third;expect(controller.snapshot.view).toBeUndefined();expect(controller.snapshot.error).toBeUndefined();controller.dispose();
});

it('同版本读取失败保留旧观察并显示错误；卸载不发布迟到结果',async()=>{
  const value=task();let calls=0;
  const controller=new OwnerInspectionController(value,async()=>{if(++calls===1)return inspected(value);throw Error('通信中断，请重试读取')});
  await controller.inspect();const prior=controller.snapshot.view;await controller.inspect();expect(controller.snapshot.view).toBe(prior);expect(controller.snapshot.error).toContain('通信中断');
  let release!:(value:unknown)=>void,notifications=0;const late=new OwnerInspectionController(value,()=>new Promise(resolve=>{release=resolve}));late.subscribe(()=>notifications++);const pending=late.inspect();await Promise.resolve();late.dispose();const count=notifications;release(inspected(value));await pending;expect(notifications).toBe(count);controller.dispose();
});

it('核实表单初次只显示读取入口，没有假当前结论或自动重派动作',()=>{
  const value=task(),html=renderToStaticMarkup(createElement(OwnerExecutionInspection,{task:value}));expect(html).toContain('核实当前负责人配置');expect(html).not.toContain('data-comparison');expect(html).not.toContain('当前已核实岗位');expect(html).not.toMatch(/>(开始执行|重新派发|确认采纳)</);
});
