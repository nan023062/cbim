# Issue #18：图内操作与项目组织树

日期：2026-11-09。范围：[Issue #18](https://github.com/nan023062/cbim/issues/18)。

业务架构上半区移除重复的新建工程模块和模块负责人文字入口。项目根的 + 打开原编辑器，记录图标保留完整责任历史与维护入口；普通负责人选择继续使用模块卡片。展开、折叠和字号四个操作改成图内右上角的图标按钮，保留提示、可访问名称、键盘操作及 12–20px 边界。相关资源、团队和详情操作配有图标与辅助文字。

团队组织树只展示项目根、真实分组与自定义 Agent，统一左对齐并逐层缩进。过滤仅在显示和搜索层生效，完整角色模型、Skill 父链、历史角色及岗位登记继续保留内置角色；没有删定义或修改执行能力。

## 实际验证

- `pnpm typecheck`、`pnpm check:architecture` 通过：53 目录、583 代码/样式文件，0 架构差异；1147 文件、5976 依赖、0 循环。
- `issue18-behavior.json`：团队模型与卡片责任编排 2 文件 / 14 项通过。`issue18-boundaries.json`：真实架构服务、依赖与分层 3 文件 / 19 项通过。总计 5 文件 / 33 项，0 失败、0 跳过。
- `pnpm package` 通过，便携构建 `20261109-210117`。最终源码只在构建后清理一处空行，产品行为没有再改变。
- `pnpm exec tsx scripts/issue18-ui-smoke.mts`：真实 Windows Electron、IPC、独立用户目录和嵌套项目定义，六组检查全部通过。覆盖顶层去重、根图标入口、四个图内控件、键盘折叠、字号两端禁用、树形缩进与搜索、父链 Skill、内置执行岗位选项、320px 无横向溢出及重载。快照 revision 和运行列表保持，页面错误 0、模型请求 0。
- 在同一新构建上复跑 `scripts/issue14-ui-smoke.mjs` 三组及 `scripts/issue17-ui-smoke.mts` 五组，全部通过，验证项目根创建/重开、负责人登记/切换/解除/复用、提交回包丢失后只查询、图标编辑与取消、窄栏控件。页面错误均为 0。
- 本机证据：`test-results/issue18-ui-report.json`、`issue18-business-light.png`、`issue18-business-narrow.png`、`issue18-team-light.png`、`issue18-team-dark.png`、`issue18-team-narrow.png`；已人工查看窄栏和明亮主题截图。脚本、行为测试和本报告纳入仓库。

首个行为命令包含一个不存在的测试文件名，Vitest 实际仅运行上述 2 个已存在文件；未将不存在的文件计入通过。随后明确运行真实 `architecture-service.test.ts` 与边界测试。没有产品失败、断言降级或自动重放未知写入。

## 维护入口与边界

`components/GraphViewControls.tsx` 共用无业务状态的四个操作；两种图各自拥有展开和字号状态。以后增加图的展示操作在组件与调用方装配，业务保存、知识事务、来源采纳和调度服务不需改变。`team-model.ts` 的 `visibleTeamNodes(..., false)` 负责可见集合，完整 `buildTeamModel` 和 `availableTeamSkills` 保持独立；不能为隐藏节点而删角色或改变继承。

已同步上述文件、两个视图和样式的定位/设计说明，以及 components、team、workspace 三处 CONTRACT 与 ARCHITECTURE。验证仅涉及隔离便携程序；未安装或重启真实用户客户端，未发布新版。下一项为新收到的 #19，按独立开发、验证和提交继续。
