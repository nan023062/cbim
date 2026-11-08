/**
 * 同一OutputManifestFiles装配成员结算、主目标与人工接受/继续，沿用原工作区身份和只读占用，不另建文件执行通道。
 * 工厂按已提交历史计算剩余额度，恢复闭包持有全链快照以保护早期未再触及文件。
 * 持久成员等待另复用当前文件/native只读端口与短读占用，重启登记不调用恢复工厂。
 * 受控文件边界：实际领取成员固定 scope/run/岗位来源并沿用成员写租约；删除/移动复用同一实际 utility transport，桌面补偿独立取得写租约，不继承模型批准。
 * 作用定位：为已运行工作区装配成员派发、大脑执行、目标审阅、岗位及模块负责人服务；复用工作区恢复前创建的唯一 DispatchStore，来源、责任、岗位与执行保持独立审计投影。
 * 设计原因：知识→模型设置→Store 锁序固定岗位配置，预算和租约通过后才解密；成员不继承主模型。Workflow 能力按实际端口预检，密钥只留工厂闭包，锁释放后创建引擎；历史报告不启动成员。
 * 交接处置只复用原 canonical 读取与路径规范化，既存检查点证明不因今日 native/知识/模型变化被刷新；恢复执行仍走全部当前基线核验。
 * 请求预算共用唯一 Store，真实成员工厂绑定原岗位模型；供应商重试与摘要也由本轮请求端口核实。
 * 影响观察另提供安全文件读取、短只读占用、原知识/治理/责任及受控阶段查询；端口复用唯一存储及已有受控报告，不启动模型、文件子进程或旧提交，明确处置、新只读核实与业务修复各走独立门禁。
 */
import path from 'node:path';
import type {Workspace} from './workspace/workspace';
import {WorkspaceDispatchService} from '../scheduler-engine/execution/dispatch-service';
import type {DispatchObserver} from '../core/tasks/dispatch-storage';
import type {LlmProfiles} from './persistence/settings/llm-profiles';
import type {WorkspaceExecutionLease} from '../scheduler-engine/execution/workspace-lease';
import {MemberExecutionManager,type PreparedEngine} from '../scheduler-engine/execution/member-execution';
import {createWorkspaceLoop} from '../scheduler-engine/execution/loop-engine';
import {memberExecutionPrompt,recheckDispatchExecutionContext} from '../scheduler-engine/context/execution-context';
import {ArtifactFiles,normalizeArtifactPath} from './platform/artifact-files';
import {OutputManifestFiles} from './platform/output-manifest-files';
import {NativeSessionFiles} from './platform/native-session-files';
import {memberCheckpointLimit} from '../core/tasks/member-checkpoint';
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
import {ModuleOwnerships} from './workspace/module-ownerships';
import type {ResolvedLlm} from '../core/brain/llm/ports';
import type {MemberStartOptions} from '../core/tasks/member-commands';
import {workspaceMemberModelHash} from '../core/team/workspace-member-rules';
import {ControlledFiles} from './workspace/controlled-files';
import {createArtifactTransitionPort} from './workspace/artifact-transitions';
import type {ControlledFileTransport} from './platform/controlled-file-protocol';
import {observeKnowledgeTransaction} from './workspace/knowledge-effect-reader';
import {observePersistentWrite} from './workspace/persistent-effect-reader';
import {ModelRequestBudgetService} from '../scheduler-engine/execution/model-request-budget-service';

/** 应用对每个活动工作区只调用一次；关闭服务必须早于释放工作区锁。 */
export function createMemberDispatch(workspace:Workspace,observer?:DispatchObserver){
  workspace.assert();
  return new WorkspaceDispatchService(workspace,workspace.dispatchStore);
}

/**
 * 应用级装配入口，每个工作区仅创建一次。members 须先关闭并结算，之后由 dispatch 关闭共享 store。
 * prepare 固定公开模型参数和凭据，create 不重新读取默认设置；没有已保存模型时拒绝启动。
 * workspaceMembers 复用此 store 保存独立岗位审计；只调用 configuration 读取公开配置，不进入 prepare/create 或影响派发选择。
 */
export function createMemberServices(workspace:Workspace,models:LlmProfiles,lease:WorkspaceExecutionLease,observer?:DispatchObserver,admission?:WorkspaceAdmission,budgetPolicy?:()=>ScopeBudgetPolicy,controlledTransport?:ControlledFileTransport){
  workspace.assert();
  const directory=path.join(workspace.paths.project(workspace.entry.id),'dispatch');
  const store=workspace.dispatchStore,storage=new FileRunStorage();
  const runsDirectory=path.join(directory,'runs');
  const artifactFiles=new ArtifactFiles(workspace.entry.path,()=>workspace.assert());
  const manifestFiles=new OutputManifestFiles(workspace.entry.path,()=>workspace.assert());
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
  const controlledFiles=new ControlledFiles(workspace,store,lease,controlledTransport,inspectMember,()=>admission?.isCurrent()??true);
  const dispatch=new WorkspaceDispatchService(workspace,store,{inspectMember,normalizeValidationPath:normalizeArtifact,checkValidationFiles:(files,signal)=>artifactFiles.checkFiles(files,signal),checkManifest:(snapshot,signal)=>manifestFiles.check(snapshot,signal),inspectMain:async(rootSessionId,runId)=>{
    workspace.assert();
    const summary=await storage.read(path.join(workspace.paths.project(workspace.entry.id),'loop-engine','tasks',safeId(rootSessionId),safeId(runId)));
    if(summary.task.workspaceId!==workspace.entry.id||summary.task.root!==workspace.entry.path||summary.task.taskId!==rootSessionId||summary.runId!==runId||summary.task.agentId!=='cbim:main')throw Error('主调度证据不属于当前会话或运行');
    return summary;
  }},budgetPolicy,{normalizePath:normalizeArtifact,checkFiles:(files,signal)=>artifactFiles.checkFiles(files,signal),checkManifest:(snapshot,signal)=>manifestFiles.check(snapshot,signal),acquireRead:()=>{workspace.assert();return lease.acquire('human-decision:'+randomUUID(),'read')},assertCurrent:()=>{workspace.assert();if(admission&&!admission.isCurrent())fail('HUMAN_UNAVAILABLE','工作区正在停止，未保存新的人工决定')}},models,{inspect:inspectMember,normalizePath:normalizeArtifact},{inspectMember,observeKnowledge:(reference,signal)=>observeKnowledgeTransaction(workspace,reference,signal),observePersistent:(reference,signal)=>observePersistentWrite(workspace,reference,signal),observeControlled:async(input,signal)=>{signal?.throwIfAborted();const value=await controlledFiles.report(input);signal?.throwIfAborted();return value},normalizePath:normalizeArtifact,observeFiles:(paths,signal)=>artifactFiles.observeFiles(paths,signal),acquireRead:()=>{workspace.assert();return lease.acquire('effect-observation:'+randomUUID(),'read')},assertCurrent:()=>{workspace.assert();if(admission&&!admission.isCurrent())fail('EFFECT_UNAVAILABLE','工作区正在停止，未保存新的处置')}},{...checkpointPorts,acquireRead:()=>{workspace.assert();return lease.acquire('member-pause:'+randomUUID(),'read')},assertCurrent:()=>{workspace.assert();if(admission&&!admission.isCurrent())fail('GOAL_MEMBER_PAUSE_UNAVAILABLE','工作区正在停止，原成员等待未消费')}});
  const requestBudgets=new ModelRequestBudgetService(workspace,store,dispatch.budgets);
  const prepareEngine=(llm:ResolvedLlm,options:MemberStartOptions):PreparedEngine=>{
      return {model:structuredClone(llm.profile),availableTools:nativeToolNames(options.permission!=='read'),availableValidators:['json-schema-v1'],create:async(run,task,hooks)=>{
        workspace.assert();
        if(run.binding.workspaceId!==workspace.entry.id||task.identity.workspaceId!==workspace.entry.id)throw Error('成员运行与工作区身份不匹配');
        if(JSON.stringify(run.model)!==JSON.stringify(llm.profile))throw Error('成员运行模型快照与启动配置不一致');
        const checkpointState=await store.read(),previous=run.resumeFrom?checkpointState.runs?.find(old=>old.binding.runId===run.resumeFrom!.runId):undefined;
        if(run.resumeFrom&&(!previous?.checkpointProof||previous.checkpointProof.checkpoint.checkpointId!==run.resumeFrom.checkpointId))fail('MEMBER_CHECKPOINT_INVALID','续执行缺少原检查点证明');
        const loop=await createWorkspaceLoop(workspace.paths,workspace,{provider:'cbim-'+llm.profile.id,model:llm.profile.model,profileId:llm.profile.id,llm,
          permission:run.permission,turnTimeoutMs:run.turnTimeoutMs,onEvent:hooks.onEvent,requestApproval:hooks.requestApproval,requestQuestion:hooks.requestQuestion,
        },{
          memberCheckpointAllowance:memberCheckpointLimit-(task.checkpoints?.length??0),
          requestBudget:()=>requestBudgets.forRun({rootSessionId:run.binding.rootSessionId,taskId:task.taskId,runId:run.binding.runId,scopeId:task.scopeId,kind:'member'},llm),
          storage,member:{directory:runsDirectory,prompt:memberExecutionPrompt(run.prepared,task,run.prerequisites),workflowContracts:preparedWorkflowContracts(run.prepared)},onEngineReady:hooks.onEngineReady,
          artifacts:{knowledgeRevision:run.prepared.knowledgeRevision,normalizePath:normalizeArtifact,assertCurrentKnowledge:async()=>{workspace.assert();await recheckDispatchExecutionContext(workspace,run.prepared)},captureFiles:(paths,signal)=>artifactFiles.captureFiles(paths,signal)},
          manifests:{knowledgeRevision:run.prepared.knowledgeRevision,assertCurrentKnowledge:async()=>{workspace.assert();await recheckDispatchExecutionContext(workspace,run.prepared)},capture:(scopes,signal)=>manifestFiles.capture(scopes,signal)},
          validations:{validateFile:(file,schema,signal)=>artifactFiles.validateFile(file,schema,signal),checkFiles:(files,signal)=>artifactFiles.checkFiles(files,signal)},
          controlledFiles:task.scopeId?controlledFiles.forRun(run,task.scopeId):undefined,
          artifactTransitions:createArtifactTransitionPort(workspace,controlledTransport,()=>admission?.isCurrent()??true),
          // 领取后到 Pi 发出首条 prompt 前仍有异步准备；每个准备边界复核原证明，不只核原生文件而遗漏外部业务文件变化。
          assertMemberResume:previous?async()=>{await verifyMemberCheckpointProof(workspace,task,previous,checkpointPorts,()=>workspace.assert(),previous.checkpointProof,checkpointState.runs)}:undefined,
          assertMemberResumeInputs:previous?()=>verifyMemberCheckpointInputs(workspace,task,previous,checkpointPorts,()=>workspace.assert(),previous.checkpointProof!,checkpointState.runs):undefined,
          // 成员管理器已在领取事务前取得共享占用，并持有到结算完成；大脑不能提前释放或再次领取。
          acquireLease:async input=>{workspace.assert();if(input.workspaceId!==workspace.entry.id||input.root!==workspace.entry.path||input.taskId!==task.taskId)throw Error('成员任务与工作区身份不匹配');return ()=>{}},
          authorizeNative:async call=>{workspace.assert();const reason=guard({name:call.name==='find'?'Glob':call.name,input:call.input},workspace.entry.path);return {allow:!reason,reason}},
        });
        return loop.runtime;
      }};
  };
  const members=new MemberExecutionManager(workspace,store,{
    artifacts:{normalizePath:normalizeArtifact,checkFiles:(files,signal)=>artifactFiles.checkFiles(files,signal),acquireRead:()=>{workspace.assert();return lease.acquire('artifact-report:'+randomUUID(),'read')}},
    manifests:{check:(snapshot,signal)=>manifestFiles.check(snapshot,signal),acquireRead:()=>{workspace.assert();return lease.acquire('manifest-report:'+randomUUID(),'read')}},
    checkpoints:{nativeFingerprint:(session,signal)=>nativeFiles.read(session,signal)},
    budgets:dispatch.budgets,
    isCurrent:()=>admission?.isCurrent()??true,
    signal:admission?.signal,
    acquire:(key,permission,agentInstanceId,context)=>{
      if(!context){if(admission)fail('ADMISSION_IDENTITY','成员准入缺少可信任务与命令身份');return lease.acquire('member:'+key,permission,agentInstanceId)}
      return acquireExecutionLease(lease,'member:'+key,{workspaceId:workspace.entry.id,rootSessionId:context.task.identity.rootSessionId,taskId:context.task.taskId,scopeId:context.task.scopeId,requestId:admissionRequestId('member',context.commandId),agentInstanceId,source:context.wait?'member':'direct',workspacePermission:permission},admission,context.wait);
    },
    owners:dispatch.owners,
    prepare:async options=>prepareEngine(await models.resolve(options.profileId,options.model),options),
    withEngineConfiguration:(model,options,use)=>models.withRuntimeConfiguration(model,async configuration=>{
      workspace.assert();
      if(workspaceMemberModelHash(configuration.profile)!==model.configurationHash)fail('OWNER_MODEL_CHANGED','岗位模型配置已变化，请明确采纳后重新规划');
      return use({model:configuration.profile,prepare:()=>prepareEngine(configuration.resolve(),options)});
    }),
    inspect:inspectMember,
  });
  const workspaceMembers=new WorkspaceMembers(workspace,store,models,()=>admission?.isCurrent()??true);
  const moduleOwnerships=new ModuleOwnerships(workspace,store,()=>admission?.isCurrent()??true);
  return {dispatch,members,workspaceMembers,moduleOwnerships,controlledFiles,requestBudgets};
}
