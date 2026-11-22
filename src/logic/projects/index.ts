/**
 * 作用定位：Catalog：维护本机工作区清单、显示名称、路径身份、并发更新和重新定位。
 * 设计原因：用规范化路径身份和跨进程锁维护登记，避免窗口各自保存不一致的工作区。
 */
import fs from 'node:fs/promises';

import path from 'node:path';

import { execFile } from 'node:child_process';

import { promisify } from 'node:util';

import { KernelLock, KernelLockError } from '../../core/io/locking';

import { ProjectCache } from './project-cache';

import { Paths } from './paths';

import { atomic, exists, readJson } from '../../core/io/text-files';

import { hash, json } from '../../core/io/serialization';

import type { Catalog as Data, WorkspaceEntry } from './contracts';

const run = promisify(execFile);

const empty = (): Data => ({ version: 1, entries: [], recent: [] });

export class Catalog
{
  private readonly caches = new Map<string, ProjectCache>();

  Cache(id: string)
  {
    let cache = this.caches.get(id);

    if (!cache)
    {
      const root = this.paths.userRoot;
      const temporary = path.basename(root).toLowerCase() === '.cbim' ? path.join(path.dirname(root), '.cbim_temp') : path.join(root, '.cbim_temp');
      cache = new ProjectCache(this.paths.Project(id), path.join(temporary, id), path.join(root, 'worktrees'));

      this.caches.set(id, cache);
    }

    return cache;
  }

  warning = '';

  constructor(readonly paths: Paths)
  {
  }

  async Init()
  {
    await fs.mkdir(this.paths.userRoot, { recursive: true, mode: 0o700 });

    if (process.platform === 'win32')
    {
      const who = (await run('whoami', [], { windowsHide: true })).stdout.trim();

      await run('icacls', [this.paths.userRoot, '/inheritance:r', '/grant:r', `${who}:(OI)(CI)F`], { windowsHide: true });
    }
    else
      await fs.chmod(this.paths.userRoot, 0o700);
  }

  async Read(): Promise<Data>
  {
    const p = path.join(this.paths.userRoot, 'workspaces.json');

    if (!await exists(p))
      return empty();

    try
    {
      const value = await readJson<Data>(p);

      if (value.version !== 1 || !Array.isArray(value.entries) || !Array.isArray(value.recent))
        throw Error('invalid');

      // 兼容旧登记文件，只返回当前字段；读取不写盘，下次受锁保护的更新自然移除旧字段。
      this.warning = '';

      return { version: 1, entries: value.entries, recent: value.recent }
    }
    catch
    {
      this.warning = '工作区登记缓存损坏，原文件保留；仍可手动添加工作区。';

      return empty()
    }
  }

  async Update(edit: (data: Data) => void)
  {
    let lock: KernelLock | undefined;

    const canonical = await fs.realpath(this.paths.userRoot);

    const key = hash(process.platform === 'win32' ? canonical.replaceAll('\\', '/').toLowerCase() : canonical);

    for (let n = 0; n < 100; n++)
    {
      try
      {
        lock = new KernelLock(canonical, key, 'catalog');

        break
      }
      catch (e: any)
      {
        if (!(e instanceof KernelLockError) || e.reason !== 'busy')
          throw e;

        await new Promise(r => setTimeout(r, 30))
      }
    }

    if (!lock)
      throw new Error('工作区列表正在被其他窗口更新，请重试');

    try
    {
      const data = await this.Read();

      if (this.warning && await exists(path.join(canonical, 'workspaces.json')))
        await fs.copyFile(path.join(canonical, 'workspaces.json'), path.join(canonical, `workspaces.corrupt-${Date.now()}.json`));

      edit(data);

      await atomic(path.join(canonical, 'workspaces.json'), json(data));

      return data
    }
    finally
    {
      lock.Close()
    }
  }

  async Add(root: string)
  {
    const identity = await this.paths.Identity(root);

    let entry!: WorkspaceEntry;

    await this.Update(data => { entry = data.entries.find(x => x.id === identity.id)!; if (!entry) { entry = { ...identity, name: path.basename(identity.path) }; data.entries.push(entry) } });

    const mapping = this.Cache(entry.id).identity;

    if (await exists(mapping))
    {
      if ((await readJson(mapping)).path !== entry.path)
        throw new Error('项目标识与保存的路径不一致')
    }
    else
      await atomic(mapping, json(identity));

    return entry;
  }
}
