# CBIM 0.1.11（B）发布与 A → B 安装版实测

日期：2026-11-12。用户授权先发布 A，再发布 B，并完成正式 CI/隔离安装。**A/B 已公开；后台预下载、明确点击后安装及数据保留通过，安装版差分失败并回退全量。** 原文件不覆盖，修复候选 0.1.12 尚未公开。

## 冻结与正式检查

- 冻结源码/标签：`3197b0e6978d1b005bd963ad1bdc0eb7e059b122`；相对 A 只更新版本和内置日志。候选 `build/b11/build/desktop-release/0.1.11/unsigned-20261112-112443-5df048cc/`。
- 验证 head：`a8e6f4ca42a8f52137305a16a8081fc7d54c433c`，base：`b1b20a0f624a00265933fe69efc606f60f79e985`；[PR #52](https://github.com/nan023062/cbim/pull/52) 正常 merge `617049226dc848782b0203ceedbb44aee6a510d0`。
- [完整 CI 43153778797](https://github.com/nan023062/cbim/actions/runs/43153778797)：四片通过，408 文件、2776 项、2774 通过、0 失败、2 跳过。跳过为缺固定 pre-owner/pre-source 历史 EXE 的既有场景。
- 产品、依赖、品牌、构建输入和本版日志与冻结源一致，24 项 Builtins 运行资料一致；后续维护资料不追补已冻结安装包。
- [候选安装 43154244827](https://github.com/nan023062/cbim/actions/runs/43154244827)，同一验证 head、attempt 1：干净 Windows runner 全新安装 B、真实 A → B 覆盖升级，全部数据保留、NotSigned/isPackaged、1 次模型请求、零页面错误。该旧验收尚未检查 NSIS 的缓存落盘位置，不能代替差分验收。
- 公开前重新核验同一候选；打包 EXE 六项隔离结果及制品回执见 [B 原始记录](desktop-update-b-local-20261112.md)。

## 公开回执

Release ID 442491987，`2026-11-12T04:34:45Z` 公开；[desktop-v0.1.11](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.11)，draft=false、prerelease=false、make_latest=false，标签指向冻结源，旧 Python latest 保持 327801733 / v1.0.2。

| 附件 | Asset ID | 字节数 | SHA-256 |
| --- | --- | --- | --- |
| CBIM-Setup-0.1.11-x64.exe | 738038148 | 391409091 | `9a964f14d7d27174bef6463a726257b57222b64500a4990e694fe46c40a4c535` |
| CBIM-Setup-0.1.11-x64.exe.blockmap | 738040121 | 407731 | `82bd9e93a6a946eeab5c0be336fb79f5ea8eee01f7c2c35a3af19c45965767aa` |
| latest.yml | 738040266 | 348 | `cc208917705bd19a344afd440529b6d674d266a1351aa6f3bcb31b6d297203fc` |
| SHA256SUMS.txt | 738040376 | 270 | `fd8de1544c3e4217cf8fd6844907670e6da3f2e9d7c2dc3ad441a584ab1d0f3b` |

匿名 latest.yml/SHA256SUMS.txt 与候选一致。首次草稿创建被缺 workflow scope 的 CLI 拒绝，确认未创建后复用同一 nan023062 账号的既有 Git 授权，唯一草稿成功建立；凭据未落盘/披露、登录设置未改变。

## 失败、根因与分开报告的回退验收

[严格差分验收 43155757174](https://github.com/nan023062/cbim/actions/runs/43155757174) 失败：A 自动发现并下载 B、ready、缓存 SHA 正确，但 0 个 HTTP 206、1 个 HTTP 200，共 **391409091 字节**，安装前被严格断言阻止。原失败/截图/流量记录保留。

[全量回退场景 43156807720](https://github.com/nan023062/cbim/actions/runs/43156807720)，attempt 1、workflow `4c1e6ddb66e9275359b0ff76ca4709051bdc0410`，显式 transfer_expectation=full-fallback：

- 实际安装 A 后，配置的 cbim-desktop-updater/installer.exe 不存在；NSIS 的 cbim-assistant-updater/installer.exe 存在且 SHA 等于公开 A。没有由测试补造/复制旧缓存。
- A 原定时器自动发现 B，真实 GitHub 下载，无凭据或本地网络替换；准确全量响应/完整缓存 SHA 通过。
- ready 后关闭弹窗仍可继续使用 A；普通退出不安装，重开仍为 A，复用完整有效 B 缓存，新增 B 安装包请求 0。
- 真实 UI 点击“重启安装”后执行原 NSIS，实际新进程携带 --updated 和原测试用户目录；最终 B / isPackaged / NotSigned、更新状态 current。
- 工作区、模型、同一 completed task/run、localStorage、标记、知识/修订、业务文件、主 Agent 选型/修订及自动化定义全部保留；自动化运行为空、模型请求 1 次、无重放、零页面错误。
- 报告明确 differentialDownload=false；该成功只证明回退、后台下载和安装链，不把全量成功冒充差分通过。

根因、先红后绿的回归与构建修复见 [缓存衔接调查](desktop-update-cache-diagnosis-20261112.md)。新候选必须额外证明 NSIS 写入的 installer.exe 就在 app-update.yml 指向目录，并与刚安装的附件摘要一致。

## 官网与用户复测

官网当前下载快照取公开 B 回执，明确展示全量回退的已知限制；0.1.12 只作未公开修复候选，不展示成公开下载。品牌、构建、14 场景、最终 CI/部署回执在收尾 PR 关联。

在无真实用户安装的独立 Windows 测试机安装 [A](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.10)，建立工作区与标记，启动后等待后台下载 B。当前会完整下载约 373 MiB。关闭弹窗可继续使用；普通退出再开仍为 A并复用已下载 B；点击“重启安装”后确认 0.1.11 和原数据。当前 A/B 不能用来证明默认安装状态下的差分节流。

原始证据：`test-results/release-ab-20261112/`。截图中的 ERR_FAILED 另见 [A 报告](desktop-release-0.1.10-20261112.md)：测试过早关闭可复现，正常启动/安装均通过。所有安装均在隔离 runner，开发者客户端未被操作。

官网本机品牌检查、构建和 14 场景检查已通过，零溢出/页面错误。两版公开 Release 正文已补充同一已知限制，四附件 ID/摘要保持不变。
