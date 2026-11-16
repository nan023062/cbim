/**
 * 作用定位：重读只读递归核实的根与业务子调用，形成正式修复前的证据摘要。
 * 设计原因：新调用不使用旧目标计划和派工图；核证复用冻结 Workflow、文件和完整日志规则，不补造旧任务或审阅。
 * 职责边界：只读取已封存记录和当前文件，不启动模型、不修改旧事实、不授予写入或人工验收。
 */
import { fail } from '../../../core/errors';
import { hash, json } from '../../../core/platform/node/serialization';
import type { DispatchState } from '../../dispatch/rules/dispatch-storage';
import type { DispatchScope } from '../../tasks/rules/dispatch-scope';
import type { KnowledgeWorkspace } from '../../knowledge/rules/ports';
import type { RunSummary } from '../../execution/rules/types';
import { preparedWorkflowContracts } from '../../tasks/rules/execution-context';
import { recursiveEvidenceRun, recursiveEvidenceLogMatches } from './recursive-evidence-source';
import { executionToolFacts } from './execution-report-facts';
import { validateBusinessWorkflow, type WorkflowFileVerification } from '../../team/runtime/member-workflow';
import { validateWorkflowEvidence } from '../rules/workflow-evidence';
import { AgentArtifactVerification } from './agent-artifact-verification';

interface Ports
{
  /** 目标服务核对本周期补充输入与实际根日志；证据模块不反向读取任务运行服务。 */
  ValidateActiveInputs(summary: RunSummary): void;

  InspectMain(taskId: string, runId: string): Promise<RunSummary>;

  InspectAgent?(taskId: string, runId: string): Promise<RunSummary>;

  normalizeValidationPath?: WorkflowFileVerification['NormalizePath'];

  checkValidationFiles?: WorkflowFileVerification['CheckFiles'];

  checkManifest?: WorkflowFileVerification['CheckManifest'];
}

function check(condition: unknown, message: string): asserts condition
{
  if (!condition)
    fail('REPLAN_PROOF_INVALID', message)
}

/** 无状态核证器；证据稳定性由二次读取核实，不把文件检查描述成跨文件事务。 */
export class RecursiveInspectionEvidence
{
  private constructor()
  {
  }

  static async Verify(state: DispatchState, scope: DispatchScope, owner: Pick<KnowledgeWorkspace, 'entry' | 'Read'>, ports: Ports)
  {
    const recovery = scope.recovery;
    check(recovery && scope.status === 'closed' && scope.outcome === 'completed' && recovery.options.permission === 'read', '只读核实尚未完成');
    check(ports.InspectAgent && ports.normalizeValidationPath && ports.checkValidationFiles, '缺少递归运行或文件核证端口');
    check(scope.runTracking?.mainRunIds.length === 1 && scope.runTracking.mainRunIds[0] === recovery.context.initialRunId, '核实根身份不唯一');
    const knowledge = await owner.Read(),
      main = await ports.InspectMain(scope.rootSessionId, recovery.context.initialRunId);
    const audit = (summary: RunSummary) =>
    {
      check(summary.status === 'completed' && summary.logIntegrity?.partialTail === false && !summary.unresolvedTools.length && summary.events.at(-1)?.type === 'run.settled', '核实日志缺失、未完成或有未决操作');
      const facts = executionToolFacts(summary, { binding: { workspaceId: scope.workspaceId, taskId: summary.task.taskId, runId: summary.runId } });
      check(!facts.invalid && !facts.counts.unknown && !facts.counts.failed && !facts.counts.denied, '核实工具含失败或未知结果');
      check(!facts.items.some(item => item.allowedSeq !== undefined && (item.effects.some(effect => ['business-write', 'knowledge-write', 'external-write', 'command'].includes(effect)) || ['write', 'edit', 'bash'].includes(item.toolName))), '只读核实含写入或命令授权');
    };
    audit(main);
    ports.ValidateActiveInputs(main);
    const head = main.events[0],
      fresh = head?.data.freshMain as
        {
          nativeSessionId?: unknown;

          excludedRunIds?: unknown
        } | undefined;
    check(main.task.workspaceId === scope.workspaceId && main.task.taskId === scope.rootSessionId && main.task.agentId === 'cbim:main' && head?.data.executionModel === 'agent-tools-v1' && !head.data.resumeFrom && fresh?.nativeSessionId === recovery.context.nativeSessionId && json(fresh.excludedRunIds) === json(recovery.context.excludedRunIds), '核实根缺少可信全新上下文');
    check(main.events.every((event, index) => event.seq === index + 1 && event.workspaceId === scope.workspaceId && event.taskId === scope.rootSessionId && event.runId === main.runId), '核实根日志身份不连续');
    const bounds = main.events.filter(event => event.type === 'session.bound');
    check(!!main.sessionFile && bounds.length > 0 && bounds.every(event => event.data.sessionId === recovery.context.nativeSessionId && event.data.sessionFile === main.sessionFile), '核实根原生绑定无效');
    const runs = (state.agentBusinessRuns ?? []).filter(run => run.scopeId === scope.scopeId),
      recorded: RunSummary[] = [];
    check(runs.length > 0, '核实缺少实际业务子调用');
    for (const run of runs)
    {
      check(run.status === 'closed' && run.permission === 'read' && run.prepared.knowledgeRevision === knowledge.revision, '核实运行未封存、权限或知识已变化');
      check(recursiveEvidenceRun(state, scope.workspaceId, scope.rootSessionId, run.binding.taskId, run.binding.runId) === run, '核实业务来源不唯一');
      const summary = await ports.InspectAgent(run.binding.taskId, run.binding.runId);
      audit(summary);
      check(recursiveEvidenceLogMatches(run, summary, owner.entry.path), '核实子调用日志不匹配原登记');
      if (run.request)
        check(run.request.message === summary.task.goal && json(run.request.acceptance) === json(summary.task.acceptance), '核实要求与原登记不一致');
      if (!preparedWorkflowContracts(run.prepared).length)
        validateWorkflowEvidence(summary.events, summary.task, [], [], undefined, { requireDelivery: true });
      await validateBusinessWorkflow(summary.task, { prepared: run.prepared, binding: run.binding, session: { nativeSessionId: String(summary.events[0].data.nativeSessionId), sessionFile: summary.sessionFile } }, summary, { NormalizePath: ports.normalizeValidationPath, CheckFiles: ports.checkValidationFiles, CheckManifest: ports.checkManifest });
      await AgentArtifactVerification.Verify(summary.events, run.binding, run.prepared.knowledgeRevision, ports.normalizeValidationPath, ports.checkValidationFiles, new AbortController().signal);
      recorded.push(summary);
    }
    check(json(await ports.InspectMain(scope.rootSessionId, main.runId)) === json(main), '核实根读取期间变化');
    for (const summary of recorded)
      check(json(await ports.InspectAgent(summary.task.taskId, summary.runId)) === json(summary), '核实子调用读取期间变化');
    check((await owner.Read()).revision === knowledge.revision, '核实期间知识变化');
    return { knowledgeRevision: knowledge.revision, coveredModuleIds: [...new Set(runs.flatMap(run => run.prepared.modules.map(module => module.binding.moduleId)))].sort(), evidenceDigest: hash(json({ scope, runs, main, recorded })) };
  }
}
