# 对话加号菜单：BUG 反馈与需求许愿验证

日期：2026-11-08。本步是 Step55 收口之后用户明确要求的独立菜单改动，不恢复原剩余开发计划。

## 已交付范围

- 对话“+”菜单新增「BUG 反馈」「需求许愿」，分别发送对应内置 Skill 的格式引导请求。
- `Builtins` 注册 `bug-feedback`、`feature-wish`，实际知识工具分别提供 `cbim_skill_bug_feedback`、`cbim_skill_feature_wish`；正文随已有 `design/` 资源打包规则分发。
- 主 Agent 指引要求先读取相应 Skill，再引导用户按格式提供上下文；反馈收集不建立业务目标或派工。
- 菜单调用只发送独立消息、空附件，保留原草稿与附件；运行中沿用排队机制，无模型、操作在途或不能安全续聊时禁用。

## 本次实际验证

| 检查 | 结果与边界 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm check:architecture` | 51 目录、549 源码／样式；生成文档无差异；1071 文件、5722 依赖、0 环 |
| 相关 Vitest | 8 文件、34 项通过，无失败或跳过；覆盖依赖／分层、真实内置读取、工具业务输出／自描述、会话状态与展示 |
| 知识工具 Pi 集成回归 | 另 1 文件、3 项通过，验证新增别名后目录、自描述、正常提交、取消及提交后坏回包边界；使用本机确定性服务，非在线模型质量结论 |
| 真实前端组件交互 | Edge 无头浏览器加载实际 `Conversation`／`AttachmentMenu`，IPC 使用记录请求的夹具；6 组场景通过，4 组菜单调用页面错误均为 0 |
| 界面场景 | 新对话 BUG、已有对话需求、运行中排队、提交失败、无模型禁用、普通消息发送；12 项附件不禁止 Skill，在途不能再次发送，原草稿与附件未带出或清空 |
| 目检 | 查看实际组件截图，菜单分组与两项标签正常；截图中的无业务目标和准入不可用提示来自隔离夹具 |

合计 9 个测试文件、37 项通过，另有 6 组界面交互检查。原始本机证据：`test-results/feedback-skill-menu-tests.json`、`test-results/feedback-skill-knowledge-pi-tests.json`、`test-results/feedback-menu-ui-report.json`、`test-results/feedback-menu-ui.png`。界面夹具与执行脚本位于 `test-results/feedback-menu-ui-check.mjs`，不计作真实后端或在线模型端到端验收。

## 同步维护与限制

源码注释、会话／知识／主 Agent 指引三组 `CONTRACT.md` 和 `ARCHITECTURE.md`、对应父目录类图与架构生成器职责说明已同步。前端仍只使用桥接契约，没有新增前端到后端实现的依赖。

本步没有接入 GitHub 用户授权或创建 Issue 工具，没有创建真实 Issue，没有实现软件更新日志页面。没有运行完整全仓回归、在线模型自主流程或新的 EXE 验收，未生成新的安装包、合并或发布。读取 Skill 和收集上下文不等于已提交 GitHub；后续工作见[入口方案](../task/user-feedback-intake.md)。
