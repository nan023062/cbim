/**
 * 作用定位：异步执行工具，提供实例内串行队列、在途 Promise 集合与有时限的请求关联表。
 * 设计原因：按异步协调类别集中维护数据结构，各实例独立持有状态，不引入共享调度器。
 * 职责边界：队列负责执行顺序，集合只跟踪已启动操作；停止接单、取消、重试和物理退出由消费者负责。
 * 实现形式：实例类与回执契约；各实例独立拥有队列、集合或计时器。
 */
// #region 公开类型与实例

/** 同一实例按提交顺序执行，失败后继续；不适用于写失败必须永久停止的证据日志。 */
export class SerialQueue
{
  // #region 私有成员

  // #region 字段
  /** 已提交任务的结算屏障；原始错误由各次 run 返回的 Promise 承担。 */
  private tail: Promise<void> = Promise.resolve();

  // #endregion

  // #endregion

  // #region 公开成员

  // #region 方法

  /** 返回本次原始结果/错误；失败不会阻断后续任务。任务内等待本队列的新任务会死锁，禁止重入等待。 */
  public run<T>(work: () => T | PromiseLike<T>): Promise<T>
  {
    const result = this.tail.then(work);
    this.tail = result.then(
      () =>
      {
      },
      () =>
      {
      }
    );
    return result;
  }

  /** 等待调用时已提交的任务结束，不收集错误，也不禁止后续入队；错误由各次 run 的调用者处理。 */
  public drain(): Promise<void>
  {
    return this.tail;
  }

  // #endregion

  // #endregion
}

/** 调用方创建 Promise 并提供结算入口；关联表不定义协议成功、错误映射或重试策略。 */
export interface PendingReply<T>
{
  // #region 属性
  /** 交付原请求结果；回调应不抛错。 */
  resolve: (value: T) => void;

  /** 拒绝原请求；不自动重试或停止进程。 */
  reject: (error: Error) => void;

  // #endregion
}

/** 每实例独立管理 ID 与计时器；超时动作由协议适配器决定，不自动杀进程或重发。 */
export class PendingRequests<K, T = unknown>
{
  // #region 私有成员

  // #region 字段
  /** 尚未取出的请求及计时器；计时器触发本身不删除请求。 */
  private readonly entries = new Map<
    K,
    PendingReply<T> &
    {
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  // #endregion

  // #endregion

  // #region 公开成员

  // #region 方法

  /** timeoutMs 为毫秒，沿用平台定时器语义；重复 ID 拒绝覆盖，超时回调负责取出/拒绝单项或整体失败。 */
  public register(id: K, reply: PendingReply<T>, timeoutMs: number, onTimeout: () => void): void
  {
    if (this.entries.has(id))
      throw Error('Duplicate pending request');
    const timer = setTimeout(onTimeout, timeoutMs);
    this.entries.set(id, { ...reply, timer });
  }

  /** 先移除并清理计时器再交还结算入口；未知或重复回包返回 undefined，不触发回调。 */
  public take(id: K): PendingReply<T> | undefined
  {
    const entry = this.entries.get(id);
    if (!entry)
      return undefined;
    clearTimeout(entry.timer);
    this.entries.delete(id);
    return entry;
  }

  /** 按登记顺序清理并拒绝；工厂可保留逐请求错误身份，工厂/reject 须不抛错，不代表进程已退出。 */
  public rejectAll(error: Error | (() => Error)): void
  {
    for (const entry of this.entries.values())
    {
      clearTimeout(entry.timer);
      entry.reject(typeof error === 'function' ? error() : error);
    }
    this.entries.clear();
  }

  // #endregion

  // #endregion
}

/** 实例内跟踪已开始的 Promise；等待当前快照，不替代业务取消、动态排空或资源退出屏障。 */
export class InFlightOperations
{
  // #region 私有成员

  // #region 字段
  /** 按 Promise 身份去重的当前在途集合，不保存历史结果。 */
  private readonly pending = new Set<Promise<unknown>>();

  // #endregion

  // #endregion

  // #region 公开成员

  // #region 属性

  /** 当前尚未移除的 Promise 数量；不表示进程、事务或业务仍占用的资源数量。 */
  public get size()
  {
    return this.pending.size;
  }

  // #endregion

  // #region 方法

  /** 原样返回同一个 Promise；按身份去重，完成或失败后自动移除，不改写结果、不重试。 */
  public track<T>(operation: Promise<T>): Promise<T>
  {
    if (!this.pending.has(operation))
    {
      this.pending.add(operation);
      void operation.then(
        () =>
        {
          this.pending.delete(operation);
        },
        () =>
        {
          this.pending.delete(operation);
        }
      );
    }
    return operation;
  }

  /** 只等调用时快照，吞吐中的新任务不延长等待；错误仍由原调用者观察，不封闭集合。 */
  public async drain(): Promise<void>
  {
    await Promise.allSettled([...this.pending]);
  }

  // #endregion

  // #endregion
}

// #endregion
