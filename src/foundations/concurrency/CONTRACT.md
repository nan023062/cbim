# 实例级串行执行

公开入口 index.ts 只导出 SerialQueue；无项目模块或平台依赖。每个实例拥有一个 Promise 尾链，按 run 提交顺序执行，同一实例至多一个任务执行，不共享全局锁。

`run` 把本次结果或错误原样交给调用者；无论同步抛错还是异步拒绝，下一项仍可执行。不重试、不吞掉调用者可见的失败。`drain` 等待调用时已提交的队列尾部结束，不汇总错误、不关闭队列、不阻止随后提交。禁止在队列任务里等待同队列后续任务，否则会自锁。

真实消费者为 WebSettings、BudgetSettings、AdmissionSettings、MainAgentSettings、LlmProfiles。版本校验、当前工作区验证、系统加密、关闭策略、配置短锁和写成功后生效的顺序仍在各自模块；基础队列不认识这些业务。

RunJournal 写失败必须阻断后续证据追加，IsolationRecords 也有持久化失败屏障，因此没有迁入这种失败后继续的队列。权限、取消、跨进程锁和重试不通过布尔开关塞入通用类。新增相同排队需求可组合此入口，契约不同则保留独立机制。

模块测试在 `tests/unit/foundations/concurrency.test.ts`，以受控 Promise 验证顺序、同步/异步失败、drain 和实例隔离，不依赖时钟 sleep 或 Application。
