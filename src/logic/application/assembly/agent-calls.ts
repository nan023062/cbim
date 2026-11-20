import { readProjectOrganization } from '../../project';

import type { Office } from '../../../framework/office';

import { composeTaskSkills } from '../../../framework/office';

import { engineConfigurations } from '../../engines/service';

/**
 * 作用定位：把 Agent 对象与 execution 的调用协调器、LoopRuntime 装配到工作区真实引擎、准入和请求账本。
 * 设计原因：复用 execution 的运行生命周期和全局准入，避免重复循环和本根并发账本；根运行持工作区租约，后代只在独占工具交接中执行。
 * 支持边界：子调用捕获岗位自己的冻结模型和价格，计入同一根账本；子求助交给直接调用方，人工评审只使用根对话原用户队列。
 */
import type { MainToolContext } from '../../execution/rules/conversation-binding';

import { OfficeHistoryTools } from '../../tools/runtime/office-history-tools';

import { prepareAgentBusiness, type AgentBusinessServices } from './agent-business';

import { randomUUID } from 'node:crypto';

import { AgentRole, type AgentDescription } from '../../../framework/cability/agent';

import { type AgentToolContext } from '../../execution/rules/agent-call-contracts';

import { AgentCallScheduler } from '../../execution/assembly/agent-call-scheduler';

import type { AgentLifecycle } from '../../execution/rules/agent-call-contracts';

import { AgentConstraintError } from '../../../framework/office/call';

import { createWorkspaceLoop, type WorkspaceLoopOptions, type ExecutionServices } from '../../execution/assembly/loop-engine';

import type { Workspace } from '../../workspace/service/workspace';

import type { WorkspaceMembers } from '../../team/service/workspace-members';

import { workspaceMemberModelHash } from '../../team/rules/workspace-member-rules';

import { workspaceMemberEngine } from '../../team/rules/workspace-member';

import type { ResolvedEngineModel as ResolvedLlm } from '../../engines';

import type { EngineModelProfiles as LlmProfiles } from '../../engines/service';

import type { TaskSpec, RunSummary } from '../../execution/rules/types';

import type { RunStorage } from '../../execution/rules/storage';

import type { WorkspaceAdmission } from './execution-admission';

import type { WorkspaceDispatchService } from '../../dispatch/runtime/dispatch-service';

import type { ModelRequestBudgetService } from '../../budget/runtime/model-request-budget-service';

import type { RequestBudgetPort } from '../../budget/rules/request-budget';

export interface AgentCallAssemblyInput
{
  office: Office;

  businessServices?: AgentBusinessServices;

  workspace: Workspace;

  task: TaskSpec;

  options: WorkspaceLoopOptions;

  modelAdapters?: ExecutionServices['modelAdapters'];

  connectorProducts?: ExecutionServices['connectorProducts'];

  connectorServers?: ExecutionServices['ConnectorServers'];

  extensions?: ExecutionServices['extensions'];

  llm?: ResolvedLlm;

  storage: RunStorage;

  members?: WorkspaceMembers;

  admission?: WorkspaceAdmission;

  dispatch?: WorkspaceDispatchService;

  requestBudgets?: ModelRequestBudgetService;

  models?: Pick<LlmProfiles, 'WithRuntimeConfiguration'>;

  authorizeNative: ExecutionServices['AuthorizeNative'];

  /** 可信宿主为每个业务子调用创建端口；普通调用不继承删除/移动能力。 */
  artifactTransitions?: () => ExecutionServices['artifactTransitions'];
}

/** 新运行专属装配，不读取最新 scope 推断归属；旧模型入口不会调用此函数。 */
export function createAgentCallAssembly(input: AgentCallAssemblyInput)
{
  const { workspace, task, options, llm, storage, members, admission, dispatch, requestBudgets } = input;

  const officePermission = () => options.ReadPermission?.() ?? options.permission ?? (options.allowNativeExecution ? 'execute' : 'read');

  let directoryRead: ReturnType<typeof readMembers> | undefined;

  const officeInstance = input.office;

  const office = officeInstance.members;

  const organization = office.organization;

  const observe = async () => { await listMembers(); return { organization: { kind: organization.kind, id: organization.id, children: organization.children }, modules: [] }; };

  const rootAgent = new AgentRole({ id: task.agentId ?? 'cbim:main', name: '主 Agent', position: '接收用户任务、协调岗位并向用户交付成果', principles: '依据实际结果验证交付，明确尚未完成的工作。', effectiveSkills: [], references: [], instructions: '', ...(llm ? { model: { engine: options.engine ?? llm.profile.engine ?? 'pi', profileId: llm.profile.id, modelId: llm.profile.model } } : {}) } satisfies AgentDescription, { workspaceId: workspace.entry.id, taskId: task.taskId }, observe);

  let scopeId: string = randomUUID();

  const identity = { workspaceId: rootAgent.conversation.workspaceId, rootSessionId: rootAgent.conversation.taskId };

  let rootRunId: string | undefined,
    releaseBudget: (() => void) | undefined,
    opened = false,
    closed = false,
    closing = false;

  let unsupportedBudget = false;

  // 根运行共享输入回执与控制面提交的在途屏障；封存前须确认原操作均已返回。
  const inputs = new Set<Promise<unknown>>();

  const insertInput: NonNullable<AgentLifecycle['InsertInput']> = (runId, queueId, input, signal, send) => { if (closed || closing || runId !== rootRunId || !dispatch) throw new Error('原 Agent 运行已结束或缺少持久输入服务'); const operation = dispatch.activeInputs.Send(identity, scopeId, runId, queueId, input, signal, send); inputs.add(operation); return operation.finally(() => inputs.delete(operation)); };

  const requestBudgetsByRole = new Map<string, Promise<RequestBudgetPort | undefined>>();

  const budget = (_context: unknown, role = 'primary') => { if (!rootRunId) throw new Error('根运行尚未受理，不能调用模型'); let result = requestBudgetsByRole.get(role); if (!result) { result = requestBudgets?.ForRun({ rootSessionId: task.taskId, taskId: task.taskId, runId: rootRunId, kind: 'main' }, llm, role) ?? Promise.resolve(undefined); requestBudgetsByRole.set(role, result) } return result; };

  function listMembers()
  {
    return directoryRead ??= readMembers().finally(() => { directoryRead = undefined; });
  }

  async function readMembers()
  {
    const { children, ...directory } = await readProjectOrganization(workspace, members, unsupportedBudget);

    office.SetMembers(children);

    return directory;
  }

  const scheduler = new AgentCallScheduler({ maxDepth: 8 }, {
    RequestReview: options.RequestQuestion, Capacity: () => { const usage = admission?.manager.Snapshot(); return { current: usage?.occupied.length ?? 0, limit: usage?.policy.maxConcurrentRuns ?? 0 } }, List: listMembers, Prepare: async request =>
    {
      workspace.Assert();

      request.signal.throwIfAborted();

      if (!rootRunId || closed)
        throw new Error('原调用者已经结束');

      if (unsupportedBudget)
        return { rejection: { code: 'AGENT_BUDGET_MODE_UNSUPPORTED', message: '当前预算按旧运行汇总，不能可靠计量递归子调用；请使用逐请求预算或关闭该预算后创建新任务，本次未启动子 Agent' } };

      if (!members)
        throw new Error('当前宿主没有已配置的 Agent 目录');

      if (!admission)
        throw new Error('当前宿主没有真实子运行准入，未启动 Agent');

      if (!office.organization?.FindMember(request.agentId)?.available)
        await listMembers();

      if (!office.organization?.FindMember(request.agentId))
        throw new Error('当前办公室没有目标岗位');

      const detail = await members.Get({ workspaceId: workspace.entry.id, instanceId: workspace.instanceId, memberId: request.agentId });

      if (detail.member.state !== 'active')
        throw new Error('目标 Agent 已暂停或退役');

      if (detail.currentDiff.capability.status !== 'same' || detail.currentDiff.model.status !== 'same')
        return { rejection: { code: 'AGENT_CONFIGURATION_CHANGED', message: '目标 Agent 配置已变化，请先核实并采纳配置' } };

      const policy = detail.member.runtimePolicy;

      const engine = workspaceMemberEngine(policy) ?? 'pi';

      const configuration = input.models ? await engineConfigurations(input.models).WithConfiguration({ profileId: policy.profileId, modelId: policy.modelId, engine: workspaceMemberEngine(policy), modelRoles: policy.modelRoles }, async (profile, capture) => { if (workspaceMemberModelHash(profile) !== policy.configurationHash) return undefined; await requestBudgets?.Preflight(task.taskId, scopeId, { profile }); request.signal.throwIfAborted(); return capture(); }) : undefined;

      const childLlm = input.models ? configuration?.Read().resolved : llm;

      if (input.models && !childLlm)
        return { rejection: { code: 'AGENT_CONFIGURATION_CHANGED', message: '目标模型配置已变化，未启动子运行' } };

      if (!childLlm || childLlm.profile.id !== policy.profileId || childLlm.profile.model !== policy.modelId || workspaceMemberModelHash(childLlm.profile) !== policy.configurationHash)
        return { rejection: { code: 'AGENT_MODEL_UNAVAILABLE', message: '目标模型不能按冻结配置解析，未替换为根模型' } };

      request.signal.throwIfAborted();

      const childTaskId = request.child.taskId,
        definition = detail.member.adoption.configuration;

      const permit = admission.manager.Attempt({ workspaceId: workspace.entry.id, rootSessionId: task.taskId, taskId: childTaskId, scopeId, requestId: childTaskId, ownerEpoch: admission.ownerEpoch, source: 'direct', workspacePermission: options.ReadPermission ? 'execute' : officePermission() }, {
        // 根独占租约仍在；Runtime 已核实父工具批次唯一，不能将此入口暴露给任意任务。
        CanAcquire: () => undefined, Acquire: () => () => { }, IsCurrent: () => admission.IsCurrent() && !closed && !request.signal.aborted,
      });

      if (permit.kind !== 'granted')
      {
        const usage = admission.manager.Snapshot();

        throw new AgentConstraintError('AGENT_CONCURRENCY_LIMIT', '当前真实运行名额不足，未启动子 Agent；父进程仍计入资源占用', { current: usage.occupied.length, requested: 1, limit: usage.policy.maxConcurrentRuns, unit: 'process' })
      }

      try
      {
        if (request.parent.task.moduleIds.length && (!request.business || request.business.moduleIds.some(id => !request.parent.task.moduleIds.includes(id))))
          throw new Error('业务子调用须保留父调用的冻结模块范围');

        const business = request.business ? await prepareAgentBusiness({ workspace, dispatch: dispatch ?? (() => { throw new Error('缺少业务来源核实服务'); })(), member: detail.member, model: childLlm, taskId: childTaskId, rootSessionId: task.taskId, parentTaskId: request.child.parentTaskId, message: request.message, permission: officePermission(), storage, business: request.business, signal: request.signal, artifactTransitions: input.artifactTransitions?.(), scopeId, reference: request.reference, businessServices: input.businessServices }) : undefined;

        if (business && 'rejection' in business)
        {
          permit.release();

          return business;
        }

        const agent = new AgentRole({ id: detail.member.memberId, name: detail.member.name, model: { engine: workspaceMemberEngine(policy) ?? 'pi', profileId: policy.profileId, modelId: policy.modelId }, position: detail.member.position, principles: definition.principles, instructions: detail.member.adaptation.instructions, references: detail.member.adaptation.references, effectiveSkills: composeTaskSkills(definition, business?.workflows ?? []) } satisfies AgentDescription, { workspaceId: workspace.entry.id, taskId: childTaskId }, observe);

        const childTask: TaskSpec = business?.task ?? { root: task.root, workspaceId: request.child.workspaceId, parentTaskId: request.child.parentTaskId, taskId: childTaskId, agentId: definition.agentId, goal: request.message, moduleIds: [], acceptance: [], mode: 'chat' };

        let childContext: AgentToolContext | undefined,
          childAlive = true;

        const childBudgets = new Map<string, Promise<RequestBudgetPort | undefined>>();

        const assertChild = () => { workspace.Assert(); if (closed || !childAlive || request.signal.aborted) throw new Error('原子调用已结束，不能发送新请求') };

        const child = await createWorkspaceLoop(workspace.paths, workspace, {
          ...options, permission: officePermission(), engine, llm: childLlm, configuration, profileId: policy.profileId, model: policy.modelId, modelRoles: policy.modelRoles, provider: 'cbim-' + policy.profileId, process: undefined, images: [], attachmentIds: [], RequestQuestion: async (args, signal) => { if (!childContext) throw new Error('子调用尚未受理'); childContext.AssertQuestionWait?.(); return request.RequestQuestion(args, signal); }
        }, {
          ...business?.services, dispatchedAgent: request.agents, ConnectorServers: input.connectorServers, connectorProducts: input.connectorProducts, connectorRootId: task.taskId, modelAdapters: input.modelAdapters, extensions: input.extensions, storage, agent, AgentCall: request.reference, AgentTools: context => { childContext = context; return scheduler.Bind(context, request.parent.depth + 1, agent, business?.workflows) }, RequestBudget: (context, role = 'primary') => { assertChild(); let result = childBudgets.get(role); if (!result) { result = requestBudgets?.ForRun({ rootSessionId: task.taskId, taskId: task.taskId, runId: rootRunId!, kind: 'main', agentRun: { taskId: childTaskId, runId: context.runId } }, childLlm, role, assertChild) ?? Promise.resolve(undefined); childBudgets.set(role, result) } return result; },
          AcquireLease: async () => { workspace.Assert(); if (closed || request.signal.aborted) throw new Error('调用已停止'); return () => { } },
          AuthorizeNative: input.authorizeNative,
        });

        return {
          agent, task: childTask, runtime: child.runtime, ...(business ? { launch: business.launch, Verify: business.Verify, BeforeRun: business.BeforeRun } : {}), Release: async () => { childAlive = false; await business?.Close(); permit.release() }
        };
      }
      catch (error)
      {
        permit.release();

        throw error
      }
    }
  }, office);

  const finish = async (summary?: RunSummary) =>
  {
    if (closed)
      return;

    closing = true;

    await scheduler.Close();

    await Promise.allSettled([...inputs]);

    try
    {
      if (opened && dispatch)
      {
        const outcome = summary?.status === 'completed' && !summary.unresolvedTools.length ? 'completed' : summary?.status === 'cancelled' ? 'cancelled' : summary?.status === 'interrupted' || summary?.unresolvedTools.length ? 'interrupted' : 'failed';

        try
        {
          await dispatch.CloseScope(identity, scopeId, outcome, summary)
        }
        catch (error)
        {
          // 原生运行结束不代表输入核证通过；保留未知回执，封存为失败并把原因交回对话。
          if (outcome !== 'completed' || !(error as
            {
              code?: string
            })?.code?.startsWith('GOAL_'))
            throw error;

          await dispatch.goals.Block(identity, scopeId, error instanceof Error ? error.message : String(error));

          await dispatch.CloseScope(identity, scopeId, 'failed', summary);

          closed = true;

          throw error;
        }
      }

      closed = true;
    }
    finally
    {
      releaseBudget?.();

      releaseBudget = undefined
    }
  };

  return {
    rootAgent,

    organization,

    // 与旧协议共用窄契约，但身份来自本次真实主调用，不读取 Auto 的最新批次。
    MainToolContext(currentTask: TaskSpec, runId: string): MainToolContext | undefined
    {
      if (!opened || closed || closing || runId !== rootRunId || currentTask.taskId !== task.taskId || currentTask.workspaceId !== workspace.entry.id || currentTask.root !== workspace.entry.path)
        return undefined;

      const current = (signal?: AbortSignal) => { signal?.throwIfAborted(); workspace.Assert(); if (closed || closing || runId !== rootRunId || admission && !admission.IsCurrent()) throw new Error('原主运行已停止，不能提交控制面操作') };

      return {
        binding: Object.freeze({ ...identity, scopeId, runId }), AssertCurrent: current, Track: <T>(operation: () => Promise<T>) => { current(); const pending = Promise.resolve().then(() => { current(); return operation() }); inputs.add(pending); return pending.finally(() => inputs.delete(pending)); }
      };
    },

    officeHistory: dispatch ? new OfficeHistoryTools(identity, (query, signal) => { workspace.Assert(); if (closed || !rootRunId) throw new Error('原主运行已经结束'); return dispatch.history.Read(identity, query, signal) }) : undefined,

    AgentTools: (context: AgentToolContext) => scheduler.Bind(context, 0, rootAgent),

    requestBudget: budget,

    agentLifecycle: {
      InsertInput: insertInput,
      BeforeRun: async (runId: string, context?: Parameters<AgentLifecycle['BeforeRun']>[1]) => { if (rootRunId && rootRunId !== runId) throw new Error('根运行已经绑定'); rootRunId = runId; scopeId = context?.scopeId ?? scopeId; if (dispatch) { releaseBudget = dispatch.budgets.HoldMain(runId); const scope = await dispatch.OpenScope(identity, scopeId, { message: context?.message ?? task.goal, ...(context?.attachmentIds ? { attachmentIds: context.attachmentIds } : {}), }, runId, undefined, context?.followupOf); unsupportedBudget = !!scope.budget?.policy.enabled && scope.budget.policy.enforcement !== 'request'; opened = true; } },
      Settled: finish,
      Failed: async (_error: unknown) => finish(),
    },
  };
}
