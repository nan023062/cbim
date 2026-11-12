# CBIM 0.1.13 发布与真实增量升级验收

日期：2026-11-12。用户直接授权发布已变化的分支并测试增量更新；开放 Issues 为空。基线 develop 6aef77785369f0da15549c161114eda7ce99be19，纳入原源码模块整理 aeddea26、审阅归档 5e7baf0b 和后续正常合并，不扩大为新的产品治理任务。沿用已确认的 Windows x64 未签名个人开发发行。

## 冻结、构建与正式检查

- 冻结 source/tag：`9195e3a2c9cc9a8340c12e50b1375a9743d6de81`；候选 `build/release-013/build/desktop-release/0.1.13/unsigned-20261112-153056-9c5f8d31/`。`pnpm make:desktop --unsigned`、`pnpm verify:desktop <候选> --unsigned` 通过，47 个 PE payload 与资源摘要核验一致。
- 显式指向本次真实打包 EXE 的 `pnpm exec tsx scripts/isolated-node-smoke.mts` 六项通过：文件边界、禁网、超时、取消、非零退出、输出限制，全部自有资源回收；不是在开发机执行 NSIS 安装。
- 受影响验收输入测试 38 项通过，类型、架构、依赖与品牌检查通过：86 个目录、668 个源码/样式文件、1302 个维护脚本、6689 条含类型依赖，零循环/违规。
- 首轮 CI 43175821413 第 2 片发现旧 core-domains 测试仍禁止 assembly → engines，与新架构契约不一致。仅改测试并加强 Core 禁止反向引用，`tests/core-domains.test.ts tests/layer-boundaries.test.ts tests/dependencies.test.ts` 三文件/30 项通过。原失败报告保留；新提交触发后原运行取消，不计为完整通过。
- [准确 head 完整四片 CI 43177142009](https://github.com/nan023062/cbim/actions/runs/43177142009)：`02eb66c5f6a0bea4bc0ea45417a9ddcc7569691e`，408 文件、2783 项，2781 通过、0 失败、2 跳过。跳过为两个固定历史 EXE 迁移场景，非本轮新增。
- [PR #55](https://github.com/nan023062/cbim/pull/55) 正常合并为 `0188c213a35b2f7faf4bafb1685959addee12f77`。源码冻结后仅测试与开发记录变化；产品、依赖、打包配置、品牌、版本日志及 24 项 Builtins 正文一致。整个 design/docs/legal 资源保留构建时副本，后续维护记录不追补进冻结包，不声称全部资源与后续仓库逐字节一致。
- 本轮未再次修改 src；原目录整理的注释、契约和 86 目录类图仍有效。现状和范围见 [源码整理报告](source-reorganization-20261112.md)。不将迁移或测试通过声明为人工 review 已接受，也不声称历史隔离恢复竞争已修复。

两个跳过项分别是 `owner-execution-legacy.test.ts` 的固定 pre-owner EXE 迁移，以及 `knowledge-source-lifecycle-application.test.ts` 的固定 pre-source EXE 迁移；当前 runner 未提供对应历史 EXE，原 `skipIf(!existsSync(...))` 条件生效。本次没有新增跳过，也不把它们计入通过。

## 制品与公开通道

[正式发布](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.13)，Release ID `442619832`，公开时间 `2026-11-12T07:57:39Z`，稳定公开、非草稿、非预发布。标签指向上述源码；同一四附件在草稿/候选验收/公开之间保持 ID、大小、摘要一致。匿名 latest.yml、SHA256SUMS.txt 可读，旧 Python latest 仍为 327801733 / v1.0.2；不修改既有公开附件。

| 附件 | Asset ID | 字节 | SHA-256 |
| --- | --- | --- | --- |
| CBIM-Setup-0.1.13-x64.exe | 738526618 | 392550864 | `930224abdbdf15c33aed25943f4f083518b673380869a7d2c25453edcbf7d5c9` |
| CBIM-Setup-0.1.13-x64.exe.blockmap | 738528721 | 408867 | `73197fddef2fa7858322ddcbbc9f6b8ad782f348391b629cd15f2dce9e523005` |
| latest.yml | 738528843 | 348 | `7af5deb970446e5e50c9e5d83e03b27928e9749fabdd67f32bcc5a5ad9b874f9` |
| SHA256SUMS.txt | 738528981 | 270 | `43b2d2676859118316fab9ede19c8716d72e5da5e7f57fbe762703fa18f3c4ad` |

## 真实安装与升级

[候选安装 43176452491](https://github.com/nan023062/cbim/actions/runs/43176452491)，workflow=9195e3a2c9cc9a8340c12e50b1375a9743d6de81，previous_version=0.1.12，source_commit=9195e3a2c9cc9a8340c12e50b1375a9743d6de81，准确安装器 SHA 同上。隔离 Windows runner 无既有 CBIM 安装，全新安装、真实上一版覆盖升级、正常启动退出及十项数据保留通过；新旧 NSIS 真实缓存均存在且与安装器摘要一致。

[公开升级 43179146943 attempt 1](https://github.com/nan023062/cbim/actions/runs/43179146943/attempts/1)，workflow=0188c213a35b2f7faf4bafb1685959addee12f77，mode=online，transfer_expectation=differential。使用无凭据的真实已安装 0.1.12，由原定时器自动发现和下载公开 0.1.13；不替换请求、不修改 hosts/代理/TLS、不手工复制旧包缓存。

**0.1.12 → 0.1.13 实测安装包有效数据 3.10 MiB，对比完整 374.37 MiB 减少 99.17%，12 个 Range，零全量回退。** 原始精确值：3245505 / 392550864 字节。统计排除 blockmap、更新元数据、重定向和协议开销，仅代表本次制品与环境，不是普遍保证。重建完整包 SHA-256 与冻结公开安装器相同。

后台 ready 后保持旧版运行；关闭弹窗继续工作，普通退出不安装；重开只读取更新元数据，安装包请求为 0，复用完整有效缓存。真实 UI 点击“重启安装”后 NSIS 携带原测试用户目录重启到 0.1.13，isPackaged=true、NotSigned。

十项保留均通过：工作区、模型、已完成 task/run、localStorage、用户标记、知识/修订、业务文件、主 Agent 配置/修订、自动化定义、无业务重放。确定性模型仅请求 1 次，页面错误 0；该模型用于检查持久状态和无重放，不代表在线模型质量。

## 收尾与实际限制

官网及 README 按本次公开回执和真实传输结果更新，明确旧 0.1.10/0.1.11 或缺失准确缓存时仍可能全量下载。安装器总大小、缓存完整包与 NSIS 解压方式没有因此变小。

官网及验证资料经单独 develop → master PR、完整检查和 Pages 部署收尾；本机网站 14 场景、最终部署 run、六文件匿名对照和双主分支同步回执回填该收尾 PR，不为记录最终合并 SHA 制造递归提交。原始本轮证据位于 `test-results/release-013-20261112/`，原失败与后续成功分开保留。
