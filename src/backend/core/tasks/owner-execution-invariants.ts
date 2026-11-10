/**
 * 自动分支核可信原周期和独立绑定，首次计划、派发及领取复核当前无人负责；历史结算不受后来登记影响。
 * 首次新增及后续段预约均重核当前岗位；首次出现即触发检查，不依靠其它结构校验补出请求 ID。
 * 作用定位：校验负责人协议下的新计划、任务、前置增删闭包、预约和领取，以及历史冻结身份。
 * 设计原因：Store 的新旧日志协议决定新增许可；不能以旧缺省、新 cause 或通用 mutation 绕过负责人，也不能用今日换人否定旧运行结算。
 * 职责边界：不读取知识或模型队列；外部内容时效由服务持锁复验，此处核同一登记前缀及全部跨对象引用。
 */
import {assertAutomaticExecution} from './automatic-execution-rules';
import {sameAutomaticExecutionForModules} from '../team/automatic-execution';
import {fail} from '../foundation/errors';
import {ownerExecutionBindingMatches,ownerExecutionSelectionMatches,sameOwnerExecutionForModules,type OwnerExecutionBinding} from '../team/member-execution-binding';
import {assertCurrentOwnerExecutionBinding} from '../team/member-execution-rules';
import {workspaceMemberHash,workspaceMemberModelHash,workspaceMemberCanonical} from '../team/workspace-member-rules';
import type {DispatchState,DispatchMutation} from './dispatch-storage';
import type {TaskNode} from './graph-types';
import {goalNeedsReplan} from './scope-goal';
import {sameWorkflowSelectionsForModules} from './workflow-selection';
import {scopeHasUnresolvedActiveInput} from './scope-active-input';
import {knowledgeSourceRef} from '../workspace/knowledge-source-rules';

/** 仅 Store 从自己的日志信封给出；不接收客户端、mutation 或知识来源游标推测的版本。 */
export type DispatchExecutionProtocol='legacy'|'module_owner_v1';
const equal=(a:unknown,b:unknown)=>workspaceMemberCanonical(a)===workspaceMemberCanonical(b);
function check(value:unknown,message:string,code='OWNER_BINDING_INVALID'):asserts value{if(!value)fail(code,message)}
const taskAt=(state:DispatchState,task:Pick<TaskNode,'identity'|'taskId'>)=>state.graphs.find(graph=>graph.identity.rootSessionId===task.identity.rootSessionId)?.tasks.find(value=>value.taskId===task.taskId);
/** 历史关联按原登记事件核验，不重新要求当前 owner active/current。 */
function historical(state:DispatchState,binding:OwnerExecutionBinding){
  const member=state.workspaceMemberChanges?.find(change=>change.next.memberId===binding.memberId&&change.next.revision===binding.memberRevision)?.next;
  check(member&&member.workspaceId===binding.workspaceId&&workspaceMemberHash(member)===binding.memberHash&&member.adoption.captureId===binding.capability.captureId&&member.adoption.configuration.agentId===binding.capability.agentId&&member.adoption.configuration.teamId===binding.capability.teamId&&member.adoption.capabilityHash===binding.capability.capabilityHash&&equal(member.adoption.sourceRef,binding.capability.sourceRef)&&member.runtimePolicy.profileId===binding.model.profileId&&member.runtimePolicy.modelId===binding.model.modelId&&member.runtimePolicy.configurationHash===binding.model.configurationHash,'执行岗位绑定没有对应的原采纳审计');
  for(const owner of binding.owners){
    // 隐式选择不伪造责任审计；核对其原模块来源代次，退役后仍可阅读原任务。
    if(owner.match||owner.inheritedFrom)check(state.knowledgeSourceGenerations?.some(generation=>equal(knowledgeSourceRef(generation),owner.sourceRef)),'执行模块缺少原知识来源审计');
    if(owner.match){check(equal(owner.match.sourceRef,owner.sourceRef),'模型匹配与原模块来源不一致');continue}
    const record=state.ownershipChanges?.find(change=>change.next.bindingId===owner.bindingId&&change.next.revision===owner.revision)?.next;
    check(record&&record.workspaceId===binding.workspaceId&&record.moduleId===(owner.inheritedFrom??owner.moduleId)&&record.ownerMemberId===binding.memberId&&(owner.inheritedFrom||equal(record.sourceRef,owner.sourceRef)),'执行模块绑定没有对应的原责任审计');
  }
  return member;
}
/** 当前业务资格：新派发必须覆盖所选分配的完整模块；旧任务领取/恢复沿既有模块投影核验，不能默默升级绑定。 */
function currentTask(previous:DispatchState,task:TaskNode,exactModules=false){
  if(task.fallbackBinding){check(!task.ownerBinding,'自动兜底不能兼有登记岗位');assertAutomaticExecution(previous,task.fallbackBinding,task.identity.rootSessionId,true)}else{
  check(task.ownerBinding&&ownerExecutionBindingMatches(task.ownerBinding,task.identity.workspaceId,task.assignee.agentId,task.modules.map(module=>module.moduleId)),'旧任务缺少可信岗位绑定，请重新规划并派发新任务','OWNER_BINDING_REQUIRED');
  assertCurrentOwnerExecutionBinding(previous,task.ownerBinding,task.modules.map(module=>module.moduleId));}

  const scope=previous.scopes?.find(scope=>scope.scopeId===task.scopeId&&scope.rootSessionId===task.identity.rootSessionId&&scope.workspaceId===task.identity.workspaceId),goal=scope?.goal;
  check(scope?.status==='active'&&goal?.plan&&!goal.blocked&&!goal.review&&!goalNeedsReplan(goal)&&!scopeHasUnresolvedActiveInput(scope),'业务许可需要本周期当前未阻塞且未审阅的目标计划','OWNER_PLAN_REQUIRED');
  check(goal.plan.assignments.some(assignment=>assignment.agentId===task.assignee.agentId&&(!exactModules||assignment.moduleIds.length===task.modules.length)&&task.modules.every(module=>assignment.moduleIds.includes(module.moduleId)&&module.knowledgeRevision===goal.plan!.knowledgeRevision)&&sameWorkflowSelectionsForModules(assignment.workflowSelections,task.workflowSelections,task.modules.map(module=>module.moduleId))&&sameAutomaticExecutionForModules(assignment.fallbackBinding,task.fallbackBinding,task.modules.map(module=>module.moduleId))&&sameOwnerExecutionForModules(assignment.ownerBinding,task.ownerBinding,task.modules.map(module=>module.moduleId))),'任务负责岗位与当前目标计划不一致','OWNER_PLAN_STALE');
}
/** 新旧执行规则明确分离；历史前缀只兼容缺省，不豁免任何已存在绑定的不可变引用。 */
export function validateOwnerExecutionMutation(previous:DispatchState,next:DispatchState,mutation:DispatchMutation,protocol:DispatchExecutionProtocol):void{
  check(!Object.hasOwn(mutation,'executionProtocol'),'调用者不能指定存储执行协议');
  for(const scope of next.scopes??[])for(const assignment of scope.goal?.plan?.assignments??[]){
    if(assignment.fallbackBinding)assertAutomaticExecution(next,assignment.fallbackBinding,scope.rootSessionId);
    if(assignment.ownerBinding){check(assignment.ownerSelection&&ownerExecutionSelectionMatches(assignment.ownerSelection,assignment.ownerBinding)&&ownerExecutionBindingMatches(assignment.ownerBinding,scope.workspaceId,assignment.agentId,assignment.moduleIds),'目标负责人绑定与原选择不一致');check(assignment.ownerBinding.owners.every(owner=>!owner.match||owner.match.knowledgeRevision===scope.goal!.plan!.knowledgeRevision),'模型匹配必须属于原计划知识版本');const member=historical(next,assignment.ownerBinding);check(assignment.agentName===member.name,'目标负责人名称必须保留原登记岗位名称');}
  }
  for(const graph of next.graphs)for(const task of graph.tasks){
    const old=taskAt(previous,task);check(!old||equal(old.ownerBinding,task.ownerBinding)&&equal(old.fallbackBinding,task.fallbackBinding),'任务负责人不能被补造、移除或更换');
    if(task.fallbackBinding)assertAutomaticExecution(next,task.fallbackBinding,task.identity.rootSessionId);
    if(task.ownerBinding){check(ownerExecutionBindingMatches(task.ownerBinding,next.workspaceId,task.assignee.agentId,task.modules.map(module=>module.moduleId)),'任务负责人身份与节点不一致');const member=historical(next,task.ownerBinding);check(task.assignee.name===member.name,'任务负责人名称必须保留原登记岗位名称');}
  }
  for(const run of mutation.runs??[]){
    const task=next.graphs.find(graph=>graph.identity.rootSessionId===run.binding.rootSessionId)?.tasks.find(task=>task.taskId===run.binding.taskId);check(task,'执行任务不存在');
    check(equal(task.fallbackBinding,run.prepared.fallbackBinding),'运行自动兜底必须保留原绑定');
    if(task.fallbackBinding)check(workspaceMemberModelHash(run.model as Parameters<typeof workspaceMemberModelHash>[0])===task.fallbackBinding.model.configurationHash,'自动执行模型不属于原周期选择');
    check(equal(task.ownerBinding,run.prepared.memberContext?.binding),'运行与任务必须使用同一冻结岗位绑定');
    if(task.ownerBinding){const member=historical(next,task.ownerBinding),context=run.prepared.memberContext!;check(context.name===member.name&&context.position===member.position&&equal(context.adaptation,member.adaptation)&&workspaceMemberModelHash(run.model as Parameters<typeof workspaceMemberModelHash>[0])===task.ownerBinding.model.configurationHash,'执行模型或岗位适配不属于原冻结登记');}
  }
  if(protocol==='legacy')return;
  for(const scope of mutation.scopes??[]){
    const old=previous.scopes?.find(value=>value.scopeId===scope.scopeId),plan=scope.goal?.plan;if(!plan||equal(old?.goal?.plan,plan))continue;
    for(const assignment of plan.assignments){if(assignment.agentId==='cbim:main'){check(!assignment.ownerBinding&&!assignment.ownerSelection&&!assignment.fallbackBinding,'主治理分配不能声明业务负责岗位');continue}
      if(assignment.fallbackBinding){check(!assignment.ownerBinding&&!assignment.ownerSelection,'自动兜底不能混入岗位选择');assertAutomaticExecution(previous,assignment.fallbackBinding,scope.rootSessionId,true);continue}
      check(assignment.ownerBinding&&assignment.ownerSelection,'新业务计划必须保存负责人选择与可信绑定','OWNER_BINDING_REQUIRED');assertCurrentOwnerExecutionBinding(previous,assignment.ownerBinding,assignment.moduleIds);
    }
  }
  for(const graph of next.graphs)for(const task of graph.tasks){
    const old=taskAt(previous,task);
    if(!old)currentTask(previous,task,true);
    else if(task.resumeRequest&&(!old.resumeRequest||task.resumeRequest.requestId!==old.resumeRequest.requestId))currentTask(previous,task);
    for(const ids of [...(task.dependencyAdditions??[]).slice(old?.dependencyAdditions?.length??0).map(record=>record.trackedTaskIds),...(task.dependencyReplacements??[]).slice(old?.dependencyReplacements?.length??0).map(record=>record.trackedTaskIds),...(task.dependencyRevisions??[]).slice(old?.dependencyRevisions?.length??0).map(record=>record.trackedTaskIds)])for(const id of ids){const pending=graph.tasks.find(value=>value.taskId===id);check(pending,'依赖变更的待办闭包缺失');currentTask(previous,pending);}
  }
  for(const run of mutation.runs??[])if(!previous.runs?.some(value=>value.binding.runId===run.binding.runId)){
    const task=next.graphs.find(graph=>graph.identity.rootSessionId===run.binding.rootSessionId)?.tasks.find(value=>value.taskId===run.binding.taskId)!;currentTask(previous,task);
  }
}
