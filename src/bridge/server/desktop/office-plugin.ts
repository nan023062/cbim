/** 将 Office 的一轮对话交给已安装的引擎，关闭实例后释放固定版本。 */
import { runUsage } from '../../../logic-new/projects/office-usage';

import path from 'node:path';

import { mkdir } from 'node:fs/promises';

import type { OfficeChat } from '../../../logic-new/projects/offices';

import type { EnginePackages } from '../../../logic-new/engines/packages';

import { loopEngineSchema } from '../../../logic-new/engines';

import { EngineModelProfiles } from '../../../logic-new/engines/service';

import type { LlmProfiles } from '../../../logic-new/models/service';

import { packagedEngineAdapter } from '../../../logic-new/projects/office-engine-loader';

function activityDetail(value: unknown): string | undefined
{
  if (value === undefined) return;
  const text = typeof value === 'string' ? value : JSON.stringify(value, (key, item) => /^(authorization|api[_-]?key|access[_-]?token|password|secret)$/i.test(key) ? '•••' : item, 2);
  return text?.length > 16000 ? text.slice(0, 16000) + '…' : text;
}

export async function runOfficePlugin(packages: EnginePackages, profiles: LlmProfiles, ...[instructions, messages, signal, progress, turn]: Parameters<OfficeChat>)
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

  try
  {
    signal.throwIfAborted();

    const tools = { list: async () => [], call: async () => { throw Error('对话未绑定该工具'); } };

    const engine = packagedEngineAdapter(kind, runtime).create({ runtime, llm, provider: 'cbim-' + llm.profile.id, model, agentHome, prompt: instructions, knowledge: tools });

    const stop = () => { void engine.stop().catch(() => { }); };

    signal.addEventListener('abort', stop, { once: true });

    const usageEvents: Parameters<typeof runUsage>[0][number][] = [];

    let contextUsed: number | undefined;

    try
    {
      const goal = messages.at(-1)!.content;

      const replies: string[] = [];
      let partial = '';
      let lastPaint = 0;

      await engine.start({
        runId, directory, task: { taskId: runId, workspaceId: turn.project, mode: 'chat', root: turn.root, goal, acceptance: [], moduleIds: [] },
        engineHandoff: messages.length > 1 ? JSON.stringify(messages.slice(0, -1)) : undefined,
        capabilities: [{ id: 'office-chat', tools, disableNativeTools: true }],
        beforeTool: async call => { const reason = '对话未绑定该工具'; progress({ phase: 'thinking', model, activity: { id: 'tool:' + call.id, label: call.name, input: activityDetail(call.input), alert: reason } }); return { allow: false, reason }; },
        emit: async event =>
        {
          if (['tool.started', 'tool.updated', 'tool.finished'].includes(event.type) && typeof event.data.id === 'string')
          {
            const name = String(event.data.name ?? '工具');
            const result = activityDetail(event.data.result);
            progress({ phase: 'thinking', model, activity: { id: 'tool:' + event.data.id, label: name, ...(result !== undefined && { result }), ...(event.data.isError === true && { alert: name + '执行失败' }) } });
          }
          if ((event.type === 'message' && event.data.usage) || (event.type === 'engine.status' && event.data.metric === 'run-usage')) usageEvents.push(event);
          if (event.type === 'engine.status' && event.data.metric === 'context' && typeof event.data.tokens === 'number') contextUsed = event.data.tokens;
          if (typeof event.data.text !== 'string') return;
          if (event.type === 'message.delta')
          {
            partial += event.data.text;
            if (Date.now() - lastPaint < 40) return;
          }
          else if (event.type === 'message' && event.data.role === 'assistant')
          {
            replies.push(event.data.text);
            partial = '';
          }
          else return;
          lastPaint = Date.now();
          progress({ phase: 'writing', model, text: [...replies, partial].filter(Boolean).join('\n\n') });
        },
      });

      signal.throwIfAborted();

      progress({ phase: 'thinking', model });

      const result = await engine.run(goal);

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
    release?.();
  }
}
