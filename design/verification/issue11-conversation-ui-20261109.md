# Issue #11：对话条目与工作区菜单

独立源码修复与验证；客户端正式发布另行安排。条目名称和删除标记由 shell 的本机布局持有，侧栏与历史菜单共用 ConversationEntries；删除不擦除后端证据或停止任务。runtime.snapshot 的真实主会话／成员绑定决定运行指示灯，终态不保留动画。

工作区名称后紧接折叠箭头；更多操作为竖三点，新对话为气泡。菜单通过 portal 以点击坐标定位，窗口边缘限制在可见区域，支持 Escape 返回焦点、方向键及外部点击关闭。

- 类型检查及架构检查通过；1124 文件、5868 条依赖，0 环，53 目录、570 代码／样式文件。
- 6 文件 29 项通过：tabs、conversation-activity、conversation、runtime-navigation、dependencies、layer-boundaries；报告 `test-results/issue11-tests.json`。
- `node scripts/issue11-ui-smoke.mjs`：真实 React App、模拟 IPC 的浏览器回归通过 7 组断言，页面错误 0、执行写入 0。覆盖历史与侧栏同步、改名／删除后重载、运行终态、删除最后活动条目、菜单定位与键盘焦点、明暗主题及 320px 窗口。证据 `test-results/issue11-ui-report.json`、`issue11-light.png`、`issue11-dark.png`。
- 首次界面验证发现运行状态文字影响条目可访问名称，已给条目选择按钮明确 aria-label。窄窗口脚本等待 resize 的两次 animation frame 后再打开菜单，避免菜单被尚未分发的 resize 正常关闭；未更改产品的 resize 关闭行为。

同步注释及 shell、conversation、components 的 CONTRACT / ARCHITECTURE 和 frontend 导航。下一次修改条目持久化先看 shell/tabs.ts，运行归属看 conversation/conversation-activity.ts，菜单交互看 shell/WorkspaceList.tsx。

## 独立提交复核

基于 #9 提交 `70dfc26` 单独恢复本项，排除模式选择的源码和测试。再次运行类型／架构、6 文件 29 项测试（`test-results/issue11-isolated.json`）及 7 组界面场景全部通过，然后单独提交。
