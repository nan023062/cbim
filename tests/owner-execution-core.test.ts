import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {ownerExecutionBindingSchema,ownerExecutionSelectionSchema,ownerExecutionSelectionFor,ownerExecutionSelectionMatches,ownerExecutionBindingMatches,sameOwnerExecutionForModules} from '../src/backend/core/team/member-execution-binding';
import {assertCurrentOwnerExecutionBinding,resolveOwnerExecutionSelection} from '../src/backend/core/team/member-execution-rules';
import {validateOwnerExecutionMutation} from '../src/backend/core/tasks/owner-execution-invariants';
import {dispatchTaskInput} from '../src/backend/core/tasks/dispatch-commands';
import {goalPlanInputSchema,dispatchScopeGoalSchema} from '../src/backend/core/tasks/scope-goal';
import {dispatchKnowledgeFingerprint,validatePreparedDispatchKnowledge} from '../src/backend/core/tasks/execution-context';
import {humanContinuationSubject} from '../src/backend/core/tasks/human-continue';
import {applyGraphBatch} from '../src/backend/core/tasks/graph-reducer';
import {validateWorkflowEvidence} from '../src/backend/core/tasks/workflow-evidence';
import {TaskProgressTools} from '../src/backend/core/tasks/progress-tools';
import {toolReceipt} from '../src/backend/core/tools/receipts';
import type {ArtifactEvidenceEvent} from '../src/backend/core/tasks/artifact-evidence';
import type {ToolDecision} from '../src/backend/core/tools/types';
import type {WorkflowContractBinding} from '../src/backend/core/tasks/execution-context';
import type {DispatchState,DispatchMutation} from '../src/backend/core/tasks/dispatch-storage';
import {registry,registryApply,memberEvent,ownershipEvent,bindingFor,ws,identity,moduleId,agentId,model,task,rootMutation,taskMutation,plannedScope,prepared,claimMutation} from './owner-execution-core-fixture';

const graphState=(state:DispatchState,bound=true):DispatchState=>{
  const root=rootMutation(),first=applyGraphBatch(undefined,root.batch!),addition=taskMutation(bound?bindingFor(state):undefined);return {...state,members:[...root.members!,...addition.members!],sessions:[...root.sessions!,...addition.sessions!],graphs:[applyGraphBatch(first,addition.batch!)],outbox:addition.messages!,scopes:[plannedScope(bound?bindingFor(state):undefined)],runs:[]};
};

it('选择只含预期，绑定精确限定workspace/Agent/逐模块，不接凭据或模型证明',()=>{
  const {binding}=registry(),selection=ownerExecutionSelectionFor(binding);
  expect(ownerExecutionSelectionMatches(selection,binding)).toBe(true);expect(ownerExecutionBindingMatches(binding,ws,agentId,[moduleId])).toBe(true);
  for(const bad of [{...selection,model},{...selection,expectedOwners:[...selection.expectedOwners,...selection.expectedOwners]},{...selection,expectedOwners:[{...selection.expectedOwners[0],ownerMemberId:randomUUID()}]}])expect(ownerExecutionSelectionSchema.safeParse(bad).success).toBe(false);
  for(const bad of [{...binding,workspaceId:'other'},{...binding,capability:{...binding.capability,agentId:'cbim:main'}},{...binding,model:{...binding.model,apiKey:'secret'}},{...binding,owners:[{...binding.owners[0],moduleId:moduleId+'/child'}]}])expect(ownerExecutionBindingSchema.safeParse(bad).success).toBe(false);
  expect(ownerExecutionBindingMatches(binding,ws,agentId,[moduleId,moduleId])).toBe(false);expect(ownerExecutionBindingMatches(binding,ws,agentId,[moduleId+'/child'])).toBe(false);
});

it('同一静态Agent两个岗位保留独立member/model/适配，模块责任不得隐式继承或混用',()=>{
  const f=registry();let state=f.state;const second=memberEvent(state,undefined,{...model,id:randomUUID(),model:'second-model'});state=registryApply(state,second);state=registryApply(state,ownershipEvent(state,second.event.next.memberId,moduleId+'/other'));
  const b=bindingFor(state,[moduleId+'/other']);expect(b.capability.agentId).toBe(f.binding.capability.agentId);expect(b.memberId).not.toBe(f.binding.memberId);expect(b.model).not.toEqual(f.binding.model);
  expect(()=>resolveOwnerExecutionSelection(state,{...ownerExecutionSelectionFor(f.binding),expectedOwners:[...ownerExecutionSelectionFor(f.binding).expectedOwners,...ownerExecutionSelectionFor(b).expectedOwners]},[moduleId,moduleId+'/other'])).toThrow();
  expect(()=>resolveOwnerExecutionSelection(state,ownerExecutionSelectionFor(f.binding),[moduleId+'/child'])).toThrow();expect(sameOwnerExecutionForModules(f.binding,b,[moduleId])).toBe(false);
});

it('同岗位多模块选择精确匹配，计划子集只比较真实对应责任而缺省不是通配',()=>{
  const f=registry(),state=registryApply(f.state,ownershipEvent(f.state,f.binding.memberId,moduleId+'/other')),all=bindingFor(state,[moduleId,moduleId+'/other']);
  const selection=ownerExecutionSelectionFor(all);selection.expectedOwners.reverse();expect(ownerExecutionSelectionMatches(selection,all)).toBe(true);
  expect(sameOwnerExecutionForModules(all,f.binding,[moduleId])).toBe(true);expect(sameOwnerExecutionForModules(undefined,f.binding,[moduleId])).toBe(false);expect(sameOwnerExecutionForModules(undefined,undefined,[moduleId])).toBe(true);
  expect(()=>resolveOwnerExecutionSelection(state,ownerExecutionSelectionFor(all),[moduleId])).toThrow();
});

it('通用Store新任务不能缩减目标分配模块，既有任务领取保留原模块投影',()=>{
  const f=registry(),state=registryApply(f.state,ownershipEvent(f.state,f.binding.memberId,moduleId+'/other'));
  const all=bindingFor(state,[moduleId,moduleId+'/other']),existing=graphState(state),assignment=existing.scopes![0].goal!.plan!.assignments[0];
  Object.assign(assignment,{moduleIds:[moduleId,moduleId+'/other'],moduleNames:['Game','Other'],ownerSelection:ownerExecutionSelectionFor(all),ownerBinding:all});
  const before=structuredClone(existing);before.graphs[0].tasks=[];
  expect(()=>validateOwnerExecutionMutation(before,existing,{receipt:null},'module_owner_v1')).toThrow(/当前目标计划/);
  const exact=structuredClone(existing),target=exact.graphs[0].tasks[0];target.ownerBinding=all;target.modules.push({...target.modules[0],moduleId:moduleId+'/other',name:'Other'});
  expect(()=>validateOwnerExecutionMutation(before,exact,{receipt:null},'module_owner_v1')).not.toThrow();
  const claim=claimMutation(existing);expect(()=>validateOwnerExecutionMutation(existing,{...existing,runs:claim.runs},claim,'module_owner_v1')).not.toThrow();
});

it('成员暂停/版本/模型更新，关系A→B→A和同路径新代次均使旧选择失效',()=>{
  const f=registry();let state=registryApply(f.state,memberEvent(f.state,{kind:'state',memberId:f.binding.memberId,expectedRevision:1,nextState:'suspended',reason:'pause'}));
  expect(()=>assertCurrentOwnerExecutionBinding(state,f.binding,[moduleId])).toThrow(/暂停/);
  state=registryApply(f.state,memberEvent(f.state,{kind:'update',memberId:f.binding.memberId,expectedRevision:1,patch:{name:'Changed'},reason:'rename'}));expect(()=>assertCurrentOwnerExecutionBinding(state,f.binding,[moduleId])).toThrow(/变化/);
  state=registryApply(f.state,memberEvent(f.state,{kind:'adopt',memberId:f.binding.memberId,expectedRevision:1,target:'model',reason:'Adopt model'},{...model,maxTokens:model.maxTokens+1}));expect(()=>assertCurrentOwnerExecutionBinding(state,f.binding,[moduleId])).toThrow();
  const second=memberEvent(f.state);state=registryApply(f.state,second);state=registryApply(state,ownershipEvent(state,second.event.next.memberId));state=registryApply(state,ownershipEvent(state,f.binding.memberId));expect(state.moduleOwnerships![0].revision).toBe(3);expect(()=>assertCurrentOwnerExecutionBinding(state,f.binding,[moduleId])).toThrow(/变化/);
  const replaced=structuredClone(f.state);replaced.knowledgeSourceGenerations!.find(source=>source.source.kind==='module')!.generationId=randomUUID();expect(()=>assertCurrentOwnerExecutionBinding(replaced,f.binding,[moduleId])).toThrow(/来源/);
});

it('pending、未采纳和缺责任拒绝新许可，但不会改写旧绑定',()=>{
  const f=registry(),before=structuredClone(f.binding);
  const noSource=structuredClone(f.state);delete noSource.workspaceMembers![0].adoption.sourceRef;expect(()=>assertCurrentOwnerExecutionBinding(noSource,f.binding,[moduleId])).toThrow(/采纳/);
  const noOwner={...f.state,moduleOwnerships:[]};expect(()=>assertCurrentOwnerExecutionBinding(noOwner,f.binding,[moduleId])).toThrow(/负责人/);
  const pending={...f.state,knowledgeSourceTransitions:[{state:'pending'} as NonNullable<DispatchState['knowledgeSourceTransitions']>[number]]};expect(()=>assertCurrentOwnerExecutionBinding(pending,f.binding,[moduleId])).toThrow(/待核实/);
  expect(f.binding).toEqual(before);
});

it('输入兼容原命令缺省以查回执，主治理禁止选择；历史持久计划无字段保留原形',()=>{
  const f=registry(),plan=plannedScope(f.binding).goal!.plan!,{revision,runId,recordedAt,knowledgeRevision,graphCursor,...body}=plan;
  const {agentName,teamId,moduleNames,ownerBinding,...assignment}=body.assignments[0],input={...body,expectedRevision:1,assignments:[assignment]};
  expect(goalPlanInputSchema.safeParse(input).success).toBe(true);expect(goalPlanInputSchema.safeParse({...input,assignments:[{...assignment,ownerSelection:undefined}]}).success).toBe(true);
  expect(goalPlanInputSchema.safeParse({...input,assignments:[{...assignment,agentId:'cbim:main'}]}).success).toBe(false);
  expect(goalPlanInputSchema.safeParse({...input,assignments:[{...assignment,agentId:'cbim:main',ownerSelection:undefined}]}).success).toBe(true);
  const old=plannedScope().goal!;expect(dispatchScopeGoalSchema.parse(old)).toEqual(old);expect(dispatchScopeGoalSchema.safeParse({...old,plan:{...old.plan,assignments:[{...old.plan!.assignments[0],ownerBinding:f.binding}]}}).success).toBe(false);
  const base={...identity,commandId:'new',expectedParentRevision:1,task:{assigneeAgentId:agentId,moduleIds:[moduleId],goal:'Build',acceptance:[{id:'done',text:'Works'}],prerequisites:[],ownerSelection:ownerExecutionSelectionFor(f.binding)}};
  expect(dispatchTaskInput.safeParse(base).success).toBe(true);expect(dispatchTaskInput.safeParse({...base,task:{...base.task,ownerSelection:undefined}}).success).toBe(true);
});

it('任务绑定创建后不可增删修改；新计划/新任务/新领取通过完整原登记审计',()=>{
  const f=registry(),previous=graphState(f.state),next=structuredClone(previous),t=next.graphs[0].tasks[0];
  expect(()=>validateOwnerExecutionMutation(previous,next,{receipt:null},'module_owner_v1')).not.toThrow();
  delete t.ownerBinding;expect(()=>validateOwnerExecutionMutation(previous,next,{receipt:null},'module_owner_v1')).toThrow(/不能/);
  const legacy=graphState(f.state,false),upgraded=structuredClone(legacy);upgraded.graphs[0].tasks[0].ownerBinding=f.binding;expect(()=>validateOwnerExecutionMutation(legacy,upgraded,{receipt:null},'legacy')).toThrow(/不能/);
  const claimed=claimMutation(previous),after={...previous,runs:claimed.runs};expect(()=>validateOwnerExecutionMutation(previous,after,claimed,'module_owner_v1')).not.toThrow();
  const noAudit={...after,workspaceMemberChanges:[]};expect(()=>validateOwnerExecutionMutation(previous,noAudit,claimed,'module_owner_v1')).toThrow(/审计/);
  const fake=structuredClone(claimed);fake.runs![0].model.maxTokens=500;expect(()=>validateOwnerExecutionMutation(previous,{...after,runs:fake.runs},fake,'module_owner_v1')).toThrow(/模型/);
});

it('当前不变量阻止旧任务领取/预约和过期输入计划，旧已领取结算不重核当前岗位',()=>{
  const f=registry(),legacy=graphState(f.state,false),newClaim=claimMutation(legacy);expect(()=>validateOwnerExecutionMutation(legacy,{...legacy,runs:newClaim.runs},newClaim,'module_owner_v1')).toThrow(/旧任务/);
  const previous=graphState(f.state),claim=claimMutation(previous),running={...previous,runs:claim.runs},paused=registryApply(running,memberEvent(running,{kind:'state',memberId:f.binding.memberId,expectedRevision:1,nextState:'suspended',reason:'Pause'}));
  expect(()=>validateOwnerExecutionMutation(paused,paused,{runs:[{...paused.runs![0],status:'cancelled'}],receipt:null},'module_owner_v1')).not.toThrow();
  const stale=structuredClone(previous);stale.scopes![0].goal!.inputRevision=2;stale.scopes![0].goal!.revision=3;expect(()=>validateOwnerExecutionMutation(stale,{...stale,runs:claim.runs},claim,'module_owner_v1')).toThrow(/当前/);
  const request=structuredClone(previous);request.graphs[0].tasks[0].resumeRequest={} as NonNullable<ReturnType<typeof task>['resumeRequest']>;expect(()=>validateOwnerExecutionMutation({...paused,runs:[]},{...request,workspaceMembers:paused.workspaceMembers,workspaceMemberChanges:paused.workspaceMemberChanges},{receipt:null},'module_owner_v1')).toThrow(/暂停/);
  // 已有消费历史不能豁免下一段的新预约；单纯保留历史也不能反过来使旧结算失效。
  const history=structuredClone(paused);history.graphs[0].tasks[0].resumeRequest={requestId:'consumed-reservation'} as NonNullable<ReturnType<typeof task>['resumeRequest']>;
  expect(()=>validateOwnerExecutionMutation(history,history,{receipt:null},'module_owner_v1')).not.toThrow();
  const nextReservation=structuredClone(history);nextReservation.graphs[0].tasks[0].resumeRequest!.requestId='next-reservation';
  expect(()=>validateOwnerExecutionMutation(history,nextReservation,{receipt:null},'module_owner_v1')).toThrow(/暂停/);
});

it('新计划缺选择不能借兼容schema保存，历史原计划不变仍能读取',()=>{
  const f=registry(),state=graphState(f.state,false),next=structuredClone(state);next.scopes![0].goal!.revision=3;next.scopes![0].goal!.plan!.revision=3;
  expect(()=>validateOwnerExecutionMutation(state,next,{scopes:next.scopes,receipt:null},'module_owner_v1')).toThrow(/选择与可信绑定/);
  expect(()=>validateOwnerExecutionMutation(state,state,{receipt:null},'module_owner_v1')).not.toThrow();
});

it('冻结上下文与human业务主体包含真实岗位，旧无字段proof不补造',()=>{
  const f=registry(),context=prepared(f.binding);expect(()=>validatePreparedDispatchKnowledge(context)).not.toThrow();
  const wrong=structuredClone(context);wrong.memberContext!.binding.capability.capabilityHash='a'.repeat(64);wrong.fingerprint=dispatchKnowledgeFingerprint(wrong);expect(()=>validatePreparedDispatchKnowledge(wrong)).toThrow();
  for(const edit of [(value:typeof context)=>{value.agent.principles+=' unadopted'},(value:typeof context)=>{value.agent.effectiveSkills[0].content='different skill'}]){const fake=structuredClone(context);edit(fake);fake.fingerprint=dispatchKnowledgeFingerprint(fake);expect(()=>validatePreparedDispatchKnowledge(fake)).toThrow(/能力正文/)}
  const subject=humanContinuationSubject(plannedScope(f.binding).goal!.plan!),old=humanContinuationSubject(plannedScope().goal!.plan!);expect(subject.assignments[0].ownerBinding).toEqual(f.binding);expect(old.assignments[0]).not.toHaveProperty('ownerBinding');
  const newBinding=structuredClone(f.binding);newBinding.memberRevision++;expect(humanContinuationSubject(plannedScope(newBinding).goal!.plan!)).not.toEqual(subject);
});

it('岗位名称按原审计固定，不接受以当前改名或静态角色名称替换历史负责人',()=>{
  const f=registry(),state=graphState(f.state);
  const taskBad=structuredClone(state);taskBad.graphs[0].tasks[0].assignee.name='Static agent';expect(()=>validateOwnerExecutionMutation(state,taskBad,{receipt:null},'module_owner_v1')).toThrow(/原登记岗位名称/);
  const planBad=structuredClone(state);planBad.scopes![0].goal!.plan!.assignments[0].agentName='Current job name';expect(()=>validateOwnerExecutionMutation(state,planBad,{receipt:null},'module_owner_v1')).toThrow(/原登记岗位名称/);
  const renamed=registryApply(state,memberEvent(state,{kind:'update',memberId:f.binding.memberId,expectedRevision:1,patch:{name:'Current job name'},reason:'Rename'}));expect(()=>validateOwnerExecutionMutation(state,renamed,{receipt:null},'module_owner_v1')).not.toThrow();
});

it('通用mutation不能自选legacy协议，历史绑定引用仍拒绝跨workspace伪造',()=>{
  const f=registry(),state=graphState(f.state);expect(()=>validateOwnerExecutionMutation(state,state,{receipt:null,executionProtocol:'legacy'} as DispatchMutation,'module_owner_v1')).toThrow(/协议/);
  const bad=structuredClone(state);bad.graphs[0].tasks[0].ownerBinding!.workspaceId='other';expect(()=>validateOwnerExecutionMutation(state,bad,{receipt:null},'legacy')).toThrow();
});

it('真实进度工具形成的canonical只能证明其原岗位任务，不能删绑定或换成同Agent另一岗位',async()=>{
  const f=registry(),id={workspaceId:ws,taskId:'task',runId:'run'},spec={workspaceId:ws,taskId:'task',goal:'Build',acceptance:['Works'],ownerBinding:f.binding};
  const contracts:WorkflowContractBinding[]=[{moduleId,workflowId:'workflow',workflowVersion:'v1',contract:{version:1,delivery:{requiredToolEvidence:[{id:'read',toolName:'read'}]}}}],events:ArtifactEvidenceEvent[]=[];
  const emit=(type:string,data:Record<string,unknown>)=>events.push({...id,seq:events.length+1,type,data:structuredClone(data)});emit('run.started',{task:spec,workflowContracts:contracts});
  const progress=new TaskProgressTools(undefined,async value=>{emit('task.updated',{progress:value})},{identity:id,artifacts:()=>[],workflow:{bindings:contracts,task:spec,identity:id}});
  const call=async(name:string,input:Record<string,unknown>)=>{const c={id:name,name,input},auth:ToolDecision={allow:true,effects:name==='read'?['read']:['maintenance'],scope:{kind:'workspace',workspaceId:ws}};emit('tool.proposed',c);emit('tool.allowed',{...c,...auth});const generation=progress.generation,result=name==='read'?{content:[{type:'text',text:'actual bytes'}]}:await progress.call(name,input);const receipt=toolReceipt(id,c,auth,'succeeded',result);emit('tool.finished',{id:c.id,name,result,receipt});progress.record(receipt,generation)};
  await call('cbim_task_plan',{expectedVersion:0,goal:'Build',acceptance:['Works'],reason:'Plan',steps:[{id:'one',title:'Read',owner:'executor'}]});await call('read',{path:'result.txt'});await call('cbim_task_step',{expectedVersion:1,id:'one',state:'reported_done',evidenceIds:['read']});await call('cbim_delivery_prepare',{expectedVersion:2,summary:'Read actual artifact',limitations:[]});emit('run.settled',{status:'completed'});
  expect(validateWorkflowEvidence(events,spec,contracts)?.checks).toHaveLength(1);
  const missing=structuredClone(events);delete (missing[0].data.task as Record<string,unknown>).ownerBinding;expect(()=>validateWorkflowEvidence(missing,spec,contracts)).toThrow(/冻结岗位/);
  const other=structuredClone(spec);other.ownerBinding.memberId=randomUUID();expect(()=>validateWorkflowEvidence(events,other,contracts)).toThrow(/冻结岗位/);
});
