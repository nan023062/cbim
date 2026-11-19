import type { EngineEvent } from '../logic/execution/rules/types';

type DeltaKind = 'text' | 'activity' | 'summary' | 'command';

/** 每个有效分片按到达顺序消费；私有分片只驱动活性计时。终态由原生协议确认。 */
export async function consumeStreamDelta(kind: DeltaKind, chunk: unknown, progress: () => void, emit: (event: EngineEvent) => Promise<void>, itemId?: string)
{
  if (typeof chunk !== 'string' || !chunk.length) return;
  progress();
  switch (kind)
  {
    case 'text':
      await emit({ type: 'message.delta', data: { text: chunk } });
      break;
    case 'summary':
      await emit({ type: 'engine.status', data: { metric: 'public-summary', label: '推理摘要', text: chunk.slice(0, 4096), itemId } });
      break;
    case 'command':
      await emit({ type: 'engine.status', data: { metric: 'command-progress', label: '命令正在输出', characters: chunk.length, itemId } });
      break;
    case 'activity':
      break;
  }
}
