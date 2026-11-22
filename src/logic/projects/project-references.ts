/**
 * 作用定位：管理当前项目对共享制品的引用。引用变动不会安装、删除或修改本机共享包。
 * 设计原因：版本锁定属于项目，不改变共享安装内容。
 */
import { z } from 'zod';

import { atomic } from '../../core/io/text-files';

import { hash } from '../../core/io/serialization';

import path from 'node:path';

import fs from 'node:fs/promises';

import type { ProjectReferences } from '../../framework/project';

/** 引用清单只能位于项目真实知识目录，缺失代表未锁定。 */
export async function projectReferencesFile(root: string)
{
  const folder = path.join(root, '.cbim'),
    file = path.join(folder, 'shared-resources.json');

  for (const [target, directory] of [[folder, true], [file, false]] as const)
  {
    const stat = await fs.lstat(target).catch(e => { if (e.code !== 'ENOENT') throw e; });

    if (stat && (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())))
      throw Error('项目资源引用路径无效');
  }

  return file;
}

export async function readProjectReferences(root: string)
{
  const file = await projectReferencesFile(root);

  try
  {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
  }
  catch (e)
  {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
      throw e;

    return undefined;
  }
}

const key = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);

const digest = z.string().regex(/^[a-f0-9]{64}$/);

const pins = z.record(key, digest);

export const referencesSchema = z.object({ engines: pins.optional(), connectors: pins.optional() }).strict();

const target = z.object({ kind: z.enum(['engines', 'connectors']), id: key, revision: z.string().min(1) });

export const referenceChange = z.discriminatedUnion('action', [target.extend({ action: z.literal('create'), digest }).strict(), target.extend({ action: z.literal('update'), digest }).strict(), target.extend({ action: z.literal('delete') }).strict()]);

export class ProjectReferenceStore
{
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private root: string)
  {
  }

  private async Snapshot()
  {
    const raw = await readProjectReferences(this.root);

    const items = referencesSchema.parse(raw === undefined ? {} : raw);

    return { items, revision: hash(JSON.stringify(items)) };
  }

  async Read()
  {
    await this.pending.catch(() => { });

    return this.Snapshot();
  }

  Change(change: z.infer<typeof referenceChange>, publish: (items: ProjectReferences) => void)
  {
    const next = this.pending.catch(() => { }).then(async () => { const { items, revision } = await this.Snapshot(); if (change.revision !== revision) throw Error('共享资源引用已变更，请重新读取'); const group = items[change.kind] ??= {}; if (Object.hasOwn(group, change.id) !== (change.action !== 'create')) throw Error('引用已存在或目标不存在'); if (change.action === 'delete') delete group[change.id]; else group[change.id] = change.digest; await atomic(await projectReferencesFile(this.root), JSON.stringify(items, null, 2)); publish(items); return { items, revision: hash(JSON.stringify(items)) }; });

    this.pending = next;

    return next;
  }
}
