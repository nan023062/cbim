/**
 * 作用定位：当前项目的工作配置和一次性定时任务；与应用凭据、机器设置隔离。
 * 设计原因：定时投递和工作约定按项目隔离。
 */
import fs from 'node:fs/promises';

import path from 'node:path';

import { z } from 'zod';

import { atomic } from '../../core/io/text-files';

import type { Catalog } from './index';

const fields = z.object({ name: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(4000) }).strict();

const timer = fields.extend({ at: z.string().datetime({ offset: true }) }).strict();

const revision = z.number().int().nonnegative();

const base = z.object({ revision });

function changes<T extends z.ZodTypeAny>(data: T)
{
  return z.discriminatedUnion('action', [
    base.extend({ action: z.literal('create'), data }).strict(),
    base.extend({ action: z.literal('update'), id: z.string().uuid(), data }).strict(),
    base.extend({ action: z.literal('delete'), id: z.string().uuid() }).strict(),
  ]);
}

export const settingsChange = changes(fields);

export const timerChange = changes(timer);

const model = z.object({ engine: z.string(), profileId: z.string(), modelId: z.string() }).strict();

const savedTimer = timer.extend({ id: z.string().uuid(), session: z.string().uuid(), selection: model, status: z.enum(['pending', 'queued', 'failed']), error: z.string().optional() });

const stateSchema = z.object({ revision, settings: z.array(fields.extend({ id: z.string().uuid() })).max(128), timers: z.array(savedTimer).max(128) }).strict();

type State = z.infer<typeof stateSchema>;

export class ProjectWork
{
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private projects: Pick<Catalog, 'Read' | 'Cache'>)
  {
  }

  private File(id: string)
  {
    return this.projects.Cache(id).work;
  }

  private async Load(id: string): Promise<State>
  {
    try
    {
      return stateSchema.parse(JSON.parse(await fs.readFile(this.File(id), 'utf8')));
    }
    catch (e)
    {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        return { revision: 0, settings: [], timers: [] };

      throw e;
    }
  }

  private Serial<T>(f: () => Promise<T>)
  {
    const next = this.pending.catch(() => { }).then(f);

    this.pending = next;

    return next;
  }

  async Read(id: string)
  {
    await this.pending.catch(() => { });

    return this.Load(id);
  }

  Change(id: string, resource: 'settings' | 'timers', raw: unknown, session: string, selection: z.infer<typeof model>)
  {
    return this.Serial(async () => { const state = await this.Load(id); const change = (resource === 'settings' ? settingsChange : timerChange).parse(raw); if (state.revision !== change.revision) throw Error('项目资料已变更，请重新读取'); const rows = state[resource]; const key = change.action === 'create' ? crypto.randomUUID() : change.id; const index = rows.findIndex(v => v.id === key); if (change.action !== 'create' && index < 0) throw Error('目标不存在'); if (change.action === 'delete') rows.splice(index, 1); else if (resource === 'settings') { const value = { ...fields.parse(change.data), id: key }; if (state.settings.some(v => v.id !== key && v.name === value.name)) throw Error('配置名称重复'); state.settings.splice(index < 0 ? rows.length : index, index < 0 ? 0 : 1, value); } else { const data = timer.parse(change.data); if (Date.parse(data.at) <= Date.now()) throw Error('定时任务须指定未来时间'); if (index >= 0 && state.timers[index].status !== 'pending') throw Error('已触发的定时任务不能重新编辑，请新建'); state.timers.splice(index < 0 ? rows.length : index, index < 0 ? 0 : 1, { ...data, id: key, session, selection, status: 'pending' }); } state.revision++; await atomic(this.File(id), JSON.stringify(stateSchema.parse(state))); return { revision: state.revision, items: state[resource] }; });
  }

  async Tick(enqueue: (project: string, item: z.infer<typeof savedTimer>) => Promise<unknown>)
  {
    for (const project of (await this.projects.Read()).entries)
    {
      await this.Serial(async () => { const state = await this.Load(project.id); for (const item of state.timers) { if (item.status !== 'pending' || Date.parse(item.at) > Date.now()) continue; try { await enqueue(project.id, item); item.status = 'queued'; } catch (e) { item.status = 'failed'; item.error = String(e).slice(0, 500); } state.revision++; await atomic(this.File(project.id), JSON.stringify(state)); } }).catch(e => console.warn('定时任务读取失败', e));
    }
  }
}
