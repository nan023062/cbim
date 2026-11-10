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

冻结干净源码并构建唯一候选；通过完整 CI 与隔离安装后合并及公开，随后验证真实上一版 UI 升级，再同步既有 GitHub Pages 和双分支。

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
