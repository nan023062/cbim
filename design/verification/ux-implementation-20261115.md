# 全界面设计同步实施：管理与工具界面

日期：2026-11-15。用户直接要求“依次按照设计同步实施”。这是在原有 UX 工作树上的增量实现，不是新建模拟页面。设计依据为 [全界面设计](../cbim-complete-ux-design.md)。

## 范围与状态

GitHub CLI 因代理 `127.0.0.1:9` 无法查询；申请网络提权时自动审批返回 `automatic approval review could not prepare the action`。随后通过 Cindy 管理的浏览器只读核实当前 Issues：开放数量为 1，只有工作流故障 #65，与本次 UX 无关。本次按用户直接授权实施，没有创建、修改、关闭或回填无关工单。

已有基础主题、图标、任务与办公室视觉改动保留。本批补齐以下实际页面结构及交互：

| 设计范围 | 本批代码行为 |
| --- | --- |
| 设置总览 / 模型 / 额度 / 网页反馈 / 仓库 | 总览卡片、四组导航、作用范围；固定挂载表单，分组切换保留草稿。离开整个设置页的持久化仍未增加 |
| 资源库 | 初始读取、读取失败、未配置、空仓库、筛选无结果分开；筛选状态和清除入口明确 |
| 资源编辑 / 选择目标 / 资源应用 | 原生模态约束焦点；编辑取消保留原脏稿确认；应用以实际选择、预览、回执显示三个阶段 |
| 自动化列表 / 编辑 / 历史 | 搜索定义、当前项目范围与数量、独立历史状态筛选、匹配总数；固定保存区域、取消草稿确认 |
| 团队 / 主 Agent 配置 / 业务架构 | 项目身份、能力或模块数量与边界；管理入口有可见文字；主 Agent 模态关闭保护未保存选择 |
| 知识编辑 / 架构编辑 / 治理 | 统一 ModalFrame；保留原版本、原请求、预览和提交语义；在途关闭由各业务阻止 |
| 扩展页签 | tab/panel 配对，选中项进入 Tab 顺序，方向键与 Home/End 切换 |
| 终端 / 浏览器 | 显示项目身份和终端目录；终端同步锁避免在途重复派发，分别呈现请求中、运行中、退出码；浏览器保留安全沙箱和真实外部打开 |
| 诊断 | 只消费项目和实例都匹配的知识快照；显示身份与修订，不将别的项目检查结果当作当前通过 |
| 更新 | 下载百分比缺失时使用不定进度，保留真正的 0%；不推算下载成功 |

**本批不是 34 个原有操作面的全面完成声明。** 对话、任务依赖图、人工决定/恢复、岗位责任/履历、运行管理和连接授权等沿用已有实现及此前公共视觉改动，本批没有重新逐项完成其全部设计交互。7 个聚合/扩展提案未接入后端；尤其未实现真实人员邀请、跨用户交接或全局通知。上述边界用于说明本次交付，不构成另一份实时开发清单。

## 代码与维护入口

- 公共机制：[ModalFrame](../../src/view/components/ModalFrame.tsx) → [公共样式](../../src/view/components/interface.css)。机制仅处理焦点，不拥有业务许可、草稿、请求或提交。
- 设置：[SettingsView](../../src/view/settings/SettingsView.tsx) → [settings.css](../../src/view/settings/settings.css)。设置作用范围和保存责任仍归各子表单。
- 列表与编辑：[ResourceRepositoryView](../../src/view/resources/ResourceRepositoryView.tsx)、[AutomationView](../../src/view/automation/AutomationView.tsx)。数据不迁入新的全局状态。
- 工具：[ExtensionArea](../../src/view/shell/ExtensionArea.tsx) → [WorkspaceDiagnostics](../../src/view/diagnostics/WorkspaceDiagnostics.tsx) → [SoftwareUpdates](../../src/view/updates/SoftwareUpdates.tsx)。身份、停止和进度均使用既有 IPC 事实。

components/settings/resources/automation/team/knowledge/workspace/shell/diagnostics/governance/updates 的文件头与 CONTRACT 已同步，相关 ARCHITECTURE 由现有生成器同步。新增目录没有引入。完整累计改动可由 `git diff -- src/view tests/modules.json` 加未跟踪的 ModalFrame、settings.css、diagnostics CONTRACT 和两份测试查看；工作树还包含此前改动，不能将全部 diff 归为本批。

## 已执行验证

- `pnpm typecheck`：产品改动通过。
- `pnpm check:architecture`：128 个目录、755 个代码/样式文件，0 文档差异；1524 文件、7411 依赖，0 循环与违规。此命令在新增两份测试前执行，测试本身不修改生产依赖。
- `git diff --check`：通过；换行提示是既有 autocrlf 行为，没有批量更改源码换行策略。
- Cindy 浏览器加载真实 SettingsView、AutomationView、WorkspaceDiagnostics、ResourceRepositoryView、SoftwareUpdates、ModalFrame 与 InterfaceHelp；IPC 替换为内存测试数据，不调用账号、模型、文件或外部服务。
- 组件行为检查：分组切换后模型草稿仍在；原生模态打开并聚焦内容、cancel 后返回入口；不匹配的诊断快照不显示通过；历史 unknown 筛选只显示对应记录；资源编辑拒绝关闭后保留草稿；未知更新进度没有 value 属性。均通过。
- 设置 5 个分组 + 自动化 + 诊断，在 320/390px、浅色/深色下共 28 组真实 iframe 视口检查：未发现根内容横向溢出。查看了设置总览桌面截图。没有将这些检查描述为每页逐张视觉验收。
- 首次批量视口检查触发浏览器超时，结果未知，未计通过；确认该只读检查结束、iframe 已清理后，改用记录进度的独立检查取得上述 28 组结果。
- 两份新增测试的唯一归属已直接核对：`diagnostics-view.test.ts` → view/diagnostics unit；`software-updates-view.test.ts` → view/updates unit。不加载完整 Application。

组件验证夹具保存在本机 `test-results/ux-implementation/`，不进入产品构建；内存转译验证不能替代标准构建、测试运行器、完整 App 或桌面验收。

## 未完成的验证与恢复条件

按本次变化选择：

```text
pnpm exec vitest run tests/diagnostics-view.test.ts tests/software-updates-view.test.ts tests/budget-settings-view.test.ts tests/resource-application.test.ts tests/chat-chrome.test.ts
pnpm check:test-modules
```

前者在加载配置、启动 esbuild 时失败 `spawn EPERM`，用例未执行。后者因 `spawnSync git EPERM` 失败，不能以直接核对两份登记代替正式检查。精确测试的提权请求被自动审批拒绝：`automatic approval review could not prepare the action`。

执行环境修复后需补跑以上命令及真实桌面逐页检查。终端原生进程、跨站浏览器、治理/知识/资源的真实事务、原生键盘与读屏器均未在本批验收。不修改权限配置绕过限制；未运行全量测试、安装、发布、真实模型调用。未提交、合并或发布。
