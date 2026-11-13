# Step54 / R12-B1：冻结范围的成员执行验收

> 历史快照：正文中的目录、完成状态与验证数字保留记录日期的事实，不是当前实现清单。四层迁移后的现状请看 [源码契约](../../src/CONTRACT.md) 和 [Logic 边界](../../src/logic/BOUNDARIES.md)。

日期：2026-11-08。承接本地提交 e1a410c。R12 仍部分完成：本片接通正式成员的真实受限执行，孤儿来源核实与清理留给 R12-B2；R09-C 程序业务验证另行实施。

## 已实现行为

- Workflow 可显式冻结 executionScope v1 / windows-lpac-node-v1：文件和目录读写范围、Node 时间／内存／进程预算。全部模块必须共同声明，写范围须在读范围内，产物与验证路径也须被覆盖；合并范围并取最严预算，不回退无范围原生工具。声明只收窄原 read/ask/execute，不扩大旧任务权限。
- Pi 在范围模式下不注册原生 read/write/edit/bash/grep/find/ls，Runtime 再拒绝伪造 native。cbim_scoped_read 使用 Win32 锁定目录及普通文件句柄完整读取；cbim_scoped_node 复制明确允许的输入，用当前可信 Node/Electron、LPAC/Job 执行。模型不能替换执行器、环境、网络能力或预算。
- 隔离输出只返回声明的有界字节及实际哈希，不自动写回。修改已有文件使用原 cbim_file_write_controlled；删除／移动沿原冻结操作、独占句柄和可靠阶段，再核两端写范围。原授权 ID 只能消费一次，审批与停止竞争、恶意参数变更和损坏输出不能重发操作。
- 未知受控写保留原运行屏障，允许只读核实，阻断新隔离命令、写入和交付。实际退出及清理未确认时不释放运行占用；停止排空原进程树。产物采集、完整清单、JSON/CSV/PNG 检查和只读检查点复用冻结读取边界。隔离命令和受控写仍不满足原检查点恢复白名单。

## 实际验证

- 最终相关 28 文件 178/178，0 失败／跳过，259 秒。包括真实 Win32 范围读、LPAC 输入执行、Runtime 权限及未知写屏障、真实 Electron/Pi 交付，以及原文件控制、检查点、完整产物与专业文件验证回归。本片未重跑全仓；重叠批次不相加。
- pnpm typecheck、pnpm check:architecture 及脚本 tsc --noEmit 通过。51 个目录、542 份源码／样式；1057 个维护代码文件、5661 条含类型依赖、0 环，4 处第三方动态加载已审核。停止探针修正后重新通过同三项检查。
- 最终 EXE 20261108-163324 三场实际桌面验收：正常执行和逐次批准均主／成员 6/14 次请求、完成真实输出写入及共同出口；逐次批准分别针对原隔离命令和原受控写的当前审批 ID。审批来自自动化测试操作者，不是实际维护者的认知验收。
- 停止场主／成员 3/5 次请求；观察到 LPAC 主进程 67188 及后代 47852 存活后点击真实停止按钮，随后两者消失、原私有执行目录删除、任务及周期 cancelled，原业务文件未写入且无交付候选。
- 三场均核实范围外读／写及伪造原生调用无 allowed 回执；原 private.txt、普通草稿保留；重开 canonical 字节及请求数不变，页面错误 0。成功场景自有临时目录已清理，用户原 CBIM 进程未操作。生成 6 张最终截图，目检 4 张；正常 finished 图仍处于一次界面轮询过渡，reopened 图明确显示目标完成。
- 模型来源为本机确定性 SSE 服务，执行、授权、实际文件、LPAC 与 Pi 均为产品真实链路；不能据此推断在线模型自主质量或专业业务正确性。

## 原失败与修正

首次真实 Pi 失败源于开发版 Electron 被误当成打包环境查找 koffi；改为按 defaultApp 区分真实打包资源与开发依赖，第二次 Pi 及最终回归通过。失败报告和现场保留，当时尚未发生受控写。初始类型错误及审批选项名称也在最终回归前修正。
首次 EXE 停止测试把 Playwright 的 Windows 启动器 PID 当作 Electron 主进程 PID，漏掉了实际存活的 LPAC 进程；命令最终按 30 秒期限 timed_out，原进程树清理完成，测试夹具随后错误进入正常完成分支而失败。独立诊断明确观察到两个不同 PID。修正仅涉及冒烟脚本：从 Electron 主进程读取 process.pid，并给复测报告独立前缀。同一 EXE 停止复测通过；原失败、诊断及原成功报告保留。没有为这个测试问题修改产品或重复构建。

## 指纹及产物

- 产品源码／构建配置 552 项：3272f140f23be8e13c5559e5f43392068f48fd124b17d1617de9c7a218a9541b
- 内置资料 21 项：84fb0ed1395663aac19775275bdac83c1c1249e9e5582c4becc66258b79d1783
- 回归、构建、正常与逐次批准时的测试／脚本 549 项：7235fda527ffe9e4620ae02a490be1e6118e433491ded8d6f2b9d9d5ffed2279
- 停止脚本修正后的测试／脚本 549 项：349eb70f134b24f37bdbd99d044438c796b35fc104a133432d8d213d673ae1be
- 所有最终检查、178 项回归、构建及三场 EXE 的产品与内置指纹一致。停止复测及最后检查使用修正后的测试脚本指纹；不把这两棵测试树写成完全相同，也未重跑已通过且未受脚本修正影响的产品回归。
- CBIM.exe：213976576 bytes，SHA-256 d8a422bf2d3fd093e367640b511ff29cd6a83db97e3be5df785ef86fe061ed45
- app.asar：3319013 bytes，SHA-256 5b7c8458a58a39adddd1b1609ff3ad716273785bec3af8271e29e79631fc90dd
- CBIM-Assistant-20261108-163324-win32-x64-0.1.0.zip：180440561 bytes，SHA-256 b38f0f05fd5500f3e6a4e6399b116f18fdea17d64636f10a2887bf702601ec14

证据：test-results/scoped-final-targeted.json、scoped-final-checks-final-receipt.json、scoped-postprobe-checks-final-receipt.json、scoped-final-make-receipt.json、scoped-complete-desktop.json、scoped-ask-desktop.json、scoped-stop-retry-desktop.json、各场 receipt 及 scoped-artifacts.json。初次停止失败见 scoped-stop-failure.json／scoped-final-ui-stop-receipt.json；初始 Pi 失败见 scoped-pi-first.json。

## 维护与限制

已同步 4 个新源码和 20 个已有源码的中文定位／接口／关键边界说明；brain、brain/pi、policy、tasks、tools、workspace、main、main/platform、scheduler-engine/execution 共 9 份 CONTRACT，以及上述目录和 core 父层共 10 份 ARCHITECTURE。依赖仍由 main 注入平台端口，core 不导入 Win32；生成器只更新实际职责说明。

支持 Windows x64 的本地普通文件。只读正文限完整 UTF-8 1 MiB，输入快照最多 64 文件／总 8 MiB；既有受控写只修改已存在文件。本片没有任意 shell、新文件通用创建、其它语言执行器、网络程序或其它 OS 的隔离保证。固定 registryRead 和 Windows 授予 LPAC 的系统资源仍存在；输出收集大小检查不是磁盘硬配额。冻结路径权限不等于冻结实时内容，每次调用保存实际字节和哈希。
宿主崩溃的 Job 收束已有 Step53 证据，但残留资源不能只凭临时 owner.json 或 PID 自动清理；R12-B2 需要可信持久来源、原执行身份和显式清理。命令退出零不是专业验证通过，R09-C 随后实施。见[本片计划](../task/scoped-member-execution.md)、[R12 矩阵](../task/execution-isolation-support.md)和[剩余交付](../task/remaining-deliveries.md)。第 1–8 组继续，第 9 组只保留计划；独立本地提交，不推送。
