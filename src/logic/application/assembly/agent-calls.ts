/**
 * 作用定位：把 Agent 对象与 execution 的调用协调器、LoopRuntime 装配到工作区真实引擎、准入和请求账本。
 * 设计原因：复用 execution 的运行生命周期和全局准入，避免重复循环和本根并发账本；根运行持工作区租约，后代只在独占工具交接中执行。
 * 支持边界：子调用捕获岗位自己的冻结模型和价格，计入同一根账本；求助只交给直接调用方。
 */
import {prepareAgentBusiness} from './agent-business';
import {randomUUID} from 'node:crypto';
import {Agent,type AgentToolContext} from '../../agents';
import {AgentCallScheduler} from '../../execution/assembly/agent-call-scheduler';
import {AgentConstraintError} from '../../agents/contracts';
import {fail} from '../../../core/errors';
import {createWorkspaceLoop,type WorkspaceLoopOptions,type ExecutionServices} from '../../execution/assembly/loop-engine';
import type {Workspace} from '../../workspace/service/workspace';
import type {WorkspaceMembers} from '../../team/service/workspace-members';
import {workspaceMemberModelHash} from '../../team/rules/workspace-member-rules';
import {workspaceMemberEngine} from '../../team/rules/workspace-member';
import type {ResolvedEngineModel as ResolvedLlm} from '../../engines';
import type {EngineModelProfiles as LlmProfiles} from '../../engines/service';
import type {TaskSpec,RunSummary} from '../../execution/rules/types';
import type {RunStorage} from '../../execution/rules/storage';
import type {WorkspaceAdmission} from './execution-admission';
import type {WorkspaceDispatchService} from '../../dispatch/runtime/dispatch-service';
import type {ModelRequestBudgetService} from '../../budget/runtime/model-request-budget-service';
import type {RequestBudgetPort} from '../../budget/rules/request-budget';

export interface AgentCallAssemblyInput {
  workspace:Workspace;task:TaskSpec;options:WorkspaceLoopOptions;llm?:ResolvedLlm;storage:RunStorage;
  members?:WorkspaceMembers;admission?:WorkspaceAdmission;dispatch?:WorkspaceDispatchService;requestBudgets?:ModelRequestBudgetService;
  models?:Pick<LlmProfiles,'withRuntimeConfiguration'>;
  authorizeNative:ExecutionServices['authorizeNative'];
}
/** 新运行专属装配，不读取最新 scope 推断归属；旧模型入口不会调用此函数。 */
export function createAgentCallAssembly(input:AgentCallAssemblyInput){
  const {workspace,task,options,llm,storage,members,admission,dispatch,requestBudgets}=input;
  const rootAgent=new Agent({id:task.agentId??'cbim:main',name:'主 Agent',instructions:'',permission:options.permission??(options.allowNativeExecution?'execute':'read'),...(llm?{model:{engine:options.engine??llm.profile.engine??'pi',profileId:llm.profile.id,modelId:llm.profile.model}}:{})},{workspaceId:workspace.entry.id,taskId:task.taskId});
  const scopeId=randomUUID(),identity={workspaceId:rootAgent.conversation.workspaceId,rootSessionId:rootAgent.conversation.taskId};
  let rootRunId:string|undefined,releaseBudget:(()=>void)|undefined,opened=false,closed=false;
  let unsupportedBudget=false;
  const requestBudgetsByRole=new Map<string,Promise<RequestBudgetPort|undefined>>();
  const budget=(_context:unknown,role='primary')=>{
    if(!rootRunId)fail('AGENT_ROOT_NOT_STARTED','根运行尚未受理，不能调用模型');
    let result=requestBudgetsByRole.get(role);if(!result){result=requestBudgets?.forRun({rootSessionId:task.taskId,taskId:task.taskId,runId:rootRunId,kind:'main'},llm,role)??Promise.resolve(undefined);requestBudgetsByRole.set(role,result)}return result;
  };
  const scheduler=new AgentCallScheduler({maxDepth:8},{capacity:()=>{const usage=admission?.manager.snapshot();return {current:usage?.occupied.length??0,limit:usage?.policy.maxConcurrentRuns??0}},list:async()=>{
    workspace.assert();if(!members)return {items:[],reason:'当前宿主没有已配置的 Agent 目录'};
    const items:{id:string;name:string;model:{engine:string;profileId:string;modelId:string};available:boolean;reason?:string}[]=[];
    let offset=0,cursor:Awaited<ReturnType<WorkspaceMembers['list']>>['registryCursor']|undefined;
    do{
      const page=await members.list({workspaceId:workspace.entry.id,instanceId:workspace.instanceId,offset,...(cursor?{expectedRegistryCursor:cursor}:{})});cursor=page.registryCursor;
      for(const item of page.items){
        const detail=await members.get({workspaceId:workspace.entry.id,instanceId:workspace.instanceId,memberId:item.memberId}),policy=detail.member.runtimePolicy,model={engine:workspaceMemberEngine(policy)??'pi',profileId:policy.profileId,modelId:policy.modelId};
        const reason=item.state!=='active'?'Agent 已暂停或退役':detail.currentDiff.capability.status!=='same'||detail.currentDiff.model.status!=='same'?'配置变化，需要先核实采纳':unsupportedBudget?'当前预算模式不能可靠计量子调用':undefined;
        items.push({id:item.memberId,name:item.name,model,available:!reason,...(reason?{reason}:{})});
      }
      if(page.nextOffset===undefined)break;offset=page.nextOffset;
    }while(true);
    return {items};
  },prepare:async request=>{
    workspace.assert();request.signal.throwIfAborted();
    if(!rootRunId||closed)fail('AGENT_ROOT_CLOSED','原调用者已经结束');
    if(unsupportedBudget)fail('AGENT_BUDGET_MODE_UNSUPPORTED','当前预算按旧运行汇总，不能可靠计量递归子调用；请使用逐请求预算或关闭该预算后创建新任务，本次未启动子 Agent');
    if(!members)fail('AGENT_CATALOG_UNAVAILABLE','当前宿主没有已配置的 Agent 目录');
    if(!admission)fail('AGENT_ADMISSION_UNAVAILABLE','当前宿主没有真实子运行准入，未启动 Agent');
    const detail=await members.get({workspaceId:workspace.entry.id,instanceId:workspace.instanceId,memberId:request.agentId});
    if(detail.member.state!=='active')fail('AGENT_UNAVAILABLE','目标 Agent 已暂停或退役');
    if(detail.currentDiff.capability.status!=='same'||detail.currentDiff.model.status!=='same')fail('AGENT_CONFIGURATION_CHANGED','目标 Agent 配置已变化，请先核实并采纳配置');
    const policy=detail.member.runtimePolicy;
    const engine=workspaceMemberEngine(policy)??'pi';
    const childLlm=input.models?await input.models.withRuntimeConfiguration({profileId:policy.profileId,modelId:policy.modelId,engine:workspaceMemberEngine(policy),modelRoles:policy.modelRoles},async captured=>{
      if(workspaceMemberModelHash(captured.profile)!==policy.configurationHash)fail('AGENT_CONFIGURATION_CHANGED','目标模型配置已变化，未启动子运行');
      await requestBudgets?.preflight(task.taskId,scopeId,{profile:captured.profile});
      request.signal.throwIfAborted();return captured.resolve();
    }):llm;
    if(!childLlm||childLlm.profile.id!==policy.profileId||childLlm.profile.model!==policy.modelId||workspaceMemberModelHash(childLlm.profile)!==policy.configurationHash)fail('AGENT_MODEL_UNAVAILABLE','目标模型不能按冻结配置解析，未替换为根模型');
    request.signal.throwIfAborted();
    const childTaskId=randomUUID(),definition=detail.member.adoption.configuration;
    const agent=new Agent({id:detail.member.memberId,name:detail.member.name,permission:rootAgent.definition.permission,model:{engine:workspaceMemberEngine(policy)??'pi',profileId:policy.profileId,modelId:policy.modelId},instructions:[definition.principles,detail.member.adaptation.instructions,...definition.effectiveSkills.map(skill=>skill.content)].filter(Boolean).join('\n\n')},{workspaceId:workspace.entry.id,taskId:childTaskId});
    const permit=admission.manager.attempt({workspaceId:workspace.entry.id,rootSessionId:task.taskId,taskId:childTaskId,scopeId,requestId:childTaskId,ownerEpoch:admission.ownerEpoch,source:'direct',workspacePermission:agent.definition.permission},{
      // 根独占租约仍在；Runtime 已核实父工具批次唯一，不能将此入口暴露给任意任务。
      canAcquire:()=>undefined,acquire:()=>()=>{},isCurrent:()=>admission.isCurrent()&&!closed&&!request.signal.aborted,
    });
    if(permit.kind!=='granted'){const usage=admission.manager.snapshot();throw new AgentConstraintError('AGENT_CONCURRENCY_LIMIT','当前真实运行名额不足，未启动子 Agent；父进程仍计入资源占用',{current:usage.occupied.length,requested:1,limit:usage.policy.maxConcurrentRuns,unit:'process'})}
    try{
      if(request.parent.task.moduleIds.length&&(!request.business||request.business.moduleIds.some(id=>!request.parent.task.moduleIds.includes(id))))fail('AGENT_BUSINESS_SCOPE','业务子调用须保留父调用的冻结模块范围');
      const business=request.business?await prepareAgentBusiness({workspace,dispatch:dispatch??fail('AGENT_BUSINESS_UNAVAILABLE','缺少业务来源核实服务'),member:detail.member,model:childLlm,taskId:childTaskId,rootSessionId:task.taskId,message:request.message,permission:agent.definition.permission,storage,business:request.business,signal:request.signal}):undefined;
      const childTask:TaskSpec=business?.task??{...task,taskId:childTaskId,agentId:definition.agentId,goal:request.message,moduleIds:[],acceptance:[],mode:'chat'};
      let childContext:AgentToolContext|undefined,childAlive=true;const childBudgets=new Map<string,Promise<RequestBudgetPort|undefined>>();
      const assertChild=()=>{workspace.assert();if(closed||!childAlive||request.signal.aborted)fail('AGENT_CALL_CANCELLED','原子调用已结束，不能发送新请求')};
      const child=await createWorkspaceLoop(workspace.paths,workspace,{...options,engine,llm:childLlm,profileId:policy.profileId,model:policy.modelId,modelRoles:policy.modelRoles,provider:'cbim-'+policy.profileId,process:undefined,images:[],attachmentIds:[],requestQuestion:async(args,signal)=>{
        if(!childContext)fail('AGENT_CALL_NOT_STARTED','子调用尚未受理');
        childContext.assertQuestionWait?.();return request.requestQuestion(args,signal);
      }},{
        ...business?.services,storage,agent,agentCall:request.reference,agentTools:context=>{childContext=context;return scheduler.bind(context,request.parent.depth+1)},requestBudget:(context,role='primary')=>{
          assertChild();let result=childBudgets.get(role);if(!result){result=requestBudgets?.forRun({rootSessionId:task.taskId,taskId:task.taskId,runId:rootRunId!,kind:'main',agentRun:{taskId:childTaskId,runId:context.runId}},childLlm,role,assertChild)??Promise.resolve(undefined);childBudgets.set(role,result)}return result;
        },
        acquireLease:async()=>{workspace.assert();if(closed||request.signal.aborted)fail('AGENT_CALL_CANCELLED','调用已停止');return ()=>{}},
        authorizeNative:input.authorizeNative,
      });
      return {agent,task:childTask,runtime:child.runtime,...(business?{launch:business.launch,verify:business.verify}:{}),release:()=>{childAlive=false;permit.release()}};
    }catch(error){permit.release();throw error}
  }});
  const finish=async(summary?:RunSummary)=>{
    if(closed)return;await scheduler.close();
    try{if(opened&&dispatch)await dispatch.closeScope(identity,scopeId,summary?.status==='completed'&&!summary.unresolvedTools.length?'completed':summary?.status==='cancelled'?'cancelled':summary?.status==='interrupted'||summary?.unresolvedTools.length?'interrupted':'failed',summary);closed=true}
    finally{releaseBudget?.();releaseBudget=undefined}
  };
  return {
    rootAgent,
    agentTools:(context:AgentToolContext)=>scheduler.bind(context),requestBudget:budget,
    agentLifecycle:{beforeRun:async(runId:string)=>{if(rootRunId&&rootRunId!==runId)fail('AGENT_ROOT_CONFLICT','根运行已经绑定');rootRunId=runId;if(dispatch){releaseBudget=dispatch.budgets.holdMain(runId);const scope=await dispatch.openScope(identity,scopeId,undefined,runId);unsupportedBudget=!!scope.budget?.policy.enabled&&scope.budget.policy.enforcement!=='request';opened=true}},settled:finish,failed:async(_error:unknown)=>finish()},
  };
}
