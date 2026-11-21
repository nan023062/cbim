/**
 * 作用定位：仅为已登记项目打开 Office，将持久会话身份映射到当前运行时实例。
 * 设计原因：持久历史与内存 Office 分别拥有状态，主 Agent 和成员通过同一运行装配入口获得能力。
 */
import path from 'node:path';

import { OfficeHistory, type OfficeActivity } from '../../resource/office-history';

import type { ProjectList } from './project';

import type { AgentPermission } from '../../framework/cability/organization';

import type { OfficeOperations } from './office-operations';

import { OfficeDispatch } from './office-dispatch';

import { agentRoleInstructions, type AgentRole } from '../../framework/cability/agent';

import { AgentSettings } from './agent-settings';

import { BusinessDirectory } from './business-directory';

import { OfficeInputs } from './office-inputs';

import { SkillCommands, type AgentConfiguration } from './agent-configuration';

export interface TurnMetrics
{
  elapsed: number;

  model: string;

  capacity: number;

  used?: number;

  output?: number;

  cost?: number;
}

export type ChatProgress =
  {
    activity?: OfficeActivity;

    workLog?: OfficeActivity[];

    phase: 'connecting' | 'thinking' | 'writing';

    model: string;

    rate?: number;

    estimated?: boolean

    text?: string
  };

export type MainAgentSelection = NonNullable<AgentConfiguration['model']>;

type ReportStage = import('./office-queue-contract').ReportStage;

export type OfficeChat = (instructions: string, messages: readonly { role: 'user' | 'assistant'; content: string }[], signal: AbortSignal, progress: (sample: ChatProgress) => void, turn: { ReportStage?: ReportStage; inputs?: OfficeInputs; ReadPermission(): AgentPermission; ReportTokens(total: number): void; operations: OfficeOperations; selection: MainAgentSelection; configuration?: AgentConfiguration; agentInstanceId?: string; officeId?: string; root: string; session: string; project: string; dataRoot: string }) => Promise<{ text: string; metrics: TurnMetrics }>;

export class ProjectOffices
{
  public readonly settings: AgentSettings;

  public readonly business: BusinessDirectory;

  private readonly _inputs = new Map<string, OfficeInputs>();

  /** 当前主运行采纳的可用技能；直接插入按本轮快照解析，不读取漂移配置。 */
  private readonly _inputSkills = new Map<string, AgentConfiguration['skills']>();

  private readonly _idle = new Set<(project: string, session: string) => void>();

  public SubscribeIdle(listener: (project: string, session: string) => void): () => void
  {
    this._idle.add(listener);

    return () => { this._idle.delete(listener); };
  }

  public IsRunning(project: string, session: string): boolean
  {
    return this.controllers.has(JSON.stringify([project, session]));
  }

  /** 将同一项目的结构变化广播给所有正在执行的主 Agent。 */
  private Notify(project: string, text: string): void
  {
    for (const [key, inputs] of this._inputs)
      if (JSON.parse(key)[0] === project && !this.controllers.get(key)?.signal.aborted)
      {
        try
        {
          inputs.Push(text);
        }
        catch
        {
          /* 已结束轮次下一轮读取最新完整架构。 */
        }
      }
  }

  /** 用户追加任务与架构事件使用相同队列，不改变本轮模型或权限。 */
  public Insert(project: string, session: string, text: string, skills?: AgentConfiguration['skills'])
  {
    if (!text.trim() || text.length > 32000)
      throw Error('追加消息长度须为 1 至 32000');

    const key = JSON.stringify([project, session]);

    if (this.controllers.get(key)?.signal.aborted)
      throw Error('当前任务正在停止，补充内容请在停止后发送');

    const inputs = this._inputs.get(key);

    if (!inputs)
      throw Error('当前没有运行中的主任务，请发送新消息');

    return { id: inputs.Push(SkillCommands.Expand(text.trim(), skills ?? this._inputSkills.get(key))), status: 'queued' as const };
  }

  private readonly activeEngines = new Map<string, string>();

  public ActiveEngine(session: string)
  {
    return this.activeEngines.get(session);
  }

  private readonly controllers = new Map<string, AbortController>();

  public Stop(project: string, session: string)
  {
    this.controllers.get(JSON.stringify([project, session]))?.abort();
  }

  private readonly busy = new Set<string>();

  public constructor(private readonly projects: ProjectList, private readonly chat?: OfficeChat, defaultModel?: () => Promise<MainAgentSelection | undefined>)
  {
    this.settings = new AgentSettings(projects, (project, text) => this.Notify(project, text), defaultModel);

    this.business = new BusinessDirectory(projects, (project, text) => this.Notify(project, text));
  }

  private async History(projectId: string)
  {
    const project = await this.projects.Open(projectId);

    return { project, history: new OfficeHistory(path.join(this.projects.paths.Project(projectId), 'office-conversations')) };
  }

  public async Open(projectId: string, action: 'latest' | 'create' | 'select', selected?: string)
  {
    const { project, history } = await this.History(projectId);

    const ids = await history.List();

    const sessions = await Promise.all(ids.map(async id => { const files = await history.Files(id); const messages = await history.Messages(id, files.length > 1 ? [files[0], files[files.length - 1]] : files); return { id, title: messages[0]?.text.slice(0, 32) || '新对话', updated: messages.at(-1)?.created ?? 0 }; }));

    sessions.sort((a, b) => b.updated - a.updated);

    let id = action === 'select' ? selected : sessions[0]?.id;

    if (action === 'select' && (!id || !ids.includes(id)))
      throw Error('会话不属于该项目');

    if (!id || action === 'create')
    {
      id = crypto.randomUUID();

      await history.Create(id);

      sessions.unshift({ id, title: '新对话', updated: Date.now() });
    }

    const office = project.runtime.OpenOffice(projectId, id);

    const files = await history.Files(id);

    const earlier = files.slice(0, -16);

    return { id, officeId: office.id, sessions, earlier, earlierUsage: await history.EarlierUsage(id, earlier), messages: await history.Messages(id, files.slice(-16)) };
  }

  public async ReadTurn(projectId: string, id: string, file: string)
  {
    const { history } = await this.History(projectId);

    return history.Messages(id, [file]);
  }

  public async Send(projectId: string, id: string, input: string, progress: (sample: ChatProgress) => void = () => { }, permission: 'read' | 'ask' | 'execute' = 'ask', selection: MainAgentSelection, frozen?: AgentConfiguration, stopSignal?: AbortSignal, ReportStage?: ReportStage)
  {
    if (!selection?.profileId?.trim() || !selection.modelId?.trim())
      throw Error('请选择大模型');

    if (!selection?.engine?.trim())
      throw Error('请选择已安装并启用的执行引擎');

    if (typeof input !== 'string' || !input.trim() || input.length > 32000)
      throw Error('消息长度须为 1 至 32000 个字符');

    const { project, history } = await this.History(projectId);

    if (!(await history.List()).includes(id))
      throw Error('会话不属于该项目');

    const chat = this.chat;

    if (!chat)
      throw Error('当前宿主未提供执行引擎插件');

    const office = project.runtime.OpenOffice(projectId, id);

    stopSignal?.throwIfAborted();

    if (this.busy.has(office.id))
      throw Error('A reply is already in progress');

    office.permission = permission;

    this.busy.add(office.id);

    this.activeEngines.set(id, selection.engine);

    const key = JSON.stringify([projectId, id]);

    const controller = new AbortController();

    const externalStop = () => controller.abort();

    stopSignal?.addEventListener('abort', externalStop, { once: true });

    this.controllers.set(key, controller);

    const workLog = new Map<string, OfficeActivity>();

    const inputs = new OfficeInputs((id, text, state) => { workLog.set(id, { id, label: state, input: text, ...(state.startsWith('注入结果未确认') && { alert: state }) }); progress({ phase: 'thinking', model: selection.modelId, workLog: Array.from(workLog.values()) }); });

    this._inputs.set(key, inputs);

    let detach: (() => void) | undefined;

    try
    {
      await this.settings.Apply(projectId);

      await this.business.Apply(projectId);

      const saved = frozen ? { configuration: structuredClone(frozen) } : await this.settings.Read(projectId, { kind: 'main', id });

      const configuration = { ...saved.configuration, model: selection };

      this._inputSkills.set(key, configuration.skills);

      const context = (await history.Messages(id)).map(m => ({ role: m.role, content: m.text }));

      const workspaceTree = office.project.DescribeWorkspaces();

      const turnKey = crypto.randomUUID();

      const append = (label: string) => { const id = turnKey + ':' + workLog.size; workLog.set(id, { id, label }); };

      append('已读取工作区结构');

      const phases = { connecting: '连接模型', thinking: '启动主 Agent 执行', writing: '生成答复' };

      let lastPhase: ChatProgress['phase'] = 'connecting';

      const publish = (sample: ChatProgress) => progress({ ...sample, workLog: Array.from(workLog.values()) });

      publish({ phase: lastPhase, model: selection.modelId });

      const record = (item: OfficeActivity) => workLog.set(item.id, { ...workLog.get(item.id), ...item });

      const reportProgress = (sample: ChatProgress) => { if (sample.activity) { record(sample.activity); publish({ ...sample, phase: lastPhase }); } else if (lastPhase !== sample.phase || workLog.size === 1) { lastPhase = sample.phase; append(phases[lastPhase]); publish(sample); } else progress(sample); };

      detach = office.Subscribe(event => { if (event.type !== 'task') return; const task = event.task; const states = { waiting: '等待依赖', blocked: '受阻', queued: '已排队', running: '执行中', completed: '已完成', suspended: '已挂起', cancelled: '已取消' }; record({ id: 'task:' + task.id + ':' + task.attempt + ':' + task.state, label: task.agentId + ' · ' + states[task.state], input: task.goal, result: task.workspaceInstanceId, alert: task.state === 'blocked' || task.state === 'suspended' ? task.error || task.goal : undefined }); publish({ phase: lastPhase, model: selection.modelId }); });

      const projectSkills = configuration.skills?.map(skill => ({ name: skill.name, description: /^description:\s*(.+)$/m.exec(skill.content)?.[1]?.slice(0, 400), source: '.agents/skills/' + skill.id + '/SKILL.md' }));
      const goal = JSON.stringify({ ...(projectSkills?.length && { availableProjectSkills: projectSkills, skillUsage: '按用户意图与技能用途匹配；命中时可在当前权限内读取对应项目技能文件。用户链接了清单中的技能时优先使用，未命中无需调用。' }), project: project.entry.name, workspaceTree, organization: office.organization.children, userRequest: SkillCommands.Expand(input.trim(), configuration.skills) });

      context.push({ role: 'user', content: goal });

      let dispatch!: OfficeDispatch;

      const tokenReports = new Map<string,
        {
          sequence: number;

          total: number
        }>();

      const runAgent = (role: AgentRole, messages: Parameters<OfficeChat>[1], root: string, session: string, agentInstanceId: string, signal: AbortSignal, ReadPermission: () => AgentPermission, report: (seq: number, kind: 'message' | 'summary', count: number) => void, operations: OfficeOperations, publish: (sample: ChatProgress) => void) => chat(agentRoleInstructions(role.definition), messages, signal, publish, { ReportStage: session === id ? ReportStage : undefined, inputs: session === id ? inputs : undefined, ReadPermission, ReportTokens: total => { const previous = tokenReports.get(agentInstanceId) ?? { sequence: 0, total: 0 }; const next = { sequence: previous.sequence + 1, total: previous.total + total }; tokenReports.set(agentInstanceId, next); report(next.sequence, 'summary', next.total); }, operations, configuration: role.definition, agentInstanceId, officeId: office.id, selection: role.definition.model!, root, session, project: projectId, dataRoot: this.projects.paths.Project(projectId) });

      const reply = await office.OpenMainAgent({ parameters: controller.signal, CreateEngine: async (signal, agentId, role, report, ReadPermission) => ({ session: () => runAgent(role, context, project.entry.path, id, agentId, signal, ReadPermission, report, dispatch.Operations(), reportProgress), Close: async () => { controller.abort(); }, }) }, (_engine, commands) => { dispatch = new OfficeDispatch(office, project.entry.path, commands, (role, goal, root, taskId, signal, ReadPermission, report, operations, agentId) => runAgent(role, [{ role: 'user', content: SkillCommands.Expand(goal, role.definition.skills) }], root, taskId, agentId, signal, ReadPermission, report, operations, sample => { if (sample.activity) reportProgress(sample); }), controller.signal); return () => { }; }, configuration);

      try
      {
        let result = await reply();

        let lastReply = result.text;

        for (; ;)
        {
          const pending = inputs.Finish();

          if (!pending.length)
            break;

          context.push({ role: 'assistant', content: lastReply }, { role: 'user', content: JSON.stringify({ officeInputs: pending, workspaceTree: office.project.DescribeWorkspaces(), organization: office.organization.children, instruction: '将追加输入应用到当前任务，继续处理，不重做已经完成的操作。' }) });

          const next = await reply();

          lastReply = next.text;

          result = { text: result.text + '\n\n' + next.text, metrics: { ...next.metrics, elapsed: result.metrics.elapsed + next.metrics.elapsed, output: result.metrics.output != null && next.metrics.output != null ? result.metrics.output + next.metrics.output : undefined, cost: result.metrics.cost != null && next.metrics.cost != null ? result.metrics.cost + next.metrics.cost : undefined } };
        }

        await ReportStage?.('保存回复');
        return await history.AppendTurn(id, input.trim(), result.text, result.metrics, Array.from(workLog.values()));
      }
      finally
      {
        controller.abort();

        await dispatch.Drain();

        await office.CloseMainEngine();
      }
    }
    finally
    {
      detach?.();

      this.busy.delete(office.id);

      this.activeEngines.delete(id);

      this.controllers.delete(key);

      this._inputs.delete(key);

      this._inputSkills.delete(key);

      stopSignal?.removeEventListener('abort', externalStop);

      for (const listener of this._idle)
        listener(projectId, id);
    }
  }
}
