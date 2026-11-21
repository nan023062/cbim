/**
 * 作用定位：一个 Agent 的生命期用量。每次任务独占上报入口，空闲时释放整个速率窗口。
 * 设计原因：实例独立累计用量并拥有速率窗口计时器，空闲时清理窗口；此统计不代替费用结算。
 */
import { changeEvents } from '../../events';

export type AgentChange = 'executing' | 'idle' | 'tokens' | 'rate';

export class AgentTokenUsage
{
  private readonly changes = changeEvents<AgentChange>();

  public readonly Subscribe = this.changes.Subscribe;

  private expiry?: ReturnType<typeof setTimeout>;

  private ScheduleExpiry()
  {
    if (this.expiry !== undefined)
      return;

    const first = this.window?.keys().next().value;

    if (first === undefined)
      return;

    this.expiry = setTimeout(() => { this.expiry = undefined; if (!this.window) return; const now = performance.now(); for (const time of this.window.keys()) { if (time > now - 2000) break; this.window.delete(time); } this.ScheduleExpiry(); this.changes.Emit('rate'); }, Math.max(1, Math.ceil(first + 2000 - performance.now())));
  }

  private total = 0;

  private reported = false;

  private window?: Map<number, number>;

  public get state(): 'idle' | 'executing'
  {
    return this.window ? 'executing' : 'idle';
  }

  public get totalTokens()
  {
    return this.total;
  }

  public get tokensPerSecond()
  {
    return this.window ? this.Rate(performance.now()) : 0;
  }

  private Rate(now: number)
  {
    let tokens = 0;

    for (const [time, count] of this.window!)
    {
      if (time > now - 2000)
        tokens += count;
    }

    return tokens / 2;
  }

  public Read(now: number)
  {
    return { state: this.state, totalTokens: this.total, reported: this.reported, tokensPerSecond: this.window ? this.Rate(now) : 0 };
  }

  public Begin()
  {
    if (this.window)
      throw new Error('Agent 正在执行任务');

    const window = this.window = new Map<number, number>();

    this.changes.Emit('executing');

    let sequence = 0,
      messages = 0,
      recorded = 0;

    return (seq: number, kind: 'message' | 'summary', count: number) => { if (window !== this.window || seq <= sequence || !Number.isSafeInteger(count) || count < 0) return; sequence = seq; const firstReport = !this.reported; this.reported = true; if (kind === 'message') messages += count; const delta = Math.max(0, (kind === 'message' ? messages : count) - recorded); if (!delta) { if (firstReport) this.changes.Emit('tokens'); return; } recorded += delta; this.total += delta; const now = Math.floor(performance.now()); for (const time of window.keys()) { if (time > now - 2000) break; window.delete(time); } window.set(now, (window.get(now) ?? 0) + delta); this.ScheduleExpiry(); this.changes.Emit('tokens'); };
  }

  public End()
  {
    if (!this.window)
      return;

    clearTimeout(this.expiry);

    this.expiry = undefined;

    this.window.clear();

    this.window = undefined;

    this.changes.Emit('idle');
  }
}
