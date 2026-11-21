/** 将 Office 的一轮对话交给已安装的引擎，关闭实例后释放固定版本。 */
import { runUsage } from '../../../logic/projects/office-usage';

import path from 'node:path';

import { mkdir } from 'node:fs/promises';

import type { OfficeChat } from '../../../logic/projects/offices';

import type { EnginePackages } from '../../../logic/engines/packages';

import { loopEngineSchema } from '../../../logic/engines';

import { EngineModelProfiles } from '../../../logic/engines/service';

import type { LlmProfiles } from '../../../logic/models/service';

import { packagedEngineAdapter } from '../../../logic/projects/office-engine-loader';

import { OfficeTools } from './office-tools';

import type { OfficeApproval } from '../../../logic/projects/office-operations';

import type { managedConnectorPackages } from '../../../logic/resource-management/connector-runtime';

import { openAgentConnectors } from '../../../logic/resource-management/connector-runtime';

function activityDetail(value: unknown): string | undefined
{
  if (value === undefined)
    return;

  const text = typeof value === 'string' ? value : JSON.stringify(value, (key, item) => /^(authorization|api[_-]?key|access[_-]?token|password|secret)$/i.test(key) ? '•••' : item, 2);

  return text?.length > 16000 ? text.slice(0, 16000) + '…' : text;
}

export async function runOfficePlugin(packages: EnginePackages, profiles: LlmProfiles, ...[instructions, messages, signal, progress, turn, approve, connectors]: [...Parameters<OfficeChat>, OfficeApproval?, ReturnType<typeof managedConnectorPackages>?])
{
  const started = Date.now();

  await packages.Check();

  const kind = loopEngineSchema.parse(turn.selection.engine);

  const status = (await packages.List()).find(item => item.kind === kind);

  if (!status?.active || !status.enabled)
    throw Error('请先在执行引擎页安装并启用该引擎');

  if (!status.candidate || status.active.identity !== status.candidate.identity)
    throw Error('请先更新到最新兼容引擎版本');

  const llm = await new EngineModelProfiles(profiles).Resolve(turn.selection.profileId, turn.selection.modelId, kind);

  const model = llm.profile.model;

  progress({ phase: 'connecting', model });

  const runId = crypto.randomUUID();

  const agentHome = path.join(turn.dataRoot, 'office-engines', turn.session, kind);

  const directory = path.join(agentHome, runId);

  await mkdir(directory, { recursive: true });

  const runtime = await packages.ResolveEngine(kind);

  if (runtime.identity !== status.candidate.identity)
    throw Error('引擎版本已变更，请重新选择');

  const release = runtime.retain?.();

  let acquired: Awaited<ReturnType<typeof openAgentConnectors>> | undefined;

  try
  {
    signal.throwIfAborted();

    const ids = turn.configuration?.connectorIds ?? [];

    if (ids.length)
    {
      if (!connectors || !turn.agentInstanceId || !turn.officeId)
        throw Error('当前宿主缺少连接器运行身份');

      const installed = await connectors.manager.List();

      for (const id of ids)
        if (!installed.some(item => item.kind === id && item.active && item.enabled))
          throw Error('请先安装并启用所选连接器：' + id);

      acquired = await openAgentConnectors(connectors, ids, { officeId: turn.officeId, agentInstanceId: turn.agentInstanceId, workspaceId: turn.project, taskId: runId }, signal);
    }

    const officeTools = new OfficeTools(turn.root, turn.project, turn.ReadPermission, turn.operations, signal, approve, acquired?.service);

    const tools = { list: () => officeTools.List(), call: async (name: string, input: Record<string, unknown>, stop: AbortSignal, id?: string) => { const result = await officeTools.Call(name, input, stop, id); const pending = turn.inputs?.Take() ?? []; return pending.length ? { toolResult: result, officeInputs: pending } : result; } };

    const prompt = instructions + '\n本轮提供受管文件/命令工具及 cbim_office_inspect、cbim_office_dispatch。先核对实际目录与岗位；没有可用岗位时直接执行业务，不因缺少成员重复规划。只读不写入、不执行命令、不派发；默认权限逐次审批；完全访问仍受工作区与知识目录保护。命令使用宿主账号执行，不是操作系统隔离沙箱。先 inspect 再派发，子任务在 Office Git 工作树执行，回执中的目录才是实际产物位置，不宣称已合并。派发调用会等待结果，不需轮询。浏览器验收工具尚未接入，不得声称已完成浏览器验证。历史中的工具缺失描述不是本轮工具状态。';

    const engine = packagedEngineAdapter(kind, runtime).create({ runtime, llm, provider: 'cbim-' + llm.profile.id, model, agentHome, prompt, knowledge: tools, ReadPermission: turn.ReadPermission, allowNativeExecution: turn.ReadPermission() !== 'read' });

    const stop = () => { void engine.stop().catch(() => { }); };

    signal.addEventListener('abort', stop, { once: true });

    const usageEvents: Parameters<typeof runUsage>[0][number][] = [];

    let contextUsed: number | undefined;

    try
    {
      const pending = turn.inputs?.Take() ?? [];

      const goal = messages.at(-1)!.content + (pending.length ? '\n' + JSON.stringify({ officeInputs: pending }) : '');

      const replies: string[] = [];

      let partial = '';

      let lastPaint = 0;

      await engine.start({
        runId, directory, task: { taskId: runId, workspaceId: turn.project, mode: 'chat', root: turn.root, goal, acceptance: [], moduleIds: [] },
        engineHandoff: messages.length > 1 ? JSON.stringify(messages.slice(0, -1)) : undefined,
        capabilities: [],
        beforeTool: async call => { const pending = turn.inputs?.Take() ?? []; const decision = pending.length ? { allow: false, reason: '当前任务收到追加输入，本次工具尚未执行。请先依据更新重新评估，再决定是否重新调用：' + JSON.stringify({ officeInputs: pending }) } : await officeTools.Authorize(call); progress({ phase: 'thinking', model, activity: { id: 'tool:' + call.id, label: call.name, input: activityDetail(call.input), ...(decision.allow ? {} : { alert: decision.reason ?? '操作未获批准' }) } }); return decision; },
        emit: async event => { if (['tool.started', 'tool.updated', 'tool.finished'].includes(event.type) && typeof event.data.id === 'string') { const name = String(event.data.name ?? '工具'); const result = activityDetail(event.data.result); progress({ phase: 'thinking', model, activity: { id: 'tool:' + event.data.id, label: name, ...(result !== undefined && { result }), ...(event.data.isError === true && { alert: name + '执行失败' }) } }); } if ((event.type === 'message' && event.data.usage) || (event.type === 'engine.status' && event.data.metric === 'run-usage')) usageEvents.push(event); if (event.type === 'engine.status' && event.data.metric === 'context' && typeof event.data.tokens === 'number') contextUsed = event.data.tokens; if (typeof event.data.text !== 'string') return; if (event.type === 'message.delta') { partial += event.data.text; if (Date.now() - lastPaint < 40) return; } else if (event.type === 'message' && event.data.role === 'assistant') { replies.push(event.data.text); partial = ''; } else return; lastPaint = Date.now(); progress({ phase: 'writing', model, text: [...replies, partial].filter(Boolean).join('\n\n') }); },
      });

      signal.throwIfAborted();

      progress({ phase: 'thinking', model });

      const preparedInputs = turn.inputs?.Take() ?? [];

      const running = engine.run(goal + (preparedInputs.length ? '\n' + JSON.stringify({ officeInputs: preparedInputs }) : ''));

      const disconnect = engine.steer && turn.inputs?.Connect(text => engine.steer!(text, [], signal));

      let result: Awaited<typeof running>;

      try
      {
        result = await running;
      }
      finally
      {
        await disconnect?.();
      }

      signal.throwIfAborted();

      if (result.status !== 'completed')
        throw Error(result.error || '引擎未完成回复');

      const text = replies.join('\n\n').trim();

      if (!text)
        throw Error('引擎没有返回回复正文');

      const usage = runUsage(usageEvents);

      return {
        text, metrics: {
          model, elapsed: Date.now() - started, capacity: llm.profile.contextWindow, used: contextUsed,
          output: usage.usageReported ? usage.output : undefined, cost: usage.costPartial ? undefined : usage.cost
        }
      };
    }
    finally
    {
      signal.removeEventListener('abort', stop);

      try
      {
        await engine.close();
      }
      finally
      {
        const usage = runUsage(usageEvents);

        if (usage.usageReported)
          turn.ReportTokens(usage.total);
      }
    }
  }
  finally
  {
    try
    {
      await acquired?.Release();
    }
    finally
    {
      release?.();
    }
  }
}
