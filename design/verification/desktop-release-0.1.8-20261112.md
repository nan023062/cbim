# CBIM 0.1.8 公开发布与在线升级验收

日期：2026-11-12（Asia/Shanghai）。**0.1.8 已公开，真实 0.1.7 在线升级、普通退出取消及数据保留通过。** 发行模式继续采用用户此前明确选择的未签名个人开发版；没有把摘要校验当作可信签名。

## 范围与基线

- 用户直接要求检查草稿签名和完整发布流程后发布；没有新增或关闭其他开发工单，不包含开放 Issues #36–#45。
- 构建源码：`23faa8bf73235793482cb615e4ef95de2a84c867`；发布 PR [#46](https://github.com/nan023062/cbim/pull/46) 的准确 head 为 `69bce86d4c3f247e470ad238d8b86dec91d33733`，base 为 `0c752c52c61c3a507be346560ff3e7addc93eb79`，正常 merge 为 `b104305c4f2edebdcc8416af92b530c4f59c088b`，原提交历史保留。
- `desktop-v0.1.8` 的 peeled commit 是冻结构建源码；已核实其为 master 祖先。构建后差异限于测试、验收脚本、维护资料和原官网元数据；产品、依赖、构建配置、品牌、运行白名单资料和内置更新说明不变。
- Forge 复制整个 design/docs/legal：包内维护资料和更新说明仍为构建时冻结文本（包含候选阶段措辞），不宣称它们与后续仓库报告字节一致。公开页明确真实发行与验收状态，没有修改已核验制品追补文案。
- 原 [基线对齐与候选验收](desktop-018-alignment-20261111.md) 作为候选阶段历史记录保留。本轮未重建或替换安装包。

## 签名、制品与漏项补齐

- 安装器与主程序实际 ProductVersion 均为 0.1.8，Authenticode 均为 `NotSigned`；未签名 updater 配置没有 publisherName。重新执行 `pnpm verify:desktop <原候选目录> --unsigned`，含公开前复核，资源/47 项 payload/四附件和 SHA-512 元数据核验通过。
- 补齐原候选缺少的真实打包 EXE 六场景隔离：文件边界、禁网、超时、取消、非零退出、输出上限，均符合预期；自有进程、临时目录及隔离配置均回收。EXE SHA-256：`61fcbecd3e9a28e331129fe28d79675d566dd0b02eadde6310a08fd470c073fc`。
- 原 [候选安装 run 43054938501](https://github.com/nan023062/cbim/actions/runs/43054938501) 为同一附件，全新安装及真实 0.1.7→0.1.8、10 项保留/无重放检查通过；本机用户安装未被操作。

## 完整 PR 验证

[run 43083159447](https://github.com/nan023062/cbim/actions/runs/43083159447) 在准确 PR head/base 上完成四个 `Windows validation (1/4)` 至 `(4/4)`，全部成功；各片均执行锁定依赖、类型、架构、品牌、官网构建及完整测试切片。

下载四份 JSON 去重汇总：**396 文件，2686 用例，2684 通过、0 失败、2 跳过**。两项跳过为 `knowledge-source-lifecycle-application.test.ts` 与 `owner-execution-legacy.test.ts` 中需要 2026-11-07 固定历史 EXE 的场景；不是本次 0.1.7 在线升级的跳过，不用当前包冒充旧格式证据。完整四片已代替此前仅本地回归/补测的发布缺口。

## 公开回执与四附件

- Release ID **441899473**，公开时间 `2026-11-11T19:17:56Z`，`draft=false`、`prerelease=false`、`make_latest=false`；[公开发布页](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.8)。
- 旧 Python latest 保持 `327801733 / v1.0.2`；桌面通道仍独立使用 desktop-v 标签。
- 匿名读取 latest.yml 与 SHA256SUMS.txt，字节与本地候选一致；安装下载地址可匿名读取、总字节数匹配。真实在线验收另对完整下载缓存核对 SHA-256。

| 附件 | Asset ID | 字节数 | SHA-256 |
| --- | --- | --- | --- |
| CBIM-Setup-0.1.8-x64.exe | 736043070 | 391317752 | `170d53bd03122efb5684dade60217c6290497e082c222ed84335f2fc92154883` |
| CBIM-Setup-0.1.8-x64.exe.blockmap | 736045355 | 407759 | `2fefcb02a07f4a76db20eee40204b31f48272be630bfd8993caa1789bb20e74b` |
| latest.yml | 736045625 | 345 | `43fcb3600146a1bd04619e725c25b40f479dc378ccfbd1b51f45c63109bcf4fc` |
| SHA256SUMS.txt | 736045793 | 268 | `9a7a620dab0d1118d57374fdfa7571695905ac84fe4e1eb380de877912b94b73` |

## 真实在线升级

[run 43085968933](https://github.com/nan023062/cbim/actions/runs/43085968933)，workflow head `b104305c4f2edebdcc8416af92b530c4f59c088b`，mode=online，previous_version=0.1.7，source_commit 为冻结构建提交，安装包 SHA-256 为 `170d53bd03122efb5684dade60217c6290497e082c222ed84335f2fc92154883`。

- 无原 CBIM 安装的独立 Windows runner，安装真实公开 0.1.7；客户端没有继承 GitHub token。
- 旧客户端自动发现 0.1.8，通过真实 UI 下载；完整缓存摘要匹配。
- 自动安装前普通退出后仍为 0.1.7，没有安装已下载的缓存包；再次打开，由真实按钮重新发起下载并自动安装重启。
- 新进程带 `--updated` 与原 `--cbim-user-data-root`，实际版本 0.1.8、isPackaged=true、NotSigned，更新检查最终为 current。
- 原工作区、完整模型目录、同一已完成 taskId/runId、localStorage、标记文件、知识文件及版本、业务文件、主 Agent 选型及修订、手动自动化定义均保留；自动化运行仍为空。全程仅 1 次原模型请求，零业务重放、零页面错误。

## 官网与交付记录

官网 release.json 的版本、发布时间、安装包身份、大小、摘要和 signed=false 均取自上述公开回执；首页、下载页与 README 更新为 0.1.8。Search Console、canonical、robots 与 sitemap 保留。部署仍由 master 的现有 GitHub Pages 工作流执行，目标 https://nan023062.github.io/cbim/ 。本报告随官网 PR 提交；该 PR 的完整检查、合并和对应 Pages run 关联最终 head 与部署回执，避免为回填 SHA 不断产生新发布提交。

官网本地验证：`node scripts/build-brand-assets.mjs --check`、设置 `CBIM_WEBSITE_URL=https://nan023062.github.io/cbim/` 后执行 `node scripts/build-website.mjs` 均通过；`node scripts/website-smoke.mjs` 为 14 场景、0 错误，覆盖 320/390/1280px、深浅色及离线独立页面。按仓库属性统一官网源文件 LF，保留初次构建证据，再核对最终六文件摘要，避免 Windows/Linux 换行差异影响匿名部署比对。

原始证据根目录：`test-results/desktop-release-018-20261112/`。包括签名、制品重核、六场景隔离、完整 CI 四片、公开追加日志、匿名资源、在线升级报告/截图和官网核验。候选失败历史仍保存在上一轮证据目录，没有被成功结果覆盖。既有其他工作分支不因本次发行被批量删除。
