/**
 * 作用定位：仅为已登记项目打开 Office，将持久会话身份映射到当前运行时实例。
 * 设计原因：持久历史与内存 Office 分别拥有状态，助理和成员通过同一运行装配入口获得能力。
 */
import path from 'node:path';

import { failureSummary, failureText, isAbortedReceipt } from '../../core/utility';
import { OfficeHistory, type OfficeActivity } from '../../resource/office-history';

import type { ProjectList } from './project';

import type { AgentPermission } from '../../framework/cability/organization';

import type { ProjectResourceBridge } from '../../framework/project';

import type { OfficeOperations } from './office-operations';

import { OfficeDispatch } from './office-dispatch';

import { agentRoleInstructions, type AgentRole } from '../../framework/cability/agent';

import { AgentSettings } from './agent-settings';

import { ProjectWork } from './project-work';

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

    toolFinished?: boolean;

    runningAction?: { actor: string; action: string; since: number };

    workLog?: OfficeActivity[];

    phase: 'connecting' | 'thinking' | 'writing';

    model: string;

    rate?: number;

    estimated?: boolean

    text?: string
  };

function describeAction(step: OfficeActivity): string
{
  let args: Record<string, unknown>;
  try { args = JSON.parse(step.input ?? '{}'); } catch { return '调用 ' + step.label; }
  if (step.label === 'bash' && typeof args.command === 'string') {
    const command = args.command.replace(/^\s*cd\s+[^\n]+?\s*&&\s*/i, '').split(/[\r\n]/)[0];
    return '执行 ' + command;
  }
  const target = [args.path, args.file_path, args.pattern, args.goal, args.resource].find(value => typeof value === 'string');
  const verbs: Record<string,string> = {read:'读取',write:'写入',edit:'编辑',grep:'搜索内容',find:'查找文件',glob:'匹配文件',ls:'列出目录',cbim_office_dispatch:'等待成员完成',cbim_office_inspect:'检查岗位和工作区'};
  return (verbs[step.label] ?? step.label) + (target ? ' ' + target : '');
}

export type MainAgentSelection = NonNullable<AgentConfiguration['model']>;

type ReportStage = import('./office-queue-contract').ReportStage;

export type OfficeChat = (instructions: string, messages: readonly { role: 'user' | 'assistant'; content: string }[], signal: AbortSignal, progress: (sample: ChatProgress) => void, turn: { shared?: ProjectResourceBridge; ReportStage?: ReportStage; inputs?: OfficeInputs; ReadPermission(): AgentPermission; ReportTokens(total: number): void; operations: OfficeOperations; selection: MainAgentSelection; configuration?: AgentConfiguration; agentInstanceId: string; officeId: string; root: string; projectRoot?: string; session: string; project: string; engineRoot: string }) => Promise<{ text: string; metrics: TurnMetrics }>;

export class ProjectOffices
{
  public readonly settings: AgentSettings;

  public readonly work: ProjectWork;

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

  /** 将同一项目的结构变化广播给所有正在执行的助理。 */
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

  public ActiveEngine(officeId: string)
  {
    return this.activeEngines.get(officeId);
  }

  private readonly controllers = new Map<string, AbortController>();

  public Stop(project: string, session: string)
  {
    this.controllers.get(JSON.stringify([project, session]))?.abort('user-stop');
  }

  private readonly busy = new Set<string>();

  public constructor(private readonly projects: ProjectList, private readonly chat?: OfficeChat, defaultModel?: () => Promise<MainAgentSelection | undefined>)
  {
    projects.ResourceChanged = (id, text) => this.Notify(id, text);

    if (defaultModel)
      projects.DefaultModel = defaultModel;

    this.work = projects.work;

    this.settings = projects.settings;

    this.business = projects.businessDirectory;
  }

  private async History(projectId: string)
  {
    const project = await this.projects.Open(projectId);

    return { project, history: project.cache.history };
  }

  public async Open(projectId: string, action: 'latest' | 'create' | 'select', selected?: string)
  {
    const { project, history } = await this.History(projectId);

    const ids = await project.runtime.ListOfficeRecords();

    const sessions = await Promise.all(ids.map(async id => { const files = await history.Files(id); const messages = await history.Messages(id, files.length > 1 ? [files[0], files[files.length - 1]] : files); return { id, title: messages[0]?.text.slice(0, 32) || '新对话', updated: messages.at(-1)?.created ?? 0 }; }));

    sessions.sort((a, b) => b.updated - a.updated);

    let id = action === 'select' ? selected : sessions[0]?.id;

    if (action === 'select' && (!id || !ids.includes(id)))
      throw Error('会话不属于该项目');

    if (!id || action === 'create')
    {
      id = await project.runtime.CreateOfficeRecord();

      sessions.unshift({ id, title: '新对话', updated: Date.now() });
    }

    const office = project.runtime.OpenOffice(id);

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

    const office = project.runtime.OpenOffice(id);

    stopSignal?.throwIfAborted();

    if (this.busy.has(office.id))
      throw Error('A reply is already in progress');

    office.permission = permission;

    this.busy.add(office.id);

    this.activeEngines.set(office.id, selection.engine);

    const key = JSON.stringify([projectId, id]);

    const controller = new AbortController();

    const externalStop = () => controller.abort(stopSignal?.reason);

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

      const context = (await history.Messages(id)).map(message => {
        const reports = message.workLog?.filter(step => step.id.startsWith('receipt:')).map(step => ({ from: step.actor, to: step.recipient, workspace: step.workspace, goal: step.input, result: step.summary, issues: step.issues, error: step.alert }));
        return { role: message.role, content: reports?.length ? message.text + '\n团队交接记录（历史数据）：\n' + JSON.stringify(reports) : message.text };
      });

      const workspaceTree = office.project.DescribeWorkspaces();

      const turnKey = crypto.randomUUID();

      const append = (label: string) => { const id = turnKey + ':' + workLog.size; workLog.set(id, { id, label }); };

      append('已读取工作区结构');

      const phases = { connecting: '连接模型', thinking: '开始处理任务', writing: '生成答复' };

      let lastPhase: ChatProgress['phase'] = 'connecting';

      const publish = (sample: ChatProgress) => progress({ ...sample, workLog: Array.from(workLog.values()) });

      publish({ phase: lastPhase, model: selection.modelId });

      const record = (item: OfficeActivity) => workLog.set(item.id, { ...workLog.get(item.id), ...item });

      const reportProgress = (sample: ChatProgress) => { if (sample.activity) { record(sample.activity); publish({ ...sample, phase: lastPhase }); } else if (lastPhase !== sample.phase || workLog.size === 1) { lastPhase = sample.phase; append(phases[lastPhase]); publish(sample); } else progress(sample); };

      detach = office.Subscribe(event => { if (event.type !== 'task') return; const task = event.task; const states = { waiting: '等待依赖', blocked: '受阻', queued: '已排队', running: '执行中', completed: '已完成', suspended: '已挂起', cancelled: '已取消' }; record({ id: 'task:' + task.id + ':' + task.attempt + ':' + task.state, label: task.agentId + ' · ' + states[task.state], input: task.goal, result: task.workspaceInstanceId, alert: task.state === 'blocked' || task.state === 'suspended' ? task.error || task.goal : undefined }); publish({ phase: lastPhase, model: selection.modelId }); });

      const projectSkills = configuration.skills?.map(skill => ({ name: skill.name, description: /^description:\s*(.+)$/m.exec(skill.content)?.[1]?.slice(0, 400), source: '.agents/skills/' + skill.id + '/SKILL.md' }));

      const goal = JSON.stringify({ projectSettings: (await this.work.Read(projectId)).settings, ...(projectSkills?.length && { availableProjectSkills: projectSkills, skillUsage: '按用户意图与技能用途匹配；命中时可在当前权限内读取对应项目技能文件。用户链接了清单中的技能时优先使用，未命中无需调用。' }), project: project.entry.name, workspaceTree, organization: office.organization.children, userRequest: SkillCommands.Expand(input.trim(), configuration.skills) });

      context.push({ role: 'user', content: goal });

      let dispatch!: OfficeDispatch;

      const tokenReports = new Map<string,
        {
          sequence: number;

          total: number
        }>();

      const active = new Map<string, NonNullable<ChatProgress['runningAction']>>();
      // 每次用户指令独享收件人和证据；并行 Office 不共享成员邮箱。
      const members = new Map<string, { actor: string; inbox: OfficeInputs; delivered: Set<string>; signal: AbortSignal }>();
      const evidence = new Map<string, { actor: string; summary: string }>();
      const broadcast = (notice: { evidenceId: string; finding: string; scope: string }, except?: string) => {
        const proof = evidence.get(notice.evidenceId);
        if (!proof) throw Error('广播需要引用本轮已返回的终端回执');
        const recipients: string[] = [];
        const key = JSON.stringify([notice.finding, notice.scope]);
        for (const [task, member] of members) {
          if (task === except || member.signal.aborted || member.delivered.has(key)) continue;
          member.delivered.add(key);
          member.inbox.Push(JSON.stringify({ type: 'office.environment', ...notice, observedBy: proof.actor }));
          recipients.push(member.actor);
        }
        return { queuedFor: recipients };
      };
      const runAgent = async (role: AgentRole, messages: Parameters<OfficeChat>[1], root: string, session: string, agentInstanceId: string, signal: AbortSignal, ReadPermission: () => AgentPermission, report: (seq: number, kind: 'message' | 'summary', count: number) => void, operations: OfficeOperations, publish: (sample: ChatProgress) => void, projectRoot = root) => {
        const issues = new Set<string>();
        const actor = role.definition.name;
        const goal = session === id ? '等待模型响应' : messages.at(-1)?.content.split('\n')[0] || '执行成员任务';
        const prefix = session + '/';
        const cancellationSource = () => {
          if (signal.reason === 'user-stop' || controller.signal.reason === 'user-stop') return '用户停止';
          if (signal.reason === 'app-shutdown' || controller.signal.reason === 'app-shutdown') return '应用关闭';
          if (signal.aborted && session !== id && !controller.signal.aborted) return '成员任务取消信号';
          return '来源未知';
        };
        const inbox = session === id ? inputs : new OfficeInputs((entryId, text, state) => {
          const notice = JSON.parse(text);
          record({ id: 'broadcast:' + entryId, actor: '助理', recipient: actor, label: '环境广播', summary: notice.finding + ' · ' + state, input: text });
          progress({ phase: lastPhase, model: selection.modelId, workLog: Array.from(workLog.values()) });
        });
        if (session !== id) members.set(session, { actor, inbox, delivered: new Set(), signal });
        const base = { actor, action: goal, since: Date.now() };
        active.set(prefix, base);
        const forward = (sample: ChatProgress) => {
          const step = sample.activity && { ...sample.activity };
          if (step) {
            step.actor = actor;
            if (step.id.startsWith('tool:')) {
              step.id = 'tool:' + session + '/' + step.id.slice(5);
              if (sample.toolFinished !== undefined) step.toolState = sample.toolFinished ? 'returned' : 'running';
              if (step.alert && isAbortedReceipt(failureText(step.result) || step.alert)) step.cancelSource = cancellationSource();
              if (step.alert && !sample.toolFinished) step.toolState = 'stopped';
            }
            if (step.alert) {
              const reason = step.alert === step.label + '执行失败' ? failureText(step.result) || step.alert : step.alert;
              issues.add(actor + ' · ' + step.label + ' · ' + failureSummary(reason).slice(0, 600));
            }
            if (sample.toolFinished && step.label === 'bash' && step.result && !step.cancelSource) {
              const output = failureText(step.result);
              const summary = (step.alert ? failureSummary(output) : output.trim().split('\n')[0] ?? '').slice(0, 300);
              evidence.set(step.id, { actor, summary });
              // Windows 的解释器占位程序有明确签名，助理等待派发回执期间也能通知同批成员。
              if (step.alert && /^Python was not found; run without arguments to install from the Microsoft Store/im.test(output))
                broadcast({ evidenceId: step.id, scope: '当前 Office 的 Windows 终端；自定义 PATH 或虚拟环境请单独核对', finding: '成员调用 python 时命中了 Windows 应用执行别名，解释器未启动。选择已验证的工具或先检查当前解释器。' }, session);
            }
            const key = prefix + step.id;
            if (step.label === 'cbim_office_dispatch' && step.input) {
              try {
                const destination = JSON.parse(step.input);
                step.recipient = office.organization.FindMember(destination.memberId)?.name ?? destination.memberId;
                step.workspace = office.project.FindWorkspace(destination.workspaceId)?.name ?? destination.workspaceId;
                step.summary = destination.goal;
              } catch { /* 无法解析时保留工具原始内容。 */ }
            }
            if (sample.toolFinished || step.alert) {
              active.delete(key);
              if (session === id) {
                base.action = '等待模型响应';
                base.since = Date.now();
              }
            }
            else if (step.input) {
              let action = describeAction(step);
              if (step.recipient) action = '派发给 ' + step.recipient + ' · ' + step.summary;
              else step.summary = action;
              active.set(key, { actor, action, since: active.get(key)?.since ?? Date.now() });
            }
          } else if (session === id) {
            const action = sample.phase === 'writing' ? '生成回复' : sample.phase === 'connecting' ? '连接模型' : '等待模型响应';
            if (base.action !== action) { base.action = action; base.since = Date.now(); }
          }
          const runningAction = Array.from(active.values()).at(-1);
          if (session === id || step) publish({ ...sample, activity: step, runningAction });
          else progress({phase:lastPhase,model:selection.modelId,runningAction});
        };
        forward({phase:'connecting',model:role.definition.model!.modelId});
        try {
          const dispatchOperations: OfficeOperations = { ...operations, ProjectRead: input => project.runtime.ReadResource(input), Dispatch: async (input, stop) => {
            const member = office.organization.FindMember(input.memberId)?.name ?? input.memberId;
            const workspace = office.project.FindWorkspace(input.workspaceId)?.name ?? input.workspaceId;
            let receipt: unknown;
            try {
              receipt = await operations.Dispatch(input, stop);
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              issues.add(member + ' · ' + reason);
              record({ id: 'receipt:' + crypto.randomUUID(), label: '任务回执', actor: member, recipient: actor, workspace, input: input.goal, summary: reason, alert: reason });
              progress({ phase: lastPhase, model: selection.modelId, workLog: Array.from(workLog.values()) });
              throw error;
            }
            const detail = receipt as { taskId?: string; summary?: string; status?: string; issues?: string[] } | null;
            for (const issue of detail?.issues ?? []) issues.add(issue);
            record({ id: 'receipt:' + (detail?.taskId ?? crypto.randomUUID()), label: '收到回执',
              actor: member, recipient: actor, workspace, issues: detail?.issues, summary: detail?.summary || detail?.status || '已返回任务结果', input: input.goal, result: JSON.stringify(receipt) });
            progress({phase:lastPhase,model:selection.modelId,workLog:Array.from(workLog.values()),runningAction:Array.from(active.values()).at(-1)});
            return receipt;
          } };
          const instructions = agentRoleInstructions(role.definition) + (session === id ? '\n团队协作任务先核对实际业务与组织架构，再用 cbim_office_plan 向团队公布目标、相关业务节点、选岗依据及排序后的任务。每项写明负责人、工作区、预期产物和前置任务。阻塞或改派时更新计划。涉及派发时先展示计划，再按前置任务的真实回执执行。收集成员成果与过程问题，判断已解决项、待协调项和适用范围。运行中已有成员时，先 inspect 核对 environmentEvidence，再调用 cbim_office_broadcast 通知相关环境事实。下一次派发时把相关结论写入任务目标；需要时邀请合适岗位处理。' : `\n本轮项目可读目录为 ${projectRoot}，作业目录为 ${root}。相对路径以作业目录为基准，文件修改限于作业目录。交付时向派发人说明成果、验证、过程中遇到的问题、已采用的解决办法及仍需协助的事项。`);
          const result = await chat(instructions, messages, signal, forward, { shared: project.runtime.shared, ReportStage: session === id ? ReportStage : undefined, inputs: inbox, ReadPermission, ReportTokens: total => { const previous = tokenReports.get(agentInstanceId) ?? { sequence: 0, total: 0 }; const next = { sequence: previous.sequence + 1, total: previous.total + total }; tokenReports.set(agentInstanceId, next); report(next.sequence, 'summary', next.total); }, operations: dispatchOperations, configuration: role.definition, agentInstanceId, officeId: office.id, selection: role.definition.model!, root, projectRoot, session, project: projectId, engineRoot: project.cache.engines });
          return { ...result, issues: Array.from(issues) };
        } catch (error) {
          if (session !== id && issues.size && !signal.aborted)
            throw new Error((error instanceof Error ? error.message : String(error)) + '\n成员过程反馈：\n' + Array.from(issues).join('\n'), { cause: error });
          throw error;
        } finally {
          if (session !== id) { members.delete(session); inbox.Close(); }
          for (const step of workLog.values()) {
            if (step.id.startsWith('tool:' + prefix) && step.toolState === 'running') record({ ...step, toolState: 'stopped', ...(signal.aborted && { cancelSource: cancellationSource(), alert: '执行已中止' }) });
          }
          for (const key of active.keys()) if (key.startsWith(prefix)) active.delete(key);
          progress({phase:lastPhase,model:selection.modelId,workLog:Array.from(workLog.values()),runningAction:Array.from(active.values()).at(-1)});
        }
      };

      const reply = await office.OpenMainAgent({ parameters: controller.signal, CreateEngine: async (signal, agentId, role, report, ReadPermission) => ({ session: () => runAgent(role, context, project.entry.path, id, agentId, signal, ReadPermission, report, { ...dispatch.Operations(), Inspect: () => ({ ...dispatch.Operations().Inspect() as object, environmentEvidence: Array.from(evidence, ([id, item]) => ({ id, ...item })).slice(-100) }), BroadcastEnvironment: broadcast, PublishPlan: plan => {
        const tasks = plan.tasks.map((task, index) => (index + 1) + '. ' + task.title + ' · ' + task.owner + ' · ' + task.workspace + '\n目的：' + task.purpose + '\n前置：' + (task.dependencies.join('、') || '无，可独立开始'));
        record({ id: 'plan:' + crypto.randomUUID(), label: '协作计划', actor: office.mainRole.definition.name, summary: plan.goal, input: ['岗位分工：' + plan.organization, '业务范围：' + plan.business, ...tasks].join('\n\n') });
        publish({ phase: lastPhase, model: selection.modelId });
      }, ProjectWrite: input => project.runtime.ChangeResource(input, { session: id, selection }) }, reportProgress), Close: async () => { controller.abort(); }, }) }, (_engine, commands) => { dispatch = new OfficeDispatch(office, project.entry.path, commands, (role, goal, root, taskId, signal, ReadPermission, report, operations, agentId, projectRoot) => runAgent(role, [{ role: 'user', content: SkillCommands.Expand(goal, role.definition.skills) }], root, taskId, agentId, signal, ReadPermission, report, operations, sample => { if (sample.activity) reportProgress(sample); }, projectRoot), controller.signal); return () => { }; }, configuration);

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

          result = { issues: [...new Set([...result.issues, ...next.issues])], text: result.text + '\n\n' + next.text, metrics: { ...next.metrics, elapsed: result.metrics.elapsed + next.metrics.elapsed, output: result.metrics.output != null && next.metrics.output != null ? result.metrics.output + next.metrics.output : undefined, cost: result.metrics.cost != null && next.metrics.cost != null ? result.metrics.cost + next.metrics.cost : undefined } };
        }

        await ReportStage?.('保存回复');

        return await history.AppendTurn(id, input.trim(), result.text, result.metrics, Array.from(workLog.values()));
      }
      catch (error)
      {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          const source = controller.signal.reason === 'user-stop' ? '用户停止' : controller.signal.reason === 'app-shutdown' ? '应用关闭' : '来源未知';
          await history.AppendTurn(id, input.trim(), '已中止 · ' + source, undefined, Array.from(workLog.values()));
        }
        throw error;
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

      this.activeEngines.delete(office.id);

      this.controllers.delete(key);

      this._inputs.delete(key);

      this._inputSkills.delete(key);

      stopSignal?.removeEventListener('abort', externalStop);

      for (const listener of this._idle)
        listener(projectId, id);
    }
  }
}
