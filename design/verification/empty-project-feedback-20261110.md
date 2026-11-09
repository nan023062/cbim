# 空项目搭建反馈：修复与验证边界

2026-11-10。用户反馈模块、岗位和负责人搭建阻塞，随后明确要求废弃真人花名册。基于当时 develop 的实际实现逐项处理，未修改已公开 0.1.3 制品。

| 反馈 | 当前结果 |
| --- | --- |
| 真人花名册与维护确认阻断 | 已废弃。新项目不生成，界面/工具/校验/派工不再要求；历史文件及任务字段保留。岗位、模块负责人和权限仍有效 |
| module.name / agent.purpose 与 Schema 不符 | 已修复。对象预览 v2 的 data 按 kind 区分，实际字段共用 Schema；模块结构名来自 slug，中文名写正文 H1 |
| 模块章节错误不给出标题与模板 | 已修复。返回五个精确标题和可复制模板，桌面共用结构；规范示例明确不带序号。模板须按真实业务填写 |
| 重复绑定误报版本过期 | 已区分 NO_CHANGE、ALREADY_EXISTS 和 BINDING_STALE；明确 inspect、expectedBinding 与下一步，诊断不写责任历史 |
| 派工逐层暴露缺口 | 独立收集当前可核实的模块/Workflow、岗位责任/来源、能力和模型问题。同错误码合并；前提缺失明确为待核实，有问题不返回 selection |
| 不知道如何创建 member | 缺少岗位时指出桌面“团队架构 → 项目岗位 → 登记项目岗位”；当前主工具仍不开放岗位创建，不伪造可用工具 |
| 旧 instanceId 报错含糊 | 已区分工程选错和运行实例变化，指出当前 instanceId 及 cbim_workspace_identity，要求重新读取/预览；未知写入先核原回执 |
| feedback 三工具不存在 | 原现场未复现。当前桌面主会话总有 status；连接有效时装配 submit/receipt。知识族目录不包含反馈工具，不能据此判断缺失。已验证空项目登录后新轮装配与恢复，未修改授权边界 |
| 选择卡偶发 fetch failed、实例为何重启 | 原因未确认。现有真实 Pi 的回答、取消、坏回包、停止测试通过，不代表已消除现场网络或进程问题。定位仍需受影响版本及当时工具/进程日志，不猜测、不自动重试未知操作 |

## 独立提交

- `bbc6a40`：花名册退役，详见[完整验证](retired-human-roster-20261110.md)。16 个受影响 TS 文件/97 项、Python 26 项；类型、架构/依赖通过。
- `e3de619`：对象 Schema 与模板诊断。5 文件/18 项，类型/架构通过。
- `953aab7`：责任错误分类与执行缺口。5 文件/53 项，经失败夹具修正后通过，类型/架构通过。
- 实例恢复指引作为本记录所在的独立提交；源码和 main/workspace 的 CONTRACT/ARCHITECTURE 同步。

各项实际命令和首次失败、复测结果见[开发记录](../development-log.md)。不同步骤重复覆盖的用例不累加为不同用例。

实例恢复、反馈和提问的最后定向命令：

```text
pnpm exec vitest run tests/workspace.test.ts tests/github-feedback-status.test.ts tests/github-feedback-lifecycle-pi.test.ts tests/question-tools.test.ts tests/question-tool-contract-pi.test.ts --reporter=default --reporter=json --outputFile=test-results/instance-feedback-question-20261110.json
```

结果：5 文件/39 项通过。覆盖真实工作区关闭重开后拒绝旧实例、刷新身份后可读、身份隔离；空项目登录后新轮装配两反馈工具；选择卡回答/取消/坏回包/停止均不重问或伪造业务结果。反馈服务使用测试端口，未创建线上 Issue 或联系他人。

`node scripts/source-architecture.mjs --check` 与 `git diff --check` 通过。最后一步仅改错误指引，没有引入依赖或类型变化，不重复跑已通过的全套静态检查。

未执行全仓测试、完整桌面、打包、安装升级或发版；后续面向 master 的 PR 继续走现有自动 CI，制品发布另行验收。原现场工具缺失和网络/进程异常保留为待定位问题，不写成已修复。
