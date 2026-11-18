/**
 * 作用定位：单模块治理服务，组织桌面保护与决定、可信主运行观察和提案、独立实施。
 * 设计原因：所有操作借用知识存储的同一队列；私有账本只记意图，已应用状态和保护新基线只能由原 journal 派生。
 * 职责边界：模型端口仅可读取、观察和提案，来源由主运行闭包注入；批准及实施仍只属桌面，重开只查询原事务而不执行旧意图。
 * 反馈边界：回应来源冻结入提案，批准、逐项评价及新实施复核当前意见；后来的替代不改原评价或已提交 journal。
 */
import { z } from 'zod';

import { hash, json } from '../../../core/io/serialization';

import type { ChangeRequest, Preview, Snapshot } from '../../knowledge/rules/types';

import * as protocol from '../rules/module-governance';

import { projectGovernanceBody, governanceOversizedOutputSchema, governanceToolBodyLimit } from '../rules/module-governance-tools';

import { moduleGovernanceBinding, moduleGovernanceProposalBasis, validateModuleGovernanceWrite, advanceModuleGovernanceProtection, validateModuleGovernanceMainObservation, moduleGovernanceMainCommandId } from '../rules/module-governance-rules';

import { resolveModuleGovernanceResponses, validateModuleGovernanceResponseSources, validateModuleGovernanceAssessments } from '../rules/module-governance-feedback';

import { ModuleGovernanceStore, governanceCommandFingerprint, type GovernanceCommand } from './storage/module-governance-store';

import type { KnowledgeGovernanceAuthority, KnowledgeGovernanceBinding, KnowledgeGovernanceTransaction, KnowledgeJournalStatus } from '../../knowledge/storage/governance-port';

interface Owner
{
  entry:
  {
    id: string
  };

  instanceId: string;

  Assert(identity?: protocol.ModuleGovernanceIdentity): void;

  Governed<T>(operation: (tx: KnowledgeGovernanceTransaction) => Promise<T>): Promise<T>
}

type JournalReader = (request: ChangeRequest) => Promise<KnowledgeJournalStatus | undefined>;

type Derived =
  {
    protections: protocol.ModuleGovernanceProtection[];

    applications: Map<string, protocol.ModuleGovernanceApplication>
  };

const identity = (owner: Owner) => ({ workspaceId: owner.entry.id, instanceId: owner.instanceId });

const same = (a: unknown, b: unknown) => json(a) === json(b);

const checked = <T>(schema: z.ZodType<T>, raw: unknown): T => { const result = schema.safeParse(raw); if (!result.success) throw new Error('治理请求字段或身份无效'); return result.data };

const visible = (snapshot: Snapshot) => { try { return (JSON.parse(snapshot.validation!.indexes['.cbim/workspace/registry.json']).modules as { id: string }[]).map(item => item.id) } catch { throw new Error('模块可见目录不能核实') } };

const projected = (snapshot: Snapshot, preview: Preview) => { const files = new Map(snapshot.files.map(file => [file.path, file])); for (const change of preview.changes) { if (change.text === null) files.delete(change.path); else files.set(change.path, { path: change.path, text: change.text, hash: hash(change.text) }) } return [...files.values()] };

/** Workspace 独占一个服务与账本；实际 serial 仍由 KnowledgeStore 持有。 */
export class ModuleGovernanceService implements KnowledgeGovernanceAuthority
{
  readonly store: ModuleGovernanceStore;

  constructor(private readonly owner: Owner, filename: string)
  {
    this.store = new ModuleGovernanceStore(filename, owner.entry.id)
  }

  Init()
  {
    return this.store.Init()
  }

  /** 打开工作区时只核实原日志关联；不会执行旧意图或自动改变知识。 */
  ValidatePersisted()
  {
    return this.owner.Governed(async tx => { await this.Derive(tx.Journal) })
  }

  /** 仅被 KnowledgeStore 的可信 apply 调用，绝不从普通 ChangeRequest 解析批准。 */
  async Request(intentId: string)
  {
    const intent = this.store.Find(intentId)?.intent;

    if (!intent)
      throw new Error('原实施意图不存在');

    return intent.request
  }

  HasIntent(requestId: string)
  {
    return !!this.store.Find(requestId)?.intent
  }

  /** 可信原日志还须保存准确前后正文；只有 fingerprint 声明或形状合法的 result 不能证明提交。 */
  VerifyJournal(request: ChangeRequest, status: KnowledgeJournalStatus)
  {
    const intent = this.store.Find(request.requestId)?.intent;

    if (!intent && !status.governance)
      return;

    if (!intent)
      throw new Error('治理知识日志缺少原私有意图');

    const proposal = this.Proposal(intent.proposalId);

    if (!same(status.governance, { intentId: intent.intentId, protectionId: intent.protectionId, proposalId: intent.proposalId, decisionId: intent.decisionId }) || intent.requestFingerprint !== hash(json(request)) || status.before[proposal.change.path] !== proposal.change.beforeText || status.after[proposal.change.path] !== proposal.change.afterText)
      throw new Error('治理知识日志与原提案前后正文或身份不一致');
  }

  private Proposal(id: string)
  {
    const command = this.store.Find(id);

    if (command?.receipt.action !== 'propose')
      throw new Error('原治理提案不存在');

    return command.receipt.record
  }

  private Decisions(proposalId: string)
  {
    return this.store.All().flatMap(command => command.receipt.action === 'decide' && command.receipt.record.proposalId === proposalId ? [command.receipt.record] : [])
  }

  /** 只从当前串行屏障内的真实账本组合反馈来源；不借模型引用构造原决定。 */
  private ResponseSources()
  {
    const commands = this.store.All();

    return commands.flatMap(command => { if (command.receipt.action !== 'propose') return []; const proposal = command.receipt.record; return [{ proposal, decisions: commands.flatMap(item => item.receipt.action === 'decide' && item.receipt.record.proposalId === proposal.proposalId ? [item.receipt.record] : []) }] })
  }

  /** 仅用原 journal 推进生效基线，缺失或回滚不会被当前正文相同补成成功。 */
  private async Derive(journal: JournalReader): Promise<Derived>
  {
    const protections = new Map<string, protocol.ModuleGovernanceProtection>(),
      applications = new Map<string, protocol.ModuleGovernanceApplication>();

    for (const command of this.store.All())
    {
      if (command.receipt.action === 'register')
      {
        protections.set(command.receipt.record.protectionId, command.receipt.record);

        continue
      }

      if (command.receipt.action !== 'apply')
        continue;

      const intent = command.intent!,
        record = command.receipt.record,
        status = await journal(intent.request);

      const expected = { intentId: intent.intentId, protectionId: intent.protectionId, proposalId: intent.proposalId, decisionId: intent.decisionId };

      if (status && !same(status.governance, expected))
        throw new Error('原知识 journal 与治理意图来源不一致');

      if (status?.state === 'committed')
      {
        const result = protocol.moduleGovernanceKnowledgeReceiptSchema.parse(status.result),
          proposal = this.Proposal(intent.proposalId),
          protection = protections.get(intent.protectionId);

        if (!protection || protection.revision !== proposal.base.protectionRevision || protection.definition.hash !== proposal.base.definitionHash || protection.overview.hash !== proposal.base.overviewHash || result.requestId !== intent.intentId || result.workspaceId !== intent.workspaceId || result.instanceId !== intent.request.instanceId)
          throw new Error('已提交治理的保护版本链不一致');

        protections.set(protection.protectionId, advanceModuleGovernanceProtection(protection, proposal, result));

        applications.set(intent.intentId, protocol.moduleGovernanceApplicationSchema.parse({ ...record, state: 'committed', result }));
      }
      else
      {
        const state = status?.state === 'rolled_back' ? 'rolled_back' : status?.state === 'recovery_required' ? 'recovery_required' : !status && intent.request.instanceId !== this.owner.instanceId ? 'not_applied' : 'pending';

        applications.set(intent.intentId, protocol.moduleGovernanceApplicationSchema.parse({ ...record, state }));
      }
    }

    return { protections: [...protections.values()], applications };
  }

  private Protection(derived: Derived, id: string)
  {
    const value = derived.protections.find(item => item.protectionId === id);

    if (!value)
      throw new Error('模块尚未登记保护');

    return value
  }

  private Baseline(snapshot: Snapshot, protection: protocol.ModuleGovernanceProtection, revision?: string, protectionRevision?: number)
  {
    if (revision !== undefined && snapshot.revision !== revision || protectionRevision !== undefined && protection.revision !== protectionRevision)
      throw new Error('知识或保护版本已经变化，请重新观察');

    const actual = moduleGovernanceBinding(protection.moduleId, snapshot.files, visible(snapshot));

    if (!same(actual.definition, protection.definition) || !same(actual.overview, protection.overview))
      throw new Error('受保护模块的定义或正文已漂移，请核实原基线');
  }

  private Receipt(command: GovernanceCommand, derived: Derived): protocol.ModuleGovernanceReceipt
  {
    return protocol.moduleGovernanceReceiptSchema.parse(command.receipt.action === 'apply' ? { ...command.receipt, record: derived.applications.get(command.receipt.commandId) } : command.receipt)
  }

  private async Known(action: protocol.ModuleGovernanceReceipt['action'], input: { commandId: string }, tx: KnowledgeGovernanceTransaction, origin?: protocol.ModuleGovernanceOrigin)
  {
    const command = this.store.Find(input.commandId);

    if (!command)
      return;

    // 桌面可继续查询旧无来源请求；主运行不能借相同命令 ID 冒领旧桌面或另一个运行的记录。
    const expectedOrigin = !command.origin && origin?.kind === 'local_desktop' ? undefined : origin;

    if (!same(command.origin, expectedOrigin) || command.fingerprint !== governanceCommandFingerprint(action, input, expectedOrigin))
      throw new Error('该命令已绑定其他请求，必须查询原回执');

    return this.Receipt(command, await this.Derive(tx.Journal))
  }

  private async Save(input: GovernanceCommand['input'], receipt: protocol.ModuleGovernanceReceipt, intent?: protocol.ModuleGovernanceApplyIntent, origin?: protocol.ModuleGovernanceOrigin)
  {
    await this.store.Append({ input, fingerprint: governanceCommandFingerprint(receipt.action, input, origin), receipt, ...(intent ? { intent } : {}), ...(origin ? { origin } : {}) });

    return receipt
  }

  /** 所有普通入口与可信实施共用此最终保护门禁，规则检查的是完整投影及真实派生目录。 */
  async Verify(current: Snapshot, preview: Preview, request: ChangeRequest, journal: JournalReader, intentId?: string): Promise<KnowledgeGovernanceBinding | undefined>
  {
    const derived = await this.Derive(journal),
      intent = intentId ? this.store.Find(intentId)?.intent : undefined,
      proposal = intent ? this.Proposal(intent.proposalId) : undefined,
      decision = proposal ? this.Decisions(proposal.proposalId).at(-1) : undefined;

    if (intentId && (!intent || !proposal || !decision))
      throw new Error('治理实施来源不完整');

    if (proposal)
      validateModuleGovernanceResponseSources(proposal, this.ResponseSources(), 'current');

    validateModuleGovernanceWrite({ workspaceId: this.owner.entry.id, currentRevision: current.revision, protections: derived.protections, currentFiles: current.files, projectedFiles: projected(current, preview), visibleModuleIds: visible({ ...current, validation: preview.validation }), request, ...(intent && proposal && decision ? { authorized: { intent, proposal, decision, latestDecisionRevision: decision.revision } } : {}) });

    return intent ? { intentId: intent.intentId, protectionId: intent.protectionId, proposalId: intent.proposalId, decisionId: intent.decisionId } : undefined;
  }

  Register(raw: unknown, actor: protocol.ModuleGovernanceActor)
  {
    const input = checked(protocol.moduleGovernanceRegisterInputSchema, raw);

    return this.owner.Governed(async tx => { this.owner.Assert(input); const known = await this.Known('register', input, tx); if (known) return known; const snapshot = await tx.Snapshot(); if (snapshot.revision !== input.expectedKnowledgeRevision) throw new Error('登记时知识版本已经变化'); if (!snapshot.validation?.structural) throw new Error('知识结构未通过校验，不能登记新的保护'); const derived = await this.Derive(tx.Journal); if (derived.protections.some(item => item.moduleId === input.moduleId)) throw new Error('此模块已登记保护'); const binding = moduleGovernanceBinding(input.moduleId, snapshot.files, visible(snapshot)), record = protocol.moduleGovernanceProtectionSchema.parse({ protectionId: input.commandId, workspaceId: input.workspaceId, moduleId: input.moduleId, revision: 1, ...binding, registeredAt: new Date().toISOString(), actor }); this.owner.Assert(input); return this.Save(input, { identity: identity(this.owner), commandId: input.commandId, action: 'register', record }); })
  }

  async Observe(raw: unknown)
  {
    return protocol.moduleGovernanceReceiptSchema.parse(await this.ObserveWithOrigin(checked(protocol.moduleGovernanceObserveInputSchema, raw), { kind: 'local_desktop', interaction: 'explicit_submit' }))
  }

  /** 仅 Main 的真实主运行闭包调用；IPC 没有 origin 字段，也不提供此入口。 */
  ObserveFromMain(raw: unknown, source: protocol.ModuleGovernanceMainOrigin, signal: AbortSignal)
  {
    const input = checked(protocol.moduleGovernanceObserveInputSchema, raw),
      origin = protocol.moduleGovernanceMainOriginSchema.parse(source);

    if (origin.toolName !== 'cbim_governance_observe' || input.commandId !== moduleGovernanceMainCommandId(input.workspaceId, origin))
      throw new Error('观察与真实工具调用身份不一致');

    return this.ObserveWithOrigin(input, origin, signal)
  }

  private ObserveWithOrigin(input: protocol.ModuleGovernanceObserveInput, origin: protocol.ModuleGovernanceOrigin, signal?: AbortSignal)
  {
    signal?.throwIfAborted();

    return this.owner.Governed(async tx => { this.owner.Assert(input); signal?.throwIfAborted(); const known = await this.Known('observe', input, tx, origin); if (known) return known; const snapshot = await tx.Snapshot(), protection = this.Protection(await this.Derive(tx.Journal), input.protectionId); this.Baseline(snapshot, protection, input.expectedKnowledgeRevision, input.expectedProtectionRevision); const overview = snapshot.files.find(file => file.path === protection.overview.path)!, validation = snapshot.validation!; if (origin.kind === 'main_agent') { const body = projectGovernanceBody(overview.text, overview.hash); if (body.state === 'oversized') return governanceOversizedOutputSchema.parse({ identity: { workspaceId: input.workspaceId, rootSessionId: origin.rootSessionId }, status: 'oversized', commandId: input.commandId, action: 'observe', protectionId: input.protectionId, body, recorded: false }) } const record = protocol.moduleGovernanceObservationSchema.parse({ observationId: input.commandId, workspaceId: input.workspaceId, protectionId: input.protectionId, protectionRevision: protection.revision, knowledgeRevision: snapshot.revision, definitionHash: protection.definition.hash, overviewHash: protection.overview.hash, overview, statement: input.statement, validation: { structural: validation.structural, issues: validation.issues, architecture: validation.architecture, business: validation.business }, observedAt: new Date().toISOString(), origin }); this.owner.Assert(input); signal?.throwIfAborted(); return this.Save(input, { identity: identity(this.owner), commandId: input.commandId, action: 'observe', record }, undefined, origin); })
  }

  async Propose(raw: unknown)
  {
    return protocol.moduleGovernanceReceiptSchema.parse(await this.ProposeWithOrigin(checked(protocol.moduleGovernanceProposeInputSchema, raw), { kind: 'local_desktop', interaction: 'explicit_submit' }))
  }

  /** 主运行提案只接受同一主实例和根会话的真实模型观察，不能借桌面来源伪造本轮认知。 */
  ProposeFromMain(raw: unknown, source: protocol.ModuleGovernanceMainOrigin, signal: AbortSignal)
  {
    const input = checked(protocol.moduleGovernanceProposeInputSchema, raw),
      origin = protocol.moduleGovernanceMainOriginSchema.parse(source);

    if (origin.toolName !== 'cbim_governance_propose' || input.commandId !== moduleGovernanceMainCommandId(input.workspaceId, origin))
      throw new Error('提案与真实工具调用身份不一致');

    return this.ProposeWithOrigin(input, origin, signal)
  }

  private ProposeWithOrigin(input: protocol.ModuleGovernanceProposeInput, origin: protocol.ModuleGovernanceOrigin, signal?: AbortSignal)
  {
    signal?.throwIfAborted();

    return this.owner.Governed(async tx => { this.owner.Assert(input); signal?.throwIfAborted(); const known = await this.Known('propose', input, tx, origin); if (known) return known; const snapshot = await tx.Snapshot(), protection = this.Protection(await this.Derive(tx.Journal), input.protectionId); this.Baseline(snapshot, protection, input.expectedKnowledgeRevision, input.expectedProtectionRevision); const source = this.store.Find(input.observationId)?.receipt; if (source?.action !== 'observe' || source.record.protectionId !== protection.protectionId) throw new Error('原观察不存在或不属于此保护对象'); const observation = source.record; if (observation.knowledgeRevision !== snapshot.revision || observation.protectionRevision !== protection.revision || observation.overviewHash !== protection.overview.hash) throw new Error('原观察已经过期，请重新观察'); if (origin.kind === 'main_agent') { validateModuleGovernanceMainObservation(observation, origin); const body = projectGovernanceBody(observation.overview.text, observation.overview.hash); if (body.state === 'oversized') return governanceOversizedOutputSchema.parse({ identity: { workspaceId: input.workspaceId, rootSessionId: origin.rootSessionId }, status: 'oversized', commandId: input.commandId, action: 'propose', protectionId: input.protectionId, body, recorded: false }); if (Buffer.byteLength(input.newOverviewText) > governanceToolBodyLimit) throw new Error('新正文超过模型提案上限，请在桌面处理'); } const respondsTo = input.respondsToDecisionIds ? resolveModuleGovernanceResponses({ workspaceId: input.workspaceId, protectionId: input.protectionId }, input.respondsToDecisionIds, this.ResponseSources()) : undefined; const request = { ...identity(this.owner), requestId: input.commandId, revision: snapshot.revision, changes: [{ path: protection.overview.path, text: input.newOverviewText }] }, preview = await tx.Preview(request); if (!preview.validation.structural) throw new Error('提案正文未通过正式知识校验，请核对引用与模块结构'); const body = { proposalId: input.commandId, workspaceId: input.workspaceId, moduleId: protection.moduleId, protectionId: protection.protectionId, observationId: observation.observationId, base: { knowledgeRevision: snapshot.revision, protectionRevision: protection.revision, definitionHash: protection.definition.hash, overviewHash: protection.overview.hash }, change: { path: protection.overview.path, beforeText: observation.overview.text, afterText: input.newOverviewText, beforeHash: protection.overview.hash, afterHash: hash(input.newOverviewText) }, reason: input.reason, alternatives: input.alternatives, invariants: input.invariants, rollbackNotes: input.rollbackNotes, ...(respondsTo ? { respondsTo } : {}), createdAt: new Date().toISOString(), origin }, record = protocol.moduleGovernanceProposalSchema.parse({ ...body, basis: moduleGovernanceProposalBasis(body) }); this.owner.Assert(input); signal?.throwIfAborted(); return this.Save(input, { identity: identity(this.owner), commandId: input.commandId, action: 'propose', record }, undefined, origin); })
  }

  Decide(raw: unknown, actor: protocol.ModuleGovernanceActor)
  {
    const input = checked(protocol.moduleGovernanceDecideInputSchema, raw);

    return this.owner.Governed(async tx => { this.owner.Assert(input); const known = await this.Known('decide', input, tx); if (known) return known; const proposal = this.Proposal(input.proposalId), previous = this.Decisions(proposal.proposalId), latest = previous.at(-1); if (proposal.basis !== input.expectedBasis || (latest?.revision ?? 0) !== input.expectedDecisionRevision) throw new Error('提案或决定版本已经变化，请刷新后明确提交'); validateModuleGovernanceAssessments(proposal, input.assessments); if (input.decision === 'approve' || input.assessments) validateModuleGovernanceResponseSources(proposal, this.ResponseSources(), 'current'); if (input.decision === 'approve') { const snapshot = await tx.Snapshot(), protection = this.Protection(await this.Derive(tx.Journal), proposal.protectionId); this.Baseline(snapshot, protection, proposal.base.knowledgeRevision, proposal.base.protectionRevision) } const record = protocol.moduleGovernanceDecisionSchema.parse({ decisionId: input.commandId, workspaceId: input.workspaceId, proposalId: proposal.proposalId, revision: input.expectedDecisionRevision + 1, basis: proposal.basis, decision: input.decision, comment: input.comment, ...(input.revisitCondition ? { revisitCondition: input.revisitCondition } : {}), ...(input.feedback ? { feedback: input.feedback } : {}), ...(input.assessments ? { assessments: input.assessments } : {}), actor, recordedAt: new Date().toISOString(), ...(latest ? { supersedesDecisionId: latest.decisionId } : {}) }); this.owner.Assert(input); return this.Save(input, { identity: identity(this.owner), commandId: input.commandId, action: 'decide', record }); })
  }

  Apply(raw: unknown)
  {
    const input = checked(protocol.moduleGovernanceApplyInputSchema, raw);

    return this.owner.Governed(async tx => { this.owner.Assert(input); const known = await this.Known('apply', input, tx); if (known) return known; const proposal = this.Proposal(input.proposalId), decision = this.Decisions(input.proposalId).at(-1); if (!decision || decision.decision !== 'approve' || decision.decisionId !== input.decisionId) throw new Error('只有当前最新的明确批准可实施'); if (input.expectedBasis !== proposal.basis) throw new Error('提案依据已经变化'); validateModuleGovernanceResponseSources(proposal, this.ResponseSources(), 'current'); const derived = await this.Derive(tx.Journal); for (const application of derived.applications.values()) if (application.proposalId === proposal.proposalId && ['pending', 'recovery_required'].includes(application.state)) throw new Error('原实施意图尚未核实，不能另建请求'); const snapshot = await tx.Snapshot(), protection = this.Protection(derived, proposal.protectionId); this.Baseline(snapshot, protection, proposal.base.knowledgeRevision, proposal.base.protectionRevision); const request = { ...identity(this.owner), revision: proposal.base.knowledgeRevision, requestId: input.commandId, changes: [{ path: proposal.change.path, text: proposal.change.afterText }] }, createdAt = new Date().toISOString(), intent = protocol.moduleGovernanceApplyIntentSchema.parse({ intentId: input.commandId, workspaceId: input.workspaceId, proposalId: proposal.proposalId, decisionId: decision.decisionId, protectionId: protection.protectionId, basis: proposal.basis, request, requestFingerprint: hash(json(request)), createdAt }), preview = await tx.Preview(request); if (!preview.validation.structural) throw new Error('实施前知识校验未通过'); validateModuleGovernanceWrite({ workspaceId: input.workspaceId, currentRevision: snapshot.revision, protections: derived.protections, currentFiles: snapshot.files, projectedFiles: projected(snapshot, preview), visibleModuleIds: visible({ ...snapshot, validation: preview.validation }), request, authorized: { intent, proposal, decision, latestDecisionRevision: decision.revision } }); const { request: _, ...summary } = intent, record = protocol.moduleGovernanceApplicationSchema.parse({ ...summary, requestId: request.requestId, state: 'pending' }); this.owner.Assert(input); await this.Save(input, { identity: identity(this.owner), commandId: input.commandId, action: 'apply', record }, intent); try { await tx.Apply(intent.intentId) } catch { const command = this.store.Find(input.commandId)!, resolved = this.Receipt(command, await this.Derive(tx.Journal)); if (resolved.action === 'apply' && resolved.record.state !== 'pending') return resolved; throw new Error('实施意图已保存，知识结果尚未核实；请查询原命令，不自动重试') } return this.Receipt(this.store.Find(input.commandId)!, await this.Derive(tx.Journal)); })
  }

  Lookup(raw: unknown)
  {
    const input = checked(protocol.moduleGovernanceLookupSchema, raw);

    return this.owner.Governed(async tx => { if (input.workspaceId !== this.owner.entry.id) throw new Error('治理查询工作区不一致'); const command = this.store.Find(input.commandId); return command ? this.Receipt(command, await this.Derive(tx.Journal)) : undefined })
  }

  Unaccepted(raw: unknown)
  {
    const input = checked(protocol.moduleGovernanceUnacceptedInputSchema, raw);

    return this.owner.Governed(async tx =>
    {
      if (input.workspaceId !== this.owner.entry.id)
        throw new Error('治理查询工作区不一致');

      const command = this.store.Find(input.commandId);

      let unaccepted = false;

      // 没有 ledger 时也不能跳过原 journal 的存在检查；未知历史不会被解释为失败。
      if (input.instanceId !== this.owner.instanceId && !command)
      {
        const probe = { workspaceId: input.workspaceId, instanceId: input.instanceId, revision: '', requestId: input.commandId, changes: [] };

        try
        {
          unaccepted = !(await tx.Journal(probe))
        }
        catch (error: any)
        {
          if (error.code !== 'IDEMPOTENCY')
            throw error
        }
      }

      return protocol.moduleGovernanceUnacceptedSchema.parse({ identity: { workspaceId: input.workspaceId, instanceId: input.instanceId }, commandId: input.commandId, action: input.action, unaccepted });
    })
  }

  List(raw: unknown)
  {
    const input = checked(protocol.moduleGovernanceListInputSchema, raw);

    return this.owner.Governed(async tx => (await this.ReadList(input, tx)).view)
  }

  /** 模型视图所需正文和目录共用一次知识屏障；正文交由有界投影裁决，不向模型返回整个快照。 */
  ReadForMain(raw: unknown, signal: AbortSignal)
  {
    const input = checked(protocol.moduleGovernanceListInputSchema, raw);

    signal.throwIfAborted();

    return this.owner.Governed(async tx => { signal.throwIfAborted(); const value = await this.ReadList(input, tx); this.owner.Assert(input); signal.throwIfAborted(); return value })
  }

  private async ReadList(input: protocol.ModuleGovernanceListInput, tx: KnowledgeGovernanceTransaction)
  {
    this.owner.Assert(input);

    const snapshot = await tx.Snapshot(),
      derived = await this.Derive(tx.Journal),
      protection = derived.protections.find(item => item.moduleId === input.moduleId),
      commands = this.store.All(),
      observations = commands.flatMap(command => command.receipt.action === 'observe' && command.receipt.record.protectionId === protection?.protectionId ? [command.receipt.record] : []),
      proposals = commands.flatMap(command => command.receipt.action === 'propose' && command.receipt.record.moduleId === input.moduleId ? [command.receipt.record] : []),
      selected = input.proposalId ? proposals.find(item => item.proposalId === input.proposalId) : undefined,
      selectedObservation = input.observationId ? observations.find(item => item.observationId === input.observationId) : undefined;

    if (input.proposalId && !selected || input.observationId && !selectedObservation)
      throw new Error('所选治理记录不属于此模块');

    const issues: protocol.ModuleGovernanceList['issues'] = [];

    if (protection)
    {
      try
      {
        this.Baseline(snapshot, protection)
      }
      catch (error: any)
      {
        issues.push({ severity: 'error', code: String(error.code ?? 'GOVERNANCE_STALE'), message: String(error.message) })
      }
    }

    // 过期仅是当前视图，不改提案 basis、原评价或已经提交的真实历史。
    const responseStates = selected?.respondsTo ? validateModuleGovernanceResponseSources(selected, this.ResponseSources(), 'historical') : undefined;

    const view = protocol.moduleGovernanceListSchema.parse({ identity: identity(this.owner), moduleId: input.moduleId, knowledgeRevision: snapshot.revision, ...(protection ? { protection } : {}), observations: observations.map(({ validation: _, overview, ...item }) => ({ ...item, overview: { path: overview.path, hash: overview.hash } })), ...(selectedObservation ? { selectedObservation } : {}), proposals: proposals.map(({ proposalId, protectionId, observationId, basis, reason, createdAt, origin }) => ({ proposalId, protectionId, observationId, basis, reason, createdAt, ...(origin ? { origin } : {}), decisionRevision: this.Decisions(proposalId).at(-1)?.revision ?? 0 })), ...(selected ? { selected: { proposal: selected, ...(responseStates ? { responseStates } : {}), decisions: this.Decisions(selected.proposalId), applications: [...derived.applications.values()].filter(item => item.proposalId === selected.proposalId) } } : {}), issues });

    const overview = protection ? snapshot.files.find(file => file.path === protection.overview.path) : undefined;

    return { view, overview };
  }
}
