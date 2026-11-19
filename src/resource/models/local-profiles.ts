/** Local model configuration storage and credential protection. */
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { atomic } from '../../core/io/text-files';
import { SerialQueue } from '../../core/utility';
import type { SecretCipher } from '../../core/io/electron';

interface ProviderConfiguration
{
  auth: string;
  api: string;
  baseUrl: string;
  alternateConnections?: readonly { api: string; baseUrl: string }[];
  embedding?: { baseUrl: string };
}

export type StoredProfile<P> = P & { id: string; encryptedKey?: string };
export interface ModelFile<P> { version: 1; selectedId?: string; profiles: StoredProfile<P>[] }
const fileSchema = z.object({ version: z.literal(1), selectedId: z.string().uuid().optional(), profiles: z.array(z.object({ id: z.string().uuid(), encryptedKey: z.string().optional() }).passthrough()).max(100) });

export class LocalModelProfiles<P extends ProviderConfiguration>
{
  private readonly _queue = new SerialQueue();
  private readonly draftSchema = z.object({ id: z.string().uuid().optional(), profile: z.unknown(), apiKey: z.string().max(16000).optional() }).strict();

  constructor(private filename: string, private definition: z.ZodType<P, z.ZodTypeDef, unknown>, private cipher?: SecretCipher)
  {

  }

  protected async Read(): Promise<ModelFile<P>>
  {
    let raw: any;

    try
    {
      raw = JSON.parse(await fs.readFile(this.filename, 'utf8'))
    }
    catch (e: any)
    {
      if (e.code === 'ENOENT')
        return { version: 1, profiles: [] };

      throw Error('模型配置读取失败，请检查配置文件')
    }

    const data = fileSchema.parse(raw),
      profiles = data.profiles.map(p => { const { id, encryptedKey, ...rest } = p; return { ...this.definition.parse(rest), id, encryptedKey } });

    if (new Set(profiles.map(p => p.id)).size !== profiles.length || data.selectedId && !profiles.some(p => p.id === data.selectedId))
      throw new Error('模型配置身份不一致');

    return { version: 1, selectedId: data.selectedId, profiles };
  }

  protected get credentialStorageAvailable(): boolean
  {
    return this.cipher?.Available() === true;
  }

  private Write(data: ModelFile<P>)
  {
    return atomic(this.filename, JSON.stringify(data, null, 2));
  }

  private Parse(input: unknown)
  {
    const draft = this.draftSchema.parse(input);
    return { ...draft, profile: this.definition.parse(draft.profile) };
  }

  private Build(draft: { id?: string; profile: P; apiKey?: string }, previous?: StoredProfile<P>): StoredProfile<P>
  {
    let encryptedKey: string | undefined;
    if (draft.profile.auth === 'api-key')
    {
      if (draft.apiKey)
      {
        if (!this.cipher?.Available()) throw new Error('系统加密不可用，无法保存 API Key');
        encryptedKey = this.cipher.Encrypt(draft.apiKey);
      }
      else
      {
        const addedTarget = draft.profile.alternateConnections?.some(connection => !previous?.alternateConnections?.some(old => old.api === connection.api && old.baseUrl === connection.baseUrl))
          || draft.profile.embedding && draft.profile.embedding.baseUrl !== previous?.embedding?.baseUrl;
        if (previous && (previous.baseUrl !== draft.profile.baseUrl || previous.api !== draft.profile.api || addedTarget))
          throw new Error('更换接口地址、协议或新增兼容接口后请重新输入 API Key');
        encryptedKey = previous?.encryptedKey;
      }
      if (!encryptedKey) throw new Error('请输入 API Key');
    }
    return { ...draft.profile, id: previous?.id ?? randomUUID(), encryptedKey };
  }

  protected Decrypt(p: StoredProfile<P>)
  {
    if (!p.encryptedKey || !this.cipher?.Available())
      throw new Error('模型密钥不可用，请重新保存 API Key');

    try
    {
      return this.cipher.Decrypt(p.encryptedKey)
    }
    catch
    {
      throw new Error('模型密钥无法解密，请重新保存 API Key')
    }
  }

  protected Change<T>(operation: () => Promise<T>)
  {
    return this._queue.Run(operation);
  }

  private Update(update: (data: ModelFile<P>) => void)
  {
    return this.Change(async () => { const data = await this.Read(); update(data); await this.Write(data); return data; });
  }

  protected SaveProfile(input: unknown)
  {
    return this.Update(data => { const draft = this.Parse(input); const previous = data.profiles.find(profile => profile.id === draft.id); if (draft.id && !previous) throw new Error('供应商不存在'); const profile = this.Build(draft, previous); if (previous) data.profiles[data.profiles.indexOf(previous)] = profile; else { if (data.profiles.length >= 100) throw new Error('最多保存 ' + 100 + ' 个供应商'); data.profiles.push(profile); } data.selectedId ??= profile.id; });
  }

  protected SelectProfile(id: string)
  {
    return this.Update(data => { if (!data.profiles.some(profile => profile.id === id)) throw new Error('供应商不存在'); data.selectedId = id; });
  }

  protected RemoveProfile(id: string)
  {
    return this.Update(data => { const index = data.profiles.findIndex(profile => profile.id === id); if (index < 0) throw new Error('供应商不存在'); data.profiles.splice(index, 1); if (data.selectedId === id) data.selectedId = data.profiles[0]?.id; });
  }

  protected WithSnapshot<Ref, T>(references: readonly Ref[], use: (data: ModelFile<P>, refs: readonly Ref[]) => Promise<T>)
  {
    const fixed = structuredClone(references);

    return this.Change(async () => use(await this.Read(), fixed));
  }

}
