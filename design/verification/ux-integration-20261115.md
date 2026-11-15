# UX 与当前开发分支整合验证

日期：2026-11-15。工作分支：`feat/ux-release-integration`。

基于 UX 快照 `14bf63f0` 整合 `origin/develop` 的 `c09a7c38`。保留当前办公室/对话双模式、独立频道草稿、引擎设置与团队/业务架构树；未恢复已经退出的独立任务图。将公共样式、延迟页面、设置草稿保护适配到当前界面。测试在隔离 worktree 中运行，不覆盖用户安装或真实项目。

## 已完成的验证

- `pnpm typecheck`：通过。
- `pnpm exec vitest run tests/deferred-view.test.ts tests/diagnostics-view.test.ts tests/software-updates-view.test.ts tests/chat-chrome.test.ts tests/settings-navigation.test.ts tests/runtime-view.test.ts tests/workspace-member-view.test.ts tests/module-ownership-view.test.ts tests/human-decision-view.test.ts tests/execution-recovery-view.test.ts`：10 文件、72 用例通过。选择依据：公共页面入口、设置导航、运行与更新状态、成员和责任交互、人工决定及恢复受此次整合影响。
- `pnpm check:test-modules`：530 文件，unit 170、contract 160、integration 200。
- `pnpm check:architecture`：134 目录、819 代码/样式文件，生成资料无差异；依赖无环、无边界违规。
- `pnpm exec vite build --config vite.renderer.config.ts --outDir test-results/ux-integration-build`：通过，最大 JS chunk 380.62 kB，无默认大包警告。
- `node scripts/settings-center-ui-smoke.mjs`：13 组通过，无页面异常。隔离 IPC、真实 App 外壳；覆盖设置按需读取、草稿、错误恢复、主题、320/390/800px。夹具导入完整生产样式，侧栏尺寸依据统一规则核验。
- `pnpm exec tsx scripts/architecture-tree-smoke.mts`：5 组通过。隔离 offscreen Electron 与临时文件；覆盖组织树、业务来源树、未知回执不重放、迟到结果隔离、1440/320px 明暗主题。
- `node scripts/interaction-area-smoke.mjs`：12 组通过。隔离 offscreen Electron 与内存 IPC；覆盖双模式、独立频道草稿/附件/滚动、显式回到主频道、原等待范围恢复、未知回执不重放、扩展区域入口。

## 边界

上述检查不是用户桌面的逐页验收，也不代表完整 CI、安装升级或发布通过。此前前台激活失败的真实桌面检查仍见 [历史记录](ux-desktop-20261115.md)，不以 offscreen Electron 结果覆盖该事实。

用户已确认 Windows 使用未签名安装包并标注发布者未验证；资源包仍按既有发布校验要求处理。本次未发布安装包。

2026-11-15 用户进一步明确 CBIM 仅作单人工具，不建设独立账号或协作服务。当前单人范围收敛及全量测试由 Issue #87 跟踪。
