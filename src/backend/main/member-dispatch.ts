/**
 * 作用定位：为已运行工作区装配成员派发、大脑执行及目标审阅的可信日志读取端口。
 * 设计原因：派发、目标审阅和消费使用同一事务存储；证据按明确运行绑定读取原日志，模型密钥留在工厂闭包。主会话和成员共享工作区占用，任务审批互不继承。
 */
import path from 'node:path';
import type {Workspace} from './workspace/workspace';
import {FileDispatchStore} from './persistence/tasks/dispatch-store';
import {WorkspaceDispatchService} from '../scheduler-engine/execution/dispatch-service';
import type {DispatchObserver} from '../core/tasks/dispatch-storage';
import type {LlmProfiles} from './persistence/settings/llm-profiles';
import type {WorkspaceExecutionLease} from '../scheduler-engine/execution/workspace-lease';
import {MemberExecutionManager} from '../scheduler-engine/execution/member-execution';
import {createWorkspaceLoop} from '../scheduler-engine/execution/loop-engine';
import {memberExecutionPrompt} from '../scheduler-engine/context/execution-context';
import {FileRunStorage} from './persistence/tasks/run-storage';
import {guard} from './platform/tool-guard';
import {safeId} from '../core/foundation/identity';

/** 应用对每个活动工作区只调用一次；关闭服务必须早于释放工作区锁。 */
export function createMemberDispatch(workspace:Workspace,observer?:DispatchObserver){
  workspace.assert();
  return new WorkspaceDispatchService(workspace,new FileDispatchStore(path.join(workspace.paths.project(workspace.entry.id),'dispatch'),workspace.entry.id,observer));
}

/**
 * 应用级装配入口，每个工作区仅创建一次。members 须先关闭并结算，之后由 dispatch 关闭共享 store。
 * prepare 固定公开模型参数和凭据，create 不重新读取默认设置；没有已保存模型时拒绝启动。
 */
export function createMemberServices(workspace:Workspace,models:LlmProfiles,lease:WorkspaceExecutionLease,observer?:DispatchObserver){
  workspace.assert();
  const directory=path.join(workspace.paths.project(workspace.entry.id),'dispatch');
  const store=new FileDispatchStore(directory,workspace.entry.id,observer),storage=new FileRunStorage();
  const runsDirectory=path.join(directory,'runs');
  /** 主/成员的权威运行日志只在后端读取；不能以公开摘要或模型传来的“成功”替代。 */
  const inspectMember=async(run:import('../core/tasks/dispatch-execution').DispatchRun)=>{
    workspace.assert();
    const summary=await storage.read(path.join(runsDirectory,'tasks',safeId(run.binding.taskId),safeId(run.binding.runId)));
    if(summary.task.workspaceId!==workspace.entry.id||summary.task.root!==workspace.entry.path)throw Error('成员运行记录属于其他工作区');
    if(JSON.stringify(summary.memberBinding)!==JSON.stringify(run.binding))throw Error('成员运行日志与已保存的执行绑定不一致');
    return summary;
  };
  const dispatch=new WorkspaceDispatchService(workspace,store,{inspectMember,inspectMain:async(rootSessionId,runId)=>{
    workspace.assert();
    const summary=await storage.read(path.join(workspace.paths.project(workspace.entry.id),'loop-engine','tasks',safeId(rootSessionId),safeId(runId)));
    if(summary.task.workspaceId!==workspace.entry.id||summary.task.root!==workspace.entry.path||summary.task.taskId!==rootSessionId||summary.runId!==runId||summary.task.agentId!=='cbim:main')throw Error('主调度证据不属于当前会话或运行');
    return summary;
  }});
  const members=new MemberExecutionManager(workspace,store,{
    acquire:(key,permission,agentInstanceId)=>lease.acquire('member:'+key,permission,agentInstanceId),
    prepare:async options=>{
      workspace.assert();
      const llm=await models.resolve(options.profileId,options.model);
      return {model:structuredClone(llm.profile),create:async(run,task,hooks)=>{
        workspace.assert();
        if(run.binding.workspaceId!==workspace.entry.id||task.identity.workspaceId!==workspace.entry.id)throw Error('成员运行与工作区身份不匹配');
        if(JSON.stringify(run.model)!==JSON.stringify(llm.profile))throw Error('成员运行模型快照与启动配置不一致');
        const loop=await createWorkspaceLoop(workspace.paths,workspace,{provider:'cbim-'+llm.profile.id,model:llm.profile.model,profileId:llm.profile.id,llm,
          permission:run.permission,turnTimeoutMs:run.turnTimeoutMs,onEvent:hooks.onEvent,requestApproval:hooks.requestApproval,requestQuestion:hooks.requestQuestion,
        },{
          storage,member:{directory:runsDirectory,prompt:memberExecutionPrompt(run.prepared,task,run.prerequisites)},onEngineReady:hooks.onEngineReady,
          // 成员管理器已在领取事务前取得共享占用，并持有到结算完成；大脑不能提前释放或再次领取。
          acquireLease:async input=>{workspace.assert();if(input.workspaceId!==workspace.entry.id||input.root!==workspace.entry.path||input.taskId!==task.taskId)throw Error('成员任务与工作区身份不匹配');return ()=>{}},
          authorizeNative:async call=>{workspace.assert();const reason=guard({name:call.name==='find'?'Glob':call.name,input:call.input},workspace.entry.path);return {allow:!reason,reason}},
        });
        return loop.runtime;
      }};
    },
    inspect:inspectMember,
  });
  return {dispatch,members};
}
