/** 读取三种模型协议的 SSE 正文和用量，只向界面报告阶段和采样速率。 */
import type { ChatProgress } from '../../../logic-new/projects/offices';

export async function readOfficeStream(response: Response, model: string, progress: (sample: ChatProgress) => void)
{
  if (!response.body)
    throw Error('模型返回了空的数据流');

  const reader = response.body.getReader();

  const decoder = new TextDecoder();

  let pending = '',
    reply = '',
    units = 0,
    done = false,
    last = 0;

  let phase: ChatProgress['phase'] = 'connecting';

  let usage: Record<string, any> = {};

  const samples:
    {
      at: number;

      units: number
    }[] = [{ at: performance.now(), units: 0 }];

  function consume(line: string)
  {
    if (!line.startsWith('data:'))
      return;

    const value = line.slice(5).trim();

    if (!value)
      return;

    if (value === '[DONE]')
    {
      done = true;

      return;
    }

    const e = JSON.parse(value);

    if (e.error || ['error', 'response.failed', 'response.incomplete'].includes(e.type))
      throw Error('模型回复中断');

    const choice = e.choices?.[0];

    if (choice?.finish_reason || e.type === 'message_stop' || e.type === 'response.completed')
      done = true;

    Object.assign(usage, e.usage, e.message?.usage, e.response?.usage);

    const text = choice?.delta?.content ?? (e.type === 'response.output_text.delta' ? e.delta : e.delta?.text);

    const thought = choice?.delta?.reasoning_content ?? e.delta?.thinking ?? (e.type?.includes('reasoning') && typeof e.delta === 'string' ? e.delta : '');

    if (text)
      reply += text;

    if (!text && !thought)
      return;

    const fragment = text || thought;

    units += (fragment.match(/[\u3000-\u9fff]/gu)?.length ?? 0) + fragment.replace(/[\u3000-\u9fff]/gu, '').length / 4;

    const now = performance.now();

    while (samples.length > 1 && samples[1].at < now - 2000)
      samples.shift();

    samples.push({ at: now, units });

    const next = text ? 'writing' : 'thinking';

    if (next !== phase || now - last >= 250)
    {
      const span = now - samples[0].at;

      progress({ phase: next, model, estimated: true, rate: span >= 200 ? (units - samples[0].units) * 1000 / span : undefined });

      phase = next;

      last = now;
    }
  }

  try
  {
    while (true)
    {
      const chunk = await reader.read();

      pending += decoder.decode(chunk.value, { stream: !chunk.done });

      const lines = pending.split('\n');

      pending = lines.pop()!;

      for (const line of lines)
        consume(line);

      if (chunk.done)
        break;
    }

    consume(pending);

    if (!done || !reply.trim())
      throw Error('未收到完整的模型回复');

    return { reply, usage };
  }
  finally
  {
    await reader.cancel().catch(() => { });
  }
}
