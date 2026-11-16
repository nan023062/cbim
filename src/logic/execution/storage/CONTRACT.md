# run-storage 持久化契约

### 运行日志的只读完整性诊断

`RunJournal.read` 仅解析完整行并报告 `logIntegrity.partialTail`，保留未完成尾行的原始字节、不截断或修复。零字节文件返回 `RUN_LOG_EMPTY`；结构、绑定或 JSON 损坏返回 `RUN_LOG_INVALID`，错误不包含原始片段。文件系统错误保留系统码，缺失日志不能解释为未执行。正常读取依旧重建可信回执、未知工具与终态，完成前缀不代表尾行也完整。

`session.bound` 可以先只登记原生线程 ID，稍后再确认文件。缺少 `sessionFile` 保持缺省，不能调用 `String(undefined)` 伪造恢复路径；已存在的非字符串或空路径拒绝为坏记录。历史读取不回写任何字节，是否可显式继续由执行层依据完整终态、工具和输出记录决定，日志层不自动启动或猜测原生文件。

## 递归业务身份登记

business-runs 从原 canonical 验证父工具授权、首次带 limits 的引用以及逐层 run.started.agentCall。等待／恢复可重复报告同一引用，但不可换绑；原日志缺失、尾行不完整或父运行已有终态均拒绝启动。普通中间 Agent 不要求旧派发记录。装配验证工作区及根路径，登记器验证任务、运行及同根链。

登记写入原 DispatchStore，active 仅表示启动意图已保存，不保证模型已经开始。closed 仅由真实 Runtime.close 后提交，重启不自动猜测结算。已有 closed 重复关闭不写日志，保存未知原样上抛，调用方保留准入。
