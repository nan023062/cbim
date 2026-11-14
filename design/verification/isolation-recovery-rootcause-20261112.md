# 隔离崩溃恢复测试失败：根因诊断

> 导航维护说明（2026-11-14）：正文保留当时的路径、结论与验证边界；可点击源码链接已更新到当前归属，仅供导航，不作为历史版本证据。未留存的阶段入口另行注明，不伪造源码或制品归档。

日期：2026-11-12（Asia/Shanghai）。基线：`c46ea7e7526a053d43e08477b77e201d7aa50e30`。用户要求查清 0.1.9 收尾时的隔离恢复测试失败；本轮只诊断、复现和记录，未修改产品实现、测试断言、发布附件或标签。当前开放 Issues 查询为空，本次关联既有 [PR #50](https://github.com/nan023062/cbim/pull/50)，没有新建或关闭工单。

## 结论与确定性

**已自然复现同一测试的失败，定位为执行器文件短暂的 Windows 共享冲突，与一次性清理之间的时序竞争。** 宿主、隔离主进程和后代退出、Job 收束的断言已经通过；紧接着 `lockTree()` 为 `runtime/executor.exe` 申请带 DELETE 权限的句柄，返回 `ISOLATION_RECOVERY_OPEN / win32Code=32`。保持同一文件和访问参数、没有重跑业务程序时，约 **117.592 ms** 后该句柄即可成功打开并关闭。

这里的错误假设是“进程退出且 Job 已空，即可立即取得执行器文件的删除权限句柄”。进程退出与所有文件共享占用解除是两个需要分别观察的条件。`CreateFileW` 会拒绝与现有句柄共享方式冲突的请求；其共享约束持续到相关句柄关闭。见 [Microsoft CreateFileW 文档](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)。本轮没有查到短暂占用的具体系统进程，不能直接归因于杀毒软件。

历史 [CI 43110968497](https://github.com/nan023062/cbim/actions/runs/43110968497) 的首次原始错误被旧 finally 覆盖，只有“保留未完成核实的原隔离目录”留下，耗时约 1035 ms。因此，新证据确证的是**当前同一测试中可自然发生的具体失败机制**，与旧 CI 的同形失败一致；不能恢复那次 CI 已丢失的错误码或声称已取得当时的占用进程证据。

## 实际调用链

1. `tests/isolation-recovery-crash.test.ts` 启动测试宿主，由 `isolation-recovery-crash-host.ts` 调用真实 `runIsolatedNode`。隔离程序创建一个后代，并写入真实 PID 与 ready 文件。
2. 父测试终止自己的测试宿主，等待隔离主进程和后代退出；核对原宿主身份为 exited、原 Job 为 absent/empty。两次自然失败都已越过这些断言。
3. 测试直接调用 `Win32IsolationRecovery.lockTree(resource, true)`，全树锁定成功前不删除文件。`open()` 使用 `0x10081` 访问权限（包括 DELETE）、共享方式 `3`（READ/WRITE），遍历到执行器文件时出现错误 32。
4. 锁定失败会释放本次已取得的句柄，保留 owner 和原可靠记录。旧 finally 再抛“保留目录”曾掩盖原错误；0.1.9 收尾时补上的 cause 和失败 JSON 使本轮能读到真实错误。

阅读入口：[崩溃测试](../../tests/isolation-recovery-crash.test.ts)、[真实宿主](../../tests/isolation-recovery-crash-host.ts)、[Win32 恢复平台](../../src/logic/file-operations/platform/isolation/isolation-recovery-win32.ts)、[正式恢复入口](../../src/logic/file-operations/service/isolated-executions.ts)。

## 复现与反证

只运行上述一个 Windows 单元，不运行全仓测试。每次独立启动 Vitest，限制次数，首次失败即停止；全部成功、失败日志与报告分别保存，没有使用 retry 将失败改写成通过。

| 实验 | 结果 | 证据作用 |
| --- | --- | --- |
| 原样测试，Node 24.13.0，最多 30 次 | 第 4 次失败；此前 3 次通过 | 未注入文件占用，自然复现 `OPEN / 32`；失败位于 `lockTree`，进程/Job 断言已通过 |
| 测试专用路径探针，最多 30 次 | 30 次通过 | 没有复现，不当作根因已消除 |
| 同一探针，最多 70 次 | 第 62 次失败；此前 61 次通过 | 捕获实际失败路径 `runtime/executor.exe` 及同一文件随时间解除占用的过程 |
| 两个已保留现场上的真实 Win32 控制实验 | 2 个均符合预期 | 在宿主 exited、Job absent 的情况下，持不共享 DELETE 的读句柄会稳定造成相同 `OPEN / 32`；只关闭该句柄后，原树立即可锁定 |

路径探针只在本次独立 Vitest 配置中包装平台入口，给原错误补充文件路径。碰到错误 32 后，只尝试再次打开并关闭同一文件，不删除文件；之后仍重新抛出原错误，让原测试保持失败。正常成功路径确实经过探针，日志保留 `DIAGNOSTIC_OPEN_CALLS`。未改动 `src/` 或现有测试文件。

第 62 次的同文件探测：约 10.855、25.857、41.644、57.381、72.429、87.155、102.370 ms 时仍返回 32，117.592 ms 时打开并关闭成功。这里是一次观测，不能据此承诺 Windows 占用总在 118 ms 内解除。

控制实验先核原目录身份、owner、宿主与 Job；持读句柄、释放句柄前后，执行器 SHA-256 和原可靠日志完全一致，未启动任何新的隔离业务程序。完成后仅按原资源身份清理这两次实验留下的 profile、临时目录和记录目录，均成功。没有处理开发者的其它进程、用户数据或历史残留。

## 对产品的影响

- `Win32IsolationRecovery.lockTree` 严格拒绝共享冲突，保持“未核实就不删除”的边界；本轮没有发现进程逃逸、业务重放或误删证据。
- 正常执行的 `isolated-node.ts/removeOwnedRoot()` 已对同一自有目录的删除使用有界重试。
- 崩溃后的显式恢复 `IsolatedExecutions.cleanup()` 在再次核宿主/Job 后直接调用一次 `lockTree()`。遇到这个短暂占用时，会在保存 `cleanup_requested` 之前向调用方返回错误，并释放 lease，原资源和日志仍保留。因此，这不只是报表噪声：同一种时序也可能使用户立即发起的清理第一次失败。
- 原测试把低层锁定接口的一次调用当作即时清理成功的保证，没有处理此可恢复的短暂占用。旧 finally 的错误覆盖是额外的诊断缺陷，已在上一轮补齐，不等于清理时序已修复。

## 建议的修复边界（本轮未实施）

1. 在崩溃恢复清理流程中，对取得原目录树句柄时的 `ISOLATION_RECOVERY_OPEN + 32` 设置明确期限和间隔的有界重试；每次重新核原宿主/Job、目录身份与 owner，持续占用则返回可追溯失败并保留现场。
2. 重试只取得原资源句柄和完成清理，不重发模型请求或重跑原隔离程序；其它身份、路径、链接或权限错误仍立即拒绝。
3. 先取得完整目录树句柄，再记录清理意图及删除；不要把部分删除后的重试与“尚未开始删除”的重试混为一谈。清理意图已落盘的失败仍沿现有原 commandId 继续规则处理。
4. 让崩溃恢复测试验证这一正式的有界清理行为，同时保留“占用一直不释放则失败、身份改变则拒绝、原日志和业务不重放”的断言。只给测试加固定 sleep 不能表达这个完成条件。

## 命令与原始证据

证据根：`test-results/isolation-recovery-rootcause-20261112/`。

```text
python test-results/isolation-recovery-rootcause-20261112/repeat.py node 30 original-node24
python test-results/isolation-recovery-rootcause-20261112/repeat.py node 30 path-probe-node24 test-results/isolation-recovery-rootcause-20261112/vitest.probe.config.ts
python test-results/isolation-recovery-rootcause-20261112/repeat.py node 70 path-probe2-node24 test-results/isolation-recovery-rootcause-20261112/vitest.probe.config.ts
pnpm exec tsx test-results/isolation-recovery-rootcause-20261112/controlled-probe.mts
```

循环实际执行 `node node_modules/vitest/vitest.mjs run tests/isolation-recovery-crash.test.ts`，每次使用独立 JSON/日志路径；带探针的两轮另外指定上述诊断配置。

重点文件：`original-node24/004-primary-failure.json`、`path-probe2-node24/062-primary-failure.json`、各轮 `summary.json`、`controlled-sharing-probe.json`，以及可复核的 `repeat.py`、`probe.setup.ts`、`vitest.probe.config.ts`、`controlled-probe.mts`。

本轮未执行产品修复、全量回归、CI 重跑、重新打包、安装升级或发布；已有 0.1.9 制品与历史验证事实未改变。这里只交付可复现的诊断与修复范围，不声称新修复已经生效。
