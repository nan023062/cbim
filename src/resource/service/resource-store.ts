import { resourceKindIds } from '..';

/**
 * 作用定位：RepositoryStore 与 LocalRepository：本地资源仓库校验、版本检查及原子更新。
 * 设计原因：用统一接口隔离本地和远端仓库，写入要求仓库身份与版本一致；允许完整静态架构包，仍统一限制单项和仓库总字节数。
 * 算法入口：通过 Core JsonUtils 静态方法复用机制，本文件继续拥有原业务策略。
 */
import fs from 'node:fs/promises';

import path from 'node:path';

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { KernelLock, KernelLockError } from '../../core/io/locking';

import { atomic } from '../../core/io/text-files';

import { sha256 as hash } from '../../core/io/digest';

import { JsonUtils } from '../../core/io';

import type { ResourceLibrarySnapshot } from '..';

export const MAX_BYTES = 8 * 1024 * 1024;

export const resourceFields = z.object({ kind: z.enum(resourceKindIds), name: z.string().trim().min(1).max(100), summary: z.string().trim().max(1000), content: z.string().min(1).max(2 * 1024 * 1024).refine(value => Buffer.byteLength(value) <= 2 * 1024 * 1024, '单项资源正文不能超过 2 MiB') }).strict();

export const itemSchema = resourceFields.extend({ id: z.string().uuid(), updatedAt: z.string().datetime() });

export const snapshotSchema = z.object({ repositoryId: z.string().uuid(), revision: z.string(), items: z.array(itemSchema).max(2000) });

// 旧版记录只留在原仓库文件，公开快照和 HTTP 共享只返回当前资产。
const archivedItem = itemSchema.extend({ kind: z.enum(['connector', 'model', 'workspace', 'module']) });

const diskSchema = z.object({ version: z.literal(1), repositoryId: z.string().uuid(), items: z.array(z.union([itemSchema, archivedItem])).max(2000) }).strict();

export const saveSchema = z.object({ repositoryId: z.string().uuid(), revision: z.string(), id: z.string().uuid().optional(), item: resourceFields }).strict();

export const removeSchema = z.object({ repositoryId: z.string().uuid(), revision: z.string(), id: z.string().uuid() }).strict();

export type RepositoryIssue = 'busy' | 'unsafePath' | 'oversize' | 'missing' | 'invalidData' | 'identityChanged' | 'revisionChanged';

type ReportIssue = (issue: RepositoryIssue) => void;

/** 本地和 HTTP 仓库共用接口；save/remove 校验身份及版本并返回更新后的完整快照。 */
export interface RepositoryStore
{
  Read(): Promise<ResourceLibrarySnapshot>;

  Save(args: unknown): Promise<ResourceLibrarySnapshot>;

  Remove(args: unknown): Promise<ResourceLibrarySnapshot>
}

export class LocalRepository implements RepositoryStore
{
  constructor(readonly root: string)
  {
  }

  private get file()
  {
    return path.join(this.root, 'cbim-resources.json')
  }

  private async Lock(report?: ReportIssue)
  {
    const key = hash(process.platform === 'win32' ? this.root.replaceAll('\\', '/').toLowerCase() : this.root);

    for (let n = 0; n < 100; n++)
    {
      try
      {
        return new KernelLock(this.root, key, 'resource-repository')
      }
      catch (e: any)
      {
        if (!(e instanceof KernelLockError) || e.reason !== 'busy')
          throw e;

        await new Promise(r => setTimeout(r, 30))
      }
    }

    {
      report?.('busy');

      throw new Error('仓库正由其他请求更新，请稍后重试')
    }
  }

  private async CheckFile(report?: ReportIssue)
  {
    try
    {
      if ((await fs.lstat(this.file)).isSymbolicLink())
      {
        report?.('unsafePath');

        throw new Error('仓库数据文件不能是符号链接')
      }
    }
    catch (e: any)
    {
      if (e.code !== 'ENOENT')
        throw e
    }
  }

  async Initialize()
  {
    const lock = await this.Lock();

    try
    {
      await this.CheckFile();

      try
      {
        await fs.access(this.file)
      }
      catch (e: any)
      {
        if (e.code !== 'ENOENT')
          throw e;

        await atomic(this.file, JsonUtils.FormatJson({ version: 1, repositoryId: randomUUID(), items: [] }))
      }

      return await this.Read()
    }
    finally
    {
      lock.Close()
    }
  }

  async Read(report?: ReportIssue): Promise<ResourceLibrarySnapshot>
  {
    return (await this.ReadDisk(report)).snapshot;
  }

  private async ReadDisk(report?: ReportIssue)
  {
    await this.CheckFile(report);

    let text: string;

    try
    {
      const stat = await fs.stat(this.file);

      if (stat.size > MAX_BYTES)
      {
        report?.('oversize');

        throw new Error('资源仓库超过 8 MiB 限制')
      }

      ;

      text = await fs.readFile(this.file, 'utf8')
    }
    catch (e: any)
    {
      if (e.code === 'ENOENT')
      {
        report?.('missing');

        throw new Error('仓库文件不存在，请重新选择仓库')
      }

      ;

      throw e
    }

    try
    {
      const data = diskSchema.parse(JSON.parse(text));

      if (new Set(data.items.map(i => i.id)).size !== data.items.length)
        throw Error('duplicate');

      const items: ResourceLibrarySnapshot['items'] = [];

      const archived: z.infer<typeof archivedItem>[] = [];

      for (const item of data.items)
      {
        const old = archivedItem.safeParse(item);

        if (old.success)
          archived.push(old.data);
        else
          items.push(itemSchema.parse(item));
      }

      return { snapshot: { repositoryId: data.repositoryId, revision: hash(text), items }, archived };
    }
    catch
    {
      {
        report?.('invalidData');

        throw new Error('仓库内容格式无效，原文件已保留，请修复后重试')
      }
    }
  }

  async Save(args: unknown, report?: ReportIssue)
  {
    const r = saveSchema.parse(args);

    return this.Update(r, report, data => { const index = r.id ? data.items.findIndex(i => i.id === r.id) : -1; if (r.id && index < 0) { report?.('missing'); throw new Error('资源已被删除，请刷新') }; const item = { ...r.item, id: r.id || randomUUID(), updatedAt: new Date().toISOString() }; if (index < 0) data.items.push(item); else data.items[index] = item })
  }

  async Remove(args: unknown, report?: ReportIssue)
  {
    const r = removeSchema.parse(args);

    return this.Update(r, report, data => { if (!data.items.some(i => i.id === r.id)) { report?.('missing'); throw new Error('资源已被删除，请刷新') }; data.items = data.items.filter(i => i.id !== r.id) })
  }

  private async Update(request: { repositoryId: string; revision: string }, report: ReportIssue | undefined, edit: (data: ResourceLibrarySnapshot) => void)
  {
    const lock = await this.Lock(report);

    try
    {
      const { snapshot: current, archived } = await this.ReadDisk(report);

      if (current.repositoryId !== request.repositoryId)
      {
        report?.('identityChanged');

        throw new Error('仓库身份已变化，请重新连接')
      }

      ;

      if (current.revision !== request.revision)
      {
        report?.('revisionChanged');

        throw new Error('仓库已被修改，请刷新后重新编辑')
      }

      ;

      edit(current);

      const text = JsonUtils.FormatJson(diskSchema.parse({ version: 1, repositoryId: current.repositoryId, items: [...current.items, ...archived] }));

      if (Buffer.byteLength(text) > MAX_BYTES)
      {
        report?.('oversize');

        throw new Error('资源仓库超过 8 MiB 限制')
      }

      ;

      await atomic(this.file, text);

      return { ...current, revision: hash(text) }
    }
    finally
    {
      lock.Close()
    }
  }
}
