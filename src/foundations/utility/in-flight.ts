/**
 * 作用定位：实例内跟踪已开始的 Promise，供消费者等待当前在途操作快照。
 * 设计原因：去掉重复集合维护，保留业务自行停止接单、取消、核实物理退出和释放租约的职责。
 */
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
