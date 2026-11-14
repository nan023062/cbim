# 调度周期真实输入持久化验证

> 历史快照：正文中的目录、完成状态与验证数字保留记录日期的事实，不是当前实现清单。四层迁移后的现状请看 [源码契约](../../src/CONTRACT.md) 和 [Logic 边界](../../src/logic/BOUNDARIES.md)。

日期：2026-11-07。阶段五外层目标循环的第一步。它保存目标来源，不代表目标计划、评估或完成门禁已经实现。

## 本步行为

- 每次实际启动的用户消息建立独立 `scopeId`，保存 `goal.revision:1` 与 `input.message/attachmentIds`。原文不裁剪，附件只保存受管身份。
- 续聊及排队消费使用本轮消息，保留原主会话 `TaskSpec`、主实例和原生 Session。未开始的队列不会提前创建周期。
- 成员结果回注继续同一周期，不替换用户输入；关闭后原文和历史保留。
- 同周期异参重试、删除或改写输入均拒绝；持久化提交与日志重放共用校验。旧记录无 `goal` 时保持缺省，不补造目标。

## 验证

- `pnpm typecheck` 通过。
- `pnpm check:architecture` 通过：46 个目录、298 个维护文件、1036 条含类型依赖，0 循环。
- 全量测试 86 文件、367 项通过，包含依赖与层级检查。原始报告：`test-results/scope-input-unit.json`。
- 定向用例覆盖初次/续聊原文、队列、回注、输入边界、幂等冲突、调用者变更、关闭/重启、篡改日志拒绝及 legacy。
- `pnpm make` 生成 Windows x64 构建 `20261107-022013`。
- 打包桌面使用 `scripts/collaboration-ui-smoke.mts --scope-goals`：从真实输入框发起任务、续聊及运行中排队，成员真实 Pi 执行后回注；关闭并重启整个 EXE，三个目标保留且不重放。

使用隔离工作区与本机确定性 SSE 模型响应，实际运行 Electron/Pi、存储和界面，未使用真实业务项目或用户供应商密钥。自定义执行者及 `--default-executor --scope-goals` 内置默认执行者两条流程均通过；各主请求 5 次、成员 5 次，页面与传输错误均为 0。原始桌面结果与各 7 张截图保存在 `test-results/collaboration-scope-goals-*` 和 `test-results/main-instance-scope-goals-*`。

## 产物与维护

程序：`build/20261107-022013/CBIM Assistant-win32-x64/CBIM.exe`，需要同目录运行资源。ZIP 位于同一构建目录的 `make/zip/win32/x64/`。

已同步 `core/tasks`、`scheduler-engine/execution` 文件头与关键接口、两处 CONTRACT 及目录类图；执行目录职责在生成器中同步。开发路线图、概念说明和开发记录分别维护当前状态、设计依据与完成事实。

剩余：结构化目标计划、图谱匹配决定、结果评估、完成门禁、周期内用户补充版本化、人工验收及预算控制。现有 `outcome:completed` 仍仅表示运行生命周期关闭，不应当作业务目标已通过验收。
