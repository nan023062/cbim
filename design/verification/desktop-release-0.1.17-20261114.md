# CBIM Desktop 0.1.17 正式发布与公开升级

2026-11-14。用户明确授权正式发布后立即验收公开自动升级；本记录接续[发布前候选验收](engine-architecture-acceptance-20261114.md)，不改写原候选阶段的边界和失败记录。

## 已公开制品

- [desktop-v0.1.17](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.17)，Release ID `445084616`，公开时间 `2026-11-14T07:34:06Z`，稳定桌面版、非草稿。
- C 0.1.17 / 内置 R1。构建和标签均固定于 `0ae674acf5b0582234f5f1ae1b1ad5358198a8bf`；沿用同一已验收候选，没有重新构建、覆盖附件或移动标签。
- Windows 签名仍为用户已选定的 `NotSigned`。资源与引擎索引沿用原 Ed25519 身份，公钥 SPKI DER SHA-256 为 `378c827bf38efb6724466bbb39d3e39ee4ef2dc1de2576fa1fde760443145c49`。
- Python latest 仍为 `327801733 / v1.0.2`；桌面发布明确 `make_latest=false`。

四附件均经匿名实际下载校验：

| 附件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `CBIM-Setup-0.1.17-x64.exe` | 111857839 | `e7a3753a348bc9029c3d71532289c5a25ef31cce4a0596f7a4583715628c6102` |
| `.exe.blockmap` | 118690 | `b3f564fa94fc556bfb87e974466a3494a39a5fe4c9a06e70af07996e8123ead1` |
| `latest.yml` | 348 | `a6f44002d0ad01a4f2ea2cb4f2f483b092359d43d371899ae7908ca6ab0f7747` |
| `SHA256SUMS.txt` | 270 | `f012e63a05ad5245bd3d0e50d16608c2b5318b3f7f13a97d3c37c6bac5884942` |

公开步骤中两次直接 PATCH 返回 HTTP 404。每次只读回查确认同一草稿和附件仍完整；随后通过 `gh release edit` 正常公开同一 ID，再核对正文、标签、摘要与旧 latest。没有新建重复 Release 或删除原制品。原始回执保存在 `test-results/desktop-release-017-20261114/publication.jsonl`，不把接口错误归因于产品或伪称首试成功。

## 精确 PR 的完整 CI

[PR #77](https://github.com/nan023062/cbim/pull/77) 的 head 为 `14376b5e5d72965e6a9b7dd5a1c10336950f039e`、base 为 `15d27f4b07227b9411e05d8b231508a8fd3476be`。[完整运行 43570401170](https://github.com/nan023062/cbim/actions/runs/43570401170) 的类型、架构/依赖、测试归属、官网构建、四个 Windows 分片和最终完整覆盖汇总均通过。正常 merge commit 为 `f2f87bc460d942fd71d4d6c34535283bf6aaf7b0`，没有 squash 或管理员绕过。

| 分片 | 文件 | 通过 | 失败 | 条件跳过 |
| --- | ---: | ---: | ---: | ---: |
| 1 | 129 | 1089 | 0 | 0 |
| 2 | 130 | 781 | 0 | 0 |
| 3 | 130 | 864 | 0 | 1 |
| 4 | 129 | 757 | 0 | 1 |
| 合计 | 518 | 3491 | 0 | 2 |

两个既有跳过来自 `owner-execution-legacy.test.ts` 和 `knowledge-source-lifecycle-application.test.ts`，均需 runner 未提供的固定历史 EXE 夹具，没有删除或改写为通过。本轮真实 0.1.16 安装与数据迁移另由下述公开验收覆盖。

合并最新上游验收工具后，先定向执行进程所有权、真实 Electron 生命周期、Windows 路径、Inspector 断连、安装输入、网络证据和 CI 规则七个套件，共 129 项通过；测试归属检查覆盖 518 文件。随后才运行本 PR 的全量 CI。

候选源码与验证提交之间的差异逐文件核对：产品 `src/`、依赖/lockfile、Forge/builder/desktop-builds、品牌、legal/docs、内置本版日志及 R/E 构建入口不变。变化为 CI/验收工具、测试、官网及维护记录。Forge 会复制 design，因此候选中的 design 副本仍是冻结时内容，不能声称全部资源字节等于后补记录；内置本版日志中的“候选”反映构建阶段，公开状态与证据以 Release 及本记录为准。未为追补记录替换原安装包。

## 真实公开自动升级

公开后立即派发 [43571747564](https://github.com/nan023062/cbim/actions/runs/43571747564)：workflow head `14376b5e5d72965e6a9b7dd5a1c10336950f039e`，`mode=online`，`previous_version=0.1.16`，`version=0.1.17`，`transfer_expectation=differential`；构建提交和安装器摘要均固定为上文值。2026-11-14 `07:39:41.245Z` 完成，整个 workflow 成功。

- 在无用户安装的 GitHub Windows runner 中执行全新安装，以及真实旧安装版的公开通道升级；客户端没有 GitHub 凭据，不替换下载响应。
- 旧版通过原定时器自动发现、后台预下载：10 次安装包请求均为 Range，完成 payload `4,611,209` 字节，完整包为 `111,857,839` 字节；`fullDownloads=0`。约为完整包的 4.12%，未把另行安装旧版/新装场景的流量计作增量流量。
- 普通退出不安装；重新启动仍为 0.1.16，复用已校验缓存，安装包请求数 `0`。实际 UI 点击重启安装后启动 0.1.17，原 `--cbim-user-data-root` 保留。
- 原工作区、模型、同一个已完成 task/run、localStorage、文件标记、正式知识、业务文件、主 Agent revision/selection 和自动化 id/revision 全部保留。自动化未运行，无任务重放，页面错误 `0`。
- 实际程序 `isPackaged=true`、版本 0.1.17、签名 `NotSigned`。原 NSIS 缓存为真实 0.1.16 安装器，新缓存摘要等于公开 0.1.17，未人工补缓存。
- 全新 profile 从公开地址下载 Pi 适配包 1.1.0 / SDK 1.5.0，核对 15340 文件并完成一次确定性模型请求；迁移 profile 一次，总计 2 次。该探针不替代此前真实 DeepSeek/Pi 外部模型验收。
- 进程生命周期记录完整保留 5 个实际 Electron PID 的 active → stopping → closed，安装重启与普通退出原因分别记录。没有等待 cmd 启动器充当应用进程，没有遗留清理失败。
- `resourcePrelude=[]`、`checkRetries=[]`；本次直接 C 0.1.16/R1 → C 0.1.17/R1，不冒称旧 0.1.15 的资源预升级链也在本轮重跑。

原始报告/截图位于 `test-results/desktop-release-017-20261114/online/`，对应 Actions artifact `desktop-0.1.17-online`；重点文件为 `report.json`、`online-differential.json`、`online-cache-reuse.json`、`normal-quit-cancelled.json`、`online-ui-install.json`、`online-restart.json`、`retained-017-features.json` 和 `process-lifecycle.json`。

## 独立引擎通道

既有 `runtime-engines` Release `442866980` 保留旧包，本次新增独立签名索引 `latest.json`，asset ID `746705276`，3659179 字节，文件 SHA-256 `dea69681af37348fe1e520d839a907ff6af93897224dbc5d341a81515bf7bc5e`。索引 sequence=1，payload digest `553bd7db971bbe677064dc5a79446b0088790a99dda19a8ec2097357d1fadc94`，source 同冻结候选；当前四包均为 1.1.0，ZIP 摘要与候选验收记录一致，Codex 的 Pi 依赖固定于原摘要。

使用正式 `sign:engines` 从候选同字节 ZIP 生成索引，沿用原私钥。公开后用实际 `EngineArtifacts`/`RuntimeStore` 在独立测试缓存匿名读取、验签、下载 Memory 包并核对文件；重建服务后离线读取同一包，网络尝试数为 0。证据 `engine-public-report.json`。该检查覆盖真实公开索引及缓存复用，不表示做过更高 E 版本升级或 Memory 向量模型执行。首个 R1 已在安装包中，未额外发布 `runtime-c0.1.17` 资源更新；客户端将该通道 404 视为暂无同 C 资源更新。

## 官网与交付边界

官网快照、首页发布卡、下载说明和 README 从上述真实发布回执更新为 0.1.17，保留原搜索验证标记、canonical/robots/sitemap 和未签名提示。`pnpm check:brand` 通过；设置 `CBIM_WEBSITE_URL=https://nan023062.github.io/cbim/` 后执行 `node scripts/ci-website-smoke.mjs`，包含官网构建和 14 场景浏览器检查，全部通过、0 页面错误、无溢出，报告为 `test-results/branding-website/website-report.json`。官网与本记录单独提交收尾 PR，轻量 CI、master Pages 部署和匿名六文件校验的实际回执写入该 PR 收尾记录，不重新运行未变化的产品全量 CI。

此前真实 DeepSeek/Pi 会话及重开无重放证据继续有效。用户明确本轮只验已有生成模型，向量双模型另验；不宣称 Claude/Codex 所有外部服务或所有模型已验证。未操作用户本机安装，公开可用及隔离升级通过不等于所有用户已升级。原主工作树的未跟踪方案文件和其他未知分支/工作树均保留，双分支同步不使用强推或批量删除。
