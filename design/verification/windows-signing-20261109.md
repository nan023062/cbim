# Windows 签名流程验证（2026-11-09）

## 结论与边界

用户授权接入代码／安装包签名并重发 0.1.1，随后明确答复尚无证书。已完成构建层签名适配、安装器 hook、重新验签与 GitHub 发布门禁；**未生成真实签名包，未安装签名版，也未重发 0.1.1**。公开版本仍为原未签名发布，源码标签不移动。当前缺少实际公开可信证书及 SignTool 配置，这是完成正向验收的必要条件。

基线：LINAN-XDT、Windows x64；分支 `feat/cbim-production-governance`，修改前干净 HEAD `f3a288b1d4ed8b3a869d1f73bcc2471d0c223956`。没有在 NAN-LI 上执行验收，没有创建 Issue，没有购买证书、导出私钥或更改系统信任库。

## 已核实的根因与改动

- 原 builder 配置为 `signAndEditExecutable:false`，没有证书配置。对原 `CBIM-Setup-0.1.1-x64.exe` 运行真实 Windows `Get-AuthenticodeSignature`，返回 `NotSigned`，签名者与时间戳均为空；不是把哈希校验误认为数字签名。
- 本机 `CurrentUser\My`／`LocalMachine\My` 未发现代码签名证书，PATH 未发现签名工具，相关环境变量、GitHub 仓库 secrets／variables 没有配置。用户也确认“没有”。这不等于扫描并断言所有磁盘上都没有 SDK。
- 已核对安装的 electron-builder **26.18.0**：`platformPackager.doPack()` 在 `prepackaged` 模式直接返回，不能靠开启一个开关补齐应用签名。因此在 Forge 产物进入 NSIS 前显式签名 Windows PE；安装器 hook 负责最终 EXE 和嵌入前的卸载器，再核对签名后的清单。
- `scripts/desktop-signing/` 独立包含公开配置、证书库适配、PE 发现、产物门禁与发布步骤；未修改 `src/`。原更新子系统、业务运行时及依赖分层保持原职责；Forge 写入公开 `publisherName`，交给已有 electron-updater 在后续升级时验签。
- 每个签名候选采用新目录和独立回执，不覆盖原安装包。NSIS 不附带本产品每用户安装不需要的 `elevate.exe`，避免归档时额外插入未纳入签名清单的可执行文件。私钥只由 Windows CSP/KSP 提供，不接受仓库 PFX 或密码参数。
- 发布命令先真实验签再访问 GitHub。同版本替换明确需要 `--replace`：先备份原附件／元数据并核对摘要，临时草稿中逐一替换，验证远端摘要后公开，原标签与 Python latest 保持。不可变 Release 拒绝替换；未知结果写日志并拒绝自动重放。此流程的网络成功／失败顺序用替身测试，尚未实际执行重发。

## 实际验证

| 验证 | 实际结果 |
| --- | --- |
| `pnpm typecheck` | 通过，包含 Forge 和 Vitest 配置 |
| `pnpm check:architecture` | 通过；53 个目录、566 个源码／样式文件，0 份类图差异；1111 文件／5844 条依赖，0 环 |
| 依赖／分层与既有更新测试 | 4 文件 34/34：dependencies、layer-boundaries、desktop-updates、nsis-updater |
| 签名与发布单元测试 | `desktop-signing.test.mjs` 29/29；使用签名／GitHub 替身，不属于真实签名、安装或线上发布 |
| 缺证书的真实构建入口 | `make-desktop.mjs` 返回非零和 `SIGNING_NOT_CONFIGURED`；Forge 未启动，未创建构建锁，原安装包 SHA-256 未变 |
| 缺证书的真实发布入口 | `publish-desktop.mjs ... --replace` 返回非零和同一错误码；未创建发布日志，未进入 GitHub API 调用 |
| 原包真实 Authenticode 查询 | `NotSigned`，无签名证书与时间戳；查询不改文件 |
| builder 配置 Schema | 使用公开假选择器，仅调用本机 26.18.0 配置验证器，通过；未访问密钥、未触发构建或签名 |
| JS 构建脚本语法 | 9 个脚本 `node --check` 通过 |

首轮定向命令因原 Vitest 仅匹配 `.test.ts`，只运行了原 4 文件 34 项，没有将新 `.mjs` 用例误计为通过。补充 `.test.mjs` 发现规则后先通过 28 项，增加不可变 Release 边界及截断 PE 检查后最终为 29 项。合计 **63 个不同相关用例通过**，未运行全仓回归。修改 PowerShell 证书检查时同时避免 `OidCollection.Add()` 的返回值污染 JSON；没有证书，证书库正向分支仍待真实验收。

覆盖包括：缺配置、配置冲突、非法 SDK 路径／时间戳地址；无效链、无私钥、自签名、错误发布者；无签名、文件改变、错误指纹、无时间戳；签名后摘要、原生文件覆盖、截断 PE、遗漏二进制、篡改资源／blockmap、丢失更新发布者、卸载器证据不匹配；发布前阻断、备份失败不撤下原版、替换顺序、远端摘要不符、上传结果未知不重放、不可变发布拒绝。

本机报告：

- `test-results/windows-signing-tests.json`：原 34 项。
- `test-results/windows-signing-unit-final.json`：最终 29 项。
- `test-results/windows-signing-missing-certificate.json`：构建负向入口与原包前后指纹。
- `test-results/windows-signing-publish-negative.json`：发布负向入口与无日志副作用。
- `test-results/windows-signing-builder-schema.json`：26.18.0 实际配置验证结果。

## 原线上版本保持

只读核对 [desktop-v0.1.1](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.1)，Release ID `438430271`，公开时间仍为 `2026-11-08T18:20:29Z`，非草稿。四个附件的大小及 SHA-256 与上一轮正式发布一致：

| 附件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| CBIM-Setup-0.1.1-x64.exe | 136046213 | `baf9418ab2954ed44780ac479a1747d0eb198cd1ca6686f8b4384f0174728952` |
| CBIM-Setup-0.1.1-x64.exe.blockmap | 143965 | `8d35af09a9d0ac41b7b0bb75647f897e876edb9bac3926be8a1327740eee6649` |
| latest.yml | 345 | `cc8172f6b0cc4317bc95141f257fb61f8b77c3ad719ed44cc64856491b6088fa` |
| SHA256SUMS.txt | 268 | `d24a31dc5b33d27acca91f7b2456a73010f350698dbf4f98b2e324ad7f56b194` |

## 接续

取得实际公开可信证书，安装提供方客户端与 Windows SDK，按[配置与重发指南](../task/windows-signing.md)设置公开指纹／发布者。届时完成真实签名、独立安装与卸载器验签、旧版升级、四附件线上替换和回读；在此之前不标记“签名版已发布”。同版本重发不触发已安装 0.1.1 的更新提醒，需手动重装；不擅自改为 0.1.2。

源码注释／类图规则仅覆盖 `src/`，本次没有源码目录修改或虚构类图。构建适配的注释、发布指南、roadmap 和开发记录同步维护。当前签名服务变化归构建适配，GitHub 发布策略归发布模块，运行时不承担证书申请／私钥管理。
