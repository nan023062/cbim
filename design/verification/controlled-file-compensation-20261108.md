# Step37 受控文件写入与显式补偿验证

日期：2026-11-08。承接 `5ccae12`，对应 R03-C。状态：类型、架构、最终冻结全仓及同一 EXE 两场桌面验收通过；本报告仅完成 R03-C，不代表整包 R03 完成。

## 本片行为与边界

正式成员新增 `cbim_file_write_controlled`：真实授权、原运行和岗位绑定保持不变，主 Agent 不获得业务写工具。工具只替换已有普通本地 Windows NTFS 单链接 UTF-8 文件，正文不超过 1 MiB；不支持新建、删除、移动、目录、二进制、链接或受管知识路径。

原操作在唯一 DispatchStore 内单条追加 prepared、executing 和终态。真实句柄读取的 before/intended-after 保存在私有有界 blob；公共接口只返回身份及字节摘要。专用 Electron utility 持有句柄，Main 不同步执行 Win32 写入。部分写入、无法核实退出或终态保存失败不能当作未执行，不能自动回滚或重放。

受控写失败后整轮保留待核实屏障，新调用 ID 的受控写、native write/edit/bash、交付、采集及检查点均被拒绝；读取、计划查询与记录求助仍可用。最终运行封存为 interrupted，不生成业务候选或可消费帮助。只有可信原授权对应的 not_applied 和真实进程退出可解除屏障；错误码、查无记录、当前字节相同及 applied 后坏回包均不构成未写证明。原工具 failed 与实际账本 applied/unknown 分开保留。

桌面从成员原调用明确查询、预览和提交补偿。补偿必须绑定原可靠 applied、关闭的原周期、相同文件身份和原写后字节；恢复正文只取真实 before。补偿有独立命令和阶段，原工具结果、原操作及业务验收保持原事实。未知请求只查原命令；挂载、重开和轮询不自动发起文件操作。首次提交仅两个明确受理前拒绝码允许重新预览，查询错误不解除未知锁。

## 已执行的定向验证

以下报告位于 ignored `test-results/`，相互有重叠，不累计为独立用例总数。

| 范围 | 结果与限制 | 证据 |
| --- | --- | --- |
| Core/Store | 5 文件 43/43，含旧 Store、原回执及岗位兼容 | `controlled-file-core-store-final.json` |
| 前端本机状态 | 13/13；固定请求先保存、双击、丢回复、原回执单调、过期预览及损坏索引 | `controlled-file-ui-final.json` |
| 实际 Electron/Pi 正常链 | 指定单场通过，主 6 / 成员 11 次本机 HTTP；受控写后真实读取、采集及 JSON 验证，独立补偿恢复原 46 字节 CRLF 文件 | `controlled-file-pi-probe-second.json`、`controlled-file-complete-pi-evidence.json` |
| 实际部分写与坏工具回复 | 指定 2 场通过，各主 6 / 成员 5；readonly mapping 真实造成前缀已写而截短失败；另一场实际 applied 后破坏一次工具回复，保留应用事实 | `controlled-file-pi-fault-initial.json` |
| 实际停止 | 指定单场通过，主 3 / 成员 4；executing 保存后、apply 前停止，child 退出、文件不变、not_applied，无迟到写入 | `controlled-file-pi-stop-initial.json` |

Pi 分场中未被选择的用例不是通过项。重开与查询未增加模型或 worker；原 canonical/native 字节核对及实际 before/intended blob 证据另存对应原始字节目录。确定性本机供应商验证真实工具链，不代表在线模型自主判断或计费质量。

## 最终修复后的独立验证

- `pnpm typecheck` 通过；`pnpm check:architecture` 通过：51 个目录、488 个代码/样式文件，911 个维护文件、4787 条含类型依赖、0 环；13 项边界检查通过（`controlled-file-boundaries-final-fixed.json`）。
- Runtime/服务/UI 共 3 文件 42/42，通过未知屏障、新 ID 绕行、可信未写证明、错误身份、查询失败保留明确拒绝、持久重开等边界（`controlled-file-latch-unit-final.json`）。
- 两场真实 Pi 对抗分支通过，各主/成员请求 6/13：真实 readonly mapping 部分写、实际 applied 后破坏 wire。使用失败后实际读到的字节作为新 CAS 依据，分别尝试受控写、native write/edit/bash 及当前版本交付，均明确被屏障拒绝；只有一次平台 apply，原文件/备份/账本保留，求助仅暂存，最终 interrupted。`controlled-file-adversarial-pi-initial.json` 的另 4 场未选择，不计通过；最终全仓另覆盖全部 6 场。
- 最终构建 `20261108-054047` 的 EXE/ZIP 成功；494 项源码/构建配置 SHA-256 在构建前后均为 `6b86ad51afabb0c77cf63380de01f9828261b1e8e7793349cb335c4234177a60`。冻结源码全仓 289 文件、1915/1915 通过，无失败或跳过，耗时 1254 秒；494 项源码/构建配置指纹在全仓前后及最终构建一致。
- 同一最终 EXE 的正常与真实部分写两场通过，主/成员/独立会话请求分别 6/11/1、6/5/1。正常场原写一次、明确补偿一次；补偿已 applied 后仅测试 IPC 丢回复，原命令查询不新建 worker 或追加 journal。部分写场只有一次 apply，保留未知且无补偿按钮。原图、周期、审阅及 canonical/native 字节保持；重开零模型/文件重放，两主会话草稿保持，页面/通信错误均 0。报告：`controlled-file-complete-ui-smoke.json`、`controlled-file-partial-ui-smoke.json`。
- 生成 12 张桌面截图，已目检预览、丢回复、原回执查询、部分写未知和两场重开等 6 张关键截图。成功场测试进程、mapping、供应商及自有临时目录均关闭/清理，失败现场保留。

## 已发现并修正的问题

- 审查补齐 Runtime 固定 scopeId 与派生 operationId 的回包核验，不能仅凭同一成员 binding 接受另一个操作。
- 首轮 Runtime/服务测试夹具缺少 TaskSpec.moduleIds，按实际正式成员协议补齐；没有放宽产品绑定条件。
- AbortError.code 可能是数字，直接写入严格事件曾阻止 not_applied 保存；现只接受安全字符串错误码，其余使用固定安全码。
- 前端历史摘要与完整补偿回执增加身份及单调核验；畸形 receipt 字段不再当成缺省，未知后的查询失败不能解除请求锁。
- 首轮 Electron 测试宿主 Windows stdin 提前关闭发生在模型请求前；改用测试宿主 loopback 控制。初次失败报告保留，未替换为成功证据。
- 旧包 `20261108-051224` 将 child cwd 设到 app.asar 的虚拟目录，无法启动；原文件未改。改为 original-fs 核实的 EXE 实际目录后，最终包通过真实写入和补偿。
- 旧全仓启动留下空日志，恢复时进程已退出且没有完成回执，不能判断通过；保留该日志，最终冻结回归使用独立 `controlled-file-full-final` 文件。
- 屏障单元夹具最初传空 acceptance，未进入受控写即被严格计划协议拒绝；补齐真实验收项后 42 项通过，没有放宽产品 Schema。
- 最终包首轮桌面脚本将探针函数当字符串求值却未调用，在真实写入成功后断言失败；修正测试探针并核安装成功，同一 EXE 重新通过。脚本独立 TypeScript 检查通过，应用源码和构建指纹未改变。

## 最终验收与后续

冻结源码全仓 289 文件、1915/1915 通过，无失败或跳过，耗时 1254 秒；494 项源码/构建配置指纹在全仓前后及最终构建一致。证据：`controlled-file-full-final.json` 和 `controlled-file-full-final-receipt.json`；最终源码 SHA-256 为 `6b86ad51afabb0c77cf63380de01f9828261b1e8e7793349cb335c4234177a60`。定向、分场 Pi 与全仓有重叠，不相加为独立测试总数。

最终产物：`build/20261108-054047/CBIM Assistant-win32-x64/CBIM.exe`；便携包：`build/20261108-054047/make/zip/win32/x64/CBIM-Assistant-20261108-054047-win32-x64-0.1.0.zip`。产物 SHA-256 见 `test-results/controlled-file-final-artifacts.json`。相关中文注释、13 份 CONTRACT 与 19 份目录类图已同步。

R03 后续仍需将既有知识、治理、负责人等持久操作接入统一原调用核实及处置关联。文件新增/删除/移动、二进制及跨平台，任意 shell、真实外部写、通用成员恢复和请求预算按相关交付包继续验收；本片不把它们移到第 9 组，也不伪造原 native 操作的 before。第 9 组只保留计划。
