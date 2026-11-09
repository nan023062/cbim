# GitHub 反馈直接提交验证

日期：2026-11-08。范围：在已有“+ → BUG 反馈／需求许愿”菜单和格式收集 Skill 上接入 GitHub。代码与本地验证完成；真实 OAuth App 尚未注册，线上登录／创建 Issue 尚未验收。上一步菜单证据见[原记录](feedback-skills-20261108.md)。

## 交付行为

- 设置页提供公开 Client ID、目标仓库和 Device Flow。用户明确“连接并允许反馈自动提交”后，设备授权码只用于官方 GitHub 页面；令牌由系统安全存储加密，本机保存，不交模型或渲染进程。
- 两项 Skill 按各自格式收集用户上下文，齐备后直接调用 `cbim_feedback_submit`。后端只排版本次字段，不自动读取工程、上传附件、建立业务目标或派发任务。
- 创建属于 `external-write`，可信目标绑定工作区、连接代际、账号和不可变仓库 ID。read 拒绝；ask/execute 只对已在本机明确授予的固定 GitHub 目标免逐条审批，不改变其他写入规则。
- 成功只返回最小 submitted 事实。Skill 结束，不追加成功消息、编号、链接、总结或处理进度；对话投影在真实成功工具回执后隐藏追加的结果文字，原工具证据及失败说明保留。
- 先可靠保存 sending 意图再 POST。同工作区相同账号、仓库及内容跨调用／会话／重启去重；未知阻止该工作区继续提交，不能通过换调用 ID 或换正文绕过。
- `cbim_feedback_receipt` 只核实原提交是否创建。最多核实原作者最近 500 条 Issue，精确比较原身份、URL、标记及正文／标题指纹；未找到、内容被改写或越界仍保持未知。不查询开发进度，不自动重发、清除或复活原运行。

## 实际验证

| 验证 | 结果与边界 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm check:architecture` | 51 目录、556 源码／样式；架构同步，1081 文件、5770 依赖，0 环，含类型引用 |
| 定向回归 | 17 文件，124/124，通过，0 失败／跳过；48.61 秒，不是全仓回归 |
| 新增反馈验证 | 上述回归包含 35 项：服务 24、工具／权限／静默投影 8、真实 Pi 主会话 3；不重复计数 |
| 设置页真实组件 | 隔离 Edge 中 4 组交互通过：连接及显式打开授权页、取消不继续轮询、错误保留输入、安全存储不可用时禁用。IPC 为夹具，无真实登录 |
| Windows 打包 | `pnpm package` 通过，构建 `20261108-201655` |
| 打包桌面检查 | 真实 EXE／preload／IPC／设置界面通过；系统安全存储加密往返通过，缺 Client ID 拒绝请求，页面错误 0，正常退出并清理隔离数据 |

回归覆盖原知识权限、公开事件、产物证据／验证、成员求助、目标门禁、受控文件未知屏障和会话显示。新的 GitHub 服务测试验证了 interval／slow_down／过期、授权取消和跨窗口流程替换、账号／仓库换绑拒绝、写前意图、并发及跨会话去重、重启后核实、丢回包、坏 201／503、明确 422 拒绝、回执保存失败、错误作者／仓库／正文／PR、不安全地址、重定向配置和响应大小限制。

Pi 测试使用真实子进程、生产主会话装配／权限／持久回执／Skill 读取；模型由本机确定性服务提供，GitHub HTTP 返回由夹具替代。验证 ask 下无逐条审批且只产生一次 POST、read 下零 POST、未连接时不注册提交工具。没有把夹具数据当作真实 GitHub Issue。

打包检查脚本曾因测试上下文无 `require`、Windows ASAR 分隔符及未先打开用户菜单而失败；修正脚本后对同一 EXE 重跑通过，产品代码未因这些脚本问题修改。过早退出的隔离测试进程已按核实后的专属 PID 停止，未操作日常用户实例。

## 本机证据与构建

- `test-results/github-feedback-regression.json`：最终 124 项回归。
- `test-results/github-feedback-ui-report.json`、`github-feedback-ui.png`：4 组真实组件检查。
- `test-results/github-feedback-package.log`、`github-feedback-package-report.json`、`github-feedback-package.png`：打包和最终桌面检查。
- EXE：`build/20261108-201655/CBIM Assistant-win32-x64/CBIM.exe`。这是本地验证包，未合并或发布。
- 打包主程序 SHA-256：`3ddc417b1c04374f38fbf9c4991d86ccca7ab4039eed2ac5780082d5d2117102`，与本次 `.vite/build/main.js` 字节一致。
- 包内 BUG Skill：`347b9914025473f3423f8e97c0dd034e8909101922e1f738d88bd0ed3c169275`；需求 Skill：`16fea3e6a3f51ad973ee6e154c96a36ff1ebaa28ec9f7f9ffadd43e9031f24fa`，均与当前运行资源一致。收尾说明在验证后补写，不把整个工作树声称为已冻结发行版。

## 同步维护

新增／更新源码文件头、公开端口、授权范围、凭据和提交生命周期注释。同步 Core 的 connectors／policy／tools／tasks／brain，Main 的 resources／ipc／platform 及装配层，Scheduler 的 tools／execution／conversation，bridge/contracts，Frontend 的 settings／conversation 与受影响父层架构。相关 CONTRACT 和类图描述当前实现；依赖仍为 Main → Scheduler/Core、Scheduler → Core、Frontend → bridge/contracts，没有跨层反向调用。

同步两项产品 Skill、[入口方案](../task/user-feedback-intake.md)、[开发管线](../cindy-development-pipeline.md)、[路线图](../tool-architecture-roadmap.md)与[开发记录](../development-log.md)。

## 剩余条件

1. 用户确认尚未注册 OAuth App。维护者需注册并启用 Device Flow，配置公开 Client ID，再完成真实账号／目标仓库验收。不需要在聊天中提供 Token 或 Client Secret。[官方 Device Flow 说明](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)
2. 只支持 github.com，未接 GitHub Enterprise。公开仓库请求 public_repo；私有仓库需明确选择 repo 权限。当前 Client ID 可在设置填写或由 `CBIM_GITHUB_CLIENT_ID` 提供，尚未随发行包预置正式 App ID；授权失效需重新连接，没有 token 自动刷新。
3. 不自动上传本地截图／日志，只发送用户愿意分享的字段或链接。账本每工作区最多 1000 条；未知核实有界且不把未找到当成未写入，原内容已变更的记录可能需人工核实，未提供强制清除或历史管理页。
4. 未创建真实 Issue／PR、未提交或推送这批新改动；未开发更新日志展示、岗位开发 Skill、CI 或协调自动化，未恢复 Step55 之后的原计划。
