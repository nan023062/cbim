# B（0.1.11）与不改公开通道的 A → B 测试

2026-11-12，用户要求制作 B，并说明如何在不改公开通道的前提下测试 A → B。本轮交付 B 原始安装包和外部本地测试工具；不发布 A/B、不修改 GitHub Release、不推送提交，不改 hosts、代理、证书或产品的更新源。

## 交付与验证结果

- [B 安装包](../../build/update-experience/B-0.1.11/CBIM-Setup-0.1.11-x64.exe)：Windows x64，未签名，391,409,091 字节（约 373.28 MiB）。SHA-256：`9a964f14d7d27174bef6463a726257b57222b64500a4990e694fe46c40a4c535`。
- [完整测试目录](../../build/update-experience/) 内有 `A-0.1.10/`、`B-0.1.11/`、`local-test-tools/` 和 `README-本地更新测试.md`。A/B 各包含安装包、blockmap、latest.yml、SHA256SUMS.txt、构建回执；工具自带依赖，使用 A 自带 Node，不要求测试机安装 Node、pnpm 或源码工程。
- B 冻结提交 `3197b0e6978d1b005bd963ad1bdc0eb7e059b122`，本地分支 `test/update-b-0.1.11-20261112`，工作树 `build/b11/`。相对 A 的 `09b63afb` **只改版本号和新增 B 日志**，产品源码、依赖和公开通道不变。
- `pnpm make:desktop --unsigned` 与 `pnpm verify:desktop <本次候选> --unsigned` 均通过；47 个 Windows PE 载荷摘要入册。B 的确切打包 EXE 通过 6 项隔离测试，自有资源已回收。交付副本 5 文件与原候选摘要一致。
- 新工具的本地 HTTP + Electron 网络层 + 锁定的真实 `electron-updater@6.8.11` 联调通过：用真实 A/B 安装包，8 个 206 Range 请求传输 **1,723,719 字节（约 1.64 MiB）**，没有回退全量；重建结果 SHA-256 与 B 完全一致，同时下载器 SHA-512 校验通过。另传输新旧 blockmap、清单和本地发布列表；上述数字仅计安装包数据。
- B 整包 391,409,091 字节，本次差分数据约为整包 0.44%。这只代表本次“改版本号和日志”的包对，不保证业务迭代或依赖升级也有同样比例。
- 工具拒绝把未安装的打包目录作为人工安装测试入口；默认安装拦截通过虚构安装器路径的 spawn 探针验证，在启动子进程前拒绝。便携工具通过 A 自带 Node 加载、帮助及批处理参数验证。`node --check` 通过；新脚本导入关系执行 `pnpm check:dependencies`，1300 文件/6685 依赖，0 循环/违规。

**已验证的是 B 制品、实际安装包差分重建和本地网络转接；尚未在独立 Windows 机器执行 NSIS 安装及安装版 UI 全流程。** 下载联调没有伪造卸载器标记、启用未安装主程序的更新状态机或执行安装器。此前同产品源码的 41 项单元、22 项界面、类型/架构检查和 A 品牌/官网本地构建证据可以复用；本轮未重跑全仓测试、完整 CI，也未声称公开网络分发已验收。

## 原理与测试边界

原 A 只认固定公开 GitHub 地址；它没有本地 feed 开关，而且下载适配器会显式指定地址，所以只改 `app-update.yml` 无法完成此测试。

本工具在你用它启动的 **A 测试进程** 中，通过外部 Electron 调试会话替换两个网络调用边界：Node `fetch` 的 Release 列表、Electron `net.request` 的安装附件。逻辑地址仍是原地址，实际字节由 `127.0.0.1` 上的服务提供。服务只暴露本次校验过的 A/B 附件，支持单 Range，并记录响应字节。所有其他用户和公开通道不受影响。

版本筛选、后台预下载、差分算法、缓存、完整包校验、UI 状态、关闭业务和 NSIS 安装仍由 A 原程序执行。工具不注入 ready 状态、不调用更新 IPC 触发安装，不改 A/B 文件。它默认阻止安装器进程；只有命令明确带安装选项时，才允许用户在 A 界面点击安装。

测试替换了网络响应，不能证明真实 GitHub 的发现、重定向、限流、Range/CDN 或用户带宽表现。公开分发需以后另行验收。NSIS 解压、写盘和安装方式没有优化。

## 在独立 Windows 测试机执行

使用没有 CBIM 用户安装的虚拟机或独立 Windows x64 测试机，先留快照。不要在日常开发/使用的 CBIM 上试；另选安装目录并不能隔离 NSIS 的注册表升级行为。

1. 把整个 `build/update-experience/` 复制到测试机，例如 `C:\CBIM-Update-Test\`。保留三个子目录及其中的全部文件。
2. 运行 `A-0.1.10\CBIM-Setup-0.1.10-x64.exe` 正常安装 A，记下所选安装目录内的 `CBIM Desktop.exe` 路径。若 Windows 提示未知发布者，按组织许可处理，不关闭系统保护。
3. 退出所有 CBIM 窗口。在 `C:\CBIM-Update-Test\` 打开终端，执行下面的命令，把示例路径换成实际安装的 A 主程序路径：

```powershell
.\local-test-tools\Start-Local-Update-Test.cmd "C:\实际安装目录\CBIM Desktop.exe" --allow-install-on-isolated-machine
```

本命令不安装 A，也不自动点击安装；它启动已安装的 A、提供本地 B 响应。第一次会创建 `test-user/` 专用测试数据目录，每次另建 `reports/run-*/`。A 的主程序/内置资源及缓存、A/B 附件会先校验。**启动后看到空的新用户资料是正常的**，不会加载原来的日常数据；在此资料下建立要验证保留的测试内容。

若只想先观察下载、不允许安装，省略最后的 `--allow-install-on-isolated-machine`。此时不要点击重启安装；测试工具会阻止启动安装器。测试完整流程时，普通退出 A 后用带该选项的相同命令重新启动。

## 人工验收顺序

1. **后台预下载：** 在 A 建一个测试工作区，保存一个可识别文件/记录，记下设置；也可在当前页面留下未提交编辑。约 10 秒后的自动检查或下一分钟检查应发现 0.1.11，不用点下载。打开“用户菜单 → 版本与更新”，应看到后台下载或已经就绪。
2. **继续工作：** 下载时关闭弹窗，确认当前页面和任务不因下载退出。下载完成后留在 A，按钮为“重启安装”，没有自动重启。
3. **普通退出和缓存：** 保存编辑，正常退出 A；启动器会结束并写报告。用第 3 步的同一命令再次启动，确认仍为 0.1.10。缓存重验后再次就绪，第二份报告不应新增完整 B 安装包传输。
4. **实际安装：** 保存未提交编辑，点击“重启安装”。应先正常关闭业务，再执行 NSIS 并自动重启为 **0.1.11**。在新进程检查版本、测试工作区、文件、设置和历史。安装器会显式传回同一测试资料目录；只有 B 的真实版本和数据检查通过才算安装完成。
5. **记录结果：** 分别记录“发现 B → 已就绪”和“点击重启 → B 可用”的耗时。启动器只保存最后观测状态及请求，不把 A 退出当成安装成功；把 B 界面版本和数据核对结果另行记入验收报告。

A 成功升级后不再用启动器启动它（工具会因 A 的校验不匹配而拒绝）。如需重测，恢复测试机 A 快照；不要通过覆盖同版本附件或降级真实用户安装来准备环境。

若之后需要手动重开 B 查看这次测试资料，可在单独 PowerShell 窗口中设置当前进程的目录再运行 B：

```powershell
$env:CBIM_USER_DATA_ROOT = (Resolve-Path .\test-user).Path
& "C:\实际安装目录\CBIM Desktop.exe"
```

关闭该 PowerShell 窗口即结束这次环境设置；直接用普通快捷方式启动可能打开默认资料，不要误判为升级丢数据。

## 如何读报告与回退测试

每次启动的 `reports/run-*/report.json` 包含 `payload` 和原始 `requests`：

- `ranges > 0`、请求状态 206、`fullDownloads = 0`、`allResponsesComplete = true`，再结合 A 显示已校验就绪，才支持本轮差分成功的结论。
- `transferredBytes` 只计 B 安装包字节；索引与清单在原始请求中另列。最终缓存是完整 EXE，不能用缓存大小判断差分。
- 普通退出后再启动，缓存命中时安装包请求可为零，此时 `ranges = 0` 不代表差分失败。
- 若出现完整下载，应结合缓存/索引和错误分析；完整下载后校验、安装成功属于有效回退。完整 B 包在 `%LOCALAPPDATA%\cbim-desktop-updater\pending\`，不得在下载中替换它。

首次安装 A 后，缓存 `installer.exe` 应与本次 A 一致；工具会拒绝不属于 A/B 的旧缓存。本地服务直接提供 A 的准确旧 blockmap，**不需要把 A 发布到 GitHub**。缺缓存/坏 blockmap/不支持 Range 的确定性回退已有源码 HTTP 用例；人工故障测试用另一份虚拟机快照，本工具不清理或破坏缓存来制造故障。

若只想测覆盖安装，可关闭 A 后手动运行 B 安装包；这不需要测试工具或发布，但覆盖不到后台预下载、差分和应用内显式安装授权。

## 维护者证据与命令

原始候选：`build/b11/build/desktop-release/0.1.11/unsigned-20261112-112443-5df048cc/`。证据目录：`test-results/update-b-0111-20261112/`，包含构建、校验、隔离 EXE 六项报告、复制摘要、依赖检查和便携工具加载日志。

真实字节联调命令（`<A 主程序>` 明确来自 A 回执的 `packagedDirectory`，此命令不安装）：

```powershell
node scripts/desktop-local-update-smoke.mjs --a build/update-experience/A-0.1.10 --b build/update-experience/B-0.1.11 --exe "<A 主程序>" --report "<新的证据目录>"
```

成功证据为 `local-transport-smoke-2/report.json`。第一次 `local-transport-smoke-1` 因测试 AppAdapter 没有初始化 HTTP executor 而失败，已保留；补齐真实 ElectronHttpExecutor 后成功。不是制品故障，也没有绕过校验或修改包。

外部工具入口：`scripts/desktop-local-update-test.mjs`；网络白名单/文件/摘要与进程注入：`scripts/desktop-local-update-fixture.mjs`；无安装联调：`scripts/desktop-local-update-smoke.mjs`；便携打包：`scripts/package-local-update-test-tools.mjs` 和 `packaging/updater/Start-Local-Update-Test.cmd`。工具未进入 A/B 产品源码或安装包。
