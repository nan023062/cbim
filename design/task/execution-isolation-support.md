# R12：执行隔离支持与验收矩阵

日期：2026-11-08。实时状态见[roadmap](../tool-architecture-roadmap.md)。本包同时要求细粒度授权和真实平台隔离，不能把路径检查、独立进程或一个窄分支当作整包完成。

| 对象 | 当前事实 | 本轮交付与验收 |
| --- | --- | --- |
| 原生文件／命令 | 原任务 read/ask/execute 和知识路径保护；没有 OS 沙箱 | 显式冻结文件／目录读写范围；不扩大旧任务权限；越界和别名实际访问被拒绝 |
| 隔离程序执行 | Step53已完成，130/130及最终EXE六场/便携启动通过，见[报告](../verification/execution-isolation-platform-20261108.md) | Windows x64 平台先实现独立 AppContainer／Job，固定可信执行器、私有输入快照和暂存输出；实际测试外部文件读写、输入改写、网络、后代进程、超时和停止 |
| 网络与凭证 | 原模型网络、链接器授权分别管理 | 隔离程序不继承凭证和任意环境变量，不授予网络 capability；可信模型请求在宿主执行；资源授权与 R13 衔接 |
| 生命周期 | Step53平台Job创建即绑定，停止／超时／宿主退出收束已验；任务级孤儿核实待接 | 未核实终止不交付成功，不自动重放；持久核实和清理须沿原身份 |
| 资源限制 | Step53已核真实进程／提交内存额度、CPU和宿主期限及有界输出；任务冻结待接 | 明确区分真实内核限制、宿主期限与事后大小检查，不承诺磁盘硬配额 |
| 非 Windows 平台／不支持环境 | 无本片实际证据 | 返回明确不支持，不回退为普通 shell；其它平台单独验收 |

## 切片与依赖

1. **Step53 / R12-A（已完成）：平台执行器。** 按官方机制创建临时唯一 LPAC；本机 Node 的 Winsock 初始化需要固定 `registryRead`，零能力探针以 WSAStartup 10107 失败，因此明确保留这项只读系统资源能力，仍不授予任何网络 capability。只给自有暂存文件赋权，不改原工程或用户目录 ACL。冻结真实执行器与参数，运行前验证进程 Token 和 Job，实际越界探针及打包 EXE 证明平台边界。资源清理失败必须保留可查状态，不报告完全成功。
2. **R12-B：运行授权与装配。** 将已验证执行器接入冻结的任务范围和可信授权；拒绝缺能力、过期授权和通过原生 shell 绕行。不把 Step53 平台端口误报为模型工具已隔离。
3. **R09-C：程序验证。** 指定测试／构建能力绑定同一输入、执行器、实际退出和结果；失败、停止、环境不支持均不能满足出口。

## Step53 验收

- 真实普通进程可读写的自有哨兵，在隔离进程中被 OS 拒绝；允许快照读取和暂存输出确实可用，不能只验证“所有访问均失败”。
- 原始业务路径、只读快照、越界链接、外部网络／本机监听、环境变量和启动句柄分别测试；仅受支持平台可返回可用。
- 后代持续运行、主动超时、取消及宿主退出后核实实际进程消失；拒绝未受 Job 管理的启动。
- 类型、依赖、架构和相关回归通过；真实打包的 Windows EXE 调用同一平台实现。中文注释、CONTRACT 和架构类图同步。
- R12 保持部分完成，直到细粒度授权与实际执行链共同验收；本片不宣称任意系统工具、完整 Windows 资源或其它平台已覆盖。

官方依据：[AppContainer 启动及 LPAC](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)、[Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)、[进程创建属性](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)。Step53实际结果见[验收报告](../verification/execution-isolation-platform-20261108.md)；R12-B/R09-C仍为后续验收目标。
