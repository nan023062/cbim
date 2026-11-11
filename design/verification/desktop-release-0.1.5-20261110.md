# CBIM Assistant 0.1.5 发布验收

## 授权、范围与基线

- 用户要求三项需求全部完成后提交 PR、合并并发布新版本。范围为主 Agent 默认执行、Claude Code 和 Codex 三引擎、Agent/岗位/主对话引擎与模型菜单。
- 沿用已确定的个人开发阶段未签名发行选择（发布指南记录的 2026-11-09 用户决定）；不替换历史附件，之后签名迁移使用更高版本。
- 仓库及登录身份：nan023062/cbim、nan023062；默认 develop，稳定分支 master。开始时双方同为 fcb7774a，远端没有其他分支或开放 PR。
- 真实上一公开桌面版 0.1.4，Release ID 439619815；旧 Python latest ID 327801733 / v1.0.2 必须保持。
- 功能提交 a4472ecb。三个需求共享配置、工具与调度契约，合并为一个完整功能提交；已有开发测试的实际命令与边界见 Claude/Codex 专项记录及开发日志。

## 发布准备与验证

- 更新版本为 0.1.5，新增内置版本日志。0.1.4 延续 0.1.3 自动更新交互，验收输入新增明确枚举并保留未知版本拒绝；候选和公开升级均指定 previous_version=0.1.4。
- 新增定向验收输入回归，检查 0.1.4 → 0.1.5、同版拒绝和未知旧版拒绝。`pnpm exec vitest run tests/desktop-acceptance-inputs.test.mjs --reporter=default --reporter=json --outputFile=test-results/desktop-0.1.5-20261110/acceptance-inputs.json`：21 项通过；`pnpm check:brand` 与正式域名 `pnpm build:website` 通过（公开数据仍保持 0.1.4）。
- PR #30 首轮完整 Windows 四片 42760689921 已失败：2505 通过、78 失败、2 项原有历史 EXE 前置缺失跳过。原始四片报告完整保留，当前修复并定向复验；候选安装、公开升级与官网分发尚未完成。

## 当前接续

0.1.5 已公开；准确候选的全新安装、完整 CI、PR #30 合并及真实 0.1.4 在线升级均已完成。官网内容、品牌构建与 14 场景验证已通过；官网收尾 PR、master 部署、匿名六文件与双分支的最终回执集中附于 PR #30，避免为补填最终 SHA 重复产生记录提交。下列候选/失败记录是过程历史，最终结果见文末。

## 首轮候选与桌面专项

- 源码 91e61d564ec75ce609858d113dee74ad1cc5b078 构建 unsigned-20261110-131257-1609cc67，47 个 PE payload；构建完成且内部核验通过。该候选因协作模式提示仍描述旧默认执行者而退出发行候选，不上传公开渠道；保留原回执和日志。
- 修正 Auto/Team 说明，并同步 Conversation 文件头、CONTRACT 与目录类图。pnpm check:architecture 通过：55 目录/600 源码与样式、1185 文件/6101 含类型依赖、0 循环。pnpm typecheck 通过。
- 新增 scripts/multi-engine-ui-smoke.mts，显式指定同一真实 EXE 和独立用户目录。前两次失败为验收观察断言错误（Electron evaluate 参数、空草稿发送按钮禁用）；第三次为 Playwright 主进程观察 Promise 被回收，导致验收关闭取消了刚启动的 Codex。保留 initial/corrected/third 失败报告，未将取消冒充引擎失败或成功。
- 改用公开只读 IPC 查询真实运行后，engine-ui-public-read/report.json 通过：Pi → Claude Code → Codex → Pi → Codex → Codex，共 6 轮；各自原生文件复用、公开上下文接续、Team 主 Agent 实际写入、Agent 默认 Claude 与岗位独立 Codex、切换清空旧模型、禁用模型不出现、重启不重放。请求 Pi 2 / Claude 1 / Codex 4，页面错误 0。已审阅两张实际截图。
- 这是首轮包的功能证据；带提示修正的新冻结包仍须重新核验，并执行同包桌面/隔离平台冒烟和 NSIS 验收。本机确定性响应不证明在线模型质量。

## 第二轮候选与完整 CI 回归

- af3ce53a6d30a20ae6f7c4ab286478c0ac993d14 构建 unsigned-20261110-132352-071768b5；47 个 PE payload，独立 verify 通过。真实同包六项进程隔离和三引擎 6 轮桌面验收均通过，报告 isolation-final.json、engine-ui-final/report.json。因随后 CI 发现产品租约回归，该包也不上传；修复后重新冻结制品。
- 首轮 CI 失败分布 15/15/20/28。旧夹具错误禁止 Team 主运行的 write/edit/bash；当前主 Agent 应按 read/ask/execute 获取工具，成员专属工具仍隔离。另有 onEngineReady 回执现包含真实 nativeSessionId 的断言更新。审批测试增加先明确拒绝主写入、再独立批准成员的真实链。
- 产品回归为人工接受接续/目标审阅在已有主 ask/execute 独占内再申请独立读，触发 WORKSPACE_EXECUTION_BUSY。采用可信主身份内部派生读占用，父子分别释放；桌面预览、决定及接续预检保持独立占用，其他写运行不得共享。占用单元增加错误身份、重复键、父先释放仍阻止写入、缺少父占用回退等验证。
- 受影响范围为首轮失败的 24 个测试文件，加 conversation-identity、human-continuation-service、complete-output-human，共 27 文件；明确选择保存在 ci-regression-selection.json。实际执行 pnpm exec vitest run <27 个明确文件> --reporter=default --reporter=json --outputFile=test-results/desktop-0.1.5-20261110/regression-targeted.json。该批 118 通过、2 失败；原失败未覆盖。影响重规划路径同样须复用可信主占用，修复后追加 5 文件/44 项通过（effects-targeted.json）；长人工重审的本地提供器误将真实 Pi 无工具摘要当成员请求，按已有摘要协议适配后，3 文件/7 项通过（reconsideration-targeted.json）。最终去重 30 文件/156 项全部通过。
- pnpm typecheck、pnpm check:architecture 已通过：55 目录、600 源码/样式、1186 文件/6107 条含类型依赖、0 循环。同步主装配与执行目录的源码注释、CONTRACT 及 ARCHITECTURE。

追加命令：`pnpm exec vitest run tests/effect-observation-service.test.ts tests/effect-observation-pi.test.ts tests/scope-replan.test.ts tests/replan-start-race.test.ts tests/business-replan-pi.test.ts --reporter=default --reporter=json --outputFile=test-results/desktop-0.1.5-20261110/effects-targeted.json`；`pnpm exec vitest run tests/human-reconsideration-pi.test.ts tests/complete-output-pi.test.ts tests/artifact-transition-pi.test.ts --reporter=default --reporter=json --outputFile=test-results/desktop-0.1.5-20261110/reconsideration-targeted.json`。追加范围只覆盖新暴露的原影响核证及共享完整交付提供器消费者。再次类型及架构检查通过；原生摘要仍由 Pi 执行，没有关闭自动摘要绕过验证。

## 最终冻结候选与原命令读取时序

- sourceCommit f9c2892dc71dec38c9c214308257fc4fca996970，候选 unsigned-20261110-134811-132982f4，47 个 PE payload。make/verify 显式 --unsigned 通过；安装器 391417341 字节，SHA-256 1ac988afd1a017af9e960f27092e29a4e782dfc698c9188c9ee563ea4f824599。同一真实 EXE 的 isolation-release.json 六项及 engine-ui-release/report.json 三引擎 6 轮通过，页面错误 0，模型请求 2/1/4；已审阅两张截图。
- 草稿 Release 439994358，四附件均 uploaded 且远端 digest 一致。按 tag 首次读取返回 404，随后从列表核实唯一 ID，没有重复创建。候选隔离安装工作流 42764972516，ref=develop、workflow SHA=冻结源码、previous_version=0.1.4、mode=candidate，结果仍待完成。
- 第二轮完整 CI 42764389854 的第三片仅 queued-dependency-revision-pi.test.ts complete 失败，其余 638 项通过、1 原有跳过；原报告及 job.log 保留。该测试在收到 HTTP 下一轮请求后立即核原命令，此时本轮保持文本仍可能经 stdout 追加 canonical；报告本就必须拒绝跨读取变化。修正测试为等实际 message.delta 保持文本落盘再查原命令，并在失败时输出完整只读报告供诊断，没有放宽产品证明门禁。
- 命令 pnpm exec vitest run tests/queued-dependency-revision-pi.test.ts tests/command-verification-service.test.ts --reporter=default --reporter=json --outputFile=test-results/desktop-0.1.5-20261110/revision-read-targeted.json：21 项通过。覆盖真实四种依赖修订以及报告对日志/图/命令变化的拒绝。仅 tests 与开发记录变化，不重新构建产品；后续准确 head 仍需完整四片通过。
- 维护资料差异边界：Forge 复制整份 design/docs，候选附带的开发记录是冻结快照；后续回填不与候选全部资源逐字相同，发布前另核 Builtins 实际白名单与运行/依赖/品牌/构建输入，绝不覆盖公开附件。

- 第二轮完整 CI 最终 375 文件/2587 项：2584 通过、1 失败、2 原有跳过；唯一失败为上述读取时序。安装 run 42764972516 已通过：实际 NotSigned、isPackaged、0.1.4 → 0.1.5、freshInstall=true，workspace/model/completedConversation/localStorage/marker/noReplay 六项均 true，模型请求 1、页面错误 0。本阶段直接安装草稿，不代表公开通道 UI 升级已经完成。

## 公开、完整检查与真实在线升级

- 冻结源码：`f9c2892dc71dec38c9c214308257fc4fca996970`；验证 head：`ca5128eccc5f87cb44ab3fd302caf8c1e7e62b89`，base：`fcb7774a9b7b91ae45ad0afa99e84233094b2ef4`。完整 Windows 四片 [42765924284](https://github.com/nan023062/cbim/actions/runs/42765924284) 通过：375 文件、2587 项，2585 通过、0 失败、2 跳过。跳过分别为 owner-execution-legacy 与 knowledge-source-lifecycle-application 的真实历史 EXE 前置未提供，均为原有缺口。
- [PR #30](https://github.com/nan023062/cbim/pull/30) 正常合并为 `8f79fc5aaaf7c3cc2e45a9ae6f8b219e63ea1fd2`，2026-11-10T06:16:44Z；合并树与上述验证 head 一致，冻结源码是其祖先。源码到验证 head 仅一个测试文件及三个维护记录变化；22 项 Builtins 白名单正文一致，运行/依赖/品牌/构建输入不变。Forge 全量复制的 design/docs 维护快照确实有差异，不声称全部资源字节一致。
- 唯一候选 `unsigned-20261110-134811-132982f4`；正式 EXE SHA-256 `3b7542ca7e05dd9d556c684ca8999b7ce1206f4096e8bf6c363f841f87232ee7`。公开前再次执行显式 `verify:desktop --unsigned` 成功，没有重新构建或替换附件。
- [desktop-v0.1.5](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.5)，Release ID **439994358**，公开时间 **2026-11-10T06:18:22Z**，draft=false、prerelease=false、make_latest=false。注解标签对象 `f3525dd1f3a28838ea5e81fdd910a2c67d9360bb` peeled 到冻结源码；旧 Python latest 仍为 327801733 / v1.0.2。

| 公开附件 | 字节数 | SHA-256 | asset ID |
| --- | ---: | --- | --- |
| CBIM-Setup-0.1.5-x64.exe | 391417341 | `1ac988afd1a017af9e960f27092e29a4e782dfc698c9188c9ee563ea4f824599` | 730290904 |
| CBIM-Setup-0.1.5-x64.exe.blockmap | 407889 | `9ab6fcab06f015de4a98c34e049681698f2b873396cf299578899b0116fd311a` | 730292299 |
| latest.yml | 345 | `4025ab4f577d89f2ece2894b09cc8f60f8e88f9f9c113258574219785c062f72` | 730292399 |
| SHA256SUMS.txt | 268 | `db06ed44017983e3c96a63cf3ff72bca391d3fbfdc8a2c92a48da8403da6f7b2` | 730292482 |

- 候选安装 [42764972516](https://github.com/nan023062/cbim/actions/runs/42764972516) 与在线升级 [42768158030](https://github.com/nan023062/cbim/actions/runs/42768158030) 均成功。两者 workflow/source SHA 均为冻结源码，输入 version=0.1.5、previous_version=0.1.4、installer_sha256 为上表安装包；前者 ref=develop/mode=candidate，后者 ref=desktop-v0.1.5/mode=online。候选全新安装与覆盖升级的证据、公开通道 UI 升级的证据分别保留。
- 在线验收完成于 2026-11-10T06:27:50.317Z：真实 0.1.4 匿名发现新版，经 UI 下载且缓存摘要匹配；独立普通退出场景没有安装，重开后主动下载自动安装重启至 0.1.5。新进程带 --updated 和原 --cbim-user-data-root；workspace/model/completedConversation/localStorage/marker/noReplay 全部为 true，modelRequests=1、pageErrors=[]、isPackaged=true、NotSigned。已审阅新版更新页截图。整个安装验收仅在无用户安装的隔离 Windows runner 执行。
- 原始证据分别保存在 test-results/desktop-0.1.5-20261110 下的 ci-third-shard1..4、candidate-42764972516、online-42768158030，发布写入意图及回执在唯一候选 publication-journal.jsonl。

## 源码认知与完整 Review 入口

[PR #30 全部文件](https://github.com/nan023062/cbim/pull/30/files) 对应上述 base 到 ca5128ec 的完整范围；功能 a4472ecb、界面 af3ce53a、可信核证租约 f9c2892d 和验证 ca5128ec 保留为独立提交。测试通过、本人代码自查、桌面验收与人工 review 是不同事实，本记录不宣称已获得维护者人工审阅接受。

阅读顺序：先看 [引擎契约](../../src/backend/core/brain/CONTRACT.md) 与 [模型配置](../../src/backend/core/brain/llm/ARCHITECTURE.md)，再看 [Claude 适配](../../src/backend/core/brain/claude/ARCHITECTURE.md) / [Codex 适配](../../src/backend/core/brain/codex/ARCHITECTURE.md)（现行入口；原 docs 文档已按文档清理提交删除）；随后看 [执行装配](../../src/backend/scheduler-engine/execution/ARCHITECTURE.md)、[主会话装配](../../src/backend/main/ARCHITECTURE.md) 和 [共用下拉菜单](../../src/frontend/components/ARCHITECTURE.md)。引擎只负责原生协议和会话，任务/权限/知识事务/请求账本仍由原服务拥有；新增协议主要改适配器和装配，不复制业务规则。可信主核证通过原主占用派生独立释放的读占用，桌面预览/决定仍独立获取权限，不扩大外部入口。

已同步变更源码的文件头、重要接口/字段说明；受影响 ARCHITECTURE 清单如下，各条链接给出实际职责和类图，不以目录统计代替源码审阅：

- [src/backend/core/ARCHITECTURE.md](../../src/backend/core/ARCHITECTURE.md)
- [src/backend/core/brain/ARCHITECTURE.md](../../src/backend/core/brain/ARCHITECTURE.md)
- [src/backend/core/brain/claude/ARCHITECTURE.md](../../src/backend/core/brain/claude/ARCHITECTURE.md)
- [src/backend/core/brain/codex/ARCHITECTURE.md](../../src/backend/core/brain/codex/ARCHITECTURE.md)
- [src/backend/core/brain/llm/ARCHITECTURE.md](../../src/backend/core/brain/llm/ARCHITECTURE.md)
- [src/backend/core/brain/pi/ARCHITECTURE.md](../../src/backend/core/brain/pi/ARCHITECTURE.md)
- [src/backend/core/knowledge/ARCHITECTURE.md](../../src/backend/core/knowledge/ARCHITECTURE.md)
- [src/backend/core/tasks/ARCHITECTURE.md](../../src/backend/core/tasks/ARCHITECTURE.md)
- [src/backend/core/team/ARCHITECTURE.md](../../src/backend/core/team/ARCHITECTURE.md)
- [src/backend/core/tools/ARCHITECTURE.md](../../src/backend/core/tools/ARCHITECTURE.md)
- [src/backend/main/ARCHITECTURE.md](../../src/backend/main/ARCHITECTURE.md)
- [src/backend/main/persistence/settings/ARCHITECTURE.md](../../src/backend/main/persistence/settings/ARCHITECTURE.md)
- [src/backend/main/platform/ARCHITECTURE.md](../../src/backend/main/platform/ARCHITECTURE.md)
- [src/backend/scheduler-engine/ARCHITECTURE.md](../../src/backend/scheduler-engine/ARCHITECTURE.md)
- [src/backend/scheduler-engine/context/ARCHITECTURE.md](../../src/backend/scheduler-engine/context/ARCHITECTURE.md)
- [src/backend/scheduler-engine/conversation/ARCHITECTURE.md](../../src/backend/scheduler-engine/conversation/ARCHITECTURE.md)
- [src/backend/scheduler-engine/execution/ARCHITECTURE.md](../../src/backend/scheduler-engine/execution/ARCHITECTURE.md)
- [src/backend/scheduler-engine/tools/ARCHITECTURE.md](../../src/backend/scheduler-engine/tools/ARCHITECTURE.md)
- [src/bridge/contracts/ARCHITECTURE.md](../../src/bridge/contracts/ARCHITECTURE.md)
- [src/frontend/ARCHITECTURE.md](../../src/frontend/ARCHITECTURE.md)
- [src/frontend/components/ARCHITECTURE.md](../../src/frontend/components/ARCHITECTURE.md)
- [src/frontend/conversation/ARCHITECTURE.md](../../src/frontend/conversation/ARCHITECTURE.md)
- [src/frontend/knowledge/ARCHITECTURE.md](../../src/frontend/knowledge/ARCHITECTURE.md)
- [src/frontend/settings/ARCHITECTURE.md](../../src/frontend/settings/ARCHITECTURE.md)
- [src/frontend/team/ARCHITECTURE.md](../../src/frontend/team/ARCHITECTURE.md)
- [src/frontend/workspace/ARCHITECTURE.md](../../src/frontend/workspace/ARCHITECTURE.md)

同范围的 23 份 CONTRACT 与 12 份概念文档已同步，可在 PR 完整文件列表核对。官网收尾只修改外部发布页面、README、维护说明和开发 Skill；不修改已公开制品或产品源码。在线供应商兼容性、模型业务质量及缺少历史 EXE 的两项迁移仍是验证边界。

## 匿名下载与官网收尾验证

- 2026-11-10T06:34:05.042Z，curl.exe -q 无 Authorization/token 匿名下载四附件，实际字节数与上表 SHA-256 全部一致；latest.yml 的安装包 SHA-512、大小和 SHA256SUMS.txt 关系同时通过。首轮 Node fetch 超时、本机匿名 Release API 返回 403 的记录保留，没有把带凭据读取当匿名通过；后续公开附件读取与隔离旧客户端实际发现/下载均成功。
- website/release.json 的所有发行字段来自同一公开 ID 与资产；同步首页、下载日志/FAQ、README 和引擎说明，保持未签名提示、Search Console 标记、canonical/robots/sitemap。按用户选择保留并合入开发规范提交 812bec168b0dca9723a78b3dc728eb04b1a77d41。
- 在独立 worktree 执行 pnpm check:brand、CBIM_WEBSITE_URL=https://nan023062.github.io/cbim/ pnpm build:website、node scripts/preview-website.mjs 与 node scripts/website-smoke.mjs：品牌摘要一致，14 场景全部通过，320/390/1280 像素、深浅色与两页独立离线，无横向溢出或页面错误，下载链接/摘要正确；已查看手机下载页与桌面深色首页截图。
- Node 检查收尾 diff 的 11 份 Markdown 中 404 个本地链接、代码围栏与三个 cbim-development 入口逐字节一致，git diff --check 通过。本步仅发布页面与外部维护文档，不重跑本机产品测试、类型/架构或安装构建。面向 master 的收尾 PR 仍执行既有完整四片；其准确 head/base/merge、部署 run、匿名六文件与分支 SHA 见 [PR #30 最终交付回执](https://github.com/nan023062/cbim/pull/30)。
