# 后台预下载与增量下载：验证与测试方法

> 2026-11-12 后续正式安装实测：A/B 的 NSIS 缓存目录与应用配置不一致，默认安装状态下会全量回退；下文基于手动准备缓存的下载器结果不能代替安装版差分验收。参见 [实际发布与失败结果](desktop-release-0.1.11-20261112.md) 和 [缓存调查](desktop-update-cache-diagnosis-20261112.md)。0.1.12 修复候选尚未公开。

日期：2026-11-12。范围是用户明确要求的两项更新优化，未拆分引擎、改更新源或替换 NSIS 安装方式。下文记录源码交付及复验时的结果；后续已按用户要求生成本地版本 A（0.1.10），安装包、打包验证与具体 A → B 步骤见[版本 A 测试说明](desktop-update-a-0.1.10-20261112.md)。尚未合并或发布新版本，现有已安装客户端不会因此立即改变。

## 已实现的行为

- 正式安装版启动约 10 秒后检查，随后每分钟检查。发现更高桌面正式版后自动预下载并校验；下载完成显示“重启安装”，应用和任务继续运行。
- 下载或校验失败后五分钟再尝试，可立即手动“重试下载”。后台和手动下载都不授权安装；只有明确点击“重启安装”才停止任务、排空业务并启动原安装器。
- 普通关闭、退出、下载迟到回包都不触发安装；再次启动后核对公开版本及缓存，完整有效缓存可复用。已就绪候选在本进程保持固定，不被后台替换。
- 下载器优先读取新旧 blockmap，复用缓存旧安装器的数据，只下载变化区段。使用单段 Range；缺缓存、缺索引、服务器不支持或差分重建失败时回退全量，仍校验完整包 SHA-512。全量校验失败不能进入安装。

## 现在可直接运行的验证

在仓库根目录、已安装项目依赖的环境执行：

```powershell
pnpm exec vitest run tests/desktop-updates.test.ts tests/desktop-update-lifecycle.test.ts tests/ipc-desktop.test.ts tests/nsis-updater.test.ts tests/nsis-differential-download.test.ts
node scripts/desktop-updates-ui-smoke.mjs
```

第一条选择 5 个受影响文件，当前共 41 项；第二条需要本机 Microsoft Edge，在独立无头浏览器中运行真实 App React、模拟 IPC，当前 22 项界面检查。它们不会操作已安装 CBIM、发布 Release 或启动真实安装器。

| 验证 | 实际结果与边界 |
| --- | --- |
| 预下载状态机、真实 Application 关闭/重开、固定 IPC | 3 文件 28 项通过；报告 `test-results/update-prefetch-unit.json`。含定时预下载、五分钟失败冷却、手动重试、并发合并、下载完成不安装、普通退出取消及原工作区/用户文件保留。 |
| NSIS 配置与固定清单 | `tests/nsis-updater.test.ts` 3 项通过；报告 `test-results/update-differential-unit.json` 中该文件通过。此报告同时保留首次 HTTP 夹具初始化失败，不能把整份初始报告称为通过。 |
| 真下载器与本地 HTTP | `tests/nsis-differential-download.test.ts` 10 项通过；最终报告 `test-results/update-differential-http-final.json`。只替换 Electron 宿主和 HTTP 传输目的地，不替换差分算法、缓存或摘要校验；不启动安装器。 |
| 界面交互 | `test-results/issue19-ui-report.json`，22 项通过、零页面错误。含正常就绪/失败重试文案、显式重启、草稿保留、弹窗关闭、深浅色与 320px；不是打包版安装验收。 |
| 静态检查 | `pnpm typecheck`、`pnpm check:architecture`，结果记录在开发日志；全仓行为测试未运行。 |

真实 HTTP 样例用 8 个等长数据块，其中 2 块变化：完整内容 65,536 字节，只收到 `bytes=8192-16383` 与 `bytes=40960-49151` 两个区段，共 16,384 字节（25%，不含索引和清单）。重建结果逐字节等于目标包，并通过下载器 SHA-512。**此比例只证明测试样例的差分有效，不是实际安装包节省量承诺。**

其他 HTTP 场景覆盖：旧标签 URL、旧 blockmap 缓存、重启后复用已校验待安装包、旧安装器缺失、索引缺失、旧包损坏、Range 内容损坏、服务器忽略 Range、全量回退损坏拒绝安装，以及待安装缓存被篡改后重新下载。所有临时包位于测试自行创建的系统临时目录，不接触真实更新缓存。

## 后续正式安装版的人工测试

**需要两个版本。** 把含本次修改的版本称为 A，再准备更高版本 B。先升级到 A；从旧的 0.1.9 升到 A 时仍由旧更新器执行，不能据此判断本次优化无效。只有 A 检查并下载 B 才能完整验收。`pnpm start` 的开发态和便携包默认禁用更新，不能代替安装版测试。

制品验收使用没有 CBIM 用户安装的隔离 Windows 机器。A/B 的准备和发布另走原发布流程；本任务没有发布这两个版本，不改已公开的同版本附件。仅换安装目录不是隔离，NSIS 仍可能操作原注册表安装。

1. **后台预下载：** 在安装好的 A 中打开工作区并保留一份未提交编辑，不点下载。B 可见后，等首次检查或下一分钟，在“用户菜单 → 版本与更新”看到“正在后台下载并校验”，随后出现“重启安装”。任务和窗口保持运行，未提交编辑仍在。
2. **没有隐式安装：** 不点击重启，关闭更新弹窗、继续使用，再正常退出并重新打开；当前版本应仍为 A。联网核对后有效缓存应回到已就绪，不重新传输完整安装包，也不自行安装。
3. **显式安装：** 保存未提交编辑，点击“重启安装”。应出现安装提示，然后退出和重启为 B；核对原工作区、设置、历史记录和业务文件。只有新进程版本 B 才证明安装完成。
4. **增量流量：** 保留隔离测试机的 `%LOCALAPPDATA%/cbim-desktop-updater/installer.exe`，它应对应 A 的完整安装包。新下载从 B 的 blockmap 计算变化，必要时从 A 标签取得旧 blockmap。发布验收应记录 Range 请求及实际传输字节，与 B 完整包比较。最终缓存 EXE 仍是完整大小，**不能用缓存文件大小判断是否增量**；应用“已就绪”也只证明校验完成，不证明用了差分。
5. **回退：** 自动化 HTTP 测试已确定性覆盖缺缓存、坏索引/数据和不支持 Range 的回退。真实制品验收如测试无缓存，应在另一台干净隔离机器进行；预期完整下载并校验后仍可安装，不把完整下载视作升级失败。下载中断时应显示失败并允许重试，绝不能自动安装半包。

## Review 与下一次修改入口

- 预下载策略、五分钟冷却和安装授权归 `src/backend/updater/desktop-updates.ts`；Main 只提供正常关闭回调，业务运行时不依赖更新器。
- 差分、固定源与最终完整性校验适配在 `src/backend/updater/nsis-updater.ts`；复用 `electron-updater@6.8.11`，单元测试锁定其旧/新 blockmap URL 与回退行为。升级该依赖时重测这些用例。
- 公开状态说明在 `src/bridge/contracts/desktop-updates.ts`，用户入口在 `src/frontend/updates/SoftwareUpdates.tsx`，安装状态由后端拥有，界面不自行推断并派发安装。
- 注释、相关 `CONTRACT.md` 与 `ARCHITECTURE.md` 已同步。没有执行完整 CI、打包、真实 NSIS 安装、GitHub 在线升级、用户网络测速或人工代码验收；这些不能由单元与模拟 IPC 结果替代。

## 2026-11-12 10:57 源码复验

用户明确要求按本说明重新执行。基线 `3f249cf8`，产品源码和测试没有修改；本轮新证据目录为 `test-results/update-source-validation-20261112-105726/`，此前界面报告另存为 `previous-ui-report.json`。

- `pnpm exec vitest run tests/desktop-updates.test.ts tests/desktop-update-lifecycle.test.ts tests/ipc-desktop.test.ts tests/nsis-updater.test.ts tests/nsis-differential-download.test.ts --reporter=default --reporter=json --outputFile=test-results/update-source-validation-20261112-105726/unit.json`：5 文件、41 项全部通过，0 失败、0 跳过，耗时 8.44 秒；控制台记录 `unit.log`。
- `node scripts/desktop-updates-ui-smoke.mjs`：22 项通过，零页面错误；本轮报告 `ui.json`，控制台记录 `ui.log`。真实 React + 模拟 IPC，独立无头 Edge；不代表真实安装器验证。
- `pnpm typecheck`：通过；`typecheck.log`。
- `pnpm check:architecture`：58 个目录的架构说明一致，1296 文件/6682 依赖、0 循环/违规；`architecture.log`。
- 后台下载不安装、显式安装排空、退出取消、缓存复用、Range 传输与整包 SHA-512、缺缓存/坏数据等全量回退均由上述用例覆盖。样例 65,536 字节中传输 16,384 字节的断言通过，仍不代表真实公开包节省比例。
- 未运行全仓回归、打包、真实 NSIS 安装或公开在线升级；未操作已安装客户端。现有隔离诊断与历史发布记录的未提交修改保留。
