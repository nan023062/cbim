# Issue #10：自动与团队协作模式

本项在 #9 `70dfc26`、#11 `5bb7c08` 各自独立验证、提交和回填后单独交付。公开客户端 0.1.1 不包含本项，正式版本发布另行安排。

## 实现与边界

权限选择旁增加自动／团队模式。新对话默认自动；没有模式偏好的历史对话保持团队规则。发送和排队保留实际选项，新目标建立时冻结；活动及等待目标禁用切换，结束后同一对话可以改选。

自动模式在真实模块无人负责时使用内置 `cbim:executor` 和原周期模型；完全没有业务模块时使用临时 `cbim:project`，不登记正式模块、岗位或维护人。已有负责岗位不能因失效而自动降级。团队模式缺少有效负责人或模块时拒绝派发，要求人工配置。自动模式不提升 read/ask/execute 权限，不消除 human 验收。

`fallbackBinding` 与长期岗位的 `ownerBinding` 分开：计划、派发回执、任务和运行保存同一原因、范围、模型及知识指纹。原命令查询不重新执行；首次计划、派发、领取和恢复核当前责任，历史结算保留原身份。检查点、依赖修订、受控写与人工接受沿用既有机制并核同一执行来源。

## 维护入口

- 纯模式及兜底契约：`core/team/automatic-execution.ts`；同一存储前缀校验：`core/tasks/automatic-execution-rules.ts`。
- 只读隐式模块：`scheduler-engine/context/automatic-context.ts`；知识／模型／存储按原锁顺序核实：`OwnerExecutionService`。
- 可信运行模式进入 AutoCollaboration、GoalTools、DispatchTools；模型不能在工具参数中自授模式或兜底证明。
- 对话只保存用户选择；目标卡及任务详情显示真实兜底原因。后端拥有可信模式及冻结执行身份。

统一说明见[成员执行](../../docs/member-execution.md#自动与团队模式)。同步 core/team、tasks、brain，main/workspace，scheduler-engine/context、conversation、execution、tools，bridge/contracts，frontend/conversation、tasks 的源码注释、CONTRACT 与 11 份目录架构。变化点是执行来源选择，权限、事务、预算、租约和人工验收继续共用；未新增一套宽松的自动执行后端。

## 验证记录

- 类型／架构检查通过：53 目录、573 个代码／样式文件，1129 个维护文件、5916 条依赖、0 环。
- 模式与菜单界面：`node scripts/issue11-ui-smoke.mjs` 的 9 组断言通过（真实 React App、模拟 IPC），页面错误及执行写入 0；新增自动默认、历史团队默认、显式切换、重载持久化和权限不变的断言。
- 已完成的 Windows 构建 `20261109-134943` 使用真实 EXE、IPC 与隔离项目复验负责人登记：2 岗位、3 责任变更，取消／重启写入、模型请求、页面错误均 0，知识及已有运行文件不变。报告 `test-results/issue10-owner-desktop-regression.json`。此场景验证岗位路径回归，不冒充自动模式的模型执行验收。
- 自动执行的真实 Application、Pi 子进程、文件与派发持久化由 `automatic-execution-pi.test.ts` 验证，供应商响应来自 localhost 的确定性服务；不宣称在线模型自主分工质量。

首次 Pi 测试因重开工作区后仍读取已退役的测试句柄失败；改为读取新实例后复验通过，失败报告 `issue10-pi-initial.json` 保留。模式界面首次断言把下拉箭头计入标签，修正为只读取文本节点，记录 `issue10-ui-label-initial-failure.txt` 保留；没有修改产品恢复或权限行为来适配测试。

独立最终回归：26 文件 **192/192** 通过、0 失败（143 秒），报告 `test-results/issue10-isolated.json`。包括无模块／无人负责、真实 Pi 三档权限、同对话改回 Team 后拒绝保底、重启不重放，以及原岗位独立模型、人工验收、检查点、持久等待、依赖修订、输出契约、受控文件及分层依赖。随后按本 Issue 单独提交。
