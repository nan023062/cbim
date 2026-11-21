/**
 * 作用定位：单个 Office 当前任务的追加输入队列；用户补充与架构通知共享接收、交付和未知结果语义。
 * 设计原因：统一用户插入与架构通知的交付状态，未知接收结果不自动重发；该队列只属于当前运行。
 */
export class OfficeInputs
{
  /** 已提交输入在本轮保留身份与回执，不重发未知交付。 */
  private readonly _entries:
    {
      id: string;

      text: string;

      state: 'pending' | 'sending' | 'delivered' | 'uncertain'
    }[] = [];

  private readonly _listeners = new Set<() => void>();

  private _closed = false;

  public constructor(private readonly _report: (id: string, text: string, state: string) => void = () => { })
  {
  }

  /** 返回接收回执；接收不等于模型已经消费。 */
  public Push(text: string): string
  {
    if (this._closed)
      throw Error('本轮已结束，请发送新消息');

    const id = crypto.randomUUID();

    this._entries.push({ id, text, state: 'pending' });

    this._report(id, text, '等待注入');

    for (const listener of this._listeners)
      listener();

    return id;
  }

  /** 在起始提示或工具返回的模型可见边界领取未发送输入。 */
  public Take(): { id: string; text: string }[]
  {
    const pending = this._entries.filter(entry => entry.state === 'pending');

    for (const entry of pending)
    {
      entry.state = 'delivered';

      this._report(entry.id, entry.text, '已加入当前任务上下文');
    }

    return pending.map(({ id, text }) => ({ id, text }));
  }

  /** 原生追加串行发送；发送后异常属于未知，不自动重放。 */
  public Connect(Send: (text: string) => Promise<void>): () => Promise<void>
  {
    let connected = true;

    let pending = Promise.resolve();

    const flush = () => { pending = pending.then(async () => { while (connected) { const entry = this._entries.find(item => item.state === 'pending'); if (!entry) break; entry.state = 'sending'; try { await Send(JSON.stringify({ officeInput: { id: entry.id, text: entry.text } })); entry.state = 'delivered'; this._report(entry.id, entry.text, '引擎已接收追加输入'); } catch (error) { entry.state = 'uncertain'; this._report(entry.id, entry.text, '注入结果未确认：' + String(error)); } } }); };

    this._listeners.add(flush);

    flush();

    return async () => { connected = false; this._listeners.delete(flush); await pending; };
  }

  /** 关闭接收与领取余项同步发生，避免终态结算时丢失追加。 */
  public Finish(): { id: string; text: string }[]
  {
    const pending = this.Take();

    if (!pending.length)
      this._closed = true;

    return pending;
  }
}
