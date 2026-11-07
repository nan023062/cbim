/**
 * 作用定位：主进程执行装配，将工作区、已解析模型、原生锁与平台访问策略注入调度引擎。
 * 设计原因：主会话与图根共享实例，在创建 run 前取得全局名额及业务文件读取占用；知识治理仍由独立知识事务与用户权限保护。等待回调来自可信启动上下文，不混入可序列化模型设置。
 * 仓库边界：仅桌面主运行工厂捕获已有授权连接，不在准备时联网；CLI/成员和未就绪连接不装配仓库工具。
 */
import path from 'node:path';
import {FileRunStorage} from './persistence/tasks/run-storage';
import {ChatInputs} from './persistence/tasks/chat-inputs';
import type {LlmProfiles} from './persistence/settings/llm-profiles';
import type {Workspace} from './workspace/workspace';
import {KernelLock} from './platform/locking';
import {guard} from './platform/tool-guard';
import {hash} from '../core/foundation/serialization';
import {WorkspaceExecutionManager} from '../scheduler-engine/execution/execution-manager';
import {createWorkspaceLoop} from '../scheduler-engine/execution/loop-engine';
import {WorkspaceExecutionLease} from '../scheduler-engine/execution/workspace-lease';
import type {AutoCollaboration} from '../scheduler-engine/execution/auto-collaboration';
import type {WorkspaceDispatchService} from '../scheduler-engine/execution/dispatch-service';
import {admissionRequestId,acquireExecutionLease,type WorkspaceAdmission} from './execution-admission';
import type {RepositoryConnections} from './resources/repository-connections';

/**
 * 每个工作区实例装配独立管理器；锁键和访问策略固定绑定本实例身份。
 * 桌面必须注入与 createMemberServices 共用的 lease 和 dispatch，保证图根与主对话共享实例、执行者独立登记。
 * 独立 CLI/测试未装配 dispatch 时保留旧只按会话执行的边界，不编造已登记的成员身份。
 * repositories 是可选可信服务，不接受运行选项提供地址或授权；每次工厂调用固定自己的连接代际。
 */
export function createExecutionManager(workspace:Workspace,models:LlmProfiles,lease=new WorkspaceExecutionLease(),collaboration?:()=>AutoCollaboration|undefined,dispatch?:WorkspaceDispatchService,admission?:WorkspaceAdmission,repositories?:RepositoryConnections){
  const storage=new FileRunStorage();
  return new WorkspaceExecutionManager(workspace,storage,async(options,task,launch)=>{
    const llm=options.profileId?await models.resolve(options.profileId,options.model):undefined;
    if(llm&&(options.provider!=='cbim-'+llm.profile.id||options.model!==llm.profile.model))throw Error('模型配置已变化，请重新启动任务');
    const images=await new ChatInputs(workspace).images(options.attachmentIds);
    if(images.length&&llm&&!llm.profile.vision)throw Error('当前模型未启用图片输入，请在设置中确认视觉能力，或切换支持图片的模型');
    const conversationBinding=task.mode==='chat'?await dispatch?.conversationBinding(task):undefined;
    const repositoryTools=task.mode==='chat'?await repositories?.prepareTools({workspaceId:workspace.entry.id,instanceId:workspace.instanceId}):undefined;
    return createWorkspaceLoop(workspace.paths,workspace,{...options,llm,images},{
    storage,
    conversationBinding,
    repositoryTools,
    dispatchTools:({task,runId})=>collaboration?.()?.tools(task,runId,options),
    acquireLease:async task=>{
      workspace.assert();
      if(task.workspaceId!==workspace.entry.id||task.root!==workspace.entry.path)throw Error('任务与工作区身份不匹配');
      // 此租约协调业务文件操作；主角色的知识写另走 KnowledgeWorkspace 事务，不以该 read 标记授予或拒绝知识修改。
      const release=acquireExecutionLease(lease,'conversation:'+task.taskId,{workspaceId:workspace.entry.id,rootSessionId:task.taskId,taskId:task.taskId,scopeId:launch.scopeId,requestId:admissionRequestId('main',launch.requestId),agentInstanceId:conversationBinding?.agentInstanceId,source:launch.wait?'main-result':'direct',workspacePermission:task.mode==='chat'?'read':options.permission??(options.allowNativeExecution?'execute':'read')},admission,launch.wait);
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
  });},ids=>new ChatInputs(workspace).images(ids));
}
