/**
 * 目录归属：logic/models/service；模型配置与运行快照。
 * 作用定位：本机供应商配置持久化、生成模型选择、跨模型操作原子捕获和连接检测。
 * 设计原因：运行与岗位登记共用实际模型选型；岗位领取在同一配置队列中固定公开参数并延迟解密，与设置修改形成明确先后，凭据不进入登记或任务日志。
 * 模型服务只接受协议需求，不读取引擎身份；连接错误保留安全端点与状态诊断，不泄露密钥、查询参数或供应商响应正文，不清空已保存模型目录。
 * 运行、岗位和显式测试在解密前共用接口选择；候选地址不进入运行快照，列表读取不会探测网络。
 */
import { LocalModelProfiles, type ModelFile, type StoredProfile } from '../../../resource/models/local-profiles';

import { z } from 'zod';

import { discoverProtocolModels, probeEmbedding, probeGeneration } from './protocol-probe';

import { selectProviderConnection, connectionSchema, definition, type ModelConnectionRequirement, type LlmDefinition, type LlmSettings, type SecretCipher, type ResolvedLlm } from '../index';

import type { ResolvedModelOperation } from '../index';

export type { ResolvedModelOperation } from '../index';

export type { LlmDefinition, LlmProfile, LlmSettings, SecretCipher, ResolvedLlm } from '../index';

/** 明确岗位选型，不允许默认模型或主会话设置参与解析。 */
export interface ExplicitModelReference
{
  profileId: string;

  modelId: string;

  connection?: ModelConnectionRequirement
}

/** 只在持锁回调存活期间解析捕获定义；调用方必须先通过预算与占用，返回后不得重新解析。 */
export interface LockedModelConfiguration
{
  profile: ResolvedLlm['profile'];

  Resolve(): ResolvedLlm
}

/** 操作类型由可信角色选型指定，向量模型不按默认生成型号解析。 */
export type ModelOperationReference = ExplicitModelReference |
{
  kind: 'embedding';

  profileId: string;

  modelId: string
};

/** 同一读取与配置短锁捕获全部操作；resolve(index) 在回调结束后失效。 */
export interface LockedModelOperations
{
  profiles: readonly ResolvedModelOperation['profile'][];

  Resolve(index: number): ResolvedModelOperation
}

/** 单一纯选型投影；只有运行 resolve 可在选定之后解密，登记调用必须显式给出两个 ID。 */
function selectConfiguration(data: ModelFile<LlmDefinition>, id?: string, modelId?: string, connection?: ModelConnectionRequirement)
{
  const definition = data.profiles.find(profile => profile.id === (id ?? data.selectedId));

  if (!definition)
    throw new Error('请先在设置中配置默认大模型');

  const model = definition.models.find(item => item.id === (modelId ?? definition.defaultModel) && item.enabled);

  if (!model)
    throw new Error('模型不存在或已禁用');

  const selectedConnection = selectProviderConnection(definition, connection, model.id);

  if (!selectedConnection)
    throw new Error('没有满足所选协议要求的兼容接口，请在模型设置中配置该供应商的兼容接口');

  const profile: ResolvedLlm['profile'] = {
    id: definition.id, name: definition.name, api: selectedConnection.api, baseUrl: selectedConnection.baseUrl, auth: definition.auth, model: model.id, contextWindow: model.contextWindow, maxTokens: model.maxTokens, reasoning: model.reasoning,
    ...(model.vision === undefined ? {} : { vision: model.vision }), ...(model.outputLimit === undefined ? {} : { outputLimit: model.outputLimit }), ...(model.thinkingLevel === undefined ? {} : { thinkingLevel: model.thinkingLevel }), ...(model.workingContextWindow === undefined ? {} : { workingContextWindow: model.workingContextWindow }), ...(model.compactionPercent === undefined ? {} : { compactionPercent: model.compactionPercent }), ...(model.pricing === undefined ? {} : { pricing: structuredClone(model.pricing) })
  };

  // 单次运行只冻结实际接口；不改写供应商主接口或历史快照。
  return { definition, profile };
}

/** 向量操作必须具有显式接口、启用型号和真实维度；不从生成模型补造向量能力。 */
function selectOperation(data: ModelFile<LlmDefinition>, ref: ModelOperationReference): { definition: StoredProfile<LlmDefinition>; profile: ResolvedModelOperation['profile'] }
{
  if (!('kind' in ref))
    return selectConfiguration(data, ref.profileId, ref.modelId, ref.connection);

  if (ref.kind !== 'embedding')
    throw new Error('模型操作类型无效');

  const definition = data.profiles.find(profile => profile.id === ref.profileId);

  if (!definition)
    throw new Error('向量模型供应商不存在');

  const connection = definition.embedding,
    model = connection?.models.find(model => model.id === ref.modelId && model.enabled);

  if (!connection || !model)
    throw new Error('向量模型不存在或已禁用，请明确配置向量接口和型号');

  return { definition, profile: { kind: 'embedding', id: definition.id, name: definition.name, api: connection.api, baseUrl: connection.baseUrl, auth: definition.auth, model: model.id, inputTokens: model.inputTokens, dimensions: model.dimensions, ...(model.inputPrice === undefined ? {} : { inputPrice: model.inputPrice }) } };
}

export class LlmProfiles extends LocalModelProfiles<LlmDefinition>
{
  constructor(filename: string, cipher?: SecretCipher)
  {
    super(filename, definition, cipher);
  }

  private Settings(data: ModelFile<LlmDefinition>): LlmSettings
  {
    const profiles = data.profiles.map(({ encryptedKey, ...profile }) => ({ ...profile, hasKey: Boolean(encryptedKey) }));

    return { selectedId: data.selectedId, secureStorage: this.credentialStorageAvailable, profiles };
  }

  public async List()
  {
    return this.Settings(await this.Read());
  }

  public async Save(input: unknown)
  {
    return this.Settings(await this.SaveProfile(input));
  }

  public async Select(id: string)
  {
    return this.Settings(await this.SelectProfile(id));
  }

  public async Remove(id: string)
  {
    return this.Settings(await this.RemoveProfile(id));
  }

  private RuntimeKey(profile: StoredProfile<LlmDefinition>)
  {
    return profile.auth === 'none' ? 'cbim-local-no-auth' : this.Decrypt(profile);
  }

  protected WithResolvedProfiles<Ref, Public, Resolved, T>(refs: readonly Ref[], select: (data: ModelFile<LlmDefinition>, ref: Ref) => { profile: Public; Resolve(): Resolved }, use: (locked: { profiles: Public[]; Resolve(index: number): Resolved }) => Promise<T>): Promise<T>
  {
    return this.WithSnapshot(refs, async (data, fixed) => { const selected = fixed.map(ref => select(data, ref)); const cache = new Map<number, Resolved>(); let active = true; try { return await use({ profiles: selected.map(item => structuredClone(item.profile)), Resolve(index) { if (!active) throw new Error('模型配置准备已结束，不能重新解析凭据'); if (!Number.isInteger(index) || index < 0 || index >= selected.length) throw new Error('模型角色索引不存在'); if (!cache.has(index)) cache.set(index, selected[index].Resolve()); return cache.get(index)!; }, }); } finally { active = false; cache.clear(); } });
  }

  /** 将公开供应商配置展开为选定模型；禁用模型不得用于新运行。 */
  async Resolve(id?: string, modelId?: string, connection?: ModelConnectionRequirement): Promise<ResolvedLlm>
  {
    const selected = selectConfiguration(await this.Read(), id, modelId, connection);

    return { profile: selected.profile, apiKey: this.RuntimeKey(selected.definition) };
  }

  /** 供岗位登记与当前差异读取；不使用默认选择、不解密、不探测接口，也不保证凭据可用或模型能运行。 */
  async Configuration(profileId: string, modelId: string, connection?: ModelConnectionRequirement): Promise<ResolvedLlm['profile']>
  {
    if (!z.string().uuid().safeParse(profileId).success || typeof modelId !== 'string' || !modelId.trim())
      throw new Error('岗位配置必须明确选择供应商与模型');

    return selectConfiguration(await this.Read(), profileId, modelId, connection).profile;
  }

  /** 多岗位一次读取并持有设置队列，直到短事务结束；公开快照无凭据，不联网，不在回调中再次进入本队列。 */
  WithConfigurations<T>(refs: readonly ExplicitModelReference[], use: (profiles: readonly ResolvedLlm['profile'][]) => Promise<T>): Promise<T>
  {
    return this.WithSnapshot(refs, async (data, fixed) => { const profiles = fixed.map(ref => { this.Explicit(ref); return selectConfiguration(data, ref.profileId, ref.modelId, ref.connection).profile }); return use(profiles); });
  }

  /**
       * 固定配置至领取事务提交；resolve 只解密已捕获定义，不读取设置或重新排队。
       * 预算/占用通过后才能调用 resolve；真正启动引擎在回调及所有锁释放后，之后设置修改不热替换本段。
       */
  WithRuntimeConfiguration<T>(ref: ExplicitModelReference, use: (configuration: LockedModelConfiguration) => Promise<T>): Promise<T>
  {
    return this.WithResolvedProfiles([ref], (data, fixed) => { this.Explicit(fixed); const selected = selectConfiguration(data, fixed.profileId, fixed.modelId, fixed.connection); return { profile: selected.profile, Resolve: () => ({ profile: structuredClone(selected.profile), apiKey: this.RuntimeKey(selected.definition) }) }; }, locked => use({ profile: locked.profiles[0], Resolve: () => locked.Resolve(0) }));
  }

  private Explicit(ref: ExplicitModelReference)
  {
    if (!z.string().uuid().safeParse(ref.profileId).success || typeof ref.modelId !== 'string' || !ref.modelId.trim())
      throw new Error('岗位配置必须明确选择供应商与模型')
  }

  /**
       * 在唯一配置队列中原子捕获生成与向量角色，不联网、不修改设置。
       * 准入前只读 profiles；准入后按索引延迟解密，未使用的角色不会解析凭据。
       * 回调中不得再次进入本队列，锁外启动执行；失败仅释放本次锁，不重试。
       */
  WithModelOperations<T>(refs: readonly ModelOperationReference[], use: (locked: LockedModelOperations) => Promise<T>): Promise<T>
  {
    return this.WithResolvedProfiles(refs, (data, ref) => { this.Explicit(ref); const selected = selectOperation(data, ref); return { profile: selected.profile, Resolve: () => ({ profile: structuredClone(selected.profile), apiKey: this.RuntimeKey(selected.definition) }) }; }, use);
  }

  /** 获取草稿接口的模型 ID；失败不阻止手动添加。保存凭据只在同地址、同协议时复用。 */
  async Discover(input: unknown)
  {
    return (await this.DiscoverDetails(input)).map(m => m.id)
  }

  /** 读取供应商能力元数据；缺失字段不以固定 32k/200k 替代，不自动写回配置。 */
  async DiscoverDetails(input: unknown)
  {
    const r = z.object({ id: z.string().uuid().optional(), connection: connectionSchema.strict(), apiKey: z.string().max(16000).optional() }).strict().parse(input);

    let key = r.apiKey || '';

    if (r.connection.auth === 'api-key' && !key)
    {
      const p = (await this.Read()).profiles.find(p => p.id === r.id);

      if (!p || p.baseUrl !== r.connection.baseUrl || p.api !== r.connection.api)
        throw new Error('请先输入该接口的 API Key');

      key = this.RuntimeKey(p)
    }

    return discoverProtocolModels(r.connection, key);
  }

  /** 按协议需求测试已保存模型的实际接口；不写兼容状态或改目录，短文本成功不代表工具/流式完整验收。 */
  async Test(id: string, modelId?: string, connection?: ModelConnectionRequirement)
  {
    return probeGeneration(await this.Resolve(id, modelId, connection));
  }

  /** 用户显式的小样本向量探测；短锁内冻结配置，网络在锁外，不写索引或宣称模型业务验收。 */
  async TestEmbedding(id: string, modelId: string)
  {
    const operation = await this.WithModelOperations([{ kind: 'embedding', profileId: id, modelId }], async locked => locked.Resolve(0));

    return probeEmbedding(operation);
  }
}
