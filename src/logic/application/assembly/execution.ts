/**
 * 目录归属：logic/application/assembly；应用与执行服务装配。

 * 公开网页端口仅装配主会话，网络前后核实同一工作区实例；搜索每次使用当前已保存设置。
 * 作用定位：主进程执行装配，将工作区、已解析模型、原生锁与平台访问策略注入调度引擎。
 * 设计原因：主会话与图根共享实例，在创建 run 前取得全局名额；主会话在两种模式下均按真实权限占用；ask/execute 独占工作区，知识治理仍由独立事务和用户权限保护。
 * 仓库边界：仅桌面主运行工厂捕获已有授权连接，不在准备时联网；CLI/成员和未就绪连接不装配仓库工具。
 * 治理边界：四个观察/提案端口在真实 run 创建时绑定主身份，不共享给成员，不包含桌面批准或实施。
 * 岗位边界：主运行另装配登记/能力采纳端口，共用 Store 与知识写权限；模型选型沿用户已配置的静态 Agent，成员没有此控制面。
 * 责任边界：负责人四工具在 beforeRun 后从真实主周期捕获身份，查询提供实际岗位选择，提交加入周期在途屏障；主模型选型不覆盖执行成员岗位配置。
 * 附件边界：目标补充直接使用一次准备的图片，模型配置视觉预检在意图前；不重读附件或把图片放入后续协作配置。
 * 请求预算：每个真实主 run 在 beforeRun 后取得冻结账本端口，凭据仅由父进程代理使用。
 * GitHub 反馈：仅桌面主会话捕获已连接目标；端口绑定原 task，会话继续仍核实同一提交账本，成员不继承。连接诊断独立于提交端口，未登录时仍能核实缺失原因。
 * 运行工厂用冻结 engine 独立解析当前模型并复核协议，供应商不再拥有引擎，排队运行不会静默改投另一引擎；ready 透传实际原生身份，不以任务 ID 代替。
 * 执行工厂把宿主的固定引擎解析端口传给调度装配；公开聊天选项不能替换该端口或传入下载路径。
 */
import path from 'node:path';
import type {WebToolsPort} from '../../web';
import {FileRunStorage} from '../../execution/storage/run-storage';
import {ChatInputs} from '../../materials/service/chat-inputs';
import type {EngineModelProfiles} from '../../engines/service';
import type {Workspace} from '../../workspace/service/workspace';
import {KernelLock} from '../../../core/platform/node/locking';
import {guard} from '../../execution/platform/tool-guard';
import {hash} from '../../../core/platform/node/serialization';
import {fail} from '../../../core/errors';
import {WorkspaceExecutionManager} from '../../conversation/runtime/execution-manager';
import {createWorkspaceLoop} from '../../execution/assembly/loop-engine';
import type {EngineRuntimeResolver} from '../../execution/rules/engine-runtime';
import {WorkspaceExecutionLease} from '../../execution/admission/workspace-lease';
import type {AutoCollaboration} from '../../dispatch/runtime/auto-collaboration';
import type {WorkspaceDispatchService} from '../../dispatch/runtime/dispatch-service';
import {admissionRequestId,acquireExecutionLease,type WorkspaceAdmission} from './execution-admission';
import type {GitHubFeedback} from '../../feedback/service';
import type {RepositoryConnections} from '../../connectors/service/repository-connections';
import {mainGovernanceTools} from '../../governance/service/main-governance-tools';
import {mainWorkspaceMemberTools} from '../../team/service/main-workspace-member-tools';
import {mainModuleOwnershipTools} from '../../workspace/service/main-module-ownership-tools';
import type {ModuleOwnerships} from '../../workspace/service/module-ownerships';
import type {WorkspaceMembers} from '../../team/service/workspace-members';
import type {ModelRequestBudgetService} from '../../budget/runtime/model-request-budget-service';

/**
 * 每个工作区实例装配独立管理器；锁键和访问策略固定绑定本实例身份。
 * 桌面必须注入与 createMemberServices 共用的 lease 和 dispatch，保证图根与主对话共享实例、执行者独立登记。
 * 独立 CLI/测试未装配 dispatch 时保留旧只按会话执行的边界，不编造已登记的成员身份。
 * repositories 是可选可信服务，不接受运行选项提供地址或授权；每次工厂调用固定自己的连接代际。
 */
export function createExecutionManager(workspace:Workspace,models:EngineModelProfiles,lease=new WorkspaceExecutionLease(),collaboration?:()=>AutoCollaboration|undefined,dispatch?:WorkspaceDispatchService,admission?:WorkspaceAdmission,repositories?:RepositoryConnections,ownerships?:{service:ModuleOwnerships;members:WorkspaceMembers},requestBudgets?:ModelRequestBudgetService,feedback?:GitHubFeedback,web?:WebToolsPort,engineRuntimes?:EngineRuntimeResolver){
  const storage=new FileRunStorage();
  return new WorkspaceExecutionManager(workspace,storage,async(options,task,launch)=>{
    const llm=options.profileId?await models.resolve(options.profileId,options.model,options.engine):undefined;

    if(llm&&(options.provider!=='cbim-'+llm.profile.id||options.model!==llm.profile.model))throw Error('模型配置已变化，请重新启动任务');
    launch.signal.throwIfAborted();
    await requestBudgets?.preflight(task.taskId,launch.scopeId,llm);
    const images=launch.preparedInputImages===undefined?await new ChatInputs(workspace).images(options.attachmentIds):launch.preparedInputImages.map(image=>({...image}));
    launch.signal.throwIfAborted();
    if(images.length&&(!llm||!llm.profile.vision)){
      if(launch.preparedInputImages!==undefined)fail('GOAL_ATTACHMENT_VISION','当前模型配置未启用图片输入，请选择视觉模型后再补充');
      if(llm)throw Error('当前模型未启用图片输入，请在设置中确认视觉能力，或切换支持图片的模型');
    }
    const conversationBinding=task.mode==='chat'?await dispatch?.conversationBinding(task):undefined;
    const repositoryTools=task.mode==='chat'?await repositories?.prepareTools({workspaceId:workspace.entry.id,instanceId:workspace.instanceId}):undefined;
    return createWorkspaceLoop(workspace.paths,workspace,{...options,llm,images,engineRuntimes},{
    storage,
    requestBudget:requestBudgets?({task,runId})=>requestBudgets.forRun({rootSessionId:task.taskId,taskId:task.taskId,runId,kind:'main'},llm):undefined,
    conversationBinding,
    repositoryTools,
    // 主会话使用同一实例的公开网页端口；每次网络前后核实工作区仍有效。
    webTools:task.mode==='chat'&&web?{fetch:async(input,signal)=>{workspace.assert();const value=await web.fetch(input,signal);workspace.assert();return value},search:async(input,signal)=>{workspace.assert();const value=await web.search(input,signal);workspace.assert();return value}}:undefined,
    feedbackTools:task.mode==='chat'&&feedback?()=>feedback.prepare({workspaceId:workspace.entry.id,rootSessionId:task.taskId},()=>workspace.assert()):undefined,
    feedbackStatus:task.mode==='chat'&&feedback?scope=>{workspace.assert();return feedback.auth.checkConnection(scope)}:undefined,
    governanceTools:conversationBinding?({task,runId})=>mainGovernanceTools(workspace,task,runId,conversationBinding):undefined,
    ownershipTools:conversationBinding&&ownerships?({task,runId})=>{const context=collaboration?.()?.mainToolContext(task,runId);return context?{port:mainModuleOwnershipTools(workspace,ownerships.service,ownerships.members,task,runId,conversationBinding,context,dispatch?.owners),binding:{...context.binding,instanceId:workspace.instanceId,agentInstanceId:conversationBinding.agentInstanceId,agentSessionId:conversationBinding.agentSessionId}}:undefined}:undefined,
    memberTools:conversationBinding&&ownerships?({task,runId})=>{const context=collaboration?.()?.mainToolContext(task,runId);return context?{port:mainWorkspaceMemberTools(workspace,ownerships.members,task,runId,conversationBinding,context),binding:{...context.binding,instanceId:workspace.instanceId,agentInstanceId:conversationBinding.agentInstanceId,agentSessionId:conversationBinding.agentSessionId}}:undefined}:undefined,
    dispatchTools:({task,runId})=>collaboration?.()?.tools(task,runId,options),
    acquireLease:async task=>{
      workspace.assert();
      if(task.workspaceId!==workspace.entry.id||task.root!==workspace.entry.path)throw Error('任务与工作区身份不匹配');
      // 两种协作模式的主轮都能执行；ask/execute 同样独占，等待审批期间也不能放行冲突运行。
      const workspacePermission=options.permission??(options.allowNativeExecution?'execute':'read');
      const release=acquireExecutionLease(lease,'conversation:'+task.taskId,{workspaceId:workspace.entry.id,rootSessionId:task.taskId,taskId:task.taskId,scopeId:launch.scopeId,requestId:admissionRequestId('main',launch.requestId),agentInstanceId:conversationBinding?.agentInstanceId,source:launch.wait?'main-result':'direct',workspacePermission},admission,launch.wait);
      const directory=path.join(workspace.paths.project(workspace.entry.id),'loop-engine');
      try{const lock=new KernelLock(directory,hash(workspace.entry.id+':'+task.taskId),'loop');return ()=>{try{lock.close()}finally{release()}}}
      catch(error){release();throw error}
    },
    authorizeNative:async call=>{
      workspace.assert();
      const mapped=call.name==='find'?'Glob':call.name;
      const reason=guard({name:mapped,input:call.input},workspace.entry.path);
      return {allow:!reason,reason};
    },
  });},ids=>new ChatInputs(workspace).images(ids),(input,signal)=>new ChatInputs(workspace).prepareContinuation(input.message,input.attachmentIds,signal));
}
