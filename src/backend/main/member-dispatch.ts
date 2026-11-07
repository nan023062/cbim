/**
 * 作用定位：为已运行工作区装配成员派发、大脑执行、目标审阅及独立岗位登记；岗位与执行共用同一 DispatchStore。
 * 设计原因：派发、审阅及周期额度共用可信日志；Workflow 能力按真实工具与验证端口预检，冻结约定只注入正式成员。JSON 验证以同一安全读取字节判定，交付及审阅复用有界文件复核；密钥留在工厂闭包，只读报告不启动成员。
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
import {memberExecutionPrompt,recheckDispatchExecutionContext} from '../scheduler-engine/context/execution-context';
import {ArtifactFiles,normalizeArtifactPath} from './platform/artifact-files';
import {NativeSessionFiles} from './platform/native-session-files';
import {verifyMemberCheckpointProof,verifyMemberCheckpointInputs} from '../scheduler-engine/execution/member-checkpoint-verifier';
import {randomUUID} from 'node:crypto';
import {FileRunStorage} from './persistence/tasks/run-storage';
import {guard} from './platform/tool-guard';
import {safeId} from '../core/foundation/identity';
import {fail} from '../core/foundation/errors';
import {admissionRequestId,acquireExecutionLease,type WorkspaceAdmission} from './execution-admission';
import type {ScopeBudgetPolicy} from '../core/tasks/scope-budget';
import {preparedWorkflowContracts} from '../core/tasks/execution-context';
import {nativeToolNames} from '../core/tools/native-tools';
import {WorkspaceMembers} from './workspace/workspace-members';

/** 应用对每个活动工作区只调用一次；关闭服务必须早于释放工作区锁。 */
export function createMemberDispatch(workspace:Workspace,observer?:DispatchObserver){
  workspace.assert();
  return new WorkspaceDispatchService(workspace,new FileDispatchStore(path.join(workspace.paths.project(workspace.entry.id),'dispatch'),workspace.entry.id,observer));
}

/**
 * 应用级装配入口，每个工作区仅创建一次。members 须先关闭并结算，之后由 dispatch 关闭共享 store。
 * prepare 固定公开模型参数和凭据，create 不重新读取默认设置；没有已保存模型时拒绝启动。
 * workspaceMembers 复用此 store 保存独立岗位审计；只调用 configuration 读取公开配置，不进入 prepare/create 或影响派发选择。
 */
export function createMemberServices(workspace:Workspace,models:LlmProfiles,lease:WorkspaceExecutionLease,observer?:DispatchObserver,admission?:WorkspaceAdmission,budgetPolicy?:()=>ScopeBudgetPolicy){
  workspace.assert();
  const directory=path.join(workspace.paths.project(workspace.entry.id),'dispatch');
  const store=new FileDispatchStore(directory,workspace.entry.id,observer),storage=new FileRunStorage();
  const runsDirectory=path.join(directory,'runs');
  const artifactFiles=new ArtifactFiles(workspace.entry.path,()=>workspace.assert());
  const nativeFiles=new NativeSessionFiles(path.join(runsDirectory,'pi','sessions'),()=>workspace.assert());
  const normalizeArtifact=(raw:string)=>normalizeArtifactPath(workspace.entry.path,raw);
  /** 主/成员的权威运行日志只在后端读取；不能以公开摘要或模型传来的“成功”替代。 */
  const inspectMember=async(run:import('../core/tasks/dispatch-execution').DispatchRun)=>{
    workspace.assert();
    const summary=await storage.read(path.join(runsDirectory,'tasks',safeId(run.binding.taskId),safeId(run.binding.runId)));
    if(summary.task.workspaceId!==workspace.entry.id||summary.task.root!==workspace.entry.path)fail('MEMBER_LOG_IDENTITY','成员运行记录属于其他工作区');
    if(JSON.stringify(summary.memberBinding)!==JSON.stringify(run.binding))fail('MEMBER_LOG_IDENTITY','成员运行日志与已保存的执行绑定不一致');
    return summary;
  };
  const checkpointPorts={inspect:inspectMember,normalizePath:normalizeArtifact,checkFiles:artifactFiles.checkFiles.bind(artifactFiles),nativeFingerprint:nativeFiles.read.bind(nativeFiles)};
  const dispatch=new WorkspaceDispatchService(workspace,store,{inspectMember,normalizeValidationPath:normalizeArtifact,checkValidationFiles:(files,signal)=>artifactFiles.checkFiles(files,signal),inspectMain:async(rootSessionId,runId)=>{
    workspace.assert();
    const summary=await storage.read(path.join(workspace.paths.project(workspace.entry.id),'loop-engine','tasks',safeId(rootSessionId),safeId(runId)));
    if(summary.task.workspaceId!==workspace.entry.id||summary.task.root!==workspace.entry.path||summary.task.taskId!==rootSessionId||summary.runId!==runId||summary.task.agentId!=='cbim:main')throw Error('主调度证据不属于当前会话或运行');
    return summary;
  }},budgetPolicy,{normalizePath:normalizeArtifact,checkFiles:(files,signal)=>artifactFiles.checkFiles(files,signal),acquireRead:()=>{workspace.assert();return lease.acquire('human-decision:'+randomUUID(),'read')},assertCurrent:()=>{workspace.assert();if(admission&&!admission.isCurrent())fail('HUMAN_UNAVAILABLE','工作区正在停止，未保存新的人工决定')}});
  const members=new MemberExecutionManager(workspace,store,{
    artifacts:{normalizePath:normalizeArtifact,checkFiles:(files,signal)=>artifactFiles.checkFiles(files,signal),acquireRead:()=>{workspace.assert();return lease.acquire('artifact-report:'+randomUUID(),'read')}},
    checkpoints:{nativeFingerprint:(session,signal)=>nativeFiles.read(session,signal)},
    budgets:dispatch.budgets,
    isCurrent:()=>admission?.isCurrent()??true,
    signal:admission?.signal,
    acquire:(key,permission,agentInstanceId,context)=>{
      if(!context){if(admission)fail('ADMISSION_IDENTITY','成员准入缺少可信任务与命令身份');return lease.acquire('member:'+key,permission,agentInstanceId)}
      return acquireExecutionLease(lease,'member:'+key,{workspaceId:workspace.entry.id,rootSessionId:context.task.identity.rootSessionId,taskId:context.task.taskId,scopeId:context.task.scopeId,requestId:admissionRequestId('member',context.commandId),agentInstanceId,source:context.wait?'member':'direct',workspacePermission:permission},admission,context.wait);
    },
    prepare:async options=>{
      workspace.assert();
      const llm=await models.resolve(options.profileId,options.model);
      return {model:structuredClone(llm.profile),availableTools:nativeToolNames(options.permission!=='read'),availableValidators:['json-schema-v1'],create:async(run,task,hooks)=>{
        workspace.assert();
        if(run.binding.workspaceId!==workspace.entry.id||task.identity.workspaceId!==workspace.entry.id)throw Error('成员运行与工作区身份不匹配');
        if(JSON.stringify(run.model)!==JSON.stringify(llm.profile))throw Error('成员运行模型快照与启动配置不一致');
        const previous=run.resumeFrom?(await store.read()).runs?.find(old=>old.binding.runId===run.resumeFrom!.runId):undefined;
        if(run.resumeFrom&&(!previous?.checkpointProof||previous.checkpointProof.checkpoint.checkpointId!==run.resumeFrom.checkpointId))fail('MEMBER_CHECKPOINT_INVALID','续执行缺少原检查点证明');
        const loop=await createWorkspaceLoop(workspace.paths,workspace,{provider:'cbim-'+llm.profile.id,model:llm.profile.model,profileId:llm.profile.id,llm,
          permission:run.permission,turnTimeoutMs:run.turnTimeoutMs,onEvent:hooks.onEvent,requestApproval:hooks.requestApproval,requestQuestion:hooks.requestQuestion,
        },{
          storage,member:{directory:runsDirectory,prompt:memberExecutionPrompt(run.prepared,task,run.prerequisites),workflowContracts:preparedWorkflowContracts(run.prepared)},onEngineReady:hooks.onEngineReady,
          artifacts:{knowledgeRevision:run.prepared.knowledgeRevision,normalizePath:normalizeArtifact,assertCurrentKnowledge:async()=>{workspace.assert();await recheckDispatchExecutionContext(workspace,run.prepared)},captureFiles:(paths,signal)=>artifactFiles.captureFiles(paths,signal)},
          validations:{validateFile:(file,schema,signal)=>artifactFiles.validateFile(file,schema,signal),checkFiles:(files,signal)=>artifactFiles.checkFiles(files,signal)},
          // 领取后到 Pi 发出首条 prompt 前仍有异步准备；每个准备边界复核原证明，不只核原生文件而遗漏外部业务文件变化。
          assertMemberResume:previous?async()=>{await verifyMemberCheckpointProof(workspace,task,previous,checkpointPorts,()=>workspace.assert(),previous.checkpointProof)}:undefined,
          assertMemberResumeInputs:previous?()=>verifyMemberCheckpointInputs(workspace,task,previous,checkpointPorts,()=>workspace.assert(),previous.checkpointProof!):undefined,
          // 成员管理器已在领取事务前取得共享占用，并持有到结算完成；大脑不能提前释放或再次领取。
          acquireLease:async input=>{workspace.assert();if(input.workspaceId!==workspace.entry.id||input.root!==workspace.entry.path||input.taskId!==task.taskId)throw Error('成员任务与工作区身份不匹配');return ()=>{}},
          authorizeNative:async call=>{workspace.assert();const reason=guard({name:call.name==='find'?'Glob':call.name,input:call.input},workspace.entry.path);return {allow:!reason,reason}},
        });
        return loop.runtime;
      }};
    },
    inspect:inspectMember,
  });
  const workspaceMembers=new WorkspaceMembers(workspace,store,models,()=>admission?.isCurrent()??true);
  return {dispatch,members,workspaceMembers};
}
