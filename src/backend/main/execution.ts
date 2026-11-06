/**
 * 作用定位：主进程执行装配，将工作区、已解析模型、原生锁与平台访问策略注入调度引擎。
 * 设计原因：主会话与图根共享实例，对业务文件只持有读取占用；知识治理按用户权限由独立知识事务串行提交和校验版本。业务写入仍由执行成员承担，平台适配不进入调度引擎。
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

/**
 * 每个工作区实例装配独立管理器；锁键和访问策略固定绑定本实例身份。
 * 桌面必须注入与 createMemberServices 共用的 lease 和 dispatch，保证图根与主对话共享实例、执行者独立登记。
 * 独立 CLI/测试未装配 dispatch 时保留旧只按会话执行的边界，不编造已登记的成员身份。
 */
export function createExecutionManager(workspace:Workspace,models:LlmProfiles,lease=new WorkspaceExecutionLease(),collaboration?:()=>AutoCollaboration|undefined,dispatch?:WorkspaceDispatchService){
  const storage=new FileRunStorage();
  return new WorkspaceExecutionManager(workspace,storage,async(options,task)=>{
    const llm=options.profileId?await models.resolve(options.profileId,options.model):undefined;
    if(llm&&(options.provider!=='cbim-'+llm.profile.id||options.model!==llm.profile.model))throw Error('模型配置已变化，请重新启动任务');
    const images=await new ChatInputs(workspace).images(options.attachmentIds);
    if(images.length&&llm&&!llm.profile.vision)throw Error('当前模型未启用图片输入，请在设置中确认视觉能力，或切换支持图片的模型');
    const conversationBinding=task.mode==='chat'?await dispatch?.conversationBinding(task):undefined;
    return createWorkspaceLoop(workspace.paths,workspace,{...options,llm,images},{
    storage,
    conversationBinding,
    dispatchTools:({task,runId})=>collaboration?.()?.tools(task,runId,options),
    acquireLease:async task=>{
      workspace.assert();
      if(task.workspaceId!==workspace.entry.id||task.root!==workspace.entry.path)throw Error('任务与工作区身份不匹配');
      // 此租约协调业务文件操作；主角色的知识写另走 KnowledgeWorkspace 事务，不以该 read 标记授予或拒绝知识修改。
      const release=lease.acquire('conversation:'+task.taskId,task.mode==='chat'?'read':options.permission??(options.allowNativeExecution?'execute':'read'),conversationBinding?.agentInstanceId);
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
