# GitHub Device Flow 与 Issue 线上验收记录

日期：2026-11-08。对应操作指南：[GitHub OAuth 配置与一次真实 Issue 验收](../task/github-feedback-setup.md)。本记录与前一步的[本地／打包验证](github-feedback-20261108.md)分开，后者的 HTTP 夹具结果不计为线上通过。

## 本次目标与授权范围

用户要求写清 OAuth 配置步骤、跑通真实 Device Flow 登录，并线上验收一次 Issue 创建。本次仅创建一条明确标记的测试 Issue；不重复投递、不更改仓库可见性、不合并或发布、不启动其余开发管线。

候选构建为 `20261108-201655`，目标 `nan023062/cbim`。测试正文、标题与标识 `CBIM-GITHUB-ACCEPTANCE-20261108-01` 已在操作指南固定。公开 Client ID 为 `Ov23liSMDZneBd3gSyTo`，OAuth App ID `4002869`；后续仍以实际授权后 CBIM 显示的账号为登录验收依据。

## 实际执行记录

| 检查 | 已观察到的事实 |
| --- | --- |
| 仓库只读预检 | 未认证 GET `https://api.github.com/repos/nan023062/cbim` 返回 HTTP 200；`id=1240750134`、`private=false`、`has_issues=true`、`archived=false`、默认分支 `master` |
| 浏览器状态 | Cindy 已配置 `external` 浏览器，启用本人登录环境；尚未启动，`realProfile.applied=false` |
| 浏览器启动／页签读取 | 返回 `BROWSER_RUNTIME_ACTION_FAILED`，原因 `PROFILE_LOCKED`；未进入 GitHub 账号页面，已请用户完全退出 LINAN-XDT 上的 Chrome（包括托盘后台）后继续 |
| 用户退出 Chrome 后续接 | 用户确认退出后再次读取页签，错误变为 `APP_BOUND_ENCRYPTION_UNSUPPORTED`，Windows 阻止解密复制的登录状态 |
| 浏览器方式调整 | 用户明确选择「使用我的浏览器」，Cindy 返回 `backend=user-browser`、全局设置已保存；用户随后指定 `xd.com`，实际窗口标题核对为 `南 (xd.com)`。未复制 Cookie、切换 GitHub 账号或进入注册页面 |
| 当前扩展连接阻塞 | Cindy `status`／`doctor` 均报告 `connected=false`、无已连接客户端。Chrome 扩展管理入口未打开；地址栏已填 `chrome://extensions/`，但桌面工具拒绝后台回车，返回 `background_unavailable`。已停止该输入路径，并请用户在 `xd.com` 资料中安装或启用 Cindy 扩展；未使用脚本键盘或其他账号绕过 |
| 当前 CBIM | 观察到日常实例运行旧包 `20261108-172018`；未操作该实例。后续需使用包含反馈功能的新包，并明确使用的用户目录 |
| 配置说明检查 | 核对当前设置组件、授权代码、Skill 格式和 `build/latest-build.json`；5 份说明的 38 个相对链接无缺失，`git diff --check` 通过。本次未修改源码、重跑原 124 项测试或重新打包 |
| 扩展恢复与账号核验 | 用户在 `xd.com` 资料中添加扩展后，Cindy 返回 `connected=true`，Chrome 扩展版本 `0.4.68`。GitHub 个人设置页明确显示 `li nan (nan023062)`，OAuth Apps 列表为空 |
| OAuth App 注册 | 已创建一次 `CBIM Feedback`；GitHub 页面显示 `Application created successfully`、`nan023062 owns this application`，详情页为 `https://github.com/settings/applications/4002869`，Client ID `Ov23liSMDZneBd3gSyTo`。注册时 Device Flow 已勾选、回调 wildcard 未勾选、保留默认过期令牌设置；没有生成 Client Secret 或 PAT |
| CBIM Device Flow | 2026-11-08 22:13:19 CST：真实 GitHub Device Flow 成功，网页到达 `/login/device/success`，CBIM 设置／IPC 返回 `connected={login:nan023062,owner:nan023062,repo:cbim}`。EXE `20261108-201655` 使用独立 `test-results/github-feedback-live/user` 目录，系统 safeStorage 可用，页面错误 0；该测试实例已正常退出，加密连接保留。原用户实例未关闭 |
| 真实 Issue 创建 | 尚未执行；没有 Issue 编号、链接或成功回执 |

未为绕过浏览器锁终止用户进程、复制 Cookie、使用其他 OAuth App 的 Client ID，或借用 Git CLI 凭据发单。用户进一步要求先发布正式 APP，再在正式包中提交反馈；按[正式发布方案](../task/desktop-release.md)继续。当前登录证据属于旧测试包，不能替代正式包中的重启／反馈验收。

## 待补的真实证据

- 正式安装包中的同一用户目录重启连接状态；本次测试包登录证据见上表。
- 主会话读取 Skill 及提交工具的事实、原操作 ID、唯一 GitHub Issue URL、作者与正文核验。
- 成功静默显示、没有重复创建的检查结果；如结果未知，保留原状态并核实，不再次创建。

本记录不保存 access_token、refresh_token、Client Secret、device_code、登录密码或私人验证码。
