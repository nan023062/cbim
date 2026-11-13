# Windows 正式桌面版与独立更新程序验收

> 历史快照：正文中的目录、完成状态与验证数字保留记录日期的事实，不是当前实现清单。四层迁移后的现状请看 [源码契约](../../src/CONTRACT.md) 和 [Logic 边界](../../src/logic/BOUNDARIES.md)。

日期：2026-11-08。目标：发布 `desktop-v0.1.0`，在正式 APP 中提供新版提醒、手动下载安装、版本日志及两项反馈 Skill；原 Step55 之后的开发计划不恢复。

## 实际交付范围

- Windows x64 NSIS 每用户安装包；独立 `desktop-v` GitHub Release 通道，不覆盖旧 Python 内核 `v1.x`。
- 更新代码集中到 `src/backend/updater/`：公开读取、版本筛选、状态机、NSIS 适配及重启目录恢复。Main 只负责装配、固定 IPC 和正常关闭回调；依赖检查拒绝 updater 引用 Main、Core 或调度。NSIS 构建模板独立位于 `packaging/updater/`。
- 启动 10 秒后／每 30 分钟检查；检查不下载，用户下载后再点击重启安装；退出与下次启动均不自动安装缓存。当前日志随包离线读取，新版日志只作纯文本展示。
- OAuth App `CBIM Feedback`（4002869），公开 Client ID `Ov23liSMDZneBd3gSyTo` 已预置；用户使用自己的 GitHub 连接。真实 Device Flow 在 22:13 CST 完成，实际账户 `nan023062`、仓库 `nan023062/cbim`（1240750134），系统加密可用；没有生成 Client Secret。

## 最终候选产物

- 构建：`20261108-224822`，桌面版本 `0.1.0`。
- 安装包：`build/desktop-release/0.1.0/CBIM-Setup-0.1.0-x64.exe`，136015672 字节。
- SHA-256：`1c3183f6e394357d56f870258e2284ce67cf3c9ad053a5ed3e0b9867498a6be3`。
- EXE、blockmap、latest.yml 的各自摘要保存在同目录 `SHA256SUMS.txt` 和 `build-receipt.json`。
- 安装后的 main/preload/controlled-file-child/isolated-node 与实际构建字节相同；BUG／需求两项 Skill 也与源码相同。574 项产品源码／构建输入摘要为 `d4217c0c698551a7b70a1cbd74efa5948d03c46b39f6c83ea3335e19e2617756`；本地证据 `test-results/desktop-live/source-receipt.json`。

## 已执行验证

| 验证 | 实际结果 |
| --- | --- |
| 最终类型检查 | `pnpm typecheck` 通过 |
| 最终架构与依赖 | 52 目录、564 源码／样式，1095 文件、5791 条依赖、0 环；类图无漂移 |
| 最终相关回归 | 9 文件 75/75 通过；包括更新、重启目录、公开 HTTP、分层及反馈／真实 Pi 测试；GitHub 单测仍使用 HTTP 夹具 |
| React 界面 | 更新入口、纯文本日志、检查不下载、下载不安装、显式重启等 5 组通过；反馈设置 4 组通过。此层 IPC 为夹具 |
| 安装与自动重启 | 最终 NSIS 安装后自动启动正确 EXE，命令行带原自定义用户目录；正常关闭后重开为 0.1.0，更新入口启用、原 GitHub 连接保留，页面错误 0 |
| 全仓回归 | 347 文件／2399 项：2396 通过、1 失败、2 跳过，1606.94 秒；不是全绿，也不是最终冻结树回归 |
| 全仓失败复验 | `isolated-node-crash` 的进程退出断言已通过，但测试清理 EXE 遇 Windows EBUSY；仅给测试清理添加有界重试，保留原身份与整棵进程退出断言。单独 1/1 复验通过 |

全仓运行期间按用户新要求分离 updater，并补齐安装接线，因此最终代码以最后的 75 项定向回归、类型／架构检查和最终安装包验证为准。2 项跳过是需要显式旧 EXE 夹具的知识来源／负责人旧记录兼容场景。本次没有重写全仓报告，未将最终未重跑的全仓宣称通过。

真实安装证据：`test-results/desktop-live/install-separated-report.json`、`installed-separated.png`。测试使用独立的 `test-results/github-feedback-live/user`，正常关闭测试应用；不会把隔离登录写成日常用户目录已连接。

## 原失败和修正

1. Forge 最初用 packageAfterCopy 修改包版本时，Vite 尚未生成 package.json；改为 readPackageJson 钩子。
2. 首候选对卸载程序名称判断错误，且预打包漏带 `app-update.yml`，更新入口未启用。修正后真实安装通过。失败候选保留于 `candidate-222457`，中间通过候选保留于 `candidate-222924`，均未发布。
3. Windows Shell 重启不继承原进程环境；NSIS 模板显式传回原自定义目录，Main 在任何用户数据初始化前校验恢复。最终真实自动重启已核实同目录。
4. 独立 HTTP 测试首次 mock 类型定义错误，修正测试后类型检查通过；ASAR 指纹脚本首次用 POSIX 分隔符，在 Windows 未找到入口，改用实际系统路径后字节核对通过。二者均为测试脚本问题，不改写失败记录。

## 公开发布及线上验收

- 2026/11/8 23:02:37 CST：[desktop-v0.1.0](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.0) 已公开为稳定发布，发布账号 nan023062；标签固定源码提交 `4d3bc1921ac061744ec3605cda8779dbefc8ecbe`。EXE、blockmap、latest.yml、SHA256SUMS.txt 的大小与 GitHub 端 SHA-256 全部匹配本地。旧内核 latest 仍为 v1.0.2。证据：`test-results/desktop-live/publish-report.json`。
- 2026/11/8 23:10:56 CST：从未发布的 0.0.9 验收基线，实际发现公开 0.1.0，点击下载并校验后正常退出仍为旧版；重新打开，再明确点击重启安装后实际运行 0.1.0。原自动重启进程及其 renderer 使用原用户目录，GitHub 连接、localStorage 与测试文件保留。下载文件摘要与已发布 EXE 一致。证据：`upgrade-report.json`、`upgrade-downloaded.png`、`upgraded-settings.png`（均在 test-results/desktop-live）。
- 2026/11/8 23:11:33 CST：正式已安装 APP 的主会话实际读取 BUG Skill 并调用一次 cbim_feedback_submit，创建唯一 [Issue #8](https://github.com/nan023062/cbim/issues/8)，作者 nan023062，仓库 ID 1240750134。原操作 `0ad43d96-77ee-4046-82e5-19a7ad2796e4` 为 submitted，工具回执 succeeded；GitHub 正文 SHA-256 与原账本完全一致。成功静默及重开后静默通过，未创建第二张需求工单。
- 线上测试使用本机确定性模型响应，但安装器、Pi、系统加密、GitHub 登录与 Issue API 均真实。Issue 未由 gh／网页或手写 POST 代发；gh 仅在匿名查询限流后只读核验原 Issue。完整反馈证据见[线上验收](github-feedback-online-20261108.md)。

线上验收脚本的修正也保留：首次错误假设缓存名为 update.exe，实际库按版本文件名保存；只修正验收脚本并复用已下载缓存。安装时 Playwright 的 90 秒 close 事件等待超时，实际安装与自动重启已经完成，随后只读核对原新进程／版本，没有重复安装。反馈 POST 成功后匿名 GET 返回 403，rate_limit 核实公共配额 60/60 已耗尽；通过已登录账号 GET 与原账本核对，没有重复提交。重开页面最初的文本定位匹配 3 处，收窄到实际聊天消息后验证通过，产品代码与发布制品未变。

## 限制及同步维护

首版未签名，可能显示未知发布者；当前仅 Windows x64，未在另一台全新电脑上验证。测试模型是本机确定性响应服务，实际产品 Pi、系统加密、安装器及线上 GitHub 分开核验；不证明在线模型自主分工质量。OAuth 过期需重连，不实现 token 自动刷新或反馈结果回访。新版通知依赖程序联网检查，不是离线推送服务。

注释与类图已同步 updater、main、resources、platform、bridge/contracts、frontend/settings、shell，以及反馈涉及的 core、scheduler-engine、conversation；相关 CONTRACT、目录生成器、依赖规则、两份架构 Skill 和源码布局说明同步更新。
