/**
 * 角色引用与公开快照一起采纳；角色变更参与配置变化判断。
 * 目录归属：logic/team/service；岗位、责任与来源协调。
 * 作用定位：将桌面岗位登记、采纳与当前差异查询接到工作区唯一 DispatchStore，公开模型配置由 Main 注入。
 * 设计原因：稳定 memberId 与运行实例分离；登记只保存实际原则、有效 Skill 和无凭据模型快照，不派工、不修改知识或默认执行角色。
 * 事务边界：能力采纳固定知识串行快照后进入同一 Store，未追踪来源捕获与岗位事件同事务；模型配置仍前后复验，不宣称拥有跨存储原子锁。原命令先查回执，重开不能重做已提交动作。
 */
import { data } from '../../knowledge/rules/read-models';

import { agentModelSelectionSchema } from '../rules/agent-runtime';

import { randomUUID } from 'node:crypto';

import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import { fail } from '../../../core/errors';

import type { DispatchState, DispatchStore } from '../../dispatch/rules/dispatch-storage';

import { workspaceMemberActorSchema, type WorkspaceMemberActor, workspaceMemberCapabilitySchema, workspaceMemberCommitInputSchema, workspaceMemberDetailSchema, workspaceMemberGetInputSchema, workspaceMemberListInputSchema, workspaceMemberListSchema, workspaceMemberLookupSchema, workspaceMemberModelSnapshotSchema, workspaceMemberPreviewInputSchema, workspaceMemberPreviewSchema, workspaceMemberReceiptSchema, summarizeWorkspaceMember, type WorkspaceMember, type WorkspaceMemberCapability, type WorkspaceMemberChange, type WorkspaceMemberCurrentDiff, type WorkspaceMemberIdentity, type WorkspaceMemberModelRef, type WorkspaceMemberModelSnapshot, type WorkspaceMemberPreview, workspaceMemberEngine, type WorkspaceMemberPreviewInput, type WorkspaceMemberReceipt, type WorkspaceMemberRuntimePolicy, } from '../rules/workspace-member';

import { workspaceMemberMainCommandId, workspaceMemberCapabilityHash, workspaceMemberChangedFields, workspaceMemberCommand, workspaceMemberHash, workspaceMemberModelHash, workspaceMemberPreviewBasis, workspaceMemberProposed, workspaceMemberReceipt, } from '../rules/workspace-member-rules';

import { resolveDispatchAgent } from '../../execution/context/dispatch-context';

import type { Snapshot } from '../../knowledge/rules/types';

import { knowledgeSourcePending } from '../../workspace/rules/knowledge-source-rules';

import type { SourceSelection, KnowledgeSourceReadState } from '../../workspace/rules/knowledge-source';

import type { KnowledgeSourceWorkspace } from '../../knowledge/service/knowledge-sources';

/** 只接收岗位独立选择的引擎、明确供应商和模型公开参数；不得在实现中解密、网络探测或读取默认选择。 */
export interface WorkspaceMemberModels
{
  Configuration(profileId: string, modelId: string, engine?: WorkspaceMemberModelRef['engine'], modelRoles?: WorkspaceMemberModelRef['modelRoles']): Promise<WorkspaceMemberModelSnapshot>
}

interface PreparedMember
{
  preview: WorkspaceMemberPreview;

  knowledgeRevision?: string;

  model?: WorkspaceMemberRuntimePolicy;
}

function input<T>(schema: z.ZodType<T>, raw: unknown): T
{
  const value = schema.safeParse(raw);

  if (!value.success)

    fail('MEMBER_INPUT_INVALID', '岗位登记请求不完整或包含不支持的字段');

  return value.data
}

function issue(error: unknown)
{
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
}

/** 每个工作区实例只装配一次，共用派发存储；本服务没有执行、领取或停止模型的端口。 */
export class WorkspaceMembers
{
  constructor(private readonly owner: KnowledgeSourceWorkspace, private readonly store: DispatchStore, private readonly models: WorkspaceMemberModels, private readonly isCurrent: () => boolean = () => true)
  {
  }

  private Assert(identity: WorkspaceMemberIdentity)
  {
    if (identity.workspaceId !== this.owner.entry.id || identity.instanceId !== this.owner.instanceId)

      fail('MEMBER_IDENTITY', '工作区实例已变化，请重新读取岗位登记');

    this.owner.Assert(identity);

    if (!this.isCurrent())

      fail('MEMBER_UNAVAILABLE', '工作区正在关闭，未接受新的岗位登记');
  }

  private Identity()
  {
    return { workspaceId: this.owner.entry.id, instanceId: this.owner.instanceId }
  }

  private SameWorkspace(workspaceId: string)
  {
    if (workspaceId !== this.owner.entry.id)

      fail('MEMBER_IDENTITY', '岗位登记不属于此工作区')
  }

  private Cursor(state: DispatchState)
  {
    return state.registryCursor ?? null
  }

  private Member(state: DispatchState, id: string)
  {
    const member = state.workspaceMembers?.find(value => value.memberId === id);

    if (!member)

      fail('MEMBER_NOT_FOUND', '岗位不存在');

    return member
  }

  /** 登记列表不复制能力正文；后续页严格绑定游标，修改名称不会重新排序。 */
  async List(raw: unknown)
  {
    const request = input(workspaceMemberListInputSchema, raw);

    this.Assert(request);

    const state = await this.store.Read();

    this.Assert(request);

    const cursor = this.Cursor(state),

      members = state.workspaceMembers ?? [],

      offset = request.offset ?? 0,

      limit = request.limit ?? 20;

    if (request.expectedRegistryCursor && !isDeepStrictEqual(request.expectedRegistryCursor, cursor) || offset > members.length)

      fail('MEMBER_REGISTRY_STALE', '岗位列表已变化，请从第一页重新读取');

    const items = members.slice(offset, offset + limit).map(summarizeWorkspaceMember),

      end = offset + items.length;

    return workspaceMemberListSchema.parse({ identity: this.Identity(), registryCursor: cursor, offset, total: members.length, items, ...(end < members.length ? { nextOffset: end } : {}) });
  }

  /** 每次详情读取重新观察知识和公开模型配置；登记游标不作为外部来源的缓存键。 */
  async Get(raw: unknown)
  {
    const request = input(workspaceMemberGetInputSchema, raw);

    this.Assert(request);

    const state = await this.store.Read(),

      member = this.Member(state, request.memberId);

    this.Assert(request);

    const currentDiff = await this.Diff(member);

    this.Assert(request);

    let sourceStatus: KnowledgeSourceReadState;

    try
    {
      const snapshot = await this.owner.Snapshot(),

        configuration = member.adoption.configuration,

        pending = knowledgeSourcePending(state);

      sourceStatus = pending ? { status: 'pending', transitionId: pending.transitionId } : configuration.source === 'builtin' ? await this.BuiltinStatus(member, snapshot) : this.owner.sources!.Status(state, snapshot, { kind: 'agent', sourceId: configuration.agentId }, member.adoption.sourceRef)
    }
    catch
    {
      sourceStatus = { status: 'invalid', issue: '当前知识无法核实来源，原采纳仍保留' }
    }
    const after = await this.store.Read();

    this.Assert(request);

    if (!isDeepStrictEqual(this.Cursor(state), this.Cursor(after)) || !isDeepStrictEqual(state.sourceCursor, after.sourceCursor))

      fail('MEMBER_REGISTRY_STALE', '读取期间岗位或来源登记发生变化，请重新读取');

    return workspaceMemberDetailSchema.parse({ identity: this.Identity(), registryCursor: this.Cursor(state), member, currentDiff, sourceStatus });
  }

  /** 预览只读取来源，不生成岗位、采纳 ID 或审计记录。 */
  async Preview(raw: unknown)
  {
    const request = input(workspaceMemberPreviewInputSchema, raw);

    this.Assert(request);

    const state = await this.store.Read(),

      prepared = await this.Prepare(state, request);

    await this.VerifySources(prepared, request);

    const after = await this.store.Read();

    this.Assert(request);

    if (!isDeepStrictEqual(this.Cursor(state), this.Cursor(after)) || !isDeepStrictEqual(state.sourceCursor, after.sourceCursor))

      fail('MEMBER_REGISTRY_STALE', '预览期间岗位或来源登记已变化，请重新预览');

    return prepared.preview;
  }

  /** 原命令查询不会调用事务、知识读取、默认模型解析或重放；未找到不等于证明从未受理。 */
  async Receipt(raw: unknown): Promise<WorkspaceMemberReceipt | undefined>
  {
    const request = input(workspaceMemberLookupSchema, raw);

    this.SameWorkspace(request.workspaceId);

    const recorded = await this.store.CommandReceipt('workspace-member-' + request.commandId);

    return recorded ? this.CheckedReceipt(recorded.receipt, request.workspaceId, request.commandId) : undefined;
  }

  private CheckedReceipt(raw: unknown, workspaceId: string, commandId: string)
  {
    const parsed = workspaceMemberReceiptSchema.safeParse(raw);

    if (!parsed.success || parsed.data.identity.workspaceId !== workspaceId || parsed.data.commandId !== commandId)

      fail('MEMBER_RECEIPT_INVALID', '原岗位登记回执不完整，请保留原命令核实');

    return parsed.data;
  }

  /** 主工具只读取同根会话的原审计；查询不依赖当前能力可用性，不重放提交。 */
  async MainReceipt(workspaceId: string, commandId: string, rootSessionId: string)
  {
    this.SameWorkspace(workspaceId);

    const event = (await this.store.Read()).workspaceMemberChanges?.find(item => item.request.commandId === commandId);

    if (!event)

      return undefined;

    if (event.actor.kind !== 'main_agent' || event.actor.rootSessionId !== rootSessionId)

      fail('MEMBER_ACTOR', '只能查询本根会话主工具的岗位回执');

    return this.Receipt({ workspaceId, commandId });
  }

  /** 可信桌面或受控主工具可调用；主工具不能选择模型，取消在写入前复核。先核原命令，再在 Store 串行事务内复验版本和来源；已落盘后的回包失败不撤回或重做。 */
  async Commit(raw: unknown, actor: WorkspaceMemberActor, assertCurrent?: () => void): Promise<WorkspaceMemberReceipt>
  {
    const request = input(workspaceMemberCommitInputSchema, raw);

    const source = workspaceMemberActorSchema.safeParse(actor);

    if (!source.success)

      fail('MEMBER_ACTOR', '岗位登记需要可信桌面或主运行来源');

    actor = source.data;

    const command = workspaceMemberCommand(request, actor);

    this.SameWorkspace(request.workspaceId);

    if (actor.kind === 'main_agent' && (!assertCurrent || request.commandId !== workspaceMemberMainCommandId(request.workspaceId, actor)))

      fail('MEMBER_ACTOR', '岗位工具缺少真实运行来源');

    const existing = await this.store.CommandReceipt(command.commandId);

    if (existing)
    {
      if (existing.fingerprint !== command.fingerprint)

        fail('MEMBER_COMMAND_CONFLICT', '原命令已用于另一份请求，请查询原回执');

      return this.CheckedReceipt(existing.receipt, request.workspaceId, request.commandId)
    }
    assertCurrent?.();

    this.Assert(request);

    const adopting = request.change.kind === 'register' || request.change.kind === 'adopt' && request.change.target === 'capability';

    const execute = (snapshot?: Snapshot) => this.store.Transact(command, async state => { assertCurrent?.(); this.Assert(request); if (actor.kind === 'main_agent') { const change = request.change; if (change.kind === 'adopt' && change.target === 'model' || change.kind === 'update' && change.patch.runtimePolicy) fail('MEMBER_MODEL_MANUAL', '模型选型和参数采纳仍需用户明确配置'); if (change.kind === 'register') { const selected = agentModelSelectionSchema.safeParse(data(snapshot!, change.agentId + '/agent.json').runtime); if (!selected.success || !isDeepStrictEqual(selected.data, change.runtimePolicy)) fail('MEMBER_MODEL_MANUAL', '请先由用户为静态 Agent 配置模型，岗位只能继承该选型'); } } if (!isDeepStrictEqual(this.Cursor(state), request.expectedRegistryCursor)) fail('MEMBER_REGISTRY_STALE', '岗位登记版本已变化，请重新预览'); const prepared = await this.Prepare(state, request, snapshot), preview = prepared.preview; if (preview.basis !== request.expectedBasis) fail('MEMBER_BASIS_STALE', '岗位或来源内容已变化，请重新预览'); await this.VerifySources(prepared, request); assertCurrent?.(); this.Assert(request); const time = new Date().toISOString(), old = preview.previousMember, p = preview.proposed, changeId = randomUUID(); const adopt = !old || request.change.kind === 'adopt' && request.change.target === 'capability'; const capture = adopt && preview.sourceSelection ? this.owner.sources!.Capture(state, preview.sourceSelection, { kind: 'workspace_member', changeId }, time) : undefined; const member: WorkspaceMember = { workspaceId: request.workspaceId, memberId: old?.memberId ?? randomUUID(), revision: (old?.revision ?? 0) + 1, name: p.name, position: p.position, adaptation: p.adaptation, state: p.state, adoption: adopt ? { captureId: randomUUID(), capturedAt: time, knowledgeRevision: p.capability.configuration.knowledgeRevision, capabilityHash: p.capability.capabilityHash, configuration: p.capability.configuration, ...(capture ? { sourceRef: capture.ref } : {}) } : old!.adoption, runtimePolicy: p.runtimePolicy, createdAt: old?.createdAt ?? time, updatedAt: time }; const cursor = this.Cursor(state), change: WorkspaceMemberChange = { version: 1, request, changeId, registryCursor: { kind: 'workspace_registry', workspaceId: request.workspaceId, streamId: cursor?.streamId ?? randomUUID(), seq: (cursor?.seq ?? 0) + 1 }, previousRevision: old?.revision ?? 0, previousMemberHash: old ? workspaceMemberHash(old) : null, ...(preview.sourceSelection ? { sourceSelection: preview.sourceSelection } : {}), next: member, actor: structuredClone(actor), committedAt: time }; return { workspaceMemberChanges: [change], ...(capture?.event ? { knowledgeSourceChanges: [capture.event] } : {}), receipt: workspaceMemberReceipt(change) }; });

    return adopting ? this.owner.WithSourceSnapshot(execute) : execute();
  }

  private async Capability(agentId: string, fixed?: Snapshot): Promise<WorkspaceMemberCapability>
  {
    const snapshot = fixed ?? await this.owner.Snapshot();

    const configuration = await resolveDispatchAgent(snapshot, agentId);

    const parsed = workspaceMemberCapabilitySchema.safeParse(configuration);

    if (!parsed.success)

      fail('MEMBER_SOURCE_INVALID', '当前角色能力不符合岗位快照协议或超过容量');

    return parsed.data;
  }

  private async Policy(ref: WorkspaceMemberModelRef & { snapshot?: WorkspaceMemberModelSnapshot }): Promise<WorkspaceMemberRuntimePolicy>
  {
    const snapshot = workspaceMemberModelSnapshotSchema.parse(await this.models.Configuration(ref.profileId, ref.modelId, workspaceMemberEngine(ref), ref.modelRoles));

    return { profileId: ref.profileId, modelId: ref.modelId, ...(ref.engine === undefined ? {} : { engine: ref.engine }), ...(ref.modelRoles === undefined ? {} : { modelRoles: structuredClone(ref.modelRoles) }), snapshot, configurationHash: workspaceMemberModelHash(snapshot) };
  }

  private async Prepare(state: DispatchState, request: WorkspaceMemberPreviewInput, fixed?: Snapshot): Promise<PreparedMember>
  {
    this.Assert(request);

    const change = request.change,

      old = change.kind === 'register' ? undefined : this.Member(state, change.memberId);

    if (old)
    {
      if (old.revision !== ('expectedRevision' in change ? change.expectedRevision : 0))

        fail('MEMBER_REVISION_CONFLICT', '岗位版本已变化，请重新读取');

      if (old.state === 'retired')

        fail('MEMBER_RETIRED', '岗位已退休，历史可读但不能修改或恢复')
    }
    let proposed = old ? workspaceMemberProposed(old) : undefined,

      knowledgeRevision: string | undefined,

      model: WorkspaceMemberRuntimePolicy | undefined,

      sourceSelection: SourceSelection | undefined;

    const adopting = change.kind === 'register' || change.kind === 'adopt' && change.target === 'capability';

    if (adopting && knowledgeSourcePending(state))

      fail('MEMBER_SOURCE_PENDING', '来源事务待核实，尚未保存新的岗位采纳');

    const snapshot = adopting ? (fixed ?? await this.owner.Snapshot()) : undefined;

    if (change.kind === 'register')
    {
      const configuration = await this.SelectedCapability(change.agentId, snapshot);

      this.Assert(request);

      knowledgeRevision = configuration.knowledgeRevision;

      model = await this.SelectedPolicy(change.runtimePolicy);

      this.Assert(request);

      proposed = { name: change.name, position: change.position, adaptation: change.adaptation, state: 'active', capability: { configuration, capabilityHash: workspaceMemberCapabilityHash(configuration) }, runtimePolicy: model };
    }
    else if (change.kind === 'update')
    {
      const { runtimePolicy, ...patch } = change.patch;

      proposed = { ...proposed!, ...patch };

      if (runtimePolicy)
      {
        if (runtimePolicy.profileId === old!.runtimePolicy.profileId && runtimePolicy.modelId === old!.runtimePolicy.modelId && (runtimePolicy.engine ?? 'pi') === (workspaceMemberEngine(old!.runtimePolicy) ?? 'pi') && isDeepStrictEqual(runtimePolicy.modelRoles, old!.runtimePolicy.modelRoles))

          fail('MEMBER_NO_CHANGE', '相同模型的配置刷新请使用明确采纳操作');

        model = await this.SelectedPolicy(runtimePolicy);

        this.Assert(request);

        proposed.runtimePolicy = model;
      }
    }
    else if (change.kind === 'adopt')
    {
      if (change.target === 'capability')
      {
        const configuration = await this.SelectedCapability(old!.adoption.configuration.agentId, snapshot);

        this.Assert(request);

        const source = old!.adoption.configuration;

        if (configuration.workspaceId !== source.workspaceId || configuration.teamId !== source.teamId || configuration.agentId !== source.agentId || configuration.source !== source.source)

          fail('MEMBER_SOURCE_CHANGED', '能力来源身份发生变化，不能作为原岗位的能力采纳');

        knowledgeRevision = configuration.knowledgeRevision;

        proposed!.capability = { configuration, capabilityHash: workspaceMemberCapabilityHash(configuration) };
      }
      else
      {
        model = await this.SelectedPolicy(old!.runtimePolicy);

        this.Assert(request);

        proposed!.runtimePolicy = model
      }
    }
    else

      proposed!.state = change.nextState;

    if (adopting)
    {
      const configuration = proposed!.capability.configuration;

      try
      {
        sourceSelection = configuration.source === 'builtin' ? { kind: 'builtin', ref: { kind: 'builtin', id: 'cbim:executor', contentHash: proposed!.capability.capabilityHash } } : this.owner.sources!.Selection(state, snapshot!, { kind: 'agent', sourceId: configuration.agentId })
      }
      catch
      {
        fail('MEMBER_SOURCE_INVALID', '当前来源无法明确采纳')
      }
      const ref = sourceSelection.kind === 'builtin' ? sourceSelection.ref : sourceSelection.expectedRef;

      proposed!.capability = { configuration, capabilityHash: proposed!.capability.capabilityHash, ...(ref ? { sourceRef: ref } : {}) };
    }
    const changedFields = workspaceMemberChangedFields(old, proposed!);

    if (adopting && sourceSelection?.kind === 'workspace' && !sourceSelection.expectedRef && !changedFields.includes('capability'))

      changedFields.push('capability');

    if (!changedFields.length)

      fail('MEMBER_NO_CHANGE', '本次操作没有改变岗位登记内容');

    const registryCursor = this.Cursor(state),

      basis = workspaceMemberPreviewBasis({ workspaceId: request.workspaceId, change, registryCursor, previousMember: old, proposed: proposed!, ...(sourceSelection ? { sourceSelection } : {}) });

    const preview = workspaceMemberPreviewSchema.parse({ identity: this.Identity(), change, registryCursor, basis, checkedAt: new Date().toISOString(), previousRevision: old?.revision ?? 0, ...(old ? { previousMember: old } : {}), ...(sourceSelection ? { sourceSelection } : {}), proposed, changedFields });

    return { preview, knowledgeRevision, model };
  }

  /** 独立来源最后复验后立即返回 mutation；不宣称模型设置与知识存储拥有同一事务锁。 */
  private async VerifySources(prepared: PreparedMember, identity: WorkspaceMemberIdentity)
  {
    if (prepared.knowledgeRevision !== undefined)
    {
      const current = await this.owner.Read();

      this.Assert(identity);

      if (current.revision !== prepared.knowledgeRevision)

        fail('MEMBER_SOURCE_CHANGED', '读取期间知识来源发生变化，请重新预览')
    }
    if (prepared.model)
    {
      const current = await this.SelectedPolicy(prepared.model);

      this.Assert(identity);

      if (current.configurationHash !== prepared.model.configurationHash)

        fail('MEMBER_SOURCE_CHANGED', '读取期间模型配置发生变化，请重新预览')
    }
    this.Assert(identity);
  }

  private async SelectedCapability(agentId: string, snapshot?: Snapshot)
  {
    if (agentId === 'cbim:executor')

      fail('AGENT_RETIRED', '内置默认执行 Agent 已退役；主 Agent 默认执行，无需登记岗位');

    try
    {
      return await this.Capability(agentId, snapshot)
    }
    catch
    {
      fail('MEMBER_SOURCE_INVALID', '无法采纳当前角色能力，请检查角色、原则、有效 Skill 与知识结构')
    }
  }

  /** 旧采纳快照与账本保持可读，不再读取或重建已退役的内置能力。 */
  private async BuiltinStatus(_member: WorkspaceMember, _snapshot: Snapshot): Promise<KnowledgeSourceReadState>
  {
    return { status: 'invalid', issue: '内置默认执行 Agent 已退役，历史岗位保留；未配置自定义 Agent 的模块由主 Agent 直接执行' }
  }

  private async SelectedPolicy(ref: WorkspaceMemberModelRef & { snapshot?: WorkspaceMemberModelSnapshot })
  {
    try
    {
      return await this.Policy(ref)
    }
    catch
    {
      fail('MEMBER_MODEL_INVALID', '无法读取明确选定的公开模型配置，请检查供应商与已启用模型')
    }
  }

  private async Diff(member: WorkspaceMember): Promise<WorkspaceMemberCurrentDiff>
  {
    let capability: WorkspaceMemberCurrentDiff['capability'],

      model: WorkspaceMemberCurrentDiff['model'];

    try
    {
      const current = await this.Capability(member.adoption.configuration.agentId),

        after = await this.owner.Read();

      if (after.revision !== current.knowledgeRevision)

        fail('MEMBER_SOURCE_STALE', '知识来源读取期间变化');

      const currentHash = workspaceMemberCapabilityHash(current);

      capability = { status: currentHash === member.adoption.capabilityHash ? 'same' : 'changed', adoptedHash: member.adoption.capabilityHash, currentHash, knowledgeRevision: current.knowledgeRevision };
    }
    catch (error)
    {
      capability = { status: issue(error) === 'AGENT_MISSING' ? 'missing' : 'invalid', adoptedHash: member.adoption.capabilityHash, issue: '当前角色能力缺失、无效或读取期间发生变化；已采纳快照仍保留' }
    }
    try
    {
      const current = await this.Policy(member.runtimePolicy),

        after = await this.Policy(member.runtimePolicy);

      if (current.configurationHash !== after.configurationHash)

        fail('MEMBER_SOURCE_STALE', '模型配置读取期间变化');

      model = { status: current.configurationHash === member.runtimePolicy.configurationHash ? 'same' : 'changed', adoptedHash: member.runtimePolicy.configurationHash, currentHash: current.configurationHash };
    }
    catch (error)
    {
      model = { status: issue(error) === 'LLM_REQUIRED' ? 'missing' : 'invalid', adoptedHash: member.runtimePolicy.configurationHash, issue: '当前公开模型配置缺失、无效或读取期间发生变化；不代表凭据或接口状态' }
    }
    return { checkedAt: new Date().toISOString(), capability, model };
  }
}
