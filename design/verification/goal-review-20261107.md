# 主 Agent 目标计划与完成门禁验证

日期：2026-11-07。外层目标循环第二步，承接 `fe5e905` 的真实输入持久化。

## 已实现

- 主调度专用 `cbim_goal_plan/inspect/review` 保存原始目标下的版本化计划、真实角色/模块分配、知识基线与审阅。
- 派发匹配当前计划；完成请求不立即关闭周期，主运行结算后再次核实真实日志、回执、当前结果候选、全部周期任务和图/知识/副作用变化。
- 主知识写入也必须有计划及真实提交证据；模型不能把计划、派发或审阅回执作为业务证据。
- 失败或知识过期任务须由后续成功任务覆盖原模块范围；重规划清空旧审阅，已登记的人工项不能删掉或降级。
- 缺审阅、证据伪造、未满足条件等保存阻塞并失败关闭，暂停用户队列。普通聊天不强制派工。
- 每周期最多 32 次主调度运行、64 次计划/审阅决策；这不是 token 预算。

## 验证结果

`pnpm typecheck`、`pnpm check:architecture` 通过：46 个目录、201 个代码/样式文件、305 个维护文件、1088 条含类型依赖，0 循环。

全量 89 文件、393 项测试通过，原始报告 `test-results/goal-review-unit.json`。覆盖目标版本、真实日志绑定、回执哈希及正文、主知识提交、人工项保护、过期知识、失败替代、重规划、主轮完成后副作用、次数限制、普通问答、停止竞争和重开。

真实 Application + Pi 测试覆盖缺审阅、执行失败、伪造证据、同周期两次派工与重新审阅。后端区分主 LLM 回合已结束和业务目标未完成，不篡改实际运行状态。

`pnpm make` 产物：`build/20261107-024543/CBIM Assistant-win32-x64/CBIM.exe`，需保留同目录运行资源；ZIP 位于该构建目录 `make/zip/win32/x64/`。

实际打包 Windows 桌面依次运行：

- `pnpm exec tsx scripts/collaboration-ui-smoke.mts --scope-goals`
- `pnpm exec tsx scripts/collaboration-ui-smoke.mts --default-executor --scope-goals`

两条均通过真实输入框、计划、成员执行、证据审阅、排队、三个独立目标及完整 EXE 重启不重放；各主请求 8 次、成员 5 次，页面/传输错误 0。报告 `test-results/collaboration-scope-goals-ui-smoke.json`、`test-results/main-instance-scope-goals-ui-smoke.json`，各 7 张截图，已检查排队及重启画面。

使用隔离测试工作区与本机确定性 SSE 响应，真实执行 Electron/Pi、工具和持久化；没有使用用户密钥或真实业务项目，也没有据此宣称在线模型自主分工质量。

## 维护及限制

同步 `core/tasks`、`scheduler-engine` 的 conversation/execution/tools、main 装配的注释和类图，以及三个领域 CONTRACT、概念说明和路线图。

尚缺目标状态专用界面、可恢复持久等待、真实人工验收、业务产物指纹与外部修改检测、全局预算。`awaiting_user/blocked` 本步仍失败关闭并暂停队列。知识与调度没有跨存储原子锁；语义是否达到目标仍由主 Agent 审阅，证据引用不等于人工认可。
