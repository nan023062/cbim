# src/logic/file-operations/platform/isolation 架构

## 设计意图

把冻结程序输入接到 Win32 隔离进程，并保存可用于退出后核实与清理的真实资源身份。

`Win32IsolatedNode` 创建 LPAC、ACL 和 Job，`FileIsolationRecords` 保存启动与清理阶段，`Win32IsolationRecovery` 核实原宿主和资源后回收。恢复只处理已记录资源，不重建未知执行，也不将关闭请求当作进程已退出。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [Win32IsolatedNode](isolated-node-win32.ts) | 持有 Win32 LPAC、ACL 与 Job Object，启动并收束一次隔离程序执行。 |
| [FileIsolationRecords](isolation-records.ts) | 原隔离执行的私有追加记录，保存启动前来源与资源清理阶段。 |
| [Win32IsolationRecovery](isolation-recovery-win32.ts) | 核实原宿主创建身份、命名 Job 和自有目录，并以固定 Win32 句柄回收残留。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_8fd422b4acdb["FileIsolationRecords"]
click N_8fd422b4acdb href "isolation-records.ts"
class N_1bc1abd94eac["Win32IsolatedNode"]
click N_1bc1abd94eac href "isolated-node-win32.ts"
class N_24736779517f["Win32IsolationRecovery"]
click N_24736779517f href "isolation-recovery-win32.ts"
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
