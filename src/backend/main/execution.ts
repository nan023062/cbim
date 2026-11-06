/**
 * 作用定位：主进程执行装配，将工作区、已解析模型、原生锁与平台访问策略注入调度引擎。
 * 设计原因：为活动运行插入注入工作区图片快照读取端口；启动时从本工作区附件快照恢复图片并复核视觉能力；平台适配留在 main，调度引擎仅依赖 Core 契约，不反向导入本模块。
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

/** 每个工作区实例装配独立管理器；锁键和访问策略固定绑定本实例身份。 */
export function createExecutionManager(workspace:Workspace,models:LlmProfiles){
  const storage=new FileRunStorage();
  return new WorkspaceExecutionManager(workspace,storage,async options=>{
    const llm=options.profileId?await models.resolve(options.profileId,options.model):undefined;
    if(llm&&(options.provider!=='cbim-'+llm.profile.id||options.model!==llm.profile.model))throw Error('模型配置已变化，请重新启动任务');
    const images=await new ChatInputs(workspace).images(options.attachmentIds);
    if(images.length&&llm&&!llm.profile.vision)throw Error('当前模型未启用图片输入，请在设置中确认视觉能力，或切换支持图片的模型');
    return createWorkspaceLoop(workspace.paths,workspace,{...options,llm,images},{
    storage,
    acquireLease:async task=>{
      workspace.assert();
      if(task.workspaceId!==workspace.entry.id||task.root!==workspace.entry.path)throw Error('任务与工作区身份不匹配');
      const directory=path.join(workspace.paths.project(workspace.entry.id),'loop-engine');
      const lock=new KernelLock(directory,hash(workspace.entry.id+':'+task.taskId),'loop');return ()=>lock.close();
    },
    authorizeNative:async call=>{
      workspace.assert();
      const mapped=call.name==='find'?'Glob':call.name;
      const reason=guard({name:mapped,input:call.input},workspace.entry.path);
      return {allow:!reason,reason};
    },
  });},ids=>new ChatInputs(workspace).images(ids));
}
