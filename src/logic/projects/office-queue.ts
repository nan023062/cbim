/**
 * 作用定位：宿主拥有的 Office FIFO 队列：持久接收、串行消费、重排与插入互斥；视图卸载不停止任务。
 * 设计原因：由宿主持有持久队列和会话串行门禁，页面退出不丢任务，恢复时区分待执行与结果未知。
 */
import fs from 'node:fs/promises';

import path from 'node:path';

import { z } from 'zod';

import { agentConfigurationSchema, SkillCommands } from './agent-configuration';

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
    return this._projects.Cache(project).Queue(session);
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

      if (state.items.some(item => ['running', 'inserting', 'inserted'].includes(item.status)))
      {
        state.paused = true;

        for (const attempt of state.attempts ?? [])
          if (attempt.outcome === 'running')
            attempt.outcome = 'interrupted';

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

    if (!state.paused && state.items.some(item => item.status === 'queued'))
      this.Schedule(project, session);

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

    await this.Locked(project, session, async state => { if ('revision' in action && action.revision !== state.revision) throw Error('队列已变化，请刷新后重试'); const next = structuredClone(state); if (action.action === 'enqueue') { if (next.accepted.includes(action.id)) return; if (next.items.length >= 100) throw Error('队列最多保留 100 条指令'); const catalog = await this._offices.settings.Read(project, { kind: 'main', id: session }); const configuration = agentConfigurationSchema.parse({ model: action.selection, skills: catalog.configuration.skills, connectorIds: action.connectorIds }); SkillCommands.Resolve(action.text, configuration.skills); next.items.push({ id: action.id, text: action.text, created: Date.now(), permission: action.permission, configuration, status: 'queued' }); next.accepted = [...next.accepted, action.id].slice(-1000); } else if (action.action === 'pause' || action.action === 'stop') next.paused = true; else if (action.action === 'resume') next.paused = false; else { const item = next.items.find(item => item.id === action.id); if (!item) throw Error('排队指令已被消费或移除'); if (['running', 'inserting', 'inserted'].includes(item.status)) throw Error('指令已开始消费，不能再修改'); if (action.action === 'remove') next.items = next.items.filter(entry => entry.id !== item.id); else if (action.action === 'retry') { item.status = 'queued'; delete item.error; delete item.cancelSource; delete item.started; delete item.inputId; next.paused = false; } else if (item.status !== 'queued') throw Error('请先核实失败指令，再明确重试或移除'); else if (action.action === 'start') { if (this._offices.IsRunning(project, session) || next.items.some(entry => entry.status === 'running')) throw Error('已有任务开始执行，请刷新队列'); next.items = [item, ...next.items.filter(entry => entry.id !== item.id)]; next.paused = false; } else if (action.action === 'edit') { SkillCommands.Resolve(action.text, item.configuration.skills); item.text = action.text; } else if (action.action === 'move') { if (action.beforeId === item.id) return; const target = action.beforeId ? next.items.find(entry => entry.id === action.beforeId) : undefined; if (action.beforeId && (!target || target.status !== 'queued')) throw Error('排序目标不再处于排队状态'); next.items = next.items.filter(entry => entry.id !== item.id); next.items.splice(target ? next.items.findIndex(entry => entry.id === target.id) : next.items.length, 0, item); } else if (action.action === 'insert') { if (!this._offices.IsRunning(project, session)) throw Error('当前没有执行中的任务'); item.status = 'inserting'; await this.Save(project, session, next); try { const receipt = this._offices.Insert(project, session, item.text, item.configuration.skills); item.inputId = receipt.id; item.status = 'inserted'; } catch (error) { item.status = 'queued'; await this.Save(project, session, next); Object.assign(state, next); throw error; } } } await this.Save(project, session, next); Object.assign(state, next); if (action.action === 'stop') { this._controllers.get(this.Key(project, session))?.abort('user-stop'); this._offices.Stop(project, session); } });

    this.Schedule(project, session);

    return this.Read(project, session);
  }

  private Schedule(project: string, session: string): void
  {
    const key = this.Key(project, session);

    if (this._closed || this._pumps.has(key))
      return;

    const work = this.Pump(project, session).catch(error => { const state = this._states.get(key); if (state) { state.paused = true; const item = state.items.find(item => ['queued', 'running', 'inserting', 'inserted'].includes(item.status)); if (item) { item.status = 'uncertain'; item.error = '队列存储或执行结果未确认：' + String(error); } } }).finally(() => { this._pumps.delete(key); const state = this._states.get(key); if (state && !state.paused && state.items.some(entry => entry.status === 'queued') && !this._offices.IsRunning(project, session)) this.Schedule(project, session); });

    this._pumps.set(key, work);
  }

  private async Pump(project: string, session: string): Promise<void>
  {
    const key = this.Key(project, session);

    while (!this._closed)
    {
      const item = await this.Locked(project, session, async state => { if (state.paused || this._offices.IsRunning(project, session)) return undefined; const head = state.items.find(item => item.status === 'queued'); if (!head || head.status !== 'queued') return undefined; const next = structuredClone(state); const claimed = next.items.find(item => item.id === head.id)!; claimed.status = 'running'; claimed.started = Date.now(); next.attempts = [...(next.attempts ?? []).slice(-99), { id: crypto.randomUUID(), itemId: claimed.id, started: claimed.started, outcome: 'running', events: [{ stage: '准备会话', at: claimed.started }] }]; await this.Save(project, session, next); Object.assign(state, next); this._controllers.set(key, new AbortController()); return structuredClone(claimed); });

      if (!item)
        return;

      const signal = this._controllers.get(key)!.signal;

      const attemptId = this._states.get(key)!.attempts!.at(-1)!.id;

      const reportStage: import('./office-queue-contract').ReportStage = stage => this.Locked(project, session, async state => { const record = state.attempts?.find(attempt => attempt.id === attemptId); if (!record || record.outcome !== 'running' || record.events.at(-1)?.stage === stage) return; if (record.events.length === 48) record.events.splice(16, 1); record.events.push({ stage, at: Date.now() }); await this.Save(project, session, state); });

      let errorClass: string | undefined;

      let timeoutMs: number | undefined;

      let cancelSource: typeof item.cancelSource;

      let failure: string | undefined;

      let uncertain = new Set<string>();

      try
      {
        if (!item.configuration.model)
          throw Error('该指令未保存完整的引擎与模型');

        const messages = await this._offices.Send(project, session, item.text, sample => this.Progress(project, session, sample), item.permission, item.configuration.model, item.configuration, signal, reportStage);

        uncertain = new Set(messages.flatMap(message => message.workLog?.filter(entry => entry.alert).map(entry => entry.id) ?? []));
      }
      catch (error)
      {
        failure = String(error);

        const cause = error instanceof Error ? error.cause : undefined;

        const known = (value: unknown) => value instanceof Error && ['TimeoutError', 'AbortError', 'TypeError', 'RangeError', 'Error'].includes(value.name) ? value.name : 'UnknownError';

        errorClass = cause ? known(error) + ': ' + known(cause) : known(error);

        if (error instanceof Error && 'timeoutMs' in error && typeof error.timeoutMs === 'number')
          timeoutMs = error.timeoutMs;

        if (signal.aborted)
          cancelSource = signal.reason === 'user-stop' || signal.reason === 'app-shutdown' ? signal.reason : 'unknown';
        else if (/^AbortError(?:$|:)/.test(failure))
          cancelSource = 'unknown';
      }
      finally
      {
        this._controllers.delete(key);
      }

      await this.Locked(project, session, async state => { const next = structuredClone(state); const attempt = next.attempts!.find(record => record.id === attemptId)!; attempt.outcome = failure ? 'failed' : 'completed'; attempt.ended = Date.now(); attempt.errorClass = errorClass; attempt.timeoutMs = timeoutMs; next.items = next.items.filter(entry => { if (entry.id === item.id) { if (!failure) return false; entry.status = 'failed'; entry.error = failure; entry.cancelSource = cancelSource; return true; } if (entry.status === 'inserted' || entry.status === 'inserting') { if (!failure && entry.inputId && !uncertain.has(entry.inputId)) return false; entry.status = 'uncertain'; entry.error = '插入或本轮执行未确认，请核实当前任务后再决定'; } return true; }); await this.Save(project, session, next); Object.assign(state, next); });
    }
  }

  /** 关闭先暂停，取消并等待已受理运行退出；剩余队列保留到下次显式继续。 */
  public async Close(): Promise<void>
  {
    this._closed = true;

    this._unsubscribe();

    for (const controller of this._controllers.values())
      controller.abort('app-shutdown');

    await Promise.allSettled([...this._pumps.values()]);

    await Promise.allSettled([...this._locks.values()]);
  }
}
