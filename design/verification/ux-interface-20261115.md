# 全界面风格与交互统一 · 2026-11-15

## 范围与交付状态

用户直接要求按已确认的 [UX 方案](../cbim-ux-system-proposal.md) 和 [图标/动效规范](../cbim-icon-motion-system.md) 优化实际界面。代码基线：`15d27f4b07227b9411e05d8b231508a8fd3476be`，分支 `develop`。本次改动保留在工作树，未提交、合并或发布；无关的 `design/task/domain-agent-loop-engine-architecture.md` 保留原样。

已经实施公共视觉与交互，并迁移页面控件。**这不代表全部页面已完成真实桌面视觉验收**：本机测试启动受限，下面分别记录已通过和未完成的部分。

GitHub 开放工单查询失败：`proxyconnect tcp 127.0.0.1:9`。申请提权读取后，自动审批返回 `automatic approval review could not prepare the action`。没有从历史记录重建清单，没有虚构关联工单、创建或回填 Issue；实施依据是本轮明确授权。

## 实际改动

| 范围 | 当前实现 |
| --- | --- |
| 全局基础 | `interface.css` 统一明暗语义颜色、14px 基础字号、至少 12px 辅助文字、间距与圆角、表单边框和焦点；桌面控件 36px、触屏主要操作 44px |
| 图标 | 产品 Icon 接入设计母版的 70 个图标，保留 7 个既有专用图形和 8 个调用别名，补充 grip 拖动手柄；233 个明确文字操作添加图标，扩展区关闭/收起及队列拖动的 3 个字符图形也已替换，回调保留 |
| 外壳 | 常驻“操作说明”；600px 以下首次默认收起侧栏，展开在内容上方，选择项目/管理页后收起；欢迎页围绕用户目标引导 |
| 对话与执行 | 输入控件可换行、辅助文字可读；本轮结束使用历史标记，失败/中断/停止有不同图形，仍保持原始状态文案 |
| 办公室与任务 | 人物状态增加语义图标，任务卡、交接、核实、补偿、人工决定和接续动作使用同一图标体系；待审阅使用警示色，不冒充验收通过 |
| 运行管理 | 任务/运行行增加状态图标，统计与卡片沿用统一样式；只读和原会话定位边界不变 |
| 管理与专业面板 | 自动化、资源/连接、设置、团队/岗位、模块责任、知识/架构、治理、更新详情迁移操作图标及可读字号 |
| 动效 | 控件反馈 120ms、内容进入 180ms、弹层进入 220ms；统一响应系统减少动效，保留文字事实；没有将原型模拟计时器接入业务 |
| Tooltip | 悬停延迟 450ms、离开延迟 120ms、可移入提示、聚焦显示、Escape 关闭、窗口避让；滚动、目标移除/隐藏/标签改变后关闭；保留已有 aria-describedby |
| 触屏说明 | 原生模态对话框展示当前可见控件的作者说明，包含有说明的禁用按钮；关闭返回入口，不读取表单值、不执行业务动作 |

原运行、授权、版本、队列、未知结果核实及任务生命周期仍由已有模块持有。品牌图片保持原源文件。设计原型仍是演示资产；产品以 `src/view/components/Icon.tsx` 等源文件为实现入口，不运行原型脚本。

## 阅读与维护入口

1. [main.tsx](../../src/view/main.tsx) → [interface.css](../../src/view/components/interface.css)：确认样式装配顺序与全局令牌。
2. [Icon.tsx](../../src/view/components/Icon.tsx) → [InterfaceHelp.tsx](../../src/view/components/InterfaceHelp.tsx)：无业务状态的图形与窗口级提示生命周期。
3. [App.tsx](../../src/view/shell/App.tsx)：顶栏帮助与窄窗口侧栏。
4. [WorkStatus.tsx](../../src/view/execution-view/WorkStatus.tsx) → [OfficeScene.tsx](../../src/view/tasks/OfficeScene.tsx)：执行终态与人物状态各自解释，图形不签发业务完成结论。

View 及 14 个受影响目录的 CONTRACT/ARCHITECTURE 已同步。新增组件与修改的关键行为有源码说明；各业务文件的既有职责/权限注释仍适用。完整改动以基线对当前工作树的 `git diff -- src/view` 加新增 `InterfaceHelp.tsx`、`interface.css` 为准。

## 已执行验证

| 检查 | 结果与边界 |
| --- | --- |
| `pnpm typecheck` | 通过；包括最终 Tooltip 生命周期调整 |
| `pnpm check:architecture` | 通过：128 个目录、753 个代码/样式文件，0 文档漂移；1518 个文件、7404 条依赖、0 循环、0 违规 |
| 静态图标调用审计 | 300 处静态 Icon 调用，未发现未注册名称；86 个图形/别名入口。审计脚本保存在本机 `test-results/ux-interface/audit.cjs` |
| `git diff --check` | 使用仓库原换行设置通过。临时禁用 autocrlf 的检查把已有 CRLF 当作尾部空白，未据此批量改换行 |
| 浏览器真实组件 | 使用产品 Icon、InterfaceHelp、OfficeScene 和明确的测试数据，不连接真实项目；明暗颜色、图标隐藏语义、说明弹窗、禁用原因展示、关闭后焦点返回通过 |
| Tooltip 行为 | 延迟显示、可悬停、合成 focusin 显示、Escape 关闭并恢复 title、标签文本改变后关闭、保留既有 aria-describedby 通过。后台窗口验证不等于完整原生键盘/读屏器验收 |
| 窄宽度 | 320px 工作区 client/scroll 均为 320；320px iframe 实际视口中根 scrollWidth 305，无横向溢出。覆盖测试组件，未覆盖所有生产页面 |

浏览器组件验证通过不需要子进程的 TypeScript 内存转译夹具进行，夹具与本次输出位于本机 `test-results/ux-interface/`，不进入产品构建。曾尝试扩展该夹具装配完整 App，但遇第三方包 `#minpath` 浏览器解析问题，已撤回该尝试，**未把完整 App 装配记为通过**。

首次架构检查发现 WorkStatus 引用工作区共享状态词汇违反执行展示边界；已改为模块内解释 RunSummary 图标，随后检查通过。没有扩大允许依赖或添加豁免。

后台浏览器曾出现 dialog 已关闭但原生 close 事件尚未返回焦点的情况。关闭按钮与 cancel 现在同步调用 closeHelp；分别实测按钮 click 和合成 cancel：弹窗关闭、焦点回到入口均为 true。此证据不等于在前台真实按键或读屏器完成验收。

## 尚未完成的验证

选取以下八组测试，覆盖改动涉及的对话布局、办公室投影、运行状态、执行展示、任务详情和岗位/责任视图：

```text
pnpm exec vitest run tests/chat-chrome.test.ts tests/office-scene.test.ts tests/runtime-view.test.ts tests/run-view.test.ts tests/inline-conversation.test.ts tests/session-task-view.test.ts tests/workspace-member-view.test.ts tests/module-ownership-view.test.ts
```

Vitest 与标准 Vite 预览均在 esbuild 启动时失败：`spawn EPERM`，没有执行测试用例。申请提权运行上述测试后，自动审批仍返回 `automatic approval review could not prepare the action`。环境恢复后需运行同一组测试，并在真实桌面检查各页面的浅色/深色、窄窗口、原生键盘和系统减少动效；不能将这组未运行测试标为通过。

本轮没有修改测试归属、后端类型或持久格式；没有运行全量产品测试、打包、安装升级、真实模型/账号协作，也没有发布。后续验收仍需既有 PR/集成流程。

### 用户要求恢复权限后的再次尝试

2026-11-15 再次运行上述八组精确测试，仍在读取 Vitest 配置、启动 esbuild 子进程时遇到 `spawn EPERM`，没有执行用例。再次申请该测试命令的提权执行，自动审批返回 `automatic approval review could not prepare the action`。

随后查询 Cindy 当前任务运行设置和权限相关能力。当前任务正常运行，但已发现的运行设置接口只提供模型、来源、推理强度和速度调整，没有可调用的审批或沙箱权限恢复参数；未切换引擎或修改安全配置来绕过限制。当前不能确认执行权限已恢复，逐页真实桌面检查也尚未启动。需先修复电脑端 Cindy 的审批/执行环境，再继续同一组测试和桌面验收；不重复已通过的静态检查，也不以组件夹具替代这次要求的桌面检查。
