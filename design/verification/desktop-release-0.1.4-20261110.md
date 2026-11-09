# CBIM Desktop 0.1.4 发布记录

## 交付与范围

[desktop-v0.1.4](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.4) 已公开；[PR #25](https://github.com/nan023062/cbim/pull/25) 在完整 CI 通过后正常合并，真实 0.1.3 自动升级及普通退出取消通过。官网同步的收尾 PR、master 部署与最终双分支回执集中记录于 PR #25 的交付评论，不为填写自身提交 SHA 反复提交文档。

- 用户于 2026-11-10 授权“合并 发布”，沿用已明确选择的 Windows x64 未签名个人开发发行。仓库 nan023062/cbim、账号 nan023062、默认 develop；安装验收仅使用隔离 runner。
- 起始 develop 为 d5644e3f668b5fca42875f6a2c2374a9498c8e45，master 为 5fe52e74f57f0363299381fd050e799d637723c9；开始时无打开 PR 或 0.1.4 草稿。旧 Python latest 基线为 Release 327801733 / v1.0.2，发布后保持不变。
- 四项独立功能提交：bbc6a40b（花名册退役）、e3de619a（Schema/模板）、953aab73（责任/缺口）、d5644e3f（实例提示）。此前受影响单元证据见[反馈修复记录](empty-project-feedback-20261110.md)。本轮不声称修复尚未复现的反馈工具缺失、偶发 fetch failed 或实例重启原因。

## 准备与失败修正

- 发布准备版本/内置日志为 0.1.4，验收输入明确上一版 0.1.3，支持其自动安装交互；0.1.1/0.1.2 保留两步交互。自动安装取消场景在真实两秒窗口正常退出，未修改产品计时器，也未以直接运行安装器替代线上操作。
- 19 项 desktop-acceptance-inputs 测试通过；语法、类型、架构/依赖（1159 文件、6006 依赖、0 环）、品牌及带正式域名的官网构建通过，发布资料三入口同步。官网在公开和线上升级验收前保持 0.1.3。
- [首轮完整 CI 42694782113](https://github.com/nan023062/cbim/actions/runs/42694782113)：364 文件/2530 项，2516 通过、12 失败、2 跳过。失败来自来源生命周期夹具仍提交 peopleUpserts/maintenance、两个 discover 消费者仍只允许一个缺口、统一工具断言遗漏 object preview v2，以及旧任务准备仍要求 PERSON_NOT_FOUND。
- 分别独立提交 51d363fa、b1dbea69、f7ed56fe、5c378437 更新测试：当前/固定历史 EXE 输入显式区分；保留来源代次、恢复、幂等、独立模型、无能力/凭据泄露及逐调用授权断言；真人字段仅保留历史说明，不生成花名册。没有回退产品契约或新增跳过。
- 对应定向命令均为 `pnpm exec vitest run <明确测试文件> --reporter=default --reporter=json --outputFile=<独立报告>`：来源 application/fault/process 与 legacy 8 通过、2 原有跳过；责任 tools 9 通过、owner application 2 通过；unified-tool-policy 6 通过；team-workflow 3 通过。累计 28 通过、2 原有跳过，类型检查通过。详细选择依据和实际命令见开发记录，未在本机跑全仓测试。
- 原四片报告保存在 `test-results/desktop-0.1.4-ci-initial-42694782113/`；中间 run 42697185690 因新 head 被取消，不作为完整检查证据。草稿创建后首次列表短暂未返回，按同一 ID 核实后继续，没有重复创建。

## 冻结候选与完整 CI

- 冻结源码/标签目标：`6ba2d64f0b3f13ba203a0250de314f3fc99f7cf5`；时间戳 `20261110-043738`（Asia/Shanghai）。候选绝对目录 `C:\XDTWorkspace\cbim-ai\build\desktop-release\0.1.4\unsigned-20261110-043738-09b95377`；实际打包目录 `C:\XDTWorkspace\cbim-ai\build\unsigned-20261110-043738-09b95377\CBIM Assistant-win32-x64`。
- 主 EXE SHA-256 `2bf2a061067c906246d06b569948c0aba521505271f2c2abd3b8547ff29d6588`；app.asar SHA-256 `108ae7d5adbf10e2b9765275d466d603e39ebd14bab54b6e9e223acdd8aa7298`。14 个 PE payload、资源及附件摘要在 build-receipt.json；构建期间源码保持干净，后续只有 tests/ 与外部 design 记录变化，逐文件依据见 `test-results/desktop-0.1.4-source-comparison.json`。
- `pnpm make:desktop --unsigned` 与发布前重新 `pnpm verify:desktop <候选> --unsigned` 通过；明确 unsigned，安装版真实验签 NotSigned。没有伪造 publisherName。
- 显式指定本候选主 EXE 运行 `pnpm exec tsx scripts/isolated-node-smoke.mts`，文件边界、禁网、超时、取消、非零退出、输出限制六项通过，自有资源回收完成；报告 `test-results/desktop-0.1.4-isolation-6ba2d64f.json`。
- [最终完整 Windows CI 42697531710](https://github.com/nan023062/cbim/actions/runs/42697531710)，head `5c378437effb64c8734054499375b58f179b6c68`，四片全部成功；364 文件/2530 项，2528 通过、0 失败、2 跳过。类型、架构/依赖、品牌、官网构建均通过；四片报告 `test-results/desktop-0.1.4-ci-final-42697531710/`。
- 两项原有跳过：owner-execution-legacy.test.ts 的 pre-owner 日志迁移、knowledge-source-lifecycle-application.test.ts 的 pre-source EXE 迁移；真实固定历史 EXE 不存在。未用新版或替身冒充旧版迁移。
- PR #25 于 2026-11-09T21:06:41Z 正常合并到 master，合并提交 `d96244bdef77909aea9ecc4fee9aa934d13252ab`，保留独立提交；合并树与完整验证 head 树一致，冻结源码为其祖先，所有产品/构建输入未变。没有 squash、强推或管理员绕过。

## 安装、公开与真实线上升级

- [候选安装 42695642991](https://github.com/nan023062/cbim/actions/runs/42695642991)：干净 Windows runner，实际全新安装与 0.1.3 覆盖升级通过；isPackaged=true、版本 0.1.4、NotSigned，结束于 2026-11-09T20:47:57.952Z。报告 `test-results/desktop-0.1.4-candidate-42695642991/`。
- 唯一 Release 439619815，标签 `desktop-v0.1.4` 指向冻结源码；2026-11-09T21:07:47Z 公开，draft=false、prerelease=false、make_latest=false。旧 Python latest 保持 327801733 / v1.0.2，没有替换历史附件或移动旧标签；候选内 staged-publish-journal.jsonl 保存意图及回执，github-published.json 保存公开详情。

| 公开附件 | 字节数 | SHA-256 | Asset ID |
| --- | ---: | --- | --- |
| CBIM-Setup-0.1.4-x64.exe | 136134262 | `5a4869ba63e08da1da982a732c6e32c7296890a3006914f3c2e7f0baf10c61a6` | 728908273 |
| CBIM-Setup-0.1.4-x64.exe.blockmap | 144013 | `d3d2a4df2895653b3a9bf808bf437b32eb95954ab02f82becc8c427871a1d72c` | 728908942 |
| latest.yml | 345 | `cf7a82682028bf01c882cf8c3959934c0f479b05ec7562a11dfb9e40aefb21fb` | 728909099 |
| SHA256SUMS.txt | 268 | `649d8435dff305c645a22646ad512496112baf2291d4fb32578f4ca4f88ed917` | 728909219 |

- 四附件均 uploaded，远端 digest 与本地一致；latest.yml 中安装包 SHA-512、大小和 SHA256SUMS 对应通过原制品校验。四附件匿名实际下载全部 HTTP 200、大小/摘要一致，完成于 2026-11-09T21:09:57.084Z，报告 `test-results/desktop-0.1.4-anonymous.json`。
- [真实线上升级 42699632244](https://github.com/nan023062/cbim/actions/runs/42699632244)：workflow ref=desktop-v0.1.4、workflow SHA=冻结源码，mode=online、previous_version=0.1.3、source_commit=冻结源码、installer_sha256=上述安装包摘要。GH_TOKEN/GITHUB_TOKEN 未传入安装器/客户端。
- 无凭据旧版实际发现 → UI 点击下载 → 缓存摘要核对 → 安装前普通退出保持 0.1.3 → 独立重开再下载 → 自动安装并重启到 0.1.4。normalQuitDidNotInstall=true、onlineDiscoveryDownloadAndInstall=true；结束于 2026-11-09T21:11:24.219Z，证据 `test-results/desktop-0.1.4-online-42699632244/`。
- 新进程真实携带 --updated 和原 --cbim-user-data-root；窗口稳定后正常关闭并复核已安装版本。候选和线上均保留工作区、模型、同一 completed task/run、localStorage、文件标记及无重放；modelRequests=1、pageErrors=[]，新版最后状态 current。确定性模型仅验证对话持久化/无重放，不代表在线模型质量验收。

## 官网与维护交接

- website/release.json 的版本、公开时间、文件名、大小及摘要均来自上述公开回执，signed=false；首页、下载页、FAQ、README 同步真人机制退役、空项目修复和实际升级行为。保留 Search Console、canonical、robots 与 sitemap。
- `pnpm check:brand`、`CBIM_WEBSITE_URL=https://nan023062.github.io/cbim/ pnpm build:website`、`node scripts/website-smoke.mjs` 通过。14 个深浅色、320/390/1280 px 及独立离线场景，页面错误零，无横向溢出，下载链接与摘要正确。旧官网报告已保留于 `test-results/branding-website-before-0.1.4-20261110/`，本次报告 `test-results/branding-website/website-report.json`。
- 官网/收尾资料沿 develop → master PR 检查和正常合并，再由既有 Pages 工作流部署；部署实际 head/run/URL、六个匿名文件字节一致性与最终本地/远端 master/develop SHA、默认 develop/仅两分支事实，在 PR #25 最终回执集中核实，不以本机预览代替线上部署。
- 发布脚本已覆盖真实 0.1.3 自动安装，三宿主发布 Skill 的恢复与证据文案同步，4 文件 × 3 入口逐文件一致。此次 CI 修正及发布收尾无 src 变化；产品功能的注释/契约/类图由原四项提交同步，未因文档重新构建公开包。
- 用户当前 0.1.3/0.1.4 每分钟检查，主动点击下载后自动安装；0.1.2 及更早仍按旧交互。关闭/离线用户需启动联网，不能声称所有用户已收到或升级。未签名是明确选择，摘要不替代可信签名；后续签名需更高版本和真实迁移验收。
- 下一版验收须明确支持届时上一公开版 0.1.4；本轮脚本只接受已实际覆盖的 0.1.1/0.1.2/0.1.3 旧版输入，不能直接复用旧回执。原现场反馈工具/网络/重启异常仍未复现，保持限制；不恢复暂停的功能计划。
