/**
 * 作用定位：异步执行工具，提供实例内串行队列和在途 Promise 集合。
 * 设计原因：按异步协调类别集中维护数据结构，各实例独立持有状态，不引入共享调度器。
 * 职责边界：队列负责执行顺序，集合只跟踪已启动操作；停止接单、取消、重试和物理退出由消费者负责。
 */
/** 同一实例按提交顺序执行，失败后继续；不适用于写失败必须永久停止的证据日志。 */
export class SerialQueue {
  private tail:Promise<void>=Promise.resolve();

  /** 返回本次原始结果/错误；失败不会阻断后续任务。任务内等待本队列的新任务会死锁，禁止重入等待。 */
  run<T>(work:()=>T|PromiseLike<T>):Promise<T>{
    const result=this.tail.then(work);
    this.tail=result.then(()=>{},()=>{});
    return result;
  }

  /** 等待调用时已提交的任务结束，不收集错误，也不禁止后续入队；错误由各次 run 的调用者处理。 */
  drain():Promise<void>{return this.tail}
}

/** 实例内跟踪已开始的 Promise；等待当前快照，不替代业务取消、动态排空或资源退出屏障。 */
export class InFlightOperations {
  private readonly pending=new Set<Promise<unknown>>();

  /** 原样返回同一个 Promise；按身份去重，完成或失败后自动移除，不改写结果、不重试。 */
  track<T>(operation:Promise<T>):Promise<T> {
    if(!this.pending.has(operation)){
      this.pending.add(operation);
      void operation.then(()=>{this.pending.delete(operation)},()=>{this.pending.delete(operation)});
    }
    return operation;
  }

  /** 当前尚未移除的 Promise 数量；不表示进程、事务或业务仍占用的资源数量。 */
  get size(){return this.pending.size}

  /** 只等调用时快照，吞吐中的新任务不延长等待；错误仍由原调用者观察，不封闭集合。 */
  async drain():Promise<void>{await Promise.allSettled([...this.pending])}
}
