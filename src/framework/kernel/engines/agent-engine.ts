/**
 * 作用定位：底层 Agent 引擎会话及其生命周期端口。
 * 设计原因：启动、运行、追加、停止及关闭分别表达生命周期；取消请求和真实资源退出不能混为一体。
 */
export interface AgentEngine<Context, Image>
{
  readonly kind: string;

  /** 准备进程、工具桥及原生会话；此阶段不发送本轮模型提示，失败后仍由调用方 close。 */
  start(context: Context): Promise<void>;

  /** 发起本轮生成并等待引擎终态；异常交给运行时记录为中断，不能据异常自动重放工具。 */
  run(message: string): Promise<{ status: 'completed' | 'cancelled' | 'failed'; error?: string }>;

  /**
   * 在当前工具批次完成后注入用户补充；不切换模型或授权。
   * signal 只阻止尚未发送的插入；适配器在准备 await 后复验。原生已确认 queued 后不得因迟到取消改报未接收，发送后的无确认错误保持未知且不重发。
   */
  steer?(message: string, images: Image[], signal: AbortSignal): Promise<void>;

  /** 请求停止；返回只表示停止请求已处理，不保证工具副作用已消除或日志已经结算。 */
  stop(): Promise<void>;

  close(): Promise<void>;
}
