/** 宿主拥有的 Office FIFO 队列：持久接收、串行消费、重排与插入互斥；视图卸载不停止任务。 */
import fs from 'node:fs/promises';

import path from 'node:path';

import { z } from 'zod';

import { atomic } from '../../core/io/text-files';

import type { ProjectList } from './project';

import type { ProjectOffices, ChatProgress } from './offices';

import { officeQueueStateSchema, officeQueueActionSchema, type OfficeQueueState, type OfficeQueueSnapshot, type OfficeQueueAction } from './office-queue-contract';

export class OfficeQueue
{
  private readonly _states = new Map<string, OfficeQueueState>();

  private readonly _locks = new Map<string, Promise<unknown>>();

  private readonly _pumps = new Map<string, Promise<void>>();

  private readonly _controllers = new Map<string, AbortController>();

  private _closed = false;

  private readonly _unsubscribe: () => void;

  /** 宿主可绑定进度广播；消费者不依赖页面是否仍然打开。 */
  public Progress: (project: string, session: string, sample: ChatProgress) => void = () => { };

  public constructor(private readonly _projects: ProjectList, private readonly _offices: ProjectOffices)
  {
    this._unsubscribe = _offices.SubscribeIdle((project, session) => this.Schedule(project, session));
  }

  private Key(project: string, session: string): string
  {
    z.string().uuid().parse(session);

    return JSON.stringify([project, session]);
  }

  private File(project: string, session: string): string
  {
    return path.join(this._projects.paths.Project(project), 'office-queues', session + '.json');
  }

  private async Load(project: string, session: string): Promise<OfficeQueueState>
  {
    const key = this.Key(project, session);

    const known = this._states.get(key);

    if (known)
      return known;

    await this._offices.Open(project, 'select', session);

    let state: OfficeQueueState;

    try
    {
      state = officeQueueStateSchema.parse(JSON.parse(await fs.readFile(this.File(project, session), 'utf8')));

      if (state.items.length)
      {
        state.paused = true;

        for (const item of state.items)
          if (['running', 'inserting', 'inserted'].includes(item.status))
          {
            item.status = 'uncertain';

            item.error = '上次运行或插入结果未确认，请核实后移除或重新执行';
          }

        await this.Save(project, session, state);
      }
    }
    catch (error)
    {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error;

      state = { revision: 0, paused: false, items: [], accepted: [] };
    }

    this._states.set(key, state);

    return state;
  }

  /** 在同一会话中串行处理排序、消费和设置快照，失败不会阻塞后续只读恢复。 */
  private Locked<T>(project: string, session: string, Run: (state: OfficeQueueState) => Promise<T>): Promise<T>
  {
    const key = this.Key(project, session);

    const operation = (this._locks.get(key) ?? Promise.resolve()).catch(() => { }).then(async () => Run(await this.Load(project, session)));

    this._locks.set(key, operation);

    void operation.finally(() => { if (this._locks.get(key) === operation) this._locks.delete(key); }).catch(() => { });

    return operation;
  }

  private async Save(project: string, session: string, state: OfficeQueueState): Promise<void>
  {
    const next = officeQueueStateSchema.parse({ ...state, revision: state.revision + 1 });

    await atomic(this.File(project, session), JSON.stringify(next, null, 2));

    state.revision = next.revision;

    this._states.set(this.Key(project, session), state);
  }

  /** 侧栏只读运行摘要；未加载队列按重启后暂停展示，不触发执行。 */
  public async Status(project: string, session: string): Promise<{ running: boolean; queued: number; attention: boolean }>
  {
    let state = this._states.get(this.Key(project, session));

    if (!state)
    {
      try
      {
        state = officeQueueStateSchema.parse(JSON.parse(await fs.readFile(this.File(project, session), 'utf8')));
      }
      catch (error)
      {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw error;
      }
    }

    const running = this._offices.IsRunning(project, session);

    return { running, queued: state?.items.filter(item => item.status === 'queued').length ?? 0, attention: !!state?.items.some(item => ['failed', 'uncertain'].includes(item.status) || !running && item.status === 'running') };
  }

  public Read(project: string, session: string): Promise<OfficeQueueSnapshot>
  {
    return this.Locked(project, session, async state => ({ ...structuredClone(state), running: this._offices.IsRunning(project, session) || state.items.some(item => item.status === 'running') }));
  }

  /** 只有排队项允许重排和编辑；消费中的身份不能被 UI 替换。 */
  public async Change(project: string, session: string, raw: OfficeQueueAction): Promise<OfficeQueueSnapshot>
  {
    if (this._closed)
      throw Error('应用正在关闭，队列已暂停');

    const action = officeQueueActionSchema.parse(raw);

    await this.Locked(project, session, async state => { if ('revision' in action && action.revision !== state.revision) throw Error('队列已变化，请刷新后重试'); const next = structuredClone(state); if (action.action === 'enqueue') { if (next.accepted.includes(action.id)) return; if (next.items.length >= 100) throw Error('队列最多保留 100 条指令'); let saved = await this._offices.settings.Read(project, { kind: 'main', id: session }); if (JSON.stringify(saved.configuration.model) !== JSON.stringify(action.selection)) saved = await this._offices.settings.Save(project, { kind: 'main', id: session }, saved.revision, { ...saved.configuration, model: action.selection }); next.items.push({ id: action.id, text: action.text, created: Date.now(), permission: action.permission, configuration: { ...saved.configuration, model: action.selection }, status: 'queued' }); next.accepted = [...next.accepted, action.id].slice(-1000); } else if (action.action === 'pause' || action.action === 'stop') next.paused = true; else if (action.action === 'resume') next.paused = next.items.some(item => item.status === 'failed' || item.status === 'uncertain'); else { const item = next.items.find(item => item.id === action.id); if (!item) throw Error('排队指令已被消费或移除'); if (['running', 'inserting', 'inserted'].includes(item.status)) throw Error('指令已开始消费，不能再修改'); if (action.action === 'remove') next.items = next.items.filter(entry => entry.id !== item.id); else if (action.action === 'retry') { item.status = 'queued'; delete item.error; delete item.started; delete item.inputId; next.paused = false; } else if (item.status !== 'queued') throw Error('请先核实失败指令，再明确重试或移除'); else if (action.action === 'edit') item.text = action.text; else if (action.action === 'move') { if (action.beforeId === item.id) return; const target = action.beforeId ? next.items.find(entry => entry.id === action.beforeId) : undefined; if (action.beforeId && (!target || target.status !== 'queued')) throw Error('排序目标不再处于排队状态'); next.items = next.items.filter(entry => entry.id !== item.id); next.items.splice(target ? next.items.findIndex(entry => entry.id === target.id) : next.items.length, 0, item); } else if (action.action === 'insert') { if (!this._offices.IsRunning(project, session)) throw Error('当前没有执行中的任务'); item.status = 'inserting'; await this.Save(project, session, next); try { const receipt = this._offices.Insert(project, session, item.text); item.inputId = receipt.id; item.status = 'inserted'; } catch (error) { item.status = 'queued'; await this.Save(project, session, next); Object.assign(state, next); throw error; } } } await this.Save(project, session, next); Object.assign(state, next); if (action.action === 'stop') { this._controllers.get(this.Key(project, session))?.abort(); this._offices.Stop(project, session); } });

    this.Schedule(project, session);

    return this.Read(project, session);
  }

  private Schedule(project: string, session: string): void
  {
    const key = this.Key(project, session);

    if (this._closed || this._pumps.has(key))
      return;

    const work = this.Pump(project, session).catch(error => { const state = this._states.get(key); if (state) { state.paused = true; const item = state.items.find(item => ['queued', 'running', 'inserting', 'inserted'].includes(item.status)); if (item) { item.status = 'uncertain'; item.error = '队列存储或执行结果未确认：' + String(error); } } }).finally(() => { this._pumps.delete(key); const state = this._states.get(key); if (state && !state.paused && state.items[0]?.status === 'queued' && !this._offices.IsRunning(project, session)) this.Schedule(project, session); });

    this._pumps.set(key, work);
  }

  private async Pump(project: string, session: string): Promise<void>
  {
    const key = this.Key(project, session);

    while (!this._closed)
    {
      const item = await this.Locked(project, session, async state => { if (state.paused || this._offices.IsRunning(project, session)) return undefined; const head = state.items.find(item => item.status !== 'inserted'); if (!head || head.status !== 'queued') return undefined; const next = structuredClone(state); const claimed = next.items.find(item => item.id === head.id)!; claimed.status = 'running'; claimed.started = Date.now(); await this.Save(project, session, next); Object.assign(state, next); this._controllers.set(key, new AbortController()); return structuredClone(claimed); });

      if (!item)
        return;

      let failure: string | undefined;

      let uncertain = new Set<string>();

      try
      {
        if (!item.configuration.model)
          throw Error('该指令未保存完整的引擎与模型');

        const messages = await this._offices.Send(project, session, item.text, sample => this.Progress(project, session, sample), item.permission, item.configuration.model, item.configuration, this._controllers.get(key)!.signal);

        uncertain = new Set(messages.flatMap(message => message.workLog?.filter(entry => entry.alert).map(entry => entry.id) ?? []));
      }
      catch (error)
      {
        failure = String(error);
      }
      finally
      {
        this._controllers.delete(key);
      }

      await this.Locked(project, session, async state => { const next = structuredClone(state); next.items = next.items.filter(entry => { if (entry.id === item.id) { if (!failure) return false; entry.status = 'failed'; entry.error = failure; return true; } if (entry.status === 'inserted' || entry.status === 'inserting') { if (!failure && entry.inputId && !uncertain.has(entry.inputId)) return false; entry.status = 'uncertain'; entry.error = '插入或本轮执行未确认，请核实当前任务后再决定'; } return true; }); if (failure || next.items.some(entry => entry.status === 'uncertain')) next.paused = true; await this.Save(project, session, next); Object.assign(state, next); });
    }
  }

  /** 关闭先暂停，取消并等待已受理运行退出；剩余队列保留到下次显式继续。 */
  public async Close(): Promise<void>
  {
    this._closed = true;

    this._unsubscribe();

    for (const controller of this._controllers.values())
      controller.abort();

    await Promise.allSettled([...this._pumps.values()]);

    await Promise.allSettled([...this._locks.values()]);
  }
}
