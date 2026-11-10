# CBIM 0.1.6 发布验收

## 交付范围与来源

用户直接报告 BUG 并纠正业务语义，未虚构新 Issue：Pi、Claude Code、Codex 默认存在；供应商只管理统一模型目录；对话栏和 Agent 页面等效，前者设置工作区主 Agent。用户已授权 PR、合并与发布，沿用明确的 Windows x64 未签名个人开发发行模式。完整代码导读、职责边界及受影响注释/16 份架构资料见[开发验证](engine-model-separation-20261110.md)。

- 仓库/执行账号：nan023062/cbim / nan023062；默认分支 develop，稳定及官网部署分支 master。
- 基线：d8fd91f47e14a9694e398b43606e13afbc1e875f；源码冻结：ca31e017d67cb12f15c8d2452230346cdc683f6c。
- [PR #32](https://github.com/nan023062/cbim/pull/32) 正常 merge，提交 61c46d4f839d952a6eadeb31c35aca63e327a732；合并树与冻结树完整比较相同，没有 squash 或管理员绕过。
- 本机 develop 的并行文档/运行资料整理 a5938170cf9675b69960dde6a9bb535eb845bdd8 保留，不纳入本次修复。此前用户同意的 812bec16 已在 0.1.5 基线中，不重复合并或重写。
- 旧桌面版 desktop-v0.1.5 / Release 439994358；旧 Python latest 327801733 / v1.0.2 在公开前后均未改变。

## 同一候选与四附件

- 候选目录：`C:\XDTWorkspace\cbim-ai\build\engine-menu-0.1.6-20261110\build\desktop-release\0.1.6\unsigned-20261110-160652-ab62886f`；完整清单位于其中 build-receipt.json。
- buildStamp：20261110-160652（Asia/Shanghai）；packagedDirectory：`C:\XDTWorkspace\cbim-ai\build\engine-menu-0.1.6-20261110\build\unsigned-20261110-160652-ab62886f\CBIM Assistant-win32-x64`。
- 主 EXE SHA-256：`2aa3ec2c4b5e43b8d9ff8193b505097864f53dd772a3222fc2824028d7877f2b`。47 个 Windows payload 与 app.asar、app-update.yml、desktop-release.json 的实际摘要保存在构建回执。
- 显式 pnpm make:desktop --unsigned，候选生成后及公开前分别 pnpm verify:desktop <该候选> --unsigned，通过。同一制品实际签名状态 NotSigned；不伪装 publisherName，不操作开发者已安装 CBIM。
- 唯一 Release ID 440090082，公开时间 2026-11-10T08:22:54Z，稳定版、非草稿。[公开下载](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.6)。注解标签对象 95050ece66a397f85c25d9826193040387663c6b，peeled commit 为冻结源码。

| 附件 | 字节 | SHA-256 | asset ID |
| --- | ---: | --- | ---: |
| CBIM-Setup-0.1.6-x64.exe | 391369030 | de23dfaafa0cb2c18129496e10b556cdea3153a3cb8b1ee2d563f1eed3911d20 | 730636836 |
| CBIM-Setup-0.1.6-x64.exe.blockmap | 407615 | f1a86b06902b74d3f0cc2bdee94b67124772bb439f8bd7eeff4cca42974d9339 | 730639211 |
| latest.yml | 345 | 4104e40fd9d17509a6b79951d509128766a7ef62328daf243d09db907ad0a635 | 730639330 |
| SHA256SUMS.txt | 268 | 4340a690bdf07f3f40a9d279e90309c81c4fec36e1552e3afeb39f4f50ae37d6 | 730639448 |

四附件远端 state=uploaded；与本地候选大小/摘要一致。未登录 curl 下载完整四附件再次比较全部一致，latest.yml 安装器 SHA-512 和大小也由 verify:desktop 核对。公开 PATCH 明确 make_latest=false。

## 实际验证

| 验证 | 结果与边界 |
| --- | --- |
| 开发受影响单元 | 99 项不同产品用例 + 23 项发布输入检查；9 项真实浏览器组件交互通过。命令和一次测试构造修正见开发验证，不隐去原失败。 |
| 静态检查 | pnpm typecheck、pnpm check:architecture（55 目录、604 代码/样式文件；1192 检查文件、6132 依赖、0 循环）、品牌及官网构建通过。 |
| [完整 Windows 四片 CI](https://github.com/nan023062/cbim/actions/runs/42780231784) | 精确 head ca31e017d67cb12f15c8d2452230346cdc683f6c，376 文件、2599 用例，2597 通过、0 失败、2 原有跳过。每片保存 JSON 报告。 |
| 真实发行 EXE 三引擎 UI | Pi→Claude Code→Codex→Pi→Codex→Codex 六轮完成；Pi 与 Claude Code 共享一个 Anthropic 模型供应商；主 Agent 对话栏/团队页双向同步、草稿保留、静态 Agent 默认 Claude Code 与岗位独立 Codex、重启无重放通过。0 页面错误。 |
| 真实发行 EXE 隔离 | 文件边界、禁网、超时、取消、非零退出、输出限制六项通过；所属资源清理完成。 |
| [候选安装](https://github.com/nan023062/cbim/actions/runs/42780830205) | workflow/source ca31e017d67cb12f15c8d2452230346cdc683f6c，全新安装与真实 0.1.5→0.1.6 安装升级通过；isPackaged=true、NotSigned，六项保留、1 次确定性模型请求、0 页面错误。 |
| [公开在线升级](https://github.com/nan023062/cbim/actions/runs/42782241422) | workflow 61c46d4f839d952a6eadeb31c35aca63e327a732；previous_version=0.1.5，mode=online。旧客户端无 GitHub 凭据自动发现 → 实际 UI 下载/校验 → 自动安装重启到 0.1.6 通过；独立普通退出取消安装场景通过。 |
| 升级保留 | 原工作区、模型、同一个 completed task/run、localStorage、文件标记与无重放全部通过。新进程带 --updated 和原 --cbim-user-data-root；1 次模型请求，0 页面错误。 |
| 官网本机验收 | 公开回执生成 website/release.json；首页、下载日志/FAQ、README 修正供应商与引擎关系。pnpm check:brand、正式域名 pnpm build:website 与 node scripts/website-smoke.mjs 通过：320/390/1280 px、深浅色与两页独立离线，共 14 场景，0 页面错误/溢出。 |

两项 CI 跳过分别为 owner-execution-legacy.test.ts、knowledge-source-lifecycle-application.test.ts：runner 缺少指定的历史 EXE；没有新增跳过。候选与在线升级是独立 runner 的真实安装验证，不冒充这两项历史恢复用例。模型响应为确定性测试服务，原生引擎/执行/界面是真实路径，不等于在线供应商模型质量验收。测试与代码自查不等于人工 review 已接受。

## 资源与收尾边界

冻结源码与 PR #32 合并树完全相同。后续官网/验收回填仅改 website、README 和开发记录/验证文档，不改产品、依赖、品牌、内置版本日志或构建配置。Forge 会复制整份 design/docs，因此安装包保留冻结时的开发记录副本；不能把后续仓库记录和全部包资源说成字节一致。实际 Builtins 的 22 项运行资料与候选逐项比较完全一致，revision 7709f57a6f1b3ead50af893773a044adf854fcab1178a74e150043238bea899d。

官网收尾 PR 的完整 CI、master Pages 部署、匿名六文件摘要及远端 master/develop 快进同步，统一附在 [PR #32 的发布回执](https://github.com/nan023062/cbim/pull/32)，避免为记录自身提交 SHA 连续提交。保留本机分叉 develop 与其他已有 worktree，不强推或重置。源码实现文档在 src；本记录仅保留本次可核查的发布事实。

## 原始证据与恢复记录

本机原始证据在修复 worktree 的 `test-results/desktop-0.1.6-20261110/`：candidate.json、journal.jsonl、构建与四附件回执、engine-ui-1/report.json、isolation-1.json、CI 四片、候选/在线 runner 报告及截图、anonymous-assets.json、builtin-resource-comparison.json。官网本机结果在 test-results/branding-website/website-report.json。云端 artifact 与各 run ID 关联。

创建草稿后按 tag 查询返回 404；没有重建 Release。随后通过有权限的列表查得唯一 ID 440090082，并按 ID 核实草稿、上传、公开。原响应与恢复回执分别保留。匿名大文件首次连接等待后成功完成，没有替换附件或重发版本。

当前 0.1.6 每分钟检查更新，用户点击下载后自动安装；关闭或离线用户需启动并联网，不能声称所有用户已经升级。未签名限制如发布说明，后续签名使用更高版本。用户正在使用的客户端未被本次验收安装或停止。
