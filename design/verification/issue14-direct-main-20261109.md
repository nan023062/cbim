# Issue #14：Auto 直接工作与项目根范围

> 历史快照：正文中的目录、完成状态与验证数字保留记录日期的事实，不是当前实现清单。四层迁移后的现状请看 [源码契约](../../src/CONTRACT.md) 和 [Logic 边界](../../src/logic/BOUNDARIES.md)。

日期：2026-11-09。范围：[Issue #14](https://github.com/nan023062/cbim/issues/14)。

## 实现与边界

- Auto 主会话直接探索、修改业务文件、执行命令及验证；不以建团队、岗位、模块或正式派发目标为开工前置。Team 和缺省历史模式保留独立成员调度。
- `cbim:project` 始终可查询和显示。模块 registry/get 升到 v2；内置根使用独立字段和内联正文，不伪造磁盘定义、维护人或负责人。真实模块出现后根仍保留；正式 `no_modules` 委派兜底仍只接受真正空项目。
- 运行模式来自可信周期；read 拒绝写/命令，ask 逐项批准，知识路径仍保护。主轮按实际权限取得工作区占用，防止拿只读租约却开放写工具；Team 的 ask/execute 同样保守独占，但不因此获得业务写能力。
- Auto 单独知识沉淀不强造团队目标；显式规划/派发、未确认输入、未知工具和日志终态继续走原收尾门禁。治理指引要求在真实里程碑、重复工作与稳定业务边界出现后审视架构和团队；没有新增定时器或后台自动建模块。
- 桥层只重导出纯根身份；界面始终展示根与真实子模块，不为根提供真实模块编辑、删除或负责人入口。

## 实际验证

1. `pnpm typecheck` 通过。
2. `pnpm check:architecture` 通过：53 个目录、579 个代码/样式文件，0 文档差异；1141 文件、5947 条含类型依赖、0 循环。
3. `issue14-runtime.json`：6 文件 / 75 项通过。真实 Application、Pi、文件/命令及审批，模型为确定性本地 SSE；覆盖 Auto read/ask/execute、已有模块、Team 保持约束、`.cbim/` 拒写、审批前零写入、并发占用拒绝、实际命令回执、无虚假派发/岗位、重开无重放。知识治理分别验证 Auto 正常关闭与 Team 原正式目标门禁。
4. `issue14-regression.json`：12 文件 / 67 项通过。包括根查询、严格知识输出、真实主实例、自动成员回注、全局准入、正式目标缺审阅/伪造证据/失败成员/重规划，以及依赖和跨层检查。
5. `pnpm package` 通过；便携构建 `20261109-203222`。
6. `node scripts/issue14-ui-smoke.mjs` 通过：真实 Windows Electron 与 IPC，独立临时用户目录和项目。空项目根可见且不写知识；经真实表单创建模块后根保留；重载不产生新写入。深浅色截图已检查，页面错误 0。回执 `test-results/issue14-ui-report.json`，截图 `issue14-light.png` / `issue14-dark.png`。

初轮 5 文件 / 24 项为实现早期验证，最终以上两个互不重叠集合共 18 文件 / 142 项为准，不重复计数。证据 JSON 与截图保留于本机 `test-results/`，脚本、行为测试和本报告纳入仓库。

## 维护入口与限制

直接工作模式在 `conversation/main-agent.ts` 和 `execution/loop-engine.ts`；周期收尾分别在 `auto-collaboration.ts`、`dispatch-service.ts`；主租约装配在 `main/execution.ts`。根范围在 `core/workspace/project-root.ts` 和 `model.ts`，查询协议在 `core/knowledge/tool-output-queries.ts`，展示在 `frontend/workspace/WorkspaceView.tsx`。

更新了受影响源码注释、11 份生成架构文档及对应 CONTRACT，概念说明同步到成员执行、主调度循环与派发契约。现有权限、持久化、正式成员执行和人工验收核心继续复用。

本次未测试在线供应商的自主规划质量，也未声称原生命令是操作系统沙箱；未安装、更新或重启用户的正式客户端。源码闭环不等于新版本已经交付用户，公开版本仍为 0.1.2。
