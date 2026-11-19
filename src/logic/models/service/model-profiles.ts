import { SerialQueue } from '../../../core/utility';

export interface ModelProfileSet<Profile>
{
  selectedId?: string;

  profiles: Profile[];
}

/** 配置写入和运行捕获共用一条队列。宿主实现文件格式、凭据策略和对外视图。 */
export abstract class ModelProfiles<Profile extends { id: string }, Data extends ModelProfileSet<Profile>, Draft extends { id?: string }, View>
{
  private readonly _queue = new SerialQueue();

  protected abstract Read(): Promise<Data>;

  protected abstract Write(data: Data): Promise<void>;

  protected abstract View(data: Data): View;

  protected abstract readonly _maxProfiles: number;

  protected abstract Parse(input: unknown): Draft;

  protected abstract Build(draft: Draft, previous?: Profile): Profile;

  public async List()
  {
    return this.View(await this.Read());
  }

  protected Change<T>(operation: () => Promise<T>)
  {
    return this._queue.Run(operation);
  }

  private Update(update: (data: Data) => void)
  {
    return this.Change(async () => { const data = await this.Read(); update(data); await this.Write(data); return this.View(data); });
  }

  public Save(input: unknown)
  {
    return this.Update(data => { const draft = this.Parse(input); const previous = data.profiles.find(profile => profile.id === draft.id); if (draft.id && !previous) throw new Error('供应商不存在'); const profile = this.Build(draft, previous); if (previous) data.profiles[data.profiles.indexOf(previous)] = profile; else { if (data.profiles.length >= this._maxProfiles) throw new Error('最多保存 ' + this._maxProfiles + ' 个供应商'); data.profiles.push(profile); } data.selectedId ??= profile.id; });
  }

  public Select(id: string)
  {
    return this.Update(data => { if (!data.profiles.some(profile => profile.id === id)) throw new Error('供应商不存在'); data.selectedId = id; });
  }

  public Remove(id: string)
  {
    return this.Update(data => { const index = data.profiles.findIndex(profile => profile.id === id); if (index < 0) throw new Error('供应商不存在'); data.profiles.splice(index, 1); if (data.selectedId === id) data.selectedId = data.profiles[0]?.id; });
  }

  protected WithSnapshot<Ref, T>(references: readonly Ref[], use: (data: Data, refs: readonly Ref[]) => Promise<T>)
  {
    const fixed = structuredClone(references);

    return this.Change(async () => use(await this.Read(), fixed));
  }

  protected WithResolvedProfiles<Ref, Public, Resolved, T>(refs: readonly Ref[], select: (data: Data, ref: Ref) => { profile: Public; Resolve(): Resolved }, use: (locked: { profiles: Public[]; Resolve(index: number): Resolved }) => Promise<T>): Promise<T>
  {
    return this.WithSnapshot(refs, async (data, fixed) => { const selected = fixed.map(ref => select(data, ref)); const cache = new Map<number, Resolved>(); let active = true; try { return await use({ profiles: selected.map(item => structuredClone(item.profile)), Resolve(index) { if (!active) throw new Error('模型配置准备已结束，不能重新解析凭据'); if (!Number.isInteger(index) || index < 0 || index >= selected.length) throw new Error('模型角色索引不存在'); if (!cache.has(index)) cache.set(index, selected[index].Resolve()); return cache.get(index)!; }, }); } finally { active = false; cache.clear(); } });
  }
}
