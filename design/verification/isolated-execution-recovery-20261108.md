# Step55：原隔离执行核实与清理验收

日期：2026-11-08。对应 R12-B2，承接本地提交 fada1b6。[实施计划](../task/isolated-execution-recovery.md)／[支持矩阵](../task/execution-isolation-support.md)。用户要求本步骤完成后结束本轮开发；本报告不代表剩余交付包全部完成。

## 实际行为

正式冻结范围成员在创建 profile 前可靠保存原授权、完整 run/scope/input 身份、宿主 FILETIME/会话及目录 volume/fileId；真实子进程保持挂起，started 记录可靠保存后才运行。命名 Job 重名拒绝，原宿主存活时不打开观察句柄，以免影响 KILL_ON_JOB_CLOSE。PID 复用核创建时间，不按 PID 终止其他进程。

桌面只在明确点击后核实。清理重核原 canonical proposed/allowed、当前工作区实例、报告版本、原宿主退出、Job 无活动进程和原目录身份。先固定全部原对象句柄，再记录 cleanup_requested，随后回收 profile/目录，最后记录 cleanup_complete；未知回复先核实，只有原 commandId/basis 可继续。原 failed/interrupted、业务文件和原日志不改写，不恢复脚本。

本轮物理收尾未知后仅保留范围读取，后续写入、命令和交付被阻断。Runtime、成员与 Application 关闭链识别 EXECUTION_SCOPE_DRAIN_PENDING，保留原占用；再次关闭只收尾原资源。

## 验证结果

- 最终冻结相关 **33 文件、203/203，0 失败、0 跳过，284 秒**。包含真实 Win32 创建身份、目录句柄删除、硬链接/junction/owner/目录替换拒绝、旧实例/版本/跨 run 拒绝、坏日志保留、原清理未知续接、真实宿主崩溃、实际 Electron/Pi、受控文件、Workflow、产物和检查点回归。本片未重跑全仓。
- 源码及脚本类型 --noEmit、架构、依赖与层级检查通过。51 目录、549 代码/样式文件；1071 维护文件、5722 条含类型依赖、0 环、5 处固定第三方动态加载审核。更新 10 组 CONTRACT/ARCHITECTURE 与相关中文文件头、接口及生命周期说明。
- EXE **20261108-172018** 正常场：主/成员请求 6/14，实际隔离输出、受控写和目标完成均通过，重开不重放，页面错误 0。
- 同 EXE 崩溃场：主/成员请求 3/5；实际宿主 52248、LPAC 主程序 84172 与后代 47056。只强制终止测试宿主，原 Job 收束进程树。重开保留 interrupted 和草稿；owner 改变时拒绝，恢复原字节后可核实。旧实例请求拒绝；界面一次清理后主动丢掉成功 IPC 回复，按钮保持禁用，显式核实显示 cleaned；同原命令再次查询返回原回执，不追加第二份清理。原业务/native/canonical 日志及派发状态逐字节保持，只有隔离账本追加原命令的两帧；再重开全部日志不变，无新模型请求，页面错误 0。
- 最终 8 张截图生成（正常 2、崩溃场 6），目检 3 张：可清理、回包未知及重开已清理。成功测试自己的临时工作区/进程已清理，原用户 CBIM PID 71020 保留。

测试模型响应来自本机确定性服务，执行的是实际 Pi/Electron/Win32；不是在线自主业务质量或真人认知验收。

## 原失败与修正

开发期记录断言把同步 Schema 拒绝当异步异常、崩溃子夹具误引 Vitest，以及关闭后的测试仍调用已关闭服务查询均已修正；类型检查补明确的最小夹具断言。原失败报告保留，最终 203 项已包含对应回归。

两次标准 Forge make 因 HTTP 504 失败，未当作成品。已安装官方 Electron 40.10.6 的 checksums.json 与缓存 ZIP 同为 072480360a5d5e3ec0d4173b1f9d7d0bca435098567d7e6bb5829638072febfd；构建进程向原 @electron/get 提供该校验表，仍执行 SHA-256 核对后打包。没有关闭校验、改产品配置或替换依赖版本。成功命令及仅构建辅助脚本保留在本机证据中。

首轮新 EXE 清理实际成功，但验收脚本把新隔离清理账本也纳入“全部日志不变”，因此失败。修正脚本为逐一断言：只有原隔离账本新增唯一命令的两帧，全部原业务日志不变；同一 EXE 复测通过，并再次通过脚本类型检查。产品源码未改，未重跑已经通过的 203 项；旧失败现场和截图保留。

## 冻结身份与成品

- 产品源码/配置 559 项：`18434d6a9f1c82d6798f7471ef611a4e7b5657f3ab2ae7eb49d94ab27adb0c67`。
- 内置运行资产 21 项：`84fb0ed1395663aac19775275bdac83c1c1249e9e5582c4becc66258b79d1783`。
- 检查、相关回归、构建与首次 EXE 的测试/脚本 556 项：`c3bbf050d30021b170f3a602e1606865cdf343f87b24c24d6c354ddb28840d6f`。
- 上述断言修正后测试/脚本：`67d7edf8abef393e45312d3f7fd43843c9533e5fb7094f48ce3e0ab90387de10`。产品与内置资产全程一致。

| 成品 | 字节 | SHA-256 |
| --- | ---: | --- |
| CBIM.exe | 213976576 | `91279c1680f0f8c48ea07007912c494910285a79d7ab23cb14c6d3600c0229cc` |
| resources/app.asar | 3351866 | `339c3f9e094458aff3ded7706aee8b373f10e8c2f747f8af38ae558a9970766e` |
| CBIM-Assistant-20261108-172018-win32-x64-0.1.0.zip | 180457754 | `6379295fd9efe6011fc6b91c65e71fab12f65013c54d67ca21b48860eb4b9178` |

目录：`build/20261108-172018/CBIM Assistant-win32-x64`；便携 ZIP：`build/20261108-172018/make/zip/win32/x64/CBIM-Assistant-20261108-172018-win32-x64-0.1.0.zip`。

本机证据：`test-results/isolation-recovery-final-*-receipt.json`、`isolation-recovery-final-targeted.json`、`isolation-recovery-retry-desktop.json`、`scoped-isolation-recovery-complete-desktop.json`、`isolation-recovery-artifacts.json`、`isolation-recovery-final-state.json`。构建辅助为 `step55-electron-checksums.cjs`，原失败为 `isolation-recovery-failure.json` 及初轮/关闭链报告；这些本机过程文件不混入业务提交。

## 支持边界与结束

限 Windows x64、当前 Windows 登录会话、当前本地用户可信私有记录与本产品的新协议执行。目录最多 4096 对象/64 层；记录每调用 256 KiB/32 帧、每 run 256 调用。原目录/owner/来源不可信、记录损坏、不同登录会话、旧无记录临时资源保持不可核实；不猜测归属、不按 PID 杀进程、不自动补造旧记录。同用户恶意重写整个私有数据库不在本信任边界内。

R12 的 Windows 冻结范围执行与本次生命周期片已完成；其它平台、通用资源授权与 R13 衔接仍不扩称已完成。R09-C 及其它未完成项保留计划。同步 [roadmap](../tool-architecture-roadmap.md) 与 [开发记录](../development-log.md)，独立本地提交，不推送；按用户最新要求，本轮开发至此结束。

原生依据：[Job 生命周期](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)、[进程退出语义](https://learn.microsoft.com/en-us/windows/win32/procthread/terminating-a-process)、[GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)、[DeleteAppContainerProfile](https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-deleteappcontainerprofile)。
