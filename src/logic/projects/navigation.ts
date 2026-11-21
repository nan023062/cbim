/**
 * 作用定位：导航服务拥有显示名称、置顶、排序与可恢复移除；不改变项目身份和会话执行目录。
 * 设计原因：从登记和历史数据生成导航快照，无需为了侧栏读取启动项目运行时。
 */
import fs from 'node:fs/promises';

import path from 'node:path';

import { z } from 'zod';

import { atomic } from '../../core/io/text-files';

import { OfficeHistory } from '../../resource/office-history';

import type { ProjectList } from './project';

import type { OfficeQueue } from './office-queue';

import { navigationChangeSchema, type NavigationChange, type NavigationSnapshot } from './navigation-contract';

const displaySchema = z.object({ name: z.string().max(80).optional(), pinned: z.boolean().optional(), archived: z.boolean().optional(), removed: z.boolean().optional() }).strict();

const stateSchema = z.object({ revision: z.number().int().nonnegative(), projects: z.record(displaySchema), sessions: z.record(displaySchema), order: z.array(z.string()) }).strict();

type State = z.infer<typeof stateSchema>;

export class ProjectNavigation
{
  /** 单宿主串行写入避免多处菜单覆盖状态。 */
  private _pending: Promise<unknown> = Promise.resolve();

  public constructor(private readonly _projects: ProjectList, private readonly _queue: OfficeQueue)
  {
  }

  private async State(): Promise<State>
  {
    try
    {
      return stateSchema.parse(JSON.parse(await fs.readFile(path.join(this._projects.paths.userRoot, 'navigation.json'), 'utf8')));
    }
    catch (error)
    {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error;

      return { revision: 0, projects: {}, sessions: {}, order: [] };
    }
  }

  /** 只读历史索引，不为侧栏创建空会话或加载项目运行时。 */
  public async Read(): Promise<NavigationSnapshot>
  {
    await this._pending.catch(() => { });

    const state = await this.State();

    const entries = (await this._projects.Read()).entries;

    const projects = await Promise.all(entries.map(async entry => { const meta = state.projects[entry.id] ?? {}; const project = { ...entry, name: meta.name || entry.name, pinned: !!meta.pinned, removed: !!meta.removed, sessions: [] as NavigationSnapshot['projects'][number]['sessions'], error: undefined as string | undefined }; try { const history = new OfficeHistory(path.join(this._projects.paths.Project(entry.id), 'office-conversations')); for (const id of await history.List()) { const files = await history.Files(id); const messages = await history.Messages(id, [...new Set([files[0], files.at(-1)].filter((file): file is string => !!file))]); const display = state.sessions[id] ?? {}; const status = await this._queue.Status(entry.id, id); project.sessions.push({ id, renamed: !!display.name, title: display.name || messages[0]?.text.slice(0, 32) || '新对话', completedAt: messages.filter(message => message.role === 'assistant').at(-1)?.created, updated: messages.at(-1)?.created ?? (await fs.stat(path.join(this._projects.paths.Project(entry.id), 'office-conversations', id))).birthtimeMs, pinned: !!display.pinned, archived: !!display.archived, removed: !!display.removed, ...status }); } project.sessions.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated || a.id.localeCompare(b.id)); } catch (error) { project.error = String(error); } return project; }));

    const rank = (id: string) => state.order.includes(id) ? state.order.indexOf(id) : state.order.length + entries.findIndex(entry => entry.id === id);

    projects.sort((a, b) => Number(b.pinned) - Number(a.pinned) || rank(a.id) - rank(b.id));

    return { revision: state.revision, projects };
  }

  /** 版本冲突不覆盖；移除对话先停止当前任务并暂停队列，历史可恢复。 */
  public async Change(raw: NavigationChange): Promise<NavigationSnapshot>
  {
    const change = navigationChangeSchema.parse(raw);

    const operation = this._pending.catch(() => { }).then(async () => { const state = await this.State(); if (change.revision !== state.revision) throw Error('项目列表已变化，请刷新后重试'); const entries = (await this._projects.Read()).entries; if (!entries.some(entry => entry.id === change.project)) throw Error('项目未登记'); if (change.session) { const history = new OfficeHistory(path.join(this._projects.paths.Project(change.project), 'office-conversations')); if (!(await history.List()).includes(change.session)) throw Error('会话不属于该项目'); } const metadata = change.session ? state.sessions : state.projects; const id = change.session ?? change.project; const item = metadata[id] ??= {}; if (change.action === 'rename') { if (!change.name) throw Error('请输入名称'); item.name = change.name; } else if (change.action === 'pin') { if (change.value === undefined) throw Error('缺少置顶状态'); item.pinned = change.value; } else if (change.action === 'archive') { const ids = change.session ? [change.session] : await new OfficeHistory(path.join(this._projects.paths.Project(change.project), 'office-conversations')).List(); for (const id of ids) { const entry = state.sessions[id] ??= {}; entry.archived = change.value ?? true; } } else if (change.action === 'restore') { item.removed = false; item.archived = false; } else if (change.action === 'remove') { if (change.session) await this._queue.Change(change.project, change.session, { action: 'stop' }); item.removed = true; } else if (change.action === 'move') { if (change.session) throw Error('对话按置顶和最近活动排序'); if (change.before === change.project) return; if (change.before && !entries.some(entry => entry.id === change.before)) throw Error('排序目标不存在'); const ids = [...state.order, ...entries.map(entry => entry.id)].filter((id, index, all) => all.indexOf(id) === index && id !== change.project && entries.some(entry => entry.id === id)); const at = change.before ? ids.indexOf(change.before) : ids.length; ids.splice(at, 0, change.project); state.order = ids; } state.revision++; await atomic(path.join(this._projects.paths.userRoot, 'navigation.json'), JSON.stringify(stateSchema.parse(state), null, 2)); });

    this._pending = operation;

    await operation;

    return this.Read();
  }
}
