/**
 * 作用定位：前端事件订阅工具，提供实例级、无参数的同步通知集合。
 * 设计原因：控制器共用监听器注册和遍历机制，状态、轮询、页面生命周期仍由控制器持有。
 * 职责边界：没有全局事件总线，不保存业务值，不启动读取或计时器，不捕获监听器异常。
 */
export class SubscriptionSet {
  /** 按函数身份去重、按首次插入次序通知；只属于当前集合实例。 */
  private readonly listeners=new Set<()=>void>();

  /** 当前不同监听函数的数量，不是订阅次数；供消费者决定资源生命周期。 */
  get size():number{return this.listeners.size}

  /**
   * 注册不立即通知。返回的退订按函数身份删除，不做引用计数；重复注册任一退订会移除该函数。
   * 保留原 Set 行为：旧退订再次调用，也会移除后来重新注册的同一函数。
   */
  subscribe(listener:()=>void):()=>void {
    this.listeners.add(listener);
    return ()=>{this.listeners.delete(listener)};
  }

  /**
   * 同步遍历当前集合而非快照：尚未执行的监听器被删除后跳过，新加入的监听器可在本轮执行。
   * 异常原样向调用者抛出并中断本轮；不等待异步回调。支持嵌套通知，不添加去抖或调度。
   * 回调反复删除后重加自身可能使遍历无法结束，消费者须避免此类循环。
   */
  notify():void {
    for(const listener of this.listeners)listener();
  }

  /** 清空监听器但不通知、不封闭集合；不取消请求、计时器或其他业务资源。 */
  clear():void {this.listeners.clear()}
}
