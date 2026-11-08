# GitHub OAuth 配置与一次真实 Issue 验收

适用日期：2026-11-08。适用版本：CBIM Assistant Windows x64 桌面 `0.1.0`。这是一份操作指南；实际执行结果单独记在[线上验收记录](../verification/github-feedback-online-20261108.md)，不能把下列步骤当成已通过的证据。

本次目标是：维护者注册一次 OAuth App → CBIM 用户完成一次 Device Flow 授权 → 在对话“+”调用反馈 Skill → 按格式提供上下文 → 软件直接创建 GitHub Issue。用户无需反馈服务器、手动网页填单或提供 Token；创建成功后，CBIM 不追加结果消息。设置中的「软件更新」展示当前版本日志和可用新版日志，修复／功能变化通过版本日志统一发布。

**当前已注册应用：** `CBIM Feedback`，所有者 `nan023062`，公开 Client ID **`Ov23liSMDZneBd3gSyTo`**。[维护者设置页](https://github.com/settings/applications/4002869)。使用现有应用时直接从第 2 节开始，不重复注册；此标识不是 Client Secret。

## 1. 注册 OAuth App（维护者操作一次）

使用准备维护应用的 GitHub 账号登录，打开 [OAuth Apps](https://github.com/settings/developers)，路径为头像 → **Settings → Developer settings → OAuth Apps**，选择 **New OAuth App**；首次注册时按钮可能显示 **Register a new application**。本次使用 OAuth App 的 Client ID。[GitHub 注册说明](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)

建议填写如下。本表中的名称、说明与回调路径是 CBIM 本次配置建议，不是 GitHub 的固定值。

| 页面字段 | 本次填写／选择 |
| --- | --- |
| Application name | `CBIM Feedback` |
| Homepage URL | `https://github.com/nan023062/cbim` |
| Application description | `CBIM 内置 BUG 反馈与需求许愿，由用户授权后直接提交 GitHub Issue。` |
| Redirect URIs → Redirect URI（旧页面称 Authorization callback URL） | `http://127.0.0.1/oauth/callback` |
| Allow wildcard matching | **保持不勾选** |
| Enable Device Flow | **勾选** |
| Expire user access tokens（如页面显示） | 可保留默认开启；当前 CBIM 识别过期时间，过期后需手动断开并重新连接，尚不自动刷新 |

回调地址是注册表单所需的占位设置；**当前 CBIM 只走 Device Flow，不访问这个地址，也不启动本机回调服务器**。因此无需部署网页或服务来接收回调，不把 GitHub 的 `/login/device` 页面填成回调地址。后续若实现浏览器回调登录，应另行配置真正的回调处理与校验。GitHub 支持原生应用的 loopback 回调；这里选用字面地址 `127.0.0.1`。[授权流程与 loopback 说明](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#loopback-redirect-urls)

点击 **Register application**，在详情页确认 **Enable Device Flow** 已开启；如修改了字段，点击 **Update application**。复制详情中的 **Client ID**。Client ID 是公开标识，可填入 CBIM；**不需要生成或提供 Client Secret**，也不需要创建 PAT。若 GitHub 要求重新登录或二次验证，由账号本人完成。[修改应用](https://docs.github.com/en/apps/oauth-apps/maintaining-oauth-apps/modifying-an-oauth-app)、[Device Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)

正式 APP 已内置此公开 Client ID，用户不必填写或注册 OAuth App；每个使用者仍用自己的 GitHub 账号完成首次授权。

## 2. 在 CBIM 配置并完成 Device Flow

从桌面通道 [desktop-v0.1.0](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.0) 下载 `CBIM-Setup-0.1.0-x64.exe`，核对同页 `SHA256SUMS.txt` 后安装。构建阶段、本页所指 Release 尚未发布时，只使用维护者提供的候选安装包，不把链接当成发布已完成的证据。旧 Python 内核 `v1.x` 不是桌面安装包。日常 CBIM 若仍有运行任务，应正常结束任务再切换程序；测试专用用户目录的连接不会自动成为日常目录的连接。

1. 打开 CBIM，点击 **用户菜单 → 设置 → GitHub 反馈**。
2. 核对默认目标 `nan023062/cbim`。普通用户无须填写配置；维护者需要检查或更改连接时展开 **高级连接设置**：

   | CBIM 字段 | 本次值 |
   | --- | --- |
   | 公开 Client ID | `Ov23liSMDZneBd3gSyTo` |
   | 仓库所有者 | `nan023062` |
   | 仓库名 | `cbim` |
   | 仓库可见性 | **公开仓库（public_repo 权限）** |

   2026-11-08 通过公开 GitHub API 核实：仓库 ID `1240750134`，公开、未归档、Issues 已启用。此核验不代表已完成用户授权；实际连接时 CBIM 会再次核对账号及仓库。
3. 点击 **连接并允许反馈自动提交**。该按钮明确授权两项反馈 Skill 向此固定仓库提交；之后填写完上下文无需逐条批准。
4. CBIM 显示短授权码后，点击 **打开 GitHub 授权页**。浏览器应进入固定官方页面 `https://github.com/login/device`。登录期望用来发单的账号，输入 **CBIM 当前显示的短码**，核对应用名称和权限后授权。不要把 Token、Client Secret、密码或私人验证码发送到聊天。
5. 保持 CBIM 设置页打开，等待其自动轮询。成功时显示 **已连接 <GitHub 登录名> · nan023062/cbim**。以这里显示的真实登录名和仓库为准；浏览器出现成功页面本身不是 CBIM 连接验收结果。
6. 完成当前任务并正常关闭 CBIM，再用**同一用户目录**重开，确认仍显示同一连接。只读检查不创建 Issue。

公开仓库的 `public_repo` scope 并非“仅允许某仓库的 Issue”，它在 GitHub 侧包含用户已有的公开仓库读写权限；CBIM 的反馈工具额外限制为上面明确连接的仓库。只有确实需要私有仓库时才选择私有模式，该模式申请更广的 `repo` scope。[GitHub OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)

维护者可用启动环境变量 `CBIM_GITHUB_CLIENT_ID` 替换默认公开标识，但它不会覆盖已有保存配置。普通用户直接点击连接。令牌由 CBIM 主进程通过系统安全存储加密保存在当前用户目录；不放入源码、产品 Skill、模型上下文或渲染页面。**断开 GitHub 连接**只移除本机连接；要撤销网站授权，在 [GitHub Applications](https://github.com/settings/applications) 的 **Authorized OAuth Apps** 中找到 `CBIM Feedback` 并撤销。

## 3. 线上只创建这一条测试 Issue

执行前先读[验收记录](../verification/github-feedback-online-20261108.md)，核对本机是否已有待核实或成功回执，以及 GitHub 是否已有下列测试标识。发现未知结果时先核实原提交，不以新工作区、新正文或新对话绕过去重。

使用一个明确的 CBIM 验收工作区和新对话，选择已配置可用的主会话模型，权限选择 **ask** 或 **execute**；read 会话不能提交。点击 **“+” → BUG 反馈**，确认调用 `cbim_skill_bug_feedback` 并显示填写格式。之后只发送一次以下上下文：

```text
问题简述：GitHub 反馈链路线上验收（2026-11-08，测试工单）
复现步骤：
1. 在 CBIM 设置中完成 GitHub Device Flow 授权。
2. 在对话加号菜单选择 BUG 反馈，由 Skill 展示格式。
3. 按此格式提交一次上下文，验证自动创建 GitHub Issue。
实际结果或报错：这是一条经维护者授权的集成验收工单，不是实际业务 BUG；用于核对真实登录、固定目标仓库与 Issue 创建链路。
期望结果：nan023062/cbim 中仅创建一条对应 Issue，内容与本次上下文一致；CBIM 成功后不追加提交结果消息。
版本与操作系统：CBIM Assistant 0.1.0 Windows x64 正式安装包；Windows 11。
补充上下文：测试标识 CBIM-GITHUB-ACCEPTANCE-20261108-01。仅作本次线上验收证据，不据此安排缺陷修复或需求开发。没有附加工程、日志、截图或账号凭据。
```

预期 GitHub 标题：`[BUG] GitHub 反馈链路线上验收（2026-11-08，测试工单）`。后端根据字段生成 Markdown，并添加本机操作的唯一隐藏标记；不要人工构造或改写这个标记。需求许愿共用同一提交服务，**本次不为重复验证再创建第二张工单**。

验收按以下证据判断：

| 项目 | 通过条件 |
| --- | --- |
| 登录 | CBIM 显示真实账号与 `nan023062/cbim`，重开同一用户目录仍保持连接 |
| 调用路径 | 产品主会话读取 BUG Skill，再调用 `cbim_feedback_submit`；不通过 `gh issue create`、手写 HTTP POST 或网页手工填单代替 |
| 真实创建 | 原回执为 submitted；GitHub 上实际可读到唯一测试 Issue，作者、仓库和正文相符 |
| 提交次数 | 只发送一次测试上下文；核对工具／本机提交账本和 GitHub 唯一测试标识，结果未知时不重发 |
| 产品行为 | 成功后对话不出现额外成功消息、编号、链接或结果总结；原工具证据仍可核对 |
| 验收记录 | 保存构建号、时间、账号、仓库 ID、会话／操作标识和实际 Issue 链接；不记录 Token、device_code 或私人验证码 |

这次开发验收报告可列出实际 Issue 链接作为证据，与产品正常反馈流程的成功静默分开。测试工单保留供追溯，不在没有记录的情况下删除或另建；不顺带启动 CI、开发任务、合并或发布。

## 4. 常见阻塞及下一步

| 现象 | 下一步 |
| --- | --- |
| 设置里没有 GitHub 反馈 | 核对构建号；使用含反馈功能的包，避免继续操作旧包 |
| “连接”按钮不可用 | 在高级连接设置核对默认 Client ID、所有者和仓库名；若系统安全存储不可用，先解决当前系统用户的安全存储，不改存明文 Token |
| `GITHUB_DEVICE_FLOW` | 确认填的是 OAuth App 的 Client ID，应用设置已勾选 Enable Device Flow 并保存 |
| 授权页要求登录／二次验证 | 账号本人在 GitHub 页面完成；不在聊天中提交密码或私人验证码 |
| `GITHUB_EXPIRED` / `GITHUB_FLOW` / `GITHUB_AUTH` | 授权短码或登录失效；结束当前授权，重新连接并使用新的短码。若已有连接，先断开本机连接 |
| 浏览器已授权，CBIM 仍等待 | 返回并保持 CBIM 设置页打开，等待合法轮询间隔；程序已退出时重新连接，不能复用旧流程 |
| `GITHUB_BINDING` | 核对账号可访问目标、仓库可见性与设置一致、Issues 开启、未归档，以及本机安全存储可用；不要为通过验收擅自改变仓库可见性 |
| `GITHUB_CONNECTION_CHANGED` | 账号／目标或连接代际改变，先检查原提交记录，再重新发起；不把新连接当成旧提交证据 |
| 提交超时或 `GITHUB_SUBMISSION_UNKNOWN` | 由 Skill 只调用一次 `cbim_feedback_receipt` 核实原提交；未找到不等于未创建，不再 POST |
| `GITHUB_PENDING_OTHER` | 当前工作区另有未核实提交，先处理原记录；原记录的成功不表示本条测试已提交 |
| `PROFILE_LOCKED`（Cindy 浏览器） | 当前 Chrome 占用登录数据库；由使用者完全退出包括托盘后台的 Chrome 后再尝试。不要自动杀进程、复制 Cookie 或切换成其他账号 |
| `APP_BOUND_ENCRYPTION_UNSUPPORTED`（Cindy 浏览器） | Chrome 已退出，但 Windows 不允许解密复制的登录数据。由使用者选择「我的浏览器」经 Cindy 扩展沿用原账号，或选择在 Cindy 专用浏览器重新登录；继续退出 Chrome 不能解决此限制 |
| 「我的浏览器」显示扩展未连接 | 在选择的同一个 Chrome 个人资料中安装／启用 [Cindy 官方商店扩展](https://chromewebstore.google.com/detail/cindy/dmbhhhdijpeaibfeocdcjhfefkgpkeef)，保持 Chrome 和 Cindy 运行；再由工具检查连接。浏览器个人资料不能代替 GitHub 账号核验 |

当前实现没有自动刷新 Token、GitHub Enterprise、自动附件上传、反馈进度查询或本机未知记录强制清除入口；这些限制不以一次线上成功为由抹去。
