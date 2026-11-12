/**
 * 目录归属：backend/main/assembly；应用与执行服务装配。

 * 正式隔离Node装配可信生命周期：原canonical授权先核实，再记录宿主与目录身份；桌面服务与成员共用工作区租约。
 * 范围成员使用独立Win32读取/枚举和LPAC端口；原受控写、删除/移动两端再核冻结写范围，恢复文件复核复用同一受限读取。
 * 同一OutputManifestFiles装配成员结算、主目标与人工接受/继续；主运行内核证派生当前会话读占用，桌面预览与预检独立领取，不另建文件执行通道。
 * 工厂按已提交历史计算剩余额度，恢复闭包持有全链快照以保护早期未再触及文件。
 * 持久成员等待另复用当前文件/native只读端口与短读占用，重启登记不调用恢复工厂。
 * 受控文件边界：实际领取成员固定 scope/run/岗位来源并沿用成员写租约；删除/移动复用同一实际 utility transport，桌面补偿独立取得写租约，不继承模型批准。
 * 作用定位：为已运行工作区装配成员派发、大脑执行、目标审阅、岗位及模块负责人服务；复用工作区恢复前创建的唯一 DispatchStore，来源、责任、岗位与执行保持独立审计投影。
 * 设计原因：知识→模型设置→Store 锁序固定岗位配置，预算和租约通过后才解密；成员不继承主模型。Workflow 能力按实际端口预检，密钥只留工厂闭包，锁释放后创建引擎；历史报告不启动成员。
 * 交接处置只复用原 canonical 读取与路径规范化，既存检查点证明不因今日 native/知识/模型变化被刷新；恢复执行仍走全部当前基线核验。
 * 请求预算共用唯一 Store，真实成员工厂绑定原岗位模型；供应商重试与摘要也由本轮请求端口核实。
 * 专业验证按真实装配公开JSON/CSV/PNG能力，表格与JSON共用安全文件读取及完整清单复核，不把工具成功当作检查通过。
 * 影响观察另提供安全文件读取、短只读占用、原知识/治理/责任及受控阶段查询；端口复用唯一存储及已有受控报告，不启动模型、文件子进程或旧提交，明确处置、新只读核实与业务修复各走独立门禁。
 * 岗位引擎来自采纳快照；原生能力预检与会话指纹按 Pi/Claude Code/Codex 分开装配，主模型不能覆盖它。
 * 请求账本只注入预算专用 Store 适配，预留仍在工作区唯一串行事务中裁决。
 */
import path from 'node:path';
import type {Workspace} from '../workspace/workspace';
import {WorkspaceDispatchService} from '../../scheduler-engine/dispatch/dispatch-service';
import type {DispatchObserver} from '../../core/dispatch/dispatch-storage';
import type {LlmProfiles} from '../models/llm-profiles';
import type {WorkspaceExecutionLease} from '../../scheduler-engine/admission/workspace-lease';
import {MemberExecutionManager,type PreparedEngine} from '../../scheduler-engine/members/member-execution';
import {createWorkspaceLoop} from '../../scheduler-engine/assembly/loop-engine';
import {memberExecutionPrompt,recheckDispatchExecutionContext} from '../../scheduler-engine/context/execution-context';
import {ArtifactFiles,normalizeArtifactPath} from '../platform/files/artifact-files';
import {OutputManifestFiles} from '../platform/files/output-manifest-files';
import {NativeSessionFiles} from '../platform/native-session-files';
import {memberCheckpointLimit} from '../../core/tasks/member-checkpoint';
import {verifyMemberCheckpointProof,verifyMemberCheckpointInputs} from '../../scheduler-engine/members/member-checkpoint-verifier';
import {randomUUID} from 'node:crypto';
import {FileRunStorage} from '../run-storage/run-storage';
import {guard} from '../platform/tool-guard';
import {ScopedExecutionFiles} from '../platform/files/scoped-execution-files';
import {preparedExecutionScope,executionScopeCovers} from '../../core/workspace/execution-scope';
import {artifactTransitionPaths} from '../../core/workspace/artifact-scope';
import {safeId} from '../../core/foundation/identity';
import {fail} from '../../core/foundation/errors';
import {admissionRequestId,acquireExecutionLease,type WorkspaceAdmission} from './execution-admission';
import type {ScopeBudgetPolicy} from '../../core/budget/scope-budget';
import {preparedWorkflowContracts} from '../../core/tasks/execution-context';
import {nativeToolNames} from '../../core/tools/native-tools';
import {WorkspaceMembers} from '../registry/workspace-members';
import {ModuleOwnerships} from '../registry/module-ownerships';
import type {ResolvedLlm} from '../../core/models/ports';
import type {MemberStartOptions} from '../../core/tasks/member-commands';
import {workspaceMemberModelHash} from '../../core/team/workspace-member-rules';
import {ControlledFiles} from '../file-operations/controlled-files';
import {IsolatedExecutions} from '../file-operations/isolated-executions';
import {createArtifactTransitionPort} from '../file-operations/artifact-transitions';
import type {ControlledFileTransport} from '../platform/files/controlled-file-protocol';
import {observeKnowledgeTransaction} from '../evidence/knowledge-effect-reader';
import {observePersistentWrite} from '../evidence/persistent-effect-reader';
import {ModelRequestBudgetService} from '../../scheduler-engine/budget/model-request-budget-service';
import {requestBudgetStore} from '../dispatch-storage/request-budget-store';

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
  const claudeRoot=path.join(runsDirectory,'claude','projects'),claudeFiles=new NativeSessionFiles(claudeRoot,()=>workspace.assert(),'claude-code');
  const codexRoot=path.join(runsDirectory,'codex','sessions'),codexFiles=new NativeSessionFiles(codexRoot,()=>workspace.assert(),'codex');
  const nativeFingerprint=(session:{nativeSessionId:string;sessionFile?:string},signal:AbortSignal)=>{
    for(const [root,files] of [[claudeRoot,claudeFiles],[codexRoot,codexFiles]] as const){const relative=session.sessionFile?path.relative(root,session.sessionFile):'..';if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative))return files.read(session,signal)}
    return nativeFiles.read(session,signal);
  };
  const normalizeArtifact=(raw:string)=>normalizeArtifactPath(workspace.entry.path,raw);
  /** 主/成员的权威运行日志只在后端读取；不能以公开摘要或模型传来的“成功”替代。 */
  const inspectMember=async(run:import('../../core/tasks/dispatch-execution').DispatchRun)=>{
    workspace.assert();
    const summary=await storage.read(path.join(runsDirectory,'tasks',safeId(run.binding.taskId),safeId(run.binding.runId)));
    if(summary.task.workspaceId!==workspace.entry.id||summary.task.root!==workspace.entry.path)fail('MEMBER_LOG_IDENTITY','成员运行记录属于其他工作区');
    if(JSON.stringify(summary.memberBinding)!==JSON.stringify(run.binding))fail('MEMBER_LOG_IDENTITY','成员运行日志与已保存的执行绑定不一致');
    return summary;
  };
  const checkpointPorts={inspect:inspectMember,normalizePath:normalizeArtifact,checkFiles:artifactFiles.checkFiles.bind(artifactFiles),nativeFingerprint};
  const controlledFiles=new ControlledFiles(workspace,store,lease,controlledTransport,inspectMember,()=>admission?.isCurrent()??true);
  const isolatedExecutions=new IsolatedExecutions(workspace,store,lease,inspectMember,()=>admission?.isCurrent()??true);
  const dispatch=new WorkspaceDispatchService(workspace,store,{inspectMember,normalizeValidationPath:normalizeArtifact,checkValidationFiles:(files,signal)=>artifactFiles.checkFiles(files,signal),checkManifest:(snapshot,signal)=>manifestFiles.check(snapshot,signal),inspectMain:async(rootSessionId,runId)=>{
    workspace.assert();
    const summary=await storage.read(path.join(workspace.paths.project(workspace.entry.id),'loop-engine','tasks',safeId(rootSessionId),safeId(runId)));
    if(summary.task.workspaceId!==workspace.entry.id||summary.task.root!==workspace.entry.path||summary.task.taskId!==rootSessionId||summary.runId!==runId||summary.task.agentId!=='cbim:main')throw Error('主调度证据不属于当前会话或运行');
    return summary;
  }},budgetPolicy,{normalizePath:normalizeArtifact,checkFiles:(files,signal)=>artifactFiles.checkFiles(files,signal),checkManifest:(snapshot,signal)=>manifestFiles.check(snapshot,signal),acquireRead:()=>{workspace.assert();return lease.acquire('human-decision:'+randomUUID(),'read')},acquireMainRead:rootSessionId=>{workspace.assert();return lease.acquireReadWithin('human-evidence:'+randomUUID(),'conversation:'+safeId(rootSessionId))},assertCurrent:()=>{workspace.assert();if(admission&&!admission.isCurrent())fail('HUMAN_UNAVAILABLE','工作区正在停止，未保存新的人工决定')}},models,{inspect:inspectMember,normalizePath:normalizeArtifact},{inspectMember,observeKnowledge:(reference,signal)=>observeKnowledgeTransaction(workspace,reference,signal),observePersistent:(reference,signal)=>observePersistentWrite(workspace,reference,signal),observeControlled:async(input,signal)=>{signal?.throwIfAborted();const value=await controlledFiles.report(input);signal?.throwIfAborted();return value},normalizePath:normalizeArtifact,observeFiles:(paths,signal)=>artifactFiles.observeFiles(paths,signal),acquireRead:()=>{workspace.assert();return lease.acquire('effect-observation:'+randomUUID(),'read')},acquireMainRead:rootSessionId=>{workspace.assert();return lease.acquireReadWithin('effect-proof:'+randomUUID(),'conversation:'+safeId(rootSessionId))},assertCurrent:()=>{workspace.assert();if(admission&&!admission.isCurrent())fail('EFFECT_UNAVAILABLE','工作区正在停止，未保存新的处置')}},{...checkpointPorts,acquireRead:()=>{workspace.assert();return lease.acquire('member-pause:'+randomUUID(),'read')},assertCurrent:()=>{workspace.assert();if(admission&&!admission.isCurrent())fail('GOAL_MEMBER_PAUSE_UNAVAILABLE','工作区正在停止，原成员等待未消费')}});
  const requestBudgets=new ModelRequestBudgetService(workspace,requestBudgetStore(store),dispatch.budgets);
  const prepareEngine=(llm:ResolvedLlm,options:MemberStartOptions):PreparedEngine=>{
      return {model:structuredClone(llm.profile),availableTools:nativeToolNames(options.permission!=='read',llm.profile.engine),scopedTools:process.platform==='win32'&&process.arch==='x64'?['cbim_scoped_read',...(options.permission!=='read'?['cbim_scoped_node',...(controlledTransport?['cbim_file_write_controlled']:[])]:[])]:undefined,availableValidators:['json-schema-v1','csv-table-v1','png-raster-v1'],create:async(run,task,hooks)=>{
        workspace.assert();
        if(run.binding.workspaceId!==workspace.entry.id||task.identity.workspaceId!==workspace.entry.id)throw Error('成员运行与工作区身份不匹配');
        if(JSON.stringify(run.model)!==JSON.stringify(llm.profile))throw Error('成员运行模型快照与启动配置不一致');
        const checkpointState=await store.read(),previous=run.resumeFrom?checkpointState.runs?.find(old=>old.binding.runId===run.resumeFrom!.runId):undefined;
        if(run.resumeFrom&&(!previous?.checkpointProof||previous.checkpointProof.checkpoint.checkpointId!==run.resumeFrom.checkpointId))fail('MEMBER_CHECKPOINT_INVALID','续执行缺少原检查点证明');
        const executionScope=preparedExecutionScope(run.prepared.modules.map(module=>({contract:module.workflowContract})));
        const scopedExecution=executionScope?new ScopedExecutionFiles(workspace.entry.path,executionScope,()=>{workspace.assert();if(admission&&!admission.isCurrent())fail('EXECUTION_SCOPE_STOPPED','工作区正在停止')},[workspace.paths.userRoot,workspace.paths.installRoot],isolatedExecutions.forRun(run,task.scopeId!,executionScope)):undefined;
        const runFiles=scopedExecution?new ArtifactFiles(workspace.entry.path,()=>workspace.assert(),(file,signal)=>scopedExecution.snapshot(file,signal)):artifactFiles;
        const runManifests=scopedExecution?new OutputManifestFiles(workspace.entry.path,()=>workspace.assert(),{files:runFiles,lockDirectory:file=>scopedExecution.lockDirectory(file)}):manifestFiles;
        const controlled=task.scopeId?controlledFiles.forRun(run,task.scopeId):undefined;
        const transitions=createArtifactTransitionPort(workspace,controlledTransport,()=>admission?.isCurrent()??true);
        const scopeWrite=(paths:string[])=>{if(executionScope&&paths.some(file=>!executionScopeCovers(executionScope.write,file)))fail('EXECUTION_SCOPE_DENIED','写入超出原任务冻结范围')};
        const runCheckpointPorts={...checkpointPorts,checkFiles:runFiles.checkFiles.bind(runFiles)};
        const loop=await createWorkspaceLoop(workspace.paths,workspace,{provider:'cbim-'+llm.profile.id,model:llm.profile.model,profileId:llm.profile.id,llm,
          permission:run.permission,turnTimeoutMs:run.turnTimeoutMs,onEvent:hooks.onEvent,requestApproval:hooks.requestApproval,requestQuestion:hooks.requestQuestion,
        },{
          memberCheckpointAllowance:memberCheckpointLimit-(task.checkpoints?.length??0),
          requestBudget:()=>requestBudgets.forRun({rootSessionId:run.binding.rootSessionId,taskId:task.taskId,runId:run.binding.runId,scopeId:task.scopeId,kind:'member'},llm),
          storage,member:{directory:runsDirectory,prompt:memberExecutionPrompt(run.prepared,task,run.prerequisites),workflowContracts:preparedWorkflowContracts(run.prepared)},onEngineReady:hooks.onEngineReady,
          artifacts:{knowledgeRevision:run.prepared.knowledgeRevision,normalizePath:normalizeArtifact,assertCurrentKnowledge:async()=>{workspace.assert();await recheckDispatchExecutionContext(workspace,run.prepared)},captureFiles:(paths,signal)=>runFiles.captureFiles(paths,signal)},
          manifests:{knowledgeRevision:run.prepared.knowledgeRevision,assertCurrentKnowledge:async()=>{workspace.assert();await recheckDispatchExecutionContext(workspace,run.prepared)},capture:(scopes,signal)=>runManifests.capture(scopes,signal)},
          validations:{validateFile:(file,schema,signal)=>runFiles.validateFile(file,schema,signal),validateTable:(file,schema,signal)=>runFiles.validateTable(file,schema,signal),validateImage:(file,schema,signal)=>runFiles.validateImage(file,schema,signal),checkFiles:(files,signal)=>runFiles.checkFiles(files,signal)},
          scopedExecution,
          controlledFiles:controlled?{scopeId:controlled.scopeId,write:(input,authorization,signal,assertCurrent)=>{scopeWrite([input.path]);return controlled.write(input,authorization,signal,assertCurrent)},confirmNotApplied:controlled.confirmNotApplied?.bind(controlled),drain:controlled.drain.bind(controlled)}:undefined,
          artifactTransitions:transitions?{withExclusive:(operation,signal,use)=>{scopeWrite(artifactTransitionPaths(operation));return transitions.withExclusive(operation,signal,use)},drain:transitions.drain.bind(transitions)}:undefined,
          // 领取后到 Pi 发出首条 prompt 前仍有异步准备；每个准备边界复核原证明，不只核原生文件而遗漏外部业务文件变化。
          assertMemberResume:previous?async()=>{await verifyMemberCheckpointProof(workspace,task,previous,runCheckpointPorts,()=>workspace.assert(),previous.checkpointProof,checkpointState.runs)}:undefined,
          assertMemberResumeInputs:previous?()=>verifyMemberCheckpointInputs(workspace,task,previous,runCheckpointPorts,()=>workspace.assert(),previous.checkpointProof!,checkpointState.runs):undefined,
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
    checkpoints:{nativeFingerprint},
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
  return {dispatch,members,workspaceMembers,moduleOwnerships,controlledFiles,isolatedExecutions,requestBudgets};
}
