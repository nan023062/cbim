# Task：单一任务

本说明面向人，帮助了解任务目录；Agent 按需读取专用规范。Task 将一个AI 成员、由它维护的模块集合和一个验收目标组合起来。CBIM AI 助理组织任务，执行者使用 CBIM 内部大脑循环。

- [构建与维护规范](task-spec.md)：字段语义、维护依据、合并拆分及恢复要求。
- [BaseTask 与执行接口](base-task.md)：结构图、派发与执行边界。
- [Task Loop](task-loop.md)：CBIM AI 助理的任务构建与结果反馈。
- [知识基线与恢复](task-baseline.md)：版本绑定与恢复证据。
- [模块负责人索引历史方案](module-owner-index.md)：工作区成员、责任查询、按负责人派发与更换交接的开发切片；不是运行时 Skill，当前实现见 [任务契约](../../src/logic/tasks/rules/CONTRACT.md)，方案不是实时进度。
- [反馈／许愿 Skill 与软件更新日志](user-feedback-intake.md)：对话加号菜单调用两项产品 Skill，一句问题或愿望即可提交，参考字段自愿填写，经真实 GitHub 授权提交 Issue；版本日志已接入，实际线上结果另记。
- [正式桌面发布与更新](desktop-release.md)：Windows 安装包、独立 updater 目录、GitHub 桌面通道、后台检查和下载、用户明确点击重启安装。
- [桌面分层更新设计](desktop-hot-update-design.md)：C/R 双版本、完整资源 ZIP、独立 Agent 引擎及新旧流程取舍；首版已实现，本地验证不等于公开升级验收。
- [分层更新构建与发布](desktop-runtime-release.md)：C/R/E 候选、资源签名、发布顺序、首次冷更迁移和实际恢复边界。
- [GitHub OAuth 配置与线上验收](github-feedback-setup.md)：OAuth App 注册字段、Device Flow 登录与单条真实测试 Issue 的操作指南。

本目录保存抽象，具体任务由 CBIM 内部调度与持久化服务承载；可靠入队不代表成员已自动执行。
