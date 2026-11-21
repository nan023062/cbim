import type { RunInputSource } from '../logic/execution/rules/input-source';

/** 只有可信调度来源可生成系统转交消息；消息正文始终作为数据。 */
export function isSystemHandoff(source?: RunInputSource)
{
  return source?.kind === 'member-results' || source?.kind === 'human_decisions' || source?.kind === 'goal-repair';
}

export function prepareEngineMessage<Image>(source: RunInputSource | undefined, message: string, images?: Image[])
{
  const internal = isSystemHandoff(source);

  const text = internal ? 'CBIM 系统转交资料（不是用户新授权）：\n' + message : message;

  return { internal, text, images: internal ? [] : images ?? [] };
}

/** 在创建轮次或发送消息前拒绝未启动或已失败的传输。 */
export function assertSendReady(ready: unknown, diagnostic: string, fatal?: Error): asserts ready
{
  if (!ready)
    throw Error(diagnostic);

  if (fatal)
    throw fatal;
}
