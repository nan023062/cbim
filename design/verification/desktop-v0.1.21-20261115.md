# 0.1.21 发布验证（2026-11-15，未放行）

## 当前结论
PR #96 已建立并转为草稿，未合并、未公开发布桌面 0.1.21。新旧 Agent 执行路径的业务验证集成覆盖尚未完成迁移，不能用安装成功代替全量回归通过，也不能恢复旧 Team 入口或跳过断言来放行。

## 冻结候选
- 源码：6541c41da6b11d6b0c003cb4c3a13e631735a863。
- 构建：unsigned-20261115-211159-84059f60。
- Windows 未签名，发布者未验证；资源沿用现有 Ed25519 身份。
- 安装包：CBIM-Setup-0.1.21-x64.exe，110410965 bytes。
- SHA-256：25375bd045efb19dbea7cb72b2701afc01b23f8d18f1fba1142702709486837f。
- 草稿 Release ID：446073270，四附件已核对远端摘要。
- 先前两个本地候选不放行：第一次遗漏附加模型角色配置；第二次引擎适配器改动却复用已发布 1.1.0 身份。最终候选四个适配包为 1.1.1。
- 9a323352 只修改验收脚本和开发文档；旧安装缓存按升级前真实摘要核对，没有修改产品或构建输入。

## 已通过
- 类型、架构、测试模块归属、品牌及官网构建检查。
- 引擎打包与版本管理专项 8 项；对话、预算及递归相关专项见开发记录。
- `pnpm verify:desktop build/desktop-release/0.1.21/unsigned-20261115-211159-84059f60 --unsigned`。
- `pnpm exec tsx scripts/isolated-node-smoke.mts`：明确指向本候选 EXE，文件、网络、超时、取消、非零退出、输出限额六场景通过。
- 验收预检 108 项通过；首次进程集成因隔离工作目录未安装 Electron 二进制而未启动。执行 `node node_modules/electron/install.js` 后，单独重跑 `tests/desktop-acceptance-process-integration.test.mjs`，3 项通过。
- [隔离 Windows 安装验收](https://github.com/nan023062/cbim/actions/runs/43718250827)：全新安装、公开源下载 Pi 1.1.1、真实适配器处理确定性模型响应、0.1.19 覆盖升级，用户数据、旧引擎文件和停用状态保留，任务不重放；pageErrors=[]。这是候选安装，不是公开在线升级。
- 图标：EXE 与安装器原生 32px 图标像素匹配率均为 1，窗口图片载入正常，亮/暗截图已保存于 Actions 附件。
- 四个 E 1.1.1 不可变 ZIP 已追加到 runtime-engines prerelease，匿名下载大小与摘要全部核对。未切换签名索引，旧索引保持不变，未发布 runtime-c0.1.21。

## 未通过与范围
[完整四片 CI](https://github.com/nan023062/cbim/actions/runs/43717736089) 的静态检查通过。核对被后续提交取代的前一轮日志，发现 application-collaboration、json-validation、controlled-file、workflow-condition、scope-wait、goal-review、inspection-cycle、effect-observation、waiting-mixed-sources 等集成套件失败。当前源码最小复现确认后取消余下全量运行，保留失败事实，不能计为全量通过。

当前源码复现命令：
```powershell
pnpm exec vitest run tests/execution-collaboration.test.ts tests/unified-tool-policy.test.ts tests/json-validation-pi.test.ts -t 'validates actual|principal|permission|collaboration|主|成员|目标' --reporter=default --reporter=json --outputFile=build/release-blocker-021.json
```
实际选中 15 项：9 失败、6 通过，另 24 项因选择器未选中。9 个 JSON/CSV/PNG 场景均报告“真实冻结要求必须装配验证工具”。

原因边界：新 `loop.chat` 默认进入 `agent-tools-v1`，旧业务集成夹具仍要求主流程提供原派发/冻结验证工具；当前适配并未证明这些业务约束已通过新 Agent 工具链完成。不能直接把失败视为无效测试、删掉旧集成覆盖，或给普通新对话重新启用旧频道/派发状态机。后续须在 #94 核实旧格式只读/可信续接与新业务工具承载的边界，再迁移实际消费者和集成验证。

## 未执行
合并、公开桌面发布、R 通道投放、E 索引切换、公开在线升级和官网版本切换均未执行。Python latest 仍为 v1.0.2；桌面公开稳定版仍为 0.1.19。不能将本记录理解为发布成功。

## 后续专项迁移：九项文件验证（2026-11-15）

基线 17f032c7 后已把 JSON/CSV/PNG × 正常交付/文件变化/停止 的九项失败用例迁到真实 cbim_agent_call 调用链，保留 canonical、当前字节与重启不重放检查；新增调用方 cbim_agent_result_check。相关调用/运行循环测试 37 项以及类型、测试边界、架构检查通过。具体命令和范围见 development-log.md 的 #94 业务验证迁移记录。

这仅解除已定位的九项专项回归阻塞，不表示其余旧业务消费者、同文件六项人工目标决策或完整 CI 已通过。PR #96 保持草稿，原候选 6541c41d 过时，安装及发布记录仍只证明原候选。

## 后续专项迁移：人工决定六项（2026-11-15）

c39a8b58 后迁移剩余六项 JSON/CSV/PNG 负面人工决定到主 Agent 的普通评审工具，真实问题卡保存意见后显式继续。当前文件变化拒绝接受，负面意见不授权新子运行；停止保留审计历史，重启不重放。六项通过，此前九项复核通过，调用/装配 31 项通过，类型、测试边界及架构通过。该集成文件 15 项均已定向覆盖。具体命令和协议差异见开发记录。

这解除该文件的人工决策迁移缺口，不表示整个仓库完整 CI 或当前源码的发布安装验收通过。用户要求更新 PR 并申请评审；Ready for review 与允许合并/发布是不同状态，旧候选仍不能代表当前源码。

## 2026-11-15 — #94 显式 Workflow 选择迁入 Agent 调用验证

发布复核在 f2e9790a 复现 `workflow-selection-pi.test.ts` 仍按旧派工工具识别主 Agent，导致两项无法进入业务验证。仅迁移测试消费者：使用真实 cbim_agent_call 的 business.workflowSelections，沿父运行持久引用读取 loop-engine 子运行；核对第二 Workflow 冻结版本、验证要求和交付证明，保留停止、真实文件及重启不重放，并明确旧任务图为空。不恢复旧派工入口，不删减业务验证。

验证：`pnpm exec vitest run tests/workflow-selection-pi.test.ts` 两项通过；`pnpm check:test-modules` 通过（537 文件，174 unit / 163 contract / 200 integration）。测试文件仍归原集成模块；本次没有 src 变更，不涉及源码类图。完整 CI run 43727211812 的静态检查已通过，四片测试仍运行，不能据专项通过发布。旧 6541c41d 候选继续保留为历史，当前源码尚未重新构建或公开发布。

发布复核补充：`pnpm exec vitest run tests/application-collaboration-pi.test.ts -t 'reopen \(normal\)' --reporter=default --reporter=json --outputFile=test-results/release-collaboration-blocker.json` 实际选中 1 项失败，另外 8 项未被选择。30 秒等待后预期 2 个历史运行，实际只有 1 个；夹具仍用 cbim_dispatch_task 识别主 Agent，并调用旧 cbim_goal_plan/dispatch/goal_review。不能仅改历史数量放行，须迁移实际调用、回流与恢复覆盖。该失败是当前发布阻塞；完整 CI 即使尚在运行，也不能声称全部通过。未执行新的构建、合并或公开发布。

## 2026-11-15 — #94 自动派工/结果回流测试迁入递归 Agent 链路

基线 836173f3，继续用户授权的 PR #96 / 0.1.21 发布修复。原 `application-collaboration-pi.test.ts` 仍用 cbim_dispatch_task 识别主 Agent，等待额外的 member-results / goal-repair 轮次；新设计通过同一个主运行的普通工具返回结果。

本次保留 9 个真实集成场景，采用真实 Application、Pi SDK、受控本地模型响应、真实文件与独立崩溃进程：正常回流、错误核验后的原调用再核验、已完成子运行回流前崩溃、主日志残尾、子运行尚未终结时崩溃、显式停止后重启、模型配置变化后重启、审批/排队完成、审批/排队停止。原生实际结果回到原主调用；旧图为空，未恢复 Team 派工。主 Agent 的模型响应明确保留尚未人工验收的限制。

语义迁移：旧 goal-repair 的额外主轮替换为同一主轮处理真实工具核验错误，不重放子调用；旧自动续接/未记账回流替换为中断后禁止重放，新的用户指令另行处理。崩溃夹具不再替换 continueFromResults，不写虚构旧 scope 意图；从实际模型请求观察已写文件/未返回的窗口，强制终止自己创建的宿主及其进程树。只读拒绝写入、单次审批不能借用旧批准、排队消息不提前混入结果、停止暂停队列、文件与日志重启后不重放均保留。

迁移发现实际缺陷：活动主运行正在等待 Agent 工具时，resume 在排队前按未决工具拒绝补充。Logic/conversation 的 WorkspaceExecutionManager 现在先核对当前准确 taskId/runId、active 主运行及停止屏障，仅持久排队，不启动第二个模型、不恢复工具；无存活事实的历史仍返回 RECOVERY_INSPECTION_REQUIRED，reconciledToolIds 不能绕过。状态仍由原 manager/queue 持有，未新建调度或恢复机制。源码文件头/JSDoc、runtime/CONTRACT.md、runtime/ARCHITECTURE.md 同步。

验证与选择依据：
- `pnpm exec vitest run tests/application-collaboration-pi.test.ts --reporter=default --reporter=json --outputFile=test-results/agent-return-migration.json`：9/9 通过，覆盖本次全部集成消费者。测试报告为本地确定性模型，非在线模型验收。
- `pnpm exec vitest run tests/execution-collaboration.test.ts`：18/18 通过；新增活动未决工具只排队、停止后仍拒绝未知恢复的模块回归，原恢复/队列消费者同时验证。
- `pnpm typecheck`、`pnpm check:test-modules`：通过（537 文件，174 unit / 163 contract / 200 integration）。测试归属未变。
- `node scripts/source-architecture.mjs` 同步 1 份；`pnpm check:architecture` 通过：135 目录 / 831 代码样式文件无差异，1649 文件 / 7816 依赖 / 0 环 / 0 违规。
- 类型检查初次发现测试的 findLast 不在配置的标准库内，改为同义 filter(...).at(-1)，类型复核通过。初次崩溃夹具清理遇到 EBUSY，改用本夹具宿主 PID 的进程树终止并关闭新 Application；最终完整九项通过。
- 未重新构建、未安装升级、未合并、未公开发布：上一个精确 head 的完整 CI 已失败，不以定向通过或旧包安装证据放行。

完整 CI 43728249910（836173f3）已完成且失败：第 2 片 801 通过 / 48 失败，第 4 片 754 通过 / 42 失败；第 1/3 片均被 GitHub 标注超过 30m0s，仅有分片清单，无完整测试 JSON。此 90 项是两份完整报告的失败数，不是全仓失败总数，不是新提交结果；静态检查通过。剩余失败包括旧等待、人工接续、预算、产物/效果、依赖和源码结构契约；不能统一当作无效测试、延长超时掩盖失败或取消门禁。完整原始报告/日志保留于 Actions；本次摘录见现有版本验证记录。开发清单与进度继续由 Issue #94 承载。


### 完整 CI 两份已结束报告的失败套件摘录

来源：https://github.com/nan023062/cbim/actions/runs/43728249910 ，只描述该旧提交的实际报告。

| 分片 | 套件 | 失败项 |
| --- | --- | ---: |
| 2 | artifact-transition-pi.test.ts | 3 |
| 2 | automatic-execution-pi.test.ts | 2 |
| 2 | business-replan-pi.test.ts | 3 |
| 2 | controlled-file-pi.test.ts | 6 |
| 2 | core-layer-contracts.test.ts | 1 |
| 2 | effect-observation-pi.test.ts | 5 |
| 2 | global-admission-pi.test.ts | 3 |
| 2 | knowledge-effect-pi.test.ts | 3 |
| 2 | member-help-pi.test.ts | 4 |
| 2 | member-tool-contract-pi.test.ts | 2 |
| 2 | module-ownership-pi.test.ts | 7 |
| 2 | scoped-execution-pi.test.ts | 1 |
| 2 | waiting-mixed-sources-pi.test.ts | 4 |
| 2 | workflow-condition-pi.test.ts | 4 |
| 4 | abandoned-checkpoint-dependency-pi.test.ts | 4 |
| 4 | coordination-pi.test.ts | 1 |
| 4 | execution-report-pi.test.ts | 2 |
| 4 | global-runtime-view-pi.test.ts | 1 |
| 4 | goal-repair-pi.test.ts | 1 |
| 4 | human-continuation-pi.test.ts | 8 |
| 4 | inspection-cycle-pi.test.ts | 3 |
| 4 | member-checkpoint-chain-pi.test.ts | 3 |
| 4 | model-request-budget-pi.test.ts | 4 |
| 4 | original-command-pi.test.ts | 3 |
| 4 | queue-insert.test.ts | 1 |
| 4 | scope-budget-pi.test.ts | 7 |
| 4 | scope-usage-pi.test.ts | 1 |
| 4 | scope-wait-pi.test.ts | 3 |
