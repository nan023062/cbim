/**
 * 作用定位：把独立 Agent、循环与调度器装配到工作区真实引擎、准入和请求账本。
 * 设计原因：保持调度系统与 Application/SDK 单向依赖；根运行持工作区租约，后代只在独占工具交接中执行。
 * 支持边界：首片只允许与根相同冻结模型的已登记 Agent，确保共用原逐请求计费端口；不静默改投模型。
 */
import {randomUUID} from 'node:crypto';
import {Agent,AgentExecutionLoop,AgentCallScheduler,type AgentToolContext} from '../../agents';
import {AgentConstraintError} from '../../agents/contracts';
import {fail} from '../../../core/errors';
import {createWorkspaceLoop,type WorkspaceLoopOptions,type ExecutionServices} from '../../execution/assembly/loop-engine';
import type {Workspace} from '../../workspace/service/workspace';
import type {WorkspaceMembers} from '../../team/service/workspace-members';
import {workspaceMemberModelHash} from '../../team/rules/workspace-member-rules';
import {workspaceMemberEngine} from '../../team/rules/workspace-member';
import type {ResolvedLlm} from '../../models';
import type {TaskSpec,RunSummary} from '../../execution/rules/types';
import type {RunStorage} from '../../execution/rules/storage';
import type {WorkspaceAdmission} from './execution-admission';
import type {WorkspaceDispatchService} from '../../dispatch/runtime/dispatch-service';
import type {ModelRequestBudgetService} from '../../budget/runtime/model-request-budget-service';
import type {RequestBudgetPort} from '../../budget/rules/request-budget';

export interface AgentCallAssemblyInput {
  workspace:Workspace;task:TaskSpec;options:WorkspaceLoopOptions;llm?:ResolvedLlm;storage:RunStorage;
  members?:WorkspaceMembers;admission?:WorkspaceAdmission;dispatch?:WorkspaceDispatchService;requestBudgets?:ModelRequestBudgetService;
  authorizeNative:ExecutionServices['authorizeNative'];
}
/** 新运行专属装配，不读取最新 scope 推断归属；旧模型入口不会调用此函数。 */
export function createAgentCallAssembly(input:AgentCallAssemblyInput){
  const {workspace,task,options,llm,storage,members,admission,dispatch,requestBudgets}=input;
  const rootAgent=new Agent({id:task.agentId??'cbim:main',name:'主 Agent',instructions:'',permission:options.permission??(options.allowNativeExecution?'execute':'read'),...(llm?{model:{engine:options.engine??llm.profile.engine??'pi',profileId:llm.profile.id,modelId:llm.profile.model}}:{})},{workspaceId:workspace.entry.id,taskId:task.taskId});
  const scopeId=randomUUID(),identity={workspaceId:rootAgent.conversation.workspaceId,rootSessionId:rootAgent.conversation.taskId};
  let rootRunId:string|undefined,releaseBudget:(()=>void)|undefined,opened=false,closed=false;
  let unsupportedBudget=false;
  let requestBudget:Promise<RequestBudgetPort|undefined>|undefined;
  const budget=()=>{
    if(!rootRunId)fail('AGENT_ROOT_NOT_STARTED','根运行尚未受理，不能调用模型');
    return requestBudget??=requestBudgets?.forRun({rootSessionId:task.taskId,taskId:task.taskId,runId:rootRunId,kind:'main'},llm)??Promise.resolve(undefined);
  };
  const scheduler=new AgentCallScheduler({maxDepth:8,maxConcurrent:32},{list:async()=>{
    workspace.assert();if(!members)return {items:[],reason:'当前宿主没有已配置的 Agent 目录'};
    const items:{id:string;name:string;model:{engine:string;profileId:string;modelId:string};available:boolean;reason?:string}[]=[];
    let offset=0,cursor:Awaited<ReturnType<WorkspaceMembers['list']>>['registryCursor']|undefined;
    do{
      const page=await members.list({workspaceId:workspace.entry.id,instanceId:workspace.instanceId,offset,...(cursor?{expectedRegistryCursor:cursor}:{})});cursor=page.registryCursor;
      for(const item of page.items){
        const detail=await members.get({workspaceId:workspace.entry.id,instanceId:workspace.instanceId,memberId:item.memberId}),policy=detail.member.runtimePolicy,model={engine:workspaceMemberEngine(policy)??'pi',profileId:policy.profileId,modelId:policy.modelId};
        const reason=item.state!=='active'?'Agent 已暂停或退役':detail.currentDiff.capability.status!=='same'||detail.currentDiff.model.status!=='same'?'配置变化，需要先核实采纳':!llm||policy.configurationHash!==workspaceMemberModelHash(llm.profile)?'当前调用根与目标模型配置不同，尚不支持该递归调用':unsupportedBudget?'当前预算模式不能可靠计量子调用':undefined;
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
    if(!llm||policy.profileId!==llm.profile.id||policy.modelId!==llm.profile.model||(workspaceMemberEngine(policy)??'pi')!==(options.engine??llm.profile.engine??'pi')||policy.configurationHash!==workspaceMemberModelHash(llm.profile))fail('AGENT_MODEL_UNSUPPORTED','当前递归执行要求目标 Agent 与调用根使用相同冻结模型配置；未切换目标模型、未启动调用');
    request.signal.throwIfAborted();
    const childTaskId=randomUUID(),definition=detail.member.adoption.configuration;
    const agent=new Agent({id:detail.member.memberId,name:detail.member.name,permission:rootAgent.definition.permission,model:{engine:workspaceMemberEngine(policy)??'pi',profileId:policy.profileId,modelId:policy.modelId},instructions:[definition.principles,detail.member.adaptation.instructions,...definition.effectiveSkills.map(skill=>skill.content)].filter(Boolean).join('\n\n')},{workspaceId:workspace.entry.id,taskId:childTaskId});
    const permit=admission.manager.attempt({workspaceId:workspace.entry.id,rootSessionId:task.taskId,taskId:childTaskId,scopeId,requestId:childTaskId,ownerEpoch:admission.ownerEpoch,source:'direct',workspacePermission:agent.definition.permission},{
      // 根独占租约仍在；Runtime 已核实父工具批次唯一，不能将此入口暴露给任意任务。
      canAcquire:()=>undefined,acquire:()=>()=>{},isCurrent:()=>admission.isCurrent()&&!closed&&!request.signal.aborted,
    });
    if(permit.kind!=='granted'){const usage=admission.manager.snapshot();throw new AgentConstraintError('AGENT_CONCURRENCY_LIMIT','当前真实运行名额不足，未启动子 Agent；父进程仍计入资源占用',{current:usage.occupied.length,requested:1,limit:usage.policy.maxConcurrentRuns,unit:'process'})}
    try{
      const childTask:TaskSpec={...task,taskId:childTaskId,agentId:definition.agentId,goal:request.message,moduleIds:[],acceptance:[],mode:'chat'};
      const child=await createWorkspaceLoop(workspace.paths,workspace,{...options,llm,images:[],attachmentIds:[],requestQuestion:async()=>{fail('AGENT_QUESTION_UNSUPPORTED','当前引擎不能在此调用内向父 Agent 暂停提问；请将具体问题作为结果返回调用方，不直接询问用户')}},{
        storage,agent,agentCall:request.reference,agentTools:context=>scheduler.bind(context,request.parent.depth+1),requestBudget:budget,
        acquireLease:async()=>{workspace.assert();if(closed||request.signal.aborted)fail('AGENT_CALL_CANCELLED','调用已停止');return ()=>{}},
        authorizeNative:input.authorizeNative,
      });
      const loop=new AgentExecutionLoop(agent,{start:(message,signal,beforeRun)=>child.runtime.start(childTask,message,undefined,undefined,{signal,beforeRun:({runId})=>beforeRun(runId)}),stop:()=>child.runtime.stop(childTaskId),close:()=>child.runtime.close()});
      return {agent,loop,release:permit.release};
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
