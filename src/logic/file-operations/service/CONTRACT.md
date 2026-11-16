# 受控文件的服务关闭边界

ControlledFiles 的 operations 组合 utility.InFlightOperations，只跟踪原操作 Promise；controllers、closed、heldReleases 仍由服务维护。关闭先拒绝新业务并撤销原控制器，再等待当前操作集合、核实平台 transport.drain，最后释放原租约。排空失败不跳过平台核实或释放屏障。

对象身份、字节备份、阶段账本、一次授权、补偿预览与显式提交保留在本目录及 Core 原契约中。基础集合不发起文件操作，不创建重试/恢复或全局共享状态。

## 递归业务来源

受控写入、报告、显式补偿和隔离报告同时接受旧 DispatchRun 与已登记 AgentBusinessRun 的最小 BusinessRunSource。新记录以 protocol 固定原日志位置；不得凭模型给出的 runId 或目录读取任意日志。active 登记视为在途，禁止提前补偿；closed 后仍必须满足原文件阶段、canonical、工作区和精确字节检查。

隔离报告读取真实宿主／Job／目录状态，重启后即时 host、job 及 basis 可以变化，持久 executionId、原授权和清理阶段不变。查询不回写旧记录，也不重放隔离程序。
