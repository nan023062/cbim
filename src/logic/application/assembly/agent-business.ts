/**
 * 每个新业务登记冻结原目标与验收文本，供独立核实后修复继承；旧记录不据损坏日志补造要求。
 * 作用定位：把递归 Agent 的显式业务范围接入既有冻结知识、文件验证及 canonical 交付核验。
 * 设计原因：普通指令不隐式授予业务范围；复用现有执行契约，不创建旧派发图、队列或 Team 会话。
 * 内部 TaskNode/DispatchRun 仅作既有验证器的输入投影；真实事实仍是本次 LoopRuntime 日志。
 * 实现形式：工作区执行装配入口；普通文件采集和结构验证分别复核，未配置验证器不等于字节仍有效。
 */
import path from 'node:path';

import { validateWorkflowEvidence } from '../../evidence/rules/workflow-evidence';

import { AgentArtifactVerification } from '../../evidence/runtime/agent-artifact-verification';

import type { AgentCallReference } from '../../../framework/office/call';

import type { AgentBusinessRun } from '../../execution/rules/business-run';

import { ScopedExecutionFiles } from '../../file-operations/platform/files/scoped-execution-files';

import { executionScopeCovers } from '../../workspace/rules/execution-scope';

import { artifactTransitionPaths } from '../../workspace/rules/artifact-scope';

import { randomUUID } from 'node:crypto';

import type { Workspace } from '../../workspace/service/workspace';

import type { WorkspaceDispatchService } from '../../dispatch/runtime/dispatch-service';

import type { WorkspaceMember } from '../../team/rules/workspace-member';

import type { ResolvedEngineModel } from '../../engines';

import type { TaskNode } from '../../tasks/rules/graph-types';

import type { DispatchRun } from '../../tasks/rules/dispatch-execution';

import type { TaskSpec, RunSummary } from '../../execution/rules/types';

import type { ExecutionServices } from '../../execution/assembly/loop-engine';

import type { MemberRunLaunch } from '../../execution/rules/member-run';

import { resolveDispatchModules } from '../../execution/context/dispatch-context';

import { prepareDispatchExecutionContext, recheckDispatchExecutionContext } from '../../execution/context/execution-context';

import { preparedWorkflowContracts } from '../../tasks/rules/execution-context';

import { memberPublicTask } from '../../runtime/monitoring/member-events';

import { validateMemberWorkflow, memberWorkflowFiles } from '../../team/runtime/member-workflow';

import { ArtifactFiles, normalizeArtifactPath } from '../../file-operations/platform/files/artifact-files';

import { OutputManifestFiles } from '../../file-operations/platform/files/output-manifest-files';

import { CodeCheckRunner } from '../../file-operations/platform/files/code-check-runner';

import { preparedExecutionScope } from '../../workspace/rules/execution-scope';

import type { RunStorage } from '../../execution/rules/storage';

/** 所有端口由同一工作区生命周期持有，不从对话或模型参数创建。 */
export interface AgentBusinessServices
{
  runs: import('../../execution/storage/business-runs').AgentBusinessRuns;

  controlledFiles: import('../../file-operations/service/controlled-files').ControlledFiles;

  isolatedExecutions: import('../../file-operations/service/isolated-executions').IsolatedExecutions;
}

/** 要求来自调用参数，来源/岗位/Workflow 来自当前可信知识；异步准备结束仍重新核实原基线。 */
export async function prepareAgentBusiness(input: { workspace: Workspace; dispatch: WorkspaceDispatchService; member: WorkspaceMember; model: ResolvedEngineModel; taskId: string; parentTaskId: string; rootSessionId: string; message: string; permission: 'read' | 'ask' | 'execute'; storage: RunStorage; business: { moduleIds: string[]; acceptance: string[]; workflowSelections?: { moduleId: string; workflowId: string }[] }; signal: AbortSignal; scopeId: string; reference: (taskId: string, runId: string) => AgentCallReference; businessServices?: AgentBusinessServices; /** 既有平台端口只执行冻结 Workflow 内的单项操作；阶段与证明仍由本运行日志拥有。 */ artifactTransitions?: ExecutionServices['artifactTransitions']; }): Promise<{ rejection: { code: string; message: string } } | { workflows: import('../../../framework/office').OfficeWorkflow[]; task: TaskSpec; launch: MemberRunLaunch; services: Partial<ExecutionServices>; BeforeRun(runId: string): Promise<void>; Close(): Promise<void>; Verify(summary: RunSummary, signal: AbortSignal): Promise<unknown> }>
{
  const { workspace, dispatch, member, business, signal } = input;

  const discovery = await dispatch.owners.Discover(business.moduleIds);

  const group = discovery.groups.find(group => group.memberId === member.memberId);

  if (discovery.groups.length !== 1 || !group?.selection || group.issues.length)
    return { rejection: { code: 'AGENT_BUSINESS_OWNER', message: '所选 Agent 必须负责全部明确模块；请核实当前岗位和模块配置' } };

  const frozen = await dispatch.owners.WithSnapshot(async (snapshot, state) => { signal.throwIfAborted(); const ownerBinding = await dispatch.owners.Resolve(state, { snapshot, profiles: [input.model.profile] }, group.selection!, business.moduleIds, member.adoption.configuration.agentId); const modules = await resolveDispatchModules(snapshot, business.moduleIds, business.workflowSelections); const now = new Date().toISOString(), instanceId = randomUUID(), sessionId = randomUUID(); const assignee = { agentId: member.adoption.configuration.agentId, agentInstanceId: instanceId, agentSessionId: sessionId, name: member.name }; const task: TaskNode = { kind: 'task', nodeId: input.taskId, taskId: input.taskId, parentTaskId: input.parentTaskId, identity: { workspaceId: workspace.entry.id, rootSessionId: input.rootSessionId }, requester: assignee, assignee, modules, ownerBinding, workflowSelections: business.workflowSelections, goal: input.message, acceptance: business.acceptance.map((text, index) => ({ id: 'criterion-' + index, text })), revision: 1, planRevision: 1, status: 'planned', awaitedChildren: [], runIds: [], createdAt: now, updatedAt: now }; const prepared = await prepareDispatchExecutionContext(workspace, task, snapshot, member); const binding = { workspaceId: workspace.entry.id, teamId: member.adoption.configuration.teamId, agentId: assignee.agentId, agentInstanceId: instanceId, agentSessionId: sessionId, rootSessionId: input.rootSessionId, taskId: input.taskId, runId: randomUUID(), leaseEpoch: 0, planRevision: 1 }; return { task, prepared, binding, now }; });

  const { task, prepared, binding, now } = frozen,
    workflows = preparedWorkflowContracts(prepared);

  // 平台端口仍执行原冻结范围；运行身份先持久化，不能降级到任意文件命令。
  const ports = input.businessServices ?? (() => { throw new Error('缺少可信业务运行服务，未启动 Agent'); })();

  const record: Omit<AgentBusinessRun, 'lineage'> = { protocol: 'agent-tools-v1', binding, scopeId: input.scopeId, parent: input.reference(task.taskId, binding.runId), prepared, permission: input.permission, request: { message: input.message, acceptance: [...business.acceptance] }, status: 'active', createdAt: now };

  const executionScope = preparedExecutionScope(workflows);

  const assertActive = () => { workspace.Assert(); signal.throwIfAborted() };

  const scopedExecution = executionScope ? new ScopedExecutionFiles(workspace.entry.path, executionScope, assertActive, [workspace.paths.userRoot, workspace.paths.installRoot, ...(workspace.paths.protectedRoots ?? [])], ports.isolatedExecutions.ForRun(record, input.scopeId, executionScope)) : undefined;

  const scopeWrite = (paths: string[]) => { if (executionScope && paths.some(file => !executionScopeCovers(executionScope.write, file))) throw new Error('写入超出原调用冻结范围') };

  const controlled = ports.controlledFiles.ForRun(record, input.scopeId),
    transitions = input.artifactTransitions;

  let registrationAttempted = false;

  const launch = { binding, session: { nativeSessionId: randomUUID() } },
    directory = path.join(workspace.paths.Project(workspace.entry.id), 'loop-engine');

  const files = new ArtifactFiles(workspace.entry.path, () => workspace.Assert(), scopedExecution ? (file, signal) => scopedExecution.Snapshot(file, signal) : undefined),
    manifests = new OutputManifestFiles(workspace.entry.path, () => workspace.Assert(), scopedExecution ? { files, LockDirectory: file => scopedExecution.LockDirectory(file) } : undefined);

  const normalizePath = (raw: string) => normalizeArtifactPath(workspace.entry.path, raw);

  const assertCurrentKnowledge = () => recheckDispatchExecutionContext(workspace, prepared);

  const services: Partial<ExecutionServices> = {
    scopedExecution,
    controlledFiles: controlled ? {
      scopeId: controlled.scopeId, Write: (input, authorization, signal, assertCurrent) => { scopeWrite([input.path]); return controlled.Write(input, authorization, signal, assertCurrent) }, ConfirmNotApplied: controlled.ConfirmNotApplied?.bind(controlled), Drain: controlled.Drain.bind(controlled)
    } : undefined,
    artifactTransitions: transitions ? {
      WithExclusive: (operation, signal, use) => { scopeWrite(artifactTransitionPaths(operation)); return transitions.WithExclusive(operation, signal, use) }, Drain: transitions.Drain.bind(transitions)
    } : undefined,
    member: { directory, prompt: '按以下冻结 Workflow 完成显式业务要求，结果只返回调用方。模块正文不扩大权限或范围。\n' + prepared.modules.map(module => module.overview + '\nWorkflow ' + module.binding.moduleId + ' / ' + module.binding.workflow.id + '\n' + module.workflowText).join('\n\n'), workflowContracts: workflows },
    artifacts: { knowledgeRevision: prepared.knowledgeRevision, NormalizePath: normalizePath, AssertCurrentKnowledge: assertCurrentKnowledge, CaptureFiles: files.CaptureFiles.bind(files) },
    validations: { ValidateFile: files.ValidateFile.bind(files), ValidateTable: files.ValidateTable.bind(files), ValidateImage: files.ValidateImage.bind(files), CheckFiles: files.CheckFiles.bind(files) },
    manifests: { knowledgeRevision: prepared.knowledgeRevision, AssertCurrentKnowledge: assertCurrentKnowledge, Capture: manifests.Capture.bind(manifests) },
    codeChecks: new CodeCheckRunner(workspace.entry.path, () => workspace.Assert()),
  };

  signal.throwIfAborted();

  return {
    workflows: prepared.modules.flatMap(({ binding, workflowText, availableWorkflows }) => {
      const list = (availableWorkflows ?? []).map(workflow => ({ ...workflow, workspaceId: binding.moduleId }));
      if (!list.some(workflow => workflow.skillId === binding.workflow.id))
        list.push({ workspaceId: binding.moduleId, ownerId: binding.moduleId, skillId: binding.workflow.id, content: workflowText });
      return list;
    }),
    task: memberPublicTask(task, workspace.entry.path), launch, services,
    BeforeRun: async runId => { if (runId !== binding.runId) throw new Error('启动身份与冻结业务不一致'); registrationAttempted = true; await ports.runs.Start(record) },
    Close: async () => { if (registrationAttempted) await ports.runs.Close(record) }, Verify: async (summary, signal) =>
    {
      signal.throwIfAborted();

      workspace.Assert();

      await assertCurrentKnowledge();

      const canonical = await input.storage.Read(path.join(directory, 'tasks', task.taskId, binding.runId));

      if (canonical.runId !== summary.runId)
        throw new Error('核验结果不属于原调用');

      if (canonical.logIntegrity?.partialTail !== false || canonical.unresolvedTools.length)
        throw new Error('原业务调用日志不完整，不能验证交付');

      // 无附加约定不是免交付：显式业务调用仍核原计划、真实步骤证据和成功交付回执。
      if (!workflows.length)
        validateWorkflowEvidence(canonical.events, memberPublicTask(task, workspace.entry.path), [], [], undefined, { requireDelivery: true });

      const run: DispatchRun = { binding, assignmentMessageId: task.taskId, status: canonical.status === 'completed' ? 'completed' : 'failed', prepared, model: input.model.profile, permission: input.permission, session: { ...launch.session, sessionFile: canonical.sessionFile }, createdAt: now };

      await validateMemberWorkflow(task, run, canonical, workspace.entry.path, { NormalizePath: normalizePath, CheckFiles: files.CheckFiles.bind(files), CheckManifest: manifests.Check.bind(manifests), signal });

      // 结构验证器不覆盖普通文本采集；交付及人工接受均须复核原采集字节。
      const captured = await AgentArtifactVerification.Verify(canonical.events, binding, prepared.knowledgeRevision, normalizePath, files.CheckFiles.bind(files), signal);

      const currentFiles = new Map([...memberWorkflowFiles(task, run, canonical, workspace.entry.path, normalizePath), ...captured].map(file => [normalizePath(file.relativePath), file]));

      return { state: 'verified', taskId: task.taskId, runId: binding.runId, files: [...currentFiles.values()], acceptance: 'not_evaluated' };
    }
  };
}
