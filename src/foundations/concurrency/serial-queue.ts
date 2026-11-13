/**
 * 作用定位：按提交顺序执行异步任务，同一队列最多执行一个任务。
 * 设计原因：设置保存等消费者共用失败后可继续的排队机制，不把配置、锁或事务塞入通用类。
 * 职责边界：无自动重试、取消或关闭策略；不适用于写失败必须永久停止的证据日志队列。
 */
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
