/**
 * 作用定位：提供前端异步协作的实例级代次标记，供控制器判断迟到结果是否仍可使用。
 * 设计原因：生成与比较标记是稳定机制，何时作废、校验响应及发布状态仍由消费者决定。
 * 职责边界：不持有请求、Promise 或业务状态，不取消工作、不管理定时器或资源释放。
 */
export class AsyncGeneration {
  /** 标记只在本实例内有意义，不序列化、不参与业务身份或版本排序。 */
  private current = Symbol();

  /** 捕获当前代次，不使其他读取失效；适用于同一生命周期内的读取。 */
  capture(): symbol { return this.current; }

  /** 作废全部旧标记并返回新标记；由调用方决定在新请求、切换或销毁时调用。 */
  advance(): symbol { return this.current = Symbol(); }

  /** 只判断标记是否属于本实例当前代次；成功、失败与清理分支分别在原位置检查。 */
  isCurrent(token: symbol): boolean { return token === this.current; }
}
