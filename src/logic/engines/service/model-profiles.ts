import { kernel } from '../../../framework/kernel';
/**
 * 作用定位：把 Agent 引擎选型映射为通用模型连接需求，并在返回快照中冻结显式引擎身份。
 * 设计原因：引擎策略不进入模型配置服务；复用该服务唯一设置队列、配置捕获与延迟解密，避免新增锁或再次读取造成快照漂移。
 * 职责边界：不保存模型、不管理引擎安装、不自动重试；缺省 engine 保持缺省，历史快照及其哈希不改写。
 */
import type { ResolvedLlm, ResolvedModelOperation } from '../../models';

import type { LlmProfiles, ModelOperationReference } from '../../models/service';

import { modelRoleSnapshotSchema, engineDescriptor, engineModelRequirement, additionalRoleOperations, type LoopEngine, type ResolvedEngineModel, type ModelRolesSelection, type ModelRolesSnapshot } from '../index';

/** 明确供应商与模型身份；engine 缺省沿用旧 Pi 选型规则，但快照不补写该字段。 */
export interface EngineModelReference
{
  profileId: string;

  modelId: string;

  engine?: LoopEngine;

  modelRoles?: ModelRolesSelection
}

/** resolve 仍受模型配置服务的回调生命周期约束；回调结束后不能取凭据。 */
export interface LockedEngineModelConfiguration
{
  profile: ResolvedEngineModel['profile'];

  Resolve(): ResolvedEngineModel
}

const profileForEngine = (profile: ResolvedLlm['profile'], engine?: LoopEngine): ResolvedEngineModel['profile'] => engine === undefined ? profile : { ...profile, engine };

const requirement = (engine?: LoopEngine) => engineModelRequirement(engine ?? 'pi');

const reference = (ref: EngineModelReference) => ({ profileId: ref.profileId, modelId: ref.modelId, connection: requirement(ref.engine) });

/** 从静态声明固定角色顺序；用户选型不能追加引擎没有声明的操作。 */
function operations(ref: EngineModelReference)
{
  try
  {
    return additionalRoleOperations(engineDescriptor(ref.engine ?? 'pi').additionalModelRoles ?? [], ref.modelRoles)
  }
  catch (error)
  {
    throw new Error(error instanceof Error ? error.message : '模型角色配置无效')
  }
}

function references(ref: EngineModelReference): ModelOperationReference[]
{
  return [reference(ref), ...operations(ref).map(role => role.kind === 'embedding' ? { kind: 'embedding' as const, profileId: role.profileId, modelId: role.modelId } : { profileId: role.profileId, modelId: role.modelId, connection: role.connection })];
}

/** 只组装公开快照，primary 保持原字段顺序；额外角色的类型和元数据不互相填补。 */
function snapshot(ref: EngineModelReference, profiles: readonly ResolvedModelOperation['profile'][]): ResolvedEngineModel['profile']
{
  const primary = profiles[0];

  if (!primary || 'kind' in primary)
    throw new Error('主模型必须支持生成操作');

  const profile = profileForEngine(structuredClone(primary), ref.engine);

  if (ref.modelRoles !== undefined)
  {
    const roles: ModelRolesSnapshot['roles'] = {};

    operations(ref).forEach((role, index) => { roles[role.slot] = modelRoleSnapshotSchema.parse({ kind: role.kind, profile: profiles[index + 1] }) });

    profile.modelRoles = { version: 2, roles };
  }

  return profile;
}

export class EngineModelProfiles
{
  constructor(private readonly models: Pick<LlmProfiles, 'List' | 'Resolve' | 'Configuration' | 'WithModelOperations' | 'Test'>)
  {
  }

  /** 公开供应商目录仍由模型服务拥有；读取不探测网络。 */
  List()
  {
    return this.models.List()
  }

  /** 执行准备时选择协议并取凭据；无显式模型时允许模型服务使用当前默认值，不保存该选择。 */
  async Resolve(id?: string, modelId?: string, engine?: LoopEngine, modelRoles?: ModelRolesSelection): Promise<ResolvedEngineModel>
  {
    if (modelRoles !== undefined) { if (!id || !modelId) throw new Error('多模型执行必须明确指定主模型'); return this.WithRuntimeConfiguration({ profileId: id, modelId, engine, modelRoles }, async locked => locked.Resolve()) }
    operations({ profileId: id ?? '', modelId: modelId ?? '', engine });
    const resolved = await this.models.Resolve(id, modelId, requirement(engine));
    return { ...resolved, profile: profileForEngine(resolved.profile, engine) };
  }

  /** 岗位登记读取明确模型的公开快照；不解密、不联网，也不保证运行时凭据有效。 */
  Configuration(profileId: string, modelId: string, engine?: LoopEngine, modelRoles?: ModelRolesSelection): Promise<ResolvedEngineModel['profile']>
  {
    return this.WithConfigurations([{ profileId, modelId, engine, ...(modelRoles === undefined ? {} : { modelRoles }) }], async profiles => profiles[0]);
  }

  /** 所有引用在进入队列前捕获，映射与使用均在模型服务原来的同一短事务内。 */
  WithConfigurations<T>(refs: readonly EngineModelReference[], use: (profiles: readonly ResolvedEngineModel['profile'][]) => Promise<T>): Promise<T>
  {
    const fixed = structuredClone(refs);

    const grouped = fixed.map(references);
    return this.models.WithModelOperations(grouped.flat(), async locked => { let offset = 0; const profiles = fixed.map((ref, index) => { const values = locked.profiles.slice(offset, offset + grouped[index].length); offset += grouped[index].length; return snapshot(ref, values) }); return use(profiles) });
  }

  /** 领取事务中的引擎投影；延迟凭据解析只在 use 回调内有效，启动引擎应等事务与锁释放。 */
  WithRuntimeConfiguration<T>(ref: EngineModelReference, use: (configuration: LockedEngineModelConfiguration) => Promise<T>): Promise<T>
  {
    const fixed = structuredClone(ref);

    return this.models.WithModelOperations(references(fixed), async locked =>
    {
      let resolved: ResolvedEngineModel | undefined;

      return use({
        profile: snapshot(fixed, locked.profiles), Resolve: () =>
        {
          // 每次都检查原锁的存活期，不能用本层缓存绕过过期检查。
          const primary = locked.Resolve(0);

          if (resolved)
            return resolved;

          const extra = operations(fixed).map((role, index) => ({ slot: role.slot, value: locked.Resolve(index + 1) }));

          return resolved = { profile: snapshot(fixed, [primary.profile, ...extra.map(role => role.value.profile)]), apiKey: primary.apiKey, ...(fixed.modelRoles === undefined ? {} : { modelRoles: Object.fromEntries(extra.map(role => [role.slot, role.value])) }) };
        }
      });
    });
  }

  /** 保留现有按引擎诊断接口；HTTP 请求、凭据和响应校验仍由模型服务负责。 */
  async Test(id: string, modelId?: string, engine: LoopEngine = 'pi')
  {
    return ({ ...await this.models.Test(id, modelId, requirement(engine)), engine });
  }
}

/** 工作区提供配置存储；Kernel 在存储锁的有效期内解析并捕获执行配置。 */
export function engineConfigurations(models: Pick<EngineModelProfiles, 'WithRuntimeConfiguration'> & Partial<Pick<EngineModelProfiles, 'Resolve'>>)
{
  return kernel.Configurations<Partial<EngineModelReference>, EngineModelReference, ResolvedEngineModel['profile'], ResolvedEngineModel, LoopEngine>({
    Resolve: ref => {
      if (!models.Resolve) throw new Error('当前宿主仅支持显式岗位配置');
      return models.Resolve(ref.profileId, ref.modelId, ref.engine, ref.modelRoles);
    },
    WithRuntimeConfiguration: (ref, use) => models.WithRuntimeConfiguration(ref, use),
    Describe: model => ({ type: model.profile.engine ?? 'pi', llm: { provider: 'cbim-' + model.profile.id, model: model.profile.model, resolved: model } }),
  });
}
