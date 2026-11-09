# Issue #9：新项目的负责人下拉列表

日期：2026-11-09。范围：[Issue #9](https://github.com/nan023062/cbim/issues/9)；源码修复及本地 Windows 桌面验收完成，正式版本尚未发布。当前进度见[开发路线图](../tool-architecture-roadmap.md)，完成事实见[开发记录](../development-log.md)。

## 根因与实际行为

原 `ModuleOwnershipPanel` 只读取 `workspace.members.list` 中的持久岗位。新项目有静态 Agent 但没有登记岗位时，负责人选项只剩“不设置负责人 / 解除”；页面也没有连接到岗位登记的入口。Agent 是能力定义，负责人保存需要本项目的真实 memberId，不能直接把 Agent ID 当作岗位。

现在从业务架构打开模块负责人后：

1. 下拉框保留已有岗位，并增加“从 Agent 登记新岗位”，包含同工作区快照中的自定义 Agent 与内置执行 Agent，不包含主 Agent。
2. 选择 Agent 打开原 `WorkspaceMembers` 登记表单，只预选能力来源。用户明确填写岗位和模型，预览后保存。
3. 本次登记受理后返回原模块，重新读取真实岗位，只有新 memberId 仍启用才预选。负责人仍需单独预览和保存；登记本身不设置责任或启动任务。
4. 取消登记返回原模块且不写入。登记回包未知时保留原命令查询；查询受理结果后可手动返回选择已登记岗位，不自动重复登记。
5. 只有岗位列表完整读取成功才显示空状态及登记选项。读取失败保留错误与“重新核实模块与岗位”入口。

## 职责与维护入口

| 入口 | 本次职责与状态归属 |
| --- | --- |
| [WorkspaceView.tsx](../../src/frontend/workspace/WorkspaceView.tsx) | `BusinessArchitecture` 保存原模块、所选 Agent 和返回后的岗位提示，组合责任面板与现有登记面板 |
| [ModuleOwnershipPanel.tsx](../../src/frontend/workspace/ModuleOwnershipPanel.tsx) | 核实岗位列表、区分空列表与读取失败、调用注入的登记回调；不导入登记组件 |
| [WorkspaceMembers.tsx](../../src/frontend/team/WorkspaceMembers.tsx)、[WorkspaceMemberForm.tsx](../../src/frontend/team/WorkspaceMemberForm.tsx) | 共用登记及原命令记录，只对本次受理的登记回调 memberId；表单不默认选择模型 |
| [ExtensionArea.tsx](../../src/frontend/shell/ExtensionArea.tsx) | 传递完整 `WorkspaceView`，使复用表单使用真实运行状态与实例 |

静态依赖为 `WorkspaceView → WorkspaceMembers → ModuleOwnershipPanel`；责任面板通过上层回调进入登记，没有反向导入形成文件环。运行时经 preload／公开 IPC 到原岗位和责任服务，仍由后端事务核实版本、来源和原命令。前端不导入后端实现，没有增加后端协议或持久化结构。

本次变化点是“从业务架构进入登记并返回”的界面组合，实际变化频率未统计；岗位身份、原命令幂等和责任事务继续由已有服务负责。以后增加同类入口应组合登记组件及受理回调，而不复制登记协议或把页面导航写进后端核心。本次仅核实这些真实调用链及消费者，未做全仓架构重构。

五个变更源码文件均同步了文件头、相关参数或回调说明；同步的目录契约与类图为 [workspace](../../src/frontend/workspace/ARCHITECTURE.md)、[team](../../src/frontend/team/ARCHITECTURE.md)、[shell](../../src/frontend/shell/ARCHITECTURE.md)，其 `CONTRACT.md` 同步维护。

## 实际验证

- `pnpm typecheck` 通过；日志 `test-results/issue9-typecheck-final.log`。
- `pnpm check:architecture` 通过：53 个目录、567 个代码／样式文件，0 份文档差异；1120 个维护文件、5860 条含类型依赖，0 环。日志 `test-results/issue9-architecture-final.log`。
- 岗位与负责人相关 11 个测试文件 **94/94** 通过，涵盖登记、来源／版本、服务／应用／工具、Pi 及界面状态；报告 `test-results/issue9-targeted.json`。恢复工作后核实该报告与未变更的产品源码，没有重复运行这组已通过测试。
- 依赖与分层 **14/14** 通过；报告 `test-results/issue9-boundaries-final.json`。首次 **13/14** 的报告 `issue9-boundaries.json` 保留：品牌 SVG 被当成代码层依赖。只对实际存在的非代码文件按资源分类，无扩展名模块和代码模块仍受检查，未改正式依赖检测器或给代码越层添加豁免。
- `pnpm package` 成功，Windows x64 测试构建 **20261109-130841**，源码基于 `06c55b8736a724c4779b00cd36669d1075fb4355` 加当前未提交改动。EXE、app.asar 和变更文件 SHA-256 见 `test-results/issue9-build-evidence.json`；构建日志 `issue9-package.log`。
- `pnpm exec tsx scripts/module-owner-registration-ui-smoke.mts` 正常场景通过；同脚本 `--unknown` 丢回包场景最终通过。测试启动真实打包 EXE、真实 preload／IPC／服务，使用独立临时用户目录和两个项目；不是模拟整个后端的 React 测试。

两个桌面场景均核实：零初始岗位、可选自定义／内置执行 Agent、排除主 Agent、模型必须明确选择、取消不写入、登记成功返回原模块、已有岗位复用、读取失败不假报空、负责人持久化及正常重开。每个场景真实登记 2 个岗位、保存 3 次责任变更，重启后没有新增提交；原知识文件、知识版本及已有运行文件不变，模型请求和页面错误均为 0。

丢回包是在服务已经真实提交后丢弃一次响应，再经界面查询原命令；不是假造受理结果。最终核实无重复登记。岗位读取失败同样是明确的故障注入，不代表发生过真实网络故障。

首次丢回包场景的恢复已经成功，但提交记录随 `blocked=false` 折叠，测试用 `innerText()` 读取隐藏内容而超时。脚本改为读取状态节点 `textContent()`，并继续断言查询后没有自动跳转；复验使用同一个产品构建，产品恢复代码未改。原失败 JSON／截图、日志和原测试脚本分别保留为 `test-results/issue9-unknown-initial-failure.*`、`issue9-desktop-unknown-initial.log`、`issue9-ui-smoke-initial.mts`。

桌面结果和截图：

- `test-results/module-owner-registration-complete-ui-smoke.json`：正常登记、保存及重开。
- `test-results/module-owner-registration-unknown-ui-smoke.json`：原回执核实、防重复、继续登记保存及重开。
- `test-results/module-owner-registration-unknown-empty-project.png`、`-assigned.png`、`-reopened.png`：最终脚本滚动至负责人下拉框后的实机画面。

## 交付边界

本次未运行全仓回归，也未测试原用户项目、在线模型或正式升级安装。修复按 Issue #9 独立提交；公开 0.1.1 未包含本次改动；本地验证包不等于正式发布。本任务不推进 Step55 之后的旧开发计划。

## 独立提交前复核

按用户要求隔离 #9 后重新运行类型与架构检查，13 文件 108/108 通过（`test-results/issue9-isolated.json`）。5 个产品源码、2 个变更测试和桌面脚本的 SHA-256 与上述实机验收记录逐项一致，因此沿用该相同源码的真实 EXE 正常／丢回包验证，不将后续模式改动混入本次提交。生成架构时另规范两处既有附录的单行换行符，无语义变化。
