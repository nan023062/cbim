# 账号菜单的版本更新与最近一次更新

日期：2026-11-09。范围：将现有更新功能从设置页迁到左下角账号入口，保留独立 updater 和手动下载安装。源码与本地界面验收完成；未打包、安装或发布新版，已发布的 0.1.0 不因本次源码修改自动改变。

## 用户可见变化

- 账号菜单显示当前 CBIM 版本，未登录也可使用。“检查更新”在存在已知新版时显示为“查看更新”，并标明新版号。
- “最近一次更新”直接打开日志弹窗。没有已知新版时显示当前安装版内置日志，无需先联网检查；有新版时展示新版说明，并可展开当前版本日志。缺少日志有明确空态。
- 软件内新版提醒打开同一弹窗，不导航到设置。原页面保持挂载，关闭或 Escape 后恢复原入口焦点。
- 下载、安装保持两次独立点击；查看日志、关闭弹窗、隐藏提醒都不会触发安装。下载可在关闭弹窗后继续，重新打开能看到原进度。

## 职责与维护入口

本次阅读范围包含源码总览、shell、settings、公开更新契约、后端 DesktopUpdates 与主进程 IPC，以及已有更新测试；未进行无关目录的全仓重构。

- `shell/UserMenu.tsx`：只展示账号入口、版本和显式回调，登录占位不阻断更新功能。
- `shell/App.tsx`：持有一份更新控制器及弹窗显隐。打开弹窗不调用全局页面切换或离页确认，原知识／会话／设置树保持挂载。
- `updates/useSoftwareUpdates.ts`：统一本窗口的本机快照读取与固定 IPC 动作；保留下载中的进度读取，操作前后的读取代际防止旧快照覆盖新结果，读取失败可重试。
- `updates/SoftwareUpdates.tsx`、样式：原生 dialog、当前／新版日志、手动更新按钮与新版提醒。日志按纯文本渲染。
- `settings/SettingsView.tsx`：移除原更新组件，继续承载模型、运行与连接配置。

新的呈现目录通过公开 `bridge/contracts/desktop-updates.ts` 依赖状态数据。后端 `backend/updater`、发布源、安装校验、重启排空及用户目录恢复未修改。菜单位置与日志呈现是本次实际变化点，通过前端装配隔离；没有根据一次迁移宣称长期变化频率已获证明。后续调整版本入口读 shell，调整日志排版读 updates，安装策略变化再评估 updater。

源码文件头与关键接口已同步；架构维护覆盖 `frontend` 导航、`shell`、`settings` 和新增 `updates` 的 ARCHITECTURE，相关 CONTRACT 与架构生成器目录定位同步。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| 实施前依赖基线 | 1100 个文件、5808 条依赖、0 环 |
| `pnpm typecheck` | 通过 |
| `pnpm check:architecture` | 通过；53 个目录、566 个源码／样式文件，1101 个维护文件、5812 条依赖、0 环 |
| 依赖／分层测试 | 2 文件 14/14 |
| 更新状态、NSIS 适配、重启用户目录测试 | 3 文件 23/23 |
| `node scripts/desktop-updates-ui-smoke.mjs` | 真实 React App，模拟 IPC；17 项界面检查通过，0 页面异常 |

界面验证从真实账号菜单进入，覆盖菜单键盘操作、模态背景控件不可聚焦、框内 Tab 导航及关闭后焦点返回；验证未登录可读日志、最新版仍有当前日志、旧查询不能回退新状态、失败重试、下载进度和弹窗关闭后的下载延续、提醒共用入口及显式安装。真实设置页供应商名称草稿的值和 DOM 节点均保持；对话／知识编辑树不因弹窗切换而卸载经源码核对，本次未另外运行真实模型会话。

已查看深色、浅色账号菜单与更新弹窗截图，320 px 宽度下弹窗和正文不横向溢出。首次界面断言把原生 dialog 从首个控件 Shift+Tab 后的浏览器 chrome 焦点（activeElement 为 BODY）当成失败；诊断确认 dialog 仍为 `:modal`，测试修正为实际背景控件隔离与框内导航、关闭返回，不通过修改产品行为规避断言。

机器记录位于忽略目录 `test-results/`：`account-updates-boundaries.json`、`account-updates-behavior.json`、`desktop-updates-ui-report.json`；焦点诊断保留为 `account-updates-ui-focus-diagnostic.json`。截图为 `desktop-updates-account-menu.png`、`desktop-updates-account-dark.png`、`desktop-updates-account-light.png`、`desktop-updates-account-narrow.png`。可重跑的界面验证见 [脚本](../../scripts/desktop-updates-ui-smoke.mjs)。

界面的 0.2.0、下载进度及安装回包是测试夹具；没有请求线上安装包或真实退出安装，不将其写成正式升级验收。未运行全仓回归或跨设备验收，未提高 package.json 版本。
