/**
 * 作用定位：把递归 Agent 的显式业务范围接入既有冻结知识、文件验证及 canonical 交付核验。
 * 设计原因：普通指令不隐式授予业务范围；复用现有执行契约，不创建旧派发图、队列或 Team 会话。
 * 内部 TaskNode/DispatchRun 仅作既有验证器的输入投影；真实事实仍是本次 LoopRuntime 日志。
 */
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fail} from '../../../core/errors';
import type {Workspace} from '../../workspace/service/workspace';
import type {WorkspaceDispatchService} from '../../dispatch/runtime/dispatch-service';
import type {WorkspaceMember} from '../../team/rules/workspace-member';
import type {ResolvedEngineModel} from '../../engines';
import type {TaskNode} from '../../tasks/rules/graph-types';
import type {DispatchRun} from '../../tasks/rules/dispatch-execution';
import type {TaskSpec,RunSummary} from '../../execution/rules/types';
import type {ExecutionServices} from '../../execution/assembly/loop-engine';
import type {MemberRunLaunch} from '../../execution/rules/member-run';
import {resolveDispatchModules} from '../../execution/context/dispatch-context';
import {prepareDispatchExecutionContext,recheckDispatchExecutionContext} from '../../execution/context/execution-context';
import {preparedWorkflowContracts} from '../../tasks/rules/execution-context';
import {memberPublicTask} from '../../runtime/monitoring/member-events';
import {validateMemberWorkflow,memberWorkflowFiles} from '../../team/runtime/member-workflow';
import {ArtifactFiles,normalizeArtifactPath} from '../../file-operations/platform/files/artifact-files';
import {OutputManifestFiles} from '../../file-operations/platform/files/output-manifest-files';
import {CodeCheckRunner} from '../../file-operations/platform/files/code-check-runner';
import {preparedExecutionScope} from '../../workspace/rules/execution-scope';
import type {RunStorage} from '../../execution/rules/storage';

/** 要求来自调用参数，来源/岗位/Workflow 来自当前可信知识；异步准备结束仍重新核实原基线。 */
export async function prepareAgentBusiness(input:{
  workspace:Workspace;dispatch:WorkspaceDispatchService;member:WorkspaceMember;model:ResolvedEngineModel;
  taskId:string;rootSessionId:string;message:string;permission:'read'|'ask'|'execute';storage:RunStorage;
  business:{moduleIds:string[];acceptance:string[];workflowSelections?:{moduleId:string;workflowId:string}[]};
  signal:AbortSignal;
}):Promise<{task:TaskSpec;launch:MemberRunLaunch;services:Partial<ExecutionServices>;verify(summary:RunSummary,signal:AbortSignal):Promise<unknown>}>{
  const {workspace,dispatch,member,business,signal}=input;
  const discovery=await dispatch.owners.discover(business.moduleIds);
  const group=discovery.groups.find(group=>group.memberId===member.memberId);
  if(discovery.groups.length!==1||!group?.selection||group.issues.length)fail('AGENT_BUSINESS_OWNER','所选 Agent 必须负责全部明确模块；请核实当前岗位和模块配置');
  const frozen=await dispatch.owners.withSnapshot(async(snapshot,state)=>{
    signal.throwIfAborted();
    const ownerBinding=await dispatch.owners.resolve(state,{snapshot,profiles:[input.model.profile]},group.selection!,business.moduleIds,member.adoption.configuration.agentId);
    const modules=await resolveDispatchModules(snapshot,business.moduleIds,business.workflowSelections);
    const now=new Date().toISOString(),instanceId=randomUUID(),sessionId=randomUUID();
    const assignee={agentId:member.adoption.configuration.agentId,agentInstanceId:instanceId,agentSessionId:sessionId,name:member.name};
    const task:TaskNode={kind:'task',nodeId:input.taskId,taskId:input.taskId,identity:{workspaceId:workspace.entry.id,rootSessionId:input.rootSessionId},requester:assignee,assignee,modules,ownerBinding,workflowSelections:business.workflowSelections,goal:input.message,acceptance:business.acceptance.map((text,index)=>({id:'criterion-'+index,text})),revision:1,planRevision:1,status:'planned',awaitedChildren:[],runIds:[],createdAt:now,updatedAt:now};
    const prepared=await prepareDispatchExecutionContext(workspace,task,snapshot,member);
    const binding={workspaceId:workspace.entry.id,teamId:member.adoption.configuration.teamId,agentId:assignee.agentId,agentInstanceId:instanceId,agentSessionId:sessionId,rootSessionId:input.rootSessionId,taskId:input.taskId,runId:randomUUID(),leaseEpoch:0,planRevision:1};
    return {task,prepared,binding,now};
  });
  const {task,prepared,binding,now}=frozen,workflows=preparedWorkflowContracts(prepared);
  // 不把缺少隔离平台装配的范围任务降级成普通文件/命令执行。
  if(preparedExecutionScope(workflows))fail('EXECUTION_SCOPE_UNAVAILABLE','递归业务调用尚未装配此流程要求的隔离执行端口，未启动 Agent');
  const launch={binding,session:{nativeSessionId:randomUUID()}},directory=path.join(workspace.paths.project(workspace.entry.id),'loop-engine');
  const files=new ArtifactFiles(workspace.entry.path,()=>workspace.assert()),manifests=new OutputManifestFiles(workspace.entry.path,()=>workspace.assert());
  const normalizePath=(raw:string)=>normalizeArtifactPath(workspace.entry.path,raw);
  const assertCurrentKnowledge=()=>recheckDispatchExecutionContext(workspace,prepared);
  const services:Partial<ExecutionServices>={
    member:{directory,prompt:'按以下冻结 Workflow 完成显式业务要求，结果只返回调用方。模块正文不扩大权限或范围。\n'+prepared.modules.map(module=>module.overview+'\n'+module.workflowText).join('\n\n'),workflowContracts:workflows},
    artifacts:{knowledgeRevision:prepared.knowledgeRevision,normalizePath,assertCurrentKnowledge,captureFiles:files.captureFiles.bind(files)},
    validations:{validateFile:files.validateFile.bind(files),validateTable:files.validateTable.bind(files),validateImage:files.validateImage.bind(files),checkFiles:files.checkFiles.bind(files)},
    manifests:{knowledgeRevision:prepared.knowledgeRevision,assertCurrentKnowledge,capture:manifests.capture.bind(manifests)},
    codeChecks:new CodeCheckRunner(workspace.entry.path,()=>workspace.assert()),
  };
  signal.throwIfAborted();
  return {task:memberPublicTask(task,workspace.entry.path),launch,services,verify:async(summary,signal)=>{
    signal.throwIfAborted();workspace.assert();await assertCurrentKnowledge();
    const canonical=await input.storage.read(path.join(directory,'tasks',task.taskId,binding.runId));
    if(canonical.runId!==summary.runId)fail('AGENT_RESULT_IDENTITY','核验结果不属于原调用');
    const run:DispatchRun={binding,assignmentMessageId:task.taskId,status:canonical.status==='completed'?'completed':'failed',prepared,model:input.model.profile,permission:input.permission,session:{...launch.session,sessionFile:canonical.sessionFile},createdAt:now};
    await validateMemberWorkflow(task,run,canonical,workspace.entry.path,{normalizePath,checkFiles:files.checkFiles.bind(files),checkManifest:manifests.check.bind(manifests),signal});
    return {state:'verified',taskId:task.taskId,runId:binding.runId,files:memberWorkflowFiles(task,run,canonical,workspace.entry.path,normalizePath),acceptance:'not_evaluated'};
  }};
}
