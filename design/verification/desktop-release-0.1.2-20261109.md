# CBIM Desktop 0.1.2 发布准备

日期：2026-11-09；设备：LINAN-XDT，Windows x64。用户已授权发布最新版并投放现有更新通道。`5ebe82a` 已生成未签名候选并上传唯一草稿 `438932418`，**尚未公开 Release 或投放更新**。真实安装与升级已通过，全仓检查仍在定位云端运行程序校验失败；详见下方候选验收记录。

## 候选范围

- 基于已合并的 [PR #13](https://github.com/nan023062/cbim/pull/13)，纳入 #9、#11、#10、#12 的独立修复、统一品牌和 Windows LPAC 启动兼容修复；#14 保留为独立待办。
- 候选版本为 0.1.2，用户可见说明在 [版本日志](../releases/desktop-v0.1.2.md)。README 与官网仍指向已经公开的 0.1.1，不能提前描述 0.1.2 已可下载。
- 当前分支为 `develop`，基线 `aded30b14fe05ff5b228932247b0848ac2c91f47`；主分支合并提交为 `2614985d6f9b7c1199e86896911add1e37cd2b7e`。只有 `master`、`develop` 两个本地及远程分支，默认分支为 `develop`。

## 已执行检查

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm check:architecture` | 通过 |
| 更新服务、NSIS 适配、HTTP、重启用户目录、签名发布流程回归 | 5 个文件，55/55 通过，0 失败、0 跳过 |
| 显式未签名发行实现后再次执行类型／架构与相关回归 | 类型／架构通过，1136 文件、5936 依赖、0 环；7 文件 76/76 通过 |
| 当前正式构建入口 `pnpm make:desktop` | 缺少签名配置，返回 `SIGNING_NOT_CONFIGURED`，在构建输出和发布操作前中止 |

本轮测试报告：`test-results/desktop-0.1.2-release-readiness.json`、`test-results/desktop-0.1.2-unsigned-release.json`；构建预检日志：`test-results/desktop-release-preflight-20261109.log`。后续复跑针对新增发行模式，不重放原外部操作。

已有集成证据另见 PR #13 与 [Windows CI](https://github.com/nan023062/cbim/actions/runs/42583657826)：358 文件、2465 项，2463 通过、2 项需要历史 EXE 的原有跳过；真实打包 EXE 的 6 个隔离执行场景通过。这些是本轮之前的验证，没有冒充本轮重新运行全仓测试。

## 签名事实与发布边界

### 候选验收与尚未完成的检查

- 安装包 `CBIM-Setup-0.1.2-x64.exe` 为 136079477 字节，SHA-256 `ae0b18cad81114e1dc9c8b03644bbec940a537699829ecb4bcb923d75548f675`；草稿四个附件已核对远端摘要。构建回执位于 `build/desktop-release/0.1.2/unsigned-20261109-171427-d973710b/build-receipt.json`，发布操作日志同目录 `acceptance-publication.jsonl`。
- [隔离 runner 验收 42594569712](https://github.com/nan023062/cbim/actions/runs/42594569712) 通过全新安装、0.1.1 升级、六项用户数据保留、唯一模型请求和未签名事实；页面错误为零，报告 `test-results/desktop-0.1.2-candidate/report.json`。验收机没有真实用户安装，未在开发者电脑卸载或覆盖现有客户端。
- 候选 EXE 的六项隔离场景通过，报告 `test-results/desktop-0.1.2-isolation-packaged.json`。本机针对云端两项失败的原样复核及新增诊断复核均为 2/2 通过，报告 `desktop-0.1.2-ci-diagnostic.json`、`desktop-0.1.2-runtime-facts-local.json`。
- 全仓 `42594576718` 与 `42597751602` 均未通过：后者终端测试原样通过，隔离运行程序 `RUNTIME` 仍复现；正在核实可执行文件属性，未放宽校验、跳过测试或将定向诊断冒充全仓。PR #15、公开投放和线上更新验收尚未完成。

### 签名选择

- `CurrentUser\My`、`LocalMachine\My` 的代码签名证书均为 0，签名选择器未配置，仓库签名 Secrets／Variables 为空；用户也确认当前没有签名。
- Windows SDK 10.0.26100.0 的 x64 SignTool 已安装；缺少的是可用签名身份，不是签名工具。
- Windows 的未签名 EXE 可以分发，但可能出现未知发布者／SmartScreen 提示，受管控电脑或 Smart App Control 也可能阻止运行，见 [Microsoft 文档](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)。
- 用户明确选择本次先未签名发行。构建、校验、发布均新增显式 `--unsigned`，模式写入回执和内置元数据；默认仍要求签名，不因缺证书或签名失败自动降级。未签名构建不读取签名身份、禁用自动发现，并保留制品与远端附件完整性验证。两种模式不可混用，不伪造签名证据。
- 发行工具变更限定于根构建配置及 `scripts/`，产品更新运行时未改动；签名提供方、SHA 校验、发布草稿／日志恢复机制继续复用。后续签名版需实际取得证书，并验证更高版本升级，当前没有签名迁移验收结论。
- 用户更新通知来自运行中的安装版：启动约 10 秒后及每 30 分钟检查新版，下载与重启安装由用户确认。尚未投放 0.1.2，不能报告现有用户已经收到通知。
