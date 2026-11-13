# 全量回归与本地制品验收报告

> 历史快照：正文中的目录、完成状态与验证数字保留记录日期的事实，不是当前实现清单。四层迁移后的现状请看 [源码契约](../../src/CONTRACT.md) 和 [Logic 边界](../../src/logic/BOUNDARIES.md)。

> 历史报告：本页制品为 0.1.5，不能用于已安装 0.1.7 的升级。已转入 [0.1.7 基线对齐与 0.1.8 候选验收](desktop-018-alignment-20261111.md)，请以新报告的实际证据为准。

日期：2026-11-11（Asia/Shanghai）；首轮最终制品专项完成于 22:36:31 +08:00，两份旧脚本补测完成于 22:57:38 +08:00。

## 1. 结论与授权边界

**全量回归中的 6 项失败已修正并定向复测通过；类型、架构和未签名安装包构建通过。两份旧桌面脚本已修复，并在同一最终制品上补测通过，报告内已执行的桌面专项均已通过。实际安装／升级验收及两项历史制品迁移用例仍有缺口，不能给出“全部验收通过”或“可发布”的结论。**

用户先要求全量回归、打包安装验收，随后明确选择“未签名验收包”和“只做本地验收”。本机已有 CBIM Assistant 0.1.7，未发现可用的本地隔离 Windows 环境。NSIS 指定其他目录仍可能卸载已登记的客户端，所以没有启动安装器；没有推送临时分支、运行云端 CI、创建 Release、合并或更新官网。本机已安装版本复核仍为 0.1.7。

本次包沿用仓库版本 **0.1.5**，用于本地验收，不是已安装 0.1.7 的升级包。打包程序直接启动、便携复制运行与安装器实际安装分别记录，不能互相替代。

## 2. 输入与源码追溯

- 原工作区：`C:/XDTWorkspace/cbim-ai`，分支 `develop`，HEAD `a5938170cf9675b69960dde6a9bb535eb845bdd8`；保留此前全部未提交的规范、P0/P1/P2 和 IPC 类型化改动。
- 基线时间：2026-11-11 22:00:32 +08:00。保存了 1,682 个维护文件的 SHA-256 和 ZIP；回填本轮修复前逐文件确认原基线未被改写。
- 构建从独立 detached worktree 冻结；最终制品源码提交为 `122af557d55ae5a65c9c8b4b60b982714e71231a`，仅存在于本地验收快照。原 `develop` 未提交、未推送。
- 实际环境：Windows 10.0.26200 x64，Node.js 24.13.0，pnpm 10.33.2，Vitest 3.2.7。测试使用临时用户数据和确定性本地模型服务，不使用真实模型账号。
- 最终生产源码已同步回原工作区。便携验收脚本后续增加按选定 EXE 原名启动的支持，属于验证脚本变化；报告与开发记录在构建后补充，不声称它们已进入冻结制品。
- 本次追加只修改两份桌面脚本、新增其共用的 `scripts/desktop-dispatch-fixture.mjs`，以及报告／开发记录／索引；未改产品源码、冻结候选或安装包。补测脚本来自原工作区，显式指定上一轮最终 EXE。

证据根目录：[full-acceptance-20261111](../../test-results/full-acceptance-20261111/)。[基线清单](../../test-results/full-acceptance-20261111/baseline.json)、[基线 ZIP](../../test-results/full-acceptance-20261111/baseline.zip) 和全部首次失败日志均保留。

## 3. 全量回归与静态检查

| 检查 | 实际结果 |
| --- | --- |
| 全量初跑 | 386 个测试文件，2,637 项；2,629 通过、6 失败、2 跳过；耗时 1,684.41 秒 |
| 修复后定向复测 | 7 个文件，49 项全部通过；包含首次失败所在四个文件及浏览器 IPC、输入校验、对象事务消费者 |
| 合并去重证据 | 387 个文件、2,638 项：2,636 通过、2 跳过，无未解决单元失败；这是全量初跑加受影响范围复测，不是第二次全量运行 |
| `pnpm typecheck` | 通过 |
| `pnpm check:architecture` | 56 个目录、632 个源码／样式文件，资料漂移 0；1,236 个代码文件、6,427 条含类型依赖，循环及分层／逻辑违规 0 |
| `pnpm check:brand` | 通过 |
| `pnpm build:website` | 通过，仅本地生成，未部署 |

实际测试命令：

```powershell
pnpm exec vitest run --reporter=default --reporter=json --outputFile=test-results/full-acceptance-20261111/full-suite.json
pnpm exec vitest run tests/model-request-budget-pi.test.ts tests/owner-execution-application.test.ts tests/owner-execution-service.test.ts tests/queue-insertion-view.test.ts tests/ipc-browser.test.ts tests/ipc-requests.test.ts tests/object-crud.test.ts --reporter=default --reporter=json --outputFile=test-results/full-acceptance-20261111/final-regression.json
```

原始证据：[全量 JSON](../../test-results/full-acceptance-20261111/full-suite.json)、[全量日志](../../test-results/full-acceptance-20261111/full-suite.txt)、[复测 JSON](../../test-results/full-acceptance-20261111/final-regression.json)、[去重统计](../../test-results/full-acceptance-20261111/regression-summary.json)、[类型与架构退出码](../../test-results/full-acceptance-20261111/workspace-checks.json)。

两项跳过保留原有条件，未新增跳过来消除失败：

1. `knowledge-source-lifecycle-application.test.ts` 的真实旧版迁移用例：缺少固定 `build/20261107-222611/CBIM Assistant-win32-x64/CBIM.exe`，对应覆盖条件为 `CBIM_SOURCE_LEGACY_EXE`。
2. `owner-execution-legacy.test.ts` 的真实旧岗位记录迁移用例：缺少固定 `build/20261107-235854/CBIM Assistant-win32-x64/CBIM.exe`，对应覆盖条件为 `CBIM_OWNER_LEGACY_EXE`。

需要取得与这些夹具对应的原历史制品才能补测；没有用当前版本伪造旧记录。

## 4. 本轮发现并修复的问题

| 问题 | 修复与验证 |
| --- | --- |
| 前端 IPC 校验传递加载 Node.js `crypto`，首次 Vite 打包失败 | 将对象 Schema／DTO 提取至 `object-contract.ts`，对象事务仍归 `ObjectCrud`；原入口保留重导出，Bridge 直接依赖纯契约。新增真实浏览器构建回归，禁止传递加载 Node.js／Electron；对象 CRUD 和打包复测通过 |
| 派发 IPC 强制 `scopeId`，提前覆盖历史回执查询及 `DISPATCH_SCOPE_REQUIRED` | 保留字段缺省的历史查询兼容；服务先查原回执，缺周期的新命令仍拒绝。两个原有负责人／派发回归用例通过 |
| 队列插入缺原 `expectedRunId` 时错误码变成普通 Schema 异常 | 边界继续拒绝缺失／空身份，但保留 `QUEUE_INSERT_STALE`；不取得执行服务、不补猜当前运行、不消费队列。测试同时核实错误码与服务未调用 |
| 预算测试与安装验收脚本将整个运行句柄展开为 `loop.inspect` 参数 | 改为明确传 `id/taskId/runId`；三个实际 Pi 协议预算用例复测通过。安装脚本仅核对语法，未冒充实际安装通过 |
| 侧栏按钮计数和对话计划／文本选择器落后现行 UI | 只统计会话选择按钮；原运行局部计划仍检查持久事实，任务根检查真实周期目标；用户消息按消息区域定位，避免匹配目标摘要。完整对话桌面链已复测通过 |

同步维护了 `src/backend/core/knowledge`、`src/bridge/contracts`、`src/backend/main/ipc` 的源码注释、`CONTRACT.md` 和 `ARCHITECTURE.md`。维护入口：共享对象数据从 `object-contract.ts` 修改；IPC 历史兼容看 `ipc-dispatch.ts`；受理前错误码看 `request.ts`。没有修改业务权限、事务或自动重试策略。

## 5. 最终候选制品

构建命令：`pnpm make:desktop --unsigned`。构建在干净快照完成；中途一次未同步生成资料被 `RELEASE_SOURCE_DIRTY` 正确拒绝，提交同步后重新构建，没有绕过检查。旧候选因后续源码修复被替代，原回执保留，不混用为最终制品证据。

- 最终候选：`test-results/full-acceptance-20261111/candidate/build/desktop-release/0.1.5/unsigned-20261111-223155-e1207aa6/`。
- 构建时间标记：`20261111-223155`，时区 Asia/Shanghai。
- [安装包 CBIM-Setup-0.1.5-x64.exe](../../test-results/full-acceptance-20261111/candidate/build/desktop-release/0.1.5/unsigned-20261111-223155-e1207aa6/CBIM-Setup-0.1.5-x64.exe)：391,272,716 字节，约 373.15 MiB。
- 安装包 SHA-256：`19e1586a3db15f4318d11cc76dc00bc3cf8e1a8224154266460230dd19b043fc`。
- [构建回执](../../test-results/full-acceptance-20261111/candidate/build/desktop-release/0.1.5/unsigned-20261111-223155-e1207aa6/build-receipt.json) 记录 47 项 Windows payload，以及 `app.asar`、更新配置、版本元数据摘要；安装包、blockmap、`latest.yml` 和 `SHA256SUMS.txt` 均已生成。
- 再核验使用 `pnpm verify:desktop <上述候选目录> --unsigned`，通过。见 [核验日志](../../test-results/full-acceptance-20261111/verify-final-candidate.txt)。Windows 实际验签结果为 **NotSigned**，见 [签名核验](../../test-results/full-acceptance-20261111/final-signature.json)，不是通过文件摘要推断签名。

## 6. 打包运行与剩余验收缺口

最终 EXE 来自同一回执的 `packagedDirectory/CBIM Desktop.exe`，所有专项显式设置 `CBIM_TEST_EXE`。[首轮制品专项退出码](../../test-results/full-acceptance-20261111/final-package-results.json) 保留两项原失败；后续实际结果见 [两份脚本补测回执](../../test-results/desktop-followup-20261111/followup-results.json)。下表按专项列出最新有效证据，不改写首轮日志。

| 最终制品专项 | 结果与证据 |
| --- | --- |
| 侧栏 | 通过：新建两段会话、左对齐、知识检查及实例保持；[日志](../../test-results/full-acceptance-20261111/final-sidebar.txt) |
| 扩展界面 | 通过；[日志](../../test-results/full-acceptance-20261111/final-extensions.txt) |
| 完整对话流程 | 通过：真实 Pi 进程、确定性模型、附件、权限批准／拒绝、续聊、停止、队列、结构化提问、业务文件写入与命令验证、实际 Edge 打开 HTML 产物、历史恢复及项目移除；[日志](../../test-results/full-acceptance-20261111/final-loop.txt) |
| 便携复制运行 | 通过：将正式候选目录复制到仓库外，以原 EXE 名启动；PATH 不包含系统 Node/Python，内部知识与对象 CRUD 可用，宿主规则文件未改；不是干净机器安装验收；[日志](../../test-results/full-acceptance-20261111/final-portable.txt) |
| Windows 进程隔离 | 6 项通过：文件／环境隔离、网络拒绝、超时、取消、非零退出、输出上限；自有进程／目录／profile 清理通过；[真实制品报告](../../test-results/full-acceptance-20261111/candidate/test-results/isolation-final-candidate.json) |
| 品牌与图标 | 通过：打包界面、图标及 EXE 图标资源一致，页面错误为空；[日志](../../test-results/full-acceptance-20261111/final-brand.txt) |
| 全局运行时派发 | 补测通过：真实岗位／周期／目标计划、排队和前置等待、增量、隔离、幂等、停止结算、重启身份与回执恢复、无模型重放；[JSON](../../test-results/desktop-followup-20261111/test-results/runtime-smoke.json)、[日志](../../test-results/desktop-followup-20261111/runtime-attempt-4.txt) |
| 架构编辑与资源导入导出 | 补测通过：团队／模块／Workflow 表单，四类静态资源发布与导入，预览取消、跨项目隔离、岗位与运行身份不导出、目标默认主 Agent 且无动态任务；[JSON](../../test-results/desktop-followup-20261111/test-results/architecture-ui-smoke.json)、[日志](../../test-results/desktop-followup-20261111/architecture-attempt-1.txt) |

首轮桌面聚合命令遇到运行时失败即退出，因此按具体脚本逐项执行，确保后面的对话、便携和隔离验证实际运行。当时两份旧脚本仍失败，部分架构适配曾撤回。这些历史日志保留；本次按用户追加要求完整适配后补测，未把当时未运行的路径记为首轮通过。

以下保留原失败原因及对应修复：

| 原失败项 | 原因与本次修复 |
| --- | --- |
| `runtime-smoke.mjs` | 原失败为缺少 `scopeId`，见[首次日志](../../test-results/full-acceptance-20261111/final-runtime.txt)。现在经公开 IPC 登记岗位／责任，经真实 Pi 工具查询负责人并规划目标，在命令顶层传真实周期；仍断言缺周期的新命令被拒绝。每个任务独占执行实例，停止后任务取消、实例释放、待发消息结算；重启保留完整已结算图、原派发回执与历史身份，不恢复过期队列、不产生成员执行 |
| `architecture-ui-smoke.mts` | 原失败为已移除的维护人表单，见[首次日志](../../test-results/full-acceptance-20261111/final-architecture-ui.txt)。静态模块与岗位登记分离；源项目建立一个真实岗位和两个合法周期，各有一项未领取任务作为正向隔离样本。保留原表单、预览取消、Skill 继承、深浅色／窄布局、资源导出导入和业务文件不变断言；新增实际岗位／责任／周期／运行身份不导出、目标岗位列表为空及默认主 Agent 断言 |

### 6.1 两份旧脚本的专项补测

- 运行时：22:56:59–22:57:06 +08:00，退出码 0；架构界面：22:57:22–22:57:38 +08:00，退出码 0。页面错误、架构意外对话框和本地模型协议错误均为空。
- 共用夹具只替换供应商响应，不替换 Electron、IPC、Pi、调度或存储：每个主周期实际执行负责人查询、目标规划两次工具调用，再保持第三次本地模型请求未结束，确保主轮未结算时成员不被自动领取。运行时 1 个周期／3 次请求，架构 2 个周期／6 次请求；没有外部模型、成员执行或测试专用产品接口，也没有手写调度日志。
- 导入导出前后核对两张源图、任务列表、运行压力和负责人绑定完全一致，模型请求数保持 6；目标没有岗位、动态成员、任务或运行。测试结束显式停止源主运行，再关闭自有应用与本地服务。
- 本轮新导入对应的 `pnpm check:dependencies` 通过：1,237 个文件、6,429 条含类型依赖，循环和逻辑边界违规 0；两份 `.mjs` 的 `node --check` 通过，`.mts` 由实际 `tsx` 执行。见[依赖检查日志](../../test-results/desktop-followup-20261111/dependencies.txt)。产品源码未改，不重复全量单元、类型／类图、打包和已通过的其他桌面专项。
- 补测使用的 EXE 与 `app.asar` SHA-256 均再次匹配原构建回执，见[补测回执](../../test-results/desktop-followup-20261111/followup-results.json)。原源码与冻结候选的一致性结论未变；三份更新后的脚本摘要单独记录，不冒充构建时源码。

实际命令如下，工作目录单独设在证据目录，以保留首轮 JSON 和截图：

```powershell
$env:CBIM_TEST_EXE='C:\XDTWorkspace\cbim-ai\test-results\full-acceptance-20261111\candidate\build\unsigned-20261111-223155-e1207aa6\CBIM Assistant-win32-x64\CBIM Desktop.exe'
Set-Location C:\XDTWorkspace\cbim-ai\test-results\desktop-followup-20261111
node C:/XDTWorkspace/cbim-ai/scripts/runtime-smoke.mjs
node --import tsx C:/XDTWorkspace/cbim-ai/scripts/architecture-ui-smoke.mts
```

适配过程的运行时前三次失败日志也保留：分别定位目标工具返回形状、周期字段位置、真实主会话纳入运行压力计数；第四次完整通过。没有改动产品实现或门禁来消除这些失败。截图见[补测产物目录](../../test-results/desktop-followup-20261111/test-results/)。

实际 NSIS 安装、重装数据保留、历史安装版升级、更新通道发现／下载／重启、签名迁移、完整 PR CI 均未执行。后续安装验收需要干净隔离 Windows runner，并使用本报告锁定的真实制品；现有公开升级脚本的版本支持也须按真实前一版核实，不能用当前 0.1.5 包冒充 0.1.7 的升级候选。

## 7. 记录与交付状态

本轮修复已经回填原工作区，保持未提交状态；独立构建快照提交只用于制品追溯。未创建或回填与本次无直接关系的 Issues。[本轮增量 diff](../../test-results/full-acceptance-20261111/acceptance-changes.patch) 以开始时的脏工作区为基线，便于与此前整改区分；[最终工作区核对](../../test-results/full-acceptance-20261111/final-workspace-audit.json) 确认 732 个 `src/` 维护文件与冻结候选逐字节一致。完整 diff 和本报告共同作为人工 review 入口，测试通过不等于人工 review、合并或发布通过。

本次追加修改仅涉及 `scripts/runtime-smoke.mjs`、`scripts/architecture-ui-smoke.mts`、`scripts/desktop-dispatch-fixture.mjs`、本报告、`design/development-log.md` 和 `design/README.md`，保持未提交、未推送；见[追加脚本 diff](../../test-results/desktop-followup-20261111/smoke-fixes.patch)。

日志、JSON、截图和构建产物保存在上述证据目录；核心结论另同步至开发记录。当前阶段结论是“本地回归失败及两份旧桌面脚本失败已闭环，仍缺实际安装／升级和指定历史制品迁移验收”。
