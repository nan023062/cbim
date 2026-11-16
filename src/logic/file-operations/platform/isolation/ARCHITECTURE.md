# src/logic/file-operations/platform/isolation 架构

## 设计意图

隔离进程、冻结输入、Win32 Job 与 LPAC 恢复；核实原进程与日志，不重建未知执行。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [Win32IsolatedNode](isolated-node-win32.ts) | 以 Win32 LPAC Token、显式 ACL 和 Job Object 启动并收束真实程序，属于 Main 平台边界。 |
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
