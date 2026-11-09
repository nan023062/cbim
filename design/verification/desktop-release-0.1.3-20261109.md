# CBIM Desktop 0.1.3 发布记录

本次用户授权：PR #23 全部 CI 通过后合入 master，并发布新版；继续使用此前明确的未签名个人开发发行。Windows x64，仓库／账号为 `nan023062/cbim`／`nan023062`，默认开发分支 develop。既有用户安装不作为测试目标。

## 范围与基线

- 功能提交：#14 `20cb43c`、#17 `b5b3916`、#18 `ce13fe1`、#19 `ecde044`、#20 `a6b724e`、#21 `db595f6`、#22 `74bfbd6`；发布 Skill `67224e6` 与开发验证流程 `3ed0d7e`。各自开发时的证据见开发记录，不当作本次完整发布验收。
- PR #23 起始 head `3ed0d7e9acc2c589a7da71d6e5fe6daba8928a8f`，base `1774026684dcab47e512e381f1761368a788cf39`；初轮完整 run `42639651567` 最终失败（363 文件、2505 项：2484 通过、19 失败、2 跳过），原结果保留；修复后以新 head 重新完整检查，见下方正式回执。
- 真实上一公开桌面版为 0.1.2。独立旧 Python latest 的基线为 Release `327801733`／`v1.0.2`，不得改变。
- 更新验收输入明确 previous_version=0.1.2；当前脚本只支持 0.1.1／0.1.2 的两步升级界面和更高的未签名 0.x 目标。自动安装旧版、签名或 1.x 目标仍需适配。

## 准备验证

- `tests/desktop-acceptance-inputs.test.mjs`：1 文件、16 项通过，覆盖两模式、旧版缺失／不支持、同版／降级和制品身份拒绝；报告 `test-results/desktop-0.1.3-inputs.json`。
- `node --check scripts/desktop-release-acceptance.mjs`、工作流输入解析和 diff 检查通过。
- 依赖检查：1158 文件、6004 条依赖、0 环；发布 Skill 及受影响引用同步三个入口。
- 此时未运行本机全量回归、安装或发布。后续需记录唯一候选 source SHA、四附件、候选与线上升级 run、公开 ID、标签、官网及分支同步事实，不将受理状态当作验收通过。

## 初轮 CI 失败与修复

- 第 2 片：知识契约夹具只允许 refresh v2，遗漏 #14 的 module registry/get v2，三场景在后续真实工具调用前中断。按真实契约修正后，知识契约 3 项定向通过。
- 第 1／3／4 片：Team 主轮误用业务写独占，beforeRun 内的人工、成员暂停和检查点核实无法取得短读占用，影响观察证明也因此变化。按当前／冻结协作模式领取业务占用；Team 只读，Auto 写入或待批写入仍独占，不调整 WorkspaceExecutionLease 的保护规则。
- 六份相关集成测试共 28 项通过，覆盖人工接续、产物移动、影响核实与重规划、成员暂停、检查点链及 Auto 直接执行；报告 `test-results/desktop-0.1.3-recovery-targeted.json`。类型与架构检查通过，知识契约报告为 `desktop-0.1.3-knowledge-contract.json`。
- 废弃候选：`build/desktop-release/0.1.3/unsigned-20261109-230433-379e5844`，source `6dd5547aab606f0038b8d21a6b32fba634136da7`；构建、校验与真实 EXE 六项隔离通过，但随后产品修复使其不再可发布。未上传、未建草稿、未发布标签，必须生成新候选。

## 正式候选与完整 CI

- 冻结源码和标签目标：`11c2a76614640c0318fbe9098192f1e6c6b6cf59`；构建时间戳 `20261109-231430`（Asia/Shanghai）。唯一正式候选 `build/desktop-release/0.1.3/unsigned-20261109-231430-791acb01`，其 `build-receipt.json`、`staged-publish-journal.jsonl` 及 `github-published.json` 保存构建、写入意图和实际回执。
- 打包目录：`C:\XDTWorkspace\cbim-ai\build\unsigned-20261109-231430-791acb01\CBIM Assistant-win32-x64`；主 EXE SHA-256 `f263427f3aa5cfaccb9398cf71360574402c202a7096980d35d4c66452a05637`，14 个 PE payload 和三个关键资源摘要在构建回执内；app.asar SHA-256 `cad2a67a492f4a800f24c3ec19b02ffef830b9a59a23c960c7caf9e18cecb8a1`。显式 unsigned，runner 验签为 NotSigned。
- 重新构建／制品核验通过；真实 EXE 文件、网络阻止、超时、取消、非零退出、输出限制六场景通过，自有资源回收完成。原始证据 `test-results/desktop-0.1.3-build-11c2a76.log`、`test-results/desktop-0.1.3-isolation-11c2a76.json`。
- [完整 Windows CI 42642627916](https://github.com/nan023062/cbim/actions/runs/42642627916) 对准确 head `11c2a76614640c0318fbe9098192f1e6c6b6cf59` 四片均成功，364 文件／2521 项：2519 通过、0 失败、2 跳过；类型、架构／依赖、品牌及构建检查通过。本机只运行上述受影响测试，完整回归由 PR 自动化执行。
- 两项原有跳过：`owner-execution-legacy.test.ts` 的旧负责人运行迁移、`knowledge-source-lifecycle-application.test.ts` 的旧知识来源迁移，前置的真实历史 EXE 不存在；未新增跳过，不以替身声称已验收历史迁移。四片原始报告存于 `test-results/desktop-0.1.3-ci-42642627916/`。
- [PR #23](https://github.com/nan023062/cbim/pull/23) 在 2026-11-09T15:26:51Z 正常合并至 master，合并提交 `952dff7352b42df3f7b3cebfa02c691b5a6efd1e`，保留 11 个提交；产品和构建输入与冻结源码相同，合并树与源码树一致。

## 候选安装、公开与实际用户升级

- [候选安装 42643415710](https://github.com/nan023062/cbim/actions/runs/42643415710)：干净 Windows runner，全新安装及真实 0.1.2 覆盖升级成功，版本 0.1.3、isPackaged=true、签名 NotSigned；结束于 2026-11-09T15:23:30.678Z。
- 唯一 Release `439290012`，标签 `desktop-v0.1.3` 指向冻结源码，2026-11-09T15:28:16Z 公开，draft=false、prerelease=false、make_latest=false；[发布页面](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.3)。没有替换公开附件或移动旧标签，旧 Python latest 保持 `327801733`／`v1.0.2`。

| 公开附件 | 字节数 | SHA-256 | Asset ID |
| --- | ---: | --- | --- |
| CBIM-Setup-0.1.3-x64.exe | 136119428 | `4da2a1f05f376dd86687e415624dac79d93136e1e4e0a144803bbf797d828a56` | 727937068 |
| CBIM-Setup-0.1.3-x64.exe.blockmap | 144188 | `372458d49a105e3d1678a40bf69115434439ff29edb435db97e1f1fbbea2dbf9` | 727937824 |
| latest.yml | 345 | `50934f2c8f0350c983c3fe36ff9e6e96c6544a254510b5b34a026ed0967de594` | 727937996 |
| SHA256SUMS.txt | 268 | `a6fdff3c181c99080cfde33c15243ee360d82befdceea767a7c6f18bbd72a540` | 727938190 |

- 四附件均 uploaded，远端 digest、本地制品和匿名实际下载摘要一致；`latest.yml` 的安装包 SHA-512 与 SHA256SUMS 对应由发布前核验检查。无凭据下载回执 `test-results/desktop-0.1.3-anonymous.json`，完成于 2026-11-09T15:30:36.011Z。
- [真实线上升级 42645170393](https://github.com/nan023062/cbim/actions/runs/42645170393)：mode=online、previous_version=0.1.2、source_commit 为上述冻结 SHA，installer_sha256 为上述安装包摘要；workflow head 同一源码。无 GitHub 凭据的旧版自动发现 → 实际 UI 下载及缓存校验 → 独立普通退出不安装 → 重开旧版后下载并确认重启 → 新版真实进程成功。结束于 2026-11-09T15:33:23.695Z。
- 新进程携带 `--updated --cbim-user-data-root`，使用原测试用户目录；工作区、模型、同一已完成 task/run、localStorage 与文件标记全部保留，无业务重放。候选和线上报告均 modelRequests=1、pageErrors=[]；线上 normalQuitDidNotInstall=true、onlineDiscoveryDownloadAndInstall=true。原始证据分别在 `test-results/desktop-0.1.3-candidate-42643415710/`、`test-results/desktop-0.1.3-online-42645170393/`。

## 官网、维护交接与限制

- 官网版本、发布时间、文件名、大小和摘要均取自上述真实公开回执；首页、下载页、FAQ、README 和发布指南同步 0.1.3 的实际行为，保留 Search Console、canonical、robots 和 sitemap。品牌核验及带正式域名的官网构建通过，14 个深浅色／320、390、1280 px／独立离线场景通过，页面错误 0，链接和摘要正确；原报告归档保留，本次报告 `test-results/branding-website/website-report.json`。
- 官网与收尾文档从 develop 经 PR 检查合入 master，再由既有 GitHub Pages 工作流部署；部署实际 head、六个匿名文件的字节一致性、收尾 PR 和最终双分支身份集中回填 [PR #23 的交付回执](https://github.com/nan023062/cbim/pull/23)，避免反复提交只用于填写自身 SHA 的文档。源码与制品仍固定上述身份，官网文档提交不重新发包。
- 本轮产品修复已同步 `execution.ts` 注释、main 的 CONTRACT／ARCHITECTURE；收尾只改官网和维护说明，无 src 变更。发布 runbook 三宿主保持一致。
- 未签名是用户明确选择的个人开发发行；摘要不能替代可信签名，未来签名迁移必须使用更高版本并实际验收。本轮只安装隔离 runner，未操作开发者或用户现有安装。
- 当前仍为 0.1.2 的用户启动约 10 秒后及每 30 分钟检查，也可主动检查；下载后需再点重启。升级后 0.1.3 每分钟检查，下一版下载后自动安装。关闭／离线用户需启动联网，不能据此声称所有用户已收到或升级。
- 下一版发布前须适配当前仅支持 0.1.1／0.1.2 两步界面的验收脚本，真实覆盖 0.1.3 的自动安装路径；不要套用本次脚本或回执。
